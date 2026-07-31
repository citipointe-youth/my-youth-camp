# 2026-07-26 — Web Push via scheduled tick (design + privacy assessment)

**Status: DESIGN APPROVED — nothing implemented, no migration applied, no source file touched.**

Supersedes and narrows `docs/superpowers/specs/2026-07-23-web-push-design.md` (referred to below as
"the 07-23 spec"). That doc is still worth reading for the Layer A / Layer B framing; this one is
the current scope of record.

Owner decisions treated as **fixed requirements** for this design:

- Delivery channel is **Web Push only** (PWA), fired by a **scheduled tick**. No email, no SMS, no
  in-app polling.
- Exactly **three triggers** are in scope (§3). Missed/incomplete check-in escalation to zone
  leaders is **out of scope**.
- The owner specifically asked for the **privacy assessment** (§9) to be substantive.

## 0. Owner review — 2026-07-26 (decisions applied throughout)

This document was reviewed with the owner after first drafting. The decisions below are **applied
inline** in every section, not appended as errata — where a section contradicted a decision it was
rewritten. Recorded here so the reasoning is not lost.

| # | Decision | Effect |
|---|---|---|
| D1 | **Scheduler is Supabase `pg_cron` + `pg_net`, not Vercel Cron.** The Vercel plan is Hobby (free), whose cron is limited to daily triggering — unusable for trigger 3. `pg_cron` 1.6.4 and `pg_net` 0.20.3 are available-but-not-installed on project `nwfafrgojqkxylbppywo`; `supabase_vault` is already installed. Cost: $0 vs ~US$20/mo for Vercel Pro | §4.1 rewritten. The route, its `CRON_SECRET` guard, and every job are **unchanged** — only the caller differs |
| D2 | **Trigger 1 uses the §4.2 hybrid**: inline best-effort push from `incident.service.log()`, scheduled tick as sweeper | §4.2 promoted from proposal to design |
| D3 | **Payload policy = Option C**, unchanged, including trigger 3's count exception | §9.1 unchanged |
| D4 | **Trigger 3**: 60-minute lead, **both** AM and PM, **church logins only** (no zone-leader escalation), only when `remaining > 0`, and **only when `churchCheckinTimeRestricted === true`** | §3, §10 phase 3 |
| D5 | **There are no communal devices.** Leaders log into their account on their **own personal phone**. A church login is a shared *account* installed on several leaders' individual phones — it is not one handset passed around. This contradicts the shared-device inference the first draft built §9.5 on | §9.4 and §9.5 rewritten; P2 High→Low, P8 downgraded |
| D6 | **Logout keeps the subscription** (follows from D5 — logout is not a device hand-off, and a 24h token TTL means leaders re-login roughly daily) | §9.3 row changed |
| D7 | **No admin "revoke all devices" UI.** Post-camp the owner locks accounts with the existing `churchLoginLocked` / `zoneLeaderLoginLocked` toggles | §9.3, and see D8 — the lock does **not** stop pushes on its own |
| D8 | **NEW FINDING from D7.** `churchLoginLocked` / `zoneLeaderLoginLocked` are checked in exactly one place — `auth.service.login`, after the password check. They block **login only**. A push subscription is independent of any session, so a locked-out leader's phone would keep receiving camp pushes forever. **Closed by making the push audience resolver skip `status:'inactive'` users and login-locked roles** — which also closes P4, removes the need for D7's revoke UI, and is reversible (unlock restores alerts with no re-subscribe) | §4.9 (new), P13 |
| D9 | **Advisory lock (old §5 Layer 1) deleted.** Session-level `pg_try_advisory_lock` is unsafe on a transaction pooler — the lock is taken on a connection returned to the pool mid-handler and can outlive the tick, wedging every subsequent run. Layer 2's atomic claim is a genuine guarantee alone | §5 |
| D10 | **`canSeeNotification(actor, notif, now)` extracted** from `getActorFeed` and used by both the in-app feed and the push audience resolver | §4.9 (new) |

~~Still open~~ — **§12 questions 9–12 were ANSWERED by the owner 2026-07-31** (third-party transfer
posture accepted; no under-18 login holders; youth team owns the privacy/compliance update; iOS
install handled at the pre-camp training day). See §12. Nothing organisational now gates rollout.

---

## 1. What has changed since the 07-23 spec

The 07-23 spec was written the night items 1-9 and 11 shipped. Parts of it are now out of date:

| 07-23 spec said | Now |
|---|---|
| Scope = "item 10 (check-in warnings) + the push infra it needs" | Scope = **three** triggers; check-in warnings are only one of them |
| Scheduled notices "sidestep the scheduler by lazy-firing" | Item 9 **shipped** that lazy-fire model (`notifications.scheduled_for`, migration `0010`, the `scheduledFor > now` filter in `getActorFeed`). Trigger 2 is now a **replacement** of a shipped behaviour, not a new capability |
| Proposed inventing `warnLeadMinutes` + reusing "`checkinWindowAm/PmEnd` from item 11" as if item 11 were hypothetical | Item 11 **shipped**: `settings.checkin_window_{am,pm}_{start,end}` (migration `0011`) exist, `churchCheckinTimeRestricted` defaults **true** in prod, and the pure helper `allowedWindowSession(days, today, nowTime, windows)` already exists in `src/services/checkin-sessions.ts` |
| Proposed a `warned_checkin_sessions` marker table or a JSONB blob on `settings` | Superseded by the `notifications.dedupe_key` design in §5 — one mechanism covers all three triggers |
| Next migration implied `0012` era numbering | Repo holds `0001`–`0012`; **next is `0013`** |
| `sw.js` "bump CACHE" (then ~`camp-v33`) | `sw.js` is now **`camp-v45`** (the 2026-07-26 incident-alert batch stepped it v43→v45; an earlier draft of this doc said v43) |
| Did not consider that a leaders-only notification body is encrypted at rest | Migration `0008` + `supabase.notifications.ts` encrypt `notifications.body` with AES-256-GCM **when `leadersOnly` is true**. The push sender therefore reads a *decrypted* body — see §9.1, this is the crux of the payload decision |
| "Build Layer A first, Layer B later" | Still the right sequencing instinct, but Layer A for triggers 1 and 2 **already exists** (the in-app feed). This project is now almost purely Layer B plus one new Layer-A query (trigger 3) |

Still accurate and unchanged: **this app is serverless with no scheduler and no push infrastructure
today.** Verified against the current tree — `vercel.json` has no `crons` key, there is no VAPID
env var, no `PushSubscription` storage, and `public/sw.js` has `install`/`activate`/`fetch`
handlers only. That absence is precisely why these three items were deferred.

---

## 2. Current-state facts this design is built on

Verified by reading the files, not assumed:

- **`vercel.json`** — `regions: ["syd1"]`, `functions["api/index.ts"].maxDuration = 30`, and a
  catch-all rewrite `"/(.*)" → "/api/index"`. **Consequence: any path lands on the Express
  app**, so the tick route is just a normal entry in `src/api/http/router.ts` — no second serverless
  function needed, and it inherits the same 30s ceiling. `vercel.json` itself is **not modified** by
  this design (see D1 — no `crons` key is added).
- **`api/index.ts`** — memoises `createAppInstance()` in `appPromise`. A tick invocation pays the
  same cold-start as a user request (container build + repo init). Irrelevant for correctness, but
  it means a tick is not free.
- **`src/api/http/types.ts`** — `HttpRequest` is `{ ctx, params, query, body, ip }`. **There is no
  `headers` field.** The scheduler authenticates by sending `Authorization: Bearer $CRON_SECRET`, and
  the Express adapter currently reads `req.headers['authorization']` only inside `resolveContext`
  for the app's own bearer tokens. So the tick route requires a **small adapter change**: add an
  optional `headers?: Record<string, string | undefined>` to `HttpRequest` and populate it in
  `src/api/http/express-adapter.ts` (~line 116). This is the one non-obvious plumbing cost of the
  whole feature and is easy to miss when planning. It is unaffected by D1 — the header check is
  needed whoever calls the route.
- **Supabase extensions** (verified on `nwfafrgojqkxylbppywo`, 2026-07-26) — `pg_cron` 1.6.4 and
  `pg_net` 0.20.3 are **available but not installed**; `supabase_vault` 0.3.1 **is** installed.
  This is what makes D1 possible at zero cost.
- **`src/utils/date.ts`** — `nowISO()` is UTC; `zonedNow(tz)` / `zonedToday(tz)` return
  `{date:'YYYY-MM-DD', time:'HH:MM'}` in an IANA zone via `Intl`. `settings.timezone` holds the
  camp zone (`Australia/Brisbane` in prod; `checkin.service` falls back to `DEFAULT_TZ`).
