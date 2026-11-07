# CLAUDE.md — Youth Camp Platform

> ⚠️ **The three "2026-08-02" headings below were misdated** — `git log` puts those commits on
> **2026-08-01**. Dates in this file are hand-written and have drifted; trust `git log` over a
> heading.

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
| **Supabase** | ref `nwfafrgojqkxylbppywo` (Sydney); 21 public tables, RLS on all (checked 2026-10-02); reached via `DATABASE_URL` — **session pooler, port 5432** since the 2026-08-07 cutover (was the transaction pooler on 6543) |
| **Login** | `admin` (username, not email); password set in the DB post-deploy |

Trackers: **`CHANGELOG.txt`** (phase-by-phase + KNOWN RISKS), `docs/PROGRAM-LOG.md` (initiative log),
`docs/PROGRAM-SUMMARY.md`, `docs/CODE-QUALITY-LOG.md`, `docs/PLANNED-IMPROVEMENTS.md` (approved-but-
unbuilt designs + topics queued for future brainstorming), `docs/archive/` (historical).

### ⚠️ Two deploy-only gotchas — DON'T regress these (neither is caught by `tsc`/`vitest`)
1. **`tsconfig` must emit CommonJS** (`module: CommonJS`, `moduleResolution: Node`). Switching
   back to `ESNext`/`Bundler` makes `@vercel/node` crash on load with *"Cannot use import
   statement outside a module"* (it runs the traced output as CJS). Mirrors the CMS config.
2. **`.gitignore` must keep the `/data/` rule anchored** (leading slash). An unanchored
   `data/` also matches `src/data/`, which silently drops `src/data/seed.ts` from git — CLI
   deploys still work but the git auto-deploy fails with *"Cannot find module './data/seed'"*.

### Status of the bigger roadmap
- **Verification gate:** `npm run typecheck` clean, `npm test` green (91 files / 1,434 tests on 2026-11-07, Phase B), `npm run harness` exit 0.
- **Supabase repo layer is complete and wired** (`supabaseRepos` adapter in `container.ts`); migrations applied; all repos verified round-tripping in prod (R11 closed).
- **Phase 1 (Person unification) is COMPLETE.** The unified `Person` entity/repo/service is the live path. `/registrants` and `/campers` are lifecycle-filtered DTO views over `PersonService` — no separate Registrant/Camper services exist. The Supabase layer targets the `people` table. `docs/archive/STEP4-SWITCHOVER.md` is historical.
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
- **2026-11-07 (A-2, `camp-v151`):** `force` + `confirmWipe` no longer skips the export check. Reset, Reset logs and New Year each need an audit workbook export after the last wipe, and each wipe nulls `lastExportedAt`. See `docs/reference/infrastructure-and-safety.md`.

**Backend:**
- **BUG-08** (superseded 2026-11-07, B-7): the audit controller now patches only `{lastExportedAt, updatedAt}` and the temp-password clear patches only `lastTempPasswords`, so neither can revert the other or any concurrent settings change. Every settings writer uses `patchSingleton`; `saveSingleton` is seed-only. Since D4 (Phase C) the stamps are `SettingsService.stampExport/clearExportStamp/stampImport/clearTempPasswords`, and `Services` no longer exposes `users`, `settingsRepo` or a raw push-subscription repo (controllers get services only).
- Import service preserves existing `elvantoMeta` on update if the CSV row has no `dateSubmitted`.

**New tests:**
- `access-control.test.ts`: 6 firstAid permission + `canAccessPerson`/`canAccessChurch` cases (BUG-11).
- `import.service.test.ts`: 3 dry-run cases — no-persist, phantom-church, `dryRun:true` in result (BUG-10).
- `person.service.test.ts`: 4 `listMedicalWatch` cases (BUG-12) — removed 2026-10-02 along with `listMedicalWatch` and `GET /campers/medical`.
- `admin.characterisation.test.ts`: `BadRequestError` import added; `force:true` alone throws `BadRequestError` for `newYear` (BUG-13).

