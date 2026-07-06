# CLAUDE.md — Youth Camp Platform

> **Scope:** the real **camp** app — TS/Express backend (`src/`) + `public/` SPA. The offline demos live in `../youth app demo/CLAUDE.md` (that folder is the Vercel deploy source for the **demo** at `yc-camp-demo`). **This repo auto-deploys the real app to https://my-youth-camp.vercel.app on push to `master`.** Project map: `../CLAUDE.md`. Sibling app: `../youth-allocation-platform/CLAUDE.md`. Change workflow: `../CHANGE-PROMPTS.md`.

Guidance for Claude Code when working in this package. Read this before editing.

## What this is

A **combined** youth camp management platform that merges two previously separate apps:

- **Hub** (pre-camp): registrant management, accommodation allocation, blue card & payment tracking, registration codes, FAQ
- **Portal** (at-camp): daily check-in (twice daily), student notes, zone notifications, schedule, devotionals, contact search, CSV import

An admin can switch the entire app between modes via `POST /admin/mode`. Other logged-in sessions pick up the mode change automatically on next home-tab navigation (no logout required) — `RENDER.home` re-fetches `/settings` and rebuilds tabs if `campMode` changed.

The app is **platform-agnostic**: persistence is in-memory (optionally snapshotted to JSON files), with a Supabase backend deployed to production (`PERSISTENCE=supabase`). Swapping the backend touches only `src/container.ts` + new repository implementations.

## ✅ DEPLOYED — live on Supabase (2026-06-22)

**Production: https://my-youth-camp.vercel.app** (`PERSISTENCE=supabase`). The port from
in-memory to a real Supabase backend is done and serving traffic.

| | |
|---|---|
| **GitHub** | `citipointe-youth/my-youth-camp` — **auto-deploys from `master`** |
| **Vercel** | team `citipointe-youth`, project `my-youth-camp` (serverless via `api/index.ts`) |
| **Supabase** | ref `nwfafrgojqkxylbppywo` (Sydney); all 16 tables applied; reached via `DATABASE_URL` (transaction pooler) |
| **Login** | `admin` (username, not email); password set in the DB post-deploy |

Trackers: **`CHANGELOG.txt`** (phase-by-phase + KNOWN RISKS), `docs/PROGRAM-LOG.md` (initiative log),
`docs/PROGRAM-SUMMARY.md`, `docs/CODE-QUALITY-LOG.md`, `docs/archive/` (historical).

### ⚠️ Two deploy-only gotchas — DON'T regress these (neither is caught by `tsc`/`vitest`)
1. **`tsconfig` must emit CommonJS** (`module: CommonJS`, `moduleResolution: Node`). Switching
   back to `ESNext`/`Bundler` makes `@vercel/node` crash on load with *"Cannot use import
   statement outside a module"* (it runs the traced output as CJS). Mirrors the CMS config.
2. **`.gitignore` must keep the `/data/` rule anchored** (leading slash). An unanchored
   `data/` also matches `src/data/`, which silently drops `src/data/seed.ts` from git — CLI
   deploys still work but the git auto-deploy fails with *"Cannot find module './data/seed'"*.

### Status of the bigger roadmap
- **Gate 0 passes** — `npm run typecheck` clean, **261 tests pass**.
- **Supabase repo layer is complete and wired** (`PERSISTENCE==='supabase'` branch in `container.ts`); migrations applied; all repos verified round-tripping in prod (R11 closed).
- **Phase 1 (Person unification) is COMPLETE.** The unified `Person` entity/repo/service is the live path. `/registrants` and `/campers` are lifecycle-filtered DTO views over `PersonService` — no separate Registrant/Camper services exist. The Supabase layer targets the `people` table. `docs/STEP4-SWITCHOVER.md` has been archived.
- **Fixed defects** (now compiler-confirmed): app-won't-start, accommodation availability (B1), reset/new-year (A3/A4), timezone (B3), CSV import perf + BOM (C1), remind scoping (C2), stateless auth + security headers + login rate-limit.

### Audit fixes applied (2026-06-23)
A deep audit across three areas was completed and all bugs addressed. Key changes:

**Permissions & RBAC:**
- `attendance:write` is now a separate permission from `checkin:write`. `firstAid` gets `attendance:write` (sign-in/out only); all other roles get both. `PersonService.signEvent` asserts `attendance:write`; `checkIn` still asserts `checkin:write`. firstAid is now blocked from daily session check-ins at the API level, not just the UI.

**Mode switching:**
- `RENDER.home` re-fetches `/settings` on every home-tab navigation and silently updates `CAMP_MODE` + rebuilds tabs if the admin switched mode on another device. No logout required.

**SPA bug fixes:**
- **BUG-04**: `chevron` and `clock` added to `ICONS` — firstAid rows, wizard, and schedule tab no longer show blank SVGs.
- **BUG-05**: `TAB_OF.schedule` corrected from `'home'` to `'schedule'` — firstAid Schedule tab now highlights correctly.
- **BUG-06**: Dead `api('/campers')` call removed from `renderOversightPulse` — no more double fetch on every at-camp home load.
- **BUG-07**: Leader phone numbers in search results now use `telLink()` — tappable on mobile.
- **BUG-03**: `revealMedicare` no longer re-fetches `/campers/:id`; uses `_currentCasualtyCard` set by `openCasualtyCard` — audit POST still fires.
- **BUG-09**: Director gets a wide-nav sidebar (`Home, Check-in, Search, Notes, Import, Records & Export`) instead of a blank nav. Records & Export tile already shown for director on the admin console.
- **BUG-16**: `doNewYear()` year is now `SETTINGS.year + 1` (not `new Date().getFullYear() + 1`).

**Wipe guard (BUG-01, BUG-02, BUG-19):**
- `adminNewYear()` (Admin → Data path) now redirects to the guided close-out flow instead of calling the backend without `force`/`confirmWipe`. The "Purge & start new year" button is replaced with a link to Records & Export.
- `adminReset()` now requires typing the confirmation string AND sends `force:true` + `confirmWipe` to the backend. 409 responses show a modal pointing to Records & Export.
- Admin → Data no longer has two competing new-year paths (BUG-19 resolved).

**Backend:**
- **BUG-08**: Audit controller reads settings *after* the service call so `lastExportedAt` stamp never races with `lastTempPasswords` clearing.
- Import service preserves existing `elvantoMeta` on update if the CSV row has no `dateSubmitted`.

**New tests:**
- `access-control.test.ts`: 6 firstAid permission + `canAccessPerson`/`canAccessChurch` cases (BUG-11).
- `import.service.test.ts`: 3 dry-run cases — no-persist, phantom-church, `dryRun:true` in result (BUG-10).
- `person.service.test.ts`: 4 `listMedicalWatch` cases — atCamp filter, departed excluded, church scoping, firstAid access (BUG-12).
- `admin.characterisation.test.ts`: `BadRequestError` import added; `force:true` alone throws `BadRequestError` for `newYear` (BUG-13).

## Improvement Initiative — Phases 1–7 deployed (2026-06-28)

