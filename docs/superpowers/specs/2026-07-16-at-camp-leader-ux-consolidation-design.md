# At-camp leader UX consolidation — design

**Date:** 2026-07-16
**Status:** Design approved by owner; implementation deferred until the in-flight
`chore/migration-consolidation` work lands (this design adds a settings migration, so it must
be numbered against the consolidated migration set, not the current one).
**Scope surface:** `public/index.html` (SPA) heavy, plus one small `CampSettings` addition
(two columns + Admin Settings controls). **Pre-camp is untouched. First-aid is untouched.**

---

## 1. Problem & persona

North-star user: an **at-camp, single-church leader** — tired, one-handed, in the dark, often
with a student in front of them, wanting to *account for their kids* and *reach another leader
fast*. Everything is judged at 11pm on night two, not at a desk.

The at-camp app currently presents **three near-identical "find a person" surfaces**, none of
which signals which to use:

| Surface | Lives as | Job |
|---|---|---|
| **Check-in** (`RENDER.checkin`, 1761) | bottom tab | twice-daily *session* roster |
| **My Youth Details** (`RENDER.myyouth`, 2594) | a *home tile* | own group, profiles, **camp sign-in/out** |
| **Search** (`RENDER.search`, 2180) | bottom tab | camp-wide *contact* lookup, masked leader phone |

Plus a **first-day arrival** surface (`RENDER.firstday`, 2507) that overlaps Check-in
conceptually. The most reassuring view — "are my kids here?" — is buried behind a home tile, and
the home's key action tile *flips* between First Day Sign In and Submit Testimonies so a leader
can't find the one that isn't showing today.

This design collapses **three surfaces into two clear ones** and declutters the home.

---

## 2. The four changes

### 2.1 Unified "Sign-in / Check-in" entry (arrival → daily, with a settable switchover)

**Concept:** one entry point — a single **home tile *and* the existing bottom-nav Check-in
icon** — that represents *"account for my kids."* It shows **arrival sign-in** early on Day 1,
then becomes **daily check-in** after a **switchover**. This removes the flipping/greying tile and
folds the arrival surface into the check-in surface.

**Phase model (computed client-side — the backend is serverless with no scheduler):**

```
phase =
  settings.checkinPhaseOverride === 'signin'  → 'signin'      // manual flip
  settings.checkinPhaseOverride === 'checkin' → 'checkin'     // manual flip
  else (override === 'auto'):
    realCampDay === 1 AND brisbaneNowTime < settings.checkinSwitchoverTime → 'signin'
    else → 'checkin'
```

- `realCampDay` = existing `_realCampDayNumber()` (Brisbane-anchored, already used for the Day
  badge and the current First-Day/Testimonies tile switch).
- `brisbaneNowTime` = current time in `Australia/Brisbane` (reuse the `localDateISO()` /
  `Intl.DateTimeFormat` pattern already in the SPA; extend to hh:mm).
- **Consistency note:** the app already models Day 1 as **PM-only** check-in (`buildSessions`),
  so an afternoon arrival→check-in switchover fits the existing session model.

