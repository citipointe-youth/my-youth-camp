# Launch Readiness — outstanding items only

> Rewritten 2026-07-26 to **outstanding items only** — everything done or verified has been
> removed. The full original analysis (verdict, evidence, capacity/security/ops sections, the
> YS Connection comparison) is in git history for this file.

**Launch:** ~2026-08-05 · **Camp:** 2026-09-28 → 2026-10-01 · **Prod:** https://my-youth-camp.vercel.app

Closed since the original assessment: **B7** (dashboard cache `genderScope`), **S2** (check-in
queue persistence), **S5** (`assertFieldEncryptionKey()`), **S6** (SPA `?churchId` — the backend
half already existed).

## 🔴 BLOCKING — before telling churches the URL

| # | Action | Why | Who |
|---|---|---|---|
| B1 | Cut `DATABASE_URL` from the transaction pooler (6543) to the **Session pooler** (5432, `aws-…pooler.supabase.com`, user `postgres.<ref>` — NOT `db.<ref>.supabase.co`); `docs/SESSION-MODE-CUTOVER.md` Window 1 | Transaction-mode dead connections caused a multi-day outage in the sibling app at 30–40 users; this app expects 100+ | Owner (Vercel) |
| B2 | Verify Production env: `PERSISTENCE=supabase`, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `CORS_ORIGINS` | Missing key = the app now refuses to boot (S5); missing CORS lock = open origin | Owner (Vercel) |
| B3 | Back up `FIELD_ENCRYPTION_KEY` out-of-band, two places, one reachable by someone else | Key lost = every medical/contact/note field permanently unrecoverable; backups hold ciphertext | Owner |
| B4 | Upgrade Supabase to Pro; confirm a backup actually exists | Free tier has no restorable backups, and `/admin/reset` TRUNCATEs | Owner (Supabase) |
| B5 | Confirm RLS on for all 18 tables and that the anon key returns no rows (`SECURITY-ACTIONS.md` §4) | Repo migrations are right; prod state unverified | Owner (Supabase SQL) |
| B6 | Confirm `alter role postgres set statement_timeout='15s'` still applied | Per-connection timeout isn't reliably enforced through the pooler; this is the only real ceiling | Owner |
| B8 | Decide the church password keyspace — widen `memorablePassword` to `Word.Word.##`/`Word.###`, or accept ~11.7k | ~11.7k + a per-instance limiter ≈ 800 guesses/hr on an enumerable username, over a 10-week exposure. **Decide before the CSV is distributed** | Owner → code |
| N1 | **Apply migration `0015`** (`settings.discount_code_overrides`) with the deploy | `supabase.settings` writes ALL columns on every save — until it's applied, every settings save, mode switch and new-year **fails in prod** | Owner + Claude |

## 🟡 SHOULD DO — before camp (2026-09-28)

| # | Action | Why | Who |
|---|---|---|---|
| S1 | Cutover Window 2: read `max_connections`/pool size on the paid config, then a staggered ramp load test to 100–200; clear orphaned `ClientRead` backends after | Only a burst reproduces the failure; free-tier numbers measure the wrong config | Owner + Claude |
| S3 | Add error tracking (free Sentry) in `error.middleware.ts` + the SPA `_doFetch` catch | Today the only signal anything is broken is a leader saying so | Code |
| S4 | External uptime monitor on `GET /health` with SMS alerting | Cheapest early warning on the list | Owner |
| S7 | Harden `POST /admin/reset` — require a *recent* export even when `force:true`, or env-gate it during camp | The server guard latches open after the first export; the only real barrier is a client modal | Code |
| S8 | Time a full-size Form import against prod; raise `maxDuration` to 60 if it nears 30s | `saveMany` is one round-trip per person; Vercel kills at 30s | Owner + code |
| S9 | Real-device iPhone pass (Safari + installed PWA): bottom nav, 8+ session picker, full roster, confirm modals, login autofill | CSS/layout is never proven by tsc/vitest | Owner |
| S10 | Print the offline sign-in sheets and rehearse fill-and-upload once | The only genuine offline path, and it covers Day-1 arrival | Owner |
| S11 | One-page paper camp runbook: admin password holder, key backup location, `pg_terminate_backend` query, "all screens fail = pooler", offline-sheet fallback | No engineer at camp | Owner |
| S12 | Brief leaders: re-tap the ✎ initials badge on a shared phone, check in where signal is good, re-tap rows that don't turn green, no push this year | Attribution and the check-in queue both depend on behaviour | Owner |
| S13 | Consider PITR for September–October only | Daily backups mean up to 24h of check-in loss; check-ins are the attendance record | Owner |
| N2 | Set `CRON_SECRET` in Vercel Production **and** create the matching Supabase Vault secret: `select vault.create_secret('<secret>','cron_secret');` | Both must exist and match before `0014`, or every tick 401s **silently** (pg_net is fire-and-forget) | Owner |
| N3 | **Apply migration `0014`** (pg_cron/pg_net + schedule) only after `/internal/cron/tick` is live in prod and N2 is done — then verify the tick actually fires (`net._http_response`, and a warning notice appearing) | Applied early, every tick 404s silently; nothing surfaces the failure | Owner + Claude |
| N4 | **On-device verification backlog** (nothing below was eyeballed on a phone): floating arrival confirm bar, schedule editor time boxes, check-in queue surviving a force-quit, the Budget discount-override field, a church login's roster after the `?churchId` change | All CSS/behaviour that tsc/vitest cannot prove; the `?churchId` one is a correctness check, not cosmetic | Owner |
| N5 | Decide on the **check-in double-submit** finding: a crash between `drainQueue`'s await resolving and the persist replays the entry → a duplicate row in the compliance export (`withCheckIn` has no `(sessionId,camperId)` dedup) | Pre-S2 the same crash lost the tap instead; displayed state is unaffected. Fix = client idempotency key or server dedup | Owner → code |
| N6 | Reconcile prod migration version labels — `0009`–`0012` are applied under generated timestamp versions (`20260720012415`, `20260723131647`, `20260723131721`, `20260723181751`) | Schema is correct; only the labels drifted. Leaving it makes future `db push` reasoning unreliable | Owner + Claude |

## 🔵 MONITOR — during camp

| # | Watch | How | Trigger |
|---|---|---|---|
| M1 | Pooler connections during the first live AM check-in | `select count(*), count(*) filter (where state='active') from pg_stat_activity;` | Approaching the pool size, or queries `active` for seconds |
| M2 | Orphaned `ClientRead` backends | Runbook query, `SESSION-MODE-CUTOVER.md` step 4 | *Every* endpoint 503s together → `pg_terminate_backend` |
| M3 | The "N check-ins didn't save" banner | Ask leaders to report it | Any sighting = real attendance rows dropped; reconcile against paper |
| M4 | Function duration on `/checkin/sessions/:id/status` and `/home` | Vercel Observability | Sustained >3–5s = the full-table reads are biting |
| M5 | 429 login responses | Vercel logs | A church locked out (10 fails/15 min/ip+username) — reset their password |
| M6 | Supabase disk / egress | Supabase dashboard | Full-table reads × 100 leaders × 4 days is the egress driver |
| M7 | `INTERNAL_ERROR` clusters | Sentry if S3 shipped, else Vercel logs | Investigate immediately — the generic message carries no signal |
| M8 | Cron tick health, once `0014` is applied | `net._http_response` rows / warning notices appearing on time | Silent 404/401 loops, or duplicate warnings (the `dedupe_key` unique index should prevent them) |