- **`src/services/checkin.service.ts` `assertSessionAllowed`** — already resolves the four window
  strings with defaults `06:00 / 12:00 / 12:00 / 22:00` and calls `allowedWindowSession`. The cron
  job should resolve windows **exactly the same way** so the reminder and the enforcement can never
  disagree.
- **`src/services/incident.service.ts` `log()`** — on `severity === 'high'` it builds a
  `Notification` **directly on the repo** (not via `notification.send`, because a zoneLeader lacks
  `notification:send:camp`) with `scope:'camp'`, `priority:'urgent'`, `leadersOnly:true`, and
  `body: incident.summary`. That row is the join point for trigger 1 — the push does not need to
  read `incidents` at all.
- **`src/repositories/supabase/supabase.notifications.ts`** — `notifColumns()` encrypts
  `body` via `encryptField(n.body, 'notifications:body:'+n.id)` **only when `leadersOnly`**;
  `toNotif()` calls `maybeDecrypt` unconditionally (plaintext passes through). So an incident
  alert's summary is ciphertext at rest and plaintext in the service layer.
- **`src/utils/field-crypto.ts`** — envelope `v1.<keyId>.<iv>.<tag>.<ct>`, AES-256-GCM, AAD
  `"<table>:<column>:<id>"`, keys from `FIELD_ENCRYPTION_KEY` (+ `_PREV` for rotation).
- **`public/sw.js`** — `CACHE = 'camp-v45'`; `API_RE` is an explicit allowlist of top-level API
  prefixes that must never be cached, with a loud comment that a missing prefix causes the SPA's
  HTML to be cached under an API URL. **`push` must be added to `API_RE`.**
- **`public/manifest.json`** — `display: "standalone"`, maskable icons present. The app is already
  installable; nothing in the manifest blocks Web Push.
- **CSP** (`public/index.html` line 12) — `worker-src 'self'`, `connect-src 'self'`,
  `manifest-src 'self'`. Web Push needs no CSP change (the Push API is not a fetch), and the
  subscribe/unsubscribe calls are same-origin. **No CSP edit expected** — but per the repo's own
  rule, if the CSP is touched for any reason, hard-load prod and check the console.
- **Migrations** — `supabase/migrations/` holds `0001`–`0012`. **Next is `0013`.**
- **Roles** — the incident audience (`leadersOnly` filter in `getActorFeed`) is exactly
  `zoneLeader | director | admin`. Church logins are **gender-scoped** (`users.gender_scope`,
  `b-`/`g-` prefixed usernames, migration `0006`) and are enforced through `canAccessPerson`.

---

## 3. The three triggers

| # | Trigger | Audience | Latency target | Source of truth |
|---|---|---|---|---|
| 1 | **High-severity incident logged** | admin + director + zoneLeader (identical to the existing `leadersOnly` urgent notice) | as close to immediate as the design allows | the `Notification` row `incident.service.log()` already creates |
| 2 | **Scheduled notice fires** | that notice's normal audience (`scope` + `leadersOnly` rules in `getActorFeed`) | within one cron tick of `scheduledFor` | `notifications.scheduled_for` (migration `0010`) |
| 3 | **Check-in window closing soon** (60 min before the AM or PM window `End`) | the church **logins** with students still unchecked for the closing session | within one tick | `settings.checkin_window_*` + `Person.checkInHistory` |

**Trigger 3 firing conditions (D4), all required:**

1. `settings.churchCheckinTimeRestricted === true`. When the toggle is off the window times still
   exist but are not a real deadline, so "closing soon" would be misleading.
2. Today (in `settings.timezone`) is in `settings.checkInDays`.
3. The current zoned time is within 60 minutes of that session's window `End` — **both** AM and PM.
4. `remaining > 0` for that login. Never send "0 students still to check in".
5. Audience is **church logins only**. No zone-leader copy, no escalation — that feature stays out
   of scope.

Conditions 1–3 also gate whether the job runs its queries at all (§4.1), so the expensive
person scan happens on roughly 24 ticks a day during camp week rather than all 288.