## Commands (run from this folder)

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4200 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest
npm run harness      # the 15 SPA harnesses (scripts/*-harness.js; vpkick excluded) — run after SPA edits
```

Default port: **4200**. Set `PORT=xxxx` to override.

> **Verify & deploy convention:** verify changes with `npm run typecheck` + `npm run test` (+ grep/
> reasoning) — **do not start a localhost dev server or drive a browser to test**, and flag CSS/
> layout changes for the user to eyeball on-device. GitHub is linked to Vercel, so a **push to
> `master` is the deploy** — no need to poll Vercel or curl prod to confirm it shipped.
> **Deploy goes through `bash scripts/ship.sh [--dry-run] <branch>`** (clean tree, fast-forward of `origin/master` only, SW bump check, `npm test` must pass, then a plain push). No force push; a `protect-master` ruleset on GitHub blocks force push and deletion of `master` for everyone.

### Persistence modes & env vars

| `PERSISTENCE` | Backend |
|---|---|
| `memory` (default) | In-memory; demo seed runs on startup |
| `json` | In-memory + JSON files in `DATA_DIR` |
| `supabase` | Supabase Postgres (requires `DATABASE_URL`) — **the live production backend** (ref `nwfafrgojqkxylbppywo`; use the **SESSION-pooler URL on port 5432** — `aws-…pooler.supabase.com`, user `postgres.<ref>` — **not** the IPv6-only direct host `db.<ref>.supabase.co`, which is also :5432 but will not work on Vercel) |

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
store, so logout is client-side and tokens stay valid until their TTL — **48h** (`TOKEN_TTL_MS` in `src/services/auth.service.ts`; older notes saying 12h or 24h are stale).

### Production DB config — role-level query timeout (NOT in migrations, 2026-07-06)

`ALTER ROLE postgres SET statement_timeout = '15s'` is applied on the prod DB (ref
`nwfafrgojqkxylbppywo`). The per-connection `statement_timeout: 15000` in `client.ts` is
**not reliably enforced through the pooler** (CMS proved a trivial query ran 4+ min despite
it), so the ceiling is enforced at the DB-role level like Supabase's own roles. This lives
on the role, **not** in `supabase/migrations/` — it survives new-year rollover but **must be
re-applied if the Supabase project is ever recreated.** Verify with
`select rolconfig from pg_roles where rolname='postgres';`.

### ✅ DONE — session-mode cutover + connection sizing (2026-08-07). Runbook: `docs/SESSION-MODE-CUTOVER.md`

Prod is on the **session-mode pooler (port 5432)**, **Supabase Pro**, **Micro** compute.
Confirmed by measurement 2026-08-07, not assumed:

| | |
|---|---|
| `max_connections` / reserved | **60 / 3** → 57 usable · ~15 used by Supabase's own services |
| Supavisor **Pool Size** | **30** (was the 15 default) |
| App pool `max` (`client.ts`) | **3** (was 5) |
| Role `statement_timeout` | `15s` — survived both the plan upgrade and the compute restart |

> 🔴 **UPGRADING THE PLAN BUYS NO CONNECTIONS. `max_connections` scales with COMPUTE, and
> MICRO IS 60 — IDENTICAL TO THE FREE NANO.** Only Small (90) and above raise it. Pro bought
> backups, no auto-pause and PITR eligibility. Do not read "we're on paid now" as headroom.

> ⚠️ **THE REAL CEILING IS THE SUPAVISOR POOL SIZE, AND IT IS HALF OF A PAIR.** In session mode
> a connection holds a dedicated backend for its whole life, so
> **`instances served = pool size / client.ts max`**. At the defaults (15 / 5) that was **three
> Vercel instances** before everything else queued — nowhere near a 100–200-leader AM burst, and
> queuing at check-in looks exactly like an outage. At **30 / 3** it is **ten**. Change either
> number and you silently move that ceiling: **redo the arithmetic, and change both together.**

**Still outstanding: the burst load test** (`SESSION-MODE-CUTOVER.md` step 8) — deliberately
deferred to ~mid-September. If it wants more headroom the move is **Small + pool 50**, *not* a
smaller `client.ts max`: 3 is the floor worth having (`max:1` caused head-of-line blocking in
CMS, where one slow query froze every request on the instance including login).

⚠️ **Set compute size FIRST, then pool size** — a resize can reset the pool to the new default.
Re-verify the role `statement_timeout` after any resize.

Two env gotchas that still matter here:

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
- **`src/container.ts`** — composition root. The only file that names concrete repositories. Two adapters (`supabaseRepos(sql)`, `memoryRepos({dataDir?})`) build a `Repositories` set; `buildServices(repos)` is the one service graph; `buildContainer()` picks the adapter by `PERSISTENCE`, `buildMemoryContainer()` gives tests fresh state (D1, 2026-11-07).

## Roles

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `church` | Own church | Registrant read/write, daily check-in, write notes. **Cannot delete a person** (`person:delete` = director/admin) and **cannot read first-aid records** (operator ruling 2026-11-03, reversing Phase 4 decision Q3). Never reads sensitive notes. May reveal (audited) a leader number for any arrived camper; the parent number is masked everywhere and only revealed in scope. |
| `zoneLeader` | Own zone | All of above (zone-scoped), read notes, send zone notices, read registrants in zone |
| `director` | All | All of above (camp-wide), import, camp-wide notices |
| `admin` | All + back office | Everything + admin:manage (settings, accounts, accommodation, FAQ, schedule, devotionals, mode switch) |
| `firstAid` | All | `camper:read`, `camper:read:sensitive`, `attendance:write` (attendance only, NOT `checkin:write`), **`note:write:firstaid`** + **`note:read:firstaid`** (Phase 4 — first-aid records only, never general notes/testimonies). No admin, no pre-camp data. Payment, refund, discount and blue-card fields come back null on `/campers` and `/search`, and the offline sheet import is director/admin only (2026-11-07). |
| `prayer` | All | `camper:read`, **`note:write:prayer`** + **`note:read:prayer`** (category `'prayer'` records, server-forced `sensitive:true`), **`note:read:student`** (every note on ONE opened student via `GET /notes/camper/:id`; no `/notes/recent`, no export). No `camper:read:sensitive` (no Medicare/parent reveal), no attendance/check-in, no notifications. SPA = first-aid screens (Search · All Students · Records · Schedule) with role dispatch; Medicare/consents/parent contact hidden in the UI only (owner decision 2026-10-02). Director/admin also hold the two prayer-note permissions; zone leaders read prayer records through `note:read` (zone-scoped); church never sees them (sensitive). **Prayer reads sensitive notes on an opened student, and the note forms say so on screen** (QA ruling 2026-11-03; no alert is sent for a sensitive note). Prayer still gets plain parent numbers (unchanged); payment, refund, discount and blue-card fields come back null, as for firstAid (2026-11-07). **Amendments (2026-10-03):** a prayer record is never edited — `prayer`/`director`/`admin` can add an own-note "Amends: `<id>`" amendment (no backend change) via `openPrayerAmend`/`savePrayerAmend`, nested under the original by `_faGroup` on the student card and the Records tab; on the Notes tab the Add-amendment button is director/admin only. |

Additional `admin` accounts can be created (2026-07-31). The **original** admin — the
earliest-created one, see `findOriginalAdmin` — cannot be deleted, deactivated or demoted by
anyone, including itself; secondary admins are full peers in every other respect.

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
- **Write blocking:** the `api()` function short-circuits any non-GET request while `PREVIEW_MODE` **or `ACCOUNT_PREVIEW`** is true — shows a toast and throws. Covers every write in the app without per-screen changes.
- **Logout safety:** `logout()` clears `PREVIEW_MODE`/`ACCOUNT_PREVIEW`/`_previewStash` before POSTing to `/auth/logout` so the write guard never blocks logout itself. `sessionExpired()` and `doLogin()` clear the same preview state plus `ycp_preview_stash` and the banner (`sessionExpired` also clears `LAST_LEADER` and `ycp_settings`), and `_tryRestoreSession()` drops a stash for the signed-in user instead of re-entering preview; a non-401 refusal of the restore also drops preview state (2026-11-07, `scripts/session-teardown-harness.js`).
- All roles can enter preview. Preview uses real live data (campers, schedule, devotionals already imported).
- **Queue (B-14, 2026-11-07):** entering either preview calls `_queueStop()` before any state change; exiting calls `_queueLoad(true)` and drains, so the admin's saved taps send after Exit. Any attributed write during a preview (check-in tap, sign-in/out, first-day arrival) is refused by `_ensureInitials()` with the read-only toast *before* the church initials sheet, so nothing is stored over a church's initials; `_queueStop()` also clears the Undo window (`scripts/preview-queue-harness.js`).
- **Banner is shared with account preview** (see "Account preview" above): `#previewBanner`'s label/toggle/exit are driven by `_updatePreviewBanner()` (called from `updateModeUI`); the Exit button dispatches via `_exitAnyPreview()` to `exitPreview()` (same-user) or `exitAccountPreview()` (account preview).

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
- **Optimistic check-in queue** (`CHECKIN_QUEUE`): taps flip local state immediately and drain to the server in order. Undo toast gives 4-second reversal window; list taps are ignored for 500 ms after a write. **Only an app refusal (4xx) drops a check-in**, named in the red banner; a 5xx/429, timeout or no answer keeps the tap queued and retrying, live or offline (B-17, Tom 7 Nov, reversing "banner only"). Taps are kept in `localStorage` per login (`ycp_ciq_<login>`): a 401 keeps them and they resume when the same login signs back in; a 5xx/429 backs off 30 s to 5 min; a tap over 48 h old is not sent and is named. Church logins also keep an offline roster (id, name, grade, checked in; 48 h; cleared on logout) in `ycp_roster_<login>`. Note drafts live in `sessionStorage`. Detail: `docs/reference/at-camp-screens.md` (QA round, `camp-v146` to `camp-v148`).

