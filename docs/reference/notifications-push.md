> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: notifications push

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## Phones identified by the leader's OWN initials — migration `0028` — 2026-09-23

Owner, on seeing the screen below: *"they shouldn't have a new notification and field to fill out
as that adds user workload. It should just pull the existing initials from the app."* Backend +
SPA + **migration `0028`** (`push_subscriptions.leader_initials text`, additive/nullable, **apply
to prod BEFORE this code deploys** — the mapper names it in its insert and on-conflict list).
`npm run typecheck` clean, `npx vitest run` **1119 pass / 65 files** (+5). `node --check` OK on
the SPA body (range **1004–10533**) and `sw.js`. `sw.js` `camp-v120`→**`camp-v121`**.

- ⚠ **NOTHING IS PROMPTED FOR, AND THAT IS THE REQUIREMENT — do not add a field here.** The
  initials already exist on the device (`ycp_initials_<username>`, enforced once per login for
  church accounts since 2026-07-23) and are simply sent alongside the subscription the phone
  already registers. A phone row now reads `SD · iPhone`; with no initials (every non-church
  login) it falls back to the phone type alone.
- **Three send points, all existing calls:** `/push/subscribe` on turn-on and on `_pushSwitch`,
  and `/push/label` on the once-per-device login sync. Plus **`_saveLeaderInitials` calls
  `_pushLabelSync(true)`** — the "a different leader took this device" path; `force` bypasses the
  once-per-device flag, which only ever gated the phone TYPE.
