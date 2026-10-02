> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: infrastructure and safety

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## Past check-in sessions keep signed-out students + end-of-camp sign-outs restored — 2026-10-01

Server only (`checkin.service.getSessionStatus`), no SPA/migration change. Owner: after camp ended
(12pm day 4) leaders signed out 74 people by hand, and every past session (check-in screen + pulse
‹ › stepping) lost them, because the roster was `atCamp===true` only. Roster is now **`atCamp` OR
has a `checkInHistory` entry for that session** (leaders still excluded), so a later sign-out never
rewrites a past session. +1 test (1179 pass). `checkin-warnings.ts` (who is missing NOW) unchanged.
- **Data (prod SQL, owner-approved):** the 74 (55 youth, 19 leaders) whose LAST event was an `out`
  at/after 02:00Z 10-01 → `lifecycle='arrived', at_camp=true` + one `'in'` event each (reason
  `Restored after end-of-camp sign-out (kept as present at camp close)`, Youth Admin). Their real
  pickup sign-outs were **kept**. Owner intent: the end-of-camp state shows who was there at close.
- **`settings_lock_at_camp` trigger + `lock_camp_mode_at_camp()` DROPPED** 2026-10-01.
  ⚠ `isCampDay` unlocks the Pre-Camp switch from 10-02 — and at→pre **signs out everyone at camp**
  (incl. the 74). Don't switch modes until the owner decides how the end-of-camp state is archived.

## Pre-camp switch LOCKED on camp days — `camp-v131` — 2026-09-28 (incident)

**Incident (camp day 1):** at 09:20:47 Brisbane (`23:20:47Z` 09-27) the "Youth Admin" login confirmed
**Switch to Pre-Camp** (owner believes accidentally). `admin.service.setMode`'s at-camp→pre-camp sweep
signed out all **18** people signed in 08:31–08:32 (`sign_out_history.reason = 'Camp mode reverted
to pre-camp'`). Church logins then correctly showed pre-camp; admin tabs kept showing At Camp only
until their next home-nav re-sync. Not a race/import: the SPA's settings PATCH never sends
`campMode`, and imports stamped at 08:01.

**Recovery (direct SQL, one transaction):** `camp_mode='at-camp'` set **by SQL, NOT via the button**
(the pre→at transition deletes every `firstaid` note — would wipe real ones logged mid-camp; 0
existed at the time). The 18 reverted people → `lifecycle='arrived', at_camp=true` + one `'in'`
event each, reason `Restored after accidental revert to pre-camp`.

**Locks (two layers):**
- **DB trigger `settings_lock_at_camp`** (`lock_camp_mode_at_camp()`, BEFORE UPDATE on `settings`)
  raises if `camp_mode` leaves `'at-camp'`. Covers every whole-row writer (import stamp, audit
  export, newYear). The service writes settings BEFORE the sweep, so a blocked switch signs nobody
  out. ⚠ **Not a migration file — drop it after camp:** `drop trigger settings_lock_at_camp on
  public.settings; drop function public.lock_camp_mode_at_camp();` (or the end-of-camp switch and
  New Year both fail).
- **Code:** `isCampDay(settings)` (exported from `admin.service.ts`; Brisbane date within
  startDate..endDate widened by checkInDays) → `setMode` throws `BadRequestError` for at→pre on a
  camp day, before any write. SPA `_modeSwitchLocked()` mirrors it: the Admin console tile becomes a
  lock tile "Pre-Camp switch locked (camp running)" and `switchMode()` refuses. Unlocks
  automatically the day after the last camp day. +4 tests (`camp-day lock`), vitest 1174 pass.

## 🔴 Supabase Pro + the connection sizing that actually mattered — 2026-08-07

**Infrastructure + a one-line code change**, no schema/migration. `npm run typecheck` clean,
`npx vitest run` **1013 pass / 62 files** (unchanged — config, not logic). No `sw.js` bump
(backend only). Commit `4dfac4a`. Full numbers + the go/no-go table live in
**`docs/SESSION-MODE-CUTOVER.md`** ("WINDOW 2, PART ONE"); the standing reference is the
**"session-mode cutover + connection sizing"** block further down this file. This section is the
*why*.

