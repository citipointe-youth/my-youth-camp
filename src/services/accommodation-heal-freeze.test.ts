import { describe, it, expect } from 'vitest';
import {
  computeGroups, eligibleChurchIds, captureFreeze, healAllocations, effectiveAllocations,
  applyAllocationRequest, overCapacityRooms, tentDistribution,
  type AllocationOccupant, type AllocationMap, type EligibilityOptions, type ClassroomLike,
} from './accommodation-allocation';

const occ = (over: Partial<AllocationOccupant>): AllocationOccupant => ({
  churchId: 'c1', churchName: 'Victory', gender: 'male', kind: 'youth',
  accommodationKind: 'classroom', lifecycle: 'registered', grade: 8, ...over,
});
const many = (n: number, over: Partial<AllocationOccupant> = {}) => Array.from({ length: n }, () => occ(over));
const room = (id: string, capacity: number): ClassroomLike => ({ id, name: `Room ${id}`, capacity });

function freezeOf(people: AllocationOccupant[], opts?: EligibilityOptions) {
  const snap = captureFreeze(people, opts);
  const frozen: EligibilityOptions = { ...opts, frozen: { eligible: new Set(snap.eligibleChurchIds), shapes: snap.shapes } };
  const baselines = Object.fromEntries(computeGroups(people, frozen).map((g) => [g.key, g.n]));
  return { frozen, baselines };
}
const used = (m: AllocationMap, r: string) => (m[r] ?? []).reduce((s, e) => s + e.n, 0);

// ─────────────────────────────── Part 1: auto-heal ───────────────────────────────
describe('healAllocations', () => {
  it('a pool crossing 50 re-splits: the old whole-pool placement is dropped and reported', () => {
    const people = [...many(30, { grade: 8 }), ...many(21, { grade: 11 })]; // 51 → split
    const groups = computeGroups(people);
    expect(groups.map((g) => g.key).sort()).toEqual(['c1|male|10-12', 'c1|male|7-9']);
    const { map, healed } = healAllocations({ A: [{ key: 'c1|male', n: 20 }] }, {
      rooms: [room('A', 25)], groups, eligibleChurches: eligibleChurchIds(people), clamp: true,
    });
    expect(map).toEqual({});
    expect(healed).toEqual([{ roomId: 'A', roomName: 'Room A', key: 'c1|male', n: 20, reason: 'group re-split' }]);
  });

  it('shrinking back under 50 (un-split) drops bracket placements as a re-split', () => {
    const people = many(40, { grade: 8 });
    const { healed } = healAllocations({ A: [{ key: 'c1|male|7-9', n: 20 }] }, {
      rooms: [room('A', 25)], groups: computeGroups(people), eligibleChurches: eligibleChurchIds(people), clamp: true,
    });
    expect(healed[0]!.reason).toBe('group re-split');
  });

  it('a group shrinking below its placed count is clamped — over-capacity room first, then smallest', () => {
    const people = many(10);
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 8 }], B: [{ key: 'c1|male', n: 5 }] };
    const { map, healed } = healAllocations(stored, {
      rooms: [room('A', 6), room('B', 10)], groups: computeGroups(people), eligibleChurches: eligibleChurchIds(people), clamp: true,
    });
    // 13 placed, 10 live → 2 from A (8/6 is over), then 1 from the smaller placement (B 5 < A 6)
    expect(map).toEqual({ A: [{ key: 'c1|male', n: 6 }], B: [{ key: 'c1|male', n: 4 }] });
    expect(healed.every((h) => h.reason === 'group shrank')).toBe(true);
    expect(healed.reduce((s, h) => s + h.n, 0)).toBe(3);
  });

  it('a ministry dropping under 75% is reported as no longer eligible', () => {
    const people = [...many(2), ...many(6, { accommodationKind: 'tent' })];
    const { map, healed } = healAllocations({ A: [{ key: 'c1|male', n: 2 }] }, {
      rooms: [room('A', 25)], groups: computeGroups(people), eligibleChurches: eligibleChurchIds(people), clamp: true,
    });
    expect(map).toEqual({});
    expect(healed[0]!.reason).toBe('ministry no longer eligible');
  });

  it('a year-level group that empties while its siblings stay is "group shrank", not re-split', () => {
    const people = [...many(52, { grade: 8 }), ...many(10, { grade: 11 })]; // 7-9 → years; Y7/Y9 absent
    const groups = computeGroups(people);
    expect(groups.some((g) => g.key === 'c1|male|Y8')).toBe(true);
    const { healed } = healAllocations({ A: [{ key: 'c1|male|Y9', n: 3 }] }, {
      rooms: [room('A', 25)], groups, eligibleChurches: eligibleChurchIds(people), clamp: true,
    });
    expect(healed[0]!.reason).toBe('group shrank');
  });
});

