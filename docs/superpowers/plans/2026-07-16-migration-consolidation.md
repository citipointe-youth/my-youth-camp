# Migration Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 24-file `supabase/migrations/` chain (`001`–`023`, incl. a duplicate `004`) into 4 clean 4-digit files that reproduce the current prod end-state minus the deprecated `settings.tent_price`/`classroom_price` columns, archive the originals, and reconcile prod.

**Architecture:** Author a consolidated baseline (`0001`) + RLS (`0002`) + seed (`0003`) + a gated deprecated-column drop (`0004`); archive `001`–`023` verbatim under `migrations_archive/`; verify equivalence with a throwaway static column-inventory diff (no live DB); then land a coupled code change that removes the two dead columns from the app before dropping them from prod.

**Tech Stack:** Supabase Postgres, TypeScript/Express backend, Vitest, Node (for the throwaway verifier), Supabase MCP + CLI (for the gated prod step).

## Global Constraints

- **Prod (`nwfafrgojqkxylbppywo`, citipointe-youth) is already at the full `001`–`023` end-state**, including field-encryption `022`/`023` + backfill + `VACUUM FULL`. Do NOT rebuild prod's schema — only the one reviewed column drop + the one RLS-enable touch prod.
- **Dropping `tent_price`/`classroom_price` is coupled code+schema.** Remove the code refs and deploy them LIVE **before** dropping the columns from prod, or every settings save 500s ("column does not exist"). Same relax-then-drop discipline as `008 → 009`.
- **Verification is static/scripted** — no live throwaway DB. Column-inventory diff of old vs new chains; prod smoke-test is the final safety net.
- **New files use 4-digit numbering** (`0001`+); the old 3-digit files move to `supabase/migrations_archive/` verbatim. Next future migration = `0005`.
- **Verify convention (this repo):** `npm run typecheck` + `npm run test`; do NOT start a dev server or drive a browser. A push to `master` is the deploy — only push when the owner is ready.
- **Baseline must reflect the encrypted `people` shape:** the four `*_enc text` columns present; the four legacy plaintext columns (`medical_conditions`, `dietary_requirements`, `consents`, `blue_card_expiry`) absent. In-place-encrypted scalars (`other_medications`, `medicare_number`, `blue_card_number`, `parent_*`, `notes.body`) stay ordinary `text` at the DDL level.
- **Out of scope, do not touch:** any `DEPLOYING`/onboarding guide; the out-of-migration prod config (`ALTER ROLE postgres SET statement_timeout`, session-mode pooler cutover); any app-feature/behaviour change beyond removing the two deprecated fields.

Design doc: `docs/superpowers/specs/2026-07-16-migration-consolidation-design.md`.

---

### Task 1: Confirm the deprecated-column drop list

**Files:**
- Read-only audit across `src/`.

**Interfaces:**
- Produces: the confirmed list of columns `0004` will drop. Expected result: exactly `settings.tent_price` + `settings.classroom_price`.

- [ ] **Step 1: Grep the two known candidates**

Run (from repo root):
```bash
grep -rn "tent_price\|classroom_price\|tentPrice\|classroomPrice" src/ | grep -v ".test."
```
Expected: hits only in `src/core/entities/settings.ts`, `src/core/validation/content.schema.ts`, `src/data/seed.ts`, `src/repositories/supabase/supabase.settings.ts`. (Test-file hits are handled in Task 2.)

- [ ] **Step 2: Sanity-check no other column is silently dead**

Run:
```bash
grep -rniE "check_in_banner|accommodation_locked|contact_phone|group_id|accommodation_label|defaults_saved_at" src/ | grep -v ".test." | grep -vc README
```
Expected: non-zero for each — these are **still wired**, confirming they must be KEPT (do not add them to `0004`). If any returns zero references, STOP and report to the owner before expanding the drop list.

- [ ] **Step 3: Record the confirmed list**

Confirmed drop list = `settings.tent_price`, `settings.classroom_price`. No commit (audit only).

---

