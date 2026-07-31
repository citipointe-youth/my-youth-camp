import type { IPersonRepository, IChurchRepository } from '../repositories/interfaces/entity-repositories';
import type { RevealAuditService } from './reveal-audit.service';
import type { Person } from '../core/entities/person';
import type { Church, ChurchContact } from '../core/entities/church';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { isCamper, isRegistrant } from '../core/entities/person';
import { canAccessPerson } from './person.service';
import { NotFoundError } from '../core/errors/app-error';
import { maskPhone } from '../utils/mask';

export interface SearchResult {
  camper: Person;
  contacts: MaskedContact[];
}

export interface MaskedContact {
  role: string;
  name: string;
  phone: string; // masked unless revealed
  gender: 'male' | 'female';
  type: 'primary' | 'backup';
  churchId: string;
}

export interface RevealedContact extends MaskedContact {
  phone: string; // unmasked
}

export interface SearchService {
  search(actor: Actor, q: string): Promise<SearchResult[]>;
  resolveContacts(actor: Actor, camperId: string): Promise<MaskedContact[]>;
  /**
   * Reveal one masked contact. `opts.initials` is the acting leader's initials (church sessions
   * prefill these) and is recorded on the reveal audit row — it is NOT used for access control,
   * which is `camper:read:sensitive` + `canAccessPerson`, both below.
   */
  revealContact(
    actor: Actor,
    camperId: string,
    contactRole: string,
    opts?: { initials?: string },
  ): Promise<RevealedContact>;
}

function makeContacts(church: Church, gender: 'male' | 'female', opts?: { mask?: boolean }): MaskedContact[] {
  const mask = opts?.mask !== false;
  const genderContacts = church.contacts[gender];
  const contacts: MaskedContact[] = [];

  if (genderContacts.primary.name) {
    contacts.push({
      role: `${gender}-primary`,
      name: genderContacts.primary.name,
      phone: mask ? maskPhone(genderContacts.primary.phone) : genderContacts.primary.phone,
      gender,
      type: 'primary',
      churchId: church.id,
    });
  }
  if (genderContacts.backup.name) {
    contacts.push({
      role: `${gender}-backup`,
      name: genderContacts.backup.name,
      phone: mask ? maskPhone(genderContacts.backup.phone) : genderContacts.backup.phone,
      gender,
      type: 'backup',
      churchId: church.id,
    });
  }
  return contacts;
}

/**
 * Bug 22 (2026-07-28): the ministry-leader contacts shown for a person, with a cross-gender
 * SECONDARY fallback.
 *
 * The rule: a person always leads with their own gender's contacts. If that gender has a primary
 * but no backup, the OPPOSITE gender's primary becomes the secondary point of contact — the
 * common case being a ministry that lists exactly one male and one female leader, where each
 * gender's students would otherwise have a primary and nobody else. Where a gender lists two
 * leaders (primary + backup) nothing changes: their own backup is already the secondary.
 *
 * The existing "no same-gender contacts at all → use the opposite gender's list" fallback is
 * unchanged and still takes precedence (there is no primary to lead with).
 */
function contactsForPerson(church: Church, gender: 'male' | 'female', opts?: { mask?: boolean }): MaskedContact[] {
  const opposite = gender === 'male' ? 'female' : 'male';
  const own = makeContacts(church, gender, opts);
  if (own.length === 0) return makeContacts(church, opposite, opts);
  if (own.some((c) => c.type === 'backup')) return own;
  const oppositePrimary = makeContacts(church, opposite, opts).find((c) => c.type === 'primary');
  return oppositePrimary ? [...own, oppositePrimary] : own;
}

// Synthetic contact role for a camper's parent/guardian (Bug 1 — the masked+audited reveal
// swap: leader contacts are now shown plainly on Student Info, and the parent number is the
// one behind the mask + audit gate instead). Not a real ChurchContact, so it's handled
// separately from the church-contacts raw map below.
const PARENT_ROLE = 'parent';