describe('applyAllocationRequest (not frozen)', () => {
  const people = many(20);
  const base = { rooms: [room('A', 25), room('B', 25)], groups: computeGroups(people), eligibleChurches: eligibleChurchIds(people), baselines: null };

  it('stored staleness never fails a save: a stale entry resent unchanged is healed away', () => {
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 10 }, { key: 'GONE|male', n: 7 }] };
    const req: AllocationMap = { A: [{ key: 'c1|male', n: 10 }, { key: 'GONE|male', n: 7 }], B: [{ key: 'c1|male', n: 5 }] };
    const r = applyAllocationRequest(req, { ...base, stored });
    expect(r.map).toEqual({ A: [{ key: 'c1|male', n: 10 }], B: [{ key: 'c1|male', n: 5 }] });
    expect(r.healed.map((h) => h.key)).toEqual(['GONE|male']);
  });

  it('a stale screen resending an over-placed group (people cancelled since) is clamped, not rejected', () => {
    const smaller = many(15);
    const r = applyAllocationRequest({ A: [{ key: 'c1|male', n: 20 }] }, {
      ...base, groups: computeGroups(smaller), stored: { A: [{ key: 'c1|male', n: 20 }] },
    });
    expect(r.map).toEqual({ A: [{ key: 'c1|male', n: 15 }] });
  });

  it('still rejects genuinely invalid NEW requests', () => {
    expect(() => applyAllocationRequest({ Z: [{ key: 'c1|male', n: 1 }] }, { ...base, stored: {} })).toThrow(/unknown room/i);
    expect(() => applyAllocationRequest({ A: [{ key: 'NEW|male', n: 1 }] }, { ...base, stored: {} })).toThrow(/unknown group/i);
    expect(() => applyAllocationRequest({ A: [{ key: 'c1|male', n: 21 }] }, { ...base, rooms: [room('A', 99)], stored: {} })).toThrow(/more than available/i);
    expect(() => applyAllocationRequest({ A: [{ key: 'c1|male', n: 20 }] }, { ...base, rooms: [room('A', 10)], stored: {} })).toThrow(/capacity/i);
    const mixed = [...many(3), ...many(3, { gender: 'female' })];
    expect(() => applyAllocationRequest({ A: [{ key: 'c1|male', n: 1 }, { key: 'c1|female', n: 1 }] }, {
      ...base, groups: computeGroups(mixed), stored: {},
    })).toThrow(/single gender/i);
  });

  it('an already-over room may stay as it is but never grow', () => {
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 18 }] };
    const rooms = [room('A', 15), room('B', 25)];
    expect(() => applyAllocationRequest(stored, { ...base, rooms, stored })).not.toThrow();
    // an unrelated change elsewhere still saves
    expect(() => applyAllocationRequest({ A: [{ key: 'c1|male', n: 18 }], B: [{ key: 'c1|male', n: 2 }] }, { ...base, rooms, stored })).not.toThrow();
    expect(() => applyAllocationRequest({ A: [{ key: 'c1|male', n: 19 }] }, { ...base, rooms, stored })).toThrow(/capacity/i);
  });
});