## Presence model (P0 — critical invariant)

`atCamp` and `lifecycle` are **orthogonal**:

- **All presence decisions live in one pure module, `src/services/presence.ts`** (P1+I4, 2026-11-07): `transition(person, intent, {actor, campMode, now})` → `applied {next, appended}` | `noop` | `refused {reason}`, with intents `checkIn`, `signIn`, `signOut`, `cancel`, `uncancel`, `modeRevert`. Callers only do I/O: `refused` → `BadRequestError(reason)`, `noop` → write nothing, `applied` → persist `next`. It replaced `person-lifecycle.ts` (`withCheckIn`/`withSignEvent`). **Never add a refusal to the `checkIn` intent** (the offline queue drops a tap on any 4xx).
- `atCamp` — is the person **physically on site right now?** Moved only by the sign-event, cancel and mode-revert intents.
- **On UPDATE, `atCamp`/`lifecycle` are written only by `savePresence`/`savePresenceMany`** (B-1, 2026-11-07): `signEvent`, cancel/uncancel, the offline sheet import, `resetLogs` and the setMode revert. A plain `save`/`saveMany` keeps the stored presence (Supabase `PERSON_UPDATE_COLS`, in-memory `merge()`); a new presence writer must call the presence method. A plain save's return value is not a read-back (Supabase returns the caller's copy), so don't trust its presence.
- `lifecycle` — registration state machine: `registered → arrived → checked_out → departed | cancelled`. Only a `signIn` advances this beyond `registered`.
- The `checkIn` intent (daily session log) **never** touches `atCamp` or `lifecycle`. It appends to `checkInHistory` only.
- **The `checkIn` intent is idempotent per (session, person, type) — N5, 2026-07-31.** If the LAST entry for the same `sessionId` already has the same `type`, the write is a no-op and the person is returned unchanged (no `updatedAt` bump), so a crash-replay from the SPA's persisted check-in queue can't write a duplicate row into the compliance export. On Supabase it is also enforced in SQL (B-5): the check-in insert skips a row whose type matches the last stored row for that person+session, atomic because the `people` upsert row-locks the person first. **Keep the upsert before `appendHistories`.** ⚠ It compares against the **last entry for that session only**, never the whole history, because **"checked in" is LAST-ENTRY-WINS** (one rule, `src/services/session-roster.ts`: `lastEntryFor`, `isCheckedInFor`, `onSessionRoster`, shared by the roster DTO, push warnings, dashboard and this dedupe — P2) — a genuine in → out → in is three real entries and must keep working. Tests: `presence.test.ts`.
- `checkIn()` in `person.service.ts` refuses (via `presence.ts`, same two messages) with `BadRequestError` for `lifecycle === 'cancelled'` OR `atCamp === false`. Day-1 first-arrival must go through `signEvent` (attendance sign-in), not the daily check-in path.
- The check-in roster in `getSessionStatus` filters on `p.atCamp === true` (`onSessionRoster`), not `isCamper(p)`. A person no longer at camp stays only on PAST sessions they were checked in for; the CURRENT session excludes them (QA item 13, 2026-11-03), and `notOnSiteCount` reports them.
- A sign event that doesn't move lifecycle or atCamp writes nothing (B-2, replaces the QA-16 rule), so a double tap writes one compliance row. Signing in a cancelled person is a 400. Cancelling someone at camp first writes an 'out' event, reason "Registration cancelled" (B-3). Church, zone and first-aid logins cannot sign someone in during pre-camp.
- `checkInsDue` on the at-camp dashboard is scoped by the shared roster rule `onSessionRoster(p, cur, cur)` (`src/services/session-roster.ts`: non-leader with `atCamp===true` for the current session), counting those not `isCheckedInFor` it — not all `isCamper()` persons. This prevents departed campers inflating the "still to check in" count.

