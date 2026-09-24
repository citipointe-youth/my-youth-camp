# Classroom soft freeze + stale-placement auto-heal — plan (2026-09-24)

Branch: `claude/classroom-soft-freeze-auto-heal-l8gjj6`. Migration `0030`. `sw.js` → `camp-v125`.

## Problem
Placements are stored as counts per group key (`churchId|gender[|bracket]`). `setAllocations`
replaces the whole map and throws on any stale entry (unknown key / over-placed group), and the
SPA resends the whole stored map on every change. A re-split at 50, an un-split, cancellations or
a ministry dropping under 75% therefore make EVERY later save fail camp-wide (generic 500), while
`drawAccom` silently hides the orphaned placements.

## Design

### Pure logic (`src/services/accommodation-allocation.ts`, mirrored in the SPA)
- `PoolShape {split, years79?, years1012?}`; `naturalShape(g)` = today's split rule, factored out
  of `groupsForGender`, which now takes an optional shape. `EligibilityOptions.frozen =
  {eligible:Set, shapes}` — when present, eligibility and pool shape come from the snapshot, not
  from the live numbers (no re-split/un-split, no gain/loss of eligibility). A pool with no
  recorded shape (it had no classroom people at freeze) is `{split:false}`.
- `captureFreeze(occupants, opts)` → `{eligibleChurchIds, shapes}`; baselines = live group sizes.
- `healAllocations(stored, {rooms, groups, eligibleChurches, clamp})` → `{map, healed[]}`: drops
  entries for unknown rooms/keys (reason `group re-split` / `group shrank` / `ministry no longer
  eligible` / `room removed`) and, when `clamp`, trims over-placed groups (most over-capacity room
  first, then the group's smallest placement). While frozen `clamp=false` — shrinkage is a
  read-time effect, so a cancellation followed by a late registration re-absorbs the seat.
- `effectiveAllocations(stored, {rooms, groups, baselines})`: per group with placements,
  `target = min(n, placed + max(0, n − baseline))`; shrinks first (over-capacity room first, then
  smallest placement), then grows one person at a time into the group's room with the most free
  space (may go negative), tie → earliest room in stored order. No baselines ⇒ plain clamp.
- `applyAllocationRequest(request, {stored, rooms, groups, eligibleChurches, baselines, frozen})`:
  a group is TOUCHED when its per-room placements differ from both the raw stored map and the
  healed map. Untouched groups keep their (healed) stored placements whatever the request says —
  stored staleness can never fail a save. Touched groups are validated strictly: known key, total ≤
  live n. Every room: single gender; and a room may not end the save with effective used >
  capacity AND > its effective used before the save (an already-over room may stay, never grow).
  Unknown rooms rejected. While frozen, touched groups' baselines reset to their current n.

### Storage (migration `0030`)
- `classroom_freeze` singleton (`id='freeze'`, `frozen_at`, `frozen_by`, `snapshot jsonb` =
  `{eligibleChurchIds, shapes, baselines}`), RLS on. Row absent = not frozen. Own table rather
  than a `settings` column: `GET /settings` is unauthenticated, and settings rows are rewritten
  whole by unrelated saves.
- `classroom_allocations.seq int` — insertion order, so "first-placed room" is deterministic.

### Service / API
- `GET /accommodation/state` → `{stored, effective, healed, freeze}` (director/admin). Read-only:
  heal is reported, persisted on the next save.
- `PATCH /accommodation/allocations` → same state object (includes that save's heal list).
- `POST /accommodation/soft-freeze {frozen}` (director/admin, hard lock applies). Freeze: persist
  a clamped heal, snapshot eligibility + shapes, baselines = group sizes. Unfreeze: persist the
  effective map, delete the snapshot.
- `setPerRegistration` refused while frozen (eligibility is frozen).
- `getChurchRooms` returns effective counts (30s instance cache, cleared by any write here).
- Admin `reset`/`newYear` clear the freeze.
- Pure-rule errors surface as 400 with their message (were generic 500s).

### SPA
- `RENDER.accom` loads `/accommodation/state`; `window._accomFreeze` drives `_accomEligible` /
  `accomGroups` (frozen shapes); `_accomEffective` mirrors `effectiveAllocations`.
- `addAlloc`/`removeAlloc` build requests from the healed stored map with the touched group's
  placements replaced by its effective ones; space/availability computed on effective counts.
- Dismissible heal notice; freeze card + toggle; "Soft freeze on since … — N late registrations
  absorbed, M rooms over capacity"; red over-capacity room card `29/25 · +4 over`; per-reg select
  replaced by status text while frozen.
- Export: effective counts; room sheet gains "Over capacity"; Summary gains freeze + over-capacity
  lines.

## Interpretations (owner decisions not fully specified)
1. Per-registration toggle is blocked while frozen (spec: eligibility doesn't change while frozen).
2. Baseline reset applies to every group a save changes (identified by diff), which covers
   remove/re-add.
3. Cancellations reduce placements only once placements exceed the live group — unplaced people
   absorb shrinkage first (counts are anonymous).
4. GET reports heal without writing; any save persists it.

## Tests
vitest: split with stored placements; un-split; shrink below placed; church drops under 75%;
freeze 25→29/25; split-across-rooms growth incl. all-full tie; cancellation while frozen; 51st
while frozen no re-split; newly-eligible ministry while frozen; remove+re-add baseline reset;
unfreeze keeps overflow and later save passes; request still rejects genuinely invalid input.
Harness: frozen grouping, effective 29/25, most-free rule, export over-capacity columns.
