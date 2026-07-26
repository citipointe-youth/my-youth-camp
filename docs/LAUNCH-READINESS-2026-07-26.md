# Launch Readiness Assessment — My Youth Camp

**Date:** 2026-07-26 · **Assessed against:** `master` @ `3ab57a4` · **Prod:** https://my-youth-camp.vercel.app
**Launch to real users:** ~2026-08-05 (≈1.5 weeks) · **Camp:** 2026-09-28 → 2026-10-01
**Scale:** ~100 leader accounts (`b-`/`g-` church logins, zone leaders, directors, admin, first-aiders) + a few hundred student records. Peak = twice-daily at-camp check-in inside a 1–2 hour window.

---

## 0. Verdict in one paragraph

The **application** is in good shape — 579 tests, RBAC funnelled through one chokepoint, field
encryption at rest, RLS on every table, a hardened login path, a well-documented change history.
The risk is almost entirely **infrastructure and operational**, and it is concentrated in one
place: **the production DB connection is still on the transaction-mode pooler (port 6543) — the
exact configuration that caused a multi-day outage in the sibling app (YS Connection) at 30–40
users. This app expects 100+, uses a 2.5× larger connection pool (`max: 5` vs CMS's `max: 2`),
has no `/batch` endpoint to cut request fan-out, and loads the entire `people` table plus both
history tables on almost every hot path.** The runbook to fix it already exists
(`docs/SESSION-MODE-CUTOVER.md`) and is a one-env-var change; per that document and CLAUDE.md it
has **not been executed**. Second-biggest: `FIELD_ENCRYPTION_KEY` custody is unverified and the
app does not fail fast if the key is missing or wrong — losing it destroys every medical, contact
and note field permanently, and no backup can recover it.

Upgrading Supabase to paid is **necessary but not sufficient**. It buys `max_connections` headroom
and daily backups; it does not fix the pooler mode, the full-table-scan read pattern, the absent
error alerting, or key custody.

---

## 1. Evidence discipline — what I verified vs what only the owner can check

**Verified in the repo (file + symbol cited throughout below):** pool config, pooler port
expectations, region pin, function duration, query patterns, RBAC tables, RLS migrations, wipe
guards, crypto envelope, rate limiter, service worker, check-in queue, password generator, session
TTL, capability gating.

**NOT verifiable from the repo — owner must open a dashboard.** I did not query the live project
and did not guess. Each of these is a checklist item in §7:

| # | Unknown | Where to check |
|---|---|---|
| U1 | Current Supabase plan (free vs paid) and compute size | Supabase → Settings → Compute & Disk |
| U2 | Actual `DATABASE_URL` **port** in Vercel Production (6543 vs 5432) | Vercel → my-youth-camp → Settings → Environment Variables |
| U3 | Whether `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `CORS_ORIGINS`, `PERSISTENCE=supabase` are all actually set on **Production** | Same screen |
| U4 | Whether `FIELD_ENCRYPTION_KEY` is backed up anywhere outside Vercel | Owner's password manager / offline store |
| U5 | Backup / PITR posture | Supabase → Database → Backups |
| U6 | Supavisor **Pool Size** and `max_connections` | Supabase → Database → Connection Pooling; `show max_connections;` |
| U7 | Whether `alter role postgres set statement_timeout = '15s'` is still applied | `select rolconfig from pg_roles where rolname='postgres';` |
| U8 | Vercel plan (Hobby vs Pro) — governs log retention, concurrency, Fluid Compute | Vercel → Settings → Billing |
| U9 | Whether RLS is genuinely on for all 18 tables in prod today | `select tablename,rowsecurity from pg_tables where schemaname='public';` |
| U10 | Whether the anon key can read any table | `curl <supabase-url>/rest/v1/people -H "apikey: <anon>"` |

---

## 2. Capacity & performance at ~100 concurrent leaders

### 2.1 The pooler mode — THE launch blocker

`src/repositories/supabase/client.ts` configures `max: 5`, `idle_timeout: 10`,
`max_lifetime: 60`, `prepare: false`. `.env.example` and CLAUDE.md both document the production
`DATABASE_URL` as the **transaction pooler on port 6543**.

`docs/SESSION-MODE-CUTOVER.md` exists precisely for this and states the cutover is *"Not yet
done"*. The sibling app's writeup (`Project 7 - Connection Made Simple/…/CLAUDE.md`, section
"✅ RESOLVED — the actual root cause was the pooler CONNECTION MODE") documents the failure mode
in forensic detail:

- On the transaction-mode Supavisor pooler a **newly-established** connection is occasionally TCP-
  connected and authenticated but never answers any query → the request hangs to the client
  timeout. It spikes **exactly when many users arrive at once** (burst of cold starts = burst of
  new connections). That is a literal description of camp AM check-in.
- The downstream death spiral: each timed-out request abandons a backend stuck
  `state='active', wait_event='ClientRead'`; `statement_timeout` cannot reap those; they
  accumulate until the pooler is exhausted and **every endpoint 503s together**.
- CMS also proved that on the **free tier** the binding limit is the Supavisor *client* connection
  cap (`EMAXCONN`, 200), not `max_connections=60`. Total connections ≈ `instances × pool max`.
  CMS **tried `max: 5` (copying this app) and reverted to `max: 2`** because 5 hit the ceiling
  ~2.5× sooner.

This app carries the config CMS proved wrong, at ~3× the user count, with **no `/batch` endpoint**
(I grepped `src/api/http/router.ts` — there is none; CMS shipped one specifically to cut fan-out).
Screen fan-out here is 2–5 requests (`renderHomeAtCamp` = `/home` + `/notifications` +
`/accommodation/church-rooms/:id`; check-in = `/checkin/sessions` + `/checkin/sessions/:id/status`).
Better than CMS's 5–9, but not solved.

**Action:** execute Window 1 of `docs/SESSION-MODE-CUTOVER.md` *now*, then Window 2 immediately
after the paid upgrade. Rollback is the same env var in reverse.

### 2.2 Full-table loads on every hot path — verified

`SupabasePersonRepository.findAll()` (`supabase.people.ts:206`) runs
`select * from people order by last_name, first_name`, then `hydrate()` fires **two more
unbounded queries** — `select * from check_in_history where person_id in (<every id>)` and the
same for `sign_out_history` — then AES-GCM-decrypts ~10 columns per person.

There is **no N+1** (histories are batched — good), but there is a **full-table scan of three
tables per request**. Call sites on hot paths:

| Path | Call | File |
|---|---|---|
| Check-in roster | `personRepo.findAll()` then filter by `canAccessPerson` | `checkin.service.ts:68` |
| Dashboard `/home` (both modes) | `personRepo.findAll()` | `dashboard.service.ts:80`, `:132` |
| Search | `personRepo.search()` → `select * from people` then filters **in JS** | `supabase.people.ts:252` |
| `/campers` | `listCampers` → `scopedAll` → `findAll()` when no `churchId` given | `person.service.ts:150` |
| `/registrants` | `listRegistrants` → `scopedAll` → `findAll()` when no `churchId` given | `person.service.ts:185` |

**The SPA never passes `?churchId`.** I grepped every `api('/registrants')` / `api('/campers…')`
call site in `public/index.html` — all 25+ are unscoped. The `churchId` fast-path in
`listRegistrants` (which *would* use the indexed `findByChurch`) is dead code in practice. The
`?pageSize=300` / `?pageSize=1000` params the SPA sends are **ignored by the controller**
(`camper.controller.ts` reads only `zone`, `churchId`, `q`, `scope`) — there is no pagination.

At ~400 people × 4 camp days the history tables reach ~3,000+ rows; every roster refresh by every
one of 100 leaders drags all of it across the pooler. This is the load the burst test in Window 2
must actually exercise.

**Mitigation, cheapest first:**
1. Make the SPA pass `?churchId=ACTOR.churchId` on `/registrants` and `/campers` for church logins
   (SPA-only change; the backend fast-path already exists and already re-filters through
   `canAccessPerson`, so it is not a security regression).
2. Add a `churchId` filter to `listCampers`' `scopedAll` the same way.
3. Only if needed: restrict `hydrate()` to the current camp's sessions.

None of this is required to launch on 2026-08-05 (pre-camp traffic is light); it is required
before camp week.

### 2.3 Region pin — verified good

`vercel.json` pins `"regions": ["syd1"]`, co-located with the Sydney Supabase project. CLAUDE.md
records that a missing pin previously cost ~1s+ per request. **Do not remove it.** `maxDuration`
is 30s.

⚠ One consequence of `"rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]`: **every**
request including static assets goes through the serverless function (`express.static('public')`
in `express-adapter.ts:83`). The service worker caches assets client-side after first load, so
this mostly costs one cold-start-heavy first visit per device. Acceptable; noted so it isn't
mistaken for a CDN.

### 2.4 The 30s function ceiling vs imports — a real edge

`SupabasePersonRepository.saveMany()` upserts **one round-trip per person** inside a single
transaction, plus up to two `appendHistories` inserts each. A full Form import of ~400 people is
~800–1,200 sequential round-trips to Sydney, plus a preceding `findAll()`, plus serial
`personRepo.delete(id)` for absent rows (`import.service.ts:422`). The SPA allows 90s
(`API_IMPORT_TIMEOUT_MS`) but **Vercel kills the function at 30s** (`vercel.json`). At the current
5 churches this is fine; at the final roster it may not be.

Same shape applies to `POST /import/offline-signin` (bulk sign-in of everyone marked `Y`).

**Action:** do one full-size dry-run import against prod **before** launch, with the real final
roster, and time it. If it approaches 30s, raise `maxDuration` (60s is available) before camp.

### 2.5 Dashboard cache — a genuine correctness bug I found

`src/services/dashboard-cache.ts`:

```js
function _actorKey(actor: Actor): string {
  return `${actor.role}:${actor.churchId ?? '_'}:${actor.zone ?? '_'}`;
}
```

The key **omits `actor.genderScope`**. Since 2026-07-17 every church has *two* logins —
`b-<slug>` and `g-<slug>` — with identical `role`, `churchId` and `zone`, and they differ only by
`genderScope`, which `canAccessPerson` (`person.service.ts:100`) uses to scope the very numbers
the DTO contains. So **`b-victory` and `g-victory` share one 30-second cache entry**: whichever
logs in first populates it and the other sees the first one's gender-scoped figures.

Impact: not raw PII (the DTO is counts + an accommodation summary + `checkInsDue`), but at camp it
means the girls' leader can be shown the boys' "still to check in" number and vice versa, for up
to 30s after any write. The comment directly above the function even states the key "**must**
include actor scope, since the DTO is role/church/zone-scoped and a shared key would leak one
church's data to another" — the gender dimension was added later and the key was not updated.

**Fix:** append `${actor.genderScope ?? '_'}` to the key. One line, ~10 minutes with a test.

### 2.6 Vercel concurrency

Serverless concurrency is not the constraint here — DB connections are. But note Fluid Compute
packing behaviour matters for `instances × 5`: fewer, warmer instances is *better* for this app.
Owner should confirm the Vercel plan (U8) since Hobby vs Pro changes concurrency and, more
importantly for §5, log retention.

---

## 3. Data safety

### 3.1 Backups — the owner must verify, and free tier is not enough

I cannot see the plan from the repo. What matters:

- **Free tier: no scheduled backups you can restore from.** If the DB is corrupted or wiped there
  is no recovery path.
- **Pro: daily backups, 7-day retention.** That is the minimum acceptable posture for real minors'
  data. It means a worst-case loss of up to 24h of check-ins.
- **PITR is a paid add-on on top of Pro.** For a 4-day camp where check-in data is the compliance
  record of which child was present, the case for PITR during September–October is strong.

**Action:** upgrade to Pro before launch; verify a backup actually exists in the dashboard
(don't assume); consider enabling PITR for the camp month only.

**Critical coupling:** a restored backup is only readable with the *same*
`FIELD_ENCRYPTION_KEY`. Back up the key alongside the knowledge that backups exist — see §3.3.

### 3.2 Destructive operations — guards are thinner than they look

Both live in `src/services/admin.service.ts`.

`POST /admin/reset` — deletes people, churches, classrooms, allocations, FAQ, schedule,
notifications, notes, devotionals, overrides, **and every non-admin user account**. Bulk
`deleteAll()` (Supabase: `TRUNCATE`).

`POST /admin/new-year` — purges people/notes/notifications/allocations/overrides and restores the
scaffold from the defaults snapshot.

The shared guard is `assertExportedOrForce(opts)`:

```js
if (opts?.force && opts.confirmWipe === CONFIRM_WIPE_STRING) return;   // ← bypasses everything
if (opts?.force && opts.confirmWipe !== CONFIRM_WIPE_STRING) throw BadRequestError;
const settings = await settingsRepo.getSingleton();
if (!settings?.lastExportedAt) throw new WipeGuardError();
```

Two weaknesses, both real at 100 users:

1. **`lastExportedAt` is a latch, not a freshness check.** Once *any* compliance export has ever
   run — which will happen during camp — the guard passes forever. A bare `POST /admin/reset`
   with no body then wipes production, with no "exported recently" test and no date comparison.
2. **`force: true` + the confirm string bypasses the export check entirely.** The SPA's
   `adminReset()` sends exactly that pair. So the only true barrier in the live product is a
   client-side type-to-confirm modal. Anyone holding the admin token (or crafting a request) can
   `TRUNCATE` production in one call. Role check is `actor.role !== 'admin'` — correct, but the
   admin account is a single shared login.

There is **no soft-delete, no undo, no snapshot-before-wipe**. With Pro daily backups, the blast
radius becomes "up to 24h of data"; on free tier it is "everything, permanently".

**Action (code, ~1–2h):** make the export check compare recency (e.g. `lastExportedAt` within 24h)
and require it *even when* `force` is set, or gate `/admin/reset` behind an env flag that is off
in production during camp season. At minimum, do not launch without backups (§3.1).

### 3.3 `FIELD_ENCRYPTION_KEY` — launch-blocking custody question

`src/utils/field-crypto.ts` implements AES-256-GCM with envelope
`v1.<keyId>.<iv>.<tag>.<ct>`, AAD bound to `"<table>:<column>:<id>"`. Encrypted columns
(`supabase.people.ts` / `supabase.notes.ts` / `supabase.incidents.ts` /
`supabase.notifications.ts`): `medical_conditions_enc`, `dietary_requirements_enc`,
`consents_enc`, `blue_card_expiry_enc`, `other_medications`, `medicare_number`,
`blue_card_number`, `parent_guardian_name`, `parent_phone`, `parent_relation`, `notes.body`,
`incidents.summary`, and leaders-only `notifications.body`.

Consequences, all verified in code:

- **Key lost → data gone.** `SECURITY-ACTIONS.md` §1b says so explicitly, and it is accurate: no
  Supabase backup helps, because the backup contains ciphertext. This is the single most
  irreversible failure available in this system.
- **Key changed without `FIELD_ENCRYPTION_KEY_PREV` → same outcome.** `keyMap()` builds
  `{activeId → key}` plus optionally `{prevId → key}`; `decryptField` throws
  `no key for id '<id>'` for any envelope whose keyId isn't in the map. Rotation *requires*
  setting `_PREV` and re-running `scripts/backfill-field-encryption.ts`.
- **AAD binds ciphertext to the row id.** Any recovery attempt that reinserts data under new ids
  fails the auth tag. Restores must preserve ids.
- **⚠ The app does NOT fail fast if the key is missing.** `assertSessionSecret()` is called in
  `src/app.ts` and refuses to boot a production instance with a forgeable `SESSION_SECRET`.
  There is **no equivalent assertion for `FIELD_ENCRYPTION_KEY`** — I grepped; the only throw is
  inside `keyMap()`, reached lazily on the first encrypt/decrypt. A deploy with a missing or
  malformed key boots green, serves the login page, and then throws
  `"An unexpected error occurred"` on every person read. At camp, with no engineer, that is
  indistinguishable from "the app is broken".

**Actions:**
- **(Owner, 15 min, BLOCKING)** Confirm the key is stored in at least two places outside Vercel
  (password manager + one offline copy), and that someone other than the owner can reach it.
- **(Code, ~30 min, SHOULD)** Add `assertFieldEncryptionKey()` next to `assertSessionSecret()` in
  `src/app.ts`, guarded on `PERSISTENCE === 'supabase'` — decode the key and throw at boot.
- **Do not rotate the key between now and the end of camp.** There is no operational need and the
  procedure requires a full backfill run.

---

## 4. Security posture before real minors' data lands

Broadly solid — RLS, encryption at rest, one RBAC file, no user enumeration, security headers,
CSP, stateless signed sessions. Four things are worth a decision before 100 real accounts exist.

### 4.1 RLS — verified in migrations, must be confirmed in prod

`0002_rls.sql` enables RLS on 17 tables; `0007_incidents.sql:35` covers `incidents` (18 total).
`0009` additionally revokes the public/anon/authenticated EXECUTE grant on Supabase's
auto-provisioned `rls_auto_enable()` and codifies the `ensure_rls` event trigger into tracked
migrations. **No policies exist** — deliberate and correct: the app connects as `postgres` (owner)
and bypasses RLS, so RLS-on + zero-policies means the anon key can read nothing.

Repo state is right. Prod state is item **U9/U10** — run the two checks in `SECURITY-ACTIONS.md`
§4 once before launch.

### 4.2 `MUST_CHANGE_PASSWORD_ENFORCED = false` — acceptable at launch, with a condition

The gate is fully built (`account.service.setPassword` and `admin.service.newYear` set the flag;
`POST /accounts/me/password` clears it; `express-adapter.ts:110` enforces it; the SPA has a gate
screen) and disabled by the owner on 2026-07-11 via **two constants that must be flipped
together** — `src/api/http/express-adapter.ts:18` and the matching one in `public/index.html`
(bump `sw.js` `CACHE` when touching the HTML one).

**Assessment: leaving it off is defensible for this launch** — but only because of how church
passwords are distributed. The `Word.##` passwords generated by "Randomise & export church
passwords" are the *real* handed-out passwords, deliberately never flagged
`mustChangePassword`, so the gate would not fire for the ~90 church logins anyway. It only
affects admin-reset passwords and new-year temp passwords.

**Condition:** it must be true that admin never sets a weak/shared password for a leadership
account. `SECURITY-ACTIONS.md` §6 already records this as required operational discipline. Fine
to launch as-is; not fine to combine with a documented default password.

### 4.3 Church password scheme — quantified, and the mitigation is weaker than stated

`src/utils/memorable-password.ts` generates `Word.##` from a curated list of ~117 nouns × 100
two-digit suffixes ≈ **11,700 combinations**, uniform via `randomInt`. Format is public
knowledge (it's in the repo and obvious from the handed-out CSV).

The stated mitigation is the login rate limiter (`src/utils/rate-limiter.ts`,
`new RateLimiter(10, 15 * 60 * 1000)` in `express-adapter.ts:24`). Its properties, verified:

- Keyed `ip|username` — correct, and a fix for the CMS lockout bug where a shared camp NAT IP
  locked out everyone.
- Counts **failures only**; successful logins never consume budget — correct.
- **In-memory, per serverless instance.** Its own docstring says so: *"on multi-instance hosting
  the effective limit is maxAttempts × instances"*.

That last point is the problem at scale. Under load Vercel may hold tens of warm instances; an
attacker's requests spray across them. 20 instances × 10 attempts / 15 min ≈ **800 guesses/hour
against one known username**, so a specific church login is guessable in roughly a day of quiet
sustained attempts. Usernames are enumerable by construction (`b-<church-slug>` / `g-<church-slug>`).
What sits behind that login: one church's students' medical conditions, medications, parent
contacts, blue card numbers, DOB.

**Assessment:** acceptable *for a short-lived camp with a hard end date*, which is what
CLAUDE.md's review Finding 5 concluded. It is **not** acceptable if these accounts stay live from
2026-08-05 through October — that's ~10 weeks, not a weekend. Two cheap improvements, either of
which restores the margin:

- **Widen the keyspace** — `Word.Word.##` or `Word.###` takes ~11.7k → ~1M+ while staying
  readable/dictatable. `memorablePassword(minLength)` already has the plumbing. ~1h + regenerate
  and redistribute.
- **Deactivate church logins between distribution and camp** — `CampSettings.churchLoginLocked`
  already exists (migration `014`, admin Settings toggle, checked in `auth.service.login` *after*
  the password so a locked account can't be probed). Costs nothing; but it defeats the purpose of
  launching early so churches can log in. Use only if the keyspace isn't widened.

### 4.4 Session TTL 24h — fine, with one caveat

`TOKEN_TTL_MS = 24h` (`auth.service.ts:10`, raised from 12h on 2026-07-23 for the at-camp
re-login-every-morning problem). Sessions are **stateless HMAC** with the full actor embedded, so:

- Deactivating an account, changing a password, or changing a role does **not** revoke live
  tokens — they remain valid up to 24h. This is documented and deliberate (closing it needs a
  per-request DB lookup). `SECURITY-ACTIONS.md` §6 records it.
- Practical consequence to brief the owner on: **if a leader's phone is lost at camp, there is no
  way to log that device out.** Changing the password does not help. This is the one place where
  the trade-off touches child-safety data.

The `churchLoginLocked` / `zoneLeaderLoginLocked` toggles are login-time only, same caveat.

### 4.5 `export:compliance` — verified correct

`src/services/access-control.ts` grants `export:compliance` to **director + admin only**. The
camp-wide audit workbook (all PII, notes, incidents, temp passwords) was previously gated on
`camper:read:sensitive`, which church and zoneLeader hold — that hole was closed 2026-07-17. The
first-aid CSV export is client-side over already-authorised data. `GET /settings` is `auth:false`
but `settings.controller.ts` explicitly strips `lastTempPasswords` and returns only a count.
No action.

### 4.6 `SECURITY-ACTIONS.md` — still-open items

Read in full. Items 1, 1b, 2, 3, 4, 5 are all "verify in a dashboard" — none can be confirmed from
the repo, all are folded into §7. Item 6 documents the disabled `mustChangePassword` gate (§4.2)
and the no-token-revocation-on-password-change behaviour (§4.4) as **currently open, mitigated
only by operational discipline**. Nothing in the file is stale or wrong; item 6's "12h TTL" should
now read 24h.

---

## 5. Operational readiness — what happens when it breaks at camp

This is the weakest area, and unlike §2 it cannot be fixed by a dashboard toggle.

### 5.1 Error visibility: there is none

`src/utils/logger.ts` writes to `console.*`. `error.middleware.ts` logs unhandled errors and
returns a generic `{code:'INTERNAL_ERROR', message:'An unexpected error occurred'}`. That is the
entire observability story:

- **No error tracking** (no Sentry or equivalent), **no alerting**, **no health monitoring**.
  Nobody finds out something is broken except by a leader saying so.
- Logs land in Vercel runtime logs. On Hobby, retention is short; on Pro it's ~1 day / 4h of
  live tail. If a burst fails at 08:15 on day 2 and it's investigated at 20:00, the evidence may
  be gone.
- The user-facing message for *every* server fault is the same generic string, so a leader's
  report carries zero diagnostic signal. CLAUDE.md's own 2026-07-06 Unallocated-FK bug is a case
  study: a foreign-key violation surfaced as "An unexpected error occurred".

**Actions (both cheap, high value):**
- **(SHOULD, ~1h)** Add free-tier Sentry (or equivalent) to `error.middleware.ts` + the SPA's
  `_doFetch` catch. Even bare error counts with a stack turn a silent camp failure into a push
  notification.
- **(SHOULD, ~15 min)** Point an external uptime monitor (UptimeRobot free) at `GET /health` —
  which already exists (`express-adapter.ts:78`) and is auth-free — with SMS/email alerting to
  the owner. This is the single cheapest thing on this entire list.

### 5.2 The offline story — honest assessment: **the app does not work offline**

Camp sites have poor mobile coverage. What actually happens:

**Service worker** (`public/sw.js`, `camp-v43`): `API_RE` matches every API prefix and the fetch
handler **returns early — network-only — for all of them**. The HTML shell is network-first with
cache fallback; other static assets are cache-first. So offline you get **the app shell and
nothing else**: no roster, no student list, no notes, no schedule, no devotional. Every screen
that needs data shows a fetch-failure message.

**Optimistic check-in queue** (`public/index.html:2053`): `const CHECKIN_QUEUE=[]` — a plain
in-memory array. `_queueEntry` pushes and `drainQueue` posts in order; on error it checks
`navigator.onLine` and breaks (waiting for the `online` event) or, if online, **drops the entry**
and increments `_checkinFailed` for the "N check-ins didn't save — tap to retry" banner. The code
comments state this is deliberate ("owner chose banner only"). Consequences:

- The queue is **not persisted**. Reload, tab eviction, or iOS reclaiming a backgrounded PWA
  loses every queued tap *and* the banner that would have reported it. Silent data loss of
  attendance records — which are the compliance artefact.
- The queue only works **if the roster loaded first**. A leader who opens check-in while already
  offline sees an error screen and cannot queue anything.

**What a church leader on a flaky campsite connection actually experiences:** taps stall behind a
20s `AbortController` timeout (`API_TIMEOUT_MS=20000`) with the `#nprog` bar creeping; then
"Request timed out — check your connection and try again." If they reload to fix it, anything
queued is gone.

**The genuine fallback is paper, and it exists and is good.** `src/services/offline-signin.service.ts`
+ `GET /export/offline-signin` produce an ExcelJS workbook of every registered student (First /
Last / Church / Gender / Grade / blank "Signed In?") with a "Sample Student" demo row;
`POST /import/offline-signin` re-parses a filled sheet and bulk-signs-in every row marked exactly
`Y`, matching on First+Last+Church text. That covers **arrival sign-in**. It does **not** cover
the twice-daily check-in, which is the higher-volume at-camp workflow.

**Actions:**
- **(BLOCKING, owner, 30 min)** Print the offline sign-in sheets before camp. Treat them as the
  primary Day-1 fallback, not a curiosity.
- **(SHOULD, code, ~2h)** Persist `CHECKIN_QUEUE` to `localStorage` and rehydrate on boot. This is
  a contained change to `_queueEntry`/`drainQueue` and converts silent loss into eventual
  delivery. Highest value/effort ratio of any code change in this document.
- **(SHOULD, ~1h)** Brief every church leader: *check in on the bus / at the hall where signal is
  known-good; if a row doesn't turn green, tap again; if the banner appears, tap it.*

### 5.3 No engineer present

CLAUDE.md's `docs/SESSION-MODE-CUTOVER.md` marks pooler-orphan cleanup
(`pg_terminate_backend`) as `[human]`. Someone at camp needs to be able to run it. Write the
symptom → command down on paper: *if every screen 503s at once (not just one), open Supabase SQL
editor and run the ClientRead terminate query from the runbook.*

---

## 6. Onboarding ~100 leaders

The mechanics are built and were exercised for real on 2026-07-17/18. The gap is scale.

**Account/password distribution.** `POST /accounts/churches/randomize-passwords` (admin-only) →
`AccountService.randomizeChurchPasswords` regenerates every church login's password, splits any
legacy combined login into `b-`/`g-`, retires the old one, and returns
`{username, church, gender, password}` rows the SPA downloads as CSV. Deliberately never sets
`mustChangePassword`. A same-day bug where a cosmetic `_rAccts()` refresh made a *successful*
export look like a network error was fixed by downloading the CSV **first** (commit `7660ad6`) —
so the response is now the authoritative single copy.

Two scale notes:
- Prod currently has **5 churches → 10 church logins**. Reaching ~100 accounts means creating
  ~40–45 more churches through the Accounts screen (one at a time). Budget real time for this —
  it is manual data entry, not a script. `scripts/split-church-accounts.ts` exists but only
  splits; it does not create.
- **The CSV is the only copy of the passwords.** Losing it means re-randomising *everyone* —
  including churches already onboarded, invalidating passwords already distributed. Store it in
  the password manager, not Downloads.

**Enforced initials.** `enforceInitials()` runs non-dismissibly at login + session restore for
church accounts (item 7, 2026-07-23), with `_ensureInitials()` as a backstop on attributed writes.
Initials persist per-account in `localStorage['ycp_initials_<username>']`, ride into
`CheckInEntry.leaderId` / `SignOutEvent.leaderName`, and appear as a "Leader Initials" export
column. The header `✎` badge is the quick-switch when a different leader takes the device.
**This works only if leaders actually re-tap the badge on a shared phone** — otherwise the audit
trail attributes everything to whoever set it first. Worth one line in the leader briefing.

**iOS PWA install.** Manifest is complete (`standalone`, 192/512 PNG + SVG, `any maskable`).
The login card is a real `<form>` with `autocomplete="username"` / `current-password` and a
feature-detected `navigator.credentials.store` — which **Safari/iOS does not implement**, so on
iPhone the only reliable lever is the native form-submit save heuristic and autofill of an
already-saved credential. Expect some leaders to retype `Donkey.68` daily. The bottom-nav
positioning saga is resolved as of `camp-v43` (full YS Connection body-scroll conversion), but
CLAUDE.md flags that **CSS/layout is never proven by tsc/vitest** — do a real-device pass.

**Web Push is not built.** A design doc is being written separately. Assume no push notifications
at this camp; scheduled notices (`0010`) surface lazily on the next feed fetch, which means a
leader only sees a notice when they open the app.

---

## 7. Pre-launch checklist

> **Verification sweep run 2026-07-26.** Only the code-change items below (B7, B8, S2, S3, S5,
> S6, S7) were checked against the current tree — read the actual source, not comments or
> changelogs. Owner-action items (B1–B6, S1, S4, S8–S13, M1–M3) are dashboard/manual checks and
> were left untouched by this sweep.

### 🔴 BLOCKING — before telling churches the URL (~2026-08-05)

| # | Action | Why | Effort | Who |
|---|---|---|---|---|
| B1 | **Cut the pooler over to session mode** — `DATABASE_URL` port `6543` → `5432` (Session pooler host `aws-…pooler.supabase.com`, user `postgres.<ref>`; **not** `db.<ref>.supabase.co`, which is IPv6-only), then redeploy. Follow `docs/SESSION-MODE-CUTOVER.md` Window 1. | The transaction-mode dead-connection failure caused a multi-day outage in the sibling app at 30–40 users. This app expects 100+. Rollback is the same change in reverse. | 30 min + smoke test | Owner (Vercel dashboard) |
| B2 | **Verify all four prod env vars are set on Production**: `PERSISTENCE=supabase`, `SESSION_SECRET` (64+ hex), `FIELD_ENCRYPTION_KEY` (base64 32 bytes), `CORS_ORIGINS=https://my-youth-camp.vercel.app`. | `SESSION_SECRET` missing = forgeable tokens (app refuses to boot — good). `FIELD_ENCRYPTION_KEY` missing = **boots fine, then 500s on every person read** (no boot assertion). `CORS_ORIGINS=*` only warns. | 10 min | Owner (Vercel dashboard) |
| B3 | **Back up `FIELD_ENCRYPTION_KEY` out-of-band, in two places, one reachable by someone other than you.** | Key lost = every medical/dietary/medication/medicare/blue-card/parent-contact/consent/note/incident field is permanently unrecoverable. No Supabase backup helps — backups contain ciphertext. | 15 min | Owner |
| B4 | **Upgrade Supabase to Pro and confirm a backup exists in the dashboard.** | Free tier has no restorable scheduled backups. `POST /admin/reset` TRUNCATEs everything with a guard that latches open after the first export (§3.2). Real minors' data must have a recovery path. | 20 min | Owner (Supabase dashboard) |
| B5 | **Confirm RLS is on for all 18 tables in prod, and that the anon key returns no rows.** Run both checks in `SECURITY-ACTIONS.md` §4. | Repo migrations are correct; prod state is unverified from here. This is the barrier between a leaked anon key and the whole dataset. | 10 min | Owner (Supabase SQL editor) |
| B6 | **Confirm `alter role postgres set statement_timeout='15s'` is still applied** — `select rolconfig from pg_roles where rolname='postgres';` | The per-connection `statement_timeout` in `client.ts` is not reliably enforced through the pooler (CMS proved a query ran 4+ min despite it). This is the only real ceiling. Must be re-applied if the project is ever recreated. | 5 min | Owner or Claude (read-only + one ALTER) |
| B7 | ✅ **DONE** — **Fix the dashboard cache key** — add `genderScope` to `_actorKey` in `src/services/dashboard-cache.ts`. | `b-<church>` and `g-<church>` currently share a cache entry and see each other's gender-scoped counts for up to 30s (§2.5). Real bug, one line. (Verified 2026-07-26: fixed at `src/services/dashboard-cache.ts:24`, commit `463a519`, regression test `dashboard.service.test.ts:281`.) | 15 min | Code change |
| B8 | **Decide on the church password keyspace.** Either widen `memorablePassword` to `Word.Word.##` / `Word.###` and re-randomise before distribution, or accept ~11.7k with the per-instance limiter for 10 weeks. | ~11.7k keyspace + an in-memory per-instance limiter ≈ 800 guesses/hr against an enumerable username protecting one church's minors' medical data. Fine for a weekend; this is a 10-week exposure (§4.3). **Decide before the CSV is distributed** — changing it after means re-issuing to everyone. | 1h if changed | Owner decision → code change |

### 🟡 SHOULD DO — before camp (2026-09-28)

| # | Action | Why | Effort | Who |
|---|---|---|---|---|
| S1 | **Window 2 of the cutover runbook**: read `max_connections`, `superuser_reserved_connections`, and the Supavisor Pool Size on the paid config; require both ≥ ~2× `(peak instances × 5)`. Then a **staggered** ramp load test toward 100–200 using `loadtest-realistic.mjs`. Clear orphaned `ClientRead` backends afterward. | The burst is the only thing that reproduces the failure. Free-tier numbers measure the wrong config. Do not hammer prod to find the limit. | Half day | Owner + Claude (read-only SQL) |
| S2 | **Persist `CHECKIN_QUEUE` to `localStorage`** and rehydrate on boot. | Today a reload or iOS backgrounding silently discards queued check-ins *and* the banner reporting them. Attendance is the compliance record (§5.2). Best value/effort on this list. | ~2h | Code change |
| S3 | **Add error tracking** (free-tier Sentry or equivalent) in `error.middleware.ts` + the SPA `_doFetch` catch. | Currently the only signal that anything is broken is a leader telling you, and Vercel log retention may have expired by then (§5.1). | ~1h | Code change |
| S4 | **Add an external uptime monitor on `GET /health`** with SMS alerting. | `/health` already exists and is auth-free. Cheapest possible early warning. | 15 min | Owner |
| S5 | **Add `assertFieldEncryptionKey()` to `src/app.ts`** next to `assertSessionSecret()`, guarded on `PERSISTENCE==='supabase'`. | A missing/malformed key currently boots green and then 500s every person read with a generic message — indistinguishable from "the app is broken" (§3.3). | 30 min | Code change |
| S6 | ⚠️ **PARTIAL** — **Scope the hot reads**: pass `?churchId` from the SPA on `/registrants` and `/campers` for church logins, and honour it in `listCampers`. | Every one of those calls currently does `select * from people` + both full history tables + ~10 AES decrypts per person. 100 leaders × a burst = a lot of avoidable pooler traffic (§2.2). (Verified 2026-07-26: the backend half is already done — `scopedAll` in `src/services/person.service.ts:138-153` already branches on `opts.churchId` → `repo.findByChurch`, and both `listRegistrants` (`:170`) and `listCampers` (`:189`) route through it, pre-dating this doc. What's still missing: the SPA. Grepped every `api('/registrants')`/`api('/campers…')` call in `public/index.html` — all 25+ call sites still omit `?churchId`, so the indexed fast-path remains dead code in practice.) | ~3h | Code change |
| S7 | **Harden `POST /admin/reset`**: require a *recent* export (not a latched `lastExportedAt`) even when `force:true`, or env-gate it off during camp season. | The only real barrier today is a client-side modal; the server-side guard latches open after the first export (§3.2). | 1–2h | Code change |
| S8 | **Time a full-size Form import** against prod with the real final roster. If it nears 30s, raise `maxDuration` in `vercel.json` to 60. | `saveMany` is one round-trip per person inside one transaction; the SPA allows 90s but Vercel kills at 30s (§2.4). | 30 min | Owner + code if needed |
| S9 | **Real-device pass on iPhone** (a home-indicator model, both Safari and installed-PWA): bottom nav, check-in session picker at 8+ sessions, full unfiltered roster, confirm modals, login autofill. | CSS/layout is never proven by tsc/vitest — CLAUDE.md's own rule. `camp-v43` is a very recent shell rewrite. | 1h | Owner |
| S10 | **Print the offline sign-in sheets** (`GET /export/offline-signin`) and rehearse the fill-and-upload loop once. | It is the only genuine offline path in the product and it covers Day-1 arrival, the highest-stakes moment (§5.2). | 30 min | Owner |
| S11 | **Write a one-page camp runbook on paper**: who holds the admin password; where the encryption key backup lives; the `pg_terminate_backend` orphan query; "every screen fails at once = pooler, one screen fails = app"; the offline-sheet fallback. | There is no engineer at camp. | 1h | Owner |
| S12 | **Brief leaders**: re-tap the `✎` initials badge when handing the phone over; check in where signal is good; re-tap rows that don't turn green; no push notifications this year. | Initials attribution and the check-in queue both depend on leader behaviour (§5.2, §6). | 30 min | Owner |
| S13 | **Consider enabling PITR** for September–October only. | Pro's daily backups mean up to 24h of check-in loss; check-ins are the record of which child was present. | 10 min + cost | Owner decision |

### 🔵 MONITOR — during camp

| # | Watch | How | Trigger |
|---|---|---|---|
| M1 | **Pooler connections** during the first live AM check-in | `select count(*), count(*) filter (where state='active') from pg_stat_activity;` | Anything approaching the Supavisor pool size, or queries `active` for many seconds |
| M2 | **Orphaned `ClientRead` backends** | The runbook query in `SESSION-MODE-CUTOVER.md` step 4 | Symptom: *every* endpoint 503s together (including login) while `/health` is fine → run `pg_terminate_backend` |
| M3 | **The "N check-ins didn't save" banner** — ask leaders to report it | Verbal / in the leader group chat | Any sighting means real attendance rows were dropped; reconcile against the paper sheet |
| M4 | **Function duration** on `/checkin/sessions/:id/status` and `/home` | Vercel → Observability | Sustained >3–5s means the full-table reads are biting; S6 becomes urgent |
| M5 | **429 login responses** | Vercel logs | A church locked out (10 failures / 15 min / ip+username) — reset their password rather than waiting the window out |
| M6 | **Supabase disk / egress** on the new plan | Supabase dashboard | Full-table reads × 100 leaders × 4 days is the egress driver |
| M7 | **Any `INTERNAL_ERROR` cluster** | Sentry if S3 shipped, else Vercel logs (short retention) | Investigate immediately — the generic message means the leader's report carries no signal |

---

## 8. Where this app differs from the YS Connection precedent, at 100 users

The 30–40-user launch on the same stack worked. The differences that matter:

| Dimension | YS Connection | My Youth Camp | Consequence |
|---|---|---|---|
| Pooler mode | **Session (5432)** — after a multi-day outage forced it | **Transaction (6543)** — cutover documented, not done | The single biggest risk. B1. |
| Pool `max` | 2 (5 was tried and **proven wrong**) | **5** | 2.5× faster to hit the Supavisor client cap under burst |
| Request fan-out | `GET /batch` composes a whole screen into one request | No batch endpoint; 2–5 requests per screen | More invocations → more instances → more connections |
| Users | 30–40 | ~100 | Burst is ~3× larger |
| Usage shape | Weekly, spread out | **Twice daily, 100 leaders inside 1–2 hours** | Arrival concentration is the exact trigger CMS identified |
| Connectivity | Church building WiFi | **Campsite, poor mobile coverage** | The offline gap in §5.2 actually bites here |
| Data sensitivity | Attendance | **Minors' medical, medications, Medicare numbers, blue cards, parent contacts, incidents** | Raises the cost of every failure; drives the encryption-key and backup items |
| Encryption at rest | No equivalent key-loss cliff | `FIELD_ENCRYPTION_KEY` — irreversible if lost | B3 |
| Login limiter | Fixed after a lockout incident (ip+account, 30/15min) | Already ip+username, failures-only, 10/15min | Fixed here **before** the incident — good; but still per-instance (§4.3) |

The one thing this app got right that CMS learned the hard way: the login rate limiter was
re-keyed to `ip|username` *before* launch, so a shared campsite NAT will not lock out the whole
site. That failure alone consumed days at CMS.

---

_Assessment is read-only: no source file, migration, configuration or deployment was changed._