### Task 2: Remove `tentPrice`/`classroomPrice` from the app (coupled code change)

**Files:**
- Modify: `src/core/entities/settings.ts`
- Modify: `src/core/validation/content.schema.ts`
- Modify: `src/data/seed.ts`
- Modify: `src/repositories/supabase/supabase.settings.ts`
- Modify (test fixtures): `src/api/controllers/settings.controller.test.ts`, `src/services/accommodation.characterisation.test.ts`, `src/services/admin.characterisation.test.ts`, `src/services/auth.service.test.ts`, `src/services/checkin.service.test.ts`, `src/services/dashboard.service.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `CampSettings` type with no `tentPrice`/`classroomPrice`; a `supabase.settings` mapper that neither reads nor writes those columns.

- [ ] **Step 1: Locate every reference**

Run:
```bash
grep -rnE "tent_price|classroom_price|tentPrice|classroomPrice" src/
```
Record the exact lines. Snake_case (`tent_price`/`classroom_price`) will be in `supabase.settings.ts` only; camelCase in the entity/schema/seed and the six test files.

- [ ] **Step 2: Remove from the entity**

In `src/core/entities/settings.ts`, delete the `tentPrice` and `classroomPrice` field declarations from the `CampSettings` interface/type (and any default object in that file if present).

- [ ] **Step 3: Remove from the Zod schema**

In `src/core/validation/content.schema.ts`, delete the `tentPrice`/`classroomPrice` keys from the settings schema (and any `.default(...)` for them).

- [ ] **Step 4: Remove from the in-memory seed**

In `src/data/seed.ts`, delete `tentPrice`/`classroomPrice` from the seeded settings object.

- [ ] **Step 5: Remove from the Supabase mapper (both directions)**

In `src/repositories/supabase/supabase.settings.ts`, delete `tent_price`/`classroom_price` from BOTH the write column list (the insert/`on conflict do update` column set) AND the read mapper (`toSettings`, the `row.tent_price → tentPrice` lines). After this, the mapper must not name the columns at all.

- [ ] **Step 6: Update the six test fixtures**

In each of the six test files from **Files**, remove `tentPrice`/`classroomPrice` from any `CampSettings` fixture object and any assertion that reads them. (These are fixture-construction sites, not behavioural assertions — no test intent changes.)

- [ ] **Step 7: Verify types + tests**

Run:
```bash
npm run typecheck && npm run test
```
Expected: typecheck clean; all tests pass (count unchanged from the pre-task baseline). If a test still references the removed fields, fix that fixture and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/core/entities/settings.ts src/core/validation/content.schema.ts src/data/seed.ts src/repositories/supabase/supabase.settings.ts src/api/controllers/settings.controller.test.ts src/services/accommodation.characterisation.test.ts src/services/admin.characterisation.test.ts src/services/auth.service.test.ts src/services/checkin.service.test.ts src/services/dashboard.service.test.ts
git commit -m "refactor(settings): drop deprecated tentPrice/classroomPrice fields"
```

---

### Task 3: Author `0001_baseline_schema.sql`

**Files:**
- Create: `supabase/migrations/0001_baseline_schema.sql`

**Interfaces:**
- Produces: the full 17-table end-state schema. Later verified column-for-column against the old chain in Task 5.

- [ ] **Step 1: Write the baseline file**

Create `supabase/migrations/0001_baseline_schema.sql` with EXACTLY this content:

```sql
-- 0001: Consolidated baseline schema for the Youth Camp Platform.
--
-- Reproduces the exact end-state of the original migrations 001–023 (archived
-- verbatim in supabase/migrations_archive/), MINUS the deprecated settings columns
-- tent_price/classroom_price (dropped in 0004), and reflecting the field-encryption
-- end-state: people.*_enc columns present; the four legacy plaintext columns dropped
-- by the old 023 are absent.
--
-- DESIGN NOTES (carried from 001):
--  * IDs are TEXT, generated in-app (utils/id.ts: "<prefix>_<hex>"), NOT db uuids.
--  * Relational child tables for queried/aggregated data; JSONB for fixed-shape blobs.
--  * Unified `people` table: registrants + campers, distinguished by `lifecycle`.
--  * The Express API connects as the postgres superuser (DATABASE_URL), bypassing RLS.
--    RLS is enabled in 0002 as defence-in-depth against a leaked anon key.
--  * Several sensitive people/notes columns hold AES-256-GCM ciphertext at runtime
--    (field-encryption design); they are ordinary text/jsonb at the DDL level.

create table users (
  id text primary key,
  first_name text not null,
  last_name text not null,
  username text unique not null,   -- login identifier (a username, not an email)
  mobile text,
  role text not null,              -- church | zoneLeader | director | admin | firstAid
  church_id text,
  church_name text,
  zone text,
  status text not null default 'active',
  password_hash text,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table churches (
  id text primary key,
  name text not null,
  zone text not null,
  contact_phone text,
  contacts jsonb not null default '{}'::jsonb,
  accommodation_override text
    check (accommodation_override in ('tent', 'classroom') or accommodation_override is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table people (
  id text primary key,
  first_name text not null,
  last_name text not null,
  gender text not null,               -- male | female | other
  date_of_birth date,
  grade int,
  school text,
  kind text not null default 'youth', -- youth | leader
  church_id text references churches(id) on delete set null,
  church_name text not null,
  zone text not null,
  group_id text,
  mobile text,
  email text,
  suburb text,
  postcode text,
  state text,
  other_medications text,             -- encrypted in place
  parent_guardian_name text,          -- encrypted in place
  parent_phone text,                  -- encrypted in place
  parent_relation text,               -- encrypted in place
  blue_card_number text,              -- encrypted in place
  payment_status text not null default 'unpaid',
  accommodation_kind text,
  accommodation_label text,
  lifecycle text not null default 'registered',
  at_camp boolean not null default false,
  medicare_number text,               -- encrypted in place
  church_unlisted_note text,
  elvanto_meta jsonb,
  registration_type text,
  registration_cost numeric,
  discount_code text,
  ticket_number text,
  invoice_number text,
  accommodation_kind_confidence text
    check (accommodation_kind_confidence in ('guessed', 'confirmed') or accommodation_kind_confidence is null),
  discount_amount numeric,
  amount_paid numeric,
  fees_amount numeric,
  tax_amount numeric,
  needs_review boolean not null default false,
  needs_review_reason text,
  medical_conditions_enc text,        -- AES-GCM ciphertext (was text[])
  dietary_requirements_enc text,      -- AES-GCM ciphertext (was text[])
  consents_enc text,                  -- AES-GCM ciphertext (was jsonb)
  blue_card_expiry_enc text,          -- AES-GCM ciphertext (was date)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_church_idx on people(church_id);
create index people_zone_idx on people(zone);
create index people_lifecycle_idx on people(lifecycle);

create table check_in_history (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  session_id text not null,
  session_label text not null,
  type text not null,                 -- in | out
  leader_id text not null,
  timestamp timestamptz not null default now()
);
create index check_in_history_person_idx on check_in_history(person_id);
create index check_in_history_session_idx on check_in_history(session_id);

create table sign_out_history (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  type text not null,                 -- out | in
  leader_name text not null,
  reason text,
  parents_met boolean,
  author_id text not null,
  timestamp timestamptz not null default now()
);
create index sign_out_history_person_idx on sign_out_history(person_id);

create table classrooms (
  id text primary key,
  name text not null,
  capacity int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table classroom_allocations (
  id text primary key,
  room_id text not null references classrooms(id) on delete cascade,
  church_id text not null,
  gender text not null,               -- male | female
  n int not null default 0,
  bracket text                        -- 7-9 | 10-12 | null (non-split pool)
);
create index classroom_allocations_room_idx on classroom_allocations(room_id);
create index classroom_allocations_church_idx on classroom_allocations(church_id);

create table zones (
  id text primary key,
  name text not null,
  label text not null default '',
  color_hex text not null default '#000000',
  leader_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table groups (
  id text primary key,
  name text not null,
  church_id text,
  zone text,
  leader_id text,
  camper_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notes (
  id text primary key,
  camper_id text,                     -- nullable: general testimony has no student
  body text not null,                 -- encrypted in place
  author_id text not null,
  author_name text not null,
  author_church_id text,
  session_id text,
  category text,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);
create index notes_camper_idx on notes(camper_id);

create table notifications (
  id text primary key,
  scope text not null,                -- camp | zone | church
  zone text,
  church_id text,
  priority text not null default 'normal',
  title text not null,
  body text not null,
  sender_id text,
  sender_name text,
  sender_role text,
  audience_estimate int,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_created_idx on notifications(created_at desc);

create table schedule_items (
  id text primary key,
  day text not null,
  start_time text not null,
  end_time text,
  title text not null,
  location text,
  type text not null,                 -- meal | session | activity | free | logistics
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table devotionals (
  id text primary key,
  day text not null,
  verse text not null,
  reference text not null,
  reflection text not null,
  prayer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table faqs (
  id text primary key,
  question text not null,
  answer text not null,
  "order" int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table settings (
  id text primary key default 'settings',
  camp_name text not null default 'Youth Camp',
  year int not null,
  start_date text not null,
  end_date text not null,
  timezone text not null default 'Australia/Brisbane',
  check_in_banner text,
  check_in_days text[] not null default '{}',
  accommodation_locked boolean not null default false,
  camp_mode text not null default 'pre-camp',   -- pre-camp | at-camp
  last_temp_passwords jsonb,
  last_exported_at timestamptz,
  church_login_locked boolean not null default false,
  zone_leader_login_locked boolean not null default false,
  church_checkin_time_restricted boolean not null default false,
  defaults_saved_at timestamptz,
  form_imported_at timestamptz,
  tickets_imported_at timestamptz,
  invoices_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 'settings')
);

create table defaults (
  id text primary key default 'defaults',
  snapshot jsonb not null,            -- CampDefaults blob (churches/users/.../devotionals)
  created_at timestamptz not null default now(),
  constraint defaults_singleton check (id = 'defaults')
);

create table allocation_overrides (
  id text primary key,
  person_id text not null,
  first_name_key text not null default '',
  last_name_key text not null default '',
  mobile_key text not null default '',
  assigned_church_id text not null,
  assigned_church_name text not null default '',
  form_church text not null default '',
  kind text not null default 'unallocated',
  note text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Syntax-sanity the file**

Run:
```bash
grep -c "create table" supabase/migrations/0001_baseline_schema.sql
```
Expected: `17`. (No commit yet — committed with the rest of the consolidation in Task 7.)

---

### Task 4: Author `0002_rls.sql`, `0003_seed.sql`, `0004_drop_deprecated_columns.sql`

**Files:**
- Create: `supabase/migrations/0002_rls.sql`
- Create: `supabase/migrations/0003_seed.sql`
- Create: `supabase/migrations/0004_drop_deprecated_columns.sql`

**Interfaces:**
- Consumes: the 17 tables from `0001` (Task 3).
- Produces: RLS on all 17 tables; the seed admin+settings singleton; the gated deprecated-column drop.

- [ ] **Step 1: Write `0002_rls.sql`**

Create `supabase/migrations/0002_rls.sql` with EXACTLY:

```sql
-- 0002: Row-Level Security on every live table (defence-in-depth).
--
-- The Express API connects as the postgres superuser (DATABASE_URL), which BYPASSES
-- RLS — so the app keeps working with no policies. With RLS on and no anon policies,
-- any connection using the Supabase anon key is denied all rows.
--
-- Idempotent: `enable row level security` is a no-op where already on. The only table
-- this newly covers vs. the old 003/004 pair is allocation_overrides (old 020 never
-- enabled RLS on it).
alter table users                 enable row level security;
alter table churches              enable row level security;
alter table people                enable row level security;
alter table check_in_history      enable row level security;
alter table sign_out_history      enable row level security;
alter table classrooms            enable row level security;
alter table classroom_allocations enable row level security;
alter table zones                 enable row level security;
alter table groups                enable row level security;
alter table notes                 enable row level security;
alter table notifications         enable row level security;
alter table schedule_items        enable row level security;
alter table devotionals           enable row level security;
alter table faqs                  enable row level security;
alter table settings              enable row level security;
alter table defaults              enable row level security;
alter table allocation_overrides  enable row level security;
```

- [ ] **Step 2: Create `0003_seed.sql` as a verbatim copy of the old seed**

Run:
```bash
cp supabase/migrations/002_seed_admin.sql supabase/migrations/0003_seed.sql
```

- [ ] **Step 3: Confirm the copied seed references no dropped column**

Run:
```bash
grep -niE "tent_price|classroom_price|check_in_location|check_in_from|register_base_url|self_register_slug|expected_count|youth_pastor_name|contact_email|is_check_in_point|\bcode\b|\bcolor\b" supabase/migrations/0003_seed.sql
```
Expected: **no output**. (The old seed only inserts the admin `users` row + the `settings` singleton using columns that all still exist.) If anything matches, STOP — the seed needs those columns removed before it can run against the baseline.

- [ ] **Step 4: Write `0004_drop_deprecated_columns.sql`**

Create `supabase/migrations/0004_drop_deprecated_columns.sql` with EXACTLY:

```sql
-- 0004: Drop the deprecated settings pricing columns.
--
-- tent_price/classroom_price were deprecated 2026-06-29 (Budget reads per-registrant
-- registration_cost; both were removed from the Settings UI, columns left in the DB).
-- 0001 never creates them, so this is a no-op on a fresh deploy; against prod it is the
-- real cleanup.
--
-- PRECONDITION: the app code no longer references these columns (settings entity,
-- content.schema, seed, supabase.settings mapper — Task 2) and that deploy is LIVE.
-- Otherwise the next settings save fails "column ... does not exist". See design §2/§5.
alter table settings
  drop column if exists tent_price,
  drop column if exists classroom_price;