| | Before | After |
|---|---|---|
| Plan / compute | Free / Nano | **Pro / Micro** |
| `max_connections` | 60 | **60 (UNCHANGED)** |
| Supavisor Pool Size | 15 | **30** |
| App pool `max` (`client.ts`) | 5 | **3** |
| **Vercel instances served at once** | **3** | **10** |

### 🔴 Two things here are counter-intuitive and both cost real capacity if forgotten

**1. UPGRADING THE PLAN BUYS NO CONNECTIONS.** `max_connections` scales with **compute**, and
**Micro is 60 — identical to the free Nano.** Only Small (90) and above move it. Pro bought
daily backups, no auto-pause and PITR eligibility. Measured before *and* after the upgrade: 60
both times. ⚠️ `SESSION-MODE-CUTOVER.md` step 6 says "read `max_connections` on the paid
config" — followed literally it reads 60, **looks like the gate passed, and proves nothing.**

**2. THE BINDING CONSTRAINT WAS NEVER `max_connections` — IT WAS THE SUPAVISOR POOL SIZE.**
Prod is on the **session-mode** pooler, where a connection holds a dedicated Postgres backend
for its whole life instead of being multiplexed. So:

```
concurrent Vercel instances served  =  Supavisor pool size / client.ts max
```

At the untouched defaults (**15 / 5**) that was **THREE INSTANCES** — against a 100–200-leader
AM check-in burst. The 4th instance onward would have **queued**, and queuing at check-in is
indistinguishable from an outage to a leader holding a phone. This was live and unnoticed for
the entire life of the deployment; `max_connections` (60, never close to exhausted) would never
have revealed it, because Supavisor caps the backends long before Postgres does.

⚠️ **The two numbers are HALF OF A PAIR, in two different systems** — one in the Supabase
dashboard, one in this repo. Changing either alone silently moves the ceiling and nothing in
CI, `tsc` or `vitest` will catch it. **Redo the arithmetic and change both together.**

### Why `max: 3` and not lower

Queries here run **2–40ms** (a live `/ready` probe measured 21ms cold, 2–3ms warm), so
per-instance parallelism was never the constraint — **connection slots were**. CMS ran healthy
on `max: 2`. ⚠️ **Never `max: 1`**: it caused head-of-line blocking in CMS, where one slow query
held the ONLY connection and froze every request on that instance, **including login**.

### Operational lessons worth keeping

- ⚠️ **Set compute size FIRST, then pool size** — a resize can reset the pool to the new default,
  so setting the pool first risks silently losing it.
- **`statement_timeout = 15s` on role `postgres` survived BOTH the plan upgrade and the compute
  restart** — verified, not assumed. Still re-check it after any future resize; it is a role
  config, not a migration, and would be lost if the project were ever recreated.
- **A compute resize is ~2 minutes of hard downtime.** During it the DB refuses connections
  outright (an MCP query returned *"Connection terminated due to connection timeout"*). Do
  resizes in a deliberate window — this is exactly why the sizing was settled before the church
  handout rather than in September.
- **`/ready` is the fastest recovery signal after a resize** — poll it until `db:"ok"` returns
  rather than guessing. It is what confirmed recovery here.

### Still outstanding — the burst load test
`SESSION-MODE-CUTOVER.md` step 8, deliberately deferred to **~mid-September**. Owner's decision
2026-08-07: **run the leaders' day on Micro + 30/3, reassess then.** ⚠️ If that test wants more
headroom the move is **Small + pool 50**, *not* a smaller `client.ts max` — 3 is the floor worth
having. 30 backends + ~15 used by Supabase's own services already sits near the practical
ceiling of Micro's 57 usable.

## 🔴 THE NEW-YEAR ROLLOVER EMPTIED PRODUCTION — a double-encoded snapshot — 2026-08-04 (3rd)

Owner: *"I just saved then rolled over to a new year but can't find out how to restore the
baseline."* There is nothing to find — **the restore is not a button, it is the second half of
`newYear`** — and it had already run, restoring **nothing** over the live camp.
`npm run typecheck` clean, `npx vitest run` **915 pass / 59 files** (was 911/58; **+4**).
**No schema or migration change.** Backend repo only — no SPA change, `sw.js` NOT bumped.

