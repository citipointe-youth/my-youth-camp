# Runbook — Supavisor session-mode cutover (pre-camp)

**Goal:** move the MYC production DB connection from the **transaction-mode** pooler
(port `6543`) to the **session-mode** pooler (port `5432`), to avoid the intermittent
*dead-connection* failure the sister app (Connection Made Simple) proved is triggered by a
burst of new connections — exactly the pattern of 100–200 leaders logging in at camp AM
check-in.

**Why:** see the CMS incident writeup (`../../Project 7 - Connection Made
Simple/connection-made-simple/CLAUDE.md` → "✅ RESOLVED — the actual root cause was the
pooler CONNECTION MODE"). Switching to session mode was the single change that ended a
multi-day outage there.

**Trade-off:** session mode holds a **dedicated Postgres backend per app connection** for
its lifetime (transaction mode multiplexed them). So the ceiling becomes
`max_connections` / Supavisor pool size, not the 200-client `EMAXCONN` cap. This is a
non-issue at current (light, pre-camp) usage; it only needs sizing before the camp burst —
which is why the work is split into two windows below.

**Reversibility:** the cutover is a one-value env change (port `6543`→`5432`) + redeploy.
Rollback is the same change in reverse. No code, schema, or migration change.

---

## Timeline — two windows

The plan is **not** upgraded to paid until the camp month (a few months out). The work
splits cleanly by what does and doesn't depend on the paid config:

| Window | When | What | Why here |
|--------|------|------|----------|
| **1 — Do now** | Current (free tier) | Role timeout · session-mode cutover · **functional** test | None of it depends on paid; free-tier ceilings are irrelevant at light pre-camp usage; the cutover persists through the upgrade and de-risks pre-camp admin/import work |
| **2 — At upgrade** | ~1–2 weeks before camp (paid) | Headroom re-check · **burst load** test | The 100–200 burst can only be validated against the real paid `max_connections`; testing it on free tier measures the wrong config and risks degrading the live pooler |

> **Facts assumed** (verify before starting):
> - Vercel: team `citipointe-youth`, project `my-youth-camp`, auto-deploys from `master`.
> - Supabase: ref `nwfafrgojqkxylbppywo` (Sydney, `ap-southeast-2`). **Currently free tier**;
>   paid upgrade planned for the camp month only.
> - App pool config (`src/repositories/supabase/client.ts`): `max: 5`, `idle_timeout: 10`,
>   `max_lifetime: 60`, `prepare: false`, per-connection `statement_timeout: 15000`.

> **Who runs what:** **[human]** = needs Vercel/Supabase dashboard access, or destructive SQL
> like `pg_terminate_backend` (Claude is blocked from those). **[claude-ok]** = read-only or
> low-risk SQL Claude can run via the Supabase MCP tools.

---

## Window 1 — Do now (free tier)

### 1. Role-level query timeout (config-independent, do first)

The per-connection `statement_timeout: 15000` in `client.ts` is **not reliably enforced
through the pooler** — CMS caught a trivial query running 4+ minutes despite it. Enforce it
at the DB-role level instead (the same pattern Supabase's own roles use):

- **[claude-ok] Apply:**
  ```sql
  alter role postgres set statement_timeout = '15s';
  ```
- **Verify:** `select rolname, rolconfig from pg_roles where rolname = 'postgres';`
  (should list `statement_timeout=15s`).
- This is a **DB-role config, not a schema migration** — it lives on the role, not in
  `supabase/migrations/`. It survives new-year rollover (which only purges data rows) but
  **must be re-applied if the Supabase project is ever recreated.** In session mode the
  `client.ts` param would also start sticking; keep this as belt-and-suspenders.

### 2. Session-mode cutover

Safe now: at light pre-camp usage the free-tier 60-connection ceiling is far above actual
use (single digits), and the change carries straight through the paid upgrade (upgrading
compute/plan does **not** change the connection string).

1. **[human]** Change the Vercel **Production** env var `DATABASE_URL`: port **`6543` →
   `5432`**. Everything else (host `…pooler.supabase.com`, user `postgres.<ref>`, password,
   `/postgres`) stays **identical**.
   - ⚠️ **Integration note:** the app reads **only `DATABASE_URL`** (`src/config/env.ts`),
     which is a **manually-set** Vercel var — *not* one the Supabase→Vercel integration
     manages (it syncs `POSTGRES_URL*` / `SUPABASE_*`, which the app ignores). So editing
     `DATABASE_URL` is safe and a resync won't revert it. But **re-verify it after any
     integration resync or the paid upgrade** (see Window 2, step 7).
   - ⚠️ **Use the *Session pooler* string** (Supabase → Connect → Session pooler:
     `aws-…pooler.supabase.com:5432`, user `postgres.<ref>`). Do **not** use the *Direct
     connection* (`db.<ref>.supabase.co:5432`, IPv6-only — breaks on Vercel) or the
     integration's `POSTGRES_URL_NON_POOLING` (that's the direct one). Both are `:5432` but
     different hosts.
2. **[human] Redeploy** so the new env is picked up (env changes need a fresh deployment):
   push a trivial commit to `master`, or use Vercel's "Redeploy" on the latest prod
   deployment.
3. Do this **outside** any active admin session, with time to watch + roll back.

### 3. Functional verification (right after deploy)

1. **[human] Browser smoke test** on `https://my-youth-camp.vercel.app`: log in, load Home,
   open Check-in, run a small CSV import (exercises `sql.begin` transactions). Each should
   return in **<1 s** with a clean console.
2. **[claude-ok] Watch the pooler while testing:**
   ```sql
   select count(*) as conns,
          count(*) filter (where state = 'active') as active,
          max(extract(epoch from (now() - query_start)))
            filter (where state = 'active') as longest_active_s
   from pg_stat_activity;
   ```
   Expect a low connection count, no query stuck `active` for many seconds, no 20-s hangs.

### 4. Gentle functional test (optional, not the burst test)

Point CMS's `loadtest-realistic.mjs` (staggered arrivals) at MYC prod with a **real login**
(create a throwaway leader/church account) at **low concurrency (~10–20)** — purely to shake
out app-level bugs in session mode and confirm the harness works against MYC's endpoints.

- Stays well under the free-tier 60 ceiling.
- **This is a *functional* rehearsal, not the camp-scale load test** — that's Window 2.
- **[human]** Clear any orphaned backends afterward (see Window 2, step 4).

---

---

## ✅ WINDOW 2, PART ONE — DONE 2026-08-07. Read this before the sizing sections below.

The plan was upgraded and the config sized. **Steps 5–7 are done; step 8 (the burst load test)
is deliberately still outstanding and belongs in September.**

| Fact | Value (measured, not assumed) |
|---|---|
| Plan | **Pro** |
| Compute | **Micro** (upgraded from Nano) |
| `max_connections` | **60** · `superuser_reserved_connections` **3** → 57 usable |
| Baseline connections used by Supabase's own services | **~15** |
| Supavisor **Pool Size** | **15 → 30** |
| Supavisor max client connections | 200 (not the constraint) |
| `DATABASE_URL` | **:5432 session pooler** — cutover confirmed done |
| App pool `max` (`client.ts`) | **5 → 3** |
| Role `statement_timeout` | **`15s`, survived both the plan upgrade and the compute restart** |

> 🔴 **THE HEADLINE, AND STEP 6 BELOW IS MISLEADING WITHOUT IT: `max_connections` DOES NOT SCALE
> WITH THE PLAN, ONLY WITH COMPUTE — AND MICRO IS 60, IDENTICAL TO THE FREE NANO.** Only Small
> (90) and above raise it. Upgrading to Pro bought backups, no auto-pause and PITR eligibility;
> it bought **zero** extra connections. Anyone reading step 6 expecting the number to have moved
> will read 60 and think the gate passed.

**The real ceiling was never `max_connections` — it was the Supavisor Pool Size.** In session
mode a client connection holds a dedicated backend for its whole life, so:

```
concurrent Vercel instances served  =  Supavisor pool size / app pool max
```

At the defaults (**15 / 5**) that was **three instances** before everything else queues — far
short of a 100–200-leader AM burst, and queuing at check-in is indistinguishable from an outage.
Now at **30 / 3** it is **ten**. 30 backends + ~15 internal fits inside 57, with ~12 spare.

**Why not Small?** It reaches the same ten instances (50 / 5) but costs more, and the load test
that would justify it hasn't run. Owner's decision 2026-08-07: **run the leaders' day on Micro +
30/3, then reassess at the September load test.** If that test wants more headroom the move is
**Small + pool 50**, *not* a smaller `client.ts max` — 3 is already the floor worth having (1
caused head-of-line blocking in CMS; 2 is the lowest CMS ran healthy on).

⚠️ **Set the compute size FIRST, then the pool size** — resizing can reset the pool to the new
default. And re-verify the role `statement_timeout` after any resize (it survived this one).

---

## Window 2 — At upgrade (~1–2 weeks before camp, paid)

Give this enough lead time before camp week that there's room to react — never same-day.

### 5. Confirm the upgrade
**[human]** Confirm the plan is actually upgraded and note the **compute size** (Supabase →
Settings → Compute & Disk). `max_connections` scales with compute — this is the number that
matters.

### 6. Headroom re-check (against the paid config)
**[claude-ok] Read the real ceilings:**
```sql
show max_connections;                 -- the hard Postgres ceiling (changed by the upgrade)
show superuser_reserved_connections;  -- subtract these; not usable by the app
select count(*) from pg_stat_activity; -- current baseline
```
**[human]** Read (and if needed raise) the **Supavisor Pool Size** (Supabase → Database →
Connection Pooling). Then apply the sizing check below.

### 7. Confirm the connection string survived the upgrade
**[human]** Confirm `DATABASE_URL` is still on **`:5432`** (session pooler) after the
plan/compute change. It should be unchanged — just verify.

### 8. Burst load test (the real proof)
The functional test won't reproduce the failure mode — the burst does. Do this once,
deliberately, on the paid config:

1. Reuse **`loadtest-realistic.mjs`** (staggered arrivals — the one that matters; mimics real
   check-in without overstating instance concentration). `loadtest.mjs` / `loadtest-batch.mjs`
   are per-endpoint / herd variants for contrast.
2. **Ramp** concurrency toward the real target (100–200) — don't jump straight to 200.
3. **[claude-ok] Watch `pg_stat_activity`** (the query in step 3) **during** the run —
   connections must stay under the ceiling; nothing should hang.
4. **⚠️ [human] Clear orphaned backends afterward.** Heavy testing can leave `active`/
   `ClientRead` backends stuck; they degrade prod until reaped. Claude **cannot** run this:
   ```sql
   select pid, pg_terminate_backend(pid), now() - query_start
   from pg_stat_activity
   where state = 'active' and wait_event = 'ClientRead'
     and pid <> pg_backend_pid() and now() - query_start > interval '60 seconds';
   ```
5. **Do not** hammer prod harder than the target to "find the limit" — heavy testing is what
   degraded the CMS pooler during its incident. Prefer gentle, staggered runs, and watch real
   connection counts during the first live session.

---

## Headroom sizing (reference for step 6)

Peak backends session mode will hold ≈

```
peak_app_connections  =  (peak concurrent warm Vercel instances)  ×  (pool max = 5)
```

- Under a 100–200-leader AM burst, Fluid Compute packs many users onto relatively few
  instances, but cold-start fan-out can still spin up tens briefly.
- **Require:** `max_connections − superuser_reserved_connections` **and** the Supavisor Pool
  Size both **comfortably exceed** `peak_app_connections` (aim for ≥2× margin).
- CMS ran healthy at ~5–20 of 60 with `max:2`. MYC runs `max:5` and 3–5× the users, so the
  **paid** `max_connections` is the number to check — don't assume the free-tier 60.

**Levers if the margin is thin (in order of preference):**
1. **Raise compute / Supavisor Pool Size** on the paid plan — most headroom, no app change.
2. **Lower `idle_timeout`** in `client.ts` (already an aggressive `10`s; frees idle backends
   fast, reconnects are cheap in session mode).
3. **Lower the app `max`** from 5 toward 3. **Not** `max:1` — the `client.ts` comment records
   it caused head-of-line blocking (one slow query froze every request incl. login).

`prepare: false` can stay — session mode supports prepared statements, but leaving it off is
harmless. No code change is required for the cutover.

---

## Rollback

If anything regresses after the cutover:
1. **[human]** Set `DATABASE_URL` port back **`5432` → `6543`** in Vercel Production.
2. **[human]** Redeploy.

Instant, total revert — no code/schema state to unwind. The role-level `statement_timeout`
is safe to leave in place either way.

---

## Go / no-go summary

**Window 1 (now):**

| Gate | Pass condition |
|------|----------------|
| Timeout | `alter role postgres set statement_timeout='15s'` applied + verified |
| Cutover | Port `6543→5432` in Vercel prod + redeploy, done outside a live session |
| Functional | Login / Home / Check-in / small import return <1 s, console clean, no hangs |

**Window 2 (at upgrade):**

| Gate | Pass condition |
|------|----------------|
| Plan | Paid plan active; compute size noted |
| Headroom | `max_connections − reserved` **and** Supavisor Pool Size both ≥ ~2× `(peak instances × 5)` |
| Load | Staggered ramp to 100–200 stays under the ceiling with no hangs; orphans cleared after |

---

_Cross-ref: CMS incident history + the session-mode resolution live in
`../../Project 7 - Connection Made Simple/connection-made-simple/CLAUDE.md`. This runbook
covers only the pooler-mode cutover + the role-level timeout — the other CMS DB fixes
(batch endpoint, dedupe, IP+account rate limiter, read-first settings) are **not needed**
for MYC (it already has equivalents or better)._