- **Initials can change, the phone type cannot.** `label` fills the type only when blank but
  updates initials whenever they differ; a call carrying no initials never clears stored ones
  (so a non-church login opening the app cannot blank a church leader's tag). On Supabase,
  `save()`'s on-conflict takes `leader_initials` from `excluded` — latest wins, by design.
- **Leadership phones are named from the ACCOUNT, same day** (`sw.js` → **`camp-v122`**, SPA-only,
  no schema change). Those roles never set initials, so `devLine(d, fallbackName)` falls back to
  the holder's `firstName` (then `username`) for a `leader` row — prod reads `Liam · iPhone`,
  `Youth · iPhone`, `clees · iPhone`. ⚠ **Never applied to a church row**: its holder name is the
  CHURCH, already the row heading, and it would name four leaders' phones identically — the exact
  problem initials exist to solve. Two phones on ONE leadership account (prod: `lbarlow` has 2)
  still read alike; only the added date and history separate them, and the owner was told so.
- ⚠ The owner's message also read as a complaint about a new prompt in the previous release.
  There was none: the phone type is detected, and the "Alerts on this phone are from …" line
  only renders when that phone's alerts belong to a different login. Stated, not assumed.

## Notification delivery screen + "not logged in / not receiving" filters — migration `0027` — 2026-09-22 (3rd)

Owner request: a second admin-only screen like Login activity, showing which accounts' phones
are getting push alerts and how many phones each. Backend + SPA + **migration `0027`**
(`push_subscriptions.device_label text`, additive/nullable). **⚠ `0027` must be applied to prod
BEFORE this code deploys** — `supabase.push-subscriptions` `save()` names `device_label` in its
insert AND on-conflict list, so without the column every subscribe AND every post-send
`lastSuccessAt`/`failureCount` write fails. `npm run typecheck` clean, `npx vitest run`
**1114 pass / 65 files** (was 1101/64; +13, +1 file). New `scripts/push-activity-harness.js`
(14 checks). `node --check` OK on the SPA body (range **1004–10522**, re-derived) and `sw.js`.
`sw.js` `camp-v119`→**`camp-v120`**.

- **Current state only, by owner choice.** It reads the existing `push_subscriptions` rows (one
  per phone), so it adds **no write to the send path** — `push.service` send logic, the cron tick
  and the claim are untouched. A per-notice delivery history was offered and declined.
- **`GET /push/devices`** (`admin:manage`) → `{byUser:{[userId]:PushDeviceSummary[]}}` via the
  pure **`summariseDevices()`** (`push.service.ts`). ⚠ **Never returns an endpoint or key** — an
  endpoint alone can unsubscribe that phone. There's a test asserting neither reaches the wire.
- **Two limits the screen states on itself — don't "fix" them into claims:** "delivered" =
  Apple/Google ACCEPTED the push (Web Push has no read receipts); and a dead phone is **pruned**
  (404/410, 10 failures, 90 days), so it shows as a lower count, never a red row.
- **Phone type (`deviceLabel`)** — `iPhone/iPad/Android/Mac/Windows/Other` (`PUSH_DEVICE_LABELS`),
  computed client-side by `_deviceLabel(ua,touchPoints)` (iPadOS sends a Mac UA; touch ⇒ iPad)
  and sent on subscribe. Never the raw UA (a fingerprint). A label-less re-subscribe keeps a
  known label. The harness checks every label the SPA can produce is in the server list — a label
  outside it fails Zod and **breaks the whole subscribe**.
- **Back-fill for the ~98 phones subscribed before `0027`:** `_pushLabelSync()` runs once per
  device (flag `ycp_push_labelled`) from `_offerAlertsAfterLogin` (top, before the church
  early-return — so all three sign-in paths) and calls **`POST /push/label`**, which ONLY fills a
  blank label. ⚠ **Deliberately NOT a re-call of `/push/subscribe`** — that re-assigns the row to
  whoever is signed in now, which would silently move a phone's alerts between accounts.
- **SPA:** `RENDER.pushActivity` (+ `<section id="pushActivity">`, admin console tile
  "Notification delivery" under People & churches). Same order/labels/rows as Login activity
  (`_loginActivityOrder`, `.la-row`); a row reads `3 phones · delivered 2h ago` (⚠ if any phone is
  failing) and expands to one line per phone. `_pushReached`/`_pushLastSuccess`/`_deviceLabel`
  are extracted **by name** by the harness — never rename them.
- **Per-phone delivery history** (same migration, `push_subscriptions.delivery_history jsonb`,
  newest first, capped at `MAX_DELIVERY_HISTORY` = 15 — the `login_history` shape). Owner chose
  this over a per-notice history table (declined for this camp: it would add writes to the
  30s-budget send path). Three rules, all tested:
  - ⚠ **Only `recordSuccess(endpoint, at)` writes it, as ONE SQL statement.** The same phone can
    be in one tick's task list twice (two notices), so a read-modify-write `save()` would drop an
    entry. Both success branches in `push.service` (real sends AND `sendTestToUser`) call it.
  - ⚠ **`save()` never overwrites `delivery_history`** (on-conflict keeps the stored value) — the
    failure branch saves a stale snapshot. **Except** when `user_id` changes: re-subscribing a
    phone under a different account MOVES the row and clears its history, so an account never
    shows deliveries made to another login. The in-memory repo's `save` override mirrors this.
  - ⚠ Written as a plain array through `this.sql(cols)`, **never `JSON.stringify` + `::jsonb`**
    (the 2026-08-04 double-encoding wipe). Verified against prod's `login_history` (all `array`).
  - SPA: account row → one nested `<details class="la-dev">` per phone → its timestamps
    (`.la-devs`/`.la-devline`/`.la-devhist`). A phone with no deliveries is a plain line.
- **One phone, two accounts (answered for the owner):** a subscription is per phone
  (`endpoint`), not per login, and it belongs to whichever account last turned alerts on. Logging
  out does NOT unsubscribe (`logout()` never touches push), so a phone switched from `b-x` to
  `g-x` keeps getting `b-x`'s alerts — and `_renderPushCard` still says "Alerts are on for this
  device" to `g-x`, because it only checks the phone's local subscription. The phone moves to
  `g-x` only if `g-x` turns alerts off then on. **Now surfaced, minimally (owner, same day):**
  the Notices card reads **"Alerts on this phone are from `b-x`"** with **Switch to this account**
  (`_pushSwitch` — the ordinary `/push/subscribe` upsert with the phone's existing subscription;
  no OS prompt, history cleared server-side) + Turn off. Wording is "from", not "to" — owner's
  call. The owner is remembered ON THE PHONE (`ycp_push_owner`), set by `_pushFinish`/
  `_pushSwitch`, cleared by `_pushOff`, and learned once for pre-existing phones from the
  `owner` field `POST /push/label` now returns. Unknown owner ⇒ old wording (never guesses).
  Logout behaviour itself is unchanged — alerts still follow the phone, not the session.
- **Filter on BOTH screens** (`_missingSeg`, `setLaFilter`/`setPaFilter`, module-level
  `_laOnlyMissing`/`_paOnlyMissing`): a `.seg` **All | Not logged in (N)** / **All | Not
  receiving (N)**. "Not receiving" = no phone with a `lastSuccessAt` (includes no phones at all).
- ⚠ **At ship time nothing had ever been pushed** (98 phones, 0 `lastSuccessAt`, 0 urgent
  notices since the first subscribe on 2026-08-07), so every row reads "not yet delivered" until
  the first urgent push — or the admin's **Send test check-in alert** button, which pushes to every
  church login's phones through the real pipeline (and drops a "(test)" notice in their feeds).
- **Not verified on a device** (repo convention). Owner to eyeball both screens' filter bar and
  the expanded per-phone lines at phone width.

## Notification hardening before the check-in warning is switched on — 2026-07-30

Deep review of the notification/web-push work ahead of enabling it for camp. Backend + SPA +
**migration `0018`** (`notifications.target_user_id`). `npm run typecheck` clean,
`npm run test` = **704 pass** (was 688; 16 new), SPA + `sw.js` `node --check` OK.
`sw.js` `camp-v54`→`camp-v55`.

> **Read this first if you are about to enable the tick.** Phases 1–3 of the web-push design are
> merged, but **nothing fires**: migration `0014` is unapplied and `CRON_SECRET` is unset, so
> `cron.service` has never run in prod. Everything below is the set of defects that would have
> landed the moment it did. **Migration `0018` must be applied to prod BEFORE this code pushes** —
> `supabase.notifications.save()` writes `target_user_id` on every save, so any notice write
> (including `incident.service.log`) fails until the column exists.

### 1 — Notices are addressed PER LOGIN, not just per scope (`targetUserId`)
The scheduler counts outstanding check-ins **per login** (gender-scoped `b-`/`g-` accounts hold
different numbers) but wrote a **church-scoped** notice, and `canSeeNotification` matched church
scope on `churchId` alone. So `b-victory` and `g-victory` each saw **both** notices — two
contradictory counts with no way to tell which was theirs — and admin/director saw *every*
church's, because oversight roles bypass scope checks. Proven by test before fixing.

`Notification.targetUserId` + one clause in `canSeeNotification`: a targeted notice goes to that
one login and **nobody else, deliberately including admin and director**. Null on every
human-authored notice, which stays scope-addressed exactly as before. `target_user_id` is in
`notifColumns`, `toNotif` **and the on-conflict `do update set` list** — miss that last one and
the value silently never persists (the repo's documented recurring bug class).

### 2 — Check-in warnings now EXPIRE at the window they warn about
They were created `expiresAt: null` + `priority:'urgent'` and nothing ever cleaned them up: a
camp would accumulate hundreds of permanent urgent rows, the Notices screen deletes one at a
time, and the bulk "Clear all notifications" button was removed on 2026-07-29. `expiresAt` is now
the window close (`ChurchBehind.windowEndAt`), which `findActive()` already filters on — so each
warning self-destructs when it stops being actionable. The `dedupe_key` row outlives the expiry,
so an expired notice is never re-created.
New **`zonedToInstant(tz, date, time)`** in `src/utils/date.ts` is the inverse of `zonedNow` —
the check-in code keeps wall-clock strings, and `new Date(date+'T'+time+'Z')` is the
UTC-vs-Brisbane bug that has hit this repo twice (it lands 10 hours early). Computed inside
`warnWindow`, where the camp zone is already in hand; a caller must not re-derive it.

### 3 — Feeds order by PUBLISH time, not `createdAt` (`publishedAt`/`byPublishedDesc`)
A scheduled notice's `createdAt` is when it was *composed*. Composed Monday for Thursday, with
three notices sent in between, it published in **4th place** — and Home renders only
`feed.slice(0,3)`, so it could publish without appearing on Home at all. Ordering is now
`scheduledFor ?? createdAt`, in `getActorFeed` and in the dashboard.

### 4 — `dashboard.service.latestNotification` uses `canSeeNotification`
It carried a hand-rolled **copy** of the audience rules (the duplicate this file already warned
about) and had drifted two ways: it never implemented the `scheduledFor` withhold — so a notice
scheduled days ahead was returned, **title and body**, the moment it was composed — and it denied
admin/director the see-every-scope rule they have everywhere else. Nothing in the SPA reads
`latestNotification` today, so there was no visible symptom; it was still going over the wire.
**There is now one copy of these rules. Do not re-inline them.**

### 5 — The urgent-priority tooltip was lying
It promised "pops up a full-screen alert they must tap to dismiss". The modal was deleted
2026-07-26 and item 18 (2026-07-28) limited the banner to `leadersOnly` incident alerts, so an
urgent human notice gets **no banner and no modal** — just a red card. Reworded to say plainly
that nothing interrupts anyone until they next open the app.

### 6 — `newYear` deletes push subscriptions
`reset()` did (bug 16); `newYear` did not, and was relying by accident on the `users` FK cascade —
which works on Supabase but not in-memory, and stops working the moment an account survives a
rollover. Same standing rule as `reset()`: **a new repository must be added to both in the same
commit.**

### 7 — The in-memory notification repo enforces the `dedupe_key` unique index
It didn't, so the scheduler's dedupe existed **only** on Supabase: in dev and in tests every tick
in the lead window created another duplicate, and `cron.service`'s `23505` branch was unreachable
except by a hand-faked error. `InMemoryNotificationRepository.save` now raises the same SQLSTATE.
A new test runs twelve real ticks through the real repo and asserts exactly one notice survives.

**Also:** `clearAll` threw a bare `Error` (→ 500 "the app is broken") instead of `ForbiddenError`.

**Known and deliberately NOT changed:** `estimateAudience` still runs a full people scan on every
send (≈10 AES field decrypts per person) to compute `audienceEstimate`, which **nothing reads**;
`churchRepo` is injected into `makeNotificationService` and unused. Left alone as a separate
cleanup — see the load note in `docs/PLANNED-IMPROVEMENTS.md`.
**↑ SUPERSEDED the same day — this was done in the second half of the session, see item 14 below.**

## Notification hardening, part 2 — load fixes, incidents, and web push SHIPPED — 2026-07-30

Same day, second half. The owner answered the seven open questions (recorded in
`docs/PLANNED-IMPROVEMENTS.md`) and **web push is shipping for this camp**. Everything in the
section above plus everything here went to prod in one push. `npm run typecheck` clean,
`npm run test` = **749 pass / 49 files** (was 704/48; **45 new**). SPA + `sw.js` `node --check` OK.
`sw.js` `camp-v55`→**`camp-v56`**. **Migrations `0018` AND `0019` were applied to prod BEFORE the
push**, both reconciled to clean version labels and verified present by query.

> ⚠️ **The `node --check` extract range has MOVED.** `public/index.html` grew: the script body is
> now lines **847–6681** (was 834–6410 at this section's own push). Don't cache that
> range — derive it, e.g.
> `S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1)`. The naive
> `<script>…</script>` regex still fails because the file contains the literal `</script>`.

### 8 — `checkIn`/`signEvent` no longer flush the dashboard cache
`invalidateDashboardCache()` wipes **every** entry globally, and the cache is keyed on
`(role, churchId, zone, genderScope)` — **not per device** — so ~100 devices collapse to ~30 keys
(~4:1). These two are the only **bursty** writes in the app: at a check-in window every leader taps
through a roster at once, and each tap was destroying the cache for all 30 keys precisely while
every device was loading `/home`. Cost of not invalidating is bounded by the 30s TTL, and a leader
mid-rush is on the roster screen (always live), not the dashboard. Every other writer still
invalidates. **The two tests were INVERTED, not deleted** — they now pin stale-within-TTL and
correct-after-TTL, so the trade-off can't be silently undone.

**An audit of all ~31 `invalidateDashboardCache()` call sites says do NOT generalise this.** Only
three others cannot affect a dashboard DTO (`splitChurchAccounts`, `randomizeChurchPasswords`,
`updateDiscountCodeTags`) and all three are rare admin operations where the flush costs nothing.
Burst frequency, not correctness, is the whole reason these two changed.

### 9 — `/home` uses `findByChurch` for church logins
New `personsInScope(actor)` in `dashboard.service`. `findAll()` on Supabase means the whole `people`
table **plus every row of `check_in_history` and `sign_out_history`** — at camp ~700 people and
~3,500 history rows, fetched and decrypted on every uncached request, to then discard all but the
~30 a church may see. Applied to BOTH the pre-camp and at-camp branches.
⚠ **`canAccessPerson` is still the real gate and must stay.** `findByChurch` knows nothing about
`genderScope`, so dropping that filter as "already scoped" would show `b-victory` the girls'
numbers — there is a test for exactly that. Narrowing a query cannot widen access.
Deliberately NOT extended to `zoneLeader` via `findByZone`: `canAccessPerson` also admits people
whose *church* sits in the zone, and the two can disagree after a re-zone. Field decryption was
left alone on purpose (34ms for 700×10 — row volume is the cost, not AES).

### 10 — Push fan-out is capped per tick, and jittered
`MAX_PUSH_SENDS_PER_TICK = 40` (`push.service.ts`). All 26 church logins hit their window boundary
together, so one tick can generate 26 notices → ~104 sends at 4 devices/church, ~156 at 6. With
`maxDuration: 30` and ~325ms/send that is ~8.5–13s, and the failure is **not graceful**: the
`push_sent_at` claim is taken BEFORE sending, so a timeout loses those pushes **permanently**.
Capping keeps the worst tick to ~3.5s; the remainder is simply not claimed, so the next tick takes
it (60-min lead ÷ 5-min tick = 12 ticks ≈ 480 capacity). **The cap is applied at NOTICE granularity,
not device** — a notice's claim is all-or-nothing, so splitting its devices across ticks would drop
the second half rather than defer it. `PUSH_JITTER_MS = 4000` spreads sends so 100+ devices don't
all open the app in the same second.

### 11 — Web push phases 4–6 (VAPID, subscribe API, service worker, opt-in UI, sender, pruning)
Owner's decision: push ships for this camp. New `web-push` dependency, `src/services/push.service.ts`,
`src/api/controllers/push.controller.ts`, three routes (`GET /push/config`,
`POST`/`DELETE /push/subscribe`, all `auth:true`), sw.js `push` + `notificationclick` handlers, and
an "Alerts on this device" card on both home screens.

- **⚠ INERT WITHOUT VAPID KEYS, BY DESIGN.** This shipped to prod *before* the keys exist. With any
  of the three env vars unset, `/push/config` returns `configured:false`, the SPA card renders
  nothing, and **the sender returns before claiming anything**. That last part is load-bearing:
  claiming would set `push_sent_at` on notices that were never sent, and the claim is permanent, so
  every notice created before the keys are set would be silently swallowed forever.
- **⚠ A SERVER-STORED `body` IS NEVER PUT IN A PUSH PAYLOAD.** `buildPushPayload` keys off the
  trigger and does not read `notification.body`, `incident.summary` or any person field. The reason
  is NOT the transport (payloads are genuinely E2E-encrypted; Apple/Google/Mozilla can't read them)
  — it is the **lock screen**: the SW decrypts and hands it to the OS, which renders it on a locked
  phone with "Show Previews: Always" (the iOS default), legible to whoever is holding it. That would
  print a field this codebase encrypts at rest and hides from church/firstAid accounts onto the most
  public surface the device has, and it inverts `leadersOnly` — the *account* is a leader, the
  *person reading the screen* is whoever picked the phone up. There are tests asserting the payload
  never contains a body. The check-in warning is the one exception and carries only an aggregate
  count, a session label and a time.
- **Audience is resolved by `canSeeNotification`**, the same predicate the feed uses, run in reverse
  over the users table. Do not write a second copy — the failure mode is pushing a `leadersOnly`
  incident to a church login whose feed correctly hides it.
- **`isPushSuppressed` (D8)** — `churchLoginLocked`/`zoneLeaderLoginLocked` are read in exactly one
  other place (`auth.service.login`) and block LOGIN only. A subscription is session-independent, so
  without this a locked-out leader's phone buzzes forever and the owner's post-camp lock would be a
  false sense of closure. Suppressed at send time, not deleted, so unlocking restores alerts with no
  re-subscribe. `mustChangePassword` is deliberately NOT suppressed.
- **Pruning**: 404/410 deletes the row immediately (the standard self-cleaning contract);
  429/5xx increments `failure_count` and deletes at 10; `pruneStale()` reclaims anything with no
  success in 90 days.
- **SPA safety contract** — `_pushCardHtml()` returns a STATIC EMPTY `<div>` and nothing else; all
  work happens in `_renderPushCard()`, which is async, fully try/caught, and writes only into that
  div. **Keep this shape.** The card is on the Home screen of every role, so a render-time throw
  would blank the app's landing screen for everyone — and `Notification`/`PushManager` are absent or
  throwing on some older iOS. The card also hides itself in `PREVIEW_MODE`/`ACCOUNT_PREVIEW` (an
  admin previewing a church account must not register their own phone against it).
- **Deep link**: the SPA has no URL router, so `notificationclick` `postMessage`s the target screen
  to a focused client and falls back to `openWindow('/?nav=…')`, consumed once at boot by
  `_consumePushNav()` (which strips the query so a refresh doesn't re-navigate).
- `push` was added to `API_RE` in `sw.js`; `internal` is still deliberately absent (the cron tick is
  server-to-server and never passes through a service worker).

### 12 — Incidents: optional `occurredAt` + 12-hour alert expiry (migration `0019`)
Owner approved 4.5 and 4.6 only. `occurredAt` is **optional** — logged without it is valid and must
never warn. The high-severity `leadersOnly` alert now expires `INCIDENT_ALERT_TTL_HOURS = 12` after
creation (prod had 2 sitting permanently); `findActive()` already filters on `expiresAt`, so that is
the whole of the cleanup. Low-severity raises no notice at all — unchanged.
⚠ **The SPA must send a full ISO instant.** `<input type="datetime-local">` yields a bare wall-clock
string with no zone; the schema **rejects** it on purpose, because parsing that server-side is the
UTC-vs-Brisbane bug that has hit this repo twice. `_incOccurredISO()` converts via `new Date(v)`
(which reads it as device-local — and the device is at camp) and returns `null` when empty.
`occurred_at` is in `toIncident`, `incidentColumns` **and** the on-conflict `do update set` list.

**Owner DECLINED**, do not build without asking again: incident **review state** (4.1), **server-side
acknowledgement** of high-severity alerts (4.2), **zone-scoping** `incident.list()` (4.3 — zone
leaders keep camp-wide visibility, confirmed intended), and **soft delete** (4.4 — hard delete
stays). Cross-zone incident *filing* also stays allowed; §3.4 only constrained `zone` to the four
`ZONE_NAMES` so a typo can't silently mis-file a record.

### 13 — `account.service.listChurches` was a drifted copy of `canAccessChurch`
Found by a duplicate-rule audit. It special-cased admin/director/zoneLeader then fell through to
`c.id === actor.churchId` for "everyone else" — and `firstAid` is in that fall-through with **no
`churchId`**, so `GET /accounts/churches` returned first aid an **empty list**, while the canonical
rule grants firstAid every church as it does everywhere else. Latent (no first-aid screen calls it
yet) and uncovered by any test, which is how it survived. Now `churches.filter((c) =>
canAccessChurch(actor, c.id, c.zone))`, with tests for all four roles. **This is the second
hand-rolled copy of an audience rule found in one day — do not inline these.**

### 14 — `estimateAudience` deleted (supersedes the "deliberately NOT changed" note above)
It scanned the whole `people` table (~10 AES decrypts/person) on every send and every
audience-changing edit, to populate `audienceEstimate` — which **nothing reads**: no DTO exposes it,
`public/index.html` references it zero times, and `incident.service` was already writing a hard-coded
`0`. Deleted along with the `personRepo`/`churchRepo` params it was the only user of.
**The field and its column are KEPT**, not dropped: `cron.service` writes a genuinely meaningful
number into it (students still to check in), and retaining the column avoids a migration and matches
the `discount_code_overrides` precedent. An edit now preserves the existing value rather than
recomputing it. If a real "who will see this?" figure is ever wanted, compute it from
`canSeeNotification` over the USERS table (tens of rows), never by scanning people.

### ~~Still gated on the owner~~ — ALL TURNED ON 2026-07-31, see the section below

## 🔐 SECRET INCIDENT + `VAPID_PUBLIC_KEY` was never a key — 2026-07-31

Found while chasing the follow-up to the iOS fix below: after the activation fix landed, the
iPhone prompted correctly, permission was granted, and subscribe then failed with
**`InvalidCharacterError`** — `atob()` in `_urlB64ToUint8`.

**`VAPID_PUBLIC_KEY` in production contained 180 characters of pasted TABLE TEXT**, not a key:
rows for `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `CRON_SECRET`, complete with pipes,
`mailto:`, and literal `\n`. The four secrets were added ~2h earlier (the section below on the
tick going live) and a multi-line paste landed in one variable. Read directly from
`vercel env pull`, not inferred.

### ⚠️ This was a secret exposure, not just a broken feature
`GET /push/config` returns `publicKey` **verbatim to the client** and is `auth:true`. So every
logged-in device that rendered Home in that window was served the VAPID **private** key and
**`CRON_SECRET`** in a JSON response, readable in devtools by any leader account. `CRON_SECRET`
was live and working (the tick was returning 200), and because `claimForPush` takes the
`push_sent_at` claim BEFORE sending, anyone holding it could have permanently swallowed real
check-in warnings by triggering the tick.

**Full rotation performed** (owner authorised): a fresh VAPID keypair and a fresh 32-byte
`CRON_SECRET` were generated and set for **Production and Preview**, and the Supabase Vault
`cron_secret` was updated to match. The exposed values are dead.

**Verified, not assumed** (after the redeploy — env vars only reach a NEW build, and the old
build was still serving the leaked value until it landed):
- **`VAPID_PUBLIC_KEY` byte-exact** — pulled back and compared to the generated key: 65 bytes,
  leading `0x04`, and the *exact browser `atob()` path* (pad → `-_`→`+/` → decode) succeeds.
- **`CRON_SECRET` end-to-end** — the cron job's OWN command was run verbatim from the DB
  (`net.http_get` + `vault.decrypted_secrets` → `/internal/cron/tick`) and
  `net._http_response` returned **200** `{"ok":true,…}`. That exercises the exact path
  `pg_cron` uses, so Vercel and the Vault are proven in agreement.
  ⚠ The route is **`/internal/cron/tick`** — read it from `cron.job.command`, don't guess it
  (`/internal/push-tick` 404s).
- **All three VAPID vars pass shape validation in prod** — `cron.service` calls
  `isPushConfigured()` on EVERY tick, so a malformed value would have logged `[push] VAPID_…`.
  The runtime logs are clean across the post-deploy ticks, which is a positive result for the
  private key and subject even though both are sensitive and unreadable.
- ❗ **Still unproven: that the private key is the mathematical PAIR of the public key.** Both
  came from one `generateVAPIDKeys()` call and one write operation, and the public half
  verified byte-exact, so the risk is low — but only a real push delivering to a real device
  proves it. `pushAttempted` is still 0 because there are still zero subscriptions.

### Gotchas learned doing the rotation — read before touching env vars again
- **`vercel env add` IGNORES stdin when it detects an agent** (`--non-interactive` is the
  default then). Both `< file` and `cat file |` reported *success* and wrote **empty strings**.
  Use **`--value`**. Three separate "successful" writes were silently empty before this was
  caught — always verify a write, never trust the exit code.
- **This project stores new env vars as `type=sensitive` by default**, and a sensitive value is
  **never readable back** — not by `vercel env pull` (returns `""`) and not by the REST API even
  with `decrypt=true`. `vercel env ls` shows "Encrypted" for both types, so it does not tell
  them apart. Use `--no-sensitive` for genuinely public values.
- **`VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` are now stored NON-sensitive, deliberately.** The
  public key is served to every client by design, so nothing is lost — and it makes the value
  verifiable, which is the only reason this bug was findable at all. **Keep them non-sensitive.**
  The private key and `CRON_SECRET` stay sensitive.
- `vercel env pull` returns `""` for many working vars (`PERSISTENCE`, `DATABASE_URL`,
  `SESSION_SECRET`…). **An empty pull does NOT mean an empty value** — it usually means
  sensitive. Do not "fix" a var on that basis.

### Hardening so this cannot recur (this is the actual code change)
`readPushConfig` now `trim()`s all three values and **validates their shape**: the public key
must decode as base64url to **65 bytes with a leading `0x04`** (uncompressed P-256 point), the
private key to **32 bytes**, and the subject must start with `mailto:` or `https://`. Anything
else → `null`, i.e. `configured:false`, so the feature is **cleanly inert and nothing is served
to a client**, plus a `console.error` naming the variable and its length — **never its value**.
Client side, `_isValidVapidKey()` re-checks before rendering, so a bad key hides the card rather
than offering a button that can only fail after the user has already granted OS permission.

> ⚠️ **The `VAPID_ENV` test fixture was `'pub'`/`'priv'`** — placeholders of exactly the class
> that broke production, so the suite was structurally incapable of catching this and every
> test passed while prod served table text. It is now a real throwaway keypair. **Do not
> shorten it back.** Six regression tests cover the malformed cases, including the literal
> table-paste string.

## Alerts offer extended to every role + prod notices cleared — 2026-07-31

`_maybeOfferPushAfterInitials` is now **`_maybeOfferAlerts`** — it has two entry points and the
old name described only one. `sw.js` → `camp-v68`. SPA-only.

**`_offerAlertsAfterLogin()`** is called from all **three** post-sign-in paths, and all three
are needed: `doLogin`, `submitChangePassword` (a `mustChangePassword` account lands there, not
in `doLogin`), and `_tryRestoreSession` (reopening the installed app). 900ms delay — longer
than the initials path, because Home is still painting immediately after sign-in.

> ⚠️ **It skips church accounts deliberately.** `enforceInitials()` has already opened a
> blocking, unskippable modal on that path. A second modal 900ms later would replace it and
> leave the account with **no initials set** — which then blocks every attributed write. Church
> logins keep getting the offer after they save their initials instead.

Every existing gate still applies, so it remains **at most one offer per device, ever**:
permission `default`, iOS installed, `ycp_push_asked` unset, server VAPID key valid.

### Production data: notices cleared

All `notifications` rows deleted at the owner's request — **32**: 30 `Check-in closing soon
(test)` from the 06:09 test-button run (it reached 30 church logins, so the button works at
real scale), and 2 `Incident logged` alerts from 27–28 July.

**The 6 rows in `incidents` are untouched.** Those notices are only the *alerts*; the incident
records themselves live in their own table and were never in scope. `push_subscriptions` (2)
also untouched, so no device has to re-subscribe. Verified after: `notifications` 0,
`incidents` 6, `push_subscriptions` 2.

## Alerts offered when a leader sets their initials — 2026-07-31

`_maybeOfferPushAfterInitials()`, called 600ms after `_confirmEnforceInitials` (the login
gate — the main path) and after `_confirmInitials` when initials were **set**, not cleared.
`sw.js` → `camp-v67`. SPA-only.

**Why initials:** a PWA gets **no install-time hook** — nothing fires on Add to Home Screen —
so there is no "on installation" moment to hang this off. Setting initials is the closest this
app has to *a person has just claimed this device*, which is when the offer makes sense.

**It opens OUR consent sheet, not the OS prompt**, and both reasons matter:
1. an OS prompt fired straight off the initials save explains nothing, and a tap on "Allow" is
   not meaningful consent to a safeguarding-adjacent alert that renders on a lock screen;
2. it runs from a `setTimeout`, so **user activation is already gone and WebKit would refuse
   `requestPermission()` outright**. The sheet's own button restores it — the same
   `_pushOn`/`_pushConsentGo` split that fixed the original iOS bug. Do not "simplify" this
   into a direct `requestPermission()` call; that is the 2026-07-31 bug rebuilt.

**Every gate must pass:** not a preview mode; `serviceWorker` + `PushManager` + `Notification`
present; `Notification.permission === 'default'` (granted/denied are never re-promptable, so
asking is pure noise); on iOS, installed to the Home Screen; never asked before on this device;
and the server's VAPID key present and valid. The asked-flag (`localStorage.ycp_push_asked`) is
written **before** the sheet opens, so cancelling is respected — one offer per device, ever.
Anyone who declines can still turn alerts on from Notices.

> ⚠️ **SCOPE: initials are CHURCH ACCOUNTS ONLY** (`_isChurchAccount`). Admin, director, zone
> leader and first-aid logins never set initials, so they **never see this offer** and must use
> the Notices card. Church logins are the accounts that receive the check-in warning, so this is
> the right audience — but it is not "every role gets prompted", and nobody should assume it is.

Also corrected the consent sheet copy: it still promised an alert for any camp notice, and only
**urgent** ones alert since the priority change earlier the same day.

## Admin test button for the check-in warning — 2026-07-31

**`Admin → Settings → Check-in & timing → Send test check-in alert`** →
`POST /admin/test-checkin-warning` → `cron.testCheckinWarnings(actor)` (`admin:manage`).
`sw.js` → `camp-v66`.

**Why it exists:** job B's gate needs four conditions true *at once* — restriction on, a camp
day, inside a window, ≤60 minutes left. So the check-in warning could not be rehearsed; the
first time anyone saw it work would be the morning it had to work.

It runs the **real** pipeline with only the timing gate replaced: `churchesBehindFor` (the
genuine per-login counting rule) → notice creation → `canSeeNotification` audience resolution
→ claim → web-push fan-out.

### `checkin-warnings.ts` is now split — don't re-merge it

`churchesBehind` (timing gate) delegates to the new exported **`churchesBehindFor`**
(counting). Both callers share the counting rule *on purpose*: present, non-leader, per
gender-scoped LOGIN, last check-in entry wins. **A test that reimplemented the count would
prove only that the second implementation works.**

**`testWarnWindow()`** resolves a session without the gate: the genuinely open session if
there is one (highest fidelity), else `currentSession()` — today's, else the most recent past,
else the first upcoming. It floors the expiry at `CHECKIN_TEST_TTL_MINUTES`, because after
camp the natural window end is in the past and `findActive()` would hide every test notice the
instant it was written.

### Three deliberate differences from a real warning

| Difference | Why |
|---|---|
| Title says **`(test)`** | These land in real church accounts' Notices feeds. An alert indistinguishable from the real one, out of camp season, is how a leader learns to distrust the alert that matters. |
| **`includeZero: true`** | Production must never say "0 students still to check in" (design D4 condition 4). But a test that silently sent nothing because everyone happens to be checked in reads as a broken button. The response reports **`churches`** and **`churchesWithOutstanding`** separately so "reached 12 logins" can't be mistaken for "the counting was exercised". |
| Dedupe key carries the **run timestamp** | Makes the button repeatable, and means it can never collide with — or *consume* — a real `checkin-warn:<session>:<user>` key. A test that burned the real key would suppress the genuine warning for that session. There is a test asserting a real warning created first survives two test runs. |

The triggering admin gets a copy addressed to them. Without it the button is **unobservable to
the person pressing it** — real warnings are `targetUserId`-scoped to church logins, so an
admin's own phone stays silent no matter how well it works.

SPA: `confirmSheet` **before** sending — this writes into every church login's feed and rings
every church device with alerts on, so it must never fire on a mis-tap.

Verified: `npm run typecheck` clean; `npx vitest run` **794 pass / 49 files** (was 785, +9);
`node --check` OK on `sw.js` and the SPA body (extract range **847–6958**, re-derived).

## Push behaviour batch — titles, urgent-only, self-test, blank-screen fix — 2026-07-31

The owner's first real subscription worked, and using it surfaced four things. All four were
in the same round trip. `sw.js` → `camp-v65`.

### 1. 🐞 Opening the app from a notification landed on a BLANK screen

**Root cause, confirmed not inferred:** `buildPushPayload` returned `screen: 'notices'` for an
ordinary notice. **There is no `notices` screen** — the SPA's Notices screen is **`notifs`**.
`_navTo` → `_spinner` finds no element and does nothing, then `_showScreen` strips `.active`
off every `<section class="screen">` and matches nothing. Result: an empty app frame, **no
exception, nothing in any log**, which is why nothing caught it. The two system triggers were
unaffected — `checkin` and `incidents` are both real ids — so only tapping a *notice* did it.

Fixed in two independent places, on purpose:
- the payload now says `notifs`, and a test scrapes `<section class="screen" id="…">` out of
  `public/index.html` and asserts **every** screen this function can emit actually exists;
- the SPA routes both deep-link paths (warm `postMessage`, cold `/?nav=`) through
  **`_pushNavTo()`**, which falls back to `home` for an unknown id and refuses to navigate at
  all when there is no session. Not redundant with the first fix: **notifications already
  delivered to a phone keep their old payload forever**, so the guard is what makes the
  already-sent ones survivable.

### 2. The notice's TITLE now travels; the body still never does

Owner request: identify the notification, keep the detail behind the app. So `buildPushPayload`
sends `n.title` and still sends a fixed string for `body`. The long lock-screen block comment in
`push.service.ts` is updated rather than deleted — **the body rule is unchanged and still the
important one**; it is the field carrying incident summaries and free text about named minors.

Exposed titles are `Check-in closing soon`, `Incident logged · <Zone> Zone` (both system-fixed),
and the subject a director/zone leader types. That last one is author-controlled — **the one
place a leader can put a camper's name on every recipient's lock screen.** Accepted trade,
mitigated twice: `pushTitle()` collapses whitespace and caps at `PUSH_TITLE_MAX` (80), and the
compose screen tells the author their title shows on locked phones.

### 3. Normal-priority notices no longer buzz anyone — `isPushable()`

Before this, *every* active notice pushed, so "dinner is at 6" alerted every leader's phone —
the fastest route to a camp where everyone has turned alerts off, urgent ones included. Now:
**urgent → push; normal → in-app only.** Incident alerts and check-in warnings are matched
structurally as well as by priority, so neither can be silently demoted by a later edit.

⚠ The gate runs in the **cron filter, before `resolvePushAudience`** — a filtered notice is
never claimed, so it stays `pushSentAt: null` and is re-examined on all 288 ticks a day until
it expires. Fine for a pure predicate over a field already in memory; **not** fine after a
per-user subscription lookup. `sendForNotifications` applies it a second time, deliberately:
the caller decides *when* to push, the service decides *what may be pushed at all*.

### 4. `POST /push/test` — prove a phone works without waiting for a real alert

Neither real trigger can be exercised on demand: an incident alert means logging a fake
incident against real people, and the check-in warning needs a camp day, a lead window, and a
church genuinely behind. The self-test reuses the check-in warning's **exact** shape (title,
`tag`, `screen: 'checkin'`), so it proves VAPID signature → APNs/FCM → `sw.js` → deep link.
**It does not prove `churchesBehind` arithmetic — delivery only.** Button: *Send a test*, on
the alerts card on Notices, visible once the device is subscribed.

Security: the user id comes from the **session, never the body**. A body-supplied id would make
this "send an arbitrary push to any account", and the payload renders as a genuine camp alert on
a locked phone. It writes no notification row, and a failed test does **not** count towards
`PUSH_FAILURE_LIMIT` — a leader debugging their own phone taps it repeatedly, and ten taps must
not delete the subscription they are testing.

Verified: `npm run typecheck` clean; `npx vitest run` **785 pass / 49 files** (was 771, +14);
`node --check` OK on `sw.js` and on the SPA script body (extract range **847–6920**, re-derived).

## "Alerts on this device" — iOS opt-in fixed + moved to Notices — deployed 2026-07-31

Owner bug report: the Home card's "Turn on alerts" button worked on a laptop but an **installed
iPhone** answered *"Could not turn on alerts on this device"*. SPA-only (`public/index.html`), no
backend/schema change. `npm run typecheck` clean, `npx vitest run` = **765 pass / 49 files**
(unchanged — this is browser-only code). SPA + `sw.js` `node --check` OK. `sw.js`
`camp-v62`→**`camp-v63`**.

### The bug: user activation is lost across `await` in WebKit
The generic toast was the `catch` in `_pushOn`, so the failure was a **throw**, not one of the
"not possible here" branches. The only browser-behaviour difference in that code path is user
activation: `_pushOn` did `await confirmSheet(...)` and *then* called
`Notification.requestPermission()`. **WebKit scopes user activation to the event handler's own
call stack**, so a call made after an `await` — even one resolved from a click — has already left
that stack and is rejected with `NotAllowedError`. Chrome uses a *time-based* transient-activation
window instead, which is exactly why it worked on the laptop and looked device-specific.

`_pushOn` is now split in two and **must stay split**: it only opens the consent sheet, and
**`_pushConsentGo`** is the sheet's own `onclick`, calling `requestPermission()` as its first
statement (before `closeModal()`, before anything async). The rest moved to **`_pushFinish`**.
Both API shapes are handled (Promise return *and* the legacy callback arg).

> ⚠️ Do NOT "tidy" this back into one `async` function, and do not re-introduce `confirmSheet`
> here. Any `await` between the tap and `requestPermission()` re-creates the bug, and it is
> invisible on every desktop browser.

### The generic toast is gone (`_pushFail`)
One bare "Could not turn on alerts on this device" covered permission, service worker, push
service and API failures alike — which is why placing this cost a full deploy-and-retest cycle.
The toast now names the error: `NotAllowedError` = activation/permission, `AbortError` = the OS
push service refused, anything else = our API.

> **This fix is reasoned, not device-proven** — it cannot be verified without an installed
> iPhone. If it still fails, the toast now says which step, and that is a one-tap diagnosis.

### Moved off Home to the Notices screen (owner request)
`_pushCardHtml()`/`_renderPushCard()` are gone from **both** Home renders (`RENDER.home` and
`renderHomeAtCamp`); `RENDER.notifs` is now the **only** caller, in both its branches (feed and
Scheduled). The card is also compact now — a `btn ghost sm` labelled button, no card chrome and no
heading, since the screen is already titled "Notices".

**Roles that can reach it:** church/zoneLeader/director have Notices as a bottom-nav tab; admin
reaches it via the Admin console tile (pre-camp) or the at-camp home Notices tile — `extras` render
only in the ≥980px sidebar, so those tiles are load-bearing (see the 2026-07-31 tile section below).
⚠ **`firstAid` has no Notices screen at all and therefore cannot opt in** — but it could not before
either: `RENDER.home` redirects firstAid straight to Search, so the Home card never rendered for
that role. Not a regression; flagged because it is now the only role with no route.

**There is deliberately still a tap.** A PWA gets no install-time permission hook — no event fires
at "Add to Home Screen", and both iOS Safari and Chrome refuse a gesture-less
`requestPermission()` (silently on iOS). "It should just ask on install" is not implementable; the
earliest possible prompt is a tap after first launch.

## The tick is LIVE — secrets set, `0014` applied, warning proven end-to-end — 2026-07-31

Config + verification only. **No application code changed** (this section and the redaction in
`docs/DEPLOY-NEXT-STEPS-2026-07-30.md` are the entire diff). The chain described in the two
2026-07-30 sections above is now actually running.

- **Vercel env vars set** (Production **and** Preview): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  (Sensitive), `VAPID_SUBJECT`, `CRON_SECRET` (Sensitive), via `vercel env add`. Redeployed —
  env vars only reach a NEW build.
- **`cron_secret` is in Supabase Vault** and matches Vercel. **Verified, not assumed:** before
  scheduling anything, a one-off `net.http_get` was fired from the DB using
  `vault.decrypted_secrets` against the real prod route — `net._http_response` returned **200**.
  That exercises the exact path `pg_cron` uses, so `0014` was never applied on hope.
- **Migration `0014` APPLIED** and its history row **reconciled** from the generated timestamp
  `20260731011901` to version `'0014'`. `cron.job` = `camp-push-tick`, `*/5 * * * *`, `active`.
  First automated run 01:20:00Z `succeeded` → 200.
- **✅ THE MIGRATION HISTORY DRIFT IS FIXED (2026-07-31).** All six rows (`0009`–`0012`,
  `0016`–`0017`) were reconciled from their generated timestamps in one statement, deriving the
  version from each row's own `name` (`set version = left(name,4) where version ~ '^\d{14}$' and
  name ~ '^\d{4}_'`) after a collision guard returned 0. **`supabase_migrations.schema_migrations`
  now reads exactly `0001`–`0019`, contiguous** — 19 rows, 19 files on disk — for the first time
  since the 2026-07-16 consolidation. A `supabase db push` now correctly sees everything applied.
  Reversal mapping if ever needed: `20260720012415`→`0009`, `20260723131647`→`0010`,
  `20260723131721`→`0011`, `20260723181751`→`0012`, `20260728114005`→`0016`,
  `20260729125651`→`0017`.
  ⚠️ **This only stays clean if every future `apply_migration` is followed by the reconcile step.**
  That step has now been skipped six times historically; it is not optional on this project.

### The end-to-end test (run against prod, then fully reverted)
The unit tests were not trusted. Camp dates were temporarily today's, the church time restriction
on, and the PM window narrowed to put "now" inside the 60-minute lead. One tick returned
**`checkinWarningsCreated: 6, failed: 0`** and wrote exactly what the 2026-07-30 hardening claims:

- **Per-login addressing (item 1) CONFIRMED** — `b-citipointe-brisbane` got **20** and
  `g-citipointe-brisbane` got **17**, each `target_user_id`-addressed to that one login. This is
  the exact bug item 1 fixed; before it, both accounts saw both contradictory counts.
- **Expiry (item 2) CONFIRMED** — `expires_at = 02:14Z` = 12:14 Brisbane = the window close.
  Correct to the minute, so `zonedToInstant` is not re-introducing the UTC-vs-Brisbane bug (the
  old failure landed 10 hours early).
- **Dedupe CONFIRMED** — an immediate second tick returned `checkinWarningsCreated: 0`.
- Copy pluralises correctly ("1 student" / "20 students"); `audience_estimate` carries the
  remaining count (the reason item 14 kept the column).

Reverted after: the 6 notices deleted, PM window restored to `12:00`/`23:00`.

> ⚠️ **CHANGING THE CAMP DATES IN THE UI MOVES THE SCHEDULE AND DEVOTIONALS WITH THEM.**
> `remapDays()`/`applyDayMoves()` re-key both by POSITION (2026-07-28 item 3). After the date
> change all 48 schedule items + the devotional sat on `2026-07-31`–`08-03`. **So camp dates must
> be reverted through the admin UI, never by SQL** — a direct SQL revert strands every schedule
> and devotional row on the old dates and those screens go blank. Remap is lossless only while
> the day COUNT matches (shrinking hides the surplus).

### Web-push §12 q9–12 ANSWERED — nothing organisational gates rollout
Metadata transfer to Apple/Google/Mozilla **accepted**; **no under-18 login holders** (all are
compliance-trained leaders — re-ask if that ever changes); the **youth team** owns the privacy /
compliance update; the iOS Add-to-Home-Screen install happens at the **pre-camp training day**.
Full record + the caveats that survive: `docs/PLANNED-IMPROVEMENTS.md` 2026-07-31 section.
⚠ The install still forces a **re-login** (separate storage partition, randomised `Word.###`
password, initials re-prompt) — fine at a training day, painful mid-camp. **If the training day
slips, that cost comes back.**

### Clean-up batch, same day — passwords, check-in dedup, Notices route, history drift
Built by two parallel subagents in isolated worktrees (backend / SPA — disjoint files), merged and
gated together. `npm run typecheck` clean, `npx vitest run` = **765 pass / 49 files** (was 759; 6
new). SPA + `sw.js` `node --check` OK. `sw.js` `camp-v61`→**`camp-v62`**.

- **B8 — church passwords widened to `Word.###`** (three zero-padded digits, `Donkey.683`).
  Keyspace ~11.7k → ~117k. ⚠ **Existing passwords are hashed and stay valid, so the wider keyspace
  does NOT take effect until someone re-runs "Randomise & export church passwords" and
  redistributes the CSV.** Owner's plan is to do that at the pre-camp training day, alongside the
  iOS install. Also fixed latent arithmetic in the `minLength` backstop — a result is
  `word.length + 4` chars, and the code still said `- 3`.
- **N5 — `withCheckIn` is now idempotent.** A replayed identical entry is a no-op instead of
  writing a duplicate row into the compliance export. ⚠ It compares **only against the last entry
  for that same session**, never the whole history, because "checked in" is **last-entry-wins**
  (`toRosterEntry`, `checkin-warnings.ts`): a genuine in→out→in is three real entries and must keep
  working. There are tests pinning both halves. `atCamp`/`lifecycle` still untouched (P0 invariant).
- **Notices tile restored to the admin console, pre-camp only** — see that section below.
- **Migration history drift fixed** — see above.
- **`.claude/` added to `.gitignore`.** Agent worktrees live there and were **not** ignored: a
  stray `git add -A` would have published a second full copy of the tree to this **public** repo,
  and `vitest` was globbing them (147 files / 2289 tests instead of 49 / 765 — a badly misleading
  green). Remove worktrees before trusting a test count.

**Owner DECLINED this round, do not build without asking again:** a hard pre-camp mode gate on
`RENDER.incidents` (it is already unreachable pre-camp via every nav path; a hard gate was built
and reverted on 2026-07-17 because it stranded real safeguarding records — prod holds 6 incidents,
3 high-severity, all logged pre-camp); removing the Budget & Costings console tile; and S7's
`POST /admin/reset` hardening (the export guard still latches open after the first export — the
only real barrier remains the client modal + typed phrase).

### Push is configured but STILL UNPROVEN
`pushAttempted: 0` on every tick — there are **zero** `push_subscriptions`, so no push service has
ever been contacted and no notification has reached a device. `/push/config` is `auth:true` and was
never read with a session, so `configured:true` is **inferred** from the env vars being present in
the build, not observed. **Do not claim push works** until a real device subscribes and receives
one. The iOS adoption problem (no permission prompt until Add to Home Screen) is unchanged and is
still the biggest risk.

## Church check-in refused — the UI locked on the wrong rule — 2026-07-31

Reported: *"Daily check-ins for the admin account work but on a church account it gives '1 check-in
didn't save — tap to retry'."* Backend + SPA, **no schema/migration change**. `npm run typecheck`
clean, `npm run test` = **756 pass / 49 files** (was 749; 7 new). SPA + `sw.js` `node --check` OK.
`sw.js` `camp-v56`→**`camp-v57`**.

**Root cause — two rules that look alike and are not.** `currentSession()` answers *"which session
should the screen open on"* and, once camp dates exist, **never returns null**: with no session
today it falls back to the most recent past one, or the first upcoming one. `allowedWindowSession()`
answers *"which session may a restricted church WRITE to right now"* and returns **null** outside
camp days and outside the AM/PM windows. The SPA locked its roster on the first
(`sessionLocked = churchRestricted && SEL_SESSION !== CUR_ID`) while the backend gated writes on the
second. On a camp day they roughly coincide, which is why it survived since 2026-07-23; the camp
dates are 2026-09-28–10-01, so **before camp they diverge completely** — `CUR_ID` came back as
`2026-09-28~pm`, `SEL_SESSION` defaulted to it, the lock evaluated false, every row was tappable,
and every tap 403'd. Admin was unaffected because `assertSessionAllowed` returns immediately for
every role except `church`. Prod confirmed the preconditions: at-camp mode,
`church_checkin_time_restricted = true`, today not in `check_in_days`.

**This is the third hand-rolled copy of a backend rule found in two days** (after
`dashboard.latestNotification` and `account.listChurches`). The pattern is identical: the UI
re-derives a decision the server already owns, the copy drifts, and the disagreement only shows up
in a state nobody tested.

- **One rule, exposed as data.** New `allowedSession()` in `checkin.service.ts` returns
  `{session, restricted, reason}`. **`assertSessionAllowed` now calls it** rather than repeating the
  window arithmetic, and a new `GET /checkin/sessions/allowed` (actor-scoped, `auth:true`) serves the
  same answer to the SPA. A test asserts the two agree across in-window, out-of-window and
  non-camp-day instants. `getCurrentSession`'s interface doc now says NAVIGATION ONLY in as many
  words.
- **The SPA locks on `ALLOWED_ID`**, fetched only when `churchRestricted` (no extra round-trip for
  anyone else) and **failing closed** — an error means locked, since a restricted church could not
  have written anyway. When nothing is allowed the info box prints the server's own sentence
  ("…the morning window is 06:00–12:00 … on camp days only") instead of the misleading "tap the
  highlighted session (•)", which pointed at a session that was equally refused.
- **The server's explanation is no longer thrown away.** `drainQueue`'s catch kept only a counter,
  so a permanent 403 rendered as *"tap to retry"* — advice that can never work. It now keeps the
  first `e.message` in `_checkinFailReason` and the banner shows it. Cleared by `_retryFailedCheckins`.

⚠ **Not a regression from the 2026-07-30 push** — latent since item 11 (2026-07-23) and only
reachable outside camp dates. **Nothing about the camp-window policy changed**; a church still
cannot check in outside a window, which is the intended safeguard. **To test check-in before camp,
turn off Admin → Camp settings → Check-in & timing → the church restriction toggle** (or add today
to the camp dates). That toggle is the supported escape hatch and no code change should replace it.

## Web push phases 1-3 + bundled launch-readiness batch — 2026-07-26

Plan: `docs/superpowers/plans/2026-07-26-web-push-phase1-3.md`; progress + deviations:
`.superpowers/sdd/progress.md` (read that before trusting any summary here — it records the
deferred findings and the prod-drift discovery). Backend + SPA + **migrations `0013`/`0014`/
`0015`**. `npm run typecheck` clean, `npm run test` = **634 pass / 48 files**. `sw.js`
`camp-v47`→`camp-v48`. **No push is actually sent yet** — this release builds the scheduler,
the audience rule, the subscription table and the warning detector; the fan-out is a later phase.

### Scheduled tick — Supabase `pg_cron`, NOT Vercel Cron

- **`GET /internal/cron/tick`** (`src/api/controllers/cron.controller.ts`, registered `auth:false`
  in `router.ts`) sits OUTSIDE the app's auth layer and is guarded by a shared secret instead:
  `Authorization: Bearer <CRON_SECRET>`, compared with `timingSafeEqual`. Two traps are handled
  explicitly and must not be "simplified" away — (1) `timingSafeEqual` **throws** on a length
  mismatch, so `secretMatches` length-checks first (a naive call leaks length as a 500 instead of
  a 401); (2) an **unset** `CRON_SECRET` fails CLOSED, otherwise a misconfigured deploy would let
  anyone fire the tick with an empty bearer. It throws `UnauthorizedError` rather than returning
  an error object, because the adapter only maps thrown errors to a non-200.
  This route needed `HttpRequest.headers` — the type had **no headers field at all** before this
  release (`src/api/http/types.ts`).
- **`makeCronService`** (`src/services/cron.service.ts`) is the tick body. Phase 1-3 scope is job
  B only (create in-app check-in-closing notices). It runs **288 times a day**, so it must be
  cheap when idle: the pure `warnWindow()` gate runs off settings alone and short-circuits before
  the people table is touched. Per-church failures are caught individually (`failed` counter) so
  one bad church cannot abort the rest of the tick, and dedupe detection keys off **SQLSTATE
  `23505`**, never the error message — matching `/dedupe_key/i` on the text would silently swallow
  a "column does not exist" and report success.
- **The scheduler is Supabase `pg_cron` + `pg_net`, not Vercel Cron.** The Vercel plan is
  **Hobby, whose cron is daily-only** — useless for a warning that must fire ~60 minutes before a
  check-in window closes. `vercel.json` is **deliberately unmodified**; do not add a `crons` block
  to it. The schedule lives in migration `0014` so it is in git rather than existing only as
  invisible prod state.

### Migration state (this is the bit that bites)

- **`0013_push_subscriptions.sql` — APPLIED to prod.** `push_subscriptions` table (+ RLS, 2
  indexes) and `notifications.push_sent_at` / `notifications.dedupe_key`. Verified against
  `nwfafrgojqkxylbppywo` after applying; history row reconciled to version `'0013'` (the MCP
  `apply_migration` tool records a generated timestamp — see the `0005` note above, this is still
  required after every apply on this project).
- **`0014_push_cron_schedule.sql` — APPLIED to prod 2026-07-31**, history row reconciled to
  `'0014'`. Both preconditions (route live; `cron_secret` in Vault matching Vercel's
  `CRON_SECRET`) were satisfied AND the secret match was proven by a one-off `net.http_get`
  returning 200 before the schedule was created. See the 2026-07-31 section near the top.
  The warning at the top of the file about silent 404/401s still applies to any future
  re-apply or URL change — `pg_net` is fire-and-forget and `net._http_response` is the only
  place a failure ever shows up.
- **`0015_discount_code_overrides.sql` — APPLIED to prod 2026-07-27**, immediately BEFORE the push
  that merged this whole branch to `master` (see the 2026-07-27 section at the bottom). One
  `settings.discount_code_overrides jsonb not null default '{}'`; verified present, and the history
  row reconciled from the generated timestamp `20260726211058` to version `'0015'`. It had to go in
  first because of the standing rule: **`supabase.settings` writes ALL settings columns on every
  save**, so once the code is live, any settings save (and mode switch, and new-year) fails until
  the column exists.
- **Next migration = `0016`.**
- **Prod drift found, reported, STILL NOT fixed:** migrations `0009`–`0012` are applied but recorded
  under generated timestamp versions (`20260720012415`, `20260723131647`, `20260723131721`,
  `20260723181751`). The schema is correct; only the version labels drifted, because the
  reconciliation step was skipped four times. ⚠ Consequence: a `supabase db push` would consider
  those four **unapplied and try to re-run them**. Deliberately left alone (rewriting four history
  rows is a bigger call than the one row this session introduced) — fix it as its own task.

### `canSeeNotification()` — the single notification-audience rule

`src/services/notification-visibility.ts` — extracted verbatim from `getActorFeed`, which now
calls it (`notification.service.ts:54`). It owns ALL of it: `leadersOnly` filtering (church and
firstAid excluded), zone/church scope, expiry, and the `scheduledFor > now` withholding.
**Do not reimplement any of those rules anywhere else.** The push audience resolver in a later
phase calls this same function, and the whole point of the extraction is that a leader can never
be pushed a notice they cannot see in the app. Note `dashboard.service`'s `latestNotification`
still carries its own duplicate `leadersOnly` filter (pre-existing) — if you touch audience rules,
check that one too.

### `churchesBehind()` / `warnWindow()` — `src/services/checkin-warnings.ts`

Pure, fully tested, **clock injected** (`zonedNow(tz, now)`) so there is no hidden `Date.now()`.
`warnWindow()` is the cheap settings-only gate; `churchesBehind()` does the roster work. Three
traps are baked in and must not be "cleaned up":

1. **"Checked in" is last-entry-wins**, matching `toRosterEntry` in `src/api/dto/person.dto.ts`
   exactly. A student checked in and then out is NOT checked in. Diverge from this and the push
   count disagrees with the roster the leader is staring at.
2. **AC-1**: the first camp day is **PM-only** and the last day is **AM-only**, so there is no
   AM window to warn about on day 1 and no PM window on the last day. This arrives as
   `allowedWindowSession()` returning null, which is easy to mistake for a bug.
3. **Brisbane, not UTC.** `DEFAULT_TZ = 'Australia/Brisbane'` mirrors `checkin.service.ts` and
   must stay byte-identical to it, or the reminder and the enforcement disagree.
   `WARN_LEAD_MINUTES = 60`.

### S2 — check-in queue persistence

`_ciqKey()` / `_persistQueue()` / `_restoreQueue()` (`public/index.html`). `CHECKIN_QUEUE` is now
mirrored to `localStorage` under a **per-account** key (`ycp_ciq_<username>`) on every push/shift,
and rehydrated once at boot (`window._ciqRestored` guard). Two things worth knowing:

- **Initials are captured at QUEUE time, not drain time** (`_queueEntry` stores
  `initials: LEADER_INITIALS`). A rehydrated entry must keep its original author — the ✎ badge may
  have been switched to a different leader before the queue drains.
- **Stale-session entries are DROPPED, with a toast.** On restore, anything whose `sessionId` is
  not the currently-selected session is discarded (its window has closed; the POST would 403) and
  the count is toasted so it can be reconciled against the paper sheet, rather than vanishing.
- ⚠ **Deferred finding — FIXED 2026-07-31 by server-side dedup (see below).** persistence
  introduced a narrow double-submit window. In `drainQueue` the `await` can resolve (server write
  committed) before the sync shift+persist runs; a crash in that one-tick gap replays the entry on
  reboot, and `withCheckIn` had no `(sessionId, camperId)` dedup — so that was a duplicate row in
  the compliance export. Pre-S2 the same crash simply LOST the tap. Displayed state was unaffected
  (last-entry-wins in `toRosterEntry`). The owner chose **server-side dedup** over a client
  idempotency key — `withCheckIn` is now idempotent.

### Discount-code overrides

- **`applyDiscountOverrides(people, overrides)`** (`src/services/budget.ts`, pure + tested) maps a
  discount code to a "paid in full" amount before `computeBudget` runs. SPA mirror
  `_applyDiscountOverrides` / `_saveDiscountOverride` / `_prefillDiscountOverride` on the Budget
  screen; hostile codes go through `esc(jsq())` in the inline handler.
- **New capability `budget:manage` = admin + director ONLY.** Deliberately NOT folded into
  `admin:manage` — widening `admin:manage` would have handed director the entire back office. If
  you need another finance-ish permission, add it beside `budget:manage`; do not widen the admin one.
- **`PATCH /settings/discount-overrides`** (`settings.service.ts`, asserts `budget:manage`); the
  key is present in the Supabase settings `UPDATE_COLS` list (miss that and the save is a silent
  no-op — the same trap as `elvanto_meta` back in migration `017`).

### S5 / S6 (from the launch-readiness list)

- **`assertFieldEncryptionKey()`** (`src/utils/field-crypto.ts`) is now called from `src/app.ts`
  at boot, guarded on `PERSISTENCE === 'supabase'`, right beside `assertSessionSecret()`. A
  missing/malformed key used to boot green and then 500 on every person read — indistinguishable
  from "the app is broken" at camp with no engineer. ⚠ Minor, deferred: the `try/catch` around
  `Buffer.from(raw,'base64')` is dead code (Node never throws on bad base64, it silently drops
  invalid chars) — the 32-byte length check does all the real validation.
- **`_scoped(path)`** (`public/index.html`) appends `?churchId=<ACTOR.churchId>` for church logins
  on `/registrants` and `/campers` reads, so the indexed backend fast-path (`scopedAll` →
  `findByChurch`) stops being dead code in practice. ⚠ It **must** be used for the `api()` call AND
  for any `_allCached()`/`_prefetch()` key for the same resource — `Cache.get` is an exact-key
  lookup, so a mismatch silently disables the prefetch/stale-while-revalidate hit (no error, just
  slower). Follow-up fix in the same batch: deterministic `(last_name, first_name)` ordering on all
  10 people finders, so the scoped and unscoped paths return the same order.

### Four SPA UI changes (owner request, out of plan — commit `6b454d6`)

1. **Floating arrival confirm bar.** `.fd-confirm` was `position:sticky;bottom:10px`, which pins to
   the bottom of the CONTENT, not the viewport — on the phone body-scroll shell that stranded it at
   the end of a long roster. Now `position:fixed`, `z-index:105` (between `.tabs` 100 and `.modal`
   120), with a spacer keeping the last row clear. Same rule as the documented overlay gotcha.
2. **Leaders now appear on the arrival screen.** They were filtered out of BOTH the `/campers` and
   `/registrants` feeds, so a leader missed by the bulk sign-in could not be signed in there at all.
   They badge "Leader" instead of "Yr -" and the grade filter gains a Leaders option. They stay
   excluded from the twice-daily check-in roster — that is a different screen, do not "fix" it.
3. **Incidents moved off the home tile grid** to a slim full-width link, below "Testimonies & Notes"
   and above the Notices summary. **⚠ REVERTED 2026-07-27 — this was a MISREAD of the request.**
   What the owner wanted moved below Testimonies & Notes was the urgent-alert *banner*, not the
   menu tile. Incidents is a tile in the grid again; see the 2026-07-27 section below.
4. **Schedule editor time boxes tightened** — column `80px`→`64px`, gap `8`→`6px`, and the time
   input itself on `--t-xs` with 4px/2px padding, centred. See the CSS gotcha below for why this
   took several attempts.

### ⚠️ CSS GOTCHA — `.sched-row .sr-t` vs `.sched-row .fld` are EQUAL specificity

Both are (0,2,0). The time input carries **both** classes (`<input class="fld sr-t" type="time">`),
so **whichever rule appears LAST in the stylesheet wins** — and a `.sr-t` rule placed ABOVE
`.sched-row .fld` is **silently dead**. That is exactly why three separate attempts to shrink the
schedule time boxes had no visible effect: each one narrowed the grid track while the `.fld`
padding/font below it kept overriding the `.sr-t` sizing, and `overflow:hidden` on
`.sched-row input` hid the overflow instead of the box actually fitting. The `.sr-t` block now
sits **after** `.sched-row .fld` (~line 383 in `public/index.html`) with a comment saying so.
**Keep it there.** If `.sr-t` ever needs to win from anywhere, raise its specificity
(e.g. `input.sr-t.fld`) rather than relying on source order again.

### Also

- `public/sw.js` is now **`camp-v48`** (v45→v46 for the early SPA batch, →v47 for the schedule-time
  fix, →v48 here for the queue persistence + discount-override UI + `?churchId` scoping). Standing
  rule unchanged: `public/index.html` changing means `CACHE` must step, because iOS standalone PWAs
  are documented as lazy about picking up a new worker.
- `API_RE` in `sw.js` was **deliberately NOT extended** with `push` or `internal`. Nothing in the
  SPA calls a `/push` endpoint yet (later phase), and the cron tick is server-to-server — it never
  passes through a service worker.