function makeParentContact(person: Person, opts?: { mask?: boolean }): MaskedContact | null {
  if (!person.parentPhone) return null;
  const mask = opts?.mask !== false;
  return {
    role: PARENT_ROLE,
    name: person.parentGuardianName || 'Parent/Guardian',
    phone: mask ? maskPhone(person.parentPhone) : person.parentPhone,
    gender: person.gender === 'female' ? 'female' : 'male',
    type: 'primary',
    churchId: person.churchId,
  };
}

/**
 * Blank every sensitive/health/contact field on a person, keeping only the identity + placement
 * needed to LOCATE them (name, gender, grade, church, zone, kind, lifecycle). Used for cross-scope
 * search hits — a church/zoneLeader can find any camper across churches/genders to reach that
 * camper's church leaders (items 7 & 10), but must never see another church's (or another gender's)
 * medical/dietary/parent/medicare data (item 6). The single-person GET /campers/:id path still
 * gates on canAccessPerson, so a redacted hit can't be drilled into for the real values either.
 */
function redactSensitive(person: Person): Person {
  return {
    ...person,
    dateOfBirth: null,
    mobile: null,
    email: null,
    suburb: null,
    postcode: null,
    state: null,
    medicalConditions: [],
    dietaryRequirements: [],
    otherMedications: null,
    medicareNumber: null,
    parentGuardianName: null,
    parentPhone: null,
    parentRelation: null,
    blueCardNumber: null,
    blueCardExpiry: null,
    consents: Object.fromEntries(
      Object.keys(person.consents).map((k) => [k, { granted: false, timestamp: null }]),
    ) as Person['consents'],
  };
}