```

- [ ] **Step 5: Confirm the four new files exist**

Run:
```bash
ls supabase/migrations/0001_baseline_schema.sql supabase/migrations/0002_rls.sql supabase/migrations/0003_seed.sql supabase/migrations/0004_drop_deprecated_columns.sql
```
Expected: all four listed. (No commit yet.)

---

### Task 5: Write & run the static equivalence verifier

**Files:**
- Create: `<scratchpad>/verify-migration-consolidation.mjs` (throwaway — NOT committed to the repo)

**Interfaces:**
- Consumes: the old `001`–`023` files and the new `0001`–`0004` files, all still present together in `supabase/migrations/`.
- Produces: PASS/FAIL. PASS = the two chains have identical per-table column inventories, net of `settings` losing exactly `tent_price` + `classroom_price`.

- [ ] **Step 1: Write the verifier**

Save to the session scratchpad as `verify-migration-consolidation.mjs`:

```js
// Throwaway static verifier — compares column inventories of the old 3-digit chain
// vs the new 4-digit chain. Usage: node verify-migration-consolidation.mjs <migrationsDir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] || 'supabase/migrations';
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const oldFiles = files.filter(f => /^\d{3}_/.test(f));
const newFiles = files.filter(f => /^\d{4}_/.test(f));

function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function handle(stmt, tables) {
  const s = stmt.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = /^create table (?:if not exists )?"?(\w+)"? \((.*)\)$/i.exec(s))) {
    const cols = new Set();
    for (const part of splitTop(m[2], ',')) {
      const p = part.trim();
      if (/^(constraint|primary|unique|check|foreign|exclude)\b/i.test(p)) continue;
      const cm = /^"?(\w+)"?/.exec(p);
      if (cm) cols.add(cm[1]);
    }
    tables.set(m[1], cols);
  } else if ((m = /^drop table (?:if exists )?"?(\w+)"?/i.exec(s))) {
    tables.delete(m[1]);
  } else if ((m = /^alter table (?:if exists )?"?(\w+)"? (.*)$/i.exec(s))) {
    const cols = tables.get(m[1]); if (!cols) return;
    for (const a of m[2].matchAll(/\badd (?:column )?(?:if not exists )?"?(\w+)"?/gi)) cols.add(a[1]);
    for (const d of m[2].matchAll(/\bdrop column (?:if exists )?"?(\w+)"?/gi)) cols.delete(d[1]);
  }
}

