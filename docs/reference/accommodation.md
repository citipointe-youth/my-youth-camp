> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: accommodation

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## Accommodation rooms grouped + shaded by building — `camp-v126` — 2026-09-24 (3rd)

> **Follow-up `camp-v127`:** the logic is now shared top-level helpers — `_roomBuilding(name)`,
> `_roomBuildings(rooms)` → `[{name, rooms, tint}]`, `_roomBuildingHead`, `_ROOM_TINTS`, `_roomNat`
> (defined just above `_accomRoomUsed`) — and **Admin → Accommodation setup** (`RENDER.adminAccom`)
> groups/tints its edit tiles the same way (heading shows `N rooms · cap beds`). Infobox + the
> add-room placeholder now teach the `Building - Room` convention. Renaming via Save re-renders the
> screen, so the tile jumps to its new building immediately.
>
> **Follow-up `camp-v128`:** grouping now **ignores capitals and extra spaces** and splits on the
> first `-` whether or not it has spaces (`chc-E2`, `CHC  -  A1` → CHC); the heading shows the
> most-used spelling in the group. ⚠ So any hyphen now splits — a name like `Year-12 Room` would
> group as "Year". Setup tiles widened 20% (`minmax(180px)`→`216px`) so `Mezz - CK5` isn't cut off.