## Key design rules

- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks. Since A1 (Phase C, 2026-11-07) it also holds the scope rules: `inScope` (the one church/zone/gender switch; `canAccessPerson` and `canAccessChurch` wrap it), `reach(actor, person)` = `full | locate | none` for search/notes/contact reveals, and `isOversight` (admin|director). The truth table is pinned in `access-policy.a1.test.ts`; a snapshot change there is an access change.
- **Validation inside services**: all external input parsed with Zod inside the service, not the controller.
- **Repos return deep clones**: in-memory base repository clones on every read/write.
- **Accommodation lock**: `CampSettings.accommodationLocked` — server blocks non-admin writes when true.
- **Extensionless imports**: TypeScript `import` syntax compiled to CommonJS (`module: CommonJS`, `moduleResolution: Node` — see deploy gotcha 1), no `.js` extensions. Each folder has an `index.ts` barrel.
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
- **Accommodation (reworked 2026-06-27 to match the prototype):** classroom **rooms** (`/accommodation/classrooms`, name+capacity) + an **allocation map** (`GET/PATCH /accommodation/allocations` = `{roomId:[{key:"churchId|gender", n}]}`) + eligible-group logic (`computeGroups` in `accommodation-allocation.ts`; the `/accommodation/groups` route was removed 2026-10-02, `AccommodationService.listGroups` remains for tests) + church-facing `/accommodation/church-rooms/:churchId`. Allocatable **groups** = per church×gender (students **and** leaders pooled together) where **≥75% of that church's campers are classroom-kind**; the SPA **auto-fills** a room to capacity (remainder shown as "unallocated"), rooms are **single-gender** (enforced in the service via `validateAllocations` AND the SPA dropdown), and un-allocate cascades freed people into other rooms. **Tents** are not allocated — `tentDistribution` auto-buckets tent-kind campers into **7-person tents, students and leaders separate** (display only). **(2026-07-20)** also folds in anyone whose `accommodationKind==='classroom'` but whose church is under the 75% threshold (see "Accommodation fold-in fix" below) — nobody is left uncounted just because their church didn't clear the classroom eligibility bar. The old `AccommodationBlock` + per-church `reservations` model is **gone** (DB tables dropped in migration `004`). **(SUPERSEDED 2026-06-29 — see "Improvement Initiative" above):** `CampSettings.tentPrice/classroomPrice` are now **deprecated/unused** — removed from the Settings UI; Budget reads per-registrant `registrationCost`, not settings. The eligible-group logic now also **splits a church×gender pool >50 into `7-9`/`10-12` brackets** (PC-10). Pure logic + types: `src/services/accommodation-allocation.ts`. The church "Your accommodation" home tile is shown **only in real at-camp** (`campMode==='at-camp' && !PREVIEW_MODE`). A church flagged `accommodationPerRegistration` skips the 75% bar (2026-09-24).
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