function applyChain(list) {
  const tables = new Map();
  for (const f of list) {
    const sql = readFileSync(join(DIR, f), 'utf8').replace(/--[^\n]*\n/g, '\n');
    for (const stmt of splitTop(sql, ';')) handle(stmt, tables);
  }
  return tables;
}

const oldT = applyChain(oldFiles);
const newT = applyChain(newFiles);
const EXPECTED_REMOVED = { settings: new Set(['tent_price', 'classroom_price']) };

let problems = 0;
for (const t of [...new Set([...oldT.keys(), ...newT.keys()])].sort()) {
  if (!oldT.has(t)) { console.error(`EXTRA TABLE in new: ${t}`); problems++; continue; }
  if (!newT.has(t)) { console.error(`MISSING TABLE in new: ${t}`); problems++; continue; }
  const o = oldT.get(t), n = newT.get(t);
  const removed = [...o].filter(c => !n.has(c));
  const added = [...n].filter(c => !o.has(c));
  const expected = EXPECTED_REMOVED[t] || new Set();
  const badRemoved = removed.filter(c => !expected.has(c));
  const missed = [...expected].filter(c => !removed.includes(c));
  if (badRemoved.length) { console.error(`${t}: unexpectedly REMOVED ${badRemoved.join(', ')}`); problems++; }
  if (added.length)      { console.error(`${t}: unexpectedly ADDED ${added.join(', ')}`); problems++; }
  if (missed.length)     { console.error(`${t}: expected drop still present ${missed.join(', ')}`); problems++; }
}
console.log(`old tables=${oldT.size} new tables=${newT.size}`);
if (problems) { console.error(`\nFAIL: ${problems} difference(s)`); process.exit(1); }
console.log('PASS: chains match, net of settings.{tent_price,classroom_price}');
```

- [ ] **Step 2: Run it**

Run (substitute the real scratchpad path):
```bash
node <scratchpad>/verify-migration-consolidation.mjs "supabase/migrations"
```
Expected output ends with:
```
old tables=17 new tables=17
PASS: chains match, net of settings.{tent_price,classroom_price}
```
If it reports any unexpected ADDED/REMOVED/MISSING, fix `0001` (Task 3) — the baseline is authoritative — and re-run until PASS. (Note: the old chain creates and later drops `reservations`/`accommodation_blocks`, so those correctly do not appear in either inventory.)

- [ ] **Step 3: Eyeball types once**

The verifier compares column *names*, not types. Open `0001_baseline_schema.sql` and confirm by eye against the archived originals that the four `*_enc` columns are `text`, `check_in_days`/`leader_ids`/`camper_ids` are `text[]`, and `elvanto_meta`/`contacts`/`snapshot`/`consents_enc` line up. No commit (throwaway verifier stays in scratchpad).

---

### Task 6: Archive the originals + update the docs

**Files:**
- Move: `supabase/migrations/001_*.sql` … `023_*.sql` → `supabase/migrations_archive/`
- Modify: `CLAUDE.md`
- Modify: `debug.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `supabase/migrations/` containing ONLY `0001`–`0004`; `supabase/migrations_archive/` containing the 24 originals.