Owner request: rooms are named `<Building> - <Room>` (ITC, CHC, Mezz, K Block, SOHO, CP; `Chapel`
has no prefix). **SPA only** (`drawAccom` in `public/index.html`) — no schema, API or migration.
The Classrooms section on the allocations screen now shows one heading per building (prefix before
" - "; no prefix → its own group), buildings **A→Z**, rooms **natural order** (E2 before E10), each
building a tinted card background + coloured left edge (`_TINTS`, 8 colours cycled by alphabetical
position — adding a building can shift later buildings' colours), heading shows `N rooms · used/cap`.
Over-capacity red still overrides the tint. To recategorise a room, rename it in Admin →
Accommodation. **Display only**: `_accomGrow`/`_accomShrink` iterate the placement map, not the room
list, so ordering cannot change allocations. The API/export still sort rooms by plain `name`.
Harness 21 scenarios pass, vitest 1169 pass, SPA body `node --check` OK. `sw.js` → `camp-v126`.
Not verified on a device.

## Accommodation: stale-placement auto-heal + classroom "soft freeze" — migration `0030` — 2026-09-24 (2nd)

Owner problem: placements are stored as COUNTS per group key (`churchId|gender[|bracket]`), and
`setAllocations` replaced the whole map and threw on ANY stale entry — so a pool crossing 50
(re-split), shrinking back (un-split), cancellations, or a ministry dropping under 75% made EVERY
later save fail for the whole camp (generic 500; `Unknown group` / `Allocated more than available`
only in the runtime log), while `drawAccom` silently hid the orphans. Plus a new owner feature: a
"soft freeze" for the last ~3 days before camp. Backend + SPA + **migration `0030`** (new
`classroom_freeze` table + `classroom_allocations.seq int`, additive — **must be applied to prod
BEFORE this code deploys**: `supabase.allocation` writes `seq` on every placement save and orders
by it). `npm run typecheck` clean, `npx vitest run` **1169 pass / 67 files** (was 1136/65; **+33,
+2 files**: `accommodation-heal-freeze.test.ts` 22, `supabase.classroom-freeze.mapper.test.ts` 2,
+8 characterisation, +1 admin), `node scripts/accom-export-harness.js` **21 scenarios, all checks
passed** (was 13; proven to catch regressions — removing the frozen-eligibility line fails 3
checks, disabling growth fails 9). `node --check` OK on the SPA body (range **1004–10708**) and
`sw.js`. `sw.js` `camp-v124`→**`camp-v125`**. Plan:
`docs/superpowers/plans/2026-09-24-classroom-soft-freeze.md`.

> **✅ `0030` APPLIED TO PROD, CODE PUSHED — LIVE CHECK STILL OUTSTANDING (2026-09-24).** `0030` was
> applied FIRST (MCP recorded `20260924032553`; collision guard returned 0; reconciled to `'0030'`).
> Verified after: `schema_migrations` = 30 rows, `0001`–`0030` contiguous, 0 timestamped;
> `classroom_freeze` exists (4 NOT NULL cols, RLS on, 0 rows); `classroom_allocations.seq` is
> `integer` nullable; prod had 0 placement rows at apply time. `master` then pushed at `92be504`.
> ⚠ **The deploy was NOT verified live**: this session's egress proxy returned 403 for
> `my-youth-camp.vercel.app`, and the Vercel connector had no access to the `citipointe-youth`
> scope. Before relying on it, confirm `curl -s https://my-youth-camp.vercel.app/sw.js | head -1` →
> `camp-v125`, `/health` → 200, and `POST /accommodation/soft-freeze` → 401 unauthenticated.

### Part 1 — auto-heal (always on). All pure logic in `accommodation-allocation.ts`, tested.
- **`healAllocations(stored, {rooms, groups, eligibleChurches, clamp})`** drops entries for unknown
  rooms/keys, reporting each as `{roomId, roomName, key, n, reason}` with reason `group re-split` /
  `group shrank` / `ministry no longer eligible` / `room removed`; with `clamp`, trims any group
  placed beyond its live size (**most over-capacity room first, then its smallest placement; ties →
  the later room**, so the first-placed room keeps people longest). Never throws.
- **`applyAllocationRequest`** replaces `validateAllocations` on the save path (the old function is
  still exported/tested but no longer called by the service). ⚠ The core idea: a group is
  **TOUCHED** only when its per-room placements in the request differ from BOTH the raw stored map
  AND the healed one. **Untouched groups keep their healed stored placements whatever the request
  carries** — so neither stored staleness nor a screen loaded before a re-split/cancellation can
  fail a save. Touched groups are strict: key must exist (message tells the user to refresh), total
  ≤ live n. Every room single-gender; a room may not END the save with effective occupancy >
  capacity AND > what it was before the save — **an already-over room may stay or shrink, never
  grow** (this is what makes unfreeze's overflow survivable).
- Rule errors now reach the director as a **400 with the reason** (`AllocationRequestError` →
  `BadRequestError`), not the generic 500.
- **Reads never write.** `GET /accommodation/state` reports the heal; the next save (any add/remove)
  persists it and returns that save's heal list. The SPA shows a dismissible warnbox ("Room A: 20
  placements for Victory — Guys were cleared because that group was re-grouped by year level …"),
  dismissal remembered per device by content signature (`ycp_accom_heal_dismissed`).

### Part 2 — soft freeze (owner decisions, binding)
- **`classroom_freeze`** singleton (`id='freeze'`; row absent = not frozen), `snapshot jsonb =
  {eligibleChurchIds, shapes, baselines}`, written with `sql.json()` and mapped defensively
  (`toClassroomFreeze` throws on a double-encoded string, the 2026-08-04 lesson). Its own table,
  NOT a settings column: `GET /settings` is unauthenticated and settings rows are rewritten whole.
- **`POST /accommodation/soft-freeze {frozen}`** — director + admin, blocked by the hard lock for
  directors (`assertNotLocked`), same as placements. The hard lock itself is untouched.
- **Frozen = `EligibilityOptions.frozen`**: eligibility is the frozen set (75% and per-registration
  both ignored), and each church×gender pool uses its recorded `PoolShape {split, years79,
  years1012}` — `naturalShape()` is today's split rule factored out of `groupsForGender`. No re-split
  or un-split at 50; a pool with no recorded shape (no classroom people at freeze) is one group.
  A new registrant joins their frozen bracket/year group with the usual leader spread.
- **`effectiveAllocations(stored, {rooms, groups, baselines})`** — computed at READ time, no
  background writes: per group with a placement, `target = min(n, placed + max(0, n − baseline))`.
  Shrinks first (same order as the clamp), then growth one at a time into the group's room with the
  **most free space (capacity − used, may be negative); tie → earliest room in stored order**
  ("first-placed"). `seq` exists so that order is deterministic on Supabase (pre-0030 rows sort last
  until the next save). Not frozen ⇒ plain clamp.
- **Baselines = group sizes when frozen; any save that TOUCHES a group resets that group's baseline**
  to its current n (covers remove → re-add: re-add places `min(unplaced, effective room space)`,
  remainder stays "to allocate", only later registrations are absorbed).
- **Unfreeze writes the effective map back as stored** and deletes the snapshot. Rooms keep their
  overflow; normal rules resume — ⚠ so a pool that grew past 50 while frozen **re-splits the moment
  you unfreeze** and its placements are healed away (reported). That is the owner's "normal rules
  resume", stated here so nobody reads it as a bug.
- **`setPerRegistration` is refused while frozen** (interpretation: eligibility must not change
  while frozen). The SPA replaces the dropdown with status text ("Soft freeze — kept in classrooms"
  / "…counted in Tent City below").
- `getChurchRooms` (church home at camp) and the export show **EFFECTIVE** counts. `getChurchRooms`
  needs the whole people table (rooms are shared across churches), so it is cached 30s per warm
  instance (`effectiveCache`), cleared by every write in the service — an import is NOT a write
  here, so up to 30s stale after one.
- Admin `reset` and `newYear` clear the freeze (optional 17th arg to `makeAdminService`, both
  container paths pass it).

### SPA
- `RENDER.accom` loads **`/accommodation/state`** (`_accomApplyState`); `window._accomAlloc` is the
  healed stored map, `window._accomFreeze` the snapshot. `_accomEligible`/`accomGroups` honour the
  freeze; `_accomEffective`/`_accomGrow`/`_accomShrink`/`_accomEff` mirror the backend. **Screen,
  export and requests all read `_accomEff()`** so they cannot disagree.
- `addAlloc`/`removeAlloc` build requests via **`_accomReqBase(key, eff, groups)`**: stored map
  filtered to live keys, with ONLY the changed group's placements replaced by its effective ones.
  Space/availability use effective counts. `PATCH /accommodation/allocations` now returns the state
  object (used directly, no re-GET). `setAccomPerReg` re-reads `/accommodation/state`.
- Freeze card at the top of the screen ("Soft freeze on since … — N late registrations absorbed, M
  rooms over capacity" + Unfreeze, or the Soft-freeze button + tooltip). Over-capacity room card is
  red with `29/25 · +4 over`; chips show `(29 · +4 late)`.
- Export: "Classrooms by room" gains **Over capacity**; Summary gains Rooms over capacity, Total over
  capacity, Soft freeze, Late registrations absorbed. "Spare capacity" is now summed per room
  (Σ max(0, cap − used)) so an over-full room can't hide empty beds elsewhere.
- Harness names extracted BY NAME — add parameters freely, never rename: `_accomNaturalShape`,
  `_accomGenderGroups(c,gender,g,shape)`, `_accomRoomUsed`, `_accomHeld`, `_accomShrink`,
  `_accomGrow`, `_accomEffective`, `_accomEff`, `_accomReqBase`.

### Interpretations made (owner may want to confirm)
1. Per-registration toggle blocked while frozen (not "applies on unfreeze").
2. Cancellations reduce placements only once placements exceed the live group — unplaced people
   absorb shrinkage first (counts are anonymous). Effective depends only on the live count, so a
   cancellation followed by a late registration re-absorbs the seat.
3. "Baseline reset on manual action" = any save that changes that group's placements.
4. A GET reports stale placements without clearing them; the next save persists the clean-up.

**Not verified on a device** (repo convention). Owner to eyeball: freeze card + confirm sheet, a
red over-capacity room card at phone width, the heal warnbox and its Dismiss.

## Accommodation: "Left to per-registration" per ministry — 2026-09-24

Owner problem: a ministry sitting under the 75% classroom-eligibility bar gets **none** of its
classroom-preference people grouped — the whole ministry folds into Tent City (2026-07-20
behaviour), even when that is deliberate: one ministry sends its **juniors to classrooms and its
seniors to tents**, which lands it well under 75% by design. Backend + SPA +
**migration `0029`** (`churches.accommodation_per_registration boolean not null default false`,
additive, not null default false — **must be applied to prod BEFORE this code deploys**, same
standing rule as every prior `people`/`churches` column addition — `supabase.churches`'s mapper
reads/writes it on every church save). `npm run typecheck` clean, `npx vitest run` **1136 pass /
65 files** (was 1122; **+14**: +6 `accommodation-allocation.test.ts`, +8
`accommodation.characterisation.test.ts`, harness-only for the SPA task — no `src/**` change
there), `node scripts/accom-export-harness.js`
**13 scenarios, all checks passed** (was 11; **+2**). `node --check` OK on the SPA body and
`sw.js`. `sw.js` `camp-v123`→**`camp-v124`**.

> **✅ APPLIED AND DEPLOYED (2026-09-24).** `0029` was applied to prod FIRST (MCP recorded
> `20260924014503`, reconciled to `'0029'` after a collision guard returned 0), then `master`
> pushed at `8321a63` → `dpl_PABX7XjLkAZm6HD69oyVU5MttZt8` (git source). Verified live: `sw.js`
> serves `camp-v124`, `/health` 200, `PATCH /accommodation/per-registration/:id` → 401 unauthenticated
> (route present). Column is `boolean NOT NULL default false`; all 27 churches read `false`.
> **Also reconciled a stray `0023` history row** that had been left un-reconciled since 2026-09-08
> (`20260908233749`/`person_invoice_numbers` → `0023`/`0023_person_invoice_numbers`).
> `schema_migrations` now reads `0001`–`0029` contiguous, 29 rows, 0 timestamped.

- **The dropdown lives inside "Under 75% — Moved to Tents"** on the Accommodation Allocations
  screen (`drawAccom`): a per-ministry **Status** `<select>` — *Counted in Tent City below*
  (default) / *Left to per-registration* — next to each under-75% church row, wired to
  `setAccomPerReg(churchId, on, sel)` → `PATCH /accommodation/per-registration/:churchId`.
  Flipping it to **on** makes that church behave as if it cleared 75%: its classroom-preference
  people form a normal per-gender (and 7-9/10-12-split, where the pool is big enough) classroom
  group again, while its tent-preference people are unaffected and still count in Tent City.
  Director + admin only (`assertDirectorOrAdmin`), and blocked while accommodation is locked for
  non-admins (`assertNotLocked` — admin is never blocked, matching every other write in this
  service).
- **One pure rule, `isEligible`/`_accomEligible`, both call sites.** Backend
  `accommodation-allocation.ts`'s `isEligible(c, opts)` takes an optional
  `EligibilityOptions{perRegistration: Set<churchId>}` and short-circuits to "eligible" before the
  75%-ratio check when the church id is in the set; `computeGroups`/`tentDistribution` both thread
  it through. `accommodation.service.ts`'s `eligibilityOptions()` builds that set once per call
  from `churchRepo.findAll()`'s `accommodationPerRegistration` flags, and both `listGroups`/
  `setAllocations` pass it in. SPA mirrors it as **`ACCOM_ELIGIBLE_RATIO`/`_accomEligible(c)`** —
  the ONLY place `0.75` is a literal; `accomGroups`, `tentDist`, `_accomExportRows` and
  `drawAccom` all call the helper. **Harness scenario 13 greps all four functions' extracted
  source for a literal `0.75` and fails if one reappears** — this is what keeps a future edit from
  quietly reintroducing a second copy of the ratio.
- **Switch-back cleanup, and why it's needed.** Turning the flag back OFF for a church whose
  volume still sits under 75% orphans its now-ineligible classroom group's placements —
  `setAllocations` (`accommodation.service.ts`) does a **whole-map replace** and
  `validateAllocations` rejects any group key it doesn't recognise, so ONE stale placement blocks
  saving the room map for the *entire camp*, not just that church. `setPerRegistration` prunes
  only that church's now-orphaned `classroom_allocations` rows (via a fresh `computeGroups` with
  post-toggle eligibility options) when switching OFF; a church that clears 75% on its own keeps
  its placements untouched, and a sibling church's placements are never touched. See the two new
  debug.md symptom rows below for what this looks like when it isn't caught.
- **`/accounts` cache invalidation + the removed `.catch(()=>[])`.** `setAccomPerReg` invalidates
  `/accommodation` and `/accounts` (`_invalidate`'s new branch) — the flag is read off
  `/accounts/churches`, which the Accommodation screen already fetches and previously swallowed
  failures on (`.catch(()=>[])`). That swallow is now removed: a failed churches fetch means the
  screen can't know which ministries are flagged, so it now surfaces the error rather than
  silently rendering everyone as "Counted in Tent City below".
- **The sentinel "Unallocated" church has no dropdown.** `drawAccom`'s `tentedOut` builder skips
  the `<select>` for `c.id===UNALLOCATED_ID` — the server excludes that sentinel from
  `churchRepo.findAll()`, so a PATCH against it could only 404. That row keeps the plain
  "Counted in Tent City below" status text instead.
- **The select disables itself while a save is in flight.** `setAccomPerReg` sets `sel.disabled =
  true` right after the confirm step (before the PATCH) and clears it in a `finally` (guarded
  `if(sel)`) — harmless even though `drawAccom` re-renders the whole card on success and replaces
  the node anyway.
- **Rollover carry-over.** `accommodationPerRegistration` rides on the whole-`Church` object
  through `saveDefaults`/`newYear` exactly like `accommodationOverride` — no separate snapshot
  code needed, no new field to exclude. It is a per-year operational choice, not something that
  should silently persist forever without a fresh look, so if the owner wants it reset at rollover
  that would need a deliberate new exclusion (not built here — not requested).

## Accommodation export + roster filters persist across logins — 2026-08-03 (2nd)

Two owner follow-ups. SPA-only. `npm run typecheck` clean, `npx vitest run` **894 pass / 57
files** (unchanged — both are browser-only), `node --check` OK on the SPA body (range
**963–8833**, re-derived) and `sw.js`. `sw.js` `camp-v83`→**`camp-v85`** (v84 the export, v85 the
filters). **No schema or migration change.**

### 1 — Accommodation allocations: a 4-sheet Excel export
Closes the one real gap the 2026-08-03 export audit found — accommodation had no export of any
kind. Button sits at the top of the allocations screen; sheets are **Summary**, **Classrooms by
ministry**, **Classrooms by room**, **Tents**.

> ⚠️ **BUILT CLIENT-SIDE FROM THE DATA THE SCREEN IS ALREADY RENDERING**
> (`window._accomRegs` / `_accomRooms` / `_accomAlloc` → `accomGroups` / `accomChurches` /
> `tentDist`), and that is the whole reason it is not a server endpoint. Those SPA helpers
> **mirror** `src/services/accommodation-allocation.ts`; a server-generated workbook would be
> computed from the *other* copy of the rules. If the two ever drift, the spreadsheet would
> quietly disagree with the map the director is reading — and a director reconciling a room list
> against a screen has no way to tell which one is lying. Same reasoning as the check-in status
> PNG. **Do not move this server-side.**

- **Cohorts now carry `stu` and `ld` alongside `n`**, computed in `_accomGenderGroups` /
  `_accomYearGroups` at the same moment `n` is, with `n === stu + ld` always. The export needs
  the student/leader split per cohort and re-deriving it there would have been a **fourth** copy
  of that arithmetic. Additive — nothing on screen reads them yet and `n` is unchanged.
- ⚠️ **"Capacity of those classrooms" is the capacity of the rooms a cohort OCCUPIES, not
  capacity reserved for it.** A room shared between two cohorts contributes its full capacity to
  both, so that column is **not additive** down the page. The per-room sheet is the one that
  answers capacity questions without double counting; the header wording is deliberate.
- Written with the **already-vendored SheetJS** (`public/vendor/xlsx.full.min.js`, 0.18.5, lazy
  loaded by `_ensureXlsx`). **Verified it can WRITE, not just read** — the repo had only ever
  used it to convert xlsx→CSV on import — by round-tripping a real workbook through
  `XLSX.write` → `XLSX.read`. No new dependency. xlsx rather than CSV because four sheets was
  the request and CSV cannot carry them.
- ⚠️ Sheet names are capped at 31 chars and must avoid `: \ / ? * [ ]`. A bad one **throws on
  append** — that is exactly how the compliance workbook 500'd for weeks on
  `'Sign-in/Sign-out Log'`.
- **`_ensureXlsx`'s error message no longer says "try exporting as CSV instead"** — it now backs
  an export with no CSV alternative, so that was advice which could not be followed.
- The button is rendered **outside `#accomBody`**, like the overrides card: `drawAccom()` rewrites
  that div on every allocation change and would otherwise wipe the button's disabled state
  mid-export. It reads `window._accom*` at click time, so it always exports the current state
  without needing a re-render.
- **`scripts/accom-export-harness.js`** — 10 scenarios over the REAL extracted functions (never a
  reimplementation): the 50-person split threshold, `n === stu + ld` reconciliation, a shared
  room, a partially-placed cohort, tent ceil-to-7 with students and leaders counted **separately**
  (pooling 15 + 8 would give 4 tents, not 5), the under-75% fold-in, cancelled rows, people with
  no accommodation type, the empty camp, and a stale allocation entry pointing at a group that no
  longer exists. `node scripts/accom-export-harness.js`.

### 2 — Check-in and My-students filters persist across logins (owner request)
Remembered per device and restored at next sign-in. `_filtKey` / `_saveFilters` /
`_restoreFilters` / `_clearFilters` / `_filterActive` / `_filterBanner`.

> ⚠️⚠️ **THE PREMISE BELOW WAS WRONG WHEN FIRST WRITTEN AND WAS CORRECTED BY THE OWNER ON
> 2026-08-04 — see the 2026-08-04 section at the top of this file.** The original version
> assumed shared devices and shipped an amber WARNING banner as a safety mitigation. The real
> deployment model is the opposite: **one shared account across ~20 personal phones** (a church
> login like `b-citipointe-brisbane` is used by every boys' leader, each on their own handset).
> So a saved filter is a **standing preference** ("I look after Yr 7 boys"), not a transient
> state anyone forgets — and warning about it on every launch alarms a leader about a choice
> that is correct. The banner is now a quiet, neutral saved-view strip. Everything else in this
> section still stands.

- ⚠️ **Keyed PER ACCOUNT** (`ycp_filters_<username>`), matching `ycp_initials_<username>` /
  `ycp_ciq_<username>`. `localStorage` is already per-device, so on the real model this key is
  effectively "this leader's phone" — the account in it costs nothing and keeps the rare second
  login on one handset (a leader covering the other gender, an admin borrowing a phone) from
  inheriting a view that is not theirs. There is a harness check for that case.
- ⚠️ **`_restoreFilters` resets to defaults FIRST, then overlays**, and type-checks every value.
  A corrupt or partial blob must never leave a key `undefined`: an undefined filter compares
  false against everything and **silently empties the roster** with no error. A numeric `grade`
  is rejected rather than coerced, because filters compare as strings.
- **Every read and write is `try`/`catch`ed** — `localStorage` throws outright in some privacy
  modes, and this runs on the check-in screen, which must never fail to render.
- **`MY_FILTER` is new state.** The My-students filter previously lived ONLY in the DOM
  (`filterMyYouth` read `sel('myZoneF')` directly), so it did not survive a tab change, let alone
  a login. The selects are now the input and `MY_FILTER` is the state, via `setMyFilter()`.
- Restored at all **three** session-start paths (`doLogin`, `submitChangePassword`,
  `_tryRestoreSession`) **before the first paint**, so neither screen renders unfiltered and then
  jumps — and on **both** account-preview swaps, so an admin's own filter does not silently narrow
  the roster of the account they are inspecting.
- **`scripts/filter-persist-harness.js`** — 22 checks over the real functions against a stub
  `localStorage`: round trip, the b-/g- isolation case, five malformed-blob shapes, a throwing
  `localStorage`, and banner content (including "Leaders" not rendering as "Yr leaders", and the
  singular/plural of the hidden count).