A 7-phase improvement program (CMS engineering-maturity patterns onto this app's identity) was
completed and deployed to production on 2026-06-28. See `docs/PROGRAM-LOG.md`,
`docs/PROGRAM-SUMMARY.md`, `docs/CODE-QUALITY-LOG.md`, and the dated `CHANGELOG.txt` section.
Contract changes that supersede notes below:
- **Responsive system:** `:root` now has a fluid **type scale** (`--t-display`…`--t-micro`) and the
  `html` root font scales 16→17→18px at 768/1280. Continuous breakpoints (540/768/900/1280) sit
  before the 980px sidebar block; the content column widens 460→820px below 980. Use the `--t-*`
  tokens (and `--pad`, gender `--male/--female`, tint `--violet-d/--lav` etc.) — don't hardcode.
- **Icons:** SVG-only (no emoji). `ICONS` registry + `ic()` and new size helpers
  `icSm/icLg/icXl(n,cls)` + `emptyState(icon,msg)`. Adding a glyph = add to `ICONS`.
- **Navigation:** **single source** `navModel(role,mode)` → `{tabs,extras}`. `buildTabs` (bottom)
  and `_renderWideNav` (sidebar, via `navSidebar`) both derive from it — change nav in ONE place.
  Church/zoneLeader now have a populated desktop sidebar; admin at-camp sidebar = Home, Check In,
  Search, Notices, Accommodation Allocations, Admin Settings.
- **Budget:** REBUILT. Costs come from per-registrant `registrationCost` (NOT
  `CampSettings.tentPrice/classroomPrice`, which are now deprecated/unused — removed from the
  Settings UI, columns left in DB). Pure logic: `src/services/budget.ts` (`computeBudget`/
  `labelForAmount`/`budgetToCsv`). Categories = distinct cost per (church, camper|leader); null
  cost = "Cost not recorded" ($0, flagged, never dropped); grand total reconciles to the sum of all
  line totals. SPA `RENDER.budget`/`drawBudget` mirror it (collapsible church rows + client CSV).
- **Check-in sessions (AC-1):** `buildSessions` now makes the **first** camp day **PM-only**, the
  **last** day **AM-only**, interior days AM+PM (1-day camp = PM-only).
- **Accommodation (PC-10):** a church×gender classroom pool **>50** splits into `7-9`/`10-12`
  sub-pools (keys `${churchId}|${gender}|${bracket}`); leaders halved across brackets;
  `AllocationOccupant` gained `grade`. Single-gender/auto-fill/cascade unchanged. Tent City headings
  show total student/leader tents (PC-11).
- **Removed concepts:** "unpaid" is gone from the home DTO/UI (PC-3); FAQ/Help is pre-camp only
  (PC-7). `paymentStatus` field + reminders feature remain.
- **Service worker:** `sw.js` is now `camp-v7` (stepped v3→v4 P1 →v5 P4 →v6 P5 →v7 P6); `API_RE` includes `/export` (was missing).

### Phase 4 (first-aid login UX) — deployed 2026-06-28
- **firstAid nav** = **Search · Records · Schedule** (`navModel('firstAid')`). Search is the landing
  (no `home` tab — `gotoTab` redirects home→search for firstAid). **Medical Watch removed** (no Watch
  tab, no `/campers/medical` on the first-aid path).
- **First-aid records** = `StudentNote{category:'firstaid'}` (no migration). Body is 4 labelled lines
  `Problem:`/`Treatment:`/`First-aider:`/`Brought by:`. Written via `POST /notes` (category-scoped),
  read via **`GET /notes/firstaid`** (only firstaid category, `canAccessPerson`-scoped).
- **RBAC:** new `note:write:firstaid` (firstAid+director+admin) and `note:read:firstaid`
  (firstAid+zoneLeader+director+admin+**church**, the last own-church only). `note.service.add`
  asserts the firstaid capability **only** when `category==='firstaid'`; first-aiders can write/read
  ONLY first-aid records, never general notes/testimonies. **church can READ own-church first-aid
  records but not WRITE them** and has no general `note:read`.
- **Student Info** (renamed from "Casualty Card", `openStudentInfo`) leads with the student's
  **ministry leader** contacts (primary+secondary, via the existing `GET /search/contacts/:id`
  masked-contact path + audited reveal — no new permission); parent is the bottom fallback. Medical
  alert + consent are tone-softened; allergy-type dietary items are merged into the alert.
- **Admin Notes** (`RENDER.notes`/`drawNotes`): a **"First-aid"** Record-filter option + amber badge +
  Problem/Treatment body render; the notes CSV export already carries them (category column).
- **Tokens:** added `--ink-2` (darker secondary text) + softened `--alert-*`/`--consent-*` palette;
  all first-aid hardcoded hex tokenised (C1/C3 for these screens).

## UI/bugfix batch — deployed 2026-06-30

A small fix batch (admin-requested) shipped on 2026-06-30:
- **Account login locks (NEW).** `CampSettings` gained `churchLoginLocked` + `zoneLeaderLoginLocked`
  (both default `false`; migration `014`). Two **manual** toggles in admin **Settings**
  (`RENDER.adminSettings`/`saveSettings`, `.tgl` switch). When on, accounts of that role are
  blocked **at login only** — `auth.service.login` checks the lock *after* the password (so a
  locked account can't be probed) and throws `UnauthorizedError`. **Existing signed sessions keep
  working until their 12h TTL** (no per-request enforcement — stateless tokens carry the actor).
  admin/director/firstAid are never affected. `makeAuthService(users, settingsRepo?)` — the
  settings repo is optional (login lock is a no-op when absent, e.g. in unit tests). There is **no**
  automatic date-based trigger (deliberately dropped — the app is serverless with no scheduler).
- **Devotional editor:** the per-day **Save** button moved to the tile's **top-right**, inline with
  the day header (`RENDER.adminDevos`, `.rowsb` header row).
- **Tooltips (`helpTip`):** budget "Total registration fees" tip **removed**; long tips shortened;
  `_clampTip()` (called from `_toggleTip` on tap + a delegated `mouseover`) nudges the bubble so it
  never runs off either screen edge. Added brief at-camp tips to **first-day sign-in, daily
  check-in, My Youth, student search, testimonies**.
- **Accommodation allocations page** (`drawAccom`): heading **"Classroom rooms" → "Classrooms"**;
  **"Not in a classroom allocation" → "Classrooms (Pending Allocation)"**; the pending-allocation
  table now pads **every** column (not just the first) so it doesn't crowd on a phone, count
  right-aligned. (The separate Accommodation **setup** screen `RENDER.adminAccom` still says
  "Classroom rooms" — the rename was scoped to the allocations page only.)

## UI/UX fix batch — deployed 2026-07-01

Admin-requested batch (pre-camp). **SPA-only** (`public/index.html`) — no backend/schema change,
no migration. Verified: SPA `node --check` OK, `npm run typecheck` clean, `npm run test` = 270 pass.
- **Schedule-edit overlap (phone):** `_schedRow` grid is now `96px minmax(0,1fr) auto` (row **and**
  its header) + a `.sched-row input{min-width:0}` rule. Native `<input type="time">` keeps
  `min-width:auto` and was overflowing the fixed 92px Time track into the Activity field on narrow
  screens — the `minmax(0,1fr)` + `min-width:0` lets both inputs shrink to their tracks.
- **Setup wizard (`WIZARD_STEPS`) expanded + reordered** into a logical setup flow:
  Camp settings → Churches → Accounts → **Accommodation rooms** → **Accommodation allocation** →
  Schedule → **Devotionals** → **FAQ** → **Ministry contacts**. The four new steps (`accomAlloc`
  →`accom`, `devos`→`adminDevos`, `faq`→`adminFaq`, `contacts`→`adminContacts`) auto-detect "done"
  like the originals: allocation = any room in `/accommodation/allocations` has an occupant;
  devotionals = any `checkInDays` day has verse/reflection/prayer; FAQ = ≥1 `/faq` entry; contacts =
  any church has ≥1 named leader. ("Accommodation" → "Accommodation rooms" to distinguish it from
  the new allocation step.) Each step also carries a `tip` rendered as a `helpTip('…')` bubble beside
  its label (Bug 3 — a short tooltip per wizard item).
- **Global top loading bar (`#nprog`, NEW):** a thin accent bar under the top edge, driven from
  `_doFetch` via reference-counted `_npStart`/`_npDone` (creeps to 90%, snaps to 100% on completion,
  fades). Addresses the "screen sits still 1–1.5s after a button push" complaint (genuine serverless
  + Supabase round-trip latency; stale-while-revalidate revisits showed no loading hint). **Only real
  network requests drive it** — cached GETs bypass `_doFetch`, so instant navigations don't flash the
  bar. `#nprog` is the first child of `.app` (absolute `top:0`); tune colour/height in that one CSS rule.
- **Latency quick-win:** `_prefetch` now also warms `/accounts/churches` + `/accounts/users` for
  admin/director on login (the Accounts, Ministry-contacts and Wizard screens then open from cache).

## Feature batch — deployed 2026-07-02

Admin-requested batch (SPA + backend + **migration 016**, applied to prod):
- **Account Info (Accounts screen):** "Rename" + "Change username" are consolidated into one
  **Account Info** modal per tile (edit icon; key = password, trash = delete — the separate @
  username action is gone, `editUsername`/`saveUsername` deleted). Leadership modal = name +
  username + zone (zoneLeader) + status; church modal = church name + login username + zone +
  **accommodation override**.
- **Accommodation override (NEW):** `Church.accommodationOverride: 'tent'|'classroom'|null`
  (`churches.accommodation_override`, migration `016`). At **CSV import**, every **student** of a
  church with an override is forced to that kind (create + update paths, `churchOverrideById` map
  in `import.service`); leaders never overridden; a warning row is emitted when a CSV value is
  actually changed. Churches that deliberately split ticket types leave it unset. Set via Account
  Info; `UpdateChurchSchema.accommodationOverride`.
- **At-camp admin console:** Setup Wizard tile is **pre-camp only**; at-camp shows **"Individual
  Student Data Edit"** (`RENDER.adminStudents`, admin only): all students (merged
  `/registrants`+`/campers`), church/gender/grade filters + name search, row-tap edit of core
  fields (name, church, gender, grade, accommodation, medical, dietary) via
  `PATCH /registrants/:id`, and manual **Add student** (`POST /registrants`) created as
  `registered`/not-at-camp (signs in via First-day arrivals). Backend: registrant PATCH accepts
  `churchId/churchName/zone`; create accepts `medical`/`dietary`; **`CamperDto` gained
  `accommodationKind`**; SPA `_invalidate('/registrants')` now also clears `/campers`+`/checkin`.
- **Tooltips:** church auto-creation + override explained on the "Add a church" card and the
  wizard Churches step.

## UI/UX fix batch — deployed 2026-07-02 (at-camp bug list)

Admin-requested batch (at-camp, from "Admin Mode: at camp"). **SPA-only** (`public/index.html`) —
no backend/schema change, no migration. Verified: SPA `node --check` OK, `npm run typecheck`
clean, `npm run test` = 275 pass.
- **Daily check-in tile decluttered:** `rowHtml` (in `RENDER.checkin`) dropped the initials avatar,
  the "med" medical-flag badge, and the always-visible grey sync dot (per-row sync state is now a
  silent no-op — the existing top-of-list `ci-sync` banner is the only sync-status UI). The
  check-in button is now a primary solid pill labelled "Check in"/"Check out" (ghost once already
  checked in), sized larger than the ghost "Add note" button beside it.
- **`.pill` badges no longer wrap on phone:** ("View ›" on the Data/Budget/Accommodation nav cards
  was breaking onto two lines when squeezed by a long sibling in the same `.rowsb`) — `.pill` CSS
  gained `white-space:nowrap;flex-shrink:0`.
- **Phone-number display normalized (`fmtPhone`, NEW):** AU mobiles now always render as
  `0411 928 301` regardless of source formatting, including CSV imports that lost the leading 0 to
  spreadsheet numeric coercion upstream (a 9-digit `4xxxxxxxx` is re-prefixed with `0`). Applied
  everywhere a phone number is *displayed* (Data tab, `telLink`, first-aid leader/parent contacts,
  student search reveal, Student Info/camper detail) — editable phone `<input>` fields (ministry
  contacts editor) are untouched so admins can still type freely. Masked contact numbers
  (`0411****01`) pass through unchanged.
- **Data tab (`RENDER.data`) is sortable:** clicking a column header cycles
  unsorted→ascending→descending→unsorted (`dataSort`); unsorted is the **default import order**
  (`_dataCache` sorted by `createdAt` ascending client-side, since `/registrants` itself returns
  alphabetical order) rather than whatever order the last sort left it in.

## Multi-source CSV import (Form / Ticket List / Invoice) — deployed 2026-07-02

Elvanto now exports three separate CSVs instead of one manually-merged file. Full design at
`docs/superpowers/specs/2026-07-02-multi-source-import-design.md`. **Column headers were
corrected against a real sample** (`Sample Data New/` sibling folder, 2026-07-02) after initial
implementation — real Ticket List headers are `Event Occurrence information` (not `Event
Occurrence`) and `Invoice Payment Status` (not `Payment Status`); real Invoice/Billing Contacts
headers are plain `First Name`/`Last Name` (not `Billing First Name`), `Fees Paid` (not `Fees`),
`Total Tax` (not `Tax`). Ticket List also has a `Ticket Status` column not anticipated at design
time — a ticket whose status isn't `Active` (case-insensitive) is now skipped with a warning
rather than treated as confirmed accommodation truth (e.g. a cancelled/refunded ticket). All of
this is covered by `src/services/multi-source-import.integration.test.ts`, which runs the actual
three real sample files end-to-end through all three importers in sequence and asserts the final
state — including that the Invoice file's billing contact is often a **parent**, not the
registrant (e.g. an invoice billed to "REDACTED" covering attendee "REDACTED"),
which is exactly why invoice-number matching is tier 1 and billing-name matching is only a
fallback. The multi-alias `field(row, ...)` pattern made all of these corrections low-risk,
additive changes — no matching/merge logic needed to change.

- **Three backend services, one shared core.** `src/services/import.service.ts` (existing, Form —
  `POST /import/csv`, unchanged behaviour except the blank-clobber fix below) stays the
  authoritative full-roster import (church-scoped matching, **still deletes anyone absent from the
  file**). Two new sibling services, mirroring the existing `church-import.service.ts` pattern:
  `src/services/ticket-import.service.ts` (`POST /import/tickets`) and
  `src/services/invoice-import.service.ts` (`POST /import/invoices`) — **neither ever deletes**.
  All three share `src/services/person-matching.ts` (NEW): `findPersonMatch` (cross-church name
  index, exact-then-bounded-Levenshtein-≤2 fuzzy fallback, only auto-matches a single unambiguous
  candidate) and `mergeOwnedFields` (a field only overwrites if the incoming value is non-blank —
  the same primitive that fixed the Form-import bug below).
- **Field ownership, enforced structurally (not by convention):** Form owns grade/gender/medical/
  dietary. Ticket List owns `accommodationKind` (+ NEW `accommodationKindConfidence:
  'guessed'|'confirmed'|null` — Ticket List always sets `'confirmed'`, unconditional overwrite,
  unless `Church.accommodationOverride` applies, which still wins and is also `'confirmed'`), NEW
  `ticketNumber`, NEW `invoiceNumber`, `paymentStatus`. Invoice owns `registrationCost` (reused as
  "ticket total"), `discountCode` (reused), NEW `discountAmount`/`amountPaid`/`feesAmount`/
  `taxAmount`, and may **guess** `accommodationKind` (`confidence:'guessed'`, never overwrites a
  `'confirmed'` value) by exact-cents-matching the invoice total against a price→type table built
  **dynamically every run** from already-confirmed Ticket-List people this season (requires ≥3
  confirmed samples at that exact price AND a ≥90% kind-majority before trusting it).
- **No confident match → orphan + flag, never silently discarded (Ticket List/Invoice only).**
  Ticket List creates a new `Person` with NEW `needsReview:true` + `needsReviewReason` (no
  `churchId` — verified this makes it invisible to church/zoneLeader RBAC scoping automatically,
  visible only to admin/director). **Invoice never creates a person** — `Person.churchId` is
  non-nullable and the Invoice export has no church field, so an unmatched invoice goes into the
  response's `unmatchedInvoices[]` for manual reconciliation instead of a fabricated record. An
  invoice matching >1 person (shared invoice number) withholds all `$`/accommodation fields for
  everyone in the group (can't attribute a shared total) but still applies a flat `discountCode`.
- **Form-import blank-clobber bug fixed:** `parseGender`/the update-merge branch previously reset
  a matched person's `gender` to `'other'` (and several other fields to blank) whenever the
  current CSV row's cell was empty — a real, live bug on ordinary Form re-imports, unrelated to
  the new sources. Blank cells now preserve the existing value on update; `'other'` remains the
  create-time default only. `zone` is deliberately still unconditional (it's church-derived, not
  CSV-derived — re-importing is how it stays in sync with the church record).
- **SPA:** one upload screen, a Form/Ticket List/Invoice `.seg` source selector
  (`IMPORT_SOURCES`/`setImportSource`/`_importUploadCardHtml`, same segmented-control pattern as
  the check-in day selector) reusing the existing dry-run→preview→confirm flow, parameterized by
  endpoint. Data tab (`RENDER.data`) gained a `needsReview` filter + column (`reviewCell`/
  `openReviewModal`/`_markReviewed` — PATCHes `needsReview:false`, no merge tool, manual
  reconciliation only) and an `Accommodation` column with an amber "Guessed" pill only on
  `confidence==='guessed'` (no badge for `'confirmed'`/`null`, matching the app's only-badge-the-
  exceptional-state convention).
- **Migration `017_ticket_invoice_import_fields.sql`** — 8 new nullable `people` columns (+
  `needs_review not null default false`); also fixed a **pre-existing, unrelated** bug where
  `PERSON_UPDATE_COLS` (Supabase `on conflict do update set` list) was missing `elvanto_meta`/
  `medicare_number`/`church_unlisted_note`, so those three fields silently never updated on save.

## Bug-list batch — leader presence, sensitive notes, budget, log totals — deployed 2026-07-03

Admin-requested batch of 7 items. Design doc: `docs/superpowers/specs/2026-07-03-bug-batch-design.md`.
`npm run typecheck` clean, `npm run test` = 409 pass, SPA `node --check` OK. Migration `019`
applied to prod. `sw.js` `camp-v14`→`camp-v15`.

- **Leader at-camp presence (NEW).** `admin.service.ts` `setMode`: on the **pre-camp → at-camp**
  transition only, every non-cancelled `kind:'leader'` person not already `atCamp` is bulk
  sign-in'd (`withSignEvent` from `person-lifecycle.ts` — the same transition a normal sign-in
  uses, so `atCamp`/`lifecycle`/`signOutHistory` stay fully consistent with the presence
  invariants above) via a single `personRepo.saveMany` — **not** a per-leader round trip, so this
  can't reintroduce mode-switch latency. **(2026-07-06 addendum)** the reverse transition
  (**at-camp → pre-camp**) now also reverts everyone still `atCamp` — see "Follow-up — mode-switch
  revert" further down; the forward bulk-sign-in described here is unchanged. Leaders stay excluded from the twice-daily check-in
  roster (`checkin.service.getSessionStatus` now filters `kind !== 'leader'`) and from
  `dashboard.service`'s `checkInsDue` (same filter — a leader never gets a `checkInHistory` entry
  and would otherwise sit permanently "due"); `totalAtCamp`/`totalExpected` are **not** filtered —
  leaders count as physically at camp. SPA My Youth (`RENDER.myyouth`/`filterMyYouth`) gained a
  **"Leaders"** grade-filter option and its "Late arrivals" bucket now includes leaders (was
  student-only) — covers a leader added after the bulk sign-in already ran; they get the same
  existing "Sign in to camp" button on `openCamper`, no new UI. `signOutPrompt`/`signInPrompt` take
  an `isLeader` flag and adapt copy ("this leader" vs "this youth"; the parents-met question is
  skipped for leaders).
