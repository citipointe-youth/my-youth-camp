# Post-Camp Tidy-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy the camp app after Camp 2026: prune cron history, lock down unused Supabase grants, delete dead routes/code, repair harnesses and add mapper tests, align `seed.ts` with live values, and restructure CLAUDE.md.

**Architecture:** Six independent tasks (A–F). DB changes are repo migration files (`0031`–`0033`) that are written first and applied to prod only on explicit user go-ahead. Code tasks are TDD where behaviour exists (source-inspection test for removed routes, mapper round-trip tests, seed test). Docs task is a lossless script-driven split.

**Tech Stack:** TypeScript/Express (`src/`), Vercel entry `api/index.ts`, vitest, postgres.js, Supabase Postgres (ref `nwfafrgojqkxylbppywo`), single-file SPA `public/index.html` + `public/sw.js`.

**Spec:** `docs/POST-CAMP-REVIEW-2026-10-01.md` (options 5, 8, 9, 14, 15, 16, 25 → this plan's Tasks A–F). Raw audits: `docs/post-camp-audit-2026/audit-*.md`.

**Project dir:** `C:\Users\thoma\OneDrive\Claude Programs\Project 9 - Camp Platform\youth-camp-platform-masterv2` (all paths below are relative to it).

## Global Constraints

- NEVER commit, push, or apply a live DB change without explicit user go-ahead. A push to master deploys straight to prod.
- Every task that touches the live DB STOPS and asks the user before applying. Apply the migration BEFORE pushing code.
- Commit steps are conditional: run only when the user asks; run `git status` first. If asked, end the message with:
  `Co-Authored-By: Claude Code <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Ws8QCpjpHZVmpZoNyq9BcU`.
- Do NOT run `npm audit fix --force` (downgrades `exceljs`).
- Do NOT switch at-camp → pre-camp (would sign out the 74 restored people: 55 youth, 19 leaders). Do NOT run `newYear`/`reset`.
- Leave `settings.last_temp_passwords` and the 21 `needs_review` flags untouched (user decision).
- Cron `camp-push-tick` keeps running. "Move secret" is moot: it already reads Vault (`reads_vault=true, has_literal_bearer=false`). Review-doc lines 44 and 126 are superseded.
- Seed policy: update switchover and windows only. Do NOT seed prices (150/180) or discount tags.
- Keep `POST /setup` and `/internal/cron/tick`.
- Harnesses extract SPA functions BY NAME — never rename SPA functions. Exclude `vpkick-harness.js` from the npm script.
- Mapper rules: `timestamptz` arrives as `Date` → `toISOString()`, never cast; fixtures use real `Date` objects. Never `JSON.stringify` + `::jsonb` (caused the 2026-08-04 wipe) — pass plain arrays/objects.
- Fixture/source mismatch: fix the fixture to match source, never source to match fixture.
- Supabase MCP: multi-statement `execute_sql` returns only the last result — run each verify as its own call. After `apply_migration`, reconcile the generated history version to `'00NN'` once a collision-guard query returns 0; keep `schema_migrations` contiguous.
- Verification baseline: `npm run typecheck` clean and `npm test` = 67 files / 1,179 tests passing before starting; must stay green.
- Model routing: Tasks C, D, E may go to Sonnet subagents (`model: "sonnet"`). Tasks A, B (gated DB) and F (judgment) stay in the main session. Verify any `isolation:"worktree"` base commit by hash.

## File Structure

| File | Action | Task |
|---|---|---|
| `supabase/migrations/0031_prune_cron_job_run_details.sql` | Create | A |
| `supabase/migrations/0032_revoke_anon_authenticated_grants.sql` | Create | B |
| `supabase/migrations/0033_move_pg_net_to_extensions.sql` | Create (separately gated) | B |
| `src/api/http/router.ts` | Modify (remove 10 routes + church-import ctrl) | C |
| `src/api/controllers/{registrant,accommodation,account,camper,notification,church-import}.controller.ts` | Modify/Delete methods | C |
| `src/services/person.service.ts` (+ tests) | Remove dead methods | C |
| `src/repositories/supabase/bulk.ts` | Delete | C |
| `src/api/http/removed-routes.test.ts` | Create (source-inspection) | C |
| `public/index.html`, `public/sw.js` | Remove dead sections; `camp-v143` | C |
| `scripts/budget-xlsx-harness.js`, `scripts/filter-persist-harness.js`, `package.json` | Modify | D |
| `src/repositories/supabase/supabase.{users,churches,settings,schedule,devotionals,faqs,groups,zones,classroom,allocation,reveal-audit}.ts` | Export mappers | D |
| `src/repositories/supabase/*.mapper.test.ts` | Create | D |
| `src/data/seed.ts`, `src/data/seed.test.ts` | Modify / Create | E |
| `scripts/split-claude-md.mjs`, `CLAUDE.md`, `docs/reference/*`, `docs/history/*`, `docs/archive/*` | Create/Modify | F |

---

### Task A: Prune `cron.job_run_details` (review option 5)

**Files:**
- Create: `supabase/migrations/0031_prune_cron_job_run_details.sql`

**Interfaces:**
- Consumes: pg_cron `cron.job`, `cron.job_run_details`; existing job `camp-push-tick` (migration `0014`, untouched).
- Produces: weekly job `camp-cron-prune`; history older than 7 days deleted. Migration number `0031` is consumed (next free is `0032`).

- [ ] **Step 1: Capture the "before" state (read-only)** via Supabase MCP `execute_sql`, one call each:
  - `select count(*) from cron.job_run_details;`
  - `select jobname, schedule, active from cron.job;`
  - `select count(*) from cron.job_run_details where coalesce(end_time,start_time) < now() - interval '7 days';`
  Record the numbers (expect ~18k total, one job `camp-push-tick` active).

- [ ] **Step 2: Write the migration**

```sql
-- 0031: cron.job_run_details is never pruned by pg_cron. Keep 7 days; prune weekly.
delete from cron.job_run_details
 where coalesce(end_time, start_time) < now() - interval '7 days';

select cron.schedule(
  'camp-cron-prune',
  '17 3 * * 0',
  $$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$$
);
```

- [ ] **Step 3: STOP and ask the user** for go-ahead to apply `0031` to prod. Mention: deletes only cron history, adds one weekly job, `camp-push-tick` unchanged. Rollback: `select cron.unschedule('camp-cron-prune');` (deleted history is not recoverable and not needed).

- [ ] **Step 4: On go-ahead, apply** via MCP `apply_migration` (name `prune_cron_job_run_details`).

- [ ] **Step 5: Verify (one call each)**
  - `select count(*) from cron.job_run_details;` → well under the Step 1 count (roughly ≤ 2,100 = 7 days × 288).
  - `select jobname, active from cron.job order by jobname;` → exactly `camp-cron-prune` and `camp-push-tick`, both active.

- [ ] **Step 6: Reconcile history label.** Collision guard: `select count(*) from supabase_migrations.schema_migrations where version = '0031';` must be `0`; then `update supabase_migrations.schema_migrations set version = '0031' where name = 'prune_cron_job_run_details';`. Confirm `select version from supabase_migrations.schema_migrations order by version desc limit 3;` is contiguous (`0031`, `0030`, `0029`).

- [ ] **Step 7: Commit (only if user asks; `git status` first).** `git add supabase/migrations/0031_prune_cron_job_run_details.sql` — message `chore(db): prune cron.job_run_details weekly`.

---

### Task B: Revoke `anon`/`authenticated` grants; relocate `pg_net` (review option 6)

**Files:**
- Create: `supabase/migrations/0032_revoke_anon_authenticated_grants.sql`
- Create: `supabase/migrations/0033_move_pg_net_to_extensions.sql` (separately gated, optional)
- Model: `supabase/migrations/0009_revoke_rls_auto_enable_execute.sql`

**Interfaces:**
- Consumes: app connects as `postgres` via DATABASE_URL (no REST/anon use; Data API disabled), so revoking `anon`/`authenticated` cannot affect the app. RLS is on for all 21 tables.
- Produces: zero `anon`/`authenticated` table grants in `public`; default privileges no longer auto-grant them. `0033` leaves `pg_net` in schema `extensions`.

- [ ] **Step 1: Read `0009` for house style**, then capture "before" (one call each):
  - `select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');` → expect 294 (147 each).
  - `select defaclrole::regrole, defaclacl from pg_default_acl;`

- [ ] **Step 2: Write `0032`**

```sql
-- 0032: the app uses the postgres role only; anon/authenticated have no use for public tables.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

do $$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  exception when insufficient_privilege then
    raise notice 'skipped supabase_admin default privileges (insufficient_privilege)';
  end;
end $$;
```

- [ ] **Step 3: Write `0033`** (header comment must state the rollback below)

```sql
-- 0033: move pg_net out of public (advisor warning). Run right AFTER a camp-push-tick fires (every 5 min).
-- Rollback: begin; drop extension pg_net; create extension pg_net with schema public; commit;
begin;
drop extension pg_net;
create extension pg_net with schema extensions;
commit;
```
  Then check migration `0014`'s cron body: if it calls `net.http_get(...)` unqualified or as `public.net...`, note that the `net` schema is created by the extension regardless of its install schema, so the call is unchanged. Confirm by reading `0014`.

- [ ] **Step 4: STOP and ask the user** for go-ahead on `0032` (state: revokes 294 grants; app unaffected; rollback = `grant all on all tables in schema public to anon, authenticated;` plus sequences). Ask separately about `0033`.

- [ ] **Step 5: On go-ahead apply `0032`** via MCP `apply_migration` (name `revoke_anon_authenticated_grants`).

- [ ] **Step 6: Verify (one call each)**
  - Grants query from Step 1 → `0`.
  - `select defaclrole::regrole, defaclacl from pg_default_acl;` → no `anon=`/`authenticated=` entries (a skipped `supabase_admin` NOTICE is acceptable; report it).
  - `get_advisors` (security) → grants-related lints gone.
  - Smoke: fetch `https://my-youth-camp.vercel.app/ready` → HTTP 200.

- [ ] **Step 7: Reconcile label** exactly as Task A Step 6, with version `0032` and name `revoke_anon_authenticated_grants`.

- [ ] **Step 8 (only if user approves `0033`): apply right after a tick.** Check `select max(created) from net._http_response;` is < 1 minute old, apply `0033` (name `move_pg_net_to_extensions`), then wait for the next tick (≤ 5 min) and verify `select status_code, created from net._http_response order by created desc limit 2;` shows 200 after the apply. If not 200: run the rollback in the `0033` header and report. Reconcile label to `0033`.

- [ ] **Step 9: Commit (only if user asks; `git status` first)** the migration files.

---

### Task C: Delete unused routes and dead code (review option 14)

**Files:**
- Modify: `src/api/http/router.ts` (lines at plan time: 48, 101–103, 113, 122, 124, 158, 186, 228)
- Modify: `src/api/controllers/registrant.controller.ts` (~156–169), `accommodation.controller.ts` (~36 `groups`), `account.controller.ts` (~58 `splitChurches`), `camper.controller.ts` (~93 `getMedicalWatch`), `notification.controller.ts` (`latest`), `church-import.controller.ts`
- Modify: `src/services/person.service.ts` (interface ~71–77; impl ~372, ~395, ~429, ~442) and its tests
- Delete: `src/repositories/supabase/bulk.ts`
- Create: `src/api/http/removed-routes.test.ts`
- Modify: `public/index.html`, `public/sw.js` (line 1)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: router without these paths; `sw.js` `CACHE = 'camp-v143'`.

Routes to remove (method path): `GET /registrants/chase`, `GET /registrants/breakdown`, `POST /registrants/remind`, `GET /accommodation/groups`, `GET /campers/medical`, `GET /notifications/latest`, `POST /import/churches`, `POST /accounts/churches/split`.

- [ ] **Step 1: Write the failing source-inspection test** `src/api/http/removed-routes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const router = readFileSync(resolve(__dirname, 'router.ts'), 'utf8');

describe('router: removed post-camp routes', () => {
  const removed = [
    "path: '/registrants/chase'",
    "path: '/registrants/breakdown'",
    "path: '/registrants/remind'",
    "path: '/accommodation/groups'",
    "path: '/campers/medical'",
    "path: '/notifications/latest'",
    "path: '/import/churches'",
    "path: '/accounts/churches/split'",
  ];
  for (const frag of removed) {
    it(`does not declare ${frag}`, () => {
      expect(router).not.toContain(frag);
    });
  }
  it('keeps /setup and /internal/cron/tick', () => {
    expect(router).toContain("'/setup'");
    expect(router).toContain('/internal/cron/tick');
  });
});
```
  If the router declares `/internal/cron/tick` outside `router.ts`, grep for it (`Grep pattern: internal/cron/tick path: src`) and point the last test at that file instead.

- [ ] **Step 2: Run to confirm failure.** `npx vitest run src/api/http/removed-routes.test.ts` → the 8 "does not declare" tests FAIL.

- [ ] **Step 3: Grep-verify callers before deleting (record results).**
  - SPA/SW: Grep `public/index.html` and `public/sw.js` for each path above (and `registrants/chase`, `campers/medical`, etc.) → expect no hits.
  - Scripts/tests: Grep `src scripts api` for `chase(`, `breakdown(`, `remind(`, `listMedicalWatch`, `getMedicalWatch`, `splitChurches`, `churchImport`, `makeChurchImportController`, `supabase/bulk`, `./bulk`, `/bulk'`, `ChaseResult`, `RegistrantBreakdown`, `reminder:send`.
  - Rule: delete a service method only if its sole callers are the controller methods being removed and its own tests. Keep anything still used by `scripts/split-church-accounts.ts`, `container.ts` wiring that other code needs, `budget.test.ts`, or `account.service.test.ts` — if `splitChurches` service logic is used by `scripts/split-church-accounts.ts`, keep the service method and remove only the controller + route. Keep the `reminder:send` capability if referenced elsewhere.

- [ ] **Step 4: Remove from `router.ts`** the 8 route entries, the `churchImportCtrl` const (line 48) and its import, and the comment at line 122 only if no literal-before-parameterised route remains beneath it (otherwise leave it). Remove the now-unused controller methods listed in **Files**, and `church-import.controller.ts` if it has no remaining route (also remove its `container.ts`/import wiring only if nothing else uses it).

- [ ] **Step 5: Remove dead service methods** per the Step 3 rule, with their tests; remove orphaned types.

- [ ] **Step 6: Delete `src/repositories/supabase/bulk.ts`** after a final conclusive grep (Step 3) shows no importer.

- [ ] **Step 7: Typecheck and test.** `npm run typecheck` (fix dangling imports/unused types) then `npm test`. Expected: clean; test count drops only by removed-feature tests, plus the new 9 route tests.

- [ ] **Step 8: Dead SPA sections in `public/index.html`.** Line numbers drift — Grep first for: `id="student"`, `id="camper"`, `id="adminChurchImport"`, the role→section map entries referencing them (~2075), `RENDER.adminRecords` (~7924; it only redirects), the `adminNewYear()` modal (~10034–10043) and the native `alert(` (~10073). Rules:
  - Remove `#student`, `#camper`, `#adminChurchImport` section markup only if no `RENDER.<name>`, `show('<name>')`, `navTo` or role-map entry still reaches them; remove the matching role-map entries.
  - `RENDER.adminRecords`: remove only if grep shows no caller other than a redirect to itself; otherwise leave.
  - Do NOT touch `adminNewYear()` or the native `alert(` — review-doc items for merging/replacing them are out of scope for this plan. Do NOT rename any function (harnesses extract by name).
  - Run all harnesses afterwards (`node scripts/<name>-harness.js` for each of the 8 passing ones; see Task D for the list) — they must pass.

- [ ] **Step 9: Bump the service worker.** In `public/sw.js` line 1 change `const CACHE = 'camp-v142';` to `const CACHE = 'camp-v143';`. Check the `API_RE` prefix list (~line 15) still covers remaining API prefixes; remove a prefix only if its sole route was deleted and no sibling route uses it.

- [ ] **Step 10: Manual smoke (if dev server practical):** `npm run dev`, load the SPA, log in, confirm the check-in and notification screens render with no console errors. Say explicitly if it was not run.

- [ ] **Step 11: Commit (only if user asks; `git status` first).** Remember: pushing deploys to prod — do not push without separate go-ahead.

---

### Task D: Repair harnesses, add npm script, add mapper tests (review option 15)

**Files:**
- Modify: `scripts/budget-xlsx-harness.js` (~530–531), `scripts/filter-persist-harness.js` (~94–95), `package.json`
- Modify (add `export` only): `src/repositories/supabase/supabase.{users,churches,settings,schedule,devotionals,faqs,groups,zones,classroom,allocation}.ts`
- Create: `src/repositories/supabase/supabase.{users,churches,settings,schedule,devotionals,faqs,groups,zones,classroom,allocation,reveal-audit}.mapper.test.ts`

**Interfaces:**
- Consumes: Task C leaves `index.html` harness-compatible (run after C, or independently — files don't overlap).
- Produces: `npm run harness`; exported mappers named below. Reference test to copy style from: `src/repositories/supabase/supabase.push-subscriptions.mapper.test.ts` (`import { describe, it, expect } from 'vitest'`).

Mapper names (exact): users `toUser`/`userColumns`; churches `toChurch`/`churchColumns`; settings `toSettings`/`settingsCols`; schedule `toItem`/`itemCols`; devotionals `toDev`/`devCols`; faqs `toFaq`/`faqCols`; groups `toGroup`/`groupCols`; zones `toZone`/`zoneCols`; classroom `toRoom`/`roomCols` (rename the private `cols` → `roomCols` and export); allocation `toAlloc`/`allocCols` (rename private `cols` → `allocCols` and export); reveal-audit `toRevealAudit`/`revealAuditColumns` (already exported).

- [ ] **Step 1: Reproduce the two failures.** `node scripts/budget-xlsx-harness.js` and `node scripts/filter-persist-harness.js` → fail (2 and 5 checks).

- [ ] **Step 2: Fix `budget-xlsx-harness.js`.** The payment whitelist `['Full price','Paid in person','Full sponsor','Discounted','']` (~lines 530–531) gains `'Upgrade'` (`_budPayment` returns it for `*-upgrade` classes): `['Full price','Paid in person','Full sponsor','Discounted','Upgrade','']`. Re-run → passes.

- [ ] **Step 3: Fix `filter-persist-harness.js`.** `DEFAULT_MY = { zone:'all', gender:'all', grade:'all' }` → `DEFAULT_MY = { church:'all', gender:'all', grade:'all' }` (matches `MY_FILTER` in `public/index.html` ~1198; verify by reading that line first). Re-run → passes.

- [ ] **Step 4: Add the npm script.** In `package.json` `scripts` add (one line, `&&`-chained, vpkick excluded):

```json
"harness": "node scripts/accom-export-harness.js && node scripts/contact-export-harness.js && node scripts/data-search-harness.js && node scripts/devotional-preview-harness.js && node scripts/login-activity-harness.js && node scripts/pulse-fa-harness.js && node scripts/push-activity-harness.js && node scripts/budget-xlsx-harness.js && node scripts/filter-persist-harness.js"
```
  Run `npm run harness` → exit 0. If another harness fails for a pre-existing reason, report it; do not mask it.

- [ ] **Step 5: Write the first failing mapper test (churches)** `src/repositories/supabase/supabase.churches.mapper.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toChurch, churchColumns } from './supabase.churches';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1', name: 'Citipointe', zone: 'north', contact_phone: null,
  accommodation_override: null, accommodation_per_registration: false,
  contacts: null, created_at: created, updated_at: updated, ...over,
});

describe('churches mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const c = toChurch(row());
    expect(c.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(c.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('defaults nullable fields', () => {
    const c = toChurch(row());
    expect(c.contactPhone).toBeUndefined();
    expect(c.accommodationOverride).toBeNull();
    expect(c.accommodationPerRegistration).toBe(false);
    expect(c.contacts.male.primary).toEqual({ name: '', phone: '' });
    expect(c.contacts.female.backup).toEqual({ name: '', phone: '' });
  });
  it('round-trips row -> toChurch -> churchColumns', () => {
    const r = row({ contact_phone: '0400', accommodation_per_registration: true });
    const cols = churchColumns(toChurch(r));
    expect(cols['name']).toBe('Citipointe');
    expect(cols['contact_phone']).toBe('0400');
    expect(cols['accommodation_per_registration']).toBe(true);
    expect(Array.isArray(cols['contacts'])).toBe(false);
    expect(typeof cols['contacts']).toBe('object');
  });
});
```
  Run `npx vitest run src/repositories/supabase/supabase.churches.mapper.test.ts` → FAIL (`toChurch` not exported). Then add `export` to `toChurch` and `churchColumns` → PASS.

- [ ] **Step 6: Repeat the same cycle for the simple mappers** (one test file each, ≤ 3 tests: Date→ISO where timestamps exist, null/default handling, round-trip). Required assertions per repo, from source:
  - **schedule** (`toItem`/`itemCols`): `endTime`/`location` null → `undefined`; cols `end_time`/`location` `?? null`; fields `id, day, start_time, end_time, title, location, type`.
  - **devotionals** (`toDev`/`devCols`): fields `id, day, verse, reference, reflection, prayer`; round-trip equality of each field.
  - **faqs** (`toFaq`/`faqCols`): fields `id, question, answer, order`; `order` survives round-trip.
  - **groups** (`toGroup`/`groupCols`): `camper_ids` null → `camperIds` `[]`; cols pass the array as a plain array (not a string).
  - **zones** (`toZone`/`zoneCols`): `leader_ids` null → `leaderIds` `[]`; `color_hex`/`label` round-trip; plain array in cols.
  - **classroom** (`toRoom`/`roomCols`): `{id,name,capacity}` round-trip + ISO timestamps.
  - **allocation** (`toAlloc`/`allocCols`): `bracket`/`seq` null → null both ways; no timestamps; fields `id, room_id, church_id, gender, n, bracket, seq`.
  For each: build the row fixture from the column names in that repo's source (open the file first; if a fixture key mismatches, fix the fixture), run to see the "not exported" failure, add `export`, run to PASS.

- [ ] **Step 7: users mapper test** `supabase.users.mapper.test.ts`. Assert: `mobile` null → `undefined`; `gender_scope` null → `null`; `is_dual_gender_login` null → `false`; `must_change_password` null → `false`; `login_history` null → `[]`; timestamps → ISO; round-trip cols use `?? null` for mobile/church_id/church_name/zone/gender_scope/password_hash; `login_history` stays a plain array (`Array.isArray` true, not a string); `UPDATE_COLS` (if exported — else skip, do not export it) omits `id` and `created_at`.

- [ ] **Step 8: settings mapper test** `supabase.settings.mapper.test.ts`. Assert: fallbacks when columns are null — `checkinSwitchoverTime '14:00'`, `checkinWindowAmStart '06:00'`, `checkinWindowAmEnd '12:00'`, `checkinWindowPmStart '12:00'`, `checkinWindowPmEnd '22:00'` (mapper-level defaults; do NOT change them); date columns (`last_exported_at`, `defaults_saved_at`, `form_imported_at`, `tickets_imported_at`, `invoices_imported_at`) → ISO or `null`; `discount_code_tags`/`discount_code_overrides` and `check_in_days` stay plain objects/arrays (not strings); `settingsCols(toSettings(row))` round-trip preserves `camp_mode`, `tent_price`, `classroom_price`. Read `supabase.settings.ts` first for exact column names.

- [ ] **Step 9: reveal-audit test** `supabase.reveal-audit.mapper.test.ts` (functions already exported). Assert: `person_name`/`church_name`/`actor_username`/`actor_initials` null → `''`; `contact_role` null → `null`; `created_at` as `Date` → ISO; and a privacy guard: `Object.keys(revealAuditColumns(toRevealAudit(row)))` contains no key matching `/value|number|phone|medicare|email/i`.

- [ ] **Step 10: Full verification.** `npm run typecheck`, `npm test` (expect 1,179 + new tests, all pass), `npm run harness` (exit 0).

- [ ] **Step 11: Commit (only if user asks; `git status` first).**

---

### Task E: Align `seed.ts` with live values (review option 16)

**Files:**
- Modify: `src/data/seed.ts` (settings block ~138–148)
- Create: `src/data/seed.test.ts`

**Interfaces:**
- Consumes: `seedAll(container: Container): Promise<void>` (idempotent; returns early if users exist); settings via `container.repos.settings` (read the singleton with the repo's get method — find its name in `src/repositories/` interface file).
- Produces: seeded settings with `checkinSwitchoverTime '16:00'`, `checkinWindowAmStart '05:00'`, `checkinWindowPmEnd '23:30'`.

- [ ] **Step 1: Find how tests build an in-memory container.** Open `src/services/auth.service.test.ts` and `src/services/dashboard.service.test.ts` (both mention seed) and copy their container-building helper verbatim into the new test. If none builds a container through `seedAll`, use the in-memory repo factory those tests import.

- [ ] **Step 2: Write the failing test** `src/data/seed.test.ts` (adapt the two marked lines to the helper found in Step 1)

```ts
import { describe, it, expect } from 'vitest';
import { seedAll } from './seed';
// import { buildTestContainer } from '<helper path found in Step 1>';

describe('seedAll settings', () => {
  it('seeds live check-in values and does not seed prices or tags', async () => {
    const container = await buildTestContainer(); // <-- helper from Step 1
    await seedAll(container);
    const s = await container.repos.settings.get(); // <-- actual getter name from the repo interface
    expect(s.checkinSwitchoverTime).toBe('16:00');
    expect(s.checkinWindowAmStart).toBe('05:00');
    expect(s.checkinWindowAmEnd).toBe('12:00');
    expect(s.checkinWindowPmStart).toBe('12:00');
    expect(s.checkinWindowPmEnd).toBe('23:30');
    expect(s.campMode).toBe('pre-camp');
    expect(s.tentPrice ?? null).toBeNull();
    expect(Object.keys(s.discountCodeTags ?? {})).toHaveLength(0);
  });
});
```
  The two marked lines are the only spots needing real names; resolve them from Step 1 and replace the comments. If `tentPrice`/`discountCodeTags` have non-null defaults in the type, assert those defaults instead (read `src/domain` settings type).

- [ ] **Step 3: Run → FAIL** (`'14:00'` vs `'16:00'`).

- [ ] **Step 4: Edit `seed.ts`**: `checkinSwitchoverTime: '16:00'`, `checkinWindowAmStart: '05:00'`, `checkinWindowPmEnd: '23:30'` (leave `checkinWindowAmEnd '12:00'`, `checkinWindowPmStart '12:00'`, `campMode 'pre-camp'`). Add no price or tag fields.

- [ ] **Step 5: Run the new test, then `npm test`** — all pass. If another test asserted the old seed values, update only that assertion.

- [ ] **Step 6: Commit (only if user asks; `git status` first).**

---

### Task F: Restructure CLAUDE.md (review option 25)

**Files:**
- Modify: `CLAUDE.md` (7,083 lines → ~400)
- Create: `scripts/split-claude-md.mjs` (one-off; delete after use or leave under `scripts/`)
- Create: `docs/reference/*.md`, `docs/history/*.md`, `docs/archive/*.md`
- Modify: `debug.md` (stale facts only)
- Read: `docs/post-camp-audit-2026/audit-5-*.md` §4 (split proposal + 13 contradictions)

**Interfaces:**
- Consumes: nothing from other tasks (do after C–E so facts like `camp-v143`, migrations `0031`–`0033` and the new npm scripts are accurate).
- Produces: slim evergreen `CLAUDE.md` with links to the three docs folders. Main-session task (judgment).

- [ ] **Step 1: Backup + heading inventory.** Copy `CLAUDE.md` to `docs/archive/CLAUDE.full-2026-10-02.md` (lossless safety net). Then list headings with line counts:
  `node -e "const l=require('fs').readFileSync('CLAUDE.md','utf8').split(/\r?\n/);let h=[];l.forEach((x,i)=>{if(/^## /.test(x))h.push([i+1,x])});h.forEach((x,i)=>console.log(x[0],((h[i+1]?h[i+1][0]:l.length+1)-x[0]),x[1]))"`

- [ ] **Step 2: Write the section map** to the scratchpad as `claude-split-map.json`: an object `{ "<exact ## heading text>": "keep" | "reference/<file>.md" | "history/<file>.md" | "archive/<file>.md" }`. Classification rules (from the audit-5 proposal):
  - **keep** (evergreen, ≈400 lines): project overview, commands, architecture/layers, deployment + migration process rules, safety constraints (the Global Constraints above), SPA/harness rules, doc-trust rule, pointers to `docs/`.
  - **reference/**: stable subsystem detail (check-in, budget maths, notifications/push, imports, roles/permissions, settings, DB schema notes).
  - **history/**: changelog, per-session notes, incident write-ups (rollover wipe, sponsor tags, `/import/allocations` 500).
  - **archive/**: superseded phase plans and dated status headings.
  Every `##` heading must appear in the map (the script errors otherwise).

- [ ] **Step 3: Write `scripts/split-claude-md.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [,, srcPath, mapPath, outRoot] = process.argv;
const lines = readFileSync(srcPath, 'utf8').split(/\r?\n/);
const map = JSON.parse(readFileSync(mapPath, 'utf8'));

const starts = [];
lines.forEach((l, i) => { if (/^## /.test(l)) starts.push(i); });
const preamble = lines.slice(0, starts[0] ?? lines.length);
const buckets = new Map([['keep', [...preamble]]]);

starts.forEach((s, idx) => {
  const end = starts[idx + 1] ?? lines.length;
  const heading = lines[s].replace(/^## /, '');
  const dest = map[heading];
  if (!dest) throw new Error(`Unmapped heading: ${heading}`);
  const key = dest === 'keep' ? 'keep' : dest;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(...lines.slice(s, end));
});

let total = 0;
for (const [dest, body] of buckets) {
  const file = dest === 'keep' ? join(outRoot, 'CLAUDE.md') : join(outRoot, 'docs', dest);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body.join('\n') + '\n');
  total += body.length;
  console.log(file, body.length);
}
console.log('input lines', lines.length, 'output lines', total);
```
  Run into a scratch dir first: `node scripts/split-claude-md.mjs CLAUDE.md <scratchpad>/claude-split-map.json <scratchpad>/out`. Check the printed `input lines` ≈ `output lines` (equal modulo the trailing newline per file) — lossless.

- [ ] **Step 4: Review the scratch `CLAUDE.md`.** Target ~400 lines. If larger, move more sections via the map and re-run. Add a "Where things live" section linking `docs/reference/`, `docs/history/`, `docs/archive/`, and the doc-trust rule ("trust `git log` over dated headings").

- [ ] **Step 5: Fix the contradictions** in the kept/reference files (verify each against code, never against another doc):
  - Session lifetime: grep `TOKEN_TTL_MS` in `src/` and state that single value (48h per the review).
  - "Next migration = 0021/0016" / "0014 not applied": replace with "next migration: `0034`" (after `0031`–`0033`; use `0032` if `0033` was not created) and note the migrations directory is the source of truth.
  - CHANGELOG stopping at 31 Jul: add a one-line pointer to `git log` for later history, plus a 2026-09/10 camp entry.
  - `debug.md` "SPA ~9,450 lines": replace with the real count (`wc -l public/index.html`; ~10,999 before Task C) — state "about N lines".
  - Rollover temp-password behaviour: read the rollover service code, then state its actual behaviour once.
  - Missing `camp-v132` label: note "no `camp-v132` label exists".
  - Also record: cron `camp-push-tick` reads Vault (not a literal bearer); `camp-cron-prune` job; the new `npm run harness`.

- [ ] **Step 6: Install.** Copy the scratch output into the project (overwrites `CLAUDE.md`; the backup in `docs/archive/` is the rollback). Run `git status` first.

- [ ] **Step 7: Verify.** `wc -l CLAUDE.md` ≈ 400; every link in the new `CLAUDE.md` resolves (`node -e` loop over `](docs/...)` matches with `fs.existsSync`); `npm test` still passes (no test reads CLAUDE.md — grep `CLAUDE.md` in `src scripts` to confirm and fix any that do).

- [ ] **Step 8: Commit (only if user asks; `git status` first).**

---

## Execution Order and Gates

1. **C, D, E** are code-only and independent (disjoint files except Task D's harnesses reading `public/index.html`; run D's harness steps after C). Safe to delegate to Sonnet subagents; review each diff.
2. **A, B** need live-DB go-ahead: present the migration SQL and wait. Apply before any code push.
3. **F** last, so docs reflect the final state.
4. Final: `npm run typecheck && npm test && npm run harness`. Pushing to master deploys to prod — never without explicit go-ahead.

## Self-Review

- **Spec coverage:** option 5 → A (secret-move dropped, documented); 6 → B; 14 → C; 15 → D; 16 → E; 25 → F. Review items 1–4, 7 (temp passwords/needs_review left), 10–13, 17–24 intentionally excluded per user.
- **Placeholder scan:** the only open names are resolved by explicit "read the file first" steps (settings column names, container helper, settings getter). SPA/service deletions are rule-bound with grep gates rather than line-number assumptions, because line numbers drift.
- **Type consistency:** mapper names are fixed once in Task D's list and reused in its steps; `camp-v143`, migration numbers `0031`–`0033`, and seed values `16:00 / 05:00 / 23:30` are consistent across Global Constraints and tasks.
