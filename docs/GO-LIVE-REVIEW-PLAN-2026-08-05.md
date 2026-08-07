# Go-live review plan — written 2026-08-05

**Upgrade to Supabase Pro:** 2026-08-06 (tomorrow) · **Church-facing launch:** Sat 2026-08-08
· **Camp:** 2026-09-28 → 2026-10-01 · **Prod:** https://my-youth-camp.vercel.app

Companion to `LAUNCH-READINESS-2026-07-26.md` (which is now partly stale) and
`SESSION-MODE-CUTOVER.md`. This file records what was **verified live** on 2026-08-05, what
the research says, and the order to do things in.

---

## 0. Scope — three events, and Saturday is the mildest of them

Corrected by the owner 2026-08-05. Settings in prod read `camp_mode = 'pre-camp'`,
`start_date = 2026-09-28`. The data and the accounts **already exist** — Saturday is a
**credential handout**, not a data launch.

| | Sat 2026-08-08 | Weeks between | Mon 2026-09-28 |
|---|---|---|---|
| What happens | ~100 leaders get passwords, log in, **look around** | Admin/finance work; leaders drift in and out | Leaders hit sign-in / check-in for real |
| Writes | Essentially none | Imports, allocation, budget edits | Every leader writing, concurrently |
| Load | ~100 logins spread over hours — trivial | Trivial | The burst that took down the sister app |
| Dominant risk | **Can't log in** · **sees the wrong thing** | Silent data/money errors | **Connection exhaustion** |

**Saturday's failure modes are login and visibility, not load and not data loss.** A leader who
can't get in phones you; a leader who *can* get in and sees another church's medical notes is a
privacy incident. Nothing else on Saturday has real teeth — there are no writes to lose, and
the connection maths does not bite at 100 logins spread over a morning.

That reorders everything below. The heavy items — budget reconciliation, import timing,
destructive-path gating, the burst test — are **not Saturday blockers**. They are still real,
they just belong to the weeks after.

The one thing that must still happen **tomorrow** is anything requiring **downtime**, because
downtime is free today and awkward once ~100 people have the URL.

---

## 1. Verified live state (2026-08-05, evidence not assumption)

| Check | Result |
|---|---|
| Repo | `HEAD = c751bde`, working tree **clean** |
| `npm run typecheck` | **clean** |
| `npx vitest run` | **990 pass / 61 files**, 0 fail |
| Supabase project | `nwfafrgojqkxylbppywo`, `ACTIVE_HEALTHY`, PG 17.6, `ap-southeast-2` |
| `max_connections` | **60**, `superuser_reserved_connections` **3** → 57 usable |
| Current connections | 17 baseline |
| `statement_timeout` on role `postgres` | **`15s` — applied and present** (launch-readiness B6 ✅) |
| RLS | **on for all 20 public tables, 0 policies** → deny-all to anon/PostgREST (B5 ✅) |
| Security advisors | Only `rls_enabled_no_policy` INFO (expected — this app is direct-connection) + one WARN: `pg_net` installed in `public` |
| `cron.job` | 1 job, `*/5 * * * *`, **active** |
| `net._http_response` | **72 × 200, 0 non-200** in the pg_net retention window — the tick is genuinely firing (N3 ✅) |
| Data | 287 people, 68 users, 29 churches, 236 invoices, DB **16 MB** |
| Money completeness | `amount_paid is null`: **0** · `accommodation_kind is null`: **0** |
| `check_in_history` | 0 rows (expected pre-camp) |
| `push_subscriptions` | **0 rows** |

Reads well. The problems below are all in what is *not* covered by any of that.

---

## 2. Findings — ranked by consequence

