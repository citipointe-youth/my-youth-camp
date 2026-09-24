export type AllocationGender = 'male' | 'female';

export interface AllocationOccupant {
  churchId: string;
  churchName: string;
  gender: string;                 // 'male' | 'female' | other
  kind: string;                   // 'youth' | 'leader'
  accommodationKind?: string | null; // 'tent' | 'classroom' | null
  lifecycle?: string | null;      // 'cancelled' excluded
  grade?: number | null;          // PC-10: school grade (7..12), null for leaders
}

/**
 * PC-10: school-grade bracket for the large-pool split.
 *
 * Bug 5 (2026-07-28) added a SECOND level: a bracket sub-pool that is itself over
 * SPLIT_THRESHOLD splits again into single year levels (`'Y7'`…`'Y12'`), so a very large
 * ministry gets up to 6 pools per gender (12 per church) instead of two oversized ones.
 * The value is persisted verbatim in `classroom_allocations.bracket` (a text column), so
 * widening the union needs no migration.
 */
export type GradeBracket = '7-9' | '10-12' | 'Y7' | 'Y8' | 'Y9' | 'Y10' | 'Y11' | 'Y12';
const YEARS_IN_BRACKET: Record<'7-9' | '10-12', readonly number[]> = {
  '7-9': [7, 8, 9],
  '10-12': [10, 11, 12],
};

export interface AllocationGroup {
  key: string;        // `${churchId}|${gender}` or, when split, `${churchId}|${gender}|${bracket}`
  churchId: string;
  church: string;
  gender: AllocationGender;
  n: number;
  bracket?: GradeBracket;  // present only on split sub-pools (PC-10)
}

// PC-10: a church×gender classroom pool larger than this splits into 7-9 / 10-12 sub-pools.
export const SPLIT_THRESHOLD = 50;

export function bracketOfGrade(grade: number | null | undefined): '7-9' | '10-12' | null {
  if (grade == null) return null;
  if (grade >= 7 && grade <= 9) return '7-9';
  if (grade >= 10 && grade <= 12) return '10-12';
  return null;
}
/** Human label for a group key's bracket segment (used by the allocation UIs). */
export function bracketLabel(b: GradeBracket | undefined): string {
  if (!b) return '';
  return b.startsWith('Y') ? `Year ${b.slice(1)}` : `Years ${b}`;
}

export interface ClassroomLike { id: string; name: string; capacity: number }
export interface AllocEntry { key: string; n: number }
export type AllocationMap = Record<string, AllocEntry[]>;

export const ELIGIBLE_RATIO = 0.75;
export const TENT_SIZE = 7;

// Churches whose accommodation is "left to per-registration" (owner, 2026-09-24): they skip the
// 75% bar, so each person sleeps where they registered — classroom-kind people get classroom
// groups, tent-kind people stay in tents. Omit it and the rule is exactly the 75% bar.
export interface EligibilityOptions {
  perRegistration?: ReadonlySet<string>;
  /** Soft freeze (2026-09-24): when present, eligibility and pool shape come from this
   *  snapshot instead of the live numbers — nothing re-splits, un-splits, gains or loses
   *  classroom eligibility while frozen. */
  frozen?: FrozenShape;
}

/** How a church×gender pool is split. `split:false` = one group; otherwise 7-9 / 10-12 brackets,
 *  each of which may itself be split into single year levels. JSON-safe (stored in the freeze). */
export interface PoolShape { split: boolean; years79?: boolean; years1012?: boolean }
export interface FrozenShape {
  eligible: ReadonlySet<string>;
  /** keyed `${churchId}|${gender}`; a pool missing here (it had no classroom people at freeze
   *  time) is one unsplit group. */
  shapes: Readonly<Record<string, PoolShape>>;
}

// Per church×gender classroom tally, broken down by grade bracket + leader count, so a
// pool over SPLIT_THRESHOLD can be split into 7-9 / 10-12 sub-pools (PC-10).
interface GenderTally {
  cls: number;          // total classroom-kind people of this gender (youth + leaders)
  youth79: number;      // classroom youth in grades 7-9
  youth1012: number;    // classroom youth in grades 10-12
  youthOther: number;   // classroom youth with no/unknown grade (kept with 7-9 when splitting)
  leaders: number;      // classroom leaders (no grade)
  byYear: Map<number, number>; // classroom youth per single year level (bug 5, second-level split)
}
interface ChurchTally {
  id: string; name: string; total: number; classroom: number;
  male: GenderTally; female: GenderTally;
}

