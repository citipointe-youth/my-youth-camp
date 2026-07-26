# 2026-07-26 — Web Push via Vercel Cron (design + privacy assessment)

**Status: DESIGN ONLY — nothing implemented, no migration applied, no source file touched.**

Supersedes and narrows `docs/superpowers/specs/2026-07-23-web-push-design.md` (referred to below as
"the 07-23 spec"). That doc is still worth reading for the Layer A / Layer B framing; this one is
the current scope of record.

Owner decisions treated as **fixed requirements** for this design:

- Delivery channel is **Web Push only** (PWA), fired by **Vercel Cron**. No email, no SMS, no
  in-app polling.
- Exactly **three triggers** are in scope (§3). Missed/incomplete check-in escalation to zone
  leaders is **out of scope**.
- The owner specifically asked for the **privacy assessment** (§9) to be substantive.

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
| `sw.js` "bump CACHE" (then ~`camp-v33`) | `sw.js` is now **`camp-v43`** |
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
  catch-all rewrite `"/(.*)" → "/api/index"`. **Consequence: any cron path lands on the Express
  app**, so a cron route is just a normal entry in `src/api/http/router.ts` — no second serverless
  function needed, and it inherits the same 30s ceiling.
- **`api/index.ts`** — memoises `createAppInstance()` in `appPromise`. A cron invocation pays the
  same cold-start as a user request (container build + repo init). Irrelevant for correctness, but
  it means a cron tick is not free.
- **`src/api/http/types.ts`** — `HttpRequest` is `{ ctx, params, query, body, ip }`. **There is no
  `headers` field.** Vercel Cron authenticates by sending `Authorization: Bearer $CRON_SECRET`, and
  the Express adapter currently reads `req.headers['authorization']` only inside `resolveContext`
  for the app's own bearer tokens. So a cron route requires a **small adapter change**: add an
  optional `headers?: Record<string, string | undefined>` to `HttpRequest` and populate it in
  `src/api/http/express-adapter.ts` (~line 116). This is the one non-obvious plumbing cost of the
  whole feature and is easy to miss when planning.
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
- **`public/sw.js`** — `CACHE = 'camp-v43'`; `API_RE` is an explicit allowlist of top-level API
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
| 3 | **Check-in window closing soon** (~1h before the AM or PM window `End`) | the church accounts with students still unchecked for the closing session | within one cron tick | `settings.checkin_window_*` + `Person.checkInHistory` |

