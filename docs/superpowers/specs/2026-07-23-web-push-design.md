# 2026-07-23 — Full Web Push + proactive check-in-window warnings (design + implementation plan)

**Status: DESIGN ONLY — not approved for implementation.** Written after the 2026-07-23 batch
shipped (items 1-9,11). Covers the two things deliberately deferred from that batch:

- **Item 10** — automatically notify a church ~1 hour before its daily check-in window closes if
  its check-ins aren't done, including the number still remaining for that session.
- **Full Web Push** — the delivery channel item 10 needs to reach a phone whose app is closed.

Owner asked specifically for risk analysis (privacy, performance, pros/cons). This doc ends with a
phased implementation plan to convert into a `writing-plans` plan once approved.

---

## 1. Why this is a separate project

The app is **serverless (Vercel functions) with no scheduler and no push infrastructure today**
(verified: `vercel.json` has no `crons`; no VAPID keys, no `PushSubscription` storage, no
service-worker `push` handler anywhere). Item 9's scheduled notices sidestep both by **lazy-firing**
— they only need to appear the next time someone opens the app. Item 10 is fundamentally different:
it must reach a church **that is NOT looking at the app** (that's the whole point of a "you're
behind" nudge). That requires two new capabilities:

1. **A scheduler** that runs server-side on a clock, unattended → **Vercel Cron**.
2. **A delivery channel that reaches a closed app** → **Web Push** (VAPID + the Push API).

Neither exists, both carry real risk (especially privacy, given the audience includes minors), so
they get designed properly rather than rushed overnight.

---

## 2. Architecture overview

```
Vercel Cron (every 15 min)  ──►  GET /internal/cron/checkin-warnings   (secret-guarded)
                                     │
                                     ├─ for each church behind on the CURRENTLY-CLOSING window:
                                     │     • create an in-app Notification (always — the reliable path)
                                     │     • send a Web Push to that church's subscriptions (best-effort)
                                     │
service worker `push` event  ──►  showNotification(title, body)  ──►  user taps  ──► focus app /notices
```

Two independent layers, each useful on its own:

- **Layer A — the scheduler + the "who is behind" query + the in-app notice.** This alone delivers
  item 10's *content* (the church sees "3 students still to check in — window closes at 12:00" the
  next time they open the app, and it's an urgent in-app notice). No push, no new PII. Low risk.
- **Layer B — Web Push** turns that same event into a **lock-screen notification** on a closed app.
  Higher value, higher risk. Layered on top so Layer A keeps working even if a device never grants
  push permission.

**Recommendation: build Layer A first (own PR), then Layer B.** Layer A is ~80% of the user value
at ~20% of the risk.

---

## 3. Layer A — scheduler + "behind" detection + in-app warning

### 3.1 Vercel Cron
Add to `vercel.json`:
```json
"crons": [{ "path": "/api/internal/cron/checkin-warnings", "schedule": "*/15 * * * *" }]
```
Vercel Cron hits the path on schedule. **Guard it**: Vercel sends `Authorization: Bearer
$CRON_SECRET` (env var); the handler 401s without it. Route is `auth:false` at the app's normal
auth layer but gated on the cron secret instead (mirrors how a webhook would be handled). The
handler is idempotent and cheap.

### 3.2 "Which churches are behind, and by how much"
Pure function `churchesBehind(settings, people, now, windows)` in a new
`src/services/checkin-warnings.ts` (unit-tested, no I/O):
- Only when at-camp and today is a camp day and `now` is within `warnLeadMinutes` (default **60**)
  of a window's **end** (reuse `checkinWindowAm/PmEnd` from item 11).
- Determine the session that's closing (`${today}~am` or `~pm`).
- For each church: `remaining = (atCamp, non-leader, canAccess church) students without a check-in
  for that session`. Emit `{ churchId, churchName, sessionLabel, remaining, windowEnd }` for
  churches with `remaining > 0`.

### 3.3 De-duplication (critical — the cron runs every 15 min)
Without a guard, a church gets 4 identical warnings in the last hour. Store a per-(church, session)
"already warned" marker. Cheapest: a `warned_checkin_sessions` set — either a small table
`(church_id, session_id, warned_at)` or a JSONB column on `settings` (mirrors `last_temp_passwords`).
The cron skips a church already warned for the current session, and the markers are cleared on
new-year/reset and when the mode leaves at-camp. **Send at most one warning per church per session.**

### 3.4 The in-app notice
Reuse the existing `Notification` machinery: create an **urgent, church-scoped** notice
(`scope:'church'`, `churchId`, `priority:'urgent'`, title e.g. "Check-ins closing soon", body
"3 students still to check in — the morning window closes at 12:00"). This lights up the existing
urgent-notice UI and the church sees it on next open. `senderRole` = a synthetic system sender (like
incident alerts). **This is the always-on path; Layer B is additive.**

### 3.5 Risk (Layer A)
- **Privacy:** none beyond what the app already stores — no new PII, no device identifiers. The
  notice body carries a count, not names. ✅ Lowest-risk path.
- **Performance:** one cron every 15 min, each run is one `people` scan + a handful of inserts;
  negligible. The dedup guard bounds writes to ≤1 per church per session.
- **Cost:** Vercel Cron on the current plan — confirm the plan's included cron invocations
  (every-15-min = 96/day) before enabling.

---

## 4. Layer B — Web Push (VAPID)

### 4.1 Pieces
1. **VAPID keypair** (`web-push` lib or WebCrypto). Public key shipped to the client; **private key
   in an env var** (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT=mailto:...`).
2. **Client subscription:** on an explicit **opt-in** ("Get check-in reminders on this device"),
   `serviceWorker.ready → pushManager.subscribe({userVisibleOnly:true, applicationServerKey})`. POST
   the subscription (endpoint + p256dh + auth keys) to `POST /push/subscribe`.
3. **Storage:** new table `push_subscriptions (id, user_id, church_id, endpoint UNIQUE, p256dh_enc,
   auth_enc, created_at, last_ok_at)`. **The p256dh/auth secrets are encrypted at rest** via the
   existing `field-crypto.ts` (same AAD pattern as other sensitive columns). RLS: a row is readable
   only by admin/service — never exposed to other church logins.
4. **Service worker** (`public/sw.js`): add `push` (parse JSON → `showNotification`) and
   `notificationclick` (focus/open the app at `/` or the Notices tab) handlers. Bump `CACHE`.
5. **Sender:** in the cron handler, after creating the in-app notice, look up the church's
   subscriptions and send via `web-push`. **Prune 404/410 endpoints** (expired subscriptions) on
   send failure so the table self-cleans.
6. **Unsubscribe:** a settings toggle → `pushManager.getSubscription().unsubscribe()` +
   `DELETE /push/subscribe`.

### 4.2 Privacy & safeguards (this is the important part — audience includes minors)
- **Explicit opt-in only.** Never call `Notification.requestPermission()` at load; only on a
  deliberate tap, with copy explaining what will be sent. iOS additionally requires the PWA to be
  **installed to the home screen** before web push works at all (document this limitation).
- **No minor PII in payloads.** Push bodies carry a **count + session + time**, never a student
  name. A push payload transits Apple/Google/Mozilla push services — treat it as untrusted transport
  and put nothing identifying in it. The full detail stays behind the authenticated in-app notice.
- **Subscription = capability, not location.** Store the minimum (endpoint + keys, church + user
  linkage). Encrypt the keys at rest. Don't log endpoints.
- **Scope to leadership/church operational accounts only** (who need the nudge). First-aid and
  student-adjacent contexts don't get push.
- **Consent & retention:** clear on logout is optional (a subscription is device+account bound);
  definitely purge on new-year/reset and when an account is deleted. Provide an in-app off switch.
- **Data-protection framing:** subscriptions are personal data of the *leader's device*, not the
  minors — but because the app's whole domain is minors, keep the payload content policy strict
  (counts only) and document the opt-in + retention in whatever privacy notice the org uses.

### 4.3 Performance
- Fan-out is tiny (churches × devices, tens not thousands) and runs in the cron function, off the
  user request path. `web-push` calls are independent HTTP POSTs — fire with a bounded
  `Promise.allSettled`, cap concurrency, tolerate partial failure.
- Serverless cold-start on the cron is irrelevant (no user waiting).
- Endpoint pruning keeps the table from accumulating dead subscriptions.

### 4.4 Pros / cons vs the lazy in-app model
| | Lazy in-app (item 9 model) | Web Push (Layer B) |
|---|---|---|
| Reaches a closed app | ❌ only on next open | ✅ lock-screen |
| New infra | none | VAPID + subscription table + SW handlers + cron |
| Privacy surface | none new | device subscription (PII of the device), payload via 3rd-party push services |
| iOS support | full | only when installed as a PWA; older iOS flaky |
| Failure mode | benign (shows later) | silent (no permission / expired sub) — **must** keep Layer A as backstop |
| Effort | shipped | moderate; most risk is privacy/consent, not code |

**Conclusion:** Web Push is worth it *specifically* for item 10's "before the window closes" timing,
but only as an enhancement over the always-on in-app notice — never the sole channel.

---

## 5. Implementation plan (phased — convert to a writing-plans plan on approval)

1. **Layer A infra:** add the cron entry + `CRON_SECRET`; `src/api/controllers/cron.controller.ts`
   (secret-guarded); route `GET /internal/cron/checkin-warnings`. No behaviour yet — return a stub +
   a test that a missing/incorrect secret 401s.
2. **Pure detection:** `src/services/checkin-warnings.ts` `churchesBehind(...)` + `checkin-warnings.
   test.ts` (in-window-of-close vs not, remaining count per church, non-camp-day = none, leaders
   excluded, respects `warnLeadMinutes`).
3. **Dedup + in-app notice:** wire detection → per-(church,session) warned-marker (JSONB on settings
   or a small table + migration) → create urgent church-scoped `Notification`. Tests for
   "one notice per church per session" and marker reset on mode-leave/new-year. **Ship Layer A.**
4. **VAPID + storage:** `web-push` dep; `VAPID_*` envs; `push_subscriptions` table + migration
   (keys encrypted via `field-crypto`); `POST/DELETE /push/subscribe`; repo + tests.
5. **SW + client opt-in:** `sw.js` `push`/`notificationclick`; a settings/home opt-in toggle that
   subscribes/unsubscribes; bump `CACHE`. Manual device verification (owner).
6. **Sender + pruning:** cron handler sends `web-push` to a church's subs after the in-app notice;
   prune 404/410. Test the pruning path with a mocked sender.
7. **Docs:** CLAUDE.md + debug.md sections; privacy/opt-in note for the org.

**Gate before Layer B:** confirm the org is comfortable with the opt-in privacy posture and that the
Vercel plan includes the cron + push volume.

---

## 6. Open questions for the owner (raise before implementing)
- `warnLeadMinutes` = 60 confirmed? (Owner said "an hour before".)
- Who receives it — the church account only, or also the zone leader / director for that church?
- Is an **in-app-only** item 10 (Layer A) acceptable as the first deliverable, with Web Push (Layer
  B) as a fast follow, or must the very first ship include lock-screen push?
- Comfort with the opt-in + counts-only-in-payload privacy posture given the minor audience.