- **Sensitive notes/testimonies (NEW).** `StudentNote.sensitive` (migration `019`,
  `notes.sensitive boolean not null default false`). A "Mark as sensitive" toggle on both the "Add
  note" modal (`notePrompt`) and "Submit testimony" screen (`RENDER.testimonies`), default off.
  `note.service.forCamper` (the profile-notes read path) drops `sensitive:true` notes for
  `actor.role==='church'` only — zoneLeader/director/admin still see them (with a small
  "Sensitive" pill in `openCamper`'s notes list). The previously-false "Visible to zone leaders &
  directors only" subtitle on the note modal is gone, replaced by a `helpTip` describing the real
  rule.
- **Budget discount-code breakdown (NEW).** `src/services/budget.ts` `computeDiscountCodeSummary`
  (pure, tested) — each distinct `discountCode` used → count, against `totalInScope` (total
  registrants in the same scope as the rest of the budget table). SPA mirror
  `computeDiscountSummaryClient`; rendered as a new collapsible "Discount codes" card at the bottom
  of `RENDER.budget`/`drawBudget`, same collapse pattern (`_budToggle`) as the per-church rows.
- **Sign-in/out log running totals.** `audit-export.service.ts` `buildSignInOutTimeline`: the
  "Sign-in & Sign-out Log" (both the compliance workbook sheet and `exportSignInOutCsv`) is now
  **one chronological timeline** across every person (students AND leaders) instead of grouped
  per-person — two new columns, **Total Students Signed In** / **Total Leaders Signed In**, show
  the running per-kind count immediately after each row's event. Leader events from the new bulk
  sign-in flow feed into this exactly like any other event.
- **Mode-switch lag fix.** `switchMode()` (SPA) already applies the fresh `campMode` locally right
  after `POST /admin/mode` succeeds, but the `RENDER.home()` it called next unconditionally
  re-fetched `/settings` again — a 3rd sequential round-trip for no new information. `RENDER.home`
  now takes a `skipModeSync` flag; `switchMode` passes it (other already-open sessions still get
  the re-sync on their next home nav, unaffected). Also closed a related cache-correctness gap:
  `_invalidate` didn't clear `/settings` on an `/admin/mode` write, so a same-session cached read
  within the 30s TTL window could briefly see the stale pre-switch mode.
- **Review Data Import (audit, no behaviour change).** Confirmed the flow: Ticket List/Invoice rows
  that can't be confidently matched get `needsReview:true` → an amber badge on the Data tab
  (`reviewCell`) → `openReviewModal` → "Mark reviewed" (`_markReviewed`, clears the flag only,
  never auto-merges — by design). Added a `helpTip` inside `openReviewModal` explaining what to
  check (name/church spelling, accommodation/cost) before confirming.
- **Import row-order robustness (confirmed, no change).** All three importers match people by a
  name(+phone) key (`person-matching.ts` cross-church index; `import.service.ts`
  `nameChurchKey`) — never by CSV row position. Added a shuffled-row-order regression test to
  `multi-source-import.integration.test.ts`.

## Bug-list batch — audit columns, discount purpose, contacts save, Data Import nav — deployed 2026-07-03

Admin-requested batch of 6 items (from "Account: Admin, Mode: Pre-Camp"). SPA + backend
(`audit-export.service.ts`, `budget.ts`), **no schema/migration change**. `npm run typecheck`
clean, `npm run test` = 413 pass, SPA `node --check` OK. `sw.js` `camp-v16`→`camp-v17`.

- **Audit workbook columns.** Attendees sheet gained an **Accommodation** column
  (`accommodationDisplay(p.accommodationKind)` → "Tent"/"Classroom"/blank). Notes &
  Testimonies and First-Aid Records sheets both gained **Grade** + **Gender** columns.
- **Budget discount-code purpose (auto-derived, no manual entry).** Each discount code's
  card row now shows a pill like "25% Off" or "$20 Off" next to the code —
  `deriveDiscountPurpose` (`budget.ts`) averages `discountAmount/registrationCost` across
  everyone who used the code; snaps to 25/50/70/100% if within 3 points of a tier, else
  falls back to the average flat dollar amount (`purpose: null` when no one using the code
  has both fields recorded). SPA mirror `_deriveDiscountPurpose`. **`BudgetPerson` gained
  `discountAmount`** (already present on `RegistrantDto`, just not previously passed
  through to the budget calc). Also fixed a laptop-only layout complaint — the discount
  card read as a wide, mostly-empty table below the church cards — `RENDER.budget` now
  splits into a 2/3 summary + 1/3 discount-codes column at `≥980px` (`.bud-grid` CSS,
  inside the existing 980px block); stacks normally below that. The discount card still
  starts collapsed by default in both layouts (unchanged).
- **Ministry contacts save no longer blows away the whole screen.** `saveContacts(id)`
  used to call `_rContacts()` → a full `RENDER.adminContacts()` re-render (re-fetches every
  church, rebuilds every card) — which collapsed every other open card and dropped any
  unsaved edits an admin had typed into other churches while working down the list. It now
  just PATCHes and updates that one card's "N/4 Contacts" pill in place
  (`_updateContactPill`), leaving every other card exactly as the admin left it. The
  now-unused `_rContacts()` wrapper was deleted.
- **Data Import moved to its own admin console tile + nav entry.** The CSV/Excel upload
  card (`_importUploadCardHtml`) is gone from the admin **Data** screen — that screen is
  renamed **"Data Export/Reset"** (was "Data, Reset & Exports") and is export/reset-only
  now. Import lives at the previously-built-but-unreachable `RENDER.import` screen
  (`'import'` nav id), now wired up: a new **"Data Import"** tile on the admin console, and
  — **pre-camp only** — the admin bottom-nav Notices tab is replaced with a **Data Import**
  tab (new `upload` icon in `ICONS`). Notices is still reachable pre-camp via a new button
  at the top of **Admin Settings** (`RENDER.adminSettings`). **At-camp admin nav (desktop
  sidebar) is unchanged** — Notices stays there; this was a deliberate scope decision (the
  bug list didn't specify a mode, and the owner chose pre-camp-only for the swap).

## Elvanto export guide on the import screen — deployed 2026-07-03

**SPA-only** (`public/index.html` + static images), no backend/schema change. The import upload
card (`_importUploadCardHtml`, both `RENDER.adminData` and `RENDER.import`) gained a ghost button
**"How do I export these files from Elvanto?"** → `openImportGuide()`, a full-screen 3-step
screenshot walkthrough (`#impGuide` overlay in the shell; `IMPORT_GUIDE` data; `_igDraw`/`_igGo`/
`_igZoom`/`_igTs`/`_igTe`). One step per import file — Form / Ticket List / Billing Contacts —
each with a short caption + real Elvanto screenshots served from **`public/img/import-help/`**
(`form-export.png`, `events-export.png`, `ticket-export.png`, `billing-export.png`; the Ticket
List step shows two images: where the Events Export button is, then the export popup). Steps
flick via ‹/› buttons, dot indicators, or **touch swipe** (≥48px horizontal); screenshots are
wide Elvanto strips so **tap-to-zoom** toggles a 220%-width horizontally-scrollable view
(`.ig-imgwrap.zoom`) for phones. `sw.js` `camp-v15`→`camp-v16` (HTML changed; images ride the
normal cache-first static path).

## First-aid export + login-enumeration hardening — deployed 2026-07-03

- **First-aid Records CSV export (SPA):** `RENDER.records` gained an **Export** button →
  `exportFaRecords()`, which builds a CSV client-side from the already-loaded `window._faRecsAll`
  (via `_faParse`) — columns Student/Problem/Treatment/First-aider/Brought by/Logged by/Logged at,
  filename via `_exportName`. **No backend or permission change** (firstAid holds only
  `note:read:firstaid`). Exports the loaded records (`/notes/firstaid?limit=100`), not just the
  on-screen filter.
- **Login user-enumeration hardening (backend, `auth.service.login`):** a missing / inactive /
  passwordless account now runs an **equal-cost dummy scrypt** (`DUMMY_PASSWORD_HASH`) and returns
  the same `Invalid credentials` as a wrong password — previously an unknown username skipped
  scrypt (fast) and a passwordless account had a distinct message, which (with the login limiter
  keyed per ip+username) was a usable timing/message oracle. `auth.service.test.ts` +3 (395 pass).
  **Deliberately NOT changed:** the stateless-token trade-off where a deactivated user's existing
  token stays valid to its 12h TTL — closing it needs a per-request DB lookup (user-facing latency).
- **`sw.js` is now `camp-v13`** (v9→v10→v11 import/Excel →v12 security headers/CSP →v13 first-aid export).

## Bug-list + import redesign + Excel + security headers — deployed 2026-07-02 (late)

Large admin batch (SPA + backend + **migration 018**). `npm run typecheck` clean, `npm run test`
= 275→**392 pass**, SPA `node --check` OK. sw.js `camp-v9`→`camp-v12`.

- **Import UI REDESIGNED — SUPERSEDES the segmented-selector description in the multi-source
  section above.** The manual Form/Ticket/Invoice `.seg` picker is **gone**. One upload field
  (`_importUploadCardHtml`) takes **1–3 files at once**; each file's type is **auto-detected from
  its column headers** (`_detectImportType`/`_IMPORT_SIGNATURES`), so a file can't be sent to the
  wrong importer. Files run in dependency order **Form→Ticket→Invoice** in a single combined
  preview→confirm (`adminUpload`→`_renderImportPreview`→`_confirmImport`). Unknown files are
  rejected with their columns shown + a manual type/skip choice (`_renderImportUnknown`). No file
  is mandatory. Per-source **last-imported** timestamps show on the screen (`_loadImportStamps`).
  The three backend import endpoints/services are **unchanged**; the redesign is SPA-only plus a
  controller-layer timestamp stamp (`src/api/controllers/_import-stamp.ts`).
- **Excel (.xlsx/.xls) import:** vendored **SheetJS** at `public/vendor/xlsx.full.min.js`,
  **lazy-loaded** on first Excel use (`_ensureXlsx`; same-origin so CSP `script-src 'self'`
  allows it; no eval/Function). `_readImportFile` converts Excel→CSV (`_xlsxToCsv`, header-matched
  sheet selection) then the CSV pipeline is unchanged. (CMS + its Connection Audit already have
  Excel via their own dependency-free `readXlsx` — no CMS change was needed.)
- **Migration 018** (`018_defaults_and_import_timestamps.sql`, applied to prod) — 4 nullable
  `timestamptz` on `settings`: `defaults_saved_at` (bugs 6/10 — shown on the Data screen's Save
  Defaults card + the close-out checklist; stamped in `admin.service.saveDefaults`) and
  `form/tickets/invoices_imported_at` (the import last-upload lines). **`supabase.settings` writes
  ALL settings columns on every save**, so this HAD to be applied before/with deploy.
- **Audit workbook 500 FIXED** (`audit-export.service.ts`): worksheet name `'Sign-in/Sign-out Log'`
  had an illegal `/` → ExcelJS threw on `addWorksheet`, so the download had **never** worked.
  Renamed to `'Sign-in & Sign-out Log'`. Added a dedicated **First-Aid Records** sheet (parsed
  4-line body; excluded from Notes & Testimonies). Regression test: `audit-export.service.test.ts`.
- **Compliance filenames** now include camp year + export date (`_exportName`).
- **First-aid Search/All-Students → profile fix:** `openStudentInfo`/`openFirstAidLog` now paint
  the **active** first-aid screen (`_faScreen()`) instead of hard-coding `'search'` (which
  `paint()`'s stale-guard dropped when on the `allstudents` screen); Back is origin-aware.
- **Add-note button** on student profiles (`openCamper`, `stuEdit`), camper-only + note-writer-only.
- **Director at-camp home** hides the Notices tile (nav unchanged). **Phone overscroll/side-drag**
  fixed via `.screen{overflow-x:hidden;overscroll-behavior:contain}` + body `overscroll-behavior`.
  **Church tooltip** moved to the Churches list tile. **Laptop tooltip** flips up near the bottom
  edge (`_clampTip` + `.htip-pop.flip-up`).
- **Security headers (zero user friction):** `express-adapter` disables `X-Powered-By`; adds HSTS
  (prod), COOP+CORP `same-origin`, and `Cache-Control: no-store` on API/export responses (static
  stays cacheable); CSP meta gained `frame-ancestors 'none'`.

## App icon + home-hero brand mark — updated 2026-07-02

The Home Screen (PWA "Add to Home Screen") icon was a thin outlined triangle in an off-brand
navy/blue that didn't match the app's actual purple/violet palette and didn't read as a tent.
Replaced via a brainstormed multi-option review (4 SVG concepts sent to the user for comparison
at both full size and realistic 60/76px home-screen size before picking one).
- **`public/icons/icon.svg`** — new design: the app's real header gradient (`#7c3aed`→`#1e1b4b`,
  135deg, matching `.hero`/header exactly) on a rounded-square (`rx="96"`), with a proper white
  A-frame tent (sloped roof, mid-purple `#9333ea` triangular door flap for depth, a ground line,
  two guy-lines) and a simple white cross standing above the peak like a chapel-tent flag. Content
  is kept within the maskable-icon safe zone (roughly a centered 80%-diameter circle) so it
  survives OS circle/squircle cropping. `manifest.json` is unchanged (already `"sizes":"any"`,
  `"purpose":"any maskable"`, SVG-only — no PNG generated yet).
- **`public/sw.js` `CACHE` bumped `camp-v7`→`camp-v8`** — the service worker cache-firsts icons,
  so without a version bump, anyone who already added the app to their home screen would keep
  seeing the old icon indefinitely.
- **Gap closed (2026-07-04):** `public/icons/icon-180.png`/`icon-192.png`/`icon-512.png` exist,
  match the SVG design, and are referenced by both `index.html` (`apple-touch-icon` +
  `<link rel="icon">`) and `manifest.json`. The SVG stays the manifest's `sizes:"any"` entry.
- **`heroMark()` (NEW, `public/index.html`)** — a reduced-detail, 16%-opacity white version of the
  same tent+cross mark (no background square, just the line art), absolutely positioned on the
  right side of a `.hero` card. Added as the **first child** of both Home hero cards (pre-camp
  `RENDER.home` and at-camp `renderHomeAtCamp`) so it paints behind the greeting text, matching
  how `.hero`'s existing `:before`/`:after` decorative circles already behave (`.hero` already has
  `position:relative;overflow:hidden`, so the mark clips cleanly like those do). Not used anywhere
  else — if a fifth hero-style card gets added later (budget, devotional) and should also carry
  the mark, call `heroMark()` there too rather than duplicating the SVG markup.

## Security & perf hardening ported from CMS — 2026-07-02

- **CSP meta tag** (`public/index.html` `<head>`): defence-in-depth alongside the SPA's escaping
  discipline. `'unsafe-inline'` stays for script-src/style-src (required by the inline-script/
  onclick architecture); the policy blocks external script/resource loads it doesn't need.
  `style-src`/`font-src` allow Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com` — Plus
  Jakarta Sans, the app's only external resource); `connect-src 'self'` covers all API calls
  (relative paths only). **A CSP typo isn't caught by tsc/vitest** — after any change to the
  policy, hard-load the prod URL and check the browser console for CSP violations. `sw.js`
  `CACHE` bumped to `camp-v9` alongside this change (HTML changed).
- **Server-side response cache** (`src/utils/response-cache.ts` + `src/services/dashboard-cache.ts`,
  ported from CMS): a 30s-TTL in-memory cache wraps the `/home` dashboard DTO
  (`dashboard.service.ts`). Cache key is `${role}:${churchId ?? '_'}:${zone ?? '_'}` — **must**
  include actor scope, since the DTO is role/church/zone-scoped and a shared key would leak one
  church's data to another. `invalidateDashboardCache()` is called from every write that can
  change the DTO (person create/update/remove/checkIn/signEvent, all 4 import services,
  admin reset/newYear/clearNotifications, settings update/setMode, notification send/remove/
  clearAll, account church create/update/delete) — when in doubt the rule was invalidateAll,
  correctness over hit rate. **Lives in its own module** (`dashboard-cache.ts`, not inside
  `dashboard.service.ts`) to avoid a circular import: `dashboard.service.ts` already imports
  `canAccessPerson` from `person.service.ts`, so a writer-side import back from
  `dashboard.service.ts` would cycle. Deliberately **not** applied to
  `checkin.service.getSessionStatus` — the at-camp roster must stay live. Same serverless
  caveat as CMS: only helps within a warm instance.

## Unallocated registrants & church-allocation overrides — implemented 2026-07-03 (branch)

Design: `docs/superpowers/specs/2026-07-03-unallocated-registrants-allocation-design.md`; plan:
`docs/superpowers/plans/2026-07-03-unallocated-registrants-allocation.md`. Backend + SPA + **migration
`020_allocation_overrides.sql`** (⚠ **apply to prod before/with deploy**). `sw.js` `camp-v17`→`camp-v18`.
`npm run typecheck` clean, `npm run test` = **431 pass**.

- **Unallocated sentinel church.** A registrant whose `Attendee's Church` is the exact literal
  `OTHER - please specify below` (or blank) is assigned `churchId = '__unallocated__'`
  (`UNALLOCATED_CHURCH_ID`, `churchName = 'Unallocated'`, `zone = ''`) instead of the old behaviour
  of auto-creating a junk church from that string. Constants + pure helpers live in
  `src/services/church-allocation.ts`. Sentinel people are RBAC-invisible to church/zone logins
  (scoped by churchId; `zone=''` keeps zoneLeaders out) and are excluded from accommodation grouping
  (`accommodation.service.ts` `occupants()` filters the sentinel). They surface as an "Unallocated"
  bucket in budget (informative, low priority).
- **Persistent overrides.** `AllocationOverride` (`src/core/entities/allocation-override.ts`, table
  `allocation_overrides`, repo trio + `container` wiring) records a MANUAL church allocation keyed by
  the person's name(+mobile) identity. The **Form importer** (`import.service.ts`) re-applies them at
  church-resolution time (`matchOverride`, before zone/accommodation are derived), so a manual
  allocation **wins over the CSV on every re-import**, survives the delete-absent sweep (never deleted
  or duplicated), and automatically inherits the assigned church's zone + accommodation override.
  Duplicate name+mobile → skipped with a warning (never mis-assigned). Overrides whose person withdrew
  (absent from a re-import) are pruned. Purged by reset/new-year (`admin.service.ts`).
- **API + RBAC.** New `allocation:manage` capability (**director + admin**). `allocation.service.ts` +
  `allocation.controller.ts`: `GET /import/unallocated`, `GET /import/allocations`,
  `POST /import/allocate {personId,churchId}` (upserts override + moves the person + applies the
  church accommodation override immediately, via the shared `accommodationKindForChurch` helper),
  `DELETE /import/allocations/:id` (reverts to sentinel, or to the form's named church for `override`
  kind). Allocation target = existing churches only.
- **SPA.** `RENDER.import` (Data Import screen) gained two cards below the upload: **"Unallocated
  registrants (N)"** (per-person church dropdown + Confirm) and **"Church overrides / forced
  allocations (N)"** (the tracked list with Undo + a name-search "Override a church allocation" control
  with a confirm modal). `_loadAllocation`/`_renderAllocCards`/`allocatePerson`/`overridePrompt`/
  `confirmOverride`/`undoOverride`; the SPA's `UNALLOCATED_ID` must match the backend constant.