> ## ✅ F1 + F2 RESOLVED 2026-08-07 — read this before the two sections below
>
> Upgraded to **Pro**, compute **Nano → Micro**, Supavisor **Pool Size 15 → 30**, app pool
> **`max` 5 → 3**. `statement_timeout=15s` survived both the plan upgrade and the compute
> restart; `/ready` came back `db:"ok"` in 21ms after the resize.
>
> **F1 was confirmed exactly as predicted: `max_connections` is STILL 60 on Micro** — the plan
> upgrade bought backups and no auto-pause, not capacity. **But the binding constraint turned
> out to be the Supavisor Pool Size, not `max_connections`:** at the 15/5 default only
> **3 Vercel instances** could be served at once. It is now **10** (30/3).
>
> Owner's decision: **run the leaders' day on Micro + 30/3, reassess at the September load
> test.** If that test wants more headroom the move is **Small + pool 50**, not a smaller
> `client.ts max`. Full numbers in `docs/SESSION-MODE-CUTOVER.md`.

### 🔴 F1 — Upgrading to Pro does NOT buy connection headroom. Micro = 60, same as Nano.

Supabase's own table: **Nano 60 / Micro 60 / Small 90 / Medium 120**
([compute-and-disk docs](https://supabase.com/docs/guides/platform/compute-and-disk)). Pro does
not auto-upgrade compute — *"compute sizes are not auto-upgraded because of the downtime
incurred."* So tomorrow's upgrade buys **backups, no inactivity pause, PITR eligibility, email
support** — and **zero extra connections**.

`SESSION-MODE-CUTOVER.md` step 6 says *"`max_connections` scales with compute — this is the
number that matters."* True, but it scales with **compute**, not with **plan**, and nothing in
the plan upgrade changes it. If that runbook is followed literally tomorrow it will read 60,
same as today, and the gate will look like it passed.

**A compute change costs <2 min downtime.** That is free today, awkward Saturday, and
unacceptable on 28 Sep. **Decide the compute size tomorrow, in the same maintenance window as
the plan upgrade** — not in September.

### ✅→🔴 F2 — CORRECTED: the session-mode cutover IS done. That makes F1 sharper, not milder.

**Owner confirmed 2026-08-05: `DATABASE_URL` ends in `:5432`.** B1 is done. Since the app is
serving traffic, it must be the *Session pooler* host (the Direct connection on 5432 is
IPv6-only and would fail on Vercel).

> **An earlier draft of this document inferred the opposite and was wrong.** The reasoning was
> that Supavisor backends 1h33m old contradicted `client.ts`'s `max_lifetime: 60`. That
> inference is invalid: **Supavisor maintains its own pool of Postgres backends in *both*
> modes**, so backend age says nothing about the client-side mode. Recorded here so nobody
> re-derives it. The stale comment in `src/repositories/supabase/client.ts` still describing
> the transaction pooler is worth fixing, but it is documentation drift, not evidence.

**Why this raises the stakes on F1 rather than closing them out.** Session mode holds a
dedicated Postgres backend per app connection instead of multiplexing. With `max: 5` per
instance:

```
peak_app_connections  =  (peak warm Vercel instances) × 5
```

Against **57 usable connections (60 − 3 reserved)** that is **~11 warm instances before
exhaustion** — and the Supavisor **Pool Size** (default ~15 on Nano/Micro) very likely bites
first. So the app is *already* in the configuration whose ceiling is the thing to worry about,
and upgrading to Pro **does not raise that ceiling** (F1: Micro = 60, same as Nano).

**This is now the single open technical question for camp**, and it has to be settled in
tomorrow's window because the fix (compute size) needs downtime:

1. **[you]** Read the Supavisor **Pool Size** (Supabase → Database → Connection Pooling).
2. Do the arithmetic above against it and against `max_connections`.
3. If the margin isn't ~2×, the levers in preference order are: **raise compute to Small
   (90 connections)** → **lower `idle_timeout`** → **lower app `max` from 5 toward 3**
   (*not* to 1 — `client.ts` records that it caused head-of-line blocking).

None of this threatens Saturday. 100 logins over a morning will not approach the ceiling.

### 🔴 F3 — Backups are not retroactive, not instant, and PITR only protects forward

Pro gives **7 days of daily backups**; PITR (7-day window) is a **paid add-on** and, critically,
**only covers the period after it is switched on**. Restores incur downtime and the project is
inaccessible during them.

Two consequences:

1. **The moment you click "upgrade" you do not have a backup.** The first daily backup runs on
   Supabase's schedule. Launch-readiness B4 says *"confirm a backup actually exists"* — that
   confirmation is a **separate step, possibly the next day**, not part of the upgrade.
2. **Take your own `pg_dump` before the upgrade and again before Saturday.** 16 MB — it costs
   seconds. This is the only backup that exists under your control on a timeline you chose.

This is not theoretical here: **production was emptied by the new-year rollover on 2026-08-04**
(CLAUDE.md, "THE NEW-YEAR ROLLOVER EMPTIED PRODUCTION"), 24 hours before this was written, on a
tier with no restorable backups. Recovery worked, but it worked because someone had a copy.

### 🟠 F4 — `/health` does not touch the database

`src/api/http/express-adapter.ts:92` — `/health` returns `{status:'ok'}` with no DB call. It is
a **liveness** probe, not a **readiness** probe. An external uptime monitor pointed at it
(launch-readiness S4) will stay **green through a total pooler outage** — precisely the failure
this whole plan is trying to catch early.

Fix is small: a readiness route that runs `select 1` with a short timeout, and point the monitor
at that instead.

### 🟠 F5 — No error tracking, still (S3)

No Sentry/equivalent in `src/api/middleware/error.middleware.ts` or the SPA `_doFetch` catch.
From Saturday, **the only signal that anything is broken is a church ringing you** — and
churches under-report. On a launch weekend that is the difference between a 20-minute problem
and a Monday-morning problem. This is a couple of hours of work and it is the highest
value-per-hour item on the list.

### ⬜ F6 — Destructive-path gating — RAISED AND DECLINED (owner, 2026-08-05)

`POST /admin/reset` TRUNCATEs and the server guard latches open after the first export, so the
real barrier is a client-side modal. Raised because the rollover destroyed production on
2026-08-04.

**Owner's call: not worth gating — the app's export/snapshot features provide enough recovery
cover.** That is consistent with how the 2026-08-04 incident was actually recovered. Closed;
not carried forward.

Single residual note, not an argument to reopen: **that cover is export-based, so it is only as
fresh as the last export.** Supabase's own daily backups don't exist until tomorrow's upgrade
and the first scheduled run after it (F3).

### 🟡 F7 — Migration version labels drifted (N6)

`0009`–`0012` are recorded in prod under generated timestamp versions. Schema is correct; only
the labels are wrong. It matters because it makes `supabase db push` reasoning unreliable — and
the moment you need that is under pressure, mid-incident. Reconcile it while nothing is on fire.

### 🟠 F9 — The login throttle is keyed on IP + username, and a church is a SHARED login

`express-adapter.ts:38` — `new RateLimiter(10, 15 * 60 * 1000)`, keyed
`${req.ip}|${username}` on **failures only**. The comment shows the camp-venue NAT case was
already thought through (all leaders behind one WiFi IP, hence the username in the key rather
than a bare IP bucket).

The Saturday case is the one that isn't covered: a church login is **shared by several leaders**
(58 church accounts for ~100 leaders, split by gender). If several leaders of the same church
fumble the same password **from the same building's WiFi**, they share one IP+username bucket —
**10 failures locks that church out for 15 minutes.** Password-handout day is exactly when
fumbled passwords cluster.

Two things soften it: the limiter is **in-memory per lambda instance**, so failures spread
across instances don't accumulate reliably, and leaders on mobile data have their own IPs.

**Resolved 2026-08-05 (owner): raised 10 → 15.** The window stays 15 minutes and the
failures-only keying is unchanged. 15 still leaves a real brute-force backstop against the
~117k keyspace (widened 2026-07-31) while absorbing a shared login's normal fumbling. Comments
in `express-adapter.ts` and `rate-limiter.ts` updated to explain *why* the number is what it is,
so it doesn't get "tidied" back down.

Still brief whoever fields Saturday's calls: the symptom is **HTTP 429 / "Too many login
attempts"** and it clears itself in 15 minutes (R12).

### 🟢 F10 — VERIFIED FINE: the forced-password-change gate is off, which is correct here

Worth recording because it *looks* like a Saturday landmine and isn't.
`MUST_CHANGE_PASSWORD_ENFORCED = false` in **both** `express-adapter.ts:32` and
`public/index.html:1142`, and prod confirms **`must_change_password = 0` across all 68
accounts**. That is the right setting for shared logins: a forced change on a shared church
account would let whichever leader logged in first **lock out every other leader in that
church**. Do not flip it back on before camp.

Also verified in prod: all 68 accounts `active`, **0 with a null/empty password hash**, and all
58 church accounts carry a `gender_scope`. So the accounts are genuinely ready for a handout.

### 🟡 F8 — Push has zero subscribers and iOS adoption is the stated top risk

`push_subscriptions` = **0 rows** in prod. The infrastructure is proven (72 clean ticks), the
audience is nobody. On iOS there is no permission prompt at all until the app is installed to
the Home Screen. Per `DEPLOY-NEXT-STEPS-2026-07-30.md` the plan is to handle this at the
pre-camp training day — fine, but it means **nothing safety-critical can depend on a push
arriving**, and Saturday's comms should not promise alerts.

---

## 3. The reviews to conduct, in priority order

Each is scoped to be finishable, with a stated pass condition.

| # | Review | Why it earns its place | When |
|---|---|---|---|
| **R1** | **Production config & secret audit.** Enumerate every Vercel Production env var and confirm: `PERSISTENCE=supabase`, `DATABASE_URL` (**and its port** — F2), `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` (+ backed up out-of-band, two places, one reachable by someone else), `CORS_ORIGINS` locked, `CRON_SECRET` matching the Vault secret, VAPID trio. Confirm nothing changed after the plan upgrade. | Config, not code, is the dominant cause of small-app launch failures — and the app's own history has two: a VAPID key that was never a key, and a public-repo secret exposure. Launch-readiness B2/B3. | **Tomorrow, before and after the upgrade** |
| **R2** | **Connection & pooler review.** Read Supavisor Pool Size + `max_connections`; decide transaction vs session mode; decide compute size; do the headroom arithmetic. | F1 + F2. This is the one decision whose window closes tomorrow, because it needs downtime. | **Tomorrow** |
| **R3** | **Backup & restore rehearsal.** Manual `pg_dump` before the upgrade. After the upgrade, confirm a Supabase backup **exists** (not just that the feature is enabled). Then actually **restore it somewhere** and check row counts. Decide on PITR for Sept–Oct. | F3. An unrehearsed restore is a hope, not a control. You've already needed one this week. | **Tomorrow + confirm next day** |
| ~~R6~~ | ~~Credential handout rehearsal~~ | **Done by the owner (2026-08-05)** — a password from the exported sheet was used to log in successfully. The artefact ~100 people receive is proven. | ✅ |
| **R9** | **Observability review.** ✅ **`/ready` shipped and an external uptime monitor is LIVE against it (2026-08-05).** F4 closed. ⬜ Error tracking (F5) deliberately deferred to after Saturday — adding a dependency to the serverless bundle days before the handout is the risk, not the work. | The monitor half was the part that mattered for Saturday: it answers "is the app reachable and is the DB behind it alive". Sentry answers a different question (errors *inside* a working app) and can wait. | **Monitor ✅ · Sentry after Saturday** |
| **R12** | **Login-throttle briefing.** Not a code change: make sure whoever fields Saturday's calls knows that repeated wrong passwords from one church return **429 / "Too many login attempts"** and clear in 15 minutes. | F9. Turns a confusing outage report into a 30-second answer. | **Before Saturday — five minutes** |
| ~~R4~~ | ~~Destructive-path gating~~ | **Declined by the owner** — export/snapshot cover is considered sufficient. See F6. | Closed |
| ~~R5~~ | ~~Budget/invoice reconciliation~~ | **Descoped** — the owner considers the budget figures good enough to reconcile against as they stand. Leaders browsing never see finance, so it was never a Saturday item. | Closed |
| ~~R7~~ | ~~Privacy & permission review~~ | **Done by the owner (2026-08-05)** — church scope isolation confirmed on real devices. | ✅ |
| ~~R8~~ | ~~Real-device / first-run pass~~ | **Done by the owner (2026-08-05)** — supersedes the S9/N4 backlog. | ✅ |
| **R10** | **Runbook & rollback review.** One page, on paper: who holds the admin password, where `FIELD_ENCRYPTION_KEY` is backed up, the pooler-rollback env change, the `pg_terminate_backend` query, "all screens fail together = pooler", the offline sign-in sheet fallback. | No engineer is at camp. S11. | **Before camp** |
| **R11** | **Burst load test** — `SESSION-MODE-CUTOVER.md` Window 2, staggered ramp to 100–200, watch `pg_stat_activity`, clear orphaned `ClientRead` backends after. | The camp failure mode. **Deliberately deferred to ~mid-September** — it proves nothing about Saturday and hammering prod is what degraded the sister app's pooler. | **~2 weeks before camp** |

---

## 4. What the research changed

Sources at the bottom. Three things moved:

1. **"Upgrade to Pro" was doing more work in the plan than it can carry.** It was implicitly
   the answer to the capacity question. It is not — it is the answer to the *durability*
   question (backups, no pause). Capacity is a **compute size** decision, and a separate
   downtime event. → F1, R2.
2. **The generic serverless failure list matches this app's specific weak points.** Cold-start
   connection churn, function timeouts under `maxDuration: 30`, and pool exhaustion are the
   documented classics — and this app has `maxDuration: 30` with a per-person-round-trip
   `saveMany` (launch-readiness S8, still open, still untimed against prod). A full-size Form
   import on Saturday is the realistic way to hit a 30s kill. **Time one import against prod
   before Saturday**; raise to 60s if it lands anywhere near 30.
3. **Backups have a warm-up period and PITR is forward-only.** The naive reading — "upgrade
   Friday, protected Saturday" — is wrong on both counts. → F3, R3.

The broader pattern in the launch-failure literature, and the reason R1/R5/R6 outrank the
clever engineering: **small-app launches fail on configuration and data, not on load.** Load is
what fails at *scale*, which for this app is 28 September, not 8 August.

---

## 5. Suggested order

**Tomorrow (2026-08-06) — the downtime window:**

1. `pg_dump` production. Store it off-machine. *(R3)*
2. Read and record: Supavisor Pool Size, `max_connections`, current baseline conns. *(R2)*
3. Upgrade the plan to Pro.
4. **Decide and apply the compute size in the same window** if the R2 arithmetic says Micro's
   60 is not enough. *(F1)*
5. Check `DATABASE_URL`'s port. Cut to session mode **only if** the headroom maths supports it
   at the chosen compute size. Redeploy. *(F2)*
6. Re-verify `alter role postgres set statement_timeout='15s'` survived. *(F1 — a compute change
   is exactly the kind of event that could reset role config.)*
7. Full env var re-read, post-upgrade. *(R1)*
8. Browser smoke test: login, Home, Check-in, a small import — each <1s, console clean.
9. `pg_dump` again, post-upgrade.

**Thu–Fri — privacy, device UX and the handout are all signed off, so what remains is code:**
ship and verify the 2026-08-05 build (48h TTL + session kill switch, church-only password
reset, `/ready`, login throttle 10→15, iOS AutoFill hint), then **R12** (brief the
phone-answerer — five minutes, and now cheaper since the throttle is looser).

⚠️ **Deploy order for that build is not free choice:** migration `0021` must be applied to
prod **before** the code is pushed — `supabase.settings` writes every column on every save, so
the column has to exist first, or every settings save and mode switch fails in prod.

**Saturday:** confirm the daily backup exists before sending the passwords. Watch Vercel logs
through the first morning. Have the rollback (port `5432`→`6543` + redeploy) written down.

**The weeks after:** **S8** (time a full-size import against prod), **F7** (migration label
drift).

**Mid-September:** R11 (burst test), R10 (paper runbook), PITR decision, iOS install comms at
the training day.

> With R4/R5/R7/R8 closed, **the pre-Saturday critical path is genuinely short**. The bulk of
> the remaining risk has moved to **tomorrow's upgrade window** (§5 above) and to **September**.

---

## 6. Who does what — ask Claude, or do it yourself

The split is not about difficulty. It is about **tool access**: Claude can read this repo, run
its tests, write and push code, and run **read-only** SQL against prod via the Supabase MCP.
Claude has **no access to the Vercel dashboard, no access to Supabase billing/settings, no
database password, and no phone.**

### ✅ Ask Claude — no dashboard needed

| Task | Notes |
|---|---|
| Any **read-only SQL** against prod | Already proven today — connection counts, RLS state, row counts, cron health, account states. Ask for a specific question, get evidence. |
| **F4 readiness endpoint** | Small code change: a route that runs `select 1` with a timeout. Claude writes + tests it. |
| **F5 error tracking** | Wire Sentry (or similar) into `error.middleware.ts` + the SPA `_doFetch`. Claude writes it; **you** supply the DSN and set it in Vercel. |
| **R6 account review, data half** | Verify the 68 accounts, roles, gender scopes, statuses, church mapping — read-only SQL. The *login* half is yours. |
| **F7 migration label drift** | Claude can reconcile the version rows via the Supabase MCP. |
| **S8 import timing, code half** | Claude can reason about the round-trip count and raise `maxDuration`. Timing a *real* import against prod needs you (or a file Claude can run locally). |
| **Pushing any of the above** | A push to `master` is the deploy. Claude will not push without you saying so. |

### 🔒 Only you can do these

| Task | Why Claude can't |
|---|---|
| **The Supabase plan upgrade + compute size** | Billing and dashboard. This is tomorrow's main event. |
| **Reading / setting any Vercel env var** — incl. `DATABASE_URL`'s port, `CRON_SECRET`, a Sentry DSN | No Vercel env tooling exists in this setup. Recorded in `DEPLOY-NEXT-STEPS-2026-07-30.md` too. **F2 hinges on this: only you can confirm the pooler port.** |
| **Supavisor Pool Size** | Supabase dashboard → Database → Connection Pooling. |
| **`pg_dump` / `supabase db dump`** | Needs the DB password. There is no `.env` on this machine and the repo isn't linked to the CLI. If you paste nothing, Claude has no route to it. |
| **`pg_terminate_backend`** | Destructive SQL — out of bounds by this repo's own convention. |
| **Confirming a backup exists** | Supabase dashboard. |
| **R6 handout rehearsal, login half** | Logging in from the exported sheet and eyeballing where it lands. |
| **Distributing the passwords; briefing leaders (R12)** | Yours. |

### The honest summary

The pre-Saturday list is now three items. **R6** is yours. **R12** is yours. **R9** is the only
one Claude can build — and it needs you for one env var (the Sentry DSN) and one external
monitor signup.

**The single highest-value thing to hand Claude right now is R9**: the DB-touching readiness
route plus error tracking. With privacy and device UX already confirmed on real hardware, the
largest remaining Saturday gap is not a defect — it is that **you would not find out** if
something broke for a subset of churches.

Everything else on the critical path is tomorrow's upgrade window, and all of it is yours:
plan, compute size, `DATABASE_URL` port, Supavisor pool size, backup confirmation.

## 7. What is deliberately NOT on this list

- **Anything further on budget/sponsorship.** Reviewed and fixed on 2026-08-05 (`481bd33`),
  tests green at 990, and prod shows **0 unpriced and 0 unrecorded-accommodation people** — the
  exact conditions that bug needed. The owner considers it good enough to reconcile against.
  Closed.
- **The camp-burst load test.** See R11. Wrong week.
- **Push adoption work.** Zero subscribers is fine for a pre-camp launch; it is a training-day
  problem.

---

_Sources: [Supabase compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk)
· [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
· [Supabase PITR](https://supabase.com/blog/postgres-point-in-time-recovery)
· [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)
· [Vercel: stopping function timeouts](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out)_