**One nav id, phase-branched render.** Keep a single screen id (`checkin`). `RENDER.checkin`
branches on `phase`:
- `phase === 'signin'` → render the arrival-sign-in body (today's `RENDER.firstday` content).
- `phase === 'checkin'` → render the daily check-in body (today's `RENDER.checkin` content).

Refactor the two current bodies into content-builders (e.g. `_firstdayBody()` /
`_checkinBody()`) called by the branch — same refactor precedent as the At-Camp Info merge
(`_acFaqBody` / `_acScheduleBody`). The nav-tab **label and icon derive from phase**
("Sign-in" vs "Check-in"). The home tile points to the same entry with the same phase label.

**After switchover, arrival sign-in is replaced by daily check-in** (owner-confirmed). Late
arrivals from that point sign in via **Students → My group** (§2.2). The check-in body must keep
its existing "Not Signed In" `<details>` section so late arrivals remain one tap from a
"Sign in to camp" button.

**Switchover time — customisable in Camp Settings.** New `CampSettings.checkinSwitchoverTime`
(clock time, default `'14:00'`). Applies on Day 1 only (Day 2+ is always `checkin` in `auto`).

**Manual flip — in Admin Settings, propagates across the app.** New
`CampSettings.checkinPhaseOverride: 'auto' | 'signin' | 'checkin'` (default `'auto'`). A control
in `RENDER.adminSettings` (segmented `Auto / Sign-in / Check-in`, same `.tgl`/segment idiom as
the existing login-lock toggles) PATCHes `/settings`. Propagation reuses the **existing
settings-sync path**: `RENDER.home` already re-fetches `/settings` on every home nav and other
tabs pick it up via the cross-tab `storage` event — no new endpoint or scheduler. Invalidate the
dashboard cache on the write (settings writes already do).

> **Design intent:** `auto` is the normal case (time-driven); the manual override is the
> director's real-time "flick it now" control (e.g. everyone's arrived early). It is
> **admin-only** and should confirm before flipping, since it changes every live session's entry.

### 2.2 "Students" tab — merge My Youth + Search (all at-camp roles)

Repurpose the existing **Search** bottom tab into a merged **Students** screen. **Bottom-nav count
is unchanged** (Home · Check-in · **Students** · Notices). The **"My Youth Details" home tile is
removed** (it becomes the default sub-tab).

- **Label:** bottom-tab label **"Students"** (people icon) — "Student Search" risks wrapping next
  to "Check-in"; the screen *title* reads "Student Search".
- **Screen id:** introduce `students`; host a `.seg` segmented control (same pattern as the
  check-in day selector) with two sub-views, defaulting to **My group**:

| Sub-tab | Content | Built from |
|---|---|---|
| **My group** *(default)* | Roster split **At camp / Signed out / Late arrivals**; tap → profile → **camp sign-in/out**. | `RENDER.myyouth` body |
| **Other churches** | Type-ahead name search across camp → **masked leader-contact reveal** (call primary/secondary). | `RENDER.search` body |

**Per-role "My group" scope:**
- **church** → own church (no grouping needed).
- **zoneLeader** → their **zone, grouped under church headings** (owner-confirmed). Modify
  `filterMyYouth`'s render to insert church sub-headings within each At-camp / Signed-out /
  Late-arrivals section for zoneLeader; church role unchanged.
- **director / admin** → all students, with the existing church filter select.

**Refactor:** turn `RENDER.myyouth` and `RENDER.search` bodies into content-builders called by
`RENDER.students(subtab)`. Retire the standalone `myyouth` screen usage (fully subsumed at-camp;
pre-camp uses the separate `people` screen, which stays). Keep `openCamper` reachable from the
My-group list; **Back from a profile returns to Students → My group** (see §2.4 for the token
fix that also makes this reliable).

**RBAC / data:** no new permissions or endpoints. My-group uses `/campers` (already role-scoped);
Other-churches uses `/search` + `/search/contact/:id/:role` (existing masked-reveal + audit).

### 2.3 Home screen — hard cap of 4 tiles (church leader)

For the **at-camp church leader** (`renderHomeAtCamp`, ~1422):

1. **Sign-in / Check-in** (phase-labelled) → the unified entry (§2.1)
2. **Submit Testimonies** (always present/active)
3. **Schedule**
4. **Devotional**

- **Remove** the "My Youth Details" tile (→ Students tab).
- **Your Accommodation** (church): demote from a tile to a **one-line strip inside the hero
  card** (reference info, not an action).
- **Testimonies & Notes** (`canReadNotes`): demote to a **slim full-width link below the tile
  grid**, with **bold link text** (owner-confirmed) — not a tile.

Other roles keep their role-appropriate tiles/links and inherit the same *concepts* (unified
entry + Students merge); the strict 4-tile cap is the church-leader goal, not a global rule.

### 2.4 Fix: profile sometimes needs two taps to open

**Hypothesis (to confirm by reproduction first):** `openCamper` (2641) opens a profile by setting
`#camper` HTML directly and calling `_showScreen('camper')`, but **never updates `_navId` / the
nav token**. When the list screen's background *stale-while-revalidate* refetch finishes a moment
later, its `paint()` calls `_showScreen(list)` and **steals the active screen back** — so the
first tap appears to do nothing and a second tap (after revalidation settles) works. This is the
**same class** as the already-fixed first-aid bug (the `_faScreen()` fix, 2011–2015), where a
paint landing on a non-active screen was silently dropped by `paint()`'s stale-guard (1170).

**Fix (minimal, proven pattern):** have `openCamper` claim the nav token / set `_navId='camper'`
(and push the stack consistently) so any in-flight list `paint()` is dropped by the existing
stale-guard. Preferred: route the profile open through the nav core so it gets a token like every
other navigation. **Reproduce before committing** to confirm the mechanism.

---

## 3. Implementation surface (touch-points for the plan)

**SPA (`public/index.html`):**
- `navModel` — at-camp church/zoneLeader/director/admin: replace `Search` tab with
  `students`/"Students"; Check-in tab label/icon becomes phase-driven.
- `navSidebar` — admin at-camp hard-coded list references `search` → update to `students`.
- `TAB_OF` — map `camper` (and the `students` sub-views) so the Students tab stays highlighted;
  retire/alias `myyouth`, `search`.
- `RENDER.checkin` — phase branch + `_firstdayBody()`/`_checkinBody()` refactor; keep "Not Signed
  In" details.
- New `RENDER.students(subtab)` — `.seg` control + `_myGroupBody()` (ex-`myyouth`) +
  `_otherChurchesBody()` (ex-`search`).
- `filterMyYouth` — church-grouped headings for zoneLeader.
- `renderHomeAtCamp` — 4-tile set; remove My Youth tile; accommodation → hero line; Notes → bold
  slim link.
- `openCamper` — nav-token fix (§2.4); Back → Students/My group.
- Phase helper — `campPhase()` computing `'signin' | 'checkin'` from settings + Brisbane time;
  a `brisbaneNowTime()` extension of the existing Brisbane-date helper.
- `RENDER.adminSettings` / `saveSettings` — switchover-time input + phase-override control; add
  both to the `PATCH /settings` body.
- `sw.js` — bump `CACHE` version (HTML changed).

**Backend:**
- `CampSettings` type + settings repo (in-memory + Supabase) — add `checkinSwitchoverTime`
  (default `'14:00'`) and `checkinPhaseOverride` (default `'auto'`). Supabase settings writes
  ALL columns each save, so the migration must land **before/with** deploy.
- **Migration** — two new nullable columns on `settings`. **Number against the consolidated
  migration set** (blocked on `chore/migration-consolidation`).
- `UpdateSettingsSchema` (or equivalent) — accept the two new fields.

---

## 4. Out of scope / explicitly not doing

- **Swipe-to-sign-out** — owner confirmed mid-camp sign-outs are rare; not worth building.
- **Merging Check-in as a separate concept away** beyond the arrival-unification — Check-in stays
  the session roster; we unify *arrival sign-in* into it, nothing more.
- **Pre-camp** navigation / the `people` screen — unchanged.
- **First-aid** navigation and its own Search landing — unchanged.
- No new RBAC capabilities.

## 5. Optional follow-ups (parked, not in this build)

- **"X of your N signed in"** line in the home hero (answers the core anxiety pre-tap).
- **Reason-shortcut chips** on the sign-out modal ("Parent pickup" / "Unwell" / "Left early") to
  cut mandatory typing.

---

## 6. Verification (per the repo's gates)

- `npm run typecheck` clean; `npm run test` green (add tests for the settings fields + any phase
  helper that has pure logic; SPA phase computation can be unit-tested if extracted).
- SPA `node --check` on the extracted `<script>`.
- **Reproduce the double-tap bug** and confirm the fix behaviourally.
- Hard-load prod URL after deploy to check for CSP violations (SPA-only convention).
- Bump `sw.js` `CACHE` (icons/HTML are cache-first).
- Manual at-camp walk-through as a church leader: arrival sign-in → switchover (auto + manual
  flip) → daily check-in → Students (My group sign-out, Other-churches contact reveal) → home
  4-tile layout → open a profile (no double-tap).

## 7. Open items resolved

- Switchover: **customisable clock time in Camp Settings**, default 14:00, Day-1-driven; **manual
  admin flip** in Admin Settings (auto/sign-in/check-in), propagated via existing settings-sync.
- Manual flip home: **Admin Settings** (owner-confirmed).
- After switchover: **daily check-in replaces arrival sign-in**; late arrivals via Students → My
  group (owner-confirmed).
- Testimonies & Notes: **slim link, bold text** below the home grid (owner-confirmed).
- Merge scope: **all at-camp roles** (owner-confirmed).
- Zone-leader My group: **zone grouped by church** (owner-confirmed).