## Seed demo accounts

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

Local `PERSISTENCE=memory` dev/demo mode: password `demo1234` for all of the
above (`src/data/seed.ts`, never touches production — production has no user-seeding
migration beyond the single admin row in `002_seed_admin.sql`, which is seeded with a
`null` password_hash so login is rejected until an operator sets one). Passwords are
min 6 chars. Admin can create/edit accounts (editable username + uniqueness), set
passwords, and activate/deactivate (`toggleStatus`; the original admin — `findOriginalAdmin` — can't be
deactivated, deleted or demoted). **Forced password change (see "Security notes" below):** any account
whose password was set by an admin (`setPassword`) or generated by the new-year
rollover (`lastTempPasswords`) is flagged `mustChangePassword` and can do nothing but
change its own password (`POST /accounts/me/password`) until it does — this closes the
gap where an admin-set password following this documented convention (e.g. `demo1234`)
could otherwise grant a same-day login to a real account.

## Year-to-year reuse  (reset vs new-year semantics — decided 2026-06-18)

1. Admin sets up churches, accounts, accommodation, FAQ, schedule, devotionals.
2. `POST /admin/defaults` (`saveDefaults`) — snapshots the scaffold (churches, accounts,
   accommodation, FAQ, schedule, **devotionals**) as the baseline. Snapshot strips
   password hashes.
