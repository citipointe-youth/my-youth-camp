import type { IPersonRepository } from '../repositories/interfaces/entity-repositories';
import type { Person } from '../core/entities/person';
import { isCamper, isRegistrant } from '../core/entities/person';
import type { CheckInEntry, SignOutEvent } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { assertCan, canAccessChurch } from './access-control';
import { NotFoundError, BadRequestError } from '../core/errors/app-error';
import { ageFromDob, nowISO } from '../utils/date';
import { newId } from '../utils/id';
import { withCheckIn, withSignEvent } from './person-lifecycle';
import { invalidateDashboardCache } from './dashboard-cache';

/**
 * PersonService — the unified registrant + camper service (design D2), operating
 * over the single `people` store. It exposes a pre-camp ("registrant") view and an
 * at-camp ("camper") view, both filtered by lifecycle. The /registrants and /campers
 * routes are lifecycle-filtered DTO views over this service (Phase 1 complete).
 * RBAC reuses the canonical helpers in access-control.ts; person scoping reads
 * churchId/zone (the only fields the camper/registrant access rules use).
 */

export interface PersonProfile extends Person {
  fullName: string;
  age: number | null;
  lastSignOut: string | null;
}

export interface ChaseResult {
  churchId: string;
  churchName: string;
  registrantId: string;
  firstName: string;
  lastName: string;
  reason: 'unpaid' | 'no_blue_card' | 'both';
}

export interface RegistrantBreakdown {
  churchId: string;
  churchName: string;
  zone: string;
  total: number;
  campers: number;
  leaders: number;
  unpaid: number;
  depositPaid: number;
  paid: number;
  noBlueCard: number;
}

export interface PersonService {
  /** All people the actor may see (any lifecycle), role-scoped. */
  list(actor: Actor, opts?: { zone?: string; churchId?: string; q?: string }): Promise<Person[]>;
  /** Pre-camp view: lifecycle === 'registered'. */
  listRegistrants(actor: Actor, churchId?: string, opts?: { includeCancelled?: boolean }): Promise<Person[]>;
  /** At-camp view: lifecycle ∈ {arrived, checked_out, departed}. */
  listCampers(actor: Actor, opts?: { zone?: string; churchId?: string; q?: string }): Promise<Person[]>;
  get(actor: Actor, id: string): Promise<Person>;
  getProfile(actor: Actor, id: string): Promise<PersonProfile>;
  buildProfile(person: Person): PersonProfile;

  // ----- Step 4 write surface (dormant until the live switchover wires routes) -----
  /** Create a pre-camp registrant (lifecycle 'registered'). */
  create(actor: Actor, input: { firstName: string; lastName: string; gender: Person['gender']; kind?: Person['kind']; grade?: Person['grade'] | null; churchId: string; churchName: string; zone: string; paymentStatus?: Person['paymentStatus']; accommodationKind?: Person['accommodationKind']; accommodationLabel?: string | null; parentGuardianName?: string | null; parentPhone?: string | null; mobile?: string | null; medicalConditions?: string[]; dietaryRequirements?: string[] }): Promise<Person>;
  update(actor: Actor, id: string, patch: Partial<Person>): Promise<Person>;
  remove(actor: Actor, id: string): Promise<void>;
  /** Apply a check-in entry — first 'in' promotes registered → arrived (Day-1 sign-in). */
  checkIn(actor: Actor, personId: string, entry: Omit<CheckInEntry, 'id'>): Promise<Person>;
  /** Apply a sign-out/sign-in attendance event. */
  signEvent(actor: Actor, personId: string, event: Omit<SignOutEvent, 'id'>): Promise<Person>;
  /** Find unpaid / no-blue-card leaders for chasing, scoped by actor role. */
  chase(actor: Actor): Promise<ChaseResult[]>;
  /** Per-church registrant counts (total, payment, blue card), scoped by actor role. */
  breakdown(actor: Actor): Promise<RegistrantBreakdown[]>;
  /** Log a reminder send for the given registrant IDs (scoped, skips cancelled). */
  remind(actor: Actor, ids: string[]): Promise<{ sent: number }>;
  /** All at-camp persons with at least one medical flag, scoped by actor role. */
  listMedicalWatch(actor: Actor): Promise<Person[]>;
}

/**
 * True if the actor may access a person, by role + church/zone (mirrors canAccessCamper),
 * AND — for a gender-scoped church login (Feature 2) — by gender.
 *
 * This is the single chokepoint for gender scoping: `list`/`get`/roster (checkin.service),
 * search (search.service) and the dashboards (dashboard.service) all filter through here, so a
 * `b-<church>` account sees only male people of its church and `g-<church>` only female — for
 * students AND leaders alike. When the caller doesn't carry a gender (e.g. the pre-create scope
 * check passes only churchId/zone) the gender narrowing is skipped for that field.
 */