Trigger 2 **replaces the lazy-fire model**: today a scheduled notice only appears when someone
happens to open the app (`getActorFeed`'s `n.scheduledFor > now` filter). It keeps working exactly
as-is for anyone without a push subscription — the filter is not being removed. Push is strictly
additive on top of it.

---

## 4. Architecture

```
Vercel Cron  ──►  GET /internal/cron/tick        (Authorization: Bearer $CRON_SECRET)
                     │
                     ├─ pg_try_advisory_lock('cron:push')   ← overlapping-run guard
                     ├─ job A: fire due scheduled notices   (notifications.scheduled_for <= now)
                     ├─ job B: create check-in-closing notices (dedupe_key, at most one per church×session)
                     ├─ job C: claim unsent pushable notices (push_sent_at is null → set now())
                     └─ job D: fan out web-push to push_subscriptions of the resolved audience
                                  │  404/410 → delete the subscription row
                                  │  429/5xx → failure_count++ (delete after N)
                                  ▼
service worker `push`  ──► showNotification(title, "Open the app…")
service worker `notificationclick` ──► focus/open '/' + postMessage({type:'push-nav', screen})
```

### 4.1 Cron route and cadence

`vercel.json` gains:

```json
"crons": [{ "path": "/internal/cron/tick", "schedule": "*/5 * * * *" }]
```

**One route, one cadence, all jobs.** Reasons:

- Vercel Cron entitlement is a per-plan quota (number of jobs and minimum granularity). A single
  job is the smallest possible ask and the least likely to hit a plan ceiling. **I do not know this
  project's current Vercel plan limits and have not verified them** — confirm the plan allows
  sub-daily cron before committing to `*/5` (see Open Questions).
- Each job is a cheap query; running them in one warm invocation avoids three cold starts.
- The catch-all rewrite means the path is served by the existing Express app, so this is a route
  registration, not new infrastructure.

**Why 5 minutes:** trigger 2 (a scheduled notice) is the one with a user-visible promise — an admin
picks a minute in the SPA's `datetime-local` and expects delivery near it. 5 minutes is the worst-
case skew; 15 would be noticeable. Triggers 1 and 3 are tolerant of 5 minutes in principle, but
trigger 1 is safeguarding data and 5 minutes is a **real weakness** — see §4.2. `*/5` is 288
invocations/day; if the plan only permits 96/day, fall back to `*/15` and accept the skew, or gate
the cron to camp week only (see "what could go wrong").

**The route is not part of the app's normal auth layer.** It is `auth: false` in the route table
and instead compares `headers.authorization` to `Bearer ${process.env.CRON_SECRET}` using a
constant-time compare (`crypto.timingSafeEqual`), 401 otherwise. `CRON_SECRET` is a Vercel
env var marked Sensitive. Note the route path starts `/internal/` — add `internal` to `sw.js`'s
`API_RE` too if the SPA is ever pointed at it (it should not be).

### 4.2 Trigger 1 latency — the one place I'd argue with the brief

A high-severity incident is child-safeguarding data. A cron-only design means a zone leader logs
"student X has been injured / has disclosed Y" and the director's phone buzzes **up to 5 minutes
later**. That is defensible but not obviously right.

**Recommended shape (hybrid):** `incident.service.log()` fires the push **inline, best-effort**,
immediately after saving the notification — `void sendPushForNotification(notif).catch(log)`, not
awaited, so a slow push service can never make the incident form hang or fail. The cron then acts
as a **sweeper**: it picks up any notification with `push_sent_at is null` older than ~2 minutes and
sends it, covering the case where the inline attempt died with the serverless function.

This keeps the owner's "fired by Vercel Cron" requirement intact as the *guarantee* mechanism while
removing the worst-case latency from the safeguarding path. The claim-row mechanism in §5 makes the
two paths safe to run concurrently — whichever gets the row first wins, the other sends nothing.
**Flagged as an open question** rather than assumed.

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

Two new top-level handlers, plus `CACHE` bumped **`camp-v43` → `camp-v44`** and `push` added to
`API_RE`:

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

---

## 5. Idempotency / delivery-once

Cron runs can overlap (a slow run still executing when the next tick starts) and Vercel may retry.
A leader must never be pushed the same thing twice. Three layers, cheapest first:

**Layer 1 — an advisory lock around the whole tick.**
`select pg_try_advisory_lock(hashtext('cron:push'))` at the top of the handler; if it returns false,
return `{skipped:'locked'}` and exit. Released on completion (and automatically when the connection
closes, which matters on a function timeout). This alone prevents the common case. It is **not**
sufficient on its own — the transaction-pooler connection model means "the same session" is not
guaranteed across the whole handler, so treat this as an optimisation, not a guarantee.

**Layer 2 — atomic claim, the actual guarantee.**
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

**Layer 3 — `dedupe_key` for anything the cron *creates*.**
Trigger 3 has no pre-existing row: the cron must create the "window closing" notice itself. Its
key is deterministic:

```
checkin-warn:<sessionId>:<churchUserId>      e.g. checkin-warn:2026-09-29~am:usr_abc
```

Inserted with `on conflict (dedupe_key) do nothing`. Two overlapping runs, or twelve consecutive
ticks inside the one-hour lead window, still produce exactly **one** notice per church per session —
and, because pushing is gated on `push_sent_at`, exactly one push. This replaces the 07-23 spec's
`warned_checkin_sessions` marker table with a mechanism that also serves triggers 1 and 2. The
markers are purged for free by `admin.service` `reset` / `newYear` (which already truncate
`notifications`).

**Per-trigger summary**

| Trigger | Row created by | Dedupe |
|---|---|---|
| 1 — incident | `incident.service.log()` (exists today) | `push_sent_at` claim; inline send and cron sweeper race safely |
| 2 — scheduled notice | the author, via `RENDER.compose` (exists today) | `push_sent_at` claim; `scheduled_for <= now()` selects it |
| 3 — window closing | the **cron** | `dedupe_key` unique insert, then `push_sent_at` claim |

**Per-device duplicates** are separately prevented by the `endpoint` unique constraint (a device
that re-subscribes replaces its row rather than adding one) and by the SW's `tag` (a repeat with the
same tag replaces the visible notification rather than stacking).

---

## 6. Timezone

Everything operational in this app is **Australia/Brisbane, UTC+10, no DST** — which removes the
hardest class of bug but not the offset bug.