function newGender(): GenderTally { return { cls: 0, youth79: 0, youth1012: 0, youthOther: 0, leaders: 0, byYear: new Map() }; }

// A church qualifies for classroom groups only once 75%+ of its (non-cancelled) people are
// classroom-kind. Below that, its classroom-kind people have no room to be placed in — see
// `tentDistribution`, which folds them into the tent counts instead of leaving them uncounted.
// A church flagged "left to per-registration" (`opts.perRegistration`) skips the bar entirely —
// each person sleeps where they registered, classroom or tent, regardless of the church's ratio.
function isEligible(c: Pick<ChurchTally, 'id' | 'total' | 'classroom'>, opts?: EligibilityOptions): boolean {
  if (opts?.frozen) return opts.frozen.eligible.has(c.id);
  if (opts?.perRegistration?.has(c.id)) return true;
  return c.total > 0 && c.classroom / c.total >= ELIGIBLE_RATIO;
}

function tallyChurches(occupants: readonly AllocationOccupant[]): Map<string, ChurchTally> {
  const by = new Map<string, ChurchTally>();
  for (const o of occupants) {
    if (o.lifecycle === 'cancelled') continue;
    let c = by.get(o.churchId);
    if (!c) {
      c = { id: o.churchId, name: o.churchName, total: 0, classroom: 0, male: newGender(), female: newGender() };
      by.set(o.churchId, c);
    }
    c.total++;
    if (o.accommodationKind === 'classroom') {
      c.classroom++;
      const g = o.gender === 'male' ? c.male : c.female;
      g.cls++;
      if (o.kind === 'leader') g.leaders++;
      else {
        const b = bracketOfGrade(o.grade);
        if (b === '7-9') g.youth79++;
        else if (b === '10-12') g.youth1012++;
        else g.youthOther++;
        if (b != null && o.grade != null) g.byYear.set(o.grade, (g.byYear.get(o.grade) ?? 0) + 1);
      }
    }
  }
  return by;
}

// Build the group(s) for one church×gender classroom pool. A pool with >SPLIT_THRESHOLD
// people splits into two grade-bracket sub-pools (7-9 / 10-12); that gender's leaders divide
// evenly across the two (odd leader → the extra goes to 7-9). Youth with no/unknown grade ride
// with the 7-9 bracket. A pool at or below the threshold stays one group with the original key.
// Split `total` leaders as evenly as possible across `n` buckets; any remainder goes to the
// EARLIEST buckets (matching the pre-existing "odd leader → 7-9" behaviour).
function spreadLeaders(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  let extra = total % n;
  return Array.from({ length: n }, () => base + (extra-- > 0 ? 1 : 0));
}

// Bug 5 (2026-07-28): a bracket sub-pool that is ITSELF over SPLIT_THRESHOLD splits again into
// single year levels. Youth with no/unknown grade ride with the bracket's lowest year (they
// already rode with the 7-9 bracket before this change). That gender's leaders re-spread evenly
// across whichever year levels actually have people.
function yearGroupsFor(
  c: ChurchTally, gender: AllocationGender, g: GenderTally,
  bracket: '7-9' | '10-12', leaders: number, extraYouth: number,
): AllocationGroup[] {
  const base = { churchId: c.id, church: c.name, gender };
  const years = YEARS_IN_BRACKET[bracket].filter((y, i) => (g.byYear.get(y) ?? 0) > 0 || (i === 0 && extraYouth > 0));
  if (years.length === 0) return [];
  const ld = spreadLeaders(leaders, years.length);
  const out: AllocationGroup[] = [];
  years.forEach((y, i) => {
    const n = (g.byYear.get(y) ?? 0) + (i === 0 ? extraYouth : 0) + ld[i]!;
    if (n > 0) {
      const b = `Y${y}` as GradeBracket;
      out.push({ key: `${c.id}|${gender}|${b}`, ...base, n, bracket: b });
    }
  });
  return out;
}