export function makeSearchService(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
  /**
   * Optional so every existing test can keep calling `makeSearchService(people, churches)`.
   * When absent the reveal simply is not recorded — the audit must never be the reason a
   * first-aider cannot get a phone number (see reveal-audit.service.ts).
   */
  revealAudit?: RevealAuditService,
): SearchService {
  async function getContactsForPerson(person: Person): Promise<{ masked: MaskedContact[]; raw: Map<string, ChurchContact & { gender: 'male' | 'female'; type: 'primary' | 'backup' }> }> {
    const church = await churchRepo.findById(person.churchId);
    if (!church) {
      return { masked: [], raw: new Map() };
    }

    const gender = person.gender === 'female' ? 'female' : 'male';
    const oppositeGender = gender === 'male' ? 'female' : 'male';

    // Own-gender contacts, with the cross-gender fallbacks in `contactsForPerson` (bug 22).
    const contacts: MaskedContact[] = contactsForPerson(church, gender);

    const raw = new Map<string, ChurchContact & { gender: 'male' | 'female'; type: 'primary' | 'backup' }>();
    raw.set(`${gender}-primary`, { ...church.contacts[gender].primary, gender, type: 'primary' });
    raw.set(`${gender}-backup`, { ...church.contacts[gender].backup, gender, type: 'backup' });
    raw.set(`${oppositeGender}-primary`, { ...church.contacts[oppositeGender].primary, gender: oppositeGender, type: 'primary' });
    raw.set(`${oppositeGender}-backup`, { ...church.contacts[oppositeGender].backup, gender: oppositeGender, type: 'backup' });

    return { masked: contacts, raw };
  }

  return {
    async search(actor, q) {
      assertCan(actor, 'camper:read');
      const persons = await personRepo.search(q);
      // First-aiders must be able to find ANYONE who is registered — including people who have
      // not yet arrived, or who have signed out/departed — so a medical lookup never fails because
      // of presence state. The SPA red-flags anyone not currently on site.
      //
      // church/zoneLeader get an "All churches" search (items 6/7/10): ANY arrived camper is
      // findable across churches AND genders so a leader can locate a student and reach that
      // student's church contacts — but a hit OUTSIDE the actor's own canAccessPerson scope has
      // its sensitive data redacted (no other-church/other-gender medical, dietary, parent or
      // medicare). director/admin already access everyone; their results are never redacted.
      const results: SearchResult[] = [];
      for (const person of persons) {
        const owned = canAccessPerson(actor, person);
        let visible: boolean;
        if (owned) {
          visible = isCamper(person) || (actor.role === 'firstAid' && isRegistrant(person));
        } else if (actor.role === 'church' || actor.role === 'zoneLeader') {
          visible = isCamper(person);
        } else {
          visible = false;
        }
        if (!visible) continue;
        const { masked } = await getContactsForPerson(person);
        results.push({ camper: owned ? person : redactSensitive(person), contacts: masked });
      }
      return results;
    },

    async resolveContacts(actor, camperId) {
      assertCan(actor, 'camper:read');
      const person = await personRepo.findById(camperId);
      // Any accessible registered person (not just arrived campers) — so the first-aid card can
      // show the ministry-leader contacts for someone who hasn't checked in yet.
      if (!person) throw new NotFoundError('Camper not found');
      if (!canAccessPerson(actor, person)) {
        throw new NotFoundError('Camper not found');
      }
      const church = await churchRepo.findById(person.churchId);
      // Bug 1 (2026-07-17): the ministry-leader numbers are no longer masked here — this
      // endpoint is only consumed by the Student Info card, which now shows them plainly
      // (no reveal, no audit). The parent/guardian number takes over the masked slot instead —
      // appended as a synthetic 'parent' contact, revealed via revealContact() below like any
      // other masked role.
      let leaderContacts: MaskedContact[] = [];
      if (church) {
        const gender = person.gender === 'female' ? 'female' : 'male';
        leaderContacts = contactsForPerson(church, gender, { mask: false });
      }
      const parentContact = makeParentContact(person, { mask: true });
      return [...leaderContacts, ...(parentContact ? [parentContact] : [])];
    },

    async revealContact(actor, camperId, contactRole, opts) {
      assertCan(actor, 'camper:read:sensitive');
      const person = await personRepo.findById(camperId);
      // Bug 21 (2026-07-28): this used to also require `isCamper(person)` (lifecycle >= arrived),
      // while `resolveContacts` above deliberately does NOT — so the Student Info card would
      // happily render a masked parent number for a student who had not signed in yet, and
      // tapping it returned "Camper not found". The two must agree on who is resolvable; the
      // real access gate is `canAccessPerson` below, which is unchanged.
      if (!person) throw new NotFoundError('Camper not found');
      if (!canAccessPerson(actor, person)) {
        throw new NotFoundError('Camper not found');
      }
      // Record AFTER every access check and AFTER the contact is known to exist, so a
      // NotFound never writes an audit row for a reveal that did not happen. A parent reveal
      // and a leader reveal are logged as different kinds — the parent number is the sensitive
      // one (masked at the DTO boundary for first aid); a leader number is a work contact.
      const kind = contactRole === PARENT_ROLE ? 'parent-contact' : 'leader-contact';

      if (contactRole === PARENT_ROLE) {
        const parentContact = makeParentContact(person, { mask: false });
        if (!parentContact) throw new NotFoundError('Contact not available');
        await revealAudit?.record(actor, { kind, person, initials: opts?.initials, contactRole });
        return parentContact;
      }
      const { masked, raw } = await getContactsForPerson(person);
      const rawContact = raw.get(contactRole);
      if (!rawContact) throw new NotFoundError('Contact role not found');
      const maskedEntry = masked.find((m) => m.role === contactRole);
      if (!maskedEntry) throw new NotFoundError('Contact not available');

      await revealAudit?.record(actor, { kind, person, initials: opts?.initials, contactRole });
      return {
        ...maskedEntry,
        phone: rawContact.phone,
      };
    },
  };
}