3. After camp: `POST /admin/new-year` (`newYear`) — the **routine rollover**: purges
   people + transient data (registrants/campers/notes/notifications) and **restores**
   the scaffold from the baseline snapshot; keeps the admin account + camp settings
   (bumps year, forces pre-camp). **Requires a saved snapshot.** The snapshot strips hashes, so `newYear` gives every
   restored account a generated temp password, flags it `mustChangePassword`, and stores the
   list in `settings.lastTempPasswords`; the next audit export adds a Passwords tab and then
   clears `lastTempPasswords` (`admin.service.ts`, `audit-export.service.ts`).
4. `POST /admin/reset` (`reset`) — **full wipe to bare**: deletes ALL data including the
   scaffold and every non-admin account; keeps only the single admin + camp settings.
   **No** snapshot restore (this fixed defect A4, where reset used to load the snapshot
   then never restore from it).

Both destructive ops use bulk `deleteAll()` (Supabase: `TRUNCATE`), not row-by-row deletes.

Since 2026-11-07 `reset`, `resetLogs` and `newYear` each need an audit workbook export after the last wipe, even with `force`, and each nulls `lastExportedAt` via `patchSingleton`. `resetLogs` deletes presence history through `clearPresenceHistory()`, not `saveMany`.


## Where things live

This file keeps only rules that stay true. Dated session write-ups were moved out on 2026-10-02:
- `docs/reference/` — topic notes: accommodation, budget-money, imports, notifications-push, auth-and-accounts, infrastructure-and-safety, at-camp-screens, spa-platform-lessons. **Read the matching file before editing that area.**
- `docs/archive/early-batches-2026-06-to-07.md` — June/July batches. `docs/archive/CLAUDE.full-2026-10-02.md` — the full original file.
- Dates in these docs are hand-written and have drifted. **Trust `git log` over a dated heading.** The post-camp review (2026-10-01) is not kept in this repo.
- `CHANGELOG.txt` stops at 2026-07-31; later history (incl. Camp 2026, 28 Sep – 1 Oct) is in `git log` only.