export function canAccessPerson(
  actor: Actor,
  person: Pick<Person, 'churchId' | 'zone'> & Partial<Pick<Person, 'gender'>>,
): boolean {
  if (!canAccessByChurchZone(actor, person)) return false;
  // Gender-scoped church logins (b-/g-) see only same-gender people. Denial is limited to a
  // person of the CONCRETE opposite gender — someone recorded as 'other' (or, defensively, with
  // an unset gender, e.g. a blank Elvanto import) stays visible to BOTH of a church's logins so
  // no minor is left without a church-level custodian. Admin/director can correct the gender.
  if (
    actor.genderScope &&
    (person.gender === 'male' || person.gender === 'female') &&
    person.gender !== actor.genderScope
  ) {
    return false;
  }
  return true;
}

function canAccessByChurchZone(actor: Actor, person: Pick<Person, 'churchId' | 'zone'>): boolean {
  switch (actor.role) {
    case 'admin':
    case 'director':
    case 'firstAid':
      return true;
    case 'zoneLeader':
      return actor.zone != null && person.zone === actor.zone;
    case 'church':
      return actor.churchId === person.churchId;
    default:
      return false;
  }
}

export function makePersonService(repo: IPersonRepository): PersonService {
  function buildProfile(person: Person): PersonProfile {
    const lastSignOut =
      person.signOutHistory
        .filter((e) => e.type === 'out')
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.timestamp ?? null;
    return {
      ...person,
      fullName: `${person.firstName} ${person.lastName}`,
      age: person.dateOfBirth ? ageFromDob(person.dateOfBirth) : null,
      lastSignOut,
    };
  }

  async function scopedAll(
    actor: Actor,
    opts: { zone?: string; churchId?: string; q?: string },
  ): Promise<Person[]> {
    let results: Person[];
    if (opts.q) {
      results = await repo.search(opts.q);
    } else if (opts.zone) {
      results = await repo.findByZone(opts.zone);
    } else if (opts.churchId) {
      results = await repo.findByChurch(opts.churchId);
    } else {
      results = await repo.findAll();
    }
    return results.filter((p) => canAccessPerson(actor, p));
  }

  async function getOwned(actor: Actor, id: string): Promise<Person> {
    const p = await repo.findById(id);
    if (!p) throw new NotFoundError('Person not found');
    if (!canAccessPerson(actor, p)) throw new NotFoundError('Person not found');
    return p;
  }

  return {
    buildProfile,

    async list(actor, opts = {}) {
      assertCan(actor, 'camper:read');
      return scopedAll(actor, opts);
    },

    async listRegistrants(actor, churchId, opts = {}) {
      assertCan(actor, 'registrant:read');
      /* `includeCancelled` exists for ONE caller: the Budget screen. Cancelling must not silently
         drop a person's money (both isRegistrant and isCamper exclude cancelled), so the budget —
         and only the budget — sees them; their value keeps counting until a Refund is recorded.
         Gated to director/admin, which is exactly who can open the budget and the Data Import
         screen, so a church login can never widen its own scope with a query param. */
      const includeCancelled = opts.includeCancelled === true
        && (actor.role === 'director' || actor.role === 'admin');
      const keep = (p: Person) => isRegistrant(p) || (includeCancelled && p.lifecycle === 'cancelled');
      // Preserve the legacy churchId fast-path access check (registrant.service.list).
      if (churchId) {
        const items = await repo.findByChurch(churchId);
        const zone = items[0]?.zone;
        // canAccessChurch matches the old registrant behaviour incl. the empty-church
        // edge (zone undefined -> zoneLeader denied).
        if (!canAccessChurch(actor, churchId, zone)) {
          return [];
        }
        // canAccessChurch is gender-unaware; re-filter through canAccessPerson so a
        // gender-scoped (b-/g-) login can never pull the other gender via ?churchId.
        return items.filter(keep).filter((p) => canAccessPerson(actor, p));
      }
      const all = await scopedAll(actor, {});
      return all.filter(keep);
    },

    async listCampers(actor, opts = {}) {
      assertCan(actor, 'camper:read');
      const all = await scopedAll(actor, opts);
      return all.filter(isCamper);
    },

    async get(actor, id) {
      assertCan(actor, 'camper:read');
      return getOwned(actor, id);
    },

    async getProfile(actor, id) {
      assertCan(actor, 'camper:read');
      const p = await getOwned(actor, id);
      return buildProfile(p);
    },

    // ----- Step 4 write surface (dormant; wired to routes during the switchover) ---

    async create(actor, input) {
      assertCan(actor, 'registrant:write');
      if (!canAccessPerson(actor, { churchId: input.churchId, zone: input.zone, gender: input.gender })) {
        throw new BadRequestError('Cannot create a person outside your scope');
      }
      const now = nowISO();
      const person: Person = {
        id: newId('person'),
        firstName: input.firstName,
        lastName: input.lastName,
        gender: input.gender,
        dateOfBirth: null,
        grade: input.grade ?? null,
        school: null,
        kind: input.kind ?? 'youth',
        churchId: input.churchId,
        churchName: input.churchName,
        zone: input.zone,
        groupId: null,
        mobile: input.mobile ?? null,
        email: null,
        suburb: null,
        postcode: null,
        state: null,
        medicalConditions: input.medicalConditions ?? [],
        dietaryRequirements: input.dietaryRequirements ?? [],
        otherMedications: null,
        medicareNumber: null,
        churchUnlistedNote: null,
        elvantoMeta: null,
        parentGuardianName: input.parentGuardianName ?? null,
        parentPhone: input.parentPhone ?? null,
        parentRelation: null,
        blueCardNumber: null,
        blueCardExpiry: null,
        consents: {
          medical: { granted: false, timestamp: null },
          media: { granted: false, timestamp: null },
          supervision: { granted: false, timestamp: null },
        },
        paymentStatus: input.paymentStatus ?? 'unpaid',
        accommodationKind: input.accommodationKind ?? null,
        accommodationLabel: input.accommodationLabel ?? null,
        needsReview: false,
        lifecycle: 'registered',
        atCamp: false,
        checkInHistory: [],
        signOutHistory: [],
        createdAt: now,
        updatedAt: now,
      };
      const saved = await repo.save(person);
      invalidateDashboardCache();
      return saved;
    },

    async update(actor, id, patch) {
      assertCan(actor, 'registrant:write');
      const existing = await getOwned(actor, id);
      // History, atCamp, and createdAt are never patchable; lifecycle is restricted to
      // registered ↔ cancelled (camp-state transitions go via checkIn/signEvent).
      const { id: _i, atCamp: _a, checkInHistory: _ch, signOutHistory: _sh, createdAt: _c, lifecycle, ...safeRest } = patch;
      // A church login must not reassign a person's church/zone or flip their gender — that would
      // move the person out of (or tamper across) its scope. Those edits are admin/director/
      // zoneLeader concerns; churches keep their per-student medical/dietary/contact edits.
      if (actor.role === 'church') {
        delete (safeRest as Partial<Person>).gender;
        delete (safeRest as Partial<Person>).churchId;
        delete (safeRest as Partial<Person>).churchName;
        delete (safeRest as Partial<Person>).zone;
      }
      const nextLifecycle =
        lifecycle === 'cancelled' || lifecycle === 'registered' ? lifecycle : existing.lifecycle;
      /* A patch that sets accommodationKind is setting the IMPORTERS' value (the manual
         hand-correction path), so it must move the raw carrier too — personColumns persists
         accommodationKindRaw, and leaving it holding `existing`'s stale value would silently
         discard the edit. The individual override is a separate field and is untouched here. */
      const rawPatch: Partial<Person> = safeRest.accommodationKind !== undefined
        ? { accommodationKindRaw: safeRest.accommodationKind }
        : {};
      /* ⚠️ `atCamp` and `lifecycle` are ORTHOGONAL by design (person.ts:129-130) and atCamp is
         stripped from every patch above — deliberately. This ONE transition couples them, because
         checkin.service.ts:113-121, checkin-warnings.ts:179-188 and dashboard.service.ts:207-215
         all filter on atCamp and never consult lifecycle: without this, a cancelled student stays
         on the check-in roster and in the "still to check in" count. Do not "fix" this back.
         Cancelling deliberately does NOT change the budget — their money keeps counting until
         Refund is pressed (see listRegistrants `includeCancelled`). */
      const cancelling = nextLifecycle === 'cancelled' && existing.lifecycle !== 'cancelled';
      const unCancelling = nextLifecycle === 'registered' && existing.lifecycle === 'cancelled';
      const cancelPatch: Partial<Person> =
        cancelling ? { atCamp: false, cancelledAt: nowISO() }
        : unCancelling ? { cancelledAt: null }
        : {};
      // A refund is money leaving — stamp when. Independent of cancel in both directions.
      const refundPatch: Partial<Person> =
        safeRest.refundAmount !== undefined && safeRest.refundAmount !== existing.refundAmount
          ? { refundedAt: safeRest.refundAmount == null ? null : nowISO() }
          : {};
      const updated: Person = { ...existing, ...safeRest, ...rawPatch, ...cancelPatch, ...refundPatch,
        id: existing.id, lifecycle: nextLifecycle, updatedAt: nowISO() };
      // Fail-closed: the patched result must still be inside the actor's scope (a zoneLeader/
      // admin/director changing church/zone can't push a person out of what they may access).
      if (!canAccessPerson(actor, updated)) {
        throw new BadRequestError('Cannot move a person outside your scope');
      }
      const saved = await repo.save(updated);
      invalidateDashboardCache();
      return saved;
    },

    async remove(actor, id) {
      assertCan(actor, 'registrant:write');
      await getOwned(actor, id);
      await repo.delete(id);
      invalidateDashboardCache();
    },

    async checkIn(actor, personId, entry) {
      assertCan(actor, 'checkin:write');
      const person = await getOwned(actor, personId);
      if (person.lifecycle === 'cancelled') {
        throw new BadRequestError('Cannot check in a cancelled person');
      }
      if (!person.atCamp) {
        throw new BadRequestError('Cannot check in a person who is not currently at camp');
      }
      const full: CheckInEntry = { ...entry, id: newId('ci') };
      const saved = await repo.save(withCheckIn(person, full, nowISO()));
      // NOT invalidated deliberately — see signEvent below.
      return saved;
    },

    async signEvent(actor, personId, event) {
      assertCan(actor, 'attendance:write');
      const person = await getOwned(actor, personId);
      const full: SignOutEvent = { ...event, id: newId('so') };
      const saved = await repo.save(withSignEvent(person, full, nowISO()));
      // ⚠ `invalidateDashboardCache()` is DELIBERATELY NOT called here or in `checkIn`.
      //
      // These two are the ONLY writes that fire in a burst: at a check-in window every
      // leader on every device taps through a roster at once. The cache is keyed on
      // (role, churchId, zone, genderScope) — NOT per device — so ~100 devices collapse to
      // ~30 distinct keys, roughly 4:1, which absorbs most of that burst. But
      // `invalidateDashboardCache()` wipes EVERY entry globally, so a single tap flushed
      // the cache for all 30 keys precisely while every device was loading `/home`,
      // driving the hit rate to ~0 at the worst possible moment.
      //
      // The cost of not invalidating is bounded by the 30s TTL: a "still to check in"
      // count can lag by up to 30 seconds. That is harmless — a leader mid-rush is on the
      // roster screen (which reads people directly and is always live), not the dashboard.
      // Every other writer still invalidates, so lifecycle/registration/settings edits —
      // which are not bursty — stay immediate.
      return saved;
    },

    async chase(actor) {
      assertCan(actor, 'reminder:send');
      const all = await repo.findAll();
      const results: ChaseResult[] = [];
      for (const p of all) {
        if (!isRegistrant(p)) continue;
        if (!canAccessPerson(actor, p)) continue;
        const unpaid = p.paymentStatus === 'unpaid';
        const noBlue = p.kind === 'leader' && p.blueCardNumber == null;
        if (unpaid || noBlue) {
          results.push({
            churchId: p.churchId,
            churchName: p.churchName,
            registrantId: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            reason: unpaid && noBlue ? 'both' : unpaid ? 'unpaid' : 'no_blue_card',
          });
        }
      }
      return results;
    },

    async breakdown(actor) {
      assertCan(actor, 'registrant:read');
      const all = await repo.findAll();
      const map = new Map<string, RegistrantBreakdown>();
      for (const p of all) {
        if (!isRegistrant(p)) continue;
        if (!canAccessPerson(actor, p)) continue;
        let entry = map.get(p.churchId);
        if (!entry) {
          entry = {
            churchId: p.churchId,
            churchName: p.churchName,
            zone: p.zone,
            total: 0,
            campers: 0,
            leaders: 0,
            unpaid: 0,
            depositPaid: 0,
            paid: 0,
            noBlueCard: 0,
          };
          map.set(p.churchId, entry);
        }
        entry.total++;
        if (p.kind === 'youth') entry.campers++;
        if (p.kind === 'leader') entry.leaders++;
        if (p.paymentStatus === 'unpaid') entry.unpaid++;
        if (p.paymentStatus === 'deposit') entry.depositPaid++;
        if (p.paymentStatus === 'paid') entry.paid++;
        if (p.kind === 'leader' && p.blueCardNumber == null) entry.noBlueCard++;
      }
      return Array.from(map.values()).sort((a, b) => a.zone.localeCompare(b.zone));
    },

    async remind(actor, ids) {
      assertCan(actor, 'reminder:send');
      if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestError('No IDs provided');
      let count = 0;
      for (const id of ids) {
        const p = await repo.findById(id);
        if (!p || !isRegistrant(p)) continue;
        if (!canAccessPerson(actor, p)) continue;
        count++;
      }
      return { sent: count };
    },

    async listMedicalWatch(actor) {
      assertCan(actor, 'camper:read');
      const all = await repo.findAll();
      return all.filter((p) => {
        if (!isCamper(p) || !p.atCamp) return false;
        if (!canAccessPerson(actor, p)) return false;
        return p.medicalConditions.length > 0 || p.otherMedications != null;
      });
    },
  };
}
