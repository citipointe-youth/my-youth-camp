import type {
  IClassroomRepository, IAllocationRepository, IChurchRepository,
  ISettingsRepository, IPersonRepository, IClassroomFreezeRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Classroom, RoomAllocation, AllocationGender, AllocationBracket, ClassroomFreeze } from '../core/entities/accommodation';
import { CLASSROOM_FREEZE_ID } from '../core/entities/accommodation';
import type { Actor } from '../core/entities/user';
import type { Church } from '../core/entities/church';
import { assertCan, assertCanAccessChurch } from './access-control';
import { BadRequestError, ForbiddenError, NotFoundError } from '../core/errors/app-error';
import { CreateClassroomSchema, UpdateClassroomSchema, SetAllocationsSchema, SetPerRegistrationSchema, SetSoftFreezeSchema } from '../core/validation/accommodation.schema';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { UNALLOCATED_CHURCH_ID } from './church-allocation';
import { ResponseCache } from '../utils/response-cache';
import {
  computeGroups, eligibleChurchIds, captureFreeze, healAllocations, effectiveAllocations,
  applyAllocationRequest, AllocationRequestError,
  type AllocationOccupant, type AllocationGroup, type AllocationMap, type EligibilityOptions, type HealNote,
} from './accommodation-allocation';

export interface ChurchRooms {
  rooms: Array<{ name: string; gender: AllocationGender; n: number }>;
}

/** What the allocations screen needs (GET /accommodation/state, and every write's response). */
export interface AccommodationState {
  /** Stored placements with stale entries removed (and, when not frozen, over-placed groups
   *  trimmed). Reads never write — a heal is persisted by the next save. */
  stored: AllocationMap;
  /** What people actually get: `stored` plus soft-freeze absorption. Equal to `stored` when
   *  not frozen. */
  effective: AllocationMap;
  /** Stale placements that were (or, on a read, would be) cleared, and why. */
  healed: Array<HealNote & { groupLabel: string }>;
  freeze: ClassroomFreeze | null;
}

export interface AccommodationService {
  listClassrooms(actor: Actor): Promise<Classroom[]>;
  createClassroom(actor: Actor, input: unknown): Promise<Classroom>;
  updateClassroom(actor: Actor, id: string, input: unknown): Promise<Classroom>;
  deleteClassroom(actor: Actor, id: string): Promise<void>;
  listGroups(actor: Actor): Promise<AllocationGroup[]>;
  getAllocations(actor: Actor): Promise<AllocationMap>;
  setAllocations(actor: Actor, input: unknown): Promise<AllocationMap>;
  getChurchRooms(actor: Actor, churchId: string): Promise<ChurchRooms>;
  setPerRegistration(actor: Actor, churchId: string, input: unknown): Promise<Church>;
  getState(actor: Actor): Promise<AccommodationState>;
  /** PATCH /accommodation/allocations — same as setAllocations, reporting what was healed. */
  saveAllocations(actor: Actor, input: unknown): Promise<AccommodationState>;
  setSoftFreeze(actor: Actor, input: unknown): Promise<AccommodationState>;
}