// Today's split rule, as data: over SPLIT_THRESHOLD → 7-9 / 10-12 brackets (odd leader → 7-9,
// unknown-grade youth ride with 7-9); a bracket itself over the threshold → single year levels.
function naturalShape(g: GenderTally): PoolShape {
  if (g.cls <= SPLIT_THRESHOLD) return { split: false };
  const ld79 = Math.ceil(g.leaders / 2);
  const n79 = g.youth79 + g.youthOther + ld79;
  const n1012 = g.youth1012 + (g.leaders - ld79);
  return { split: true, years79: n79 > SPLIT_THRESHOLD, years1012: n1012 > SPLIT_THRESHOLD };
}

function groupsForGender(
  c: ChurchTally, gender: AllocationGender, g: GenderTally, shape?: PoolShape,
): AllocationGroup[] {
  if (g.cls === 0) return [];
  const base = { churchId: c.id, church: c.name, gender };
  const s = shape ?? naturalShape(g);
  if (!s.split) {
    return [{ key: `${c.id}|${gender}`, ...base, n: g.cls }];
  }
  const ld79 = Math.ceil(g.leaders / 2);   // odd leader → 7-9
  const ld1012 = g.leaders - ld79;
  const n79 = g.youth79 + g.youthOther + ld79;
  const n1012 = g.youth1012 + ld1012;
  const out: AllocationGroup[] = [];
  // Each bracket is emitted as ONE group unless its shape says year levels (bug 5: a bracket
  // over the threshold; while frozen, whatever it was at freeze time).
  if (n79 > 0) {
    if (s.years79) out.push(...yearGroupsFor(c, gender, g, '7-9', ld79, g.youthOther));
    else out.push({ key: `${c.id}|${gender}|7-9`, ...base, n: n79, bracket: '7-9' });
  }
  if (n1012 > 0) {
    if (s.years1012) out.push(...yearGroupsFor(c, gender, g, '10-12', ld1012, 0));
    else out.push({ key: `${c.id}|${gender}|10-12`, ...base, n: n1012, bracket: '10-12' });
  }
  return out;
}

function frozenShapeFor(opts: EligibilityOptions | undefined, churchId: string, gender: AllocationGender): PoolShape | undefined {
  if (!opts?.frozen) return undefined;
  return opts.frozen.shapes[`${churchId}|${gender}`] ?? { split: false };
}

export function computeGroups(occupants: readonly AllocationOccupant[], opts?: EligibilityOptions): AllocationGroup[] {
  const groups: AllocationGroup[] = [];
  for (const c of tallyChurches(occupants).values()) {
    if (!isEligible(c, opts)) continue;
    groups.push(...groupsForGender(c, 'male', c.male, frozenShapeFor(opts, c.id, 'male')));
    groups.push(...groupsForGender(c, 'female', c.female, frozenShapeFor(opts, c.id, 'female')));
  }
  return groups;
}

/** Church ids that currently qualify for classroom groups (75% / per-registration / frozen). */
export function eligibleChurchIds(occupants: readonly AllocationOccupant[], opts?: EligibilityOptions): Set<string> {
  const out = new Set<string>();
  for (const c of tallyChurches(occupants).values()) if (isEligible(c, opts)) out.add(c.id);
  return out;
}

/** Snapshot taken when the soft freeze is pressed: who is eligible and how each pool is split,
 *  evaluated with the LIVE rules (pass options without `frozen`). */
export function captureFreeze(
  occupants: readonly AllocationOccupant[], opts?: EligibilityOptions,
): { eligibleChurchIds: string[]; shapes: Record<string, PoolShape> } {
  const live: EligibilityOptions | undefined = opts ? { perRegistration: opts.perRegistration } : undefined;
  const eligible: string[] = [];
  const shapes: Record<string, PoolShape> = {};
  for (const c of tallyChurches(occupants).values()) {
    if (!isEligible(c, live)) continue;
    eligible.push(c.id);
    if (c.male.cls > 0) shapes[`${c.id}|male`] = naturalShape(c.male);
    if (c.female.cls > 0) shapes[`${c.id}|female`] = naturalShape(c.female);
  }
  return { eligibleChurchIds: eligible, shapes };
}

export function tallyAllocated(map: AllocationMap): Map<string, number> {
  const t = new Map<string, number>();
  for (const entries of Object.values(map)) {
    for (const e of entries) t.set(e.key, (t.get(e.key) ?? 0) + e.n);
  }
  return t;
}

function genderOfKey(key: string): string { return key.split('|')[1] ?? ''; }