Trigger 2 **replaces the lazy-fire model**: today a scheduled notice only appears when someone
happens to open the app (`getActorFeed`'s `n.scheduledFor > now` filter). It keeps working exactly
as-is for anyone without a push subscription — the filter is not being removed. Push is strictly
additive on top of it.

---

## 4. Architecture

```
Supabase pg_cron ──► pg_net.http_get ──► GET /internal/cron/tick   (Authorization: Bearer $CRON_SECRET)
    (*/5 * * * *)                            │
                                             ├─ job B: create check-in-closing notices
                                             │         (gated by §3 conditions 1-3; dedupe_key,
                                             │          at most one per church-login × session)
                                             ├─ job C: claim unsent pushable notices
                                             │         (scheduled_for <= now OR immediate;
                                             │          push_sent_at is null → set now())
                                             └─ job D: resolve audience + fan out web-push
                                                  │  audience = canSeeNotification() per user,
                                                  │             minus inactive / login-locked (§4.9)
                                                  │  404/410 → delete the subscription row
                                                  │  429/5xx → failure_count++ (delete after 10)
                                                  ▼
                                       service worker `push`
                                            ──► showNotification(title, "Open the app…")
                                       service worker `notificationclick`
                                            ──► focus/open '/' + postMessage({type:'push-nav', screen})

incident.service.log(severity:'high')  ──► saves Notification ──► void sendPushForNotification(n)
    (inline, best-effort, not awaited — D2)                          races job C safely via the claim
```

Note there is no separate "job A". The old draft had job A fire due scheduled notices and job C
claim them; in fact **the claim *is* the firing**. A scheduled notice needs no state change to
become live — `getActorFeed` already reveals it the moment `scheduledFor <= now`. Job C's
`push_sent_at` claim over `scheduled_for <= now()` is the whole of trigger 2.

### 4.1 The scheduled tick — Supabase `pg_cron`, not Vercel Cron (D1)

**Why not Vercel Cron.** The project is on Vercel's **Hobby (free)** plan, whose cron entitlement is
daily triggering only — a `*/5` expression is accepted in `vercel.json` but fires once a day. That
is fatal for trigger 3, which must notice a window closing within the hour. Vercel Pro (~US$20/mo
per seat) would lift it. Not worth paying for, because the database already has a scheduler.

**What replaces it.** `pg_cron` calls the same route over HTTP via `pg_net`, at the same cadence,
with the same bearer secret. **Everything downstream of the HTTP request is identical** — the route,
its guard, all three jobs, the claim, the fan-out. Only the caller changes.

```sql
-- in migration 0013, so the schedule is in git and reproducible
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- one-time, out of band (do NOT commit the secret to a migration):
--   select vault.create_secret('<the-cron-secret>', 'cron_secret');

select cron.schedule('camp-push-tick', '*/5 * * * *', $$
  select net.http_get(
    url     := 'https://my-youth-camp.vercel.app/internal/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 25000
  );
$$);
```

**Why 5 minutes:** trigger 2 (a scheduled notice) is the one with a user-visible promise — an admin
picks a minute in the SPA's `datetime-local` and expects delivery near it. 5 minutes is the worst-
case skew; 15 would be noticeable. Trigger 1 no longer depends on the cadence at all under D2.
Trigger 3's 60-minute lead window absorbs 5 minutes without difficulty.

**Cost of the cadence.** 288 ticks/day, each a cold-ish serverless invocation. The tick must
therefore be **cheap when there is nothing to do**: check the §3 conditions 1–3 *before* the job-B
person scan, so the expensive path runs ~24 times a day during camp week and never outside it.
Jobs C and D are indexed queries over `notifications` and are cheap unconditionally.

**Things `pg_cron` gets you that Vercel Cron does not:** `select * from cron.job_run_details order
by start_time desc limit 20` is a real execution history, and `select cron.unschedule
('camp-push-tick')` is an instant kill switch that needs no deploy.

**Things to watch, specific to this choice:**

- The schedule lives in the database, not the repo, unless the `cron.schedule` call is in a
  migration. **It must be in migration `0013`** — otherwise it exists only in prod and is invisible
  to every future reader.
- `pg_net` is **fire-and-forget and async**. It does not surface the HTTP response to the caller;
  responses land in `net._http_response`. A 500 from the tick is therefore **silent** unless
  someone looks. The tick handler must log its own outcome server-side (Vercel function logs) —
  do not rely on the caller to notice failure.
- A **paused Supabase project stops the scheduler** with no warning. The Supabase free tier pauses
  projects after a week of inactivity; this project is in daily use during camp but could pause in
  the off-season, and the schedule resumes on restore.
- `pg_cron` schedules are interpreted in the **database's** timezone (UTC here). Irrelevant, because
  §6 forbids wall-clock cron expressions and mandates a fixed interval — but do not "fix" this by
  writing `0 1 * * *` and reasoning about Brisbane.
- The secret is now in **two** places (Vault and the Vercel env var). Rotating means updating both.
  Record this in `SECURITY-ACTIONS.md`.

**The route is not part of the app's normal auth layer.** It is `auth: false` in the route table
and instead compares `headers.authorization` to `Bearer ${process.env.CRON_SECRET}` using a
constant-time compare (`crypto.timingSafeEqual`), 401 otherwise. `CRON_SECRET` is a Vercel env var
marked Sensitive. The route path starts `/internal/`; **do not** add `internal` to `sw.js`'s
`API_RE` — the SPA never calls it and the tick is server-to-server, so it never passes through a
service worker.

### 4.2 Trigger 1 fires inline, with the tick as sweeper (D2 — ACCEPTED)

A high-severity incident is child-safeguarding data. A tick-only design would mean a zone leader
logs "student X has been injured / has disclosed Y" and the director's phone buzzes **up to 5
minutes later**. The owner accepted the hybrid instead.

**Design:** `incident.service.log()` fires the push **inline, best-effort**, immediately after
saving the notification — `void sendPushForNotification(notif).catch(log)`, **not awaited**, so a
slow or failing push service can never make the incident form hang or error. The scheduled tick then
acts as a **sweeper**: job C picks up any notification with `push_sent_at is null` and sends it,
covering the case where the inline attempt died with the serverless function before completing.

The claim-row mechanism in §5 makes the two paths safe to run concurrently — whichever claims the
row first sends, the other sends nothing. This is the reason the claim is non-negotiable rather
than a nicety.

**Testing consequence:** the inline path must be tested for the property that matters — that a
throwing/slow `sendPushForNotification` does **not** reject `incident.service.log()`. A test that
only asserts "push was called" misses the whole point of `void`.

### 4.3 VAPID key management

- One P-256 keypair, generated once (`npx web-push generate-vapid-keys`).
- Vercel env vars, all three set for Production **and** Preview (a preview deploy that can't sign
  will 500 the cron): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (mark **Sensitive**),
  `VAPID_SUBJECT` (`mailto:` of the ministry contact — push services use it to reach you about
  abuse).
- Read them in `src/config/env.ts` alongside the existing keys, or directly from `process.env` in
  the push service mirroring how `field-crypto.ts` reads its keys. Prefer `env.ts` for the two
  non-secret ones and direct `process.env` for the private key, matching existing practice.
- **The public key is served to the client, not baked into `index.html`.** New route
  `GET /push/config` (authenticated) returns `{ publicKey, keyId }`. Hardcoding it in the SPA would
  mean a rebuild + `sw.js` bump to rotate.
- **Rotation is not routine and is not cheap.** A push subscription is bound to the
  `applicationServerKey` it was created with; pushes signed by a different key are rejected
  (typically 403). Rotating the VAPID keypair therefore **invalidates every existing subscription**
  and every device must re-subscribe. Procedure: publish the new `keyId` from `/push/config`; the
  client stores the `keyId` it subscribed under and, on mismatch, calls
  `subscription.unsubscribe()` → `DELETE /push/subscribe` → re-subscribe. Rotate only on suspected
  compromise of the private key.
- **Losing the VAPID private key is not a data-loss event** — unlike `FIELD_ENCRYPTION_KEY`, it
  decrypts nothing. It only authorises sending. Do not conflate the two in the runbook.
- Dependency: the `web-push` npm package (server-side only). Implementing RFC 8291 by hand is not
  worth it.

### 4.4 `push_subscriptions` table (migration `0013`)

```sql
create table if not exists push_subscriptions (
  id                text primary key,
  user_id           text not null references users(id) on delete cascade,
  endpoint          text not null unique,
  p256dh_enc        text not null,       -- field-crypto envelope
  auth_enc          text not null,       -- field-crypto envelope
  consent_version   int  not null default 1,
  created_at        timestamptz not null default now(),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  failure_count     int  not null default 0
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
```

Design notes:

- **Binds to `users.id`, not to a `Person`.** The subscriber is an *account holder* (a leader, a
  church login), never a camper. No minor ever has a subscription row. `on delete cascade` means
  deleting an account takes its devices with it.
- **Multiple devices per account is expected and required.** A `b-victory` church login is a
  *shared* account that several leaders may install on their own phones. The unique key is
  `endpoint`, not `user_id`. Re-subscribing on the same device produces the same endpoint → upsert
  on `endpoint`, refreshing the keys and `created_at`.
- **`p256dh` / `auth` are encrypted at rest** with the existing `field-crypto` codec inside the
  repository mapper only (`src/repositories/supabase/supabase.push-subscriptions.ts`), AAD
  `push_subscriptions:p256dh:<id>` / `push_subscriptions:auth:<id>` — identical to the pattern in
  `supabase.notes.ts` / `supabase.notifications.ts`. Services and the in-memory repo stay unaware.
- **`endpoint` is stored plaintext** so it can carry a unique index (needed for upsert-on-
  resubscribe and for pruning) — AES-GCM is randomised and cannot be indexed. Trade-off accepted:
  the endpoint is an opaque URL at a Google/Apple/Mozilla host and is not itself a name; the
  identifying linkage is the adjacent `user_id`, which is not encryptable either. If the org later
  wants the table to survive a raw DB dump alone, the upgrade path is `endpoint_hash text unique`
  (sha256) + an encrypted `endpoint_enc`. Not recommended for v1 — more moving parts, small gain.
- **No `user_agent`, no IP, no device name column.** Deliberate: they would be new personal data
  with no operational use here. Only add one if a "which device is this?" UI is actually requested.
- **RLS**: `enable row level security` with **no policies**, exactly like every other table in
  `0002_rls.sql`. The API connects as `postgres` (bypasses RLS); a Supabase anon-key connection is
  denied all rows. Add the table to the list in `0002` mentally, but the `enable` statement lives in
  `0013` (same as `incidents` did in `0007`).
- **Pruning**: on a `404` or `410` from the push service, `delete from push_subscriptions where
  endpoint = $1` immediately — this is the standard self-cleaning contract and it is the only
  reliable way the table stays small. On `429`/`5xx`, bump `failure_count` and set
  `last_failure_at`; delete once `failure_count >= 10`. A sweep in the same cron deletes rows with
  `last_success_at < now() - interval '90 days'` (or `created_at` when never successful).

### 4.5 Other migration `0013` columns

```sql
alter table notifications add column if not exists push_sent_at timestamptz;
alter table notifications add column if not exists dedupe_key   text;
create unique index if not exists notifications_dedupe_key_idx
  on notifications(dedupe_key) where dedupe_key is not null;
```

Both are needed by §5. `dedupe_key` is nullable and the index is partial so ordinary notices are
unaffected. `Notification` (`src/core/entities/notification.ts`) gains two optional fields, and
`notifColumns()` / `toNotif()` gain two lines. Note the existing `save()` on-conflict `do update
set` list must be widened to include `push_sent_at` — otherwise the claim would silently never
persist (the repo has a documented history of exactly this class of bug: `PERSON_UPDATE_COLS`
missing three columns, and the item-9 widening for `scheduled_for`).

### 4.6 Migration gotcha (project-specific, documented in CLAUDE.md)

Applying a migration through the Supabase MCP `apply_migration` tool records the history row under a
**generated timestamp version**, not the file's `0013`. Every migration on this project therefore
needs the follow-up:

```sql
update supabase_migrations.schema_migrations
   set version = '0013'
 where version = '<generated timestamp>';
```

Skipping it breaks the clean `0001`…`00NN` sequence the 2026-07-16 consolidation established and
makes a future `supabase db push` re-apply or mis-order.

### 4.7 Service worker (`public/sw.js`)

Two new top-level handlers, plus `CACHE` bumped **`camp-v45` → `camp-v46`** and `push` added to
`API_RE` (`internal` deliberately **not** added — see §4.1):

```js
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Youth Camp', {
    body:  d.body || 'Open the app for details.',
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag:   d.tag || 'camp',            // collapses repeats of the same alert
    data:  { screen: d.screen || 'home' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const screen = (e.notification.data && e.notification.data.screen) || 'home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ('focus' in c) { c.postMessage({ type: 'push-nav', screen }); return c.focus(); }
    return self.clients.openWindow('/?nav=' + encodeURIComponent(screen));
  }));
});
```

**`userVisibleOnly: true` is mandatory** on every browser that matters. The service worker *must*
call `showNotification()` for every push it receives; a push that shows nothing gets the origin
penalised or the subscription revoked. This has a direct privacy consequence — see §9.5. There is
no "silent push, decide later" option.

**Deep-linking gotcha:** this SPA has **no URL router** — navigation is `go(screenId)` against a
fixed set of `<section class="screen" id="…">` elements. So `notificationclick` cannot navigate by
URL. It `postMessage`s the target screen to the focused client, and `public/index.html` adds a
`navigator.serviceWorker.addEventListener('message', …)` handler near the existing registration
block (~line 5206) that calls `go(msg.screen)`. The `openWindow('/?nav=…')` cold-start path needs a
matching one-shot read of the query string at boot. If that plumbing is judged not worth it for v1,
opening the app at home is an acceptable degradation — say so explicitly rather than half-building
it.

### 4.8 SPA subscribe / unsubscribe surface

- **Where**: a compact "Alerts on this device" card at the bottom of `renderHomeAtCamp()` (and the
  pre-camp home for admin/director, who can receive incident alerts pre-camp — incidents are
  role-gated, not mode-gated, per the 2026-07-17/18 revert). Not in Admin Settings: the toggle is
  **per device**, and the account that most needs it (church) has no admin console.
- **States the card must render**, because each has a different remedy:
  1. Not installed to Home Screen **and** iOS → "Install this app to get alerts" + Share → Add to
     Home Screen instructions. No permission prompt is possible here (§8).
  2. Installed / non-iOS, permission `default` → "Turn on alerts" button.
  3. Permission `granted` + subscription present → "Alerts on · Turn off".
  4. Permission `denied` → explain it must be re-enabled in OS/browser settings; the app cannot
     re-prompt.
- **Flow**: user tap → show the consent copy (§9.4) → `Notification.requestPermission()` →
  `navigator.serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey })` → `POST /push/subscribe { endpoint, keys:{p256dh,auth}, keyId }`.
  Off → `subscription.unsubscribe()` + `DELETE /push/subscribe { endpoint }`.
- **Never call `requestPermission()` on load.** Only from a deliberate tap, after the consent copy.
- **Preview-mode gotcha**: `api()` short-circuits every non-GET while `PREVIEW_MODE ||
  ACCOUNT_PREVIEW`. So subscribing is blocked inside at-camp preview and account preview — which is
  *correct* (an admin previewing a church account must not register their own phone against that
  account), but the card must hide or disable itself in those modes rather than surfacing the
  generic "not available in preview" toast.
- **`sw.js` bump is required** because `public/index.html` changes.

### 4.9 Audience resolution (D10, D8) — the piece the first draft left unspecified

The original §4 said "fan out to the push_subscriptions of the resolved audience" without saying how
the audience is resolved. It is the largest genuinely-unbuilt part of this feature and it has a trap
in it.

**The trap.** Today, audience lives in `notification.service.getActorFeed` as a *forward filter*:
given an actor, which notices can they see? Push needs the **inverse**: given a notice, which users?
Writing a second implementation of the same rules guarantees eventual drift — a leader pushed about
a notice they cannot open, or (worse) a `leadersOnly` incident pushed to a church login whose feed
correctly hides it. The rules are non-trivial: scope camp/zone/church, the `leadersOnly` role gate,
the `scheduledFor` withhold, and admin/director seeing every scope.

**The fix — one predicate, both directions:**

```ts
// src/services/notification-visibility.ts  (NEW, pure, no I/O)
export function canSeeNotification(
  actor: Pick<Actor, 'role' | 'zone' | 'churchId'>,
  n: Notification,
  nowIso: string,
): boolean
```

Lift the body of `getActorFeed`'s `.filter()` into it verbatim. Then:

- `getActorFeed` becomes `active.filter((n) => canSeeNotification(actor, n, now))` — **no behaviour
  change**, and that is exactly what its existing tests should prove.
- The push audience resolver loads all users once and returns
  `users.filter((u) => canSeeNotification(actorFromUser(u), n, now))`.

A single test asserting the two agree over a matrix of (role × scope × leadersOnly) is then
meaningful, because there is only one rule set to be right about.

**Then subtract the accounts that must not be reached (D8).** This is the finding that came out of
the owner's "accounts are locked after camp" answer. `churchLoginLocked` and
`zoneLeaderLoginLocked` are read in **exactly one place** — `auth.service.login`, after the password
check (verified). They block **login**. A push subscription is independent of any session, so
without this step a locked-out leader's phone keeps receiving camp pushes indefinitely, and the
owner's post-camp lock would create a false sense of closure.

```ts
function isPushSuppressed(u: User, s: CampSettings): boolean {
  if (u.status !== 'active') return true;                          // closes P4
  if (u.role === 'church'     && s.churchLoginLocked)     return true;
  if (u.role === 'zoneLeader' && s.zoneLeaderLoginLocked) return true;
  return false;
}
```

Three properties make this the right shape rather than deleting subscription rows:

- **It reuses the control the owner already relies on.** Locking accounts after camp now genuinely
  stops everything, which is what they assumed it did.
- **It is reversible.** Unlocking for next camp restores alerts with no device re-subscribe, no
  re-consent, no support cost. A row delete would silently require every leader to opt in again.
- **It removes the need for an admin "revoke all devices" screen** (D7). Deactivating an account is
  now the lost-phone runbook, and it is a control that already exists on the Accounts screen.

Deliberately **not** suppressed: `mustChangePassword`. That blocks app use but says nothing about
whether the human should be alerted, and suppressing it would silently mute a leader who has simply
not got round to changing a temp password.

**Cost note.** The resolver loads the full `users` table per notification. That is tens of rows
here, not thousands — no index work needed. If job C claims several notices in one tick, load users
**once** and reuse across them.

---

## 5. Idempotency / delivery-once

Ticks can overlap (a slow run still executing when the next one starts), the inline incident path
(§4.2) races the sweeper by design, and `pg_net` may deliver a duplicate request. A leader must never
be pushed the same thing twice. Two layers:

> **An earlier draft had a third layer — `pg_try_advisory_lock(hashtext('cron:push'))` around the
> whole tick — and it has been DELETED (D9).** It is not merely redundant here, it is actively
> unsafe: this app reaches Postgres through Supabase's **transaction pooler**, where a
> *session*-level advisory lock is taken on a backend connection that is returned to the pool
> partway through the handler. The lock can outlive the tick and wedge every subsequent run until
> the backend recycles, with no error anywhere. Layer 2 below is a genuine guarantee on its own and
> needs no help. If a future change ever does want a lock, it must be `pg_advisory_xact_lock`
> inside an explicit transaction, never the session form.

**Layer 1 — atomic claim, the actual guarantee.**
Delivery is gated on a single-statement conditional update:

```sql
update notifications
   set push_sent_at = now()
 where id = any($1) and push_sent_at is null
returning id;
```

Only the rows actually returned get pushed. Postgres row locking makes this atomic, so two
overlapping runs (or the inline incident send from §4.2 racing the sweeper) each get a disjoint set
and no notification is ever sent twice. The claim happens **before** the HTTP fan-out.

Failure mode of claim-before-send: a crash between the claim and the send loses that push
permanently. That is the right trade for this app — a duplicate lock-screen safeguarding alert is
worse than a missed one, and the **in-app feed is the guaranteed channel** in every case. Do not
"fix" this by claiming after send.

**Layer 2 — `dedupe_key` for anything the tick *creates*.**
Trigger 3 has no pre-existing row: the tick must create the "window closing" notice itself. Its
key is deterministic:

```
checkin-warn:<sessionId>:<churchUserId>      e.g. checkin-warn:2026-09-29~am:usr_abc
```

Keyed on the **church login id, not the church id** — church accounts are gender-scoped
(`b-`/`g-`), so `b-victory` and `g-victory` are two audiences with two different counts and must be
able to hold two separate notices for the same session.

Inserted with `on conflict (dedupe_key) do nothing`. Two overlapping runs, or twelve consecutive
ticks inside the one-hour lead window, still produce exactly **one** notice per church login per
session —
and, because pushing is gated on `push_sent_at`, exactly one push. This replaces the 07-23 spec's
`warned_checkin_sessions` marker table with a mechanism that also serves triggers 1 and 2. The
markers are purged for free by `admin.service` `reset` / `newYear` (which already truncate
`notifications`).

**Per-trigger summary**

| Trigger | Row created by | Dedupe |
|---|---|---|
| 1 — incident | `incident.service.log()` (exists today) | `push_sent_at` claim; inline send and tick sweeper race safely |
| 2 — scheduled notice | the author, via `RENDER.compose` (exists today) | `push_sent_at` claim; `scheduled_for <= now()` selects it |
| 3 — window closing | the **tick** (job B) | `dedupe_key` unique insert, then `push_sent_at` claim |

**Per-device duplicates** are separately prevented by the `endpoint` unique constraint (a device
that re-subscribes replaces its row rather than adding one) and by the SW's `tag` (a repeat with the
same tag replaces the visible notification rather than stacking).