// ─────────────────────────────── Part 2: soft freeze ───────────────────────────────
describe('soft freeze — grouping', () => {
  it('a 51st registrant while frozen does NOT re-split the pool', () => {
    const at = many(50);
    const { frozen } = freezeOf(at);
    expect(computeGroups([...at, occ({})], frozen).map((g) => g.key)).toEqual(['c1|male']);
    expect(computeGroups([...at, occ({})]).map((g) => g.key).sort()).toEqual(['c1|male|Y8']); // live rule would split (twice)
  });

  it('a split pool stays split while frozen even after shrinking under 50', () => {
    const at = [...many(30, { grade: 8 }), ...many(25, { grade: 11 })];
    const { frozen } = freezeOf(at);
    const keys = computeGroups([...many(20, { grade: 8 }), ...many(10, { grade: 11 })], frozen).map((g) => g.key).sort();
    expect(keys).toEqual(['c1|male|10-12', 'c1|male|7-9']);
  });

  it('a new registrant in a split pool joins their bracket', () => {
    const at = [...many(30, { grade: 8 }), ...many(25, { grade: 11 })];
    const { frozen } = freezeOf(at);
    const g = computeGroups([...at, occ({ grade: 12 })], frozen);
    expect(g.find((x) => x.key === 'c1|male|10-12')!.n).toBe(26);
  });

  it('a ministry that becomes eligible while frozen stays in tents; one that drops stays in classrooms', () => {
    const at = [...many(2, { churchId: 'new' }), ...many(6, { churchId: 'new', accommodationKind: 'tent' }), ...many(10, { churchId: 'old' })];
    const { frozen } = freezeOf(at);
    const later = [...many(20, { churchId: 'new' }), ...many(6, { churchId: 'new', accommodationKind: 'tent' }), ...many(10, { churchId: 'old' }), ...many(30, { churchId: 'old', accommodationKind: 'tent' })];
    const keys = computeGroups(later, frozen).map((g) => g.key);
    expect(keys).toEqual(['old|male']);
    const tents = tentDistribution(later, frozen);
    expect(tents.find((t) => t.churchId === 'new')!.m.stu).toBe(26);
    expect(tents.find((t) => t.churchId === 'old')!.m.stu).toBe(30);
  });
});

describe('soft freeze — effective placements', () => {
  it('+4 registrants into a single-room group reads 29/25 and is loud', () => {
    const at = many(25);
    const { frozen, baselines } = freezeOf(at);
    const rooms = [room('A', 25)];
    const eff = effectiveAllocations({ A: [{ key: 'c1|male', n: 25 }] }, { rooms, groups: computeGroups([...at, ...many(4)], frozen), baselines });
    expect(eff).toEqual({ A: [{ key: 'c1|male', n: 29 }] });
    expect(overCapacityRooms(eff, rooms)).toEqual([{ roomId: 'A', name: 'Room A', used: 29, capacity: 25, over: 4 }]);
  });

  it('only growth since the freeze counts — people unplaced at freeze time stay unplaced', () => {
    const at = many(30);
    const { frozen, baselines } = freezeOf(at);
    const eff = effectiveAllocations({ A: [{ key: 'c1|male', n: 25 }] }, { rooms: [room('A', 25)], groups: computeGroups([...at, ...many(2)], frozen), baselines });
    expect(eff.A![0]!.n).toBe(27);
  });

  it('a group split across rooms grows into the room with the most free space', () => {
    const at = many(30);
    const { frozen, baselines } = freezeOf(at);
    const rooms = [room('A', 20), room('B', 20)];
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 18 }], B: [{ key: 'c1|male', n: 12 }] };
    const eff = effectiveAllocations(stored, { rooms, groups: computeGroups([...at, ...many(6)], frozen), baselines });
    // B has 8 free vs A 2: B takes until tied at 2 free (6 people) → A 18, B 18
    expect([used(eff, 'A'), used(eff, 'B')]).toEqual([18, 18]);
  });

  it('once every room is full, the least-overfull takes the next; ties go to the first-placed room', () => {
    const at = many(40);
    const { frozen, baselines } = freezeOf(at);
    const rooms = [room('A', 20), room('B', 20)];
    const stored: AllocationMap = { B: [{ key: 'c1|male', n: 20 }], A: [{ key: 'c1|male', n: 20 }] };
    const eff = effectiveAllocations(stored, { rooms, groups: computeGroups([...at, ...many(3)], frozen), baselines });
    // B was placed first: tie → B (21/20), then A (21/20), then tie again → B (22/20)
    expect([used(eff, 'B'), used(eff, 'A')]).toEqual([22, 21]);
  });

  it('cancellation while frozen takes the place from the over-capacity room first, then the smallest placement', () => {
    const at = many(30);
    const { frozen, baselines } = freezeOf(at);
    const rooms = [room('A', 10), room('B', 30)];
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 12 }], B: [{ key: 'c1|male', n: 18 }] };
    const eff = effectiveAllocations(stored, { rooms, groups: computeGroups(many(27), frozen), baselines });
    // 3 go: 2 from A (12/10 is over), then the smaller placement (A 10 < B 18)
    expect([used(eff, 'A'), used(eff, 'B')]).toEqual([9, 18]);
  });

  it('a cancellation then a late registration re-absorbs the seat (effective depends only on the live count)', () => {
    const at = many(25);
    const { frozen, baselines } = freezeOf(at);
    const eff = effectiveAllocations({ A: [{ key: 'c1|male', n: 25 }] }, { rooms: [room('A', 25)], groups: computeGroups(many(25), frozen), baselines });
    expect(eff.A![0]!.n).toBe(25);
  });
});