export function validateAllocations(
  map: AllocationMap,
  ctx: { rooms: readonly ClassroomLike[]; groups: readonly AllocationGroup[] },
): void {
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r]));
  const groupByKey = new Map(ctx.groups.map((g) => [g.key, g]));
  for (const [roomId, entries] of Object.entries(map)) {
    const room = roomById.get(roomId);
    if (!room) throw new Error(`Unknown room: ${roomId}`);
    let used = 0;
    const genders = new Set<string>();
    for (const e of entries) {
      if (e.n <= 0) continue;
      if (!groupByKey.has(e.key)) throw new Error(`Unknown group: ${e.key}`);
      used += e.n;
      genders.add(genderOfKey(e.key));
    }
    if (genders.size > 1) throw new Error(`Room ${room.name} must be a single gender`);
    if (used > room.capacity) throw new Error(`Room ${room.name} over capacity (${used}/${room.capacity})`);
  }
  const allocated = tallyAllocated(map);
  for (const [key, n] of allocated) {
    const g = groupByKey.get(key);
    if (!g) throw new Error(`Unknown group: ${key}`);
    if (n > g.n) throw new Error(`Allocated more than available for ${key} (${n}/${g.n})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Auto-heal + soft freeze (2026-09-24). Placements are anonymous COUNTS per group key, so
// ordinary events — a pool crossing 50 and re-splitting, cancellations, a ministry dropping under
// 75% — leave stored entries that no longer match a live group. These used to make EVERY later
// whole-map save fail camp-wide. The functions below make stored staleness self-heal, report it,
// and compute the "effective" (absorbed) placements while the soft freeze is on.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type HealReason = 'group re-split' | 'group shrank' | 'ministry no longer eligible' | 'room removed';
export interface HealNote { roomId: string; roomName: string; key: string; n: number; reason: HealReason }

function cloneMap(map: AllocationMap): AllocationMap {
  const out: AllocationMap = {};
  for (const [roomId, entries] of Object.entries(map)) out[roomId] = entries.map((e) => ({ key: e.key, n: e.n }));
  return out;
}
function roomUsed(map: AllocationMap, roomId: string): number {
  return (map[roomId] ?? []).reduce((s, e) => s + (e.n > 0 ? e.n : 0), 0);
}
function placedFor(map: AllocationMap, key: string): number {
  let t = 0;
  for (const entries of Object.values(map)) for (const e of entries) if (e.key === key && e.n > 0) t += e.n;
  return t;
}
function roomsHolding(map: AllocationMap, key: string): Array<{ roomId: string; entry: AllocEntry }> {
  const out: Array<{ roomId: string; entry: AllocEntry }> = [];
  for (const [roomId, entries] of Object.entries(map)) {
    for (const e of entries) if (e.key === key && e.n > 0) { out.push({ roomId, entry: e }); break; }
  }
  return out;
}
function pruneEmpty(map: AllocationMap): void {
  for (const roomId of Object.keys(map)) {
    map[roomId] = map[roomId]!.filter((e) => e.n > 0);
    if (!map[roomId]!.length) delete map[roomId];
  }
}

/**
 * Take `count` places away from a group, one at a time: from the MOST over-capacity room it sits
 * in first; once none of its rooms is over capacity, from its SMALLEST placement. Ties go to the
 * later room in stored order, so the first-placed room is the last to lose people.
 * Returns how many were removed per room.
 */
export function shrinkGroup(map: AllocationMap, key: string, count: number, rooms: readonly ClassroomLike[]): Map<string, number> {
  const cap = new Map(rooms.map((r) => [r.id, r.capacity]));
  const removed = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const held = roomsHolding(map, key);
    if (!held.length) break;
    let pick = held[0]!;
    let bestOver = -Infinity;
    for (const h of held) {
      const over = roomUsed(map, h.roomId) - (cap.get(h.roomId) ?? Infinity);
      if (over > 0 && over >= bestOver) { bestOver = over; pick = h; }
    }
    if (bestOver <= 0) {
      let smallest = Infinity;
      for (const h of held) if (h.entry.n <= smallest) { smallest = h.entry.n; pick = h; }
    }
    pick.entry.n--;
    removed.set(pick.roomId, (removed.get(pick.roomId) ?? 0) + 1);
  }
  return removed;
}

/**
 * Add `count` people to a group, one at a time, into whichever of its rooms has the most free
 * space (capacity − used; negative once a room is over). Ties → the earliest room in stored order
 * ("first-placed"). Only rooms the group already sits in are candidates.
 */
export function growGroup(map: AllocationMap, key: string, count: number, rooms: readonly ClassroomLike[]): void {
  const cap = new Map(rooms.map((r) => [r.id, r.capacity]));
  for (let i = 0; i < count; i++) {
    const held = roomsHolding(map, key);
    if (!held.length) return;
    let pick = held[0]!;
    let bestFree = -Infinity;
    for (const h of held) {
      const free = (cap.get(h.roomId) ?? 0) - roomUsed(map, h.roomId);
      if (free > bestFree) { bestFree = free; pick = h; }
    }
    pick.entry.n++;
  }
}

function bracketFamily(b: string | undefined): '7-9' | '10-12' | null {
  if (!b) return null;
  if (b === '7-9' || b === '10-12') return b;
  return Number(b.slice(1)) <= 9 ? '7-9' : '10-12';
}
function bracketLevel(b: string | undefined): number { return !b ? 0 : b.startsWith('Y') ? 2 : 1; }

/** Why a stored key no longer matches any live group. */
function staleReason(key: string, groups: readonly AllocationGroup[], eligible: ReadonlySet<string>): HealReason {
  const [churchId = '', gender = '', bracket] = key.split('|');
  if (!eligible.has(churchId)) return 'ministry no longer eligible';
  const live = groups.filter((g) => g.churchId === churchId && g.gender === gender);
  if (!live.length) return 'group shrank';
  const lvl = bracketLevel(bracket);
  if (lvl === 0) return 'group re-split';
  const fam = bracketFamily(bracket);
  const related = live.filter((g) => !g.bracket || bracketFamily(g.bracket) === fam);
  return related.some((g) => bracketLevel(g.bracket) !== lvl) ? 'group re-split' : 'group shrank';
}

/**
 * Reconcile a stored map against the live groups. Drops entries for rooms / group keys that no
 * longer exist and, when `clamp`, trims any group placed beyond its live size. Never throws.
 * While the soft freeze is on, pass `clamp:false` — shrinkage is then a read-time effect
 * (`effectiveAllocations`) so a cancelled seat can be re-absorbed by a late registration.
 */
export function healAllocations(
  stored: AllocationMap,
  ctx: { rooms: readonly ClassroomLike[]; groups: readonly AllocationGroup[]; eligibleChurches: ReadonlySet<string>; clamp: boolean },
): { map: AllocationMap; healed: HealNote[] } {
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r]));
  const groupKeys = new Set(ctx.groups.map((g) => g.key));
  const healed: HealNote[] = [];
  const map: AllocationMap = {};
  for (const [roomId, entries] of Object.entries(stored)) {
    const room = roomById.get(roomId);
    for (const e of entries) {
      if (e.n <= 0) continue;
      if (!room) { healed.push({ roomId, roomName: 'Removed room', key: e.key, n: e.n, reason: 'room removed' }); continue; }
      if (!groupKeys.has(e.key)) {
        healed.push({ roomId, roomName: room.name, key: e.key, n: e.n, reason: staleReason(e.key, ctx.groups, ctx.eligibleChurches) });
        continue;
      }
      const list = (map[roomId] ??= []);
      const ex = list.find((x) => x.key === e.key);
      if (ex) ex.n += e.n; else list.push({ key: e.key, n: e.n });
    }
  }
  if (ctx.clamp) {
    for (const g of ctx.groups) {
      const over = placedFor(map, g.key) - g.n;
      if (over <= 0) continue;
      for (const [roomId, n] of shrinkGroup(map, g.key, over, ctx.rooms)) {
        healed.push({ roomId, roomName: roomById.get(roomId)?.name ?? 'Room', key: g.key, n, reason: 'group shrank' });
      }
    }
  }
  pruneEmpty(map);
  return { map, healed };
}

/**
 * The placements people actually get. Per group with any placement:
 *   target = min(live n, placed + max(0, live n − baseline))
 * i.e. growth since the baseline is absorbed into the group's rooms (even over capacity), and
 * placements never exceed the live group. Shrinks run before growth so freed seats are used.
 * With no baselines (not frozen) this is a plain clamp. Pure; never writes.
 */
export function effectiveAllocations(
  stored: AllocationMap,
  ctx: { rooms: readonly ClassroomLike[]; groups: readonly AllocationGroup[]; baselines?: Readonly<Record<string, number>> | null },
): AllocationMap {
  const map = cloneMap(stored);
  const plan = ctx.groups.map((g) => {
    const placed = placedFor(map, g.key);
    const base = ctx.baselines?.[g.key] ?? g.n;
    return { key: g.key, placed, target: placed === 0 ? 0 : Math.min(g.n, placed + Math.max(0, g.n - base)) };
  });
  for (const p of plan) if (p.target < p.placed) shrinkGroup(map, p.key, p.placed - p.target, ctx.rooms);
  for (const p of plan) if (p.target > p.placed) growGroup(map, p.key, p.target - p.placed, ctx.rooms);
  pruneEmpty(map);
  return map;
}

/** Per-key signature of where a group sits, independent of entry/room order. */
function signatures(map: AllocationMap): Map<string, string> {
  const per = new Map<string, Map<string, number>>();
  for (const [roomId, entries] of Object.entries(map)) {
    for (const e of entries) {
      if (e.n <= 0) continue;
      const m = per.get(e.key) ?? new Map<string, number>();
      m.set(roomId, (m.get(roomId) ?? 0) + e.n);
      per.set(e.key, m);
    }
  }
  const out = new Map<string, string>();
  for (const [key, m] of per) out.set(key, [...m].sort(([a], [b]) => a.localeCompare(b)).map(([r, n]) => `${r}:${n}`).join(','));
  return out;
}

export class AllocationRequestError extends Error {}

/**
 * Turn a whole-map save request into the new stored map.
 *
 * A group is TOUCHED when its placements in the request differ from BOTH the raw stored map and
 * the healed one. Untouched groups keep their healed stored placements whatever the request
 * carries, so staleness already in storage (or in a screen loaded before a re-split) can never
 * fail a save. Touched groups are checked strictly: the key must exist and the total must not
 * exceed the live group. Every room must be single-gender and may not end the save with its
 * effective occupancy above capacity AND above what it was before the save — an already-over
 * room (unfreeze keeps overflow) may stay or shrink, never grow.
 * While frozen, `baselines` reset to the live size for every touched group.
 */
export function applyAllocationRequest(
  request: AllocationMap,
  ctx: {
    stored: AllocationMap;
    rooms: readonly ClassroomLike[];
    groups: readonly AllocationGroup[];
    eligibleChurches: ReadonlySet<string>;
    baselines: Readonly<Record<string, number>> | null;
  },
): { map: AllocationMap; touched: string[]; healed: HealNote[]; baselines: Record<string, number> | null } {
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r]));
  const groupByKey = new Map(ctx.groups.map((g) => [g.key, g]));
  for (const [roomId, entries] of Object.entries(request)) {
    if (entries.some((e) => e.n > 0) && !roomById.has(roomId)) throw new AllocationRequestError(`Unknown room: ${roomId}`);
  }
  const frozen = ctx.baselines != null;
  const { map: healed, healed: notes } = healAllocations(ctx.stored, {
    rooms: ctx.rooms, groups: ctx.groups, eligibleChurches: ctx.eligibleChurches, clamp: !frozen,
  });
  const rawSig = signatures(ctx.stored), healedSig = signatures(healed), reqSig = signatures(request);
  const keys = new Set([...rawSig.keys(), ...healedSig.keys(), ...reqSig.keys()]);
  const touched: string[] = [];
  for (const k of keys) {
    const r = reqSig.get(k) ?? '';
    if (r !== (rawSig.get(k) ?? '') && r !== (healedSig.get(k) ?? '')) touched.push(k);
  }
  const touchedSet = new Set(touched);
  for (const k of touched) {
    const want = [...Object.values(request)].flat().filter((e) => e.key === k).reduce((s, e) => s + Math.max(0, e.n), 0);
    if (want === 0) continue;                 // removing a group entirely is always allowed
    const g = groupByKey.get(k);
    if (!g) throw new AllocationRequestError(`Unknown group: ${k} — it has changed since this page loaded. Refresh and try again.`);
    if (want > g.n) throw new AllocationRequestError(`Allocated more than available for ${k} (${want}/${g.n})`);
  }

  // Build the new map: touched groups from the request, everything else from the healed store.
  const map: AllocationMap = {};
  const roomOrder = [...Object.keys(request), ...Object.keys(healed).filter((r) => !(r in request))];
  for (const roomId of roomOrder) {
    const list: AllocEntry[] = [];
    const add = (key: string, n: number) => {
      if (n <= 0) return;
      const ex = list.find((x) => x.key === key);
      if (ex) ex.n += n; else list.push({ key, n });
    };
    const reqEntries = request[roomId] ?? [];
    const healedEntries = healed[roomId] ?? [];
    for (const e of reqEntries) {
      if (touchedSet.has(e.key)) add(e.key, e.n);
      else { const h = healedEntries.find((x) => x.key === e.key); if (h && !list.some((x) => x.key === e.key)) add(h.key, h.n); }
    }
    for (const h of healedEntries) if (!touchedSet.has(h.key) && !list.some((x) => x.key === h.key)) add(h.key, h.n);
    if (list.length) map[roomId] = list;
  }

  for (const [roomId, entries] of Object.entries(map)) {
    const genders = new Set(entries.map((e) => genderOfKey(e.key)));
    if (genders.size > 1) throw new AllocationRequestError(`Room ${roomById.get(roomId)?.name ?? roomId} must be a single gender`);
  }

  const baselines = frozen ? { ...ctx.baselines } : null;
  if (baselines) for (const k of touched) { const g = groupByKey.get(k); if (g) baselines[k] = g.n; else delete baselines[k]; }
  const before = effectiveAllocations(healed, { rooms: ctx.rooms, groups: ctx.groups, baselines: ctx.baselines });
  const after = effectiveAllocations(map, { rooms: ctx.rooms, groups: ctx.groups, baselines });
  for (const room of ctx.rooms) {
    const now = roomUsed(after, room.id);
    if (now > room.capacity && now > roomUsed(before, room.id)) {
      throw new AllocationRequestError(`Room ${room.name} over capacity (${now}/${room.capacity})`);
    }
  }
  return { map, touched, healed: notes, baselines };
}

/** Rooms whose effective occupancy is above capacity. */
export function overCapacityRooms(effective: AllocationMap, rooms: readonly ClassroomLike[]): Array<{ roomId: string; name: string; used: number; capacity: number; over: number }> {
  return rooms
    .map((r) => ({ roomId: r.id, name: r.name, used: roomUsed(effective, r.id), capacity: r.capacity }))
    .filter((r) => r.used > r.capacity)
    .map((r) => ({ ...r, over: r.used - r.capacity }));
}

export interface TentChurch {
  churchId: string; church: string;
  m: { stu: number; ld: number };
  f: { stu: number; ld: number };
}

export function tentDistribution(occupants: readonly AllocationOccupant[], opts?: EligibilityOptions): TentChurch[] {
  // A person whose personal preference is 'classroom' still ends up in a tent if their
  // church never reached the 75% eligibility threshold (no room group exists for them) —
  // fold those in here so they're always counted somewhere, never silently dropped. A
  // per-registration church is always "eligible" (see isEligible), so this fold-in never
  // applies to it; a flagged church with zero classroom people simply emits no groups
  // (groupsForGender returns [] when g.cls===0) and its tent people are unaffected, since
  // only classroom-kind people are ever folded in here.
  const churchTallies = tallyChurches(occupants);
  const by = new Map<string, TentChurch>();
  for (const o of occupants) {
    if (o.lifecycle === 'cancelled') continue;
    const tally = churchTallies.get(o.churchId);
    const churchEligible = tally != null && isEligible(tally, opts);
    const isTentBound = o.accommodationKind === 'tent'
      || (o.accommodationKind === 'classroom' && !churchEligible);
    if (!isTentBound) continue;
    let c = by.get(o.churchId);
    if (!c) {
      c = { churchId: o.churchId, church: o.churchName, m: { stu: 0, ld: 0 }, f: { stu: 0, ld: 0 } };
      by.set(o.churchId, c);
    }
    const g = o.gender === 'male' ? c.m : c.f;
    if (o.kind === 'leader') g.ld++; else g.stu++;
  }
  return [...by.values()];
}

export function tentsFor(count: number): number {
  return Math.ceil(count / TENT_SIZE);
}
