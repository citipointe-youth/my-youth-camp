# Migration consolidation + deprecated-column drop — design

## Problem

`supabase/migrations/` has grown to **24 files** (`001`–`023`, including a
**duplicate `004`** — `004_accommodation_rework.sql` *and*
`004_fix_zones_groups_schema.sql`). Most are small additive column adds/drops;
a handful are real schema/data changes (initial schema, RLS, seed admin+settings,
the accommodation rework, and the recent field-encryption pair 022/023). Standing
up the schema — or reasoning about the current shape — means replaying two dozen
files, several of which only exist to undo or amend an earlier one. This is more
ceremony than the schema's actual end-state warrants.

This mirrors the consolidation already done for the sibling app **YS Connection**
(`../../Project 7 - Connection Made Simple/connection-made-simple/docs/superpowers/
specs/2026-07-11-migration-consolidation-design.md`), and follows the same playbook.

Two adjacent decisions were made when scoping this work:

1. **Goal is maintenance hygiene only** — not new-camp onboarding. No `DEPLOYING`
   guide is in scope (this app has none today and none is being added here).
2. **Deprecated columns are dropped as part of the baseline**, not preserved. The
   only confirmed-dead columns today are `settings.tent_price` /
   `settings.classroom_price` (deprecated 2026-06-29 — Budget reads per-registrant
   `registration_cost`; removed from the Settings UI; columns left in the DB — see
   CLAUDE.md "SPA ↔ backend contract"). The final drop list is confirmed against the
   code before anything is written (see §3).

## Current end-state (what `001`–`023` produces)

Prod (`nwfafrgojqkxylbppywo`, citipointe-youth) has **all of `001`–`023` applied**,
**including the field-encryption pair 022/023 + backfill + `VACUUM FULL`** (applied
2026-07-16). The baseline must reproduce this exact end-state:

- **17 live tables:** `users`, `churches`, `people`, `check_in_history`,
  `sign_out_history`, `classrooms`, `classroom_allocations`, `zones`, `groups`,
  `notes`, `notifications`, `schedule_items`, `devotionals`, `faqs`, `settings`,
  `defaults`, `allocation_overrides`.
- **Dropped along the way (must NOT appear in the baseline):** `reservations` +
  `accommodation_blocks` (dropped by 004); church `code`/`self_register_slug`/
  `expected_count`/`youth_pastor_name`/`contact_email`, settings
  `check_in_location`/`check_in_from`/`register_base_url`, `schedule_items.is_check_in_point`
  (dropped by 009); `zones.color` (renamed to `color_hex` by 004_fix).
- **Field-encryption end-state (022/023):** `people` has the four `*_enc text`
  columns (`medical_conditions_enc`, `dietary_requirements_enc`, `consents_enc`,
  `blue_card_expiry_enc`) and the four **legacy plaintext columns are gone**
  (`medical_conditions`, `dietary_requirements`, `consents`, `blue_card_expiry`).
  The in-place-encrypted scalar columns (`other_medications`, `medicare_number`,
  `blue_card_number`, `parent_guardian_name`, `parent_phone`, `parent_relation`,
  and `notes.body`) keep their `text` shape — they hold ciphertext at runtime but
  are DDL-identical to a plain text column, so the baseline treats them as ordinary
  `text`. (Runtime dependency `FIELD_ENCRYPTION_KEY` is unchanged and out of scope
  here.)
- **RLS is on for 16 of 17 tables.** `003` enabled it on the original 001 tables;
  `004` added `classrooms`/`classroom_allocations`. **`allocation_overrides` (020)
  never had RLS enabled** — the single gap, fixed by the consolidated RLS file (§1).

Out-of-migration prod config that this work does **not** touch and must not try to
capture: `ALTER ROLE postgres SET statement_timeout = '15s'` and the planned
session-mode pooler cutover (both documented in CLAUDE.md as living outside
`supabase/migrations/`).

## Constraints

