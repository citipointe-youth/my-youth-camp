import type { IPersonRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Person } from '../core/entities/person';
import { isCamper, isRegistrant } from '../core/entities/person';
import type { CheckInEntry, SignOutEvent } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { assertCan, canAccessChurch, canAccessPerson, isOversight } from './access-control';
import { NotFoundError, BadRequestError } from '../core/errors/app-error';
import { RegistrantPatchSchema } from '../core/validation';
import { ageFromDob, nowISO } from '../utils/date';
import { newId } from '../utils/id';
import { transition } from './presence';
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
  /**
   * PATCH /registrants/:id (A3): THE one interpreter of a wire body — legacy aliases (status,
   * medical, dietary, parentName, blueCardCollected, kind), then `update`. Unknown keys are
   * dropped. The church field strip and value checks live in `update`.
   */
  patch(actor: Actor, id: string, body: unknown): Promise<Person>;
  remove(actor: Actor, id: string): Promise<void>;
  /** Apply a check-in entry — first 'in' promotes registered → arrived (Day-1 sign-in). */
  checkIn(actor: Actor, personId: string, entry: Omit<CheckInEntry, 'id'>): Promise<Person>;
  /** Apply a sign-out/sign-in attendance event. */
  signEvent(actor: Actor, personId: string, event: Omit<SignOutEvent, 'id'>): Promise<Person>;
}

/** Moved to access-control.ts (A1); re-exported so existing importers keep working. */
export { canAccessPerson };