export function makeAccommodationService(
  classroomRepo: IClassroomRepository,
  allocationRepo: IAllocationRepository,
  churchRepo: IChurchRepository,
  settingsRepo: ISettingsRepository,
  personRepo: IPersonRepository,
  // Soft freeze (2026-09-24). Optional so unit tests that predate it build unchanged; without it
  // the camp is never frozen and toggling the freeze is refused.
  freezeRepo?: IClassroomFreezeRepository,
): AccommodationService {
  // getChurchRooms runs on every church login's at-camp home and needs the whole people table to
  // compute effective counts (rooms are shared across churches). One computation per 30s per warm
  // instance; every write in this service clears it.
  const effectiveCache = new ResponseCache<AllocationMap>(30_000);

  async function assertNotLocked(actor: Actor): Promise<void> {
    if (actor.role === 'admin') return;
    const s = await settingsRepo.getSingleton();
    if (s?.accommodationLocked) throw new ForbiddenError('Accommodation is locked. Contact admin to make changes.');
  }

  function assertDirectorOrAdmin(actor: Actor): void {
    if (actor.role !== 'admin' && actor.role !== 'director') {
      throw new ForbiddenError('Allocations are managed by directors and admins only');
    }
  }

  async function occupants(): Promise<AllocationOccupant[]> {
    // Unallocated (sentinel) people have no real church — exclude them from accommodation grouping.
    const people = (await personRepo.findAll()).filter((p) => p.churchId !== UNALLOCATED_CHURCH_ID);
    return people.map((p) => ({
      churchId: p.churchId ?? '',
      churchName: p.churchName,
      gender: p.gender,
      kind: p.kind,
      accommodationKind: p.accommodationKind ?? null,
      lifecycle: p.lifecycle ?? null,
      grade: p.grade ?? null,   // PC-10: needed for the >50 grade-bracket split
    }));
  }

  async function getFreeze(): Promise<ClassroomFreeze | null> {
    return freezeRepo ? freezeRepo.findById(CLASSROOM_FREEZE_ID) : null;
  }

  async function eligibilityOptions(freeze?: ClassroomFreeze | null): Promise<EligibilityOptions> {
    const churches = await churchRepo.findAll();
    const opts: EligibilityOptions = { perRegistration: new Set(churches.filter((c) => c.accommodationPerRegistration).map((c) => c.id)) };
    const f = freeze === undefined ? await getFreeze() : freeze;
    if (f) opts.frozen = { eligible: new Set(f.eligibleChurchIds), shapes: f.shapes };
    return opts;
  }

  /** Everything the allocation rules need, loaded once. */
  async function context() {
    const [freeze, rooms, rows, occ] = await Promise.all([getFreeze(), classroomRepo.findAll(), allocationRepo.findAll(), occupants()]);
    const opts = await eligibilityOptions(freeze);
    const groups = computeGroups(occ, opts);
    return { freeze, rooms, stored: rowsToMap(rows), occ, opts, groups, eligible: eligibleChurchIds(occ, opts) };
  }
  type Ctx = Awaited<ReturnType<typeof context>>;

  function groupLabel(key: string, ctx: Ctx, churchNames: Map<string, string>): string {
    const [churchId = '', gender = '', bracket] = key.split('|');
    const g = ctx.groups.find((x) => x.key === key);
    const church = g?.church ?? ctx.occ.find((o) => o.churchId === churchId)?.churchName ?? churchNames.get(churchId) ?? churchId;
    const who = gender === 'male' ? 'Guys' : 'Girls';
    const b = !bracket ? '' : bracket.startsWith('Y') ? ` Yr ${bracket.slice(1)}` : ` Yr ${bracket.replace('-', '–')}`;
    return `${church} — ${who}${b}`;
  }

  async function stateFrom(ctx: Ctx, stored: AllocationMap, healed: HealNote[], freeze: ClassroomFreeze | null): Promise<AccommodationState> {
    const effective = effectiveAllocations(stored, { rooms: ctx.rooms, groups: ctx.groups, baselines: freeze?.baselines ?? null });
    const names = healed.length ? new Map((await churchRepo.findAll()).map((c) => [c.id, c.name])) : new Map<string, string>();
    return { stored, effective, healed: healed.map((h) => ({ ...h, groupLabel: groupLabel(h.key, ctx, names) })), freeze };
  }

  /** Replace every placement row with `map`, preserving its order in `seq`. */
  async function persistMap(map: AllocationMap): Promise<void> {
    await allocationRepo.deleteAll();
    let seq = 0;
    for (const [roomId, entries] of Object.entries(map)) {
      for (const e of entries) {
        if (e.n <= 0) continue;
        // C-1: parse ALL key parts. A split sub-pool sends a 3-part key (`churchId|gender|bracket`);
        // dropping the bracket made split allocations un-persistable.
        const [churchId, gender, bracket] = e.key.split('|') as [string, AllocationGender, AllocationBracket?];
        await allocationRepo.save({ id: newId('alloc'), roomId, churchId, gender, n: e.n, bracket: bracket ?? null, seq: seq++ });
      }
    }
    effectiveCache.invalidateAll();
  }

  async function readState(): Promise<AccommodationState> {
    const ctx = await context();
    const { map, healed } = healAllocations(ctx.stored, {
      rooms: ctx.rooms, groups: ctx.groups, eligibleChurches: ctx.eligible, clamp: !ctx.freeze,
    });
    return stateFrom(ctx, map, healed, ctx.freeze);
  }

  async function applySave(actor: Actor, input: unknown): Promise<AccommodationState> {
    assertDirectorOrAdmin(actor);
    await assertNotLocked(actor);
    const { allocations } = SetAllocationsSchema.parse(input);
    const ctx = await context();
    let result: ReturnType<typeof applyAllocationRequest>;
    try {
      result = applyAllocationRequest(allocations, {
        stored: ctx.stored, rooms: ctx.rooms, groups: ctx.groups, eligibleChurches: ctx.eligible,
        baselines: ctx.freeze?.baselines ?? null,
      });
    } catch (e) {
      // These used to escape as a plain Error → a generic 500 the director could do nothing with.
      if (e instanceof AllocationRequestError) throw new BadRequestError(e.message);
      throw e;
    }
    await persistMap(result.map);
    let freeze = ctx.freeze;
    if (freeze && freezeRepo && result.baselines) {
      freeze = await freezeRepo.save({ ...freeze, baselines: result.baselines });
    }
    return stateFrom(ctx, result.map, result.healed, freeze);
  }

  // The group key a stored row belongs to (C-1: split sub-pools carry a bracket → 3-part key).
  function keyOf(r: RoomAllocation): string {
    return r.bracket ? `${r.churchId}|${r.gender}|${r.bracket}` : `${r.churchId}|${r.gender}`;
  }

  function rowsToMap(rows: readonly RoomAllocation[]): AllocationMap {
    const map: AllocationMap = {};
    for (const r of rows) {
      const key = keyOf(r);
      (map[r.roomId] ??= []).push({ key, n: r.n });
    }
    return map;
  }

  return {
    async listClassrooms(actor) {
      assertCan(actor, 'registrant:read');
      return (await classroomRepo.findAll()).sort((a, b) => a.name.localeCompare(b.name));
    },

    async createClassroom(actor, input) {
      assertCan(actor, 'admin:manage');
      await assertNotLocked(actor);
      const data = CreateClassroomSchema.parse(input);
      const now = nowISO();
      effectiveCache.invalidateAll();
      return classroomRepo.save({ id: newId('room'), name: data.name, capacity: data.capacity, createdAt: now, updatedAt: now });
    },

    async updateClassroom(actor, id, input) {
      assertCan(actor, 'admin:manage');
      await assertNotLocked(actor);
      const existing = await classroomRepo.findById(id);
      if (!existing) throw new NotFoundError('Classroom not found');
      const data = UpdateClassroomSchema.parse(input);
      effectiveCache.invalidateAll();
      return classroomRepo.save({ ...existing, ...data, id: existing.id, updatedAt: nowISO() });
    },

    async deleteClassroom(actor, id) {
      assertCan(actor, 'admin:manage');
      await assertNotLocked(actor);
      const ok = await classroomRepo.delete(id);
      if (!ok) throw new NotFoundError('Classroom not found');
      // Cascade: drop its allocation rows (in-memory has no FK cascade).
      const rows = await allocationRepo.findByRoom(id);
      for (const r of rows) await allocationRepo.delete(r.id);
      effectiveCache.invalidateAll();
    },

    async listGroups(actor) {
      assertDirectorOrAdmin(actor);
      return computeGroups(await occupants(), await eligibilityOptions());
    },

    async getAllocations(actor) {
      assertDirectorOrAdmin(actor);
      assertDirectorOrAdmin(actor);
      return (await readState()).stored;
    },

    async getState(actor) {
      assertDirectorOrAdmin(actor);
      return readState();
    },

    async saveAllocations(actor, input) {
      return applySave(actor, input);
    },

    async setSoftFreeze(actor, input) {
      assertDirectorOrAdmin(actor);
      await assertNotLocked(actor);
      const { frozen } = SetSoftFreezeSchema.parse(input);
      if (!freezeRepo) throw new BadRequestError('Soft freeze is not available');
      const ctx = await context();
      if (frozen) {
        if (ctx.freeze) return readState();
        // Freeze from a clean slate: persist the ordinary heal first, so the baselines describe
        // placements that are actually valid right now.
        const { map, healed } = healAllocations(ctx.stored, {
          rooms: ctx.rooms, groups: ctx.groups, eligibleChurches: ctx.eligible, clamp: true,
        });
        if (healed.length) await persistMap(map);
        const snap = captureFreeze(ctx.occ, ctx.opts);
        const freeze = await freezeRepo.save({
          id: CLASSROOM_FREEZE_ID, frozenAt: nowISO(), frozenBy: actor.displayName ?? '',
          eligibleChurchIds: snap.eligibleChurchIds, shapes: snap.shapes,
          baselines: Object.fromEntries(ctx.groups.map((g) => [g.key, g.n])),
        });
        effectiveCache.invalidateAll();
        return stateFrom(ctx, map, healed, freeze);
      }
      if (!ctx.freeze) return readState();
      // Unfreeze: what people actually got becomes what is stored. Rooms keep any overflow — the
      // save rule lets an over-capacity room stay as it is, never grow.
      const { map: healedMap, healed } = healAllocations(ctx.stored, {
        rooms: ctx.rooms, groups: ctx.groups, eligibleChurches: ctx.eligible, clamp: false,
      });
      const effective = effectiveAllocations(healedMap, { rooms: ctx.rooms, groups: ctx.groups, baselines: ctx.freeze.baselines });
      await persistMap(effective);
      await freezeRepo.delete(CLASSROOM_FREEZE_ID);
      const labelled = (await stateFrom(ctx, effective, healed, null)).healed;
      const after = await readState();
      return { ...after, healed: [...labelled, ...after.healed] };
    },

    async setAllocations(actor, input) {
      return (await applySave(actor, input)).stored;
    },

    async setPerRegistration(actor, churchId, input) {
      assertDirectorOrAdmin(actor);
      await assertNotLocked(actor);
      const { perRegistration } = SetPerRegistrationSchema.parse(input);
      if (await getFreeze()) {
        throw new BadRequestError('Classrooms are soft-frozen — a ministry cannot gain or lose classroom eligibility until the freeze is turned off.');
      }
      const church = await churchRepo.findById(churchId);
      if (!church) throw new NotFoundError('Church not found');
      const saved = await churchRepo.save({ ...church, accommodationPerRegistration: perRegistration, updatedAt: nowISO() });
      if (!perRegistration) {
        // Switching back can make this church's classroom groups disappear. setAllocations
        // replaces the WHOLE map and rejects any unknown group key, so an orphaned row left
        // here would make every later save on the screen fail. Drop only rows whose group no
        // longer exists — a church that clears 75% on its own keeps its placements.
        const live = new Set(computeGroups(await occupants(), await eligibilityOptions()).map((g) => g.key));
        for (const r of await allocationRepo.findAll()) {
          if (r.churchId === churchId && !live.has(keyOf(r))) await allocationRepo.delete(r.id);
        }
      }
      effectiveCache.invalidateAll();
      return saved;
    },

    async getChurchRooms(actor, churchId) {
      const church = await churchRepo.findById(churchId);
      if (!church) throw new NotFoundError('Church not found');
      assertCanAccessChurch(actor, churchId, church.zone);
      // EFFECTIVE counts (soft-freeze absorption included, stale placements excluded) — a church
      // must see where its people actually sleep, not a stored count that no longer applies.
      let effective = effectiveCache.get('all');
      if (!effective) {
        const ctx = await context();
        const { map } = healAllocations(ctx.stored, { rooms: ctx.rooms, groups: ctx.groups, eligibleChurches: ctx.eligible, clamp: !ctx.freeze });
        effective = effectiveAllocations(map, { rooms: ctx.rooms, groups: ctx.groups, baselines: ctx.freeze?.baselines ?? null });
        effectiveCache.set('all', effective);
      }
      const rooms = await classroomRepo.findAll();
      const nameById = new Map(rooms.map((r) => [r.id, r.name]));
      const out: ChurchRooms['rooms'] = [];
      for (const [roomId, entries] of Object.entries(effective)) {
        for (const e of entries) {
          const [cid, gender] = e.key.split('|') as [string, AllocationGender];
          if (cid === churchId && e.n > 0) out.push({ name: nameById.get(roomId) ?? 'Room', gender, n: e.n });
        }
      }
      return { rooms: out };
    },
  };
}
