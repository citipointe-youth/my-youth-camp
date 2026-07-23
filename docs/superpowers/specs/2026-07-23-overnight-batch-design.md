# 2026-07-23 — Overnight admin batch (design)

Admin-requested batch of 11 items. Decisions confirmed via clarifying questions before the
owner went offline; the owner authorised autonomous design → plan → build → deploy, with browser
verification done by the owner afterward. **Ships tonight: items 1–9 + 11.** Item 10 (proactively
warning churches an hour before a check-in window closes) is deferred into a **separate post-deploy
Web Push design + implementation plan** (see the follow-up doc), because it needs a real
scheduler + push, which this serverless app has neither of yet.

Verification for this batch = `npm run typecheck` (clean) + `npm run test` (all pass) +
`node --check` on the extracted SPA script. No localhost/browser drive (per debug.md conventions).
Migrations applied to prod Supabase (`nwfafrgojqkxylbppywo`) **before** the code push; `sw.js`
`CACHE` bumped once for the SPA change; push to `master` = deploy.

---

## Item 1 — iPhone password-save prompt (best-effort hardening)

**Problem:** older/less-updated iPhones don't reliably offer to *save* the web-app password.

**Reality:** iOS Safari saves a credential most reliably on a **real form submission** with correct
`autocomplete` tokens and stable field `name`s. The login form (`#loginForm`) already submits and
carries `autocomplete="username"`/`"current-password"` (debug.md 2026-07-17). Safari has **no**
Credential Management `store()` support, so we can't force a prompt programmatically — this is a
hardening pass, not a guaranteed fix.

**Changes (SPA only):**
- Ensure the login `<form>` uses a native submit that does **not** `preventDefault` away the
  browser's save heuristic: keep `onsubmit` returning false only *after* the async login resolves;
  Safari keys off the submit event + subsequent DOM change. Add a hidden real submit path.
- Field audit: username input `type="text"` `name="username"` `autocomplete="username"`
  `autocapitalize="none"` `autocorrect="off"`; password input `type="password"` `name="password"`
  `autocomplete="current-password"`. Add `id`s matching `name`s.
- Add `<meta name="apple-mobile-web-app-capable" content="yes">` presence check (already PWA) and,
  critically, make sure login happens on a **same-document form submit** so Safari's "Save Password"
  sheet triggers.
- Document the residual limitation inline (a brand-new credential on a never-before-seen form may
  still not prompt on old iOS; autofill of an already-saved credential is the reliable path).

No backend/schema change.

---

## Item 2 — Session TTL 12h → 24h

`src/services/auth.service.ts`: `TOKEN_TTL_MS = 12 * 60 * 60 * 1000` → `24 * 60 * 60 * 1000`.
Update the four "12h" prose comments (auth.service.ts ×3, rate-limiter.ts ×1) to "24h". No schema
change (stateless token carries its own `exp`). Existing tests that don't assert the exact TTL are
unaffected; grep for any test asserting 12h and update.

---

## Item 3 — De-jank the sign-in / check-in ground workflow (fewer clicks, live update in place)

**Problem:** when a leader signs a student in from a list, the app navigates to that student's
**profile** (or a different screen) instead of updating the list in place — extra clicks, lost
place, feels janky.

**Principle:** an attendance/check-in action taken **from a list** stays on that list, updates the
one row in place (optimistically), and shows a toast — it never navigates to the profile.