## Admin bug batch + offline sign-in + director digest — deployed 2026-07-04

Large overnight admin-requested batch (8 numbered bugs + 2 new features), SPA + backend +
**no schema migration** (reused existing `amountPaid`/`formImportedAt` columns). `npm run
typecheck` clean, `npm run test` = **442 pass** (11 new), SPA `node --check` OK. `sw.js`
`camp-v18`→`camp-v20` (two HTML-changing pushes in the batch).

- **Director navigation restored.** Director had `import:run`+`allocation:manage`
  (`access-control.ts`) and `RENDER.import`/`RENDER.adminData` already accepted director, but
  `navModel` gave director no route to either in any mode — a regression. `RENDER.data` (the
  pre-camp "Data" tab, also reachable at-camp via the home tile "Student Data Table") now has
  two buttons: **Data Import** (`go('import')`) and **Records & Export** (`go('adminData')`).
  `RENDER.adminData`'s Close-out and Clear-notifications cards are now `isAdmin`-gated (same
  pattern as Save Defaults/Factory Reset) so a director viewing via this new route never sees an
  action the backend would 403 on.
- **Brisbane-anchored "today" (`localDateISO()`, NEW).** `new Date().toISOString().slice(0,10)`
  is UTC, so anywhere from midnight to 10am Brisbane it read yesterday's date. New helper
  mirrors the backend's `zonedNow()` via `Intl.DateTimeFormat('en-CA',{timeZone:'Australia/
  Brisbane'})`; takes an optional instant to convert (used to compare a server `createdAt`
  timestamp against "today" in Brisbane, not just slice its UTC date). Fixes `_realCampDayNumber()`
  (header Day badge + the home-tile First-Day/Testimonies switch, which reads it) and
  `drawFaRecords`'s "Today" filter on First-aid Records.