- [ ] **Step 1: Move the originals into the archive**

Run:
```bash
mkdir -p supabase/migrations_archive
git mv supabase/migrations/0[0-2][0-9]_*.sql supabase/migrations_archive/ 2>/dev/null || (mkdir -p supabase/migrations_archive && for f in supabase/migrations/[0-9][0-9][0-9]_*.sql; do git mv "$f" supabase/migrations_archive/; done)
ls supabase/migrations/
```
Expected `ls`: only `0001_baseline_schema.sql`, `0002_rls.sql`, `0003_seed.sql`, `0004_drop_deprecated_columns.sql`.

- [ ] **Step 2: Confirm the archive holds all 24**

Run:
```bash
ls supabase/migrations_archive/ | wc -l
```
Expected: `24`.

- [ ] **Step 3: Add a consolidation note to `CLAUDE.md`**

Add a new dated section near the top of `CLAUDE.md`'s changelog area:

```markdown
## Migration files consolidated — 2026-07-16

`supabase/migrations/` was collapsed from 24 files (`001`–`023`, incl. a duplicate
`004`) into four 4-digit files: `0001_baseline_schema.sql` (full end-state, minus the
deprecated `settings.tent_price`/`classroom_price` columns, reflecting the encrypted
`people` shape), `0002_rls.sql` (RLS on all 17 tables — also closes the gap where the
old `020` never enabled RLS on `allocation_overrides`), `0003_seed.sql` (admin +
settings singleton, verbatim from the old `002`), and `0004_drop_deprecated_columns.sql`
(gated drop of the two dead pricing columns). The 24 originals are preserved verbatim in
`supabase/migrations_archive/` (historical record; outside the CLI's scanned folder).
Historical prose in this file that cites an old migration number (e.g. "migration `013`
added `bracket`") still refers to those archived files. Prod was already at the full
`001`–`023` end-state; it was reconciled via `0002`+`0004` for real + a metadata
history catch-up. Design: `docs/superpowers/specs/2026-07-16-migration-consolidation-design.md`.
Next future migration = `0005`.
```