---

## 6. Timezone

Everything operational in this app is **Australia/Brisbane, UTC+10, no DST** — which removes the
hardest class of bug but not the offset bug.

**Scheduler expressions are UTC** — true of Vercel Cron, and equally true of `pg_cron`, which runs
in the database's timezone (UTC on Supabase). D1 does not change this rule or soften it. The rule
that follows:

> **Never encode a wall-clock time in the cron expression.** Run a frequent fixed-interval tick
> (`*/5 * * * *`) and do *all* date/time reasoning inside the handler with
> `zonedNow(settings.timezone)`.

A `*/5` interval is offset-invariant, so the cron expression itself carries no timezone risk. If a
future change ever wants a once-daily job, `11:00` Brisbane is `01:00` UTC — but that form should be
avoided entirely.

**Inside the handler:**

- **Trigger 2 needs no conversion.** `notifications.scheduled_for` is a `timestamptz` holding an
  *instant*, and the SPA already converts the admin's `datetime-local` input as Brisbane UTC+10 via
  `_localInputToIso`. Comparing `scheduled_for <= now()` is instant-vs-instant and is timezone-safe
  in either direction. Do not "helpfully" add an offset here.
- **Trigger 3 needs conversion and is where it can go wrong.** The windows are `HH:MM` **text**
  (`checkin_window_am_start` etc.), the camp days are `YYYY-MM-DD` text, and `allowedWindowSession`
  compares strings. The handler must therefore do exactly:

  ```ts
  const settings = await settingsRepo.getSingleton();
  const tz = settings?.timezone || DEFAULT_TZ;            // 'Australia/Brisbane'
  const { date, time } = zonedNow(tz);                    // e.g. { date:'2026-09-29', time:'11:07' }
  const windows = {
    amStart: settings.checkinWindowAmStart ?? '06:00',
    amEnd:   settings.checkinWindowAmEnd   ?? '12:00',
    pmStart: settings.checkinWindowPmStart ?? '12:00',
    pmEnd:   settings.checkinWindowPmEnd   ?? '22:00',
  };                                                       // identical resolution to assertSessionAllowed
  ```

  then compute "is `time` within `leadMinutes` before `amEnd` (or `pmEnd`) on a day in
  `settings.checkInDays`". Minute arithmetic on `HH:MM` strings (`hh*60+mm`) stays in the same
  string domain as the rest of the check-in code — do **not** build `Date` objects for this.