- **"Not Signed In" section on check-in (`RENDER.checkin`, NEW).** A collapsed `<details>` at
  the bottom of the daily check-in screen listing the viewer's scoped students with
  `atCamp!==true` — ANY lifecycle stage (never-arrived AND already-checked-out/departed), fetched
  via `/registrants`+`/campers` in parallel with the roster status (same dedup pattern as
  `RENDER.firstday`). Each row has a direct "Sign in to camp" button (`signInPrompt`). Does not
  touch `checkin.service`'s roster contract (still atCamp-only).
- **Zone-leader per-church pulse (`renderOversightPulse`).** zoneLeader's home pulse now groups
  by `r.church` instead of `r.zone` (their roster is already zone-scoped, so the old zone grouping
  produced one aggregate bar) — amber below **70%** (`PULSE_AMBER_PCT`, new `.bar7.amber` CSS).
  Tapping a church bar sets `FILTER.church` and jumps to Check-in (`_pulseGoToChurch`). Director/
  admin deliberately KEPT the existing per-zone bars (would be 10+ bars camp-wide otherwise).
- **Setup wizard + return chip + console regroup.**
  - `WIZARD_STEPS` gained an **"Import registrations"** step between Accounts and Accommodation
    rooms (done-check: any person exists OR `settings.formImportedAt` set) — **10 steps total**.
  - **"Back to setup (step N of 10)" chip**: a *persistent* banner (`_wizardChipHtml`, hooked into
    `paint()` itself) shown on any screen that's a `WIZARD_STEPS` target while a
    `sessionStorage['ycp_wizardReturn']` flag is set — set by `_wizardGo(i)` when a wizard row is
    tapped, cleared on returning to `RENDER.adminWizard` or on logout. Deliberately NOT wired into
    each individual save handler (~10 screens) — one shared hook instead.
  - **Admin console tiles regrouped** under three headings (`RENDER.admin`), **re-ordered again
    same day** per follow-up feedback — current final order:
    - **Camp setup**: Setup Wizard → Camp settings → Accommodation → At-Camp Info → Switch mode.
    - **People & churches**: Accounts & churches, Ministry contacts.
    - **Data**: Data Import, Data Export/Reset (Records & Export for director), + Individual
      Student Data Edit (at-camp only — not explicitly specified in the reorder request, kept
      here as the closest fit since it has no other home in this console).
- **Batch schedule saves.** New `PUT /schedule/day` (`schedule.service.ts` `replaceDay`,
  `IScheduleRepository.replaceDay` — in-memory does delete+re-set on the Map, Supabase does
  delete-then-multi-row-insert inside one `sql.begin` transaction) replaces `saveSchedDay`'s old
  N-deletes-then-N-creates loop. **`Route`/`BufferRoute` method unions and the Express adapter's
  method cast had no `'PUT'`** — added, since this was the first `PUT` route in the app (also
  added to `Access-Control-Allow-Methods`).