- **Must not change prod's actual schema/data** as a side effect of *file*
  consolidation. The only prod schema change permitted is the explicit, reviewed
  deprecated-column DROP (§3) and enabling RLS on the one table that lacks it —
  both gated (§5).
- **Migrations are applied via the Supabase CLI (`db push`, tracked history) *or*
  by manual SQL-editor paste**, depending on environment — the solution must work
  either way. The tracked-history case is reconciled with `migration repair`; the
  paste case just runs the new files on a fresh DB.
- **Dropping `tent_price`/`classroom_price` is a coupled code + schema change, not
  a bare SQL drop.** `supabase.settings.ts` writes *every* settings column on every
  save, and the columns are still referenced by the settings entity, its Zod schema,
  the in-memory seed, and several test fixtures. The column refs must be removed from
  the code and deployed **before** the column is dropped from prod, or the next
  settings save (and every mode-switch / new-year) 500s with "column does not exist"
  — the same relax-then-drop discipline the app already used for `008 → 009`.
- **Verification is static/scripted** (no live throwaway DB): a script reconstructs
  the column/constraint inventory of both the old chain and the new chain and diffs
  them; the prod smoke-test is the final safety net.

## Approach

### 1. Consolidate `supabase/migrations/` into 4 files, archive the originals

```
supabase/
  migrations/
    0001_baseline_schema.sql   -- every live table + index as the end-state of 001–023,
                                  reflecting the encrypted people shape (*_enc columns
                                  present, legacy plaintext absent) and MINUS the
                                  deprecated settings columns (tent_price/classroom_price).
                                  Resolves the duplicate-004 numbering automatically.
    0002_rls.sql               -- `enable row level security` on all 17 live tables in one
                                  pass. Idempotent (no-op where already on); its only real
                                  effect vs. today is enabling RLS on allocation_overrides.
    0003_seed.sql              -- the single admin user (null password_hash → login rejected
                                  until an operator sets one; must_change_password default
                                  false) + the settings singleton, current conventions.
                                  `on conflict (id) do nothing` (idempotent). Equivalent to
                                  the old 002_seed_admin.sql.
    0004_drop_deprecated_columns.sql
                               -- the ONLY destructive/gated file. `alter table settings drop
                                  column if exists tent_price, drop column if exists
                                  classroom_price;` (+ any other column the §3 diff confirms
                                  dead). Idempotent no-op on a fresh DB (0001 never created
                                  them); real cleanup only against prod, AFTER the code deploy.
  migrations_archive/
    001_…_023_…                -- verbatim copies of all 24 current files, historical record
                                  only, OUTSIDE the CLI's scanned migrations folder (inert
                                  re: tooling).
```

New files use **4-digit numbering** (`0001`+), deliberately distinct from the old
3-digit scheme, so there's no ambiguity about which era a filename belongs to. The
next real future migration becomes `0005`.