- [ ] **Step 4: Correct the stale line in `debug.md`**

In `debug.md`, find the backend verification paragraph containing `Schema migrations 008–014 applied to prod` (grep it: `grep -n "008.*014 applied" debug.md`). Replace that sentence with:

```markdown
Schema migrations are **consolidated** (2026-07-16) into `supabase/migrations/0001`–`0004`;
the original `001`–`023` are archived verbatim in `supabase/migrations_archive/`. Prod is at
the full end-state (incl. field-encryption `022`/`023`). `src/repositories/supabase/*` must not
reference dropped columns (`tent_price`/`classroom_price` were dropped by `0004`).
```

- [ ] **Step 5: Verify types + tests still clean**

Run:
```bash
npm run typecheck && npm run test
```
Expected: clean (no code changed since Task 2, but confirm the moves didn't disturb anything the build reads).

---

### Task 7: Commit the consolidation (deploy-gated on owner)

**Files:**
- Commit: the four new migration files, the 24 archived files, `CLAUDE.md`, `debug.md`.

- [ ] **Step 1: Stage and commit**

```bash
git add supabase/migrations supabase/migrations_archive CLAUDE.md debug.md
git commit -m "chore(db): consolidate migrations 001-023 into 0001-0004 baseline + archive"
```

- [ ] **Step 2: Report readiness to the owner**

State plainly: the code-ref removal (Task 2) and the file consolidation are committed. **Pushing to `master` deploys the code-ref removal** — which MUST be live before the prod column drop in Task 8. Ask the owner to authorize the push (or push themselves). Do NOT push without that go-ahead.

---

### Task 8: Reconcile prod (GATED — owner-authorized, run WITH the owner)

**Files:** none (prod DB operations via Supabase MCP / CLI).

**Preconditions (all must hold before starting):**
- Task 2's code-ref removal is committed AND deployed live to prod (owner confirms the push shipped).
- The owner has authorized the citipointe-youth Supabase MCP connection (or will run the CLI themselves).

**Interfaces:**
- Consumes: the confirmed prod migration-tracking state (determined in Step 1).
- Produces: prod with RLS on `allocation_overrides`, `tent_price`/`classroom_price` dropped, and a clean migration history.

- [ ] **Step 1: Inspect prod's actual migration-tracking state**

Load the Supabase MCP tools, then run (via `execute_sql` against the citipointe-youth project `nwfafrgojqkxylbppywo`):
```sql
select version, name from supabase_migrations.schema_migrations order by version;
```
- If it lists the old `001`–`023` (or their timestamped equivalents) → prod history is **CLI-tracked** → do the metadata catch-up in Step 4a.
- If the table is empty / errors "relation does not exist" → prod was applied by **SQL-editor paste** (untracked) → **skip Step 4a entirely** (nothing to repair; the files are reorganized for humans only).

Also confirm the schema is at the field-encryption end-state:
```sql
select column_name from information_schema.columns
where table_name = 'people' and column_name in
  ('medical_conditions','medical_conditions_enc','blue_card_expiry','blue_card_expiry_enc');
```
Expected: `medical_conditions_enc` + `blue_card_expiry_enc` present; `medical_conditions` + `blue_card_expiry` absent. If the legacy columns still exist, STOP — prod is NOT actually at `023` and this plan's assumption is wrong; report to the owner.

- [ ] **Step 2: Run `0002_rls.sql` against prod (idempotent)**

Via `apply_migration` (name `0002_rls`) OR `execute_sql`, run the exact contents of `supabase/migrations/0002_rls.sql`. Effect: no-op on the 16 already-enabled tables; enables RLS on `allocation_overrides`. Verify:
```sql
select relname from pg_class where relrowsecurity = true and relnamespace = 'public'::regnamespace order by relname;
```
Expected: all 17 live tables listed (incl. `allocation_overrides`).

- [ ] **Step 3: Run `0004_drop_deprecated_columns.sql` against prod (destructive)**

**Final confirm with the owner immediately before running** — this is one-way. Then run the exact contents of `supabase/migrations/0004_drop_deprecated_columns.sql`. Verify:
```sql
select column_name from information_schema.columns
where table_name = 'settings' and column_name in ('tent_price','classroom_price');
```
Expected: **no rows**. (Optional housekeeping, non-sensitive data: `VACUUM FULL settings;` — run outside a transaction, only if the owner wants the space reclaimed.)

- [ ] **Step 4a: Metadata history catch-up — ONLY if Step 1 found CLI-tracked history**

Preferred (Supabase CLI, run by the owner or in an authorized shell):
```bash
supabase link --project-ref nwfafrgojqkxylbppywo
supabase migration repair --status applied 0001 0002 0003 0004
supabase migration repair --status reverted 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023
supabase migration list --linked
```
(The `reverted` line clears the old 3-digit versions from tracked history so `list` shows only `0001`–`0004` as applied. If the CLI complains about a version string, match the exact `version` values seen in Step 1.)

MCP-only alternative (if no CLI access) — reconcile `schema_migrations` directly via `execute_sql`, shown to the owner first:
```sql
-- record the four new versions as applied, drop the 24 old ones
insert into supabase_migrations.schema_migrations (version, name)
values ('0001','baseline_schema'),('0002','rls'),('0003','seed'),('0004','drop_deprecated_columns')
on conflict (version) do nothing;
delete from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$';
```

- [ ] **Step 4b: If Step 1 found untracked (SQL-editor) history**

Nothing to reconcile — skip. The prod schema changes from Steps 2–3 are the only prod actions.

- [ ] **Step 5: Smoke-test prod**

Ask the owner to (or via an authorized read) confirm on `https://my-youth-camp.vercel.app`:
1. Admin can **log in**.
2. Admin **Settings → Save** succeeds (this is the exact operation the dropped column would have broken — the critical check).
3. A read screen (e.g. Data/registrants) loads normally.

If the settings save fails with "column ... does not exist", the code deploy (Task 2) was not actually live before Step 3 — redeploy the code; the column is already gone, so once the new code is live the save works.

- [ ] **Step 6: Final report**

Confirm to the owner: files consolidated (`0001`–`0004` + archive), prod reconciled (RLS gap closed, deprecated columns dropped, history clean), smoke-test green.
```