export function makePersonService(repo: IPersonRepository, settings?: ISettingsRepository): PersonService {
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

  const service: PersonService = {
    buildProfile,

    async list(actor, opts = {}) {
      assertCan(actor, 'camper:read');
      return scopedAll(actor, opts);
    },

    async listRegistrants(actor, churchId, opts = {}) {
      assertCan(actor, 'registrant:read');
      /* `includeCancelled` has three callers: the Budget screen, `RENDER.accom` (the
         accommodation export) and `_loadAllocation` (the Data Import screen). Cancelling must not
         silently drop a person's money or vanish them from these views (both isRegistrant and
         isCamper exclude cancelled), so all three see them; their value keeps counting until a
         Refund is recorded. Gated to director/admin, which is exactly who can open the budget and
         the Data Import screen, so a church login can never widen its own scope with a query param. */
      const includeCancelled = opts.includeCancelled === true
        && isOversight(actor);
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
      const ov = patch.accommodationOverride;
      if (ov !== undefined && ov !== null && ov !== 'tent' && ov !== 'classroom') {
        throw new BadRequestError('accommodationOverride must be tent, classroom or null');
      }
      for (const k of ['amountPaidOverride', 'refundAmount'] as const) {
        const v = patch[k];
        if (v !== undefined && v !== null && (!Number.isFinite(v) || v < 0)) {
          throw new BadRequestError(`${k} must be a non-negative number or null`);
        }
      }
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
      // 'registered' is only accepted as an uncancel: on anyone else it would be returned but not
      // written (a plain save keeps the stored lifecycle — gate B M1).
      const nextLifecycle =
        lifecycle === 'cancelled' || (lifecycle === 'registered' && existing.lifecycle === 'cancelled')
          ? lifecycle : existing.lifecycle;
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
      // A refund is money leaving — stamp when. Independent of cancel in both directions.
      const refundPatch: Partial<Person> =
        safeRest.refundAmount !== undefined && safeRest.refundAmount !== existing.refundAmount
          ? { refundedAt: safeRest.refundAmount == null ? null : nowISO() }
          : {};
      /* Cancel/uncancel go through the presence module (presence.ts): cancelling sets atCamp false
         + cancelledAt, and someone at camp is signed out first with one 'out' event (B-3). The moved
         presence fields are re-applied after the patch so a patched `cancelledAt` can't override them. */
      const now = nowISO();
      const moved = cancelling || unCancelling
        ? transition(existing, { kind: cancelling ? 'cancel' : 'uncancel' }, { actor, now })
        : null;
      const base = moved?.result === 'applied' ? moved.next : existing;
      const presencePatch: Partial<Person> = moved ? { atCamp: base.atCamp, cancelledAt: base.cancelledAt } : {};
      const updated: Person = { ...base, ...safeRest, ...rawPatch, ...presencePatch, ...refundPatch,
        id: existing.id, lifecycle: nextLifecycle, updatedAt: now };
      // Fail-closed: the patched result must still be inside the actor's scope (a zoneLeader/
      // admin/director changing church/zone can't push a person out of what they may access).
      if (!canAccessPerson(actor, updated)) {
        throw new BadRequestError('Cannot move a person outside your scope');
      }
      // B-1: only a cancel/uncancel moves presence; any other PATCH is a plain field write.
      const saved = await (cancelling || unCancelling ? repo.savePresence(updated) : repo.save(updated));
      invalidateDashboardCache();
      return saved;
    },

    async patch(actor, id, body) {
      const b = RegistrantPatchSchema.parse(body) as Record<string, unknown>;

      // Map blueCardCollected boolean ↔ blueCardNumber string.
      // If blueCardNumber is provided directly, it takes precedence.
      let blueCardNumber: string | null | undefined;
      if ('blueCardNumber' in b) {
        blueCardNumber = (b['blueCardNumber'] as string | null) ?? null;
      } else if ('blueCardCollected' in b) {
        const existing = await service.get(actor, id);
        blueCardNumber = b['blueCardCollected']
          ? (existing.blueCardNumber ?? 'collected')
          : null;
      }

      const patch: Partial<Person> = {
        ...(b['firstName'] !== undefined && { firstName: b['firstName'] as string }),
        ...(b['lastName'] !== undefined && { lastName: b['lastName'] as string }),
        ...(b['gender'] !== undefined && { gender: b['gender'] as Person['gender'] }),
        ...(b['kind'] !== undefined && { kind: b['kind'] === 'leader' ? 'leader' : 'youth' }),
        ...(b['grade'] !== undefined && { grade: b['grade'] as Person['grade'] }),
        // Church move (at-camp student edit): the SPA sends all three of churchId/churchName/zone
        // together from its /accounts/churches list so the denormalized snapshot stays consistent.
        ...(b['churchId'] !== undefined && { churchId: b['churchId'] as string }),
        ...(b['churchName'] !== undefined && { churchName: b['churchName'] as string }),
        ...(b['zone'] !== undefined && { zone: b['zone'] as string }),
        ...(b['paymentStatus'] !== undefined && { paymentStatus: b['paymentStatus'] as Person['paymentStatus'] }),
        ...(b['accommodationKind'] !== undefined && { accommodationKind: b['accommodationKind'] as Person['accommodationKind'] }),
        ...(b['accommodationLabel'] !== undefined && { accommodationLabel: b['accommodationLabel'] as string }),
        ...(b['mobile'] !== undefined && { mobile: b['mobile'] as string }),
        ...((b['parentGuardianName'] !== undefined || b['parentName'] !== undefined) && {
          parentGuardianName: ((b['parentGuardianName'] ?? b['parentName']) as string) ?? null,
        }),
        ...(b['parentPhone'] !== undefined && { parentPhone: b['parentPhone'] as string }),
        ...(b['blueCardExpiry'] !== undefined && { blueCardExpiry: b['blueCardExpiry'] as string }),
        // Map dietary/medical strings to arrays (legacy Registrant shape)
        ...(b['dietary'] !== undefined && {
          dietaryRequirements: b['dietary'] ? [b['dietary'] as string] : [],
        }),
        ...(b['medical'] !== undefined && {
          medicalConditions: b['medical'] ? [b['medical'] as string] : [],
        }),
        // Map status → lifecycle
        ...(b['status'] !== undefined && {
          lifecycle: b['status'] === 'cancelled' ? 'cancelled' : 'registered',
        }),
        ...(blueCardNumber !== undefined && { blueCardNumber }),
        // Ticket List / Invoice import fields — lets an admin manually clear
        // needsReview/needsReviewReason after reconciling an orphan, or hand-correct
        // ticketNumber/accommodationKindConfidence/the four money fields.
        ...(b['ticketNumber'] !== undefined && { ticketNumber: b['ticketNumber'] as string | null }),
        ...(b['invoiceNumber'] !== undefined && { invoiceNumber: b['invoiceNumber'] as string | null }),
        ...(b['accommodationKindConfidence'] !== undefined && {
          accommodationKindConfidence: b['accommodationKindConfidence'] as Person['accommodationKindConfidence'],
        }),
        /* Individual overrides (0022, Data Import). `null` is a meaningful value for all three
           (clear the override / clear the refund), so these test `!== undefined`, matching every
           other entry here. No importer can reach this path. */
        ...(b['accommodationOverride'] !== undefined && {
          accommodationOverride: b['accommodationOverride'] as Person['accommodationOverride'],
        }),
        ...(b['amountPaidOverride'] !== undefined && {
          amountPaidOverride: b['amountPaidOverride'] == null ? null : Number(b['amountPaidOverride']),
        }),
        ...(b['refundAmount'] !== undefined && {
          refundAmount: b['refundAmount'] == null ? null : Number(b['refundAmount']),
        }),
        ...(b['discountAmount'] !== undefined && { discountAmount: b['discountAmount'] as number | null }),
        ...(b['amountPaid'] !== undefined && { amountPaid: b['amountPaid'] as number | null }),
        ...(b['feesAmount'] !== undefined && { feesAmount: b['feesAmount'] as number | null }),
        ...(b['taxAmount'] !== undefined && { taxAmount: b['taxAmount'] as number | null }),
        ...(b['needsReview'] !== undefined && { needsReview: b['needsReview'] as boolean }),
        ...(b['needsReviewReason'] !== undefined && { needsReviewReason: b['needsReviewReason'] as string | null }),
      };

      return service.update(actor, id, patch);
    },

    async remove(actor, id) {
      assertCan(actor, 'person:delete');
      await getOwned(actor, id);
      await repo.delete(id);
      invalidateDashboardCache();
    },

    async checkIn(actor, personId, entry) {
      assertCan(actor, 'checkin:write');
      const person = await getOwned(actor, personId);
      // ⚠ Queue path: the two refusals and their messages are frozen in presence.ts.
      const o = transition(person, { kind: 'checkIn', entry: { ...entry, id: newId('ci') } }, { actor, now: nowISO() });
      if (o.result === 'refused') throw new BadRequestError(o.reason);
      // An N5 replay is a no-op: nothing is written and the endpoint still answers 200.
      if (o.result === 'noop') return person;
      // NOT invalidated deliberately — see signEvent below.
      return repo.save(o.next);
    },

    async signEvent(actor, personId, event) {
      assertCan(actor, 'attendance:write');
      const person = await getOwned(actor, personId);
      // QA item 21's pre-camp rule only concerns sign-ins (non-director/admin), so settings is read
      // only for those. The rule itself and B-2's cancelled refusal live in presence.ts.
      const campMode = event.type === 'in' && !isOversight(actor)
        ? (await settings?.getSingleton())?.campMode : undefined;
      const o = transition(person, { kind: event.type === 'in' ? 'signIn' : 'signOut', event: { ...event, id: newId('so') } },
        { actor, campMode, now: nowISO() });
      if (o.result === 'refused') throw new BadRequestError(o.reason);
      // A no-op writes nothing: re-saving this read with presence could revert a concurrent sign.
      if (o.result === 'noop') return person;
      const saved = await repo.savePresence(o.next);
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
  };
  return service;
}