Wherever `CLAUDE.md` / `debug.md` cite an old migration number in prose (e.g.
"migration `013` added the bracket column"), the historical prose stays as written
(it's an accurate account of what happened when) plus a short pointer that the
historical numbers now live in `supabase/migrations_archive/`. `debug.md`'s stale
"schema migrations `008`–`014` applied to prod" line is corrected to reflect that
prod is at the full end-state and the files are now consolidated.

### 2. Coupled code change — remove the deprecated columns from the app

Before `0004` can drop `tent_price`/`classroom_price` from prod, remove every
reference so the mapper stops reading/writing them:

- `src/core/entities/settings.ts` — drop the `tentPrice`/`classroomPrice` fields.
- `src/core/validation/content.schema.ts` — drop them from the settings Zod schema.
- `src/data/seed.ts` — drop them from the in-memory seed defaults.
- `src/repositories/supabase/supabase.settings.ts` — drop them from both the write
  column list (`settingsColumns`/insert) and the read mapper (`toSettings`).
- Test fixtures that construct a `CampSettings` with these fields:
  `settings.controller.test.ts`, `accommodation.characterisation.test.ts`,
  `admin.characterisation.test.ts`, `auth.service.test.ts`,
  `checkin.service.test.ts`, `dashboard.service.test.ts` (exact set confirmed by
  grep during implementation).

No runtime service logic depends on these fields (Budget switched to
`registration_cost` in 2026-06-29), so removal is low-risk. `npm run typecheck` +
`npm run test` must be clean after.

### 3. Deprecated-column scope — confirmed against the code before writing `0004`

Step 0 of implementation derives the authoritative candidate list by diffing every
column in the reconstructed baseline against what `src/repositories/supabase/*`
mappers actually read/write (a column is safe to drop only if **no** mapper, entity,
or Zod schema references it). Known result today:

- **Drop:** `settings.tent_price`, `settings.classroom_price` (documented dead).
- **Keep (verified still wired into live code paths, despite prior suspicion):**
  `zones`/`groups` tables, `people.group_id`, `people.accommodation_label`,
  `people.suburb`/`postcode`, `churches.contact_phone`, `settings.check_in_banner`,
  the `defaults` table + `settings.defaults_saved_at` (live new-year scaffold).

The final drop list is shown to the owner for sign-off before any code/SQL change.
Default expectation: just the two `settings` price columns.

### 4. Verification (static, before prod)

A throwaway script (Node/TS, in the session scratchpad — not committed) parses the
old chain (`001`–`023`) and the new chain (`0001`–`0004`), applies each
`create table` / `alter table … add|drop column` / `drop table` in order to an
in-memory per-table column+constraint model, and diffs the two resulting inventories.
Pass criterion: **identical**, net of the intentional deprecated-column drops (which
must be the *only* difference). Then `npm run typecheck` + `npm run test` clean.

(The migrations are simple and uniform enough for a targeted line/regex parser; no
SQL-parser dependency or live Postgres is introduced.)

### 5. Execution sequence against prod (gated, explicit)

Prod is already at the full `001`–`023` end-state, so this is a *history + one small
cleanup* reconciliation, not a schema rebuild.

1. Static verification passes (§4); typecheck + tests clean.
2. Land the file consolidation **+ the §2 code-ref removal** and push to `master`
   (auto-deploys — prod code stops reading/writing `tent_price`/`classroom_price`).
3. Owner confirms the deploy is live, then against prod (via authorized Supabase MCP,
   shown to the owner before each action):
   - Run `0002_rls.sql` for real (idempotent; its only real effect is enabling RLS on
     `allocation_overrides`).
   - Run `0004_drop_deprecated_columns.sql` for real (destructive, one-way — final
     confirm immediately before). Optional `VACUUM FULL settings;` after (the dropped
     data is non-sensitive, so this is housekeeping, not a security requirement).
   - `supabase migration repair --status applied` for the `0001`–`0004` versions
     (metadata-only — marks prod's tracked history caught up without re-executing
     `0001`'s `CREATE TABLE`s / `0003`'s seed insert, which would otherwise fail
     "already exists").
4. Confirm afterward: `supabase migration list --linked` (or `list_migrations` via
   MCP) shows a clean, matching history; smoke-check a **login + a settings save + a
   read endpoint** (a settings save is the specific thing the dropped column would
   have broken).

`0001` is the only file that must never be run against prod (repair-only);
`0002`/`0003`/`0004` are all idempotent and safe to run, but only `0002` (RLS gap)
and `0004` (the drop) need to run — `0003`'s rows already exist.

## Out of scope

- Any `DEPLOYING` guide / new-camp onboarding path (maintenance hygiene only).
- Any behavioural or app-feature change beyond the mechanical removal of the two
  deprecated settings fields.
- The out-of-migration prod DB config (`statement_timeout` role setting; session-mode
  pooler cutover) — untouched, and deliberately not folded into any migration.
- Any change to how future migrations are numbered beyond starting at `0005`.
- Touching prod data beyond the gated deprecated-column DROP, the one RLS-enable, and
  an optional `VACUUM`.