## Current facts (verified 2026-10-02 — re-check before relying on them)

- **Migrations:** `supabase/migrations/` is the source of truth; any "next migration = 00NN" inside a dated note is as-of that date. Prod history is contiguous `0001`–`0030`. The post-camp plan (`docs/superpowers/plans/2026-10-02-post-camp-tidy-up.md`) adds `0031` (cron prune), `0032` (revoke anon/authenticated grants), `0033` (pg_net → `extensions`) — check the directory and `supabase_migrations.schema_migrations` for whether they have landed. Apply a migration to prod **before** pushing code that needs it, and reconcile its history label to `'00NN'`.
- **Cron:** `camp-push-tick` (every 5 min, `0014`) reads its bearer from **Vault** (`cron_secret`), not a literal. Planned `0031` (not yet applied as of 2026-10-02) adds weekly `camp-cron-prune` (keeps 7 days of `cron.job_run_details`).
- **QA round 2026-11-03/04** (`camp-v146` to `camp-v148`, master `6d25a08`, rollbacks `07a78d2` / `7fec4b5` / `cdfb68f`): access, masking and offline changes are in `docs/reference/at-camp-screens.md`. `payment_status` can hold `free`/`refunded` (plain text, no migration; existing rows change at the next Ticket import). **Accepted limits, do not build without asking:** deleted or demoted accounts keep access up to 48 h (QA item 1, ruled don't fix); no sensitive-note alerts; no single-church notices; director/admin delete and church cancel via the API unchanged.
- **Architecture round Phase A 2026-11-07** (`camp-v151`, branch `arch/2026-11-07`, round folder `src/camp-arch-2026-11-07`): consents tri-state with a missing-column hard stop; the Form absent-delete keeps ticket/invoice/payment holders; fuzzy Ticket and billing-name matches are never applied; the offline sheet import is director/admin and at-camp only; `leaderName` required on sign-in/out; `GET /settings` needs auth; per-account dashboard cache; firstAid/prayer money strip; wipes need an export after the last wipe and Reset logs really deletes; preview/session teardown. Details in `docs/reference/` (imports, at-camp-screens, auth-and-accounts, infrastructure-and-safety); deferrals in `docs/PLANNED-IMPROVEMENTS.md`.
- **Architecture round Phase B 2026-11-07** (`camp-v152`, same branch): presence column split (B-1), no-op sign events + cancelled sign-in 400 (B-2), cancel at camp signs out (B-3), SQL check-in dedupe (B-5), push claim kept on edit (B-6), column-scoped settings writes (B-7), church zone re-stamp (B-15), Form seed-only for Ticket/Invoice fields (B-16), note session only from a check-in row (B-10), blob downloads via `_doFetch` (B-13), SW 5xx/`?nav=`/first-install fixes (B-12), previews park the queue (B-14). New SQL was checked on prod with read-only SELECTs. Same doc set plus notifications-push and spa-platform-lessons.
- **Service worker:** `public/sw.js` `CACHE` is the SPA version label (`camp-v152` is architecture round Phase B; `camp-v151` is architecture round Phase A; `camp-v150` adds Undo cancel on the Data Import card, on branch `sec/camp-closeout`, not yet shipped; `camp-v149` is the 4 Nov security batch (CSV formula guard in two browser exports); `camp-v148` after QA batch 3 of 2026-11-04; `camp-v147` QA batch 2; `camp-v146` the QA security fixes; `camp-v145` was prayer-record amendments; `camp-v144` the prayer team role). `camp-v132` did ship (commit `075f2dd`) but no commit message names it — search `git log -S"camp-vNNN" -- public/sw.js`, not message text.