### What it cost
Measured against prod, not inferred. The rollover ran `2026-08-04 11:18:04Z`, ten seconds after
the compliance export (so the historical record is safe). Immediately after: **0 churches, 1 user,
0 classrooms, 0 FAQs, 0 schedule items, 0 devotionals, 0 temp passwords.** The snapshot held
**29 churches, 32 accounts, 34 classrooms, 6 FAQs, 48 schedule items, 1 devotional** the whole
time.

### 🟠 THE PAYLOAD WAS JSON-ENCODED TWICE AND EVERY LAYER AGREED IT WAS FINE
`saveDefaults` wrote `JSON.stringify(obj)` and cast it `::jsonb`. **The cast declares the
parameter type as jsonb, so postgres.js runs its own jsonb serializer over the string it is
handed** — a second encoding. The column ended up holding a jsonb **string**
(`jsonb_typeof(snapshot) = 'string'`), not an object.

> ⚠️ **THE READ SIDE THEN CONVERTED THAT INTO SIX EMPTY ARRAYS, SILENTLY.** `toDefaults` cast the
> string `as Record<string, unknown>` — which compiles clean — so every `snap['churches']` read
> `undefined` and every `?? []` fallback fired. `newYear`'s `if (!defaults)` guard passed, because
> the ROW existed. `replaceAll(churchRepo, [])` is a delete-everything, and that is exactly what
> it did, six times, plus `userRepo.deleteAll()` keeping only admins.
>
> **The `?? []` was the whole failure.** A missing collection and an unreadable snapshot are not
> the same event, and defaulting the second one to "empty" turns a corrupt read into a wipe.

- **`toDefaults` now THROWS** on a non-object snapshot, naming the type it got. **Do not soften
  this back into a cast.** An unreadable baseline must stop the rollover before a single delete,
  never empty it.
- **The write uses `sql.json()`** and lets postgres.js serialize. **Never `JSON.stringify` +
  `::jsonb` again.** Every other repo in that folder already passed objects through
  `this.sql(cols)`; this file was the only one hand-rolling the cast — **and the only Supabase
  repo with no mapper test**, which is the whole reason it survived.
