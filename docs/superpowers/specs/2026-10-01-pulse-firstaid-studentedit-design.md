# Pulse, First-aid Records filter, Student Data Edit overrides — design

**Date:** 2026-10-01 · **Status:** approved by owner · **Ships:** after camp (2026-10-01 is the last camp day)
**Scope:** SPA only (`public/index.html`) — no route, permission, DTO or migration change.

## Investigation findings (prod, 2026-10-01)

- **Pulse "5th zone 0/1".** `renderOversightPulse` groups the session roster by `r.zone`. One
  at-camp student (`person_9853b2cb69286322`, form church "OTHER — Hope centre") was never
  allocated, so `church_id` is null → `zone=''` → a bar labelled `" Zone"` showing 0/1. Only
  admin/director see it (zoneLeader scope excludes zone `''`). No church login can check that
  student in. A second unallocated student exists but is not at camp.
- **First-aid Records truncation.** 195 `firstaid` notes exist (28 Sep 29 · 29 Sep 78 · 30 Sep 72 ·
  1 Oct 16); `RENDER.records` fetches `/notes/firstaid?limit=100`, so "All" and the CSV export
  silently miss the oldest ~95 records. The server applies no cap.
- **Student Data Edit bypasses both override mechanisms.** `stuSave` PATCHes `churchId`/`zone`
  directly (no `allocation_overrides` row → the next Form import, incl. the Elvanto camp job,
  reverts it) and PATCHes `accommodationKind`, which `person.service.update` writes to the
  importers' RAW column. When an `accommodationOverride` exists the effective value is
  `override ?? raw`, so the edit saves but changes nothing visible.
- The Data Import "Change church" and "Individual accommodation override" searches read
  `_allocState.regs` (lifecycle `registered` only), so **at camp the edit screen is the only route**
  to override an arrived student.

## 1. Pulse — named "Unallocated" bar

- In `renderOversightPulse` (director/admin, per-zone view) a roster row with an empty/missing
  zone is grouped under the key `__unallocated__`, labelled **"Unallocated"** (no " Zone" suffix).
- That bar always sorts **last**; the four zones keep their existing order.
- Tapping it → `go('import')`; once `_loadAllocation` has rendered, open
  `details[data-ac="unallocated"]` (card A, which already lists arrived unallocated people via
  `/import/unallocated`). Director and admin can both reach `RENDER.import`.
- zoneLeader per-church view: unchanged.

## 2. First-aid Records — dropdown + full fetch

- Replace the Today/All `.seg` with a `<select id="faRecDay">`:
  **Today** (default) · `Day N · Mon 28 Sep` for each `SETTINGS.checkInDays` entry (same label
  format as the Notes screen's Day select) · **All**.
- `_faRecFilter` holds `'today' | 'all' | 'YYYY-MM-DD'`. A day option keeps a grouped record if
  the record **or any of its amendments** has `localDateISO(createdAt) === day` (same rule as
  Today). Records outside camp days appear only under All (no "Before camp" option — none exist).
- Empty-state text: Today → "No actions logged today."; a day → "No actions logged on <label>.";
  All → "No actions logged yet."
- Fetch `/notes/firstaid?limit=1000` (was 100). Export still exports everything loaded.

## 3. Pulse — session stepping

- Card header: `Check-in pulse   ‹ Wed PM • ›` (label via `_ciLabel`, `•` when it is the current
  session). Defaults to the current session (`/checkin/sessions/current`).
- Arrows step through `/checkin/sessions` (cached in `SESSIONS` like the Check-in screen); each end
  disables its arrow. State lives in a module var (`_pulseSess`), not persisted.
- Stepping re-renders **only the pulse card** (fetches that session's `/status`), not Home.
- Arrows are compact (`.btn ghost sm`-style, `flex:0 0 auto` — rule from `camp-v107`).
- zoneLeader church-bar tap (`_pulseGoToChurch`) also sets `SEL_SESSION` to the viewed session.
- If there is no current session the card falls back to the first session rather than hiding
  (so it can still be stepped); if there are no sessions at all it hides as today.

## 4. Student Data Edit — route through the override records

- `_stuNorm` additionally carries `accommodationOverride` (already on both `/registrants` and `/campers` DTOs; the raw imported kind is NOT exposed by any DTO, and adding it is out of scope).
- **Church:** on Save, if `seCh` differs from the student's current church →
  `POST /import/allocate {personId, churchId}` (creates/updates the `allocation_overrides` row,
  sets church/zone, applies the church accommodation rule). The other fields go via the existing
  PATCH **without** `churchId/churchName/zone`.
- **Accommodation:** the select edits the *individual override*: `— (use imported)` / Tent /
  Classroom, pre-selected from `accommodationOverride`. A hint "Individual override — survives re-imports" shows when an
  override is set. Saved by PATCH `accommodationOverride` (`null` clears it). `accommodationKind`
  is no longer sent from this form.
- Order: PATCH basics → allocate (if church changed) → PATCH `accommodationOverride` (if
  changed), so the church rule can't clobber the chosen override. A failure mid-way toasts the
  error and re-renders so the table reflects what did save.
- **Add student** (`stuCreate`) is unchanged.

## Out of scope (noted, not fixed)

- A hand-added student who has not signed in is not protected from the Form-import delete sweep.
- Overrides are keyed on name + mobile; correcting a name here means a later import keyed on the
  form's old name will not re-match the override (pre-existing, same as Data Import).
- Allocating the at-camp unallocated student is a data action for the owner.

## Verification

Repo convention: no local server, no browser. `npm run typecheck` + `npm run test`; extract the
pure pieces (pulse grouping/sorting, first-aid day filter) into named functions with tests in the
existing source-extraction style where practical. Layout needs on-device eyeballing after deploy.
Bump `sw.js` cache version; update CLAUDE.md + debug.md.