- **Copy/label/trust batch.**
  - `_paintPerson`'s "Paid" field showed `registrationCost` (ticket price, not what was actually
    paid). New `_paidOrCostRow(s)`: shows `amountPaid` labelled **"Paid"** when an Invoice import
    recorded one, else `registrationCost` labelled **"Cost"**.
  - Check-in screen's stale "Notes visible to zone leaders & directors only" hint corrected to
    match the real rule (church sees non-sensitive notes too).
  - `RENDER.notes` subtitle: **"Your zone: `<zone>`"** for zoneLeader (was hardcoded "All zones ·
    whole camp", never true for a zone-scoped read); director/admin unchanged. Also gained an
    optional `presetFilter` param (used by the new digest card below) that pre-selects a Record
    filter option.
  - `RENDER.adminAccom` (accommodation **setup** screen): "Classroom rooms" → **"Classrooms"**,
    matching the allocations page (the two screens had drifted).
  - `notePrompt`'s leader-name field already prefilled from `LAST_LEADER` — `reviewNote` no
    longer *requires* it (backend already attributes the note to the logged-in actor; the typed
    name is just folded into the body as a "logged by" annotation when present).
- **Schedule/FAQ/Devotionals condensed → "At-Camp Info" (`RENDER.atCampInfo`, NEW).** One admin
  screen with three sub-tab buttons (Schedule/FAQ/Devotionals, defaults to Schedule) replacing
  three separate console tiles/nav entries. Old `RENDER.adminFaq`/`adminDevos`/`adminSchedEdit`
  bodies became internal content-builders (`_acFaqBody`/`_acDevosBody`/`_acScheduleBody`) called
  by the merged screen; `_rFaq`/`_rSched` re-render helpers now call `RENDER.atCampInfo('faq'|
  'schedule')`. `WIZARD_STEPS`' schedule/devos/faq rows still route here, each pinned to its own
  sub-tab via `go('atCampInfo', arg)`. (`adminFaqEdit` — a pre-existing, already-unreachable
  at-camp FAQ screen with no nav path to it — was left alone, out of scope.)
- **Offline Sign-In (NEW, `src/services/offline-signin.service.ts`).** Fallback bulk sign-in for
  churches who prefer paper/bulk sign-in over the app, at the bottom of the Data Import screen.
  `GET /export/offline-signin` (exceljs) builds ONE workbook — every registered **student**
  (leaders excluded), all churches, sorted by church then surname — columns First/Last/Church/
  Gender/Grade + blank **"Signed In?"**, with an obviously-fake "Sample Student" row demonstrating
  `Y`. `POST /import/offline-signin` re-parses a filled sheet (`parseCsv`) and bulk-signs-in every
  row marked exactly `Y` that matches an existing student by **First+Last+Church text** (no id
  column) and isn't already `atCamp` — via the same `withSignEvent`+`saveMany` bulk pattern as the
  leader bulk sign-in in `admin.service.setMode`. The Sample row is matched by name and always
  skipped, regardless of what's typed in its Church cell. SPA reuses the existing client-side
  `_readImportFile` (CSV/Excel via lazy SheetJS) to parse the upload, then POSTs the raw CSV text
  — the backend does all matching (consistent with the Form/Ticket/Invoice import architecture,
  and testable with vitest). A plain `confirm()` gate precedes the POST (no separate dry-run mode
  — a lower-effort deliberate choice for this fallback feature). 9 new tests
  (`offline-signin.service.test.ts`).
- **Director + admin morning digest card (NEW, at-camp home hero).** "Day N · X/Y checked in
  this session · Z churches complete · K first-aid records today", each figure tappable
  (`_digestCardHtml`/`_renderDirectorDigest`, same paint-immediately-then-inject-async pattern as
  `renderOversightPulse`, called un-awaited from `renderHomeAtCamp`). Required one backend DTO
  addition: `AtCampDashboard.sessionExpected` (the atCamp-non-leader population subject to the
  CURRENT session — same population `checkInsDue` is computed against) so the SPA can derive
  "X/Y checked in" as `sessionExpected - checkInsDue` / `sessionExpected` with no extra fetch.
  "Churches complete" re-fetches `/checkin/sessions/current` + status independently of
  `renderOversightPulse` (harmless — both hit the SPA's 30s client `Cache`, so this is a cache hit
  in practice, not a second real network call) and groups by church (`done===total`, regardless
  of the per-role pulse-bar grouping above). "First-aid records today" fetches
  `/notes/firstaid?limit=100` and filters via `localDateISO()`. Tapping "churches complete" or the
  check-in ratio jumps to Check-in; tapping first-aid jumps to `RENDER.notes` pre-filtered
  (`go('notes','firstaid')`) — reachable for admin too via their existing "Testimonies & Notes"
  home tile even though admin has no permanent nav entry to Notes at-camp.
- **`icons-180/192/512.png` gap (CLAUDE.md correction only, no code change).** These PNGs already
  existed, matched the SVG design, and were already referenced in `index.html`+`manifest.json` —
  the "known gap, not yet fixed" note below was stale from an earlier session and has been
  corrected in place.

## Bug batch — Unallocated FK crash, at-camp Data tab, preview banner, Reg type — deployed 2026-07-06

Admin-requested 3-bug batch. `npm run typecheck` clean, `npm run test` = 442 pass, SPA
`node --check` OK. No migration.

- **Unallocated-import crash FIXED (Supabase-only, not caught by vitest).** `people.church_id`
  has a real FK to `churches(id)`, but the `__unallocated__` sentinel (church-allocation.ts,
  2026-07-03) was never a `churches` row — writing it threw a foreign-key violation, surfaced
  to the SPA as the generic "An unexpected error occurred". `src/repositories/supabase/
  supabase.people.ts` now maps the sentinel to/from SQL `NULL` at the I/O boundary
  (`personColumns`/`toPerson`/`findByChurch`) — `NULL` is already FK-legal (`on delete set
  null`) and the domain model never sees it; `Person.churchId` still always reads as either a
  real id or `__unallocated__`. **Prod data note:** 10 people already sat with `church_id
  NULL`/`church_name 'OTHER - please specify below'` from an old auto-created "OTHER" church
  that had since been deleted (its FK cascade nulled `church_id` but left the denormalized
  `church_name`/`zone` stale) — this is what made a re-import see them as "absent" (10
  flagged for deletion) while the replacement row crashed on save. One-off prod SQL
  corrected their `church_name`→`'Unallocated'`/`zone`→`''` in place (same ids, no data
  loss); the repo fix means they now round-trip correctly on every future import.
- **Data tab missing at-camp leaders FIXED.** `RENDER.data` (the Data/registrants table) only
  fetched `/registrants` (`lifecycle==='registered'`). At-camp, **every leader is bulk-signed-in
  on the mode switch** (2026-07-04 presence feature) — their lifecycle becomes `arrived`, which
  drops them out of `/registrants` permanently, since nothing ever demotes a camper back to
  registrant. Regular students don't show this since they're promoted individually as they
  physically arrive. `RENDER.data` now also fetches `/campers` and merges in any not already
  present by id (same dedup pattern as `RENDER.firstday`), so the table always shows the full
  roster regardless of lifecycle. `CamperDto` gained `registrationType` (was registrant-only)
  so the "Reg type" column doesn't go blank for a merged-in camper row.
- **"Reg type" column wired to real data.** It read a `Type`/`Registration Type` Form CSV
  column that doesn't exist in any real Elvanto export (Form/Ticket List/Invoice all lack it) —
  always blank. `ticket-import.service.ts` now stores the Ticket List's real `Ticket Type` text
  (e.g. `"EARLY BIRD | Tent Accomodation"`) as `registrationType` (added to the service's
  `OWNED_KEYS`, same never-clobber-with-blank rule as `ticketNumber`/`invoiceNumber`).
- **Preview banner code-spill fixed.** `${ic('preview')}` sat in static `<body>` HTML markup
  (not a JS template literal), so the browser printed it literally instead of rendering the
  SVG. `#previewBanner .pb-label` is now an empty span (`id="pbLabel"`) filled via
  `ic('preview')` at boot, once `ICONS`/`ic` are defined.

## Follow-up — mode-switch revert, Budget/Data leader visibility — deployed 2026-07-06

Same-day follow-up after the batch above: the admin flagged leaders were still missing from
Budget and Home, with Cost blank on the Data tab. Root cause (found by querying prod
directly): the camp had at some point been switched to at-camp (bulk-signing in leaders and
some students who then signed in for real testing) and back to pre-camp — but `setMode` only
ever handled the forward transition, so everyone who was `atCamp` stayed stuck at
`lifecycle:'arrived'`/`atCamp:true` even in pre-camp mode, invisible to every screen that reads
the registrants view (`lifecycle==='registered'`). `npm run typecheck` clean, `npm run test` =
444 pass (2 new), SPA `node --check` OK. No migration.

- **`admin.service.ts` `setMode` now reverts on at-camp -> pre-camp.** Mirrors the existing
  forward bulk-sign-in: anyone still `atCamp` (any kind, not just leaders — a student who
  individually signed in during at-camp testing has the same problem) is force-set back to
  `lifecycle:'registered'`/`atCamp:false` with an audit `SignOutEvent` appended (reason "Camp
  mode reverted to pre-camp"). This bypasses `withSignEvent`/`applyCheckIn` deliberately — the
  presence model has no normal transition back to `'registered'` (arrived/checked_out only
  cycle between each other), so a direct field assignment is the only way to undo the forward
  bulk transition. Already-cancelled or already-checked-out people are untouched. **One-off
  prod data correction** applied the same revert directly via SQL to the 10 leaders + 15
  students already stuck this way (same ids, `sign_out_history` audit rows added to match what
  the code now does automatically).
- **`switchMode()` (SPA) warns before reverting to pre-camp** — the confirm dialog now says
  anyone currently signed in at camp will be automatically signed out.
- **Budget now includes arrived leaders/students.** `RENDER.budget` only fetched
  `/registrants` — same gap as the Data tab fix above. Now merges `/campers` in (deduped by
  id, same pattern). `CamperDto` gained `registrationCost`/`discountCode`/`discountAmount` so
  a merged-in camper row prices and discount-codes correctly (`registrationType` was already
  added for the Data tab's "Reg type" column — `exportBudget()` and the discount-codes card
  get this for free since they both read the same merged `window._budgetRegs`).

## Church home screen simplification — deployed 2026-07-06 (SPA-only)

Admin request, church role only, both modes. No backend/schema change.

- **At-camp: Notices tile removed from church home.** `renderHomeAtCamp`'s tile-building now
  excludes `ACTOR.role==='church'` from the Notices quick-tile (mirrors the existing
  director exclusion) — church still reaches Notices via its bottom-nav tab, just not as a
  home tile.
- **Pre-camp: tent/classroom breakdown replaced with two simple tiles for church.** The
  "Registrations by accommodation" 4-tile band (Student/Leader × Tent/Classroom,
  `statband-4`) is now conditional on role — church instead gets a plain 2-tile
  `.statband` ("Students" / "Leaders", from the already-scoped `h.totalCampers`/
  `h.totalLeaders`); zoneLeader/director/admin are unchanged. The existing "Your
  registrations" total card just below (with its own "X campers · Y leaders" sub-line) was
  left as-is — not explicitly in scope.

## First-aid pre-camp testing — deployed 2026-07-06

Admin request. Superseded an earlier same-day approach (a dedicated sample church + 25 fake
students, fully reverted — see git history around commit `6c3bf3d` if it ever needs
resurrecting) once a cleaner fix was found: first-aid can already **search** any real
registrant regardless of arrival status (`search.service.ts` already lets `firstAid` see
`isRegistrant` people, not just `isCamper` ones — pre-existing, not new). The actual gap was
`note.service.ts`, which required `isCamper()` before a first-aid record could be
created/read at all — meaning first-aid record-keeping was completely untestable pre-camp
(nobody is a "camper" until the real Day-1 sign-in), and would have stayed broken even
against fake sample data seeded as `lifecycle:'registered'`. `npm run typecheck` clean,
`npm run test` = 450 pass (10 new). No schema change, no fake data.

- **`note.service.ts` `firstAidEligible(actor, person)`** — `isCamper(person) ||
  (actor.role==='firstAid' && isRegistrant(person))`. Used in place of the bare `isCamper`
  check in both `add()` (creating a record) and `recentFirstAid()` (reading them back).
  Every other role's note-eligibility is unchanged — only firstAid gets the pre-camp
  allowance, and only for people it can otherwise already access. A cancelled person is
  still never eligible for anyone.
- **`admin.service.ts` `setMode`** — on the real pre-camp → at-camp transition (same branch
  as the existing leader bulk-sign-in), every `category:'firstaid'` note is deleted. Safe and
  unambiguous: a real first-aid incident cannot happen before the camp is physically live, so
  every first-aid record that exists while still in pre-camp mode is by definition a test one.
  Testimonies and general notes are untouched.

## Commands (run from this folder)

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4200 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest
```

Default port: **4200**. Set `PORT=xxxx` to override.

> **Verify & deploy convention:** verify changes with `npm run typecheck` + `npm run test` (+ grep/
> reasoning) — **do not start a localhost dev server or drive a browser to test**, and flag CSS/
> layout changes for the user to eyeball on-device. GitHub is linked to Vercel, so a **push to
> `master` is the deploy** — no need to poll Vercel or curl prod to confirm it shipped.

### Persistence modes & env vars

| `PERSISTENCE` | Backend |
|---|---|
| `memory` (default) | In-memory; demo seed runs on startup |
| `json` | In-memory + JSON files in `DATA_DIR` |
| `supabase` | Supabase Postgres (requires `DATABASE_URL`) — **the live production backend** (ref `nwfafrgojqkxylbppywo`; use the transaction-pooler URL on port 6543, not the IPv6-only direct host) |

```
PORT=4200
NODE_ENV=production
PERSISTENCE=supabase           # production; "memory" for local dev with seed data
DATABASE_URL=<supabase-connection-string>
SESSION_SECRET=<32+ random bytes>   # REQUIRED in prod — tokens are forgeable without it (warns on startup)
DATA_DIR=./data                # only for PERSISTENCE=json
CORS_ORIGINS=https://camp.<your-domain>   # lock this; '*' warns in prod
```

Auth is **stateless HMAC sessions** (signed with `SESSION_SECRET`) — no server-side token
store, so logout is client-side and tokens stay valid until their 12h TTL.

### Production DB config — role-level query timeout (NOT in migrations, 2026-07-06)

`ALTER ROLE postgres SET statement_timeout = '15s'` is applied on the prod DB (ref
`nwfafrgojqkxylbppywo`). The per-connection `statement_timeout: 15000` in `client.ts` is
**not reliably enforced through the pooler** (CMS proved a trivial query ran 4+ min despite
it), so the ceiling is enforced at the DB-role level like Supabase's own roles. This lives
on the role, **not** in `supabase/migrations/` — it survives new-year rollover but **must be
re-applied if the Supabase project is ever recreated.** Verify with
`select rolconfig from pg_roles where rolname='postgres';`.

### Planned: session-mode pooler cutover — see `docs/SESSION-MODE-CUTOVER.md`

To survive the camp AM-check-in burst (100–200 leaders), the plan is to switch the pooler
from **transaction mode (port 6543)** to **session mode (port 5432)** — the fix that ended
the CMS outage. **Not yet done** (gated on the paid upgrade for the camp burst test; the
cutover itself can happen anytime — the runbook splits it into "do now" vs "at upgrade").
Two env gotchas that matter here:

- **The app reads only `DATABASE_URL`** (`src/config/env.ts`) — never `POSTGRES_URL*` or any
  other var the **Supabase→Vercel integration** syncs. So the integration's env sync does
  **not** control the app's DB connection *as long as `DATABASE_URL` is a manually-set Vercel
  var* (which it is — `DATABASE_URL` is not a name the integration manages). Switch modes by
  editing that manual var's port; a resync can't revert a var the integration doesn't own.
  **Still, re-verify `DATABASE_URL` is present + on the intended port after any upgrade or
  integration resync.**
- **Session mode = the Supabase *Session pooler* string** (`aws-…pooler.supabase.com:5432`,
  user `postgres.<ref>`). Do **not** use the *Direct connection* (`db.<ref>.supabase.co:5432`,
  IPv6-only — won't work on Vercel) or the integration's `POSTGRES_URL_NON_POOLING` (that's
  the direct one). Both are port 5432 but different hosts.

## Architecture

```
api (Express) → controllers → services → repositories (interfaces) → core
```

- **`src/core/`** — pure types, entities, enums, Zod schemas, errors. No imports from other layers.
- **`src/repositories/`** — interfaces (DB-swap surface) + in-memory implementations + JSON file persistence.
- **`src/services/`** — all business logic + RBAC. Depend on repo *interfaces* only.
- **`src/api/`** — thin controllers → declarative route table (`http/router.ts`) → Express adapter. Express lives only under `src/api/http/` and `src/api/middleware/`.
- **`src/container.ts`** — composition root. The only file that names concrete repositories.

## Roles

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `church` | Own church | Registrant read/write, daily check-in, write notes |
| `zoneLeader` | Own zone | All of above (zone-scoped), read notes, send zone notices, read registrants in zone |
| `director` | All | All of above (camp-wide), import, camp-wide notices |
| `admin` | All + back office | Everything + admin:manage (settings, accounts, accommodation, FAQ, schedule, devotionals, mode switch) |
| `firstAid` | All | `camper:read`, `camper:read:sensitive`, `attendance:write` (attendance only, NOT `checkin:write`), **`note:write:firstaid`** + **`note:read:firstaid`** (Phase 4 — first-aid records only, never general notes/testimonies). No admin, no pre-camp data. |

There is always exactly one `admin` account. It cannot be deleted or deactivated.

## Camp mode

`CampSettings.campMode: 'pre-camp' | 'at-camp'`

- Controls which tabs and admin tiles appear in the UI.
- Switched via `POST /admin/mode { campMode }`.
- Admin console is **identical in both modes** — admins can configure at-camp content (devotionals, schedule) while still in pre-camp mode.

## At-camp preview (client-side only)

Users in pre-camp mode can tap **"👁 Preview at-camp view"** on the pre-camp home screen to enter a read-only preview of the at-camp UI. This is **entirely client-side** — no backend change, no mode switch.

- **State:** `PREVIEW_MODE: boolean` (in-memory only, never persisted).
- **Entry:** `enterPreview()` — sets `PREVIEW_MODE=true`, flips `CAMP_MODE` to `'at-camp'` locally, shows amber `#previewBanner` strip, rebuilds tabs, navigates home.
- **Exit:** `exitPreview()` — restores `CAMP_MODE` from `SETTINGS.campMode`, removes banner, rebuilds tabs.
- **Write blocking:** the `api()` function short-circuits any non-GET request while `PREVIEW_MODE` is true — shows a toast and throws. Covers every write in the app without per-screen changes.
- **Logout safety:** `logout()` clears `PREVIEW_MODE=false` before POSTing to `/auth/logout` so the write guard never blocks logout itself.
- All roles can enter preview. Preview uses real live data (campers, schedule, devotionals already imported).

## Daily check-in (twice daily)

**De-linked from the schedule (2026-06-25).** Check-in sessions are now derived purely from
`CampSettings.checkInDays` — **two synthetic sessions per camp day** (Morning 08:00 / Afternoon
13:00), generated in `src/services/checkin-sessions.ts`. The schedule is unrelated to check-in
(it is pure plan communication); `ScheduleItem.isCheckInPoint` and `getCheckInPoints` no longer
exist.

- **(AC-1, 2026-06-29)** the **first** camp day generates a **PM session only** (arrive at lunch),
  the **last** day an **AM session only** (depart at lunch); interior days keep AM+PM; a 1-day camp
  is PM-only.
- Session id = **`${day}~am` / `${day}~pm`** (e.g. `2026-09-28~pm`) — delimiter is `~`, URL-safe (a `#` would be parsed as a URL fragment when the id is put in a request path; SPA also `encodeURIComponent`s it); this is the key in
  `Camper.checkInHistory[].sessionId`.
- `getCurrentSession()` picks today's AM before midday / PM after (camp tz); falls back to the
  most recent past session. Both `checkin.service` and `dashboard.service` use the shared pure
  helper (`buildSessions` / `currentSession`).
- `checkInDays` is auto-generated from start/end dates in the admin Settings screen (each date
  inclusive); setting the start date pre-fills the end date to the 4th day.
- The frontend shows compact session labels (`Mon AM`, `Mon PM`).
- **Optimistic check-in queue** (`CHECKIN_QUEUE`): taps flip local state immediately and drain to the server in order. Retries with exponential backoff on network failure; hard-drops on 4xx. Undo toast gives 4-second reversal window.

## Presence model (P0 — critical invariant)

`atCamp` and `lifecycle` are **orthogonal**:

- `atCamp` — is the person **physically on site right now?** Only written by `withSignEvent` (attendance sign-in/sign-out path).
- `lifecycle` — registration state machine: `registered → arrived → checked_out → departed | cancelled`. Only `withSignEvent` advances this beyond `registered`.
- `withCheckIn` (daily session log) **never** touches `atCamp` or `lifecycle`. It appends to `checkInHistory` only.
- `checkIn()` in `person.service.ts` guards: throws `BadRequestError` for `lifecycle === 'cancelled'` OR `atCamp === false`. Day-1 first-arrival must go through `signEvent` (attendance sign-in), not the daily check-in path.
- The check-in roster in `getSessionStatus` filters on `p.atCamp === true`, not `isCamper(p)` — departed campers (`atCamp:false`) never appear on the daily roster.
- `checkInsDue` on the at-camp dashboard is scoped to `atCampNow` (persons with `atCamp===true`), not all `isCamper()` persons. This prevents departed campers inflating the "still to check in" count.

## Key design rules

- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks.
- **Validation inside services**: all external input parsed with Zod inside the service, not the controller.
- **Repos return deep clones**: in-memory base repository clones on every read/write.
- **Accommodation lock**: `CampSettings.accommodationLocked` — server blocks non-admin writes when true.
- **Extensionless imports**: ESM, `moduleResolution: "Bundler"`, no `.js` extensions. Each folder has an `index.ts` barrel.
- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`. Guard all indexed access.

## Frontend files

| File | Purpose |
|------|---------|
| `public/index.html` | Production SPA — rebuilt 2026-06-10 from the demo. UI redesigned 2026-06-23 (indigo/purple palette, Plus Jakarta Sans). |
| `ui-mocks.html` | Static HTML mock renders of all key screens — shows the redesigned UI and P0–P4 feature updates. Open in a browser. |
| `../youth app demo/camp-platform.html` | Standalone offline demo — all API calls handled by an embedded MockAPI. The **original UI source of truth**. |

## Design system (updated 2026-06-23)

All tokens live in `:root` in `public/index.html`. Do not use hardcoded hex values for these colours anywhere — use the CSS variables.

| Token | Value | Usage |
|---|---|---|
| `--navy` | `#1e1b4b` | App background, header gradient end |
| `--blue` | `#4f46e5` | Primary buttons, active state, links |
| `--blue2` | `#818cf8` | Progress bar fills, secondary highlights |
| `--purple` | `#9333ea` | Tile icons, hero gradient start, pre-camp badge |
| `--violet` | `#7c3aed` | Button gradient start, header gradient start |
| `--teal` | `#06b6d4` | Devotional hero card |
| `--paper` | `#f5f4ff` | App background (light purple tint) |
| `--line` | `#e4e2f5` | Borders |

**Font:** Plus Jakarta Sans (Google Fonts, loaded in `<head>`). System font stack is the fallback.

**Header bar:** `linear-gradient(135deg, var(--violet), var(--navy))`.

**Hero cards:** `radial-gradient(130% 130% at 0% 0%, #9333ea, #1e1b4b 72%)` with two decorative pseudo-element circles.

**Tab bar active state:** pill background `#ede9fe` with `color: var(--blue)`. No underline indicator.

**Buttons:** `linear-gradient(135deg, var(--violet), var(--blue))`. `.btn.ghost` uses `#f1f0ff` background with `#3730a3` text.

## SPA ↔ backend contract (rebuild notes)

The SPA was forked from an earlier demo and had drifted onto the demo's **MockAPI contract**, which differs from the real Express API. When porting a screen from `camp-platform.html`, watch these (the rebuild fixed them all):

- **No envelope.** The backend returns results *bare* (`res.json(result)`); errors are an HTTP error status + `{code,message}`. `api()` returns the bare result and throws on non-2xx. (The demo's MockAPI used `{ok,data}` and `d.actor`; real login returns `{token,user}` and the SPA builds `ACTOR` + a client-side `displayName`.)
- **`/campers` returns a bare array**, not `{items}`. Camper `kind` is `'student'|'leader'`.
- **Check-in status** = `{session, roster:[{camperId,firstName,lastName,church,zone,gender,grade,medicalFlag,checkedIn,lastEntry}], checkedInCount, totalCount}` — roster now includes gender/grade/medicalFlag directly (no second `/campers` fetch needed).
- **Attendance** is `POST /attendance/sign-in|sign-out` with a `camperId` body (not `/campers/:id/sign-*`). Notes for a camper = `GET /notes/camper/:id`. Search reveal = `GET /search/contact/:camperId/:role` (role like `male-primary`).
- **`/home`** DTO differs by mode: pre-camp has `totalCampers/totalLeaders/noBlueCardCount/accommodationSummary[]/perChurchBreakdown[]` (no gender split, no church `code`, no `expected`); the by-ministry M/F table and church code are derived client-side from `/registrants` and `/accounts/churches`.
- **Accommodation (reworked 2026-06-27 to match the prototype):** classroom **rooms** (`/accommodation/classrooms`, name+capacity) + an **allocation map** (`GET/PATCH /accommodation/allocations` = `{roomId:[{key:"churchId|gender", n}]}`) + eligible-group helper (`/accommodation/groups`) + church-facing `/accommodation/church-rooms/:churchId`. Allocatable **groups** = per church×gender (students **and** leaders pooled together) where **≥75% of that church's campers are classroom-kind**; the SPA **auto-fills** a room to capacity (remainder shown as "unallocated"), rooms are **single-gender** (enforced in the service via `validateAllocations` AND the SPA dropdown), and un-allocate cascades freed people into other rooms. **Tents** are not allocated — `tentDistribution` auto-buckets tent-kind campers into **7-person tents, students and leaders separate** (display only). The old `AccommodationBlock` + per-church `reservations` model is **gone** (DB tables dropped in migration `004`). **(SUPERSEDED 2026-06-29 — see "Improvement Initiative" above):** `CampSettings.tentPrice/classroomPrice` are now **deprecated/unused** — removed from the Settings UI; Budget reads per-registrant `registrationCost`, not settings. The eligible-group logic now also **splits a church×gender pool >50 into `7-9`/`10-12` brackets** (PC-10). Pure logic + types: `src/services/accommodation-allocation.ts`. The church "Your accommodation" home tile is shown **only in real at-camp** (`campMode==='at-camp' && !PREVIEW_MODE`).
- **Notes** require a `camperId`; a **testimony** is a note with `category:'testimony'` (so the testimonies screen picks a student). `/notes/recent` has no camper details (joined from `/campers`); `/notes/export` returns a **CSV string** (downloaded directly) with a Category column.
- **Admin paths**: `/accounts/users`, `/accounts/churches`, `/admin/defaults`, `DELETE /admin/notifications`, `/import/csv` (body `{csvData}`, CSV only), `/devotional/:day` (path param). Passwords are **min 8**. Church create needs `churchName`+`zone`+`account*` fields only. (Password edits use `POST /accounts/users/password` `{userId,password}`.)

> **Field removal (2026-06-25):** self-registration was dropped (all registrants arrive via CSV).
> Removed from `Church`: `code`, `selfRegisterSlug`, `expectedCount`, `youthPastorName`,
> `contactEmail` (church name + a **separate** login username are the identity; matching/import is
> by **name**). Removed from `CampSettings`: `checkInLocation`, `checkInFrom`, `registerBaseUrl`.
> Migrations `008`/`009` dropped the columns in prod. The SPA Accounts screen is now one row per
> login (leadership + churches) with rename/username/password/delete icon actions + a legend.

> **SPA perf (2026-06-25):** a 30s client `Cache` wraps GET in `api()` (invalidated on writes via
> `_invalidate`), `_prefetch()` warms common endpoints after login, and `_navTo` is
> stale-while-revalidate (shows the previous render instead of a spinner on revisits). The shell
> (header/tab bar) was already persistent. `sw.js` cache bumped to `camp-v2`.
- **`CamperDto`** includes `dateOfBirth` (added 2026-06-23) — available on all at-camp screens without a separate fetch.

**Backend additions made for the rebuild** (see git history): optional `StudentNote.category` (+ create-schema + enriched CSV export), `DELETE /notifications/:id`, and `contacts` added to `UpdateChurchSchema` (so the ministry-contacts editor can persist). The check-in screen handles an empty session list gracefully (note: `POST /admin/reset` re-seeds without schedule items, so no sessions exist until the schedule is configured).

## Known SPA efficiency rules (do not regress)

- `/registrants` is fetched **once** in `RENDER.home()` before the `isWide` branch — not once per branch.
- `renderOversightPulse()` does **not** fetch `/campers` — roster data (`gender`, `grade`, `medicalFlag`) comes directly from the `/checkin/sessions/:id/status` DTO.
- `renderHomeAtCamp()` fetches `/notifications` once in the initial `Promise.all`. The urgent-notice popup uses `_checkUrgentNoticesFromFeed(feed)` with the pre-fetched feed — never a second `/notifications` call.
- `renderOversightPulse()` is called without `await` from `renderHomeAtCamp()` — the home screen paints immediately and the pulse bars inject asynchronously into `#homePulse`.

## Seed demo accounts (password: `demo1234`)

Logins are **usernames**, not emails (`User.username`; case-insensitive). Real
contact emails live on Person/Church, separate from the login id. The demo
quick-login panel only appears on localhost/dev (gated by `_initDemoLogin()`).

| Username | Role | Church/Zone |
|----------|------|-------------|
| `victory` | church | Victory Church · Yellow |
| `gracepoint` | church | Grace Point Church · Blue |
| `riverbend` | church | Riverbend Community · Black |
| `yellowzone` | zoneLeader | Yellow Zone |
| `director` | director | — |
| `admin` | admin | — |

Passwords are min 6 chars. Admin can create/edit accounts (editable username +
uniqueness), set passwords, and activate/deactivate (`toggleStatus`; the sole admin
can't be deactivated).

## Year-to-year reuse  (reset vs new-year semantics — decided 2026-06-18)

1. Admin sets up churches, accounts, accommodation, FAQ, schedule, devotionals.
2. `POST /admin/defaults` (`saveDefaults`) — snapshots the scaffold (churches, accounts,
   accommodation, FAQ, schedule, **devotionals**) as the baseline. Snapshot strips
   password hashes.
3. After camp: `POST /admin/new-year` (`newYear`) — the **routine rollover**: purges
   people + transient data (registrants/campers/notes/notifications) and **restores**
   the scaffold from the baseline snapshot; keeps the admin account + camp settings
   (bumps year, forces pre-camp). **Requires a saved snapshot.** Restored accounts come
   back password-less (snapshot strips hashes) — operator must set passwords (KNOWN RISK R9).
4. `POST /admin/reset` (`reset`) — **full wipe to bare**: deletes ALL data including the
   scaffold and every non-admin account; keeps only the single admin + camp settings.
   **No** snapshot restore (this fixed defect A4, where reset used to load the snapshot
   then never restore from it).

Both destructive ops use bulk `deleteAll()` (Supabase: `TRUNCATE`), not row-by-row deletes.