- The `as unknown as JSONValue` cast is what the stringify was really working around
  (`CampDefaults` collections are `unknown[]`, which postgres.js's `JSONValue` rejects). Reaching
  for `JSON.stringify` to satisfy the type-checker is what produced the double encoding.
- `created_at` is now updated on conflict too — it had been pinned to the FIRST save ever
  (2026-07-27), so a snapshot re-saved on 08-02 still read as a week old.
- **`supabase.defaults.mapper.test.ts` — 4 tests.** ⚠️ **The malformed fixture MUST be the
  double-encoded STRING form.** An object fixture passes against the broken mapper and proves
  nothing; that is precisely how this shipped. Verified the old mapper body against the real
  production row: it returns `{churches:[],users:[]}`.

### Recovery — DONE, same day
The snapshot text was intact. The row was repaired in place
(`update defaults set snapshot = (snapshot #>> '{}')::jsonb`) and the scaffold re-inserted from
it: **29 churches, 31 accounts** (snapshot admins skipped — the live admin is the recovery
account, same rule as `newYear`), **34 classrooms, 6 FAQs, 48 schedule items, 1 devotional**.
`users.church_name`/`zone` were backfilled from `churches` afterwards — a sibling CTE's inserts
are not visible to another CTE in the same statement, so the join in the user insert saw an empty
table.

⚠️ **Two things the restore could NOT fix, both pre-existing in the baseline:**
- **15 of the 29 churches have no login** — the snapshot only ever held **28 church accounts
  (14 `b-`/`g-` pairs)**. Close it with **Split church accounts**, which regenerates a missing
  sibling from `slugifyUsername(church.name)`.
- **Every restored account is passwordless** (`password_hash` null, `must_change_password` true) —
  the snapshot strips hashes by design, and the rollover's temp-password list generated 0 entries
  because it saw 0 users. Fixed by **Randomise & export passwords**.

 **This year's people are
NOT recoverable from it and are not meant to be** — `newYear` purges them by design; they
re-import from the Elvanto CSVs. The snapshot is also from **08-02**, so anything created on
08-03/04 was not in it, and it strips password hashes by design (the rollover's temp-password
list generated 0 entries because it saw 0 users).

> **Standing lesson: `saveDefaults` and `newYear` are one mechanism and must be tested as one.**
> A snapshot that cannot be read is indistinguishable, at the call site, from a camp with nothing
> in it.

## Migration files consolidated — 2026-07-16

`supabase/migrations/` was collapsed from 24 files (`001`–`023`, incl. a duplicate
`004`) into four 4-digit files: `0001_baseline_schema.sql` (full end-state, minus the
deprecated `settings.tent_price`/`classroom_price` columns, reflecting the encrypted
`people` shape), `0002_rls.sql` (RLS on all 18 tables — 17 enabled directly in that file
at the time of this consolidation, plus `incidents` (migration `0007`, added after) —
also closes the gap where the old `020` never enabled RLS on `allocation_overrides`),
`0003_seed.sql` (admin + settings singleton, verbatim from the old `002`), and
`0004_drop_deprecated_columns.sql` (gated drop of the two dead pricing columns). The 24
originals are preserved verbatim in `supabase/migrations_archive/` (historical record;
outside the CLI's scanned folder). Historical prose in this file that cites an old
migration number (e.g. "migration `013` added `bracket`") still refers to those
archived files.

**Migrations have since progressed to `0008`** (`0005` unified check-in/sign-in entry,
`0006` gender-scoped church accounts, `0007` incidents — the table that brought the count
to 18, RLS enabled in that same migration — `0008` leaders-only notifications); next
migration = `0009` (revokes the public/anon/authenticated execute grant on the
Supabase-provisioned `rls_auto_enable()` event-trigger function and codifies that
function + its `ensure_rls` trigger in a tracked migration for the first time).
Since then: **`0010`** (scheduled notices — `notifications.scheduled_for`), **`0011`**
(check-in windows — four `checkin_window_*` cols + `church_checkin_time_restricted`), and
**`0012`** (2026-07-24 — drops `sign_out_history.parents_met`; applied to prod after the code
push that stopped writing it). Since then: **`0013`** (push subscriptions + notification claim
columns — **applied to prod** 2026-07-26), **`0014`** (pg_cron/pg_net + the tick schedule —
committed but **deliberately NOT applied**), **`0015`** (discount-code overrides — **applied to
prod 2026-07-27**, immediately before that push; the "not applied" note here was stale and was
corrected on 2026-07-28 after verifying `settings.discount_code_overrides` exists in prod), and
**`0016`** (2026-07-28 — `settings.site_map_image text` for the site-map feature, **applied to
prod BEFORE the code push**, as `supabase.settings` writes every column on every save).
Since then: **`0017`** (2026-07-29 — `settings.discount_code_tags` plus the returning
`tent_price`/`classroom_price`, for the budget ticket classification; **must be applied to prod
BEFORE the code push**, and it also back-fills the tags from the retired `discount_code_overrides`).
Since then: **`0018`** (2026-07-30 — `notifications.target_user_id`, per-login notice addressing;
**must be applied to prod BEFORE the code push**, as `supabase.notifications.save()` writes the
column on every notice save) and **`0019`** (2026-07-30 — `incidents.occurred_at`, optional).
**Both were APPLIED to prod on 2026-07-30 immediately before the push, and both history rows were
reconciled** from their generated timestamps (`20260730122502`/`20260730122518`) to `'0018'`/`'0019'`
and verified present by query. Since then: **`0020`** (2026-07-31 — the `reveal_audit` table; **applied to prod and
reconciled to version `'0020'` BEFORE the code push**). Next migration = **`0021`**. See the 2026-07-26 web-push section at
the bottom of this file for the gating conditions on `0014`.

✅ **~~Newly-observed history drift~~ — ALL SIX ROWS RECONCILED 2026-07-31.** `0009`–`0012` and
`0016`–`0017` had all been recorded under generated timestamps because the reconcile step was
skipped six times. Fixed together as its own task, exactly as this note asked for. **The history
table now reads exactly `0001`–`0019` with no gaps**, so `supabase db push` no longer sees six
phantom-unapplied migrations. Details + the reversal mapping are in the 2026-07-31 section near
the top of this file.

**Prod reconciled 2026-07-16 (code) + 2026-07-17 (DB).** The code-ref removal (dropping
`tentPrice`/`classroomPrice` from the settings entity/schema/seed/mapper + fixtures)
deployed to `master` first (must precede the column drop). Then against prod
(`nwfafrgojqkxylbppywo`): `0002` was run and was a **verified no-op** — all 17 tables
already had RLS on, *including* `allocation_overrides` (so the gap the old `020` left had
already been closed by the time this ran); `0004` dropped `settings.tent_price`/
`classroom_price` for real (both were present; 0 remaining after, 21 settings columns
left); a metadata history catch-up inserted `0001`–`0004` as applied and the old
timestamp-versioned rows (`005`–`023`) were **pruned**, so `supabase_migrations.
schema_migrations` now reads exactly `0001`–`0004`. Verified after: settings singleton
readable, a real admin settings save succeeds. A future `supabase db push` sees all four
already applied and does nothing. Design:
`docs/superpowers/specs/2026-07-16-migration-consolidation-design.md`.
Next future migration = `0005`.

## Field encryption at rest (people/notes sensitive columns) — implemented 2026-07-16

Sensitive `people`/`notes` columns are encrypted at rest with AES-256-GCM so raw DB access
(incl. Supabase staff/SQL editor) reveals only ciphertext, while every service/export still
sees plaintext. Design: `docs/superpowers/specs/2026-07-16-field-encryption-design.md`; plan:
`docs/superpowers/plans/2026-07-16-field-encryption.md`. Backend + migrations only — **no
SPA change, `sw.js` not bumped**. `npm run typecheck` clean, `npm run test` = **479 pass**
(14 new). Migrations `022`/`023` + the backfill script are **operator-gated** (see the plan's
Deployment Runbook) — code alone does not change prod data.

- **Scope + seam:** the codec (`src/utils/field-crypto.ts`, pure `node:crypto`) is called
  ONLY inside the Supabase row↔entity mappers — `supabase.people.ts` (`toPerson`/
  `personColumns`) and `supabase.notes.ts` (`toNote`/`noteColumns`). Services, in-memory/json
  persistence, and the SPA are all unaware encryption exists; `memory`/`json` dev modes stay
  fully plaintext. Encrypted `people` columns: `medical_conditions`, `dietary_requirements`,
  `other_medications`, `medicare_number`, `blue_card_number`, `blue_card_expiry`,
  `parent_guardian_name`, `parent_phone`, `parent_relation`, `consents`. Encrypted `notes`
  column: `body`.
- **Envelope:** `v1.<keyId>.<iv_b64url>.<tag_b64url>.<ct_b64url>` — the `v1.` prefix is the
  "already encrypted?" test (`isEncrypted`), which makes the backfill idempotent and lets
  reads tolerate a table that's any mix of ciphertext + not-yet-migrated plaintext. Every
  ciphertext is bound via AAD to `"<table>:<column>:<id>"`, so a value can't be swapped
  between rows/columns without the decrypt failing (auth-tag check).
- **Column shape:** `text[]`/`jsonb`/`date` fields (`medical_conditions`,
  `dietary_requirements`, `consents`, `blue_card_expiry`) move to new nullable `*_enc text`
  columns (migration `022`) since they can't hold a single ciphertext string in place; plain
  `text` scalars (`other_medications`, `medicare_number`, `blue_card_number`, `parent_*`,
  `notes.body`) are encrypted in place. `null`/`undefined`/`''`/`[]` always round-trip to the
  same empty value — never stored as ciphertext (`maybeEncrypt`/`maybeDecrypt`).
- **Key management:** `FIELD_ENCRYPTION_KEY` (base64, 32 bytes, active) + optional
  `FIELD_ENCRYPTION_KEY_ID` (default `k1`); `FIELD_ENCRYPTION_KEY_PREV` / `_PREV_ID` (default
  `k0`) for decrypt-only during rotation. See `SECURITY-ACTIONS.md` "1b" for generation +
  the rotation procedure. **Losing the key = losing the data permanently — that is the
  security property, not a bug.**
- **Rollout (Deployment Runbook in the plan, operator-gated):** apply `022` → deploy the
  encryption-aware code (reads decrypt-or-passthrough, writes emit ciphertext) → run
  `scripts/backfill-field-encryption.ts` (idempotent/resumable, re-saves every person + note
  through the encryption-aware repos) → verify every row is encrypted → apply `023` (drops
  the four legacy plaintext `people` columns) → `VACUUM FULL people; VACUUM FULL notes;` to
  physically purge plaintext from disk. Rollback is safe any time before `023`.