**Vercel Cron schedules are UTC.** The rule that follows:

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
| **Explicit logout** (`logout()`) | `unsubscribe()` + `DELETE /push/subscribe` | A logout on a camp device usually means the device is being handed on. Re-subscribing after the next login is one tap and raises **no** new OS prompt (permission is already granted), so the friction is near-zero. **Recommended: yes, always** — the simple rule beats a role-conditional one. |
| **Session expiry** (24h TTL, no explicit logout) | keep | Otherwise every leader loses alerts overnight, which defeats the feature. |
| **Account deactivated** (`account.service` `toggleStatus`) | delete that user's rows explicitly | The FK cascade only fires on *delete*, not deactivate. Must be added or a deactivated account keeps receiving safeguarding alerts — a real hole given the app's documented stateless-token trade-off (a deactivated user's token already stays valid to its TTL). |
| **Account deleted** | automatic | `on delete cascade`. |
| **Church passwords randomised** (`POST /accounts/churches/randomize-passwords`) | delete all `role='church'` subscriptions | Passwords are being redistributed; the set of humans behind those accounts is changing. |
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
- **Church accounts are shared logins**, so "consent" is being given by whoever happens to be
  holding the device, on behalf of an account others also use. This is a genuine weakness in the
  consent model and cannot be fixed technically at this account granularity. Mitigation is
  organisational: tell church leaders in the pre-camp briefing what the app will push.
- **Under-18 leaders**: if any youth leader with an account is themselves a minor, they are a data
  subject too, and the org's usual consent posture for minors applies to *their* device
  registration. Not assessed here — I do not know whether any account holder is under 18.

### 9.5 Risk if a device is lost or shared

**This is the highest-severity finding and it is specific to this app, not a generic caveat.**

The app **already assumes camp devices are shared between leaders.** That is not speculation — it is
a built feature: `promptInitials(true)` behind the header `✎` badge exists precisely as "a different
leader has taken the device", `enforceInitials()` runs at every login for church accounts, and
`LEADER_INITIALS` is stored per account in `localStorage['ycp_initials_<user>']` so it can be
switched without logging out. The whole initials mechanism exists because one login is used by many
humans on one or more phones.

Overlay Web Push on that:

- A notification fires on a device currently in the hands of **whichever leader took it last** —
  possibly one who was never intended to see that alert, and (for a church-held device) possibly in
  a room with students.
- **`userVisibleOnly: true` means we cannot suppress it.** There is no "check who's holding the
  device first" — the service worker is obliged to show something for every push received. This is
  why §9.1's payload rule is not merely prudent but load-bearing: it is the *only* control available
  on this surface.
- **The app's own scoping controls do not apply to the OS notification.** `leadersOnly`,
  `canAccessPerson`, and the `b-`/`g-` gender scoping all operate inside the authenticated app. A
  lock-screen banner is outside all of them.
- **A lost or stolen phone keeps receiving alerts** until someone deletes the subscription. The
  server has no signal that the device is lost. Mitigations: the logout-deletes-subscription rule
  (§9.3), an admin ability to revoke all devices for an account (worth building — it is one delete
  by `user_id`, and it is the "leader lost their phone at camp" runbook), and OS-level device wipe
  which the org does not control.
- Under the recommended payload, the worst-case disclosure to a bystander is: *this camp has an
  urgent alert right now*, or *this church has 3 students unchecked*. That is an acceptable
  residual. Under Option A it would be a named minor's incident summary on a shared phone — which is
  the reason Option A is rejected outright.

**Also worth stating plainly:** trigger 1's audience is admin/director/zoneLeader, who are more
likely to hold personal, individually-owned phones. Trigger 3's audience is **church accounts** —
the shared-device population. The recommended payload split (generic for 1, count-bearing for 3)
happens to align correctly with that, but it aligned by design, and any future change to trigger 3's
payload should be assessed against the shared-device assumption specifically.

### 9.6 Risk table

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| P1 | Safeguarding detail (incident summary, student name) rendered on a lock screen | **High** | High, if payloads are not constrained | §9.1 rule: no server-stored body ever enters a payload. Fixed templates + a unit test asserting the summary is absent |
| P2 | Shared/handed-on device shows an alert to the wrong leader, or to a student in the room | **High** | High — shared devices are a designed-for reality (`promptInitials`) | Generic payloads (P1); consent copy tells leaders to keep the device locked; admin "revoke all devices for this account" |
| P3 | Lost/stolen device keeps receiving alerts indefinitely | Medium | Medium | Delete subscription on logout; admin revoke-all-devices; 404/410 pruning; 90-day inactivity sweep |
| P4 | Deactivated account still receives alerts (FK cascade doesn't fire on deactivate) | Medium | High if not explicitly handled | Explicit delete in `account.service.toggleStatus`; covered by a test |
| P5 | Device registrations survive the new-year rollover into a different leadership team | Medium | High if not explicitly handled | `deleteAll()` in `admin.service` `newYear` **and** `reset`; covered by a test |
| P6 | Third-party relay metadata (endpoint, timing, frequency) profiles the leadership group | Low–Medium | Certain — unavoidable given the channel | Accept and document. Subjects are leaders, not minors. Minimise message volume (three triggers only, dedupe enforced) |
| P7 | Subscription keys (`p256dh`/`auth`) exposed by a raw DB read | Low | Low | Encrypt both with the existing `field-crypto` codec + per-row AAD; RLS on the table |
| P8 | Consent is illusory — permission prompt only, on a shared account | Medium | High without the consent step | In-app consent copy before `requestPermission()`; `consent_version` recorded; pre-camp briefing |
| P9 | Leaders believe alerts are on when they are not (iOS not installed, icon deleted, Focus mode, permission denied) → an alert is assumed delivered and isn't | Medium | High | The in-app feed remains the guaranteed channel; explicit per-state UI (§4.8); admin readout of how many accounts have a registered device |
| P10 | Duplicate pushes from overlapping cron runs desensitise leaders to urgent alerts | Low | Medium without the claim design | `push_sent_at` atomic claim + `dedupe_key` + advisory lock + SW `tag` (§5) |
| P11 | Timezone error silently disables (or spuriously fires) trigger 3 for the whole camp | Medium | Medium — this bug class has already occurred twice here | `zonedNow(settings.timezone)` only; no wall-clock cron expressions; a test pinned at 09:00 Brisbane / 23:00 UTC previous day |
| P12 | Cron secret leaks → an attacker can force-fire notices | Low | Low | `CRON_SECRET` marked Sensitive in Vercel; constant-time compare; the route only *delivers* already-authored rows, it cannot author content |

---

## 10. Rollout plan

Phased, with a stop/go gate between infrastructure and delivery. Each phase is independently
shippable and independently revertible.

1. **Cron plumbing only.** Add `headers` to `HttpRequest` + the Express adapter; add
   `GET /internal/cron/tick` (`auth:false`, `CRON_SECRET` constant-time guard) returning a stub;
   add the `crons` entry to `vercel.json`; set `CRON_SECRET`. Tests: missing/wrong secret 401s,
   correct secret 200s. **Verify in prod that the cron actually fires** (Vercel deployment logs)
   before building anything on top of it — this is the assumption most likely to be wrong.
2. **Migration `0013`** applied to prod (additive, safe ahead of code), plus the
   `schema_migrations` version reconciliation (§4.6). Entity + repo trio (`interfaces`,
   `memory`, `supabase`) + `container.ts` wiring for `push_subscriptions`; `Notification` gains
   `pushSentAt`/`dedupeKey` and the on-conflict list is widened. No behaviour yet.
3. **Trigger 3's detection logic, in-app only (no push).** Pure function in a new
   `src/services/checkin-warnings.ts` — `churchesBehind(settings, people, users, now)` returning
   `{ userId, churchId, sessionId, remaining, windowEnd }`, unit-tested with no I/O, **including a
   Brisbane-vs-UTC boundary case**. Wire it into the cron to create the `dedupe_key`'d urgent
   church-scoped `Notification`. **This ships real value with zero push infrastructure and zero new
   personal data** — the 07-23 spec's "Layer A first" argument, still correct.
   ⚠ **Gender-scoping gotcha:** church logins are `b-`/`g-` and gender-scoped via
   `users.gender_scope`. "Students still unchecked" must be computed **per login** through
   `canAccessPerson`, not per church — otherwise a `b-victory` login is told about girls it cannot
   see or act on, and the counts will be wrong and unactionable.
4. **VAPID + subscribe/unsubscribe API.** `web-push` dependency; `VAPID_*` env vars;
   `GET /push/config`, `POST /push/subscribe`, `DELETE /push/subscribe`; the deletion hooks of §9.3
   (logout, deactivate, randomise-passwords, newYear, reset) with tests. Still no sending.
5. **Service worker + client opt-in UI.** `sw.js` `push` + `notificationclick`, `CACHE`
   `camp-v43`→`camp-v44`, `push` added to `API_RE`; the home "Alerts on this device" card with all
   four states; the consent copy; the iOS install prompt. **Requires real-device verification** —
   an iPhone installed to Home Screen, an Android Chrome, and one Safari-tab negative case. This
   cannot be verified by `typecheck` + `vitest`; the repo has already been bitten by exactly that
   (the incidents screen shipped with no DOM container and unit tests never noticed).
6. **Sender + pruning.** The push service (fixed payload templates), the `push_sent_at` claim, the
   fan-out with bounded concurrency (`Promise.allSettled`, cap ~10), 404/410 pruning, failure
   counting. Enable **trigger 2 first** (lowest sensitivity — an ordinary broadcast notice), verify
   on real devices, then **trigger 3**, then **trigger 1** last (highest sensitivity, and the one
   whose latency design may still change per §4.2).
7. **Docs + comms.** `CLAUDE.md` section, `SECURITY-ACTIONS.md` entry for `VAPID_PRIVATE_KEY` and
   `CRON_SECRET`, the privacy-notice text for the org, and the pre-camp leader briefing covering
   Add-to-Home-Screen and the re-login it forces.

**Gate between 3 and 4:** the owner confirms the §9.1 payload recommendation and the §9.3 retention
policy, and the Vercel plan's cron entitlement is verified.

---

## 11. What could go wrong

- **The Vercel plan doesn't allow `*/5`.** Most likely blocker, and it is a plan/billing question,
  not an engineering one. Fallbacks: `*/15` (accept the skew on trigger 2), or the §4.2 hybrid so
  trigger 1 is inline and cron is only a sweeper. Verify before phase 1.
- **Cron fires but the function cold-starts past `maxDuration: 30`.** The tick does DB work plus
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

## 12. Open questions for the owner

1. **Trigger-1 latency.** Is up to 5 minutes acceptable for a high-severity incident alert, or
   should `incident.service.log()` fire the push inline (best-effort, not awaited) with cron as the
   sweeper (§4.2)? I recommend the hybrid; it is a deviation from "fired by Vercel Cron" as
   literally stated.
2. **Vercel plan cron entitlement** — how many cron jobs and what minimum granularity does the
   current plan allow? `*/5` is 288 invocations/day. I have not verified this and it gates the
   cadence.
3. **Payload policy sign-off.** Confirm §9.1 Option C (title-only, "open the app"), including the
   one exception: trigger 3 carries a **count** and a window-close time. Anyone wanting more detail
   on a lock screen needs to own that decision explicitly.
4. **Trigger-3 lead time.** ~60 minutes before the window `End` — confirm? And should it fire for
   both AM and PM windows, or PM only?
5. **Trigger-3 gating.** Should the reminder run only when `churchCheckinTimeRestricted === true`
   (currently true in prod)? If the toggle is switched off, the window times still exist but are no
   longer a real deadline — a "closing soon" alert arguably becomes misleading.
6. **Trigger-3 audience.** Church accounts only, as specified. Should the zone leader also be
   copied when a church is still behind at, say, 15 minutes to close? (This edges toward the
   escalation feature explicitly declared out of scope — confirm it stays out.)
7. **Logout behaviour.** Confirm that logging out deletes the device's subscription (§9.3). It costs
   one tap to re-enable and is the safer default for shared camp devices, but it does mean a leader
   who habitually logs out gets no alerts.
8. **Admin revoke-all-devices** for an account — worth building in v1? It is the "a leader lost
   their phone mid-camp" runbook and is one delete by `user_id`.
9. **Third-party transfer posture.** Does the org have any position on Apple/Google/Mozilla
   receiving push **metadata** (endpoints, timing, frequency — never camper data)? This is
   unavoidable with Web Push; if it is not acceptable, the feature cannot proceed in this form.
10. **Under-18 account holders.** Is any leader with a login themselves a minor? If so their device
    registration is a minor's personal data and the org's consent posture for minors applies.
11. **Privacy notice.** Is there an existing published privacy notice this needs to be added to, and
    who owns updating it?
12. **iOS install comms.** Who tells church leaders to Add to Home Screen, and is the re-login it
    forces (separate storage partition, randomised `Word.##` password, initials re-prompt) an
    acceptable cost — especially if it happens during camp week?