**Failure mode if it's got wrong.** Using `nowISO().slice(0,10)` (UTC) instead of
`zonedNow(tz).date`: Brisbane is UTC+10, so **between 00:00 and 10:00 Brisbane the UTC date is
yesterday**. The AM window closes at 12:00 Brisbane = 02:00 UTC, squarely inside that band. A
UTC-derived "today" would therefore look up **yesterday's** camp day, and:

- on camp day 1, yesterday is not in `checkInDays` at all → `allowedWindowSession` returns null →
  **the AM reminder is silently never sent, on every day of camp**, with no error anywhere;
- on later days it would resolve yesterday's session id (`2026-09-28~am`) and count check-ins
  against a session that closed 24h earlier → **every church looks "behind"** and gets a spurious
  push, and the `dedupe_key` would collide with yesterday's real key so the correct notice could
  never be created.

Both failures are silent — no exception, no log. This exact bug has already bitten this codebase
twice (defect B3; the SPA's `localDateISO()` fix on 2026-07-04). **Any test for the cron must pin
`zonedNow` and assert behaviour at ~09:00 Brisbane / 23:00 UTC the previous day**, which is the
instant that catches it.

Secondary: `settings.timezone` is a plain string and could be set to something invalid — `zonedNow`
falls back to the *host's* local values, which on Vercel is UTC. The cron should log a warning if
`settings.timezone` is empty or unparseable rather than proceeding silently.

---

## 7. Migration `0013` — summary

One file, `supabase/migrations/0013_push_subscriptions.sql`:

1. `create table push_subscriptions (…)` + index (§4.4)
2. `alter table push_subscriptions enable row level security;` (no policies, matching `0002`)
3. `alter table notifications add column if not exists push_sent_at timestamptz;`
4. `alter table notifications add column if not exists dedupe_key text;` + partial unique index
5. `create extension if not exists pg_cron;` + `create extension if not exists pg_net;` (D1)
6. `select cron.schedule('camp-push-tick', '*/5 * * * *', $$ … $$);` (§4.1) — **the schedule belongs
   in the migration**, or it exists only in prod and is invisible to every future reader. The
   secret is read from Vault at run time and is **never written into the migration**.

The Vault secret itself (`select vault.create_secret('<secret>', 'cron_secret')`) is a one-time
out-of-band step, like the post-deploy admin password — it is not in the migration and must be in
the phase-1 runbook or the scheduled tick will 401 forever, silently (P14).

Additive and safe to apply **before** the code push (unlike migration `0012`, which had to follow
its code). Note the standing project rule that `supabase.settings` writes *all* settings columns on
every save — irrelevant here since `settings` is untouched, but the equivalent for `notifications`
is the on-conflict list widening called out in §4.5.

Then the version-reconciliation `update` from §4.6.

---

## 8. iOS is the adoption limitation — read this before scoping

**On iOS and iPadOS, Web Push works only when the site has been added to the Home Screen and is
launched from that icon.** In Safari as a normal tab there is no Push API, no permission prompt, and
no way to ask — the "Turn on alerts" button simply cannot exist. This is Apple's model, not a bug or
a configuration gap, and it is the single biggest risk to this feature actually working at camp.

Practical consequences for *this* app's users:

- **A church leader who has been using the app in a Safari tab gets nothing.** No prompt, no
  degraded alert, no explanation — unless the app explicitly tells them.
- **Installing is a behaviour change mid-camp**: Share → Add to Home Screen. Non-obvious, and easy
  to get wrong (people bookmark instead).
- **The installed PWA has a separate storage partition from the Safari tab.** The leader will be
  **logged out** inside the newly installed app and must log in again — and because church logins
  are randomised memorable passwords (`Word.##`) handed out on a CSV, some will not have it to
  hand. The initials prompt (`enforceInitials()`) also re-runs, since
  `localStorage['ycp_initials_<user>']` does not carry over. Budget for this in rollout comms; it is
  a real support cost, not a footnote.
- **Deleting the Home Screen icon silently kills the subscription** (the endpoint 404/410s and gets
  pruned). The leader will believe alerts are on.
- **Focus/Do Not Disturb, and per-app notification settings**, can suppress delivery with no signal
  back to the server. A successful `201` from the push service means *accepted for delivery*, never
  *seen*.
- I have **not verified** the exact minimum iOS version or the current behaviour of the permission
  prompt on the owner's devices. iOS 16.4+ is the widely-documented floor for installed-PWA Web
  Push; treat anything more specific as needing an on-device check before rollout.

### Mitigations

1. **The in-app path stays the guaranteed channel, always.** All three triggers already produce (or
   will produce) a `Notification` row that appears in the normal feed. Push is a *notification of a
   notification*. Nothing is push-only, ever. This is the mitigation that makes the rest optional.
2. **An "Install to enable alerts" prompt** on the home screen for iOS users in a browser tab,
   detected via `!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone`
   plus an iOS user-agent check, with the three-step Share-sheet instructions inline. Dismissible,
   remembered in `localStorage`, re-shown once per camp year.
3. **Android/Chrome/Edge** can be offered a real install via `beforeinstallprompt`; iOS cannot.
4. **Set expectations in the admin UI.** The admin's "Randomise & export church passwords" flow and
   the pre-camp comms should say plainly which leaders are actually reachable by push. Better: a
   small admin-only readout — "12 of 20 accounts have at least one device registered for alerts" —
   derived from `push_subscriptions`. Without it the director will *assume* the camp is covered.
5. **Do not let trigger 3 become the only warning a church gets.** It already has the in-app urgent
   notice and the hard window enforcement (`assertSessionAllowed`), which fails loudly at the point
   of use.

---

## 9. PRIVACY ASSESSMENT

**This app's entire subject population is minors.** Incident summaries, first-aid records and notes
are child-safeguarding data. The app already reflects this: `incidents.summary` and `notes.body`
are AES-256-GCM encrypted at rest, `notifications.body` is encrypted **when `leadersOnly`**, the
`leadersOnly` flag keeps incident alerts off church and first-aid feeds, and reveals of Medicare
numbers and masked contacts are audit-logged. Web Push moves data **outside every one of those
controls** — off the authenticated app surface, through a third party, onto a lock screen. It
deserves the scrutiny below.

### 9.1 Push payload contents — the central decision

**What is technically true.** A Web Push payload is encrypted end-to-end under RFC 8291 (aes128gcm)
to the subscription's `p256dh`/`auth` keys, which only that browser instance holds. **Apple, Google
and Mozilla cannot read the payload.** They are a blind relay. This is genuinely strong and is often
where the analysis stops.

**Why that is not sufficient here.** The service worker decrypts the payload and hands it to the
**operating system**, which renders it as a notification. On a locked iPhone with "Show Previews:
Always" (the default), the body text is legible **to anyone holding the phone** — no passcode, no
Face ID, no app login. That is the actual disclosure surface, and it is downstream of all the
encryption.

**Options assessed:**

| Option | What lands on the lock screen | Assessment |
|---|---|---|
| **A. Full summary** — `title: "Incident logged · Blue Zone"`, `body: <incident.summary>` | The verbatim safeguarding summary, likely naming a minor and describing an injury or disclosure | **Reject.** This takes a field the codebase deliberately encrypts at rest and deliberately hides from church/first-aid accounts, and renders it in plaintext on an unlocked-by-default surface, on a device that this app's own UX assumes is passed between leaders (§9.5). It also inverts the `leadersOnly` control: the *account* is a leader, but the *person reading the screen* is whoever picked up the phone. |
| **B. Partial** — title only, e.g. `"Incident logged · Blue Zone"` | Category, zone, and a timestamp | Better, still leaks. On a 4-zone camp, "incident, Blue Zone, 21:40" plus the well-known fact of who is in that zone narrows the subject considerably, and the *existence* of an incident is itself information the org may not want visible to a bystander. |
| **C. Title-only, non-specific — RECOMMENDED** — `title: "Camp: urgent alert"`, `body: "Open the app to view."` | That an urgent camp alert exists, and when | Discloses only that *something* happened. Every specific — summary, zone, names, severity wording — stays behind the authenticated app, where `leadersOnly` and `canAccessPerson` still apply and the reveal-audit still works. |

**Recommendation: Option C, enforced by a single structural rule, not by per-call-site judgement:**

> **A server-stored `body` is never placed in a push payload.** The push sender constructs its
> payload from a fixed template keyed on trigger type. It does not read `notification.body`,
> `incident.summary`, or any person field.

Stated that way it is testable (`expect(payload).not.toContain(summary)`), reviewable, and cannot
regress by someone "improving" the copy. It also removes an ugly secondary problem: because
`notifications.body` is encrypted at rest when `leadersOnly`, a full-payload design would require
the cron to **decrypt safeguarding data purely in order to ship it to Apple** — technically fine
(E2E encrypted in transit) but exactly the kind of data flow you do not want to have to explain.

Concrete payloads:

| Trigger | `title` | `body` | `screen` |
|---|---|---|---|
| 1 — incident | `Camp: urgent alert` | `Open the app to view details.` | `incidents` |
| 2 — scheduled notice | `Camp notice` | `Open the app to read it.` | `notices` |
| 3 — window closing | `Check-in closing soon` | `3 students still to check in — the morning window closes at 12:00.` | `checkin` |

Trigger 3 is the one deliberate exception and is defensible: it carries an **aggregate count**, a
session label and a clock time. No name, no grade, no gender, no church other than the recipient's
own. A count is not personal data about any identifiable minor. Include the count — it is the entire
operational value of the alert; a bare "check-in closing" would send leaders into the app to
discover there was nothing to do, and the alert would be ignored within a day.

**Also**: the notification `tag` and `screen` values must be generic strings (`camp-alert`,
`incidents`) — never a person id or a session id containing identifying context. And the SW's
fallback `d.title || 'Youth Camp'` must not be swapped for something that names the ministry more
specifically than the installed app icon already does.

### 9.2 Third-party data flow

Every push transits **Apple (APNs, for iOS/Safari)**, **Google (FCM, for Chrome/Android/Edge)** or
**Mozilla (autopush, for Firefox)**, selected by the subscription endpoint — the recipient's browser
chooses, the org does not. What each receives per message:

- **The endpoint URL** — a stable pseudonymous identifier for one browser install on one device.
- **The encrypted payload blob** — opaque to them, but its **size** is visible (and our fixed-
  template payloads are near-constant size, which is mildly helpful).
- **Timing** — the exact instant of every send.
- **Our VAPID public key and `mailto:` subject** in the signed request, identifying the sending
  application to them across all its messages.
- **TTL / urgency headers** we set.
- Network-level metadata (our function's source region — `syd1`).

**What that leaks even with an unreadable payload:**

- **The existence and rate of events.** A burst of pushes to a specific set of endpoints at 02:10
  on a Saturday tells the relay that something happened at that organisation at that time. Over a
  camp, the pattern of trigger-3 reminders alone maps the daily rhythm.
- **The social graph of the account set.** The endpoints that always receive the same message at the
  same instant are the leadership group; those receiving distinct church-scoped messages are
  separate churches. This is derivable without any payload.
- **Device liveness.** Apple/Google already know whose device each endpoint is (it is tied to their
  own push token, and on iOS to an Apple ID). So "this named Apple ID is receiving messages from a
  youth-camp app" is knowable to Apple **even though no camper data ever reaches them**.
- Note the subjects of that metadata are **leaders, not minors** — the minors are only ever
  referenced obliquely ("3 students"). That is a meaningful reduction in sensitivity and is a direct
  consequence of the §9.1 rule.

Not assessable from here: whether the org has any policy or contractual position on transferring
even metadata to US-based processors. Flagged as an open question rather than guessed at.

### 9.3 New personal data stored

The subscription endpoint is **new personal data the app does not hold today**: a persistent,
per-device identifier bound to a named leader account. It is stable across app launches and survives
logout unless deliberately deleted. Two people sharing one church login produce two endpoints;
correlating endpoint → device → human is trivial for anyone with the DB.

**Retention and deletion policy (proposed, concrete):**

| Event | Action | Rationale |
|---|---|---|
| **Explicit logout** (`logout()`) | **keep** (D6) | Reversed from the first draft, which assumed logout meant a device hand-off. Under D5 the phone is the leader's own, so logout is routine — and with a 24h token TTL (`TOKEN_TTL_MS`, `auth.service.ts:10`; note `CLAUDE.md` says 12h and is wrong) leaders re-login roughly daily. Deleting would force a daily re-tap and feed straight into the alert-fatigue failure mode. |
| **Session expiry** (24h TTL, no explicit logout) | keep | Otherwise every leader loses alerts overnight, which defeats the feature. |
| **Account deactivated** (`account.service` `toggleStatus`) | **keep the row; suppress at send time** (§4.9) | Changed from the first draft's "delete". Suppression closes P4 just as effectively, and is reversible — reactivating restores alerts without every device re-subscribing and re-consenting. The FK cascade point still stands: it fires on *delete*, not deactivate, so something had to handle this either way. |
| **Role login-locked** (`churchLoginLocked` / `zoneLeaderLoginLocked`) | **suppress at send time** (§4.9) | **NEW — D8.** Not in the first draft at all. This is the owner's post-camp control and it blocks login only; without the resolver check, locked-out leaders' phones keep buzzing indefinitely. |
| **Account deleted** | automatic | `on delete cascade`. |
| **Church passwords randomised** (`POST /accounts/churches/randomize-passwords`) | delete all `role='church'` subscriptions | Passwords are being redistributed; the set of humans behind those accounts is changing. Unlike deactivation this is **not** reversible in intent — the previous holders should not silently keep alerts. |
| **New-year rollover** (`admin.service.newYear`) | delete all | The rollover already purges people and transient data; device registrations from last year's leaders must not survive into a new camp with a partly different team. **This needs an explicit `pushSubscriptionRepo.deleteAll()` call — it is not automatic.** |
| **Factory reset** (`admin.service.reset`) | delete all | Same. |
| **404 / 410 from the push service** | delete immediately | Standard, and the main self-cleaning mechanism. |
| **No successful send in 90 days** | delete in the cron sweep | Bounded retention for dead-but-not-404ing endpoints. |

**Data-subject rights**: because a row is `user_id` + endpoint, "delete my device registration" is
one row delete and is fully served by the in-app off switch. Worth stating in whatever privacy
notice the org publishes.

### 9.4 Consent

**The browser permission prompt is necessary but is emphatically not sufficient.** It says only
"*<site>* wants to send you notifications" — nothing about what, how often, or that a
safeguarding-adjacent alert may render on a lock screen. A leader tapping "Allow" has not
meaningfully consented to any of that.

**Recommended: a short in-app consent step immediately before the permission prompt**, on the same
tap:

> **Alerts on this device**
> We'll send a notification to this device when: an urgent incident is logged (leadership accounts
> only); a scheduled camp notice goes out; and about an hour before your check-in window closes if
> students are still unchecked.
> Alerts never contain a student's name or any medical or incident detail — just a prompt to open
> the app. They may appear on your lock screen, so keep this device locked and don't leave it with
> students.
> We store a device registration for this account until you turn alerts off or log out. Turn them
> off any time here.

Then, and only then, `Notification.requestPermission()`.

Additional points:

- **Record the consent version** (`consent_version` on the row). If the trigger set or the payload
  policy changes materially — especially if anyone ever argues for more detail in the payload — the
  card should re-prompt rather than silently expand the scope of what was agreed to.
- **Shared account, individual device (D5).** A church login such as `b-victory` is used by several
  leaders, but each installs it on **their own phone** and taps "turn on alerts" for themselves. So
  consent is given per person for their own device, which is the granularity that matters. The
  first draft treated this as a serious weakness on the belief that one handset was passed around;
  that belief was wrong and the finding is withdrawn. What remains is milder and worth a line in the
  pre-camp briefing: a leader enabling alerts is opting **their** phone into that church's alerts,
  and their colleagues' phones are enrolled or not independently.
- **Under-18 leaders**: if any youth leader with an account is themselves a minor, they are a data
  subject too, and the org's usual consent posture for minors applies to *their* device
  registration. Not assessed here — still open (§0).

### 9.5 Risk on a personal device (REWRITTEN — D5)

**The first draft called this "the highest-severity finding". That assessment rested on an
inference that turned out to be false, and is withdrawn.**

The draft reasoned from `promptInitials(true)`, `enforceInitials()` and
`localStorage['ycp_initials_<user>']` that camp devices are physically passed between leaders. The
owner confirms they are not: **leaders log into their account on their own personal phone.** A
church login is a shared *account* installed on several individually-owned handsets. The initials
mechanism is explained equally well by that — it disambiguates *which human* is acting under a
shared login, not which human is holding a shared phone.

What that changes:

- **"Alert fires in front of the wrong leader" drops from High to Low** (P2). A leader's own phone
  showing their own church's alert is the intended behaviour, not a leak.
- The residual disclosure surface is the ordinary one: a personal phone's **lock screen**, visible to
  anyone near it — on a table, in a pocket-out moment, in a room that may contain students.

What does **not** change, and why §9.1's payload rule stays exactly as written:

- **`userVisibleOnly: true` means we cannot suppress a notification.** The service worker is obliged
  to show something for every push received. There is no "decide at display time" option, on any
  device, personal or not.
- **The app's own scoping controls do not reach the OS notification.** `leadersOnly`,
  `canAccessPerson` and the `b-`/`g-` gender scoping all operate inside the authenticated app. A
  lock-screen banner is outside all of them, on a personal phone as much as a shared one.
- So the payload rule is still the **only** control available on this surface. It costs nothing to
  keep and it is what makes the residual acceptable: the worst-case disclosure to a bystander is
  *this camp has an urgent alert right now*, or *this church has 3 students unchecked*. Under
  Option A it would be a named minor's incident summary on a lock screen — personal phone or not,
  that is why Option A is rejected.

**Lost or stolen phone.** Still real, and now the main scenario in this section rather than a
footnote. The server has no signal that a device is lost, and a personal phone is more likely to be
lost off-site than a device that lives in a camp office. Under D7 there is no admin
revoke-all-devices button; the remedy is **deactivate the account** (Accounts screen), which §4.9's
resolver turns into an immediate stop on all that account's pushes. Reactivating restores them. This
is a better runbook than the draft's proposed delete-by-`user_id`, because it is one existing
control, it is reversible, and it stops app access at the same time.

**Post-camp.** The owner's practice is to lock church and zone-leader logins with the existing
settings toggles. §4.9/D8 makes that stop pushes too — without it, the lock would stop logins while
every enrolled phone kept receiving camp alerts indefinitely.

### 9.6 Risk table

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| P1 | Safeguarding detail (incident summary, student name) rendered on a lock screen | **High** | High, if payloads are not constrained | §9.1 rule: no server-stored body ever enters a payload. Fixed templates + a unit test asserting the summary is absent |
| P2 | Alert renders on a lock screen visible to a bystander (incl. a student in the room) | **Low** (was High) | Medium | **Downgraded by D5** — devices are personal, not passed between leaders, so the "wrong leader sees it" case largely disappears. Residual is ordinary lock-screen visibility, held to "an alert exists" by the §9.1 payload rule; consent copy asks leaders to keep the phone locked |
| P3 | Lost/stolen device keeps receiving alerts indefinitely | Medium | Medium | **Deactivate the account** → §4.9 resolver stops all its pushes immediately and reversibly; 404/410 pruning; 90-day inactivity sweep. (Logout no longer deletes — D6) |
| P4 | Deactivated account still receives alerts (FK cascade doesn't fire on deactivate) | Medium | High if not explicitly handled | `isPushSuppressed` skips `status!=='active'` in the audience resolver (§4.9); covered by a test |
| P5 | Device registrations survive the new-year rollover into a different leadership team | Medium | High if not explicitly handled | `deleteAll()` in `admin.service` `newYear` **and** `reset`; covered by a test |
| P6 | Third-party relay metadata (endpoint, timing, frequency) profiles the leadership group | Low–Medium | Certain — unavoidable given the channel | Accept and document. Subjects are leaders, not minors. Minimise message volume (three triggers only, dedupe enforced) |
| P7 | Subscription keys (`p256dh`/`auth`) exposed by a raw DB read | Low | Low | Encrypt both with the existing `field-crypto` codec + per-row AAD; RLS on the table |
| P8 | Consent is uninformed — the browser prompt says nothing about what will be sent | **Low–Medium** (was Medium) | High without the consent step | **Downgraded by D5** — each leader consents on their own phone, so the "consenting on behalf of others" problem is gone. In-app consent copy before `requestPermission()`; `consent_version` recorded; pre-camp briefing |
| P9 | Leaders believe alerts are on when they are not (iOS not installed, icon deleted, Focus mode, permission denied) → an alert is assumed delivered and isn't | Medium | High | The in-app feed remains the guaranteed channel; explicit per-state UI (§4.8); admin readout of how many accounts have a registered device |
| P10 | Duplicate pushes from overlapping ticks (or the inline/sweeper race) desensitise leaders | Low | Medium without the claim design | `push_sent_at` atomic claim + `dedupe_key` + SW `tag` (§5). The advisory lock is **deleted** — D9 |
| P11 | Timezone error silently disables (or spuriously fires) trigger 3 for the whole camp | Medium | Medium — this bug class has already occurred twice here | `zonedNow(settings.timezone)` only; no wall-clock cron expressions; a test pinned at 09:00 Brisbane / 23:00 UTC previous day |
| P12 | Tick secret leaks → an attacker can force-fire notices | Low | Low | `CRON_SECRET` marked Sensitive in Vercel **and** stored in Supabase Vault (two places to rotate — note it in `SECURITY-ACTIONS.md`); constant-time compare; the route only *delivers* already-authored rows, it cannot author content |
| **P13** | **Post-camp login lock does not stop pushes.** `churchLoginLocked`/`zoneLeaderLoginLocked` are read only in `auth.service.login`; a subscription is session-independent, so locked-out leaders' phones keep receiving camp alerts indefinitely — while the owner believes the lock closed everything | **Medium** | **Certain if not handled** — this is the owner's actual post-camp practice | `isPushSuppressed` checks both lock flags in the audience resolver (§4.9/D8); test asserts a locked church role resolves to an empty audience |
| P14 | `pg_net` is fire-and-forget, so a 500 from the tick is silent — the feature can stop working with no signal | Medium | Medium | Tick logs its own outcome (Vercel function logs); `cron.job_run_details` and `net._http_response` are checkable; the in-app feed is unaffected either way |

---

## 10. Rollout plan

Phased, with a stop/go gate between infrastructure and delivery. Each phase is independently
shippable and independently revertible.

1. **Tick plumbing only.** Add `headers` to `HttpRequest` + the Express adapter; add
   `GET /internal/cron/tick` (`auth:false`, `CRON_SECRET` constant-time guard) returning a stub;
   set `CRON_SECRET` in Vercel **and** `vault.create_secret(..., 'cron_secret')` in Supabase; enable
   `pg_cron` + `pg_net` and register the schedule. Tests: missing/wrong secret 401s, correct secret
   200s. **Verify in prod that the tick actually fires** — `select * from cron.job_run_details order
   by start_time desc limit 5`, cross-checked against the Vercel function log — before building
   anything on top of it. This is the assumption most likely to be wrong, and `pg_net`'s
   fire-and-forget nature (P14) means nothing else will tell you.
   *(`vercel.json` is NOT modified — D1.)*
2. **Migration `0013`** applied to prod (additive, safe ahead of code), plus the
   `schema_migrations` version reconciliation (§4.6). Entity + repo trio (`interfaces`,
   `memory`, `supabase`) + `container.ts` wiring for `push_subscriptions`; `Notification` gains
   `pushSentAt`/`dedupeKey` and the on-conflict list is widened. No behaviour yet.
   **Also in this phase, because everything later depends on it:** extract
   `canSeeNotification()` (§4.9/D10) and refactor `getActorFeed` onto it — a pure refactor whose
   existing notification tests must pass **unchanged**, which is the proof it changed nothing.
3. **Trigger 3's detection logic, in-app only (no push).** Pure function in a new
   `src/services/checkin-warnings.ts` — `churchesBehind(settings, people, users, now)` returning
   `{ userId, churchId, sessionId, remaining, windowEnd }`, unit-tested with no I/O, **including a
   Brisbane-vs-UTC boundary case**. Gate on all five §3 conditions (notably
   `churchCheckinTimeRestricted === true` — D4). Wire it into the tick to create the `dedupe_key`'d
   urgent church-scoped `Notification`. **This ships real value with zero push infrastructure and
   zero new personal data** — the 07-23 spec's "Layer A first" argument, still correct.
   ⚠ **Gender-scoping gotcha:** church logins are `b-`/`g-` and gender-scoped via
   `users.gender_scope`. "Students still unchecked" must be computed **per login** through
   `canAccessPerson`, not per church — otherwise a `b-victory` login is told about girls it cannot
   see or act on, and the counts will be wrong and unactionable.
4. **VAPID + subscribe/unsubscribe API.** `web-push` dependency; `VAPID_*` env vars;
   `GET /push/config`, `POST /push/subscribe`, `DELETE /push/subscribe`; the retention hooks of §9.3
   — **deletion** on randomise-passwords / `newYear` / `reset`, and **suppression** (not deletion)
   for inactive and login-locked accounts via `isPushSuppressed` (§4.9). Logout does **not** delete
   (D6). Tests for each, including P13's locked-role case. Still no sending.
5. **Service worker + client opt-in UI.** `sw.js` `push` + `notificationclick`, `CACHE`
   `camp-v45`→`camp-v46`, `push` added to `API_RE`; the home "Alerts on this device" card with all
   four states; the consent copy; the iOS install prompt. **Requires real-device verification** —
   an iPhone installed to Home Screen, an Android Chrome, and one Safari-tab negative case. This
   cannot be verified by `typecheck` + `vitest`; the repo has already been bitten by exactly that
   (the incidents screen shipped with no DOM container and unit tests never noticed).
6. **Sender + pruning.** The push service (fixed payload templates), the audience resolver (§4.9),
   the `push_sent_at` claim, the fan-out with bounded concurrency (`Promise.allSettled`, cap ~10),
   404/410 pruning, failure counting. Enable **trigger 2 first** (lowest sensitivity — an ordinary
   broadcast notice), verify on real devices, then **trigger 3**, then **trigger 1** last (highest
   sensitivity; its inline hybrid per D2 lands here).
7. **Docs + comms.** `CLAUDE.md` section, `debug.md` symbol-map entries, `SECURITY-ACTIONS.md`
   entries for `VAPID_PRIVATE_KEY` and for `CRON_SECRET` **living in two places** (Vercel env +
   Supabase Vault), the privacy-notice text for the org, and the pre-camp leader briefing covering
   Add-to-Home-Screen and the re-login it forces. **Also close the four organisational questions
   still open in §0** — third-party transfer posture, under-18 account holders, privacy-notice
   ownership, and who delivers the iOS install comms. These do not block phases 1–6 but do block
   rollout to real leaders.

**Gate between 3 and 4:** phase 1's prod verification passed (the tick demonstrably fires), and
phase 3's notices are appearing correctly in-app for a real camp day. Payload policy (D3) and
retention (D6–D8) are already signed off, so they are no longer gates.

---

## 11. What could go wrong

- **~~The Vercel plan doesn't allow `*/5`.~~ CONFIRMED AND RESOLVED.** The plan is Hobby, which does
  not. Resolved by D1 (Supabase `pg_cron`), not by paying. The residual risks moved to the two
  bullets below.
- **`pg_cron`/`pg_net` don't behave as expected in this Supabase project.** Neither extension is
  currently installed, so phase 1's prod verification is a genuine test, not a formality. If
  `pg_net` cannot reach the Vercel domain (egress restrictions, TLS, timeout), fall back to Vercel
  Hobby's daily cron for the sweeper + accept that trigger 3 needs Vercel Pro.
- **A paused Supabase project silently stops the scheduler.** Off-season risk. The in-app feed keeps
  working, so the failure is degraded-not-broken, but nobody is told.
- **Tick fires but the function cold-starts past `maxDuration: 30`.** The tick does DB work plus
  N outbound HTTPS calls. With ~40 subscriptions this is fine; if fan-out ever grows, cap the
  per-tick send count and let the next tick continue (the `push_sent_at` claim makes that safe).
- **The `HttpRequest.headers` addition ripples.** It touches a core interface used by every route
  and by the route tests. Keep it optional (`headers?:`) so nothing else has to change.
- **`push` missing from `sw.js`'s `API_RE`** → the SPA's HTML gets cached under `/push/config` and
  JSON parsing dies with "unexpected token <". This exact failure is documented in the file's own
  comment. It will not be caught by any test.
- **Forgetting to bump `CACHE`** → devices keep the old service worker with no `push` handler and
  silently receive nothing, or worse, receive a push the SW can't handle.
- **Forgetting `push_sent_at` in the on-conflict `do update set` list** → the claim never persists →
  every tick re-sends everything. Silent, and the repo has this exact bug class in its history twice.
- **Timezone** — §6. Silent in both directions.
- **Encrypted-body assumption breaks** if someone later adds a push payload that reads
  `notification.body`: for a `leadersOnly` notice that value is decrypted safeguarding data. The
  §9.1 rule is the guard; make it a test, not a comment.
- **iOS adoption is simply too low to matter.** Entirely possible. If fewer than half the church
  accounts install, trigger 3 is decorative and the in-app path is doing all the work. Measure it
  (the admin readout in §8) before concluding the feature succeeded.
- **Alert fatigue.** Three triggers is already the right number. Trigger 3 fires up to twice a day
  per church for the length of camp; if the lead time or threshold is wrong, leaders will mute the
  app within 48 hours and trigger 1 dies with it. Prefer sending fewer, later, and only when
  `remaining > 0`.
- **Preview modes.** `PREVIEW_MODE` / `ACCOUNT_PREVIEW` block non-GET requests, so subscribe silently
  fails there. Handle it in the UI rather than letting a leader think they enabled alerts.
- **`web-push` dependency weight** on a cold-starting serverless function. Small, but it is a new
  transitive-dependency surface on a repo that has kept dependencies deliberately thin.

---

## 12. Open questions — status after owner review

**Answered (2026-07-26).** Full reasoning in §0; recorded here so the original list stays readable.

| # | Question | Answer |
|---|---|---|
| 1 | Trigger-1 latency | **Hybrid** — inline best-effort + tick sweeper (D2, §4.2) |
| 2 | Vercel cron entitlement | Plan is **Hobby**, daily only → **switched to Supabase `pg_cron`** (D1, §4.1). No spend |
| 3 | Payload policy | **Option C confirmed**, including trigger 3's count exception (D3, §9.1) |
| 4 | Trigger-3 lead time / windows | **60 minutes, both AM and PM** (D4, §3) |
| 5 | Trigger-3 gating | **Only when `churchCheckinTimeRestricted === true`** (D4, §3) |
| 6 | Trigger-3 audience | **Church logins only.** Zone-leader escalation stays out of scope (D4) |
| 7 | Logout behaviour | **Keeps the subscription** — devices are personal, not handed on (D5→D6, §9.3) |
| 8 | Admin revoke-all-devices | **Not built.** Deactivating the account achieves it via the §4.9 resolver, and the post-camp login lock now suppresses too (D7→D8) |

**ANSWERED by the owner 2026-07-31 — rollout is no longer gated.** All four were organisational,
never blocking implementation. Recorded verbatim so a future session does not re-litigate them.

9. **Third-party transfer posture.** ~~Does the org have any position on Apple/Google/Mozilla
   receiving push **metadata** (endpoints, timing, frequency — never camper data)?~~
   → **Accepted.** Push metadata transfer is fine. The feature proceeds in this form.
10. **Under-18 account holders.** ~~Is any leader with a login themselves a minor?~~
    → **No.** Every login holder is a trusted leader who has been through compliance training, so
    no device registration is a minor's personal data. ⚠ Revisit **only** if a login is ever issued
    to someone under 18 — that would reintroduce the minors' consent posture for that account.
11. **Privacy notice.** ~~Who owns updating it?~~ → **The youth team**, as part of updating the
    compliance data.
12. **iOS install comms.** ~~Who tells church leaders to Add to Home Screen, and is the forced
    re-login acceptable — especially during camp week?~~ → **Handled at the pre-camp training day**,
    ahead of camp. This deliberately avoids the worst case the question was raised about: the
    re-login (separate storage partition, randomised `Word.##` password, initials re-prompt) now
    happens in a supported setting rather than mid-camp.