**Concrete changes (SPA):**
- `signInConfirm` / `signOutConfirm`: after a successful write, **re-render the originating screen**
  (the one in `STACK`/current screen id) rather than calling `openCamper`. Detect origin: if invoked
  from the profile (`openCamper`) keep profile behaviour; if invoked from a list row (check-in "Not
  Signed In" section, Students/My-group list, first-day list) re-render that list.
- The "Not Signed In (N)" section on the check-in screen and the first-day arrival list already
  re-render their own screens on success in most paths — audit each `signInPrompt`/`signOutPrompt`
  call site so **none** ends on `openCamper` when it started from a list.
- Confirmation friction: keep the single confirm sheet for sign-**out** (safety — parents-met), but
  first-day **sign-in** from the arrival list stays a one-tap optimistic action (no profile hop).
- Verify `_invalidate` clears `/registrants`+`/campers`+`/checkin`+`/home` on these writes so the
  re-rendered list reflects the change immediately (this is the same latency concern flagged in
  PLANNED-IMPROVEMENTS "Sign-in/out UI latency").

Scope guard: this is a targeted navigation/re-render fix, not a rewrite of the attendance model.

---

## Item 4 — Admin settings: flat grouped page; Notices removed from Camp Settings

**Decision:** replace the linear **setup wizard** as the primary settings surface with a single
**flat, grouped settings page** — collapsible sections, each with a done-state tick, no forced step
order. **Notices must NOT be reachable from Camp Settings.**

**Changes (SPA):**
- New `RENDER.adminSettingsHub` (or refactor `RENDER.adminSettings`) into one scrollable page with
  `<details>`-style collapsible sections: **Camp dates & mode**, **Check-in & timing** (hosts the
  switchover time, phase override, *and* the new item-11 window fields + restriction toggle),
  **Accommodation**, **Accounts & churches**, **Content (schedule / FAQ / devotionals / contacts)**.
  Each section header shows a ✓ / ○ / "! N" done-state derived from the same `check()` predicates the
  wizard steps use today (reuse `WIZARD_STEPS` logic; don't duplicate).
- Remove the **"Notices"** button that currently sits at the top of `RENDER.adminSettings`
  (added 2026-07-03). Notices stays reachable for admin/director via the existing bottom-nav
  **Notices** tab / sidebar extra and (new) a **Notices** tile on the admin console (`RENDER.admin`)
  so removing the settings button doesn't strand it.
- The old `RENDER.adminWizard` may remain reachable as an optional "Guided setup" entry, but it is
  no longer the default/primary path and is de-emphasised. Keep its `check()` predicates as the
  single source for done-state.

No backend/schema change (settings entity already exists; item 11 adds the timing fields).

---

## Item 5 — Leaders not auto-checked-in on mode switch

`src/services/admin.service.ts` `setMode`: **remove** the pre-camp→at-camp leader bulk sign-in
block (the `toSignIn` filter + `withSignEvent` + `saveMany`). Keep: the practice first-aid-note
wipe on going live, and the at-camp→pre-camp revert block (still reverts anyone still `atCamp`,
which now only includes people who were actually signed in). Update the stale comment.

**Consequence (intended):** leaders start `atCamp:false` at go-live and are signed in manually via
the existing My-group "Late arrivals" → "Sign in to camp" path (`filterMyYouth` already includes
leaders). Dashboard `totalAtCamp` no longer counts un-arrived leaders. `checkin.service` /
`dashboard.service` already exclude leaders from the twice-daily roster, so no other change needed.
Update `admin.service` tests that assert the bulk sign-in (`admin.characterisation.test.ts` and any
setMode test) to assert leaders remain `atCamp:false`.

---

## Item 6 — Audit & exports sorted by date/time

`src/services/audit-export.service.ts`: sort every **action/event** collection chronologically
(ascending, ISO lexical) before writing rows:
- **Daily Check-in Log** (workbook + `exportCheckInLogCsv`): flatten `{person, ci}` across all
  people, sort by `ci.timestamp`, then write — replaces the per-person nesting.
- **Notes & Testimonies** sheet: sort non-firstaid notes by `createdAt`.
- **First-Aid Records** sheet: sort firstaid notes by `createdAt`.
- **Incidents** sheet: sort by `createdAt`.
- Sign-in/out timeline is already chronological (`buildSignInOutTimeline`) — leave.
- Attendees is a roster (not actions) — leave as-is.

Add/extend a test in `audit-export.service.test.ts` asserting the check-in log rows come out in
timestamp order regardless of person iteration order.

---

## Item 7 — Church initials: enforce at login, remember on device, auto-apply, quick-switch badge

**Decision:** enforce at login + keep the header ✎ quick-switch badge.

The plumbing already exists (`LEADER_INITIALS`, per-account `localStorage['ycp_initials_<user>']`,
header `#initialsBadge`, `promptInitials`, threaded into check-in `initials` + sign-out
`leaderName` + reveal audit). Changes (SPA):
- **Enforce at login:** add `enforceInitials()` — a **non-dismissible** modal (no "Skip") shown for
  church accounts immediately after login and after session restore when `LEADER_INITIALS` is empty.
  Save button disabled until ≥1 char entered. Replaces the current skippable post-login
  `promptInitials(false)` for the church role.
- **Auto-apply everywhere, never re-ask:** remove the per-action `promptInitials(false)` calls on
  the check-in path (index.html ~1030, ~1073). Confirm `notePrompt` / `submitTestimony` /
  `signInConfirm` / `signOutConfirm` read `LEADER_INITIALS` silently and never prompt. Sign-out
  currently uses `leaderName` from a field — switch it to auto-fill from `LEADER_INITIALS` for
  church accounts (no manual entry).
- **Quick switch:** header ✎ badge → `promptInitials(true)` (skippable, for switching) stays. This
  is how a different leader taking the device changes the attributed initials in one tap.
- Non-church roles unaffected (no initials concept).

No backend/schema change — the backend already accepts `initials`/`leaderName` on these writes.

---

## Item 8 — Home: First-Day Sign-In as a wide button; time-based greying instead of tile-switching

**Problem:** one home tile switches its label between "First Day Sign In" and "Daily Check-in" by
time — a confusing implicit switch.

**Decision (at-camp home, `renderHomeAtCamp`):** two distinct, always-legible controls with
time-based **greying** instead of one switching tile:
1. **First Day Sign In** — a **wide full-width button placed between the hero card and the tile
   grid**. Shown on **Day 1 only**. Enabled during the sign-in phase; **greyed/disabled** once the
   switchover passes (`campPhase()!=='signin'`). Enabled tap → check-in surface forced to the
   **arrival** face.
2. **Daily Check-in** — stays as the **first tile** in the grid, always present at-camp.
   **Greyed/disabled** during the sign-in phase (`campPhase()==='signin'`); enabled after switchover.
   Enabled tap → check-in surface forced to the **daily** face.

Greyed taps show a toast (e.g. "Daily check-in opens at 2:00 PM" / "First-day sign-in has closed").

**Mechanism:** `RENDER.checkin` currently branches on `campPhase()`. Add a one-shot
`_forceCheckinFace` (`'signin'|'checkin'|null`) set by the two controls before `gotoTab('checkin')`
and consumed (then cleared) by `RENDER.checkin`, so an explicit tap opens the intended face while
the greying enforces the time gate. On Day 2+ the wide button isn't rendered; only the (enabled)
Daily Check-in tile remains. Applies to every at-camp role that currently sees the entry tile.

No backend/schema change (phase model already exists: `campPhase`, `checkinSwitchoverTime`,
`checkinPhaseOverride`).

---

## Item 9 — Scheduled notices (in-app, no push)

**Decision:** ship in-app scheduled notices tonight. A creator (zoneLeader/director/admin — same as
who can compose) sets a future publish time; the notice becomes visible to its audience once that
time passes. **Lazy-fire — no cron:** a future-scheduled notice is simply filtered out of everyone's
feed until `scheduledFor <= now`; because feeds are re-fetched on every home load / Notices open,
it appears at (or just after) the scheduled time with no scheduler. Creator/director/admin can
view/edit/delete scheduled notices.

**Data model:**
- `Notification.scheduledFor?: ISODateString | null` (entity).
- Migration `0010_scheduled_notices.sql`: `alter table notifications add column scheduled_for
  timestamptz null;`
- Supabase mapper (`supabase.notifications.ts`): map `scheduled_for` ↔ `scheduledFor` in `toNotif`
  + `notifColumns`; **extend the `on conflict do update set`** list (currently only title+body) to
  also set `scheduled_for, scope, zone, church_id, priority, expires_at, audience_estimate` so edits
  persist. In-memory repo needs no field-specific change (stores the whole object).

**Service (`notification.service.ts`):**
- `CreateNotificationSchema` gains `scheduledFor: z.string().nullable().optional()`.
- New `UpdateNotificationSchema` (title/body/priority/scope/zone/expiresAt/scheduledFor, all
  optional) for edits.
- `send`: persist `scheduledFor`.
- `getActorFeed`: additionally drop any notice with `scheduledFor && scheduledFor > nowISO()` — for
  **all** roles (scheduled notices never show in the live audience feed until due).
- New `scheduled(actor)`: returns future-scheduled notices (`scheduledFor > now`) — the actor's own
  if zoneLeader; all if director/admin.
- New `update(actor, id, input)`: creator (`senderId===actor.id`) or director/admin may edit; zone
  scope change re-checked via `assertCanSendNotification`; re-estimate audience if scope changed.
- `remove`: extend RBAC so a creator may delete their **own** notice (needed for zoneLeader's own
  scheduled ones) in addition to the existing director/admin (and zoneLeader-own-zone) rules.

**API (`notification.controller.ts` + router):**
- `GET /notifications/scheduled` → `scheduled(actor)`.
- `PATCH /notifications/:id` → `update`.
- `POST /notifications` accepts `scheduledFor`; `DELETE /notifications/:id` unchanged route (RBAC
  widened in service).

**SPA:**
- `RENDER.compose`: add a **"When"** segmented control — **Send now** / **Schedule** — revealing a
  `datetime-local` input when Schedule is chosen. `sendNotif` converts the local value as **Brisbane
  (UTC+10, no DST)** → ISO (`new Date(v+':00+10:00').toISOString()`) and posts `scheduledFor`.
  Validate it's in the future.
- New `RENDER.scheduled`: lists the actor's scheduled notices (`GET /notifications/scheduled`) with
  time, audience, priority, and **Edit** / **Delete** actions. Edit reopens the composer prefilled
  (PATCH on save). Reachable via a **"Scheduled"** link/button on `RENDER.notifs` and on the compose
  screen — visible only to compose-capable roles.
- Toast copy distinguishes "Delivered" (now) vs "Scheduled for <local time>".

---

## Item 11 — Church check-in hard AM/PM windows: on by default, admin-editable

**Decision:** real bounded windows, enforced for **church** accounts only, **on by default**,
admin-editable, and blocked outside camp days.

**Data model (`settings.ts`):**
- Keep `churchCheckinTimeRestricted` but **default `true`** (seed.ts + a prod `UPDATE settings SET
  church_checkin_time_restricted = true`).
- Add four HH:MM fields: `checkinWindowAmStart` (`'06:00'`), `checkinWindowAmEnd` (`'12:00'`),
  `checkinWindowPmStart` (`'12:00'`), `checkinWindowPmEnd` (`'22:00'`). Entity + Zod
  (`content.schema.ts`, same HH:MM regex) + `supabase.settings.ts` (read `?? default`, write all) +
  seed.ts + in-memory/test fixtures.
- Migration `0011_checkin_windows.sql`: add the four `text` columns (nullable, app supplies default
  on read), and the prod restriction `UPDATE`.

**Logic (`checkin-sessions.ts` — pure, tested):**
- New `allowedWindowSession(days, today, nowTime, windows)` → `CheckInSession | null`:
  - If `today` is **not** in `days` → `null` (blocked; fixes the outside-camp-dates edge).
  - If `nowTime` ∈ [amStart, amEnd) **and** an `${today}~am` session exists in `buildSessions(days)`
    → that session.
  - Else if `nowTime` ∈ [pmStart, pmEnd) **and** an `${today}~pm` session exists → that session.
  - Else → `null` (window closed).

**Enforcement (`checkin.service.ts` `assertSessionAllowed`):**
- Church role only; no-op unless `churchCheckinTimeRestricted`.
- Compute `allowed = allowedWindowSession(days, today, now, windows)`. If `null` →
  `ForbiddenError` ("Check-in is closed right now — the AM window is 06:00–12:00 and PM is
  12:00–22:00 on camp days."). If `sessionId !== allowed.id` → `ForbiddenError` naming the allowed
  session. Non-church roles keep full freedom.

**SPA:**
- Item-4 "Check-in & timing" settings section gains the four window inputs + the restriction toggle
  (`stChurchWindows`), saved via `saveSettings`.
- Check-in screen surfaces the `ForbiddenError` message cleanly (it already toasts API errors); no
  new client logic needed beyond passing the message through.

Tests: `checkin-sessions.test.ts` for `allowedWindowSession` (in-window am/pm, out-of-window,
wrong session id, non-camp-day → null, day1 PM-only / last-day AM-only interaction);
`checkin.service.test.ts` for church-restricted vs unrestricted and non-church bypass.

---

## Cross-cutting

- **Migrations:** `0010_scheduled_notices.sql`, `0011_checkin_windows.sql`. Apply to prod **before**
  the code push (adding nullable columns is backward-compatible; but `supabase.settings` writes ALL
  columns every save, so the four window columns MUST exist in prod before the new code saves
  settings). Order: apply 0010 + 0011 to prod → push code.
- **`sw.js`:** bump `camp-v32` → `camp-v33` (single SPA-changing batch).
- **Docs:** update `CLAUDE.md` + `debug.md` with a dated section for this batch and refresh
  `PLANNED-IMPROVEMENTS.md` (tick off editor-initials, split-signin, time-lock; carry sign-in
  latency into item-3 notes; add the deferred item-10 Web Push entry).
- **Deferred:** Item 10 + full Web Push → its own `2026-07-23-web-push-design.md` written after
  deploy, covering privacy (subscription/PII storage, opt-in, minors), performance (VAPID, fan-out
  cost on serverless, cron cadence), pros/cons vs the lazy in-app model, and an implementation plan.

## Execution note

Backend units (items 5, 6, 11 backend, 9 backend) are file-isolated and will be delegated to
sonnet subagents with precise specs where it saves tokens; the single-file SPA (items 1, 3, 4, 7, 8,
9-frontend, 11-frontend) is edited in one place by the lead to avoid conflicts. Full
`typecheck`+`test` run after integration.