describe('soft freeze — saves', () => {
  it('remove + re-add while frozen: normal placement, remainder unallocated, baseline reset', () => {
    const at = many(25);
    const { frozen, baselines } = freezeOf(at);
    const now = [...at, ...many(4)];                       // 29 live, 25 stored in A (cap 25)
    const groups = computeGroups(now, frozen);
    const ctx = { rooms: [room('A', 25)], groups, eligibleChurches: new Set(['c1']), baselines };
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 25 }] };
    const removed = applyAllocationRequest({}, { ...ctx, stored });
    expect(removed.map).toEqual({});
    expect(removed.baselines!['c1|male']).toBe(29);
    const readded = applyAllocationRequest({ A: [{ key: 'c1|male', n: 25 }] }, { ...ctx, stored: removed.map, baselines: removed.baselines });
    expect(readded.baselines!['c1|male']).toBe(29);
    // effective stays 25 — the 4 remain "to allocate"; a 30th registrant would now be absorbed
    expect(effectiveAllocations(readded.map, { rooms: ctx.rooms, groups, baselines: readded.baselines })).toEqual({ A: [{ key: 'c1|male', n: 25 }] });
    const later = computeGroups([...now, occ({})], frozen);
    expect(effectiveAllocations(readded.map, { rooms: ctx.rooms, groups: later, baselines: readded.baselines })).toEqual({ A: [{ key: 'c1|male', n: 26 }] });
  });

  it('an untouched over-capacity group does not block saving another group while frozen', () => {
    const at = [...many(25), ...many(5, { churchId: 'c2', churchName: 'Grace' })];
    const { frozen, baselines } = freezeOf(at);
    const groups = computeGroups([...at, ...many(4)], frozen);
    const stored: AllocationMap = { A: [{ key: 'c1|male', n: 25 }] };
    const r = applyAllocationRequest({ A: [{ key: 'c1|male', n: 25 }], B: [{ key: 'c2|male', n: 5 }] }, {
      rooms: [room('A', 25), room('B', 10)], groups, eligibleChurches: new Set(['c1', 'c2']), baselines, stored,
    });
    expect(r.touched).toEqual(['c2|male']);
    expect(r.baselines!['c1|male']).toBe(25);
  });

  it('unfreeze: writing the effective counts back keeps the overflow, and a later save does not fail', () => {
    const at = many(25);
    const { frozen, baselines } = freezeOf(at);
    const now = [...at, ...many(4)];
    const rooms = [room('A', 25), room('B', 10)];
    const eff = effectiveAllocations({ A: [{ key: 'c1|male', n: 25 }] }, { rooms, groups: computeGroups(now, frozen), baselines });
    const live = computeGroups(now);  // normal rules resume
    expect(() => applyAllocationRequest({ ...eff }, { rooms, groups: live, eligibleChurches: new Set(['c1']), baselines: null, stored: eff })).not.toThrow();
    // moving 4 out of A into B is fine; pushing A further is not
    expect(() => applyAllocationRequest({ A: [{ key: 'c1|male', n: 25 }], B: [{ key: 'c1|male', n: 4 }] }, {
      rooms, groups: live, eligibleChurches: new Set(['c1']), baselines: null, stored: eff,
    })).not.toThrow();
  });
});
