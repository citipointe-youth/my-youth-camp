# Login Activity Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin see, per account, when it last logged in (and its last ~15 login timestamps on request), so they can spot which churches haven't logged in yet on move-in day and reach out to help.

**Architecture:** This app currently has **zero login tracking** — sessions are stateless signed HMAC tokens; nothing is written to the DB or logged on login. Add one additive, nullable-safe JSONB column (`users.login_history`, capped at 15 entries, newest first) written inside `auth.service.ts`'s existing `login()` after credentials verify successfully, using the ordinary read-modify-write `userRepo.save()` path every other account mutation already uses (no new repository method — keeps this small and consistent with the rest of the codebase). Expose it for free through the existing `GET /accounts/users` endpoint (already admin-gated, already returns `SafeUser[]` = `Omit<User,'passwordHash'>`, so the new field rides along with zero backend route changes). Add one new admin-only SPA screen, "Login activity", reachable from a console tile, sorted worst-first with a "not logged in yet" summary and a per-account expandable history.

**Tech Stack:** TS/Express backend (Supabase Postgres via `postgres.js`), vanilla-JS SPA (`public/index.html`), Vitest.

**Spec:** none separate — this plan is self-contained (small, well-understood change; see "Design notes" below for the decisions already made and why).

## Design notes (read before touching code)

- **Why no new repository method / no atomic SQL:** every existing account-mutating call in `account.service.ts` (`updateUser`, `setPassword`, `changeOwnPassword`, `toggleStatus`) already does a plain `{...existing, ...changes}` then `userRepo.save(...)` — a full-row upsert with the exact same theoretical concurrent-write race this change would have if it used the same pattern. Following that existing convention (rather than inventing atomic raw SQL for just this one field) keeps the change small, matches the codebase's accepted risk posture, and avoids introducing new, harder-to-verify raw SQL on the login path 8 days before a live event. This is a deliberate, discussed trade-off — do not "improve" it into hand-rolled `jsonb_agg` SQL later without a real reason.
- **Why fail-open:** login must never fail or slow down meaningfully because the history write had a problem. The history update is wrapped in `try/catch` inside `login()`; a thrown error there is swallowed (not logged as a login failure, not surfaced to the caller) and login proceeds normally. This mirrors `isSessionRevoked`'s documented fail-open philosophy elsewhere in `auth.service.ts`.
- **Why on the `users` table and not a separate log table:** the ask is "last login, with a short drop-down history" — not a full audit trail. A capped JSONB array on the existing row is the smallest change that satisfies it (no new table, no join, no cron/trim job, no new repository interface method).
- **Deploy order matters:** `SupabaseUserRepository.save()` upserts **every** column via an explicit `on conflict do update set` column list (`UPDATE_COLS`). Once this code is deployed, **every** login and **every** account save (`updateUser`, `setPassword`, `toggleStatus`, `changeOwnPassword`) writes to `login_history` — so migration `0026` must be applied to prod **before** this code is pushed (same standing rule as every prior additive column in this repo — see `CLAUDE.md`'s "must be applied to prod BEFORE this code deploys" convention). **Do not push to `master` until the owner has confirmed the migration is applied** — this repo auto-deploys on push, so there is no separate "apply then release" step once it's pushed.
- **Not in scope:** per-device tracking, IP addresses, failed-login attempts, a full audit-log table, exposing this to director/zoneLeader (the existing `/accounts/users` endpoint is `admin:manage`-gated only — this plan does not widen that).

## Global Constraints

- Additive, nullable-safe migration only — must not require a backfill or break any existing row.
- No new backend route — reuse `GET /accounts/users` (`admin:manage`).
- `npm run typecheck` and `npm run test` (vitest) must stay clean throughout.
- `public/index.html` changes require bumping `public/sw.js`'s `CACHE` constant (standing rule — iOS PWAs are lazy about picking up a new service worker).
- Follow this repo's existing code style exactly (see the read files below) — no new abstractions, no refactors of surrounding code.

---

### Task 1: Data layer — migration, entity field, Supabase mapper

**Files:**
- Create: `supabase/migrations/0026_login_history.sql`
- Modify: `src/core/entities/user.ts`
- Modify: `src/repositories/supabase/supabase.users.ts`

**Interfaces:**
- Produces: `User.loginHistory?: string[]` (ISO timestamp strings, newest first, capped to `MAX_LOGIN_HISTORY`), and an exported `MAX_LOGIN_HISTORY = 15` constant from `src/core/entities/user.ts`, both consumed by Task 2.
- The `SupabaseUserRepository`'s existing `toUser`/`userColumns`/`UPDATE_COLS` must round-trip the new field so ordinary `save()` calls elsewhere (`updateUser`, `setPassword`, `toggleStatus`, `changeOwnPassword` in `account.service.ts`) never silently clobber it back to empty — this is a well-known footgun in this repo (grep `CLAUDE.md` for "on-conflict" if you want the history of past incidents from missing a column here).

- [ ] **Step 1: Read the files this task touches, in full, before editing**

Read `src/core/entities/user.ts`, `src/repositories/supabase/supabase.users.ts`, and `src/repositories/interfaces/entity-repositories.ts` (just to confirm `IUserRepository` needs no change — it doesn't; `save()` already exists on the base `IRepository<T>` interface).

- [ ] **Step 2: Create the migration**

`supabase/migrations/0026_login_history.sql`:

```sql
-- Login activity tracking (owner request, 2026-09-20): capture the most recent login
-- timestamps per account so the admin can see which churches haven't logged in yet ahead of
-- camp (2026-09-28) and reach out to help. Additive, nullable-safe default — does not affect
-- any existing row, and no read path depends on it until the code that reads it ships.
--
-- Written on every successful login by auth.service.ts's login(), capped client-side (in the
-- application layer, not here) to the 15 most recent entries, newest first.
alter table users add column if not exists login_history jsonb not null default '[]'::jsonb;
```

- [ ] **Step 3: Add the field to the `User` entity**

In `src/core/entities/user.ts`, add near the top of the file (after the `GenderScope` type, before `export interface User`):

```ts
/**
 * How many recent login timestamps are kept per account (newest first). A short activity
 * trail, not a full audit log — see auth.service.ts's login() for where it's written.
 */
export const MAX_LOGIN_HISTORY = 15;
```

Inside `export interface User { ... }`, add this field (placed after `mustChangePassword`, before `createdAt`):

```ts
  /**
   * Recent login timestamps (ISO strings), newest first, capped at {@link MAX_LOGIN_HISTORY}.
   * Written by `auth.service.ts`'s `login()` on every successful login — never by anything
   * else. Absent/empty means "never logged in". This is a short activity trail for the admin
   * (see the "Login activity" screen), not a full audit log.
   */
  loginHistory?: string[];
```

- [ ] **Step 4: Wire it into the Supabase mapper**

In `src/repositories/supabase/supabase.users.ts`:

In `toUser()`, add (after the `mustChangePassword` line):
```ts
    loginHistory: (row['login_history'] as string[] | null) ?? [],
```

In `userColumns()`, add (after the `must_change_password` line):
```ts
    login_history: u.loginHistory ?? [],
```

In the `UPDATE_COLS` array, add `'login_history'` (after `'must_change_password'`, before `'updated_at'`):
```ts
const UPDATE_COLS = [
  'first_name', 'last_name', 'username', 'mobile', 'role',
  'church_id', 'church_name', 'zone', 'gender_scope', 'is_dual_gender_login', 'status',
  'password_hash', 'must_change_password', 'login_history', 'updated_at',
] as const;
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: clean (no new errors).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0026_login_history.sql src/core/entities/user.ts src/repositories/supabase/supabase.users.ts
git commit -m "feat: add login_history column for login activity tracking"
```

---

### Task 2: Record a login in `auth.service.ts` (TDD)

**Files:**
- Modify: `src/services/auth.service.ts`
- Modify: `src/services/auth.service.test.ts`

**Interfaces:**
- Consumes: `User.loginHistory`, `MAX_LOGIN_HISTORY` from `src/core/entities/user.ts` (Task 1); `nowISO` from `../utils/date` (already used elsewhere in this codebase, e.g. `account.service.ts`); `IUserRepository.save` (already exists).
- Produces: nothing new consumed by later tasks — Task 3/4 only read `loginHistory` off the `SafeUser` objects `GET /accounts/users` already returns.

- [ ] **Step 1: Read `src/services/auth.service.ts` and `src/services/auth.service.test.ts` in full**

You already have most of `auth.service.ts` in context from prior investigation this session — re-read it anyway to get exact current line numbers before editing. Pay attention to the `login()` method (around line 204) and the existing `seedUser` test helper (around line 30) in the test file.

- [ ] **Step 2: Write the failing tests**

`seedUser`'s default `passwordHash` is `await hashPassword('demo1234')` (see the helper near the top of the file) — every new test below logs in with the password `'demo1234'` to match. Add these as new `it(...)` blocks inside the existing `describe('AuthService.login', () => { ... })` block (the first describe block in the file, whose `beforeEach` creates `repo = new InMemoryUserRepository()`):

```ts
  it('records a login timestamp on successful login', async () => {
    const user = await seedUser(repo, { username: 'victory' });
    const svc = makeAuthService(repo);
    const before = Date.now();
    await svc.login({ username: 'victory', password: 'demo1234' });
    const saved = await repo.findById(user.id);
    expect(saved?.loginHistory).toHaveLength(1);
    const recordedMs = Date.parse(saved!.loginHistory![0]);
    expect(recordedMs).toBeGreaterThanOrEqual(before);
    expect(recordedMs).toBeLessThanOrEqual(Date.now());
  });

  it('keeps login history newest-first and caps it at MAX_LOGIN_HISTORY', async () => {
    const user = await seedUser(repo, { username: 'victory' });
    const svc = makeAuthService(repo);
    for (let i = 0; i < MAX_LOGIN_HISTORY + 3; i++) {
      await svc.login({ username: 'victory', password: 'demo1234' });
    }
    const saved = await repo.findById(user.id);
    expect(saved?.loginHistory).toHaveLength(MAX_LOGIN_HISTORY);
    // newest-first: each entry's timestamp is >= the one after it
    const times = saved!.loginHistory!.map((iso) => Date.parse(iso));
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
    }
  });

  it('does not record a login on a failed password attempt', async () => {
    const user = await seedUser(repo, { username: 'victory' });
    const svc = makeAuthService(repo);
    await expect(
      svc.login({ username: 'victory', password: 'wrong-password' }),
    ).rejects.toThrow();
    const saved = await repo.findById(user.id);
    expect(saved?.loginHistory ?? []).toHaveLength(0);
  });

  it('still succeeds if recording the login history throws (fail-open)', async () => {
    const user = await seedUser(repo, { username: 'victory' });
    const originalSave = repo.save.bind(repo);
    let saveCalls = 0;
    repo.save = (async (_u: User) => {
      saveCalls++;
      throw new Error('simulated DB write failure');
    }) as typeof repo.save;
    const svc = makeAuthService(repo);
    const result = await svc.login({ username: 'victory', password: 'demo1234' });
    expect(result.token).toBeTruthy();
    expect(result.user.id).toBe(user.id);
    expect(saveCalls).toBe(1);
    repo.save = originalSave;
  });
```

At the top of the file, change the existing `import type { User } from '../core/entities/user';` line to also bring in the new constant as a value import (keep `User` as a type-only import, add `MAX_LOGIN_HISTORY` alongside it — don't merge them into one non-type import, which would fail under `isolatedModules`):
```ts
import { MAX_LOGIN_HISTORY } from '../core/entities/user';
import type { User } from '../core/entities/user';
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services/auth.service.test.ts`
Expected: the 4 new tests FAIL (`loginHistory` is `undefined`, or the fail-open test throws because `login()` doesn't yet catch the save error).

- [ ] **Step 4: Implement**

In `src/services/auth.service.ts`:

Add to the top-level imports:
```ts
import { MAX_LOGIN_HISTORY } from '../core/entities/user';
import { nowISO } from '../utils/date';
```

In the `login()` method, right after the lock-check block and before `const token = signSession(...)` (i.e. right before the existing line `const token = signSession(toActor(user), Date.now() + TOKEN_TTL_MS);`), insert:

```ts
      // Login activity tracking (owner request, 2026-09-20): a short per-account history so
      // the admin can see who hasn't logged in yet ahead of camp. Fail-open — a write failure
      // here must never block or fail an otherwise-successful login (mirrors the fail-open
      // philosophy of isSessionRevoked above). Uses the ordinary read-modify-write `save()`
      // every other account mutation in this codebase already uses, not a dedicated atomic
      // method — see the plan doc's "Design notes" for why that's a deliberate choice here.
      try {
        const history = [nowISO(), ...(user.loginHistory ?? [])].slice(0, MAX_LOGIN_HISTORY);
        await users.save({ ...user, loginHistory: history });
      } catch {
        // Never let a tracking failure block a successful login.
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/auth.service.test.ts`
Expected: all tests PASS, including the 4 new ones.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm run typecheck && npm run test`
Expected: clean, and the total pass count is the prior count + 4 (report the before/after numbers, same convention this repo's CLAUDE.md uses for every change).

- [ ] **Step 7: Commit**

```bash
git add src/services/auth.service.ts src/services/auth.service.test.ts
git commit -m "feat: record login history on successful login (fail-open)"
```

---

### Task 3: SPA — "Login activity" screen

**Files:**
- Modify: `public/index.html`
- Modify: `public/sw.js`

**Interfaces:**
- Consumes: `GET /accounts/users` (existing endpoint, already returns `SafeUser[]` including the new `loginHistory?: string[]` field now that Task 1/2 are done — no backend change needed here). Existing helpers: `ic(name)`, `esc(str)`, `paint(id,html,title,subtitle)`, `go(id)`, `_adminTile(icon,label,action)` (declared inside `RENDER.admin`, around line 6663).
- Produces: `RENDER.loginActivity` (new), `_relTime(iso)` (new, small pure helper — no other task depends on its exact name, but keep it since the code below references it).

- [ ] **Step 1: Read the surrounding code first**

Read `public/index.html` around line 6658-6713 (`RENDER.admin`), around line 895-919 (the `<section class="screen" id="...">` shell block), and the `ICONS` registry around line 1365-1403 (confirm `clock` exists — it does). Also read `public/sw.js`'s first line (`const CACHE = ...`).

- [ ] **Step 2: Add the screen container to the shell**

In `public/index.html`, find this line (around line 909):
```html
    <section class="screen" id="adminAccounts"></section>
```
Add a new line immediately after it:
```html
    <section class="screen" id="loginactivity"></section>
```

- [ ] **Step 3: Add the console tile**

In `RENDER.admin` (around line 6658), inside the "People & churches" group (find the `<div class="h3" ...>People &amp; churches</div>` block, around line 6704-6708), add a new tile after "Accounts & churches", gated admin-only (reuse the existing `isAdmin` const already declared at the top of `RENDER.admin`):

```html
    <div class="h3" style="margin:16px 0 6px">People &amp; churches</div>
    <div class="tiles">
      ${_adminTile('key','Accounts &amp; churches',"go('adminAccounts')")}
      ${isAdmin?_adminTile('clock','Login activity',"go('loginactivity')"):''}
      ${_adminTile('phone','Ministry contacts',"go('adminContacts')")}
    </div>
```

(Only the one new line is added — do not otherwise restructure this block. This repo's CLAUDE.md explicitly warns the admin-console tile grouping was reviewed and settled twice already; don't reshuffle anything else here.)

- [ ] **Step 4: Add the relative-time helper**

Add this near `localDateISO()` (around line 1771 in `public/index.html`, same general area as the other date/time helpers — put it directly after `brisbaneNowTime()`'s function body ends):

```js
// "3m ago" / "5h ago" / "2d ago" style relative time, for the Login activity screen. Falls
// back to a short absolute date once it's more than 6 days ago (a relative count in weeks is
// less useful for "did this church log in before camp" than a real date at that distance).
function _relTime(iso){
  const ms=Date.now()-Date.parse(iso);
  if(!(ms>=0))return 'just now';
  const m=Math.floor(ms/60000);
  if(m<1)return 'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  const d=Math.floor(h/24);
  if(d<7)return d+'d ago';
  return _fmtLoginAt(iso);
}
// Absolute Brisbane-local timestamp for the expanded login-history dropdown, e.g. "20 Sep, 2:14 pm".
function _fmtLoginAt(iso){
  const d=new Date(iso);
  const datePart=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',day:'numeric',month:'short'}).format(d);
  const timePart=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',hour:'numeric',minute:'2-digit',hour12:true}).format(d).toLowerCase();
  return datePart+', '+timePart;
}
```

- [ ] **Step 5: Add the `RENDER.loginActivity` screen**

Add this new function right after `RENDER.adminAccounts` ends (find the end of that function — search for the closing of `RENDER.adminAccounts=async function(){` by locating its matching `};`, and insert directly after it):

```js
/* ===== LOGIN ACTIVITY ===== */
// Owner request 2026-09-20: see which accounts (especially churches) haven't logged in yet
// ahead of camp (2026-09-28), so the admin can reach out and help. Reuses GET /accounts/users
// (already admin:manage-gated) — loginHistory rides along on SafeUser for free, no new route.
RENDER.loginActivity=async function(){
  const users=await api('/accounts/users');
  const roleLabel=r=>r==='zoneLeader'?'Zone leader':r==='firstAid'?'First aid':r==='director'?'Director':r==='admin'?'Admin':'Church';
  const lastLoginMs=u=>(u.loginHistory&&u.loginHistory.length)?Date.parse(u.loginHistory[0]):-Infinity;
  const sorted=[...users].sort((a,b)=>{
    const d=lastLoginMs(a)-lastLoginMs(b);
    if(d!==0)return d;
    return (a.churchName||a.lastName||'').localeCompare(b.churchName||b.lastName||'');
  });
  const churchAccts=users.filter(u=>u.role==='church');
  const churchNotIn=churchAccts.filter(u=>!(u.loginHistory&&u.loginHistory.length));
  const summary=churchAccts.length
    ?`<p class="sub" style="margin:0 0 12px">${churchNotIn.length} of ${churchAccts.length} church logins haven't logged in yet</p>`
    :'';
  const row=u=>{
    const history=u.loginHistory||[];
    const last=history.length?_relTime(history[0]):'Never logged in';
    const sub=[roleLabel(u.role),u.churchName||u.zone||'',u.status==='inactive'?'inactive':''].filter(Boolean).join(' · ');
    const dropdown=history.length>1?`<details style="margin-top:4px">
        <summary class="row" style="cursor:pointer;color:var(--muted);font-size:var(--t-micro);padding:2px 0">History (${history.length})</summary>
        <div style="padding:4px 0 2px;color:var(--muted);font-size:var(--t-micro)">${history.map(h=>esc(_fmtLoginAt(h))).join('<br>')}</div>
      </details>`:'';
    return `<div class="card" style="margin-bottom:8px;padding:12px 14px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
          <div style="font-weight:700;font-size:var(--t-sm)">${esc(u.firstName+' '+u.lastName)}</div>
          <div style="font-size:var(--t-micro);color:${history.length?'var(--muted)':'var(--ink-2,#555)'}">${esc(last)}</div>
        </div>
        <div class="sub" style="margin-top:2px">${esc(sub)}</div>
        ${dropdown}
      </div>`;
  };
  paint('loginactivity',`${summary}${sorted.length?sorted.map(row).join(''):emptyState('users','No accounts yet.')}`,'Login activity','Who has logged in, and when');
};
```

(This assumes `emptyState(icon,msg)` exists as documented in this repo's CLAUDE.md "Icons" section — confirm it by grepping `function emptyState` before relying on it; if its signature differs, match the real one instead of guessing.)

- [ ] **Step 6: Bump the service worker cache version**

In `public/sw.js`, change the first line from whatever it currently reads (confirm the exact current value first — don't assume a stale number) to the next sequential `camp-vNN`.

- [ ] **Step 7: Verify — `node --check` and typecheck**

Run these (derive the script body's line range dynamically, don't hardcode a remembered one — this repo's own CLAUDE.md warns line ranges drift on every edit):
```bash
S=$(grep -n '^<script>$' public/index.html | head -1 | cut -d: -f1)
E=$(grep -n '^</script>$' public/index.html | tail -1 | cut -d: -f1)
sed -n "$((S+1)),$((E-1))p" public/index.html > /tmp/spa-body-check.js
node --check /tmp/spa-body-check.js
node --check public/sw.js
```
Expected: both exit 0 with no output.

Then: `npm run typecheck` — expected clean (this file has no TS in it, but this confirms nothing else broke).

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "feat: add Login activity admin screen"
```

---

### Task 4: Document the change

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — this is a documentation-only task, following this repo's own established convention of a dated section per shipped change at the top of `CLAUDE.md`.

- [ ] **Step 1: Add a dated section**

Add a new section near the top of `CLAUDE.md` (directly under the `# CLAUDE.md — Youth Camp Platform` heading and its existing misdate warning, above the next dated section), following the exact style of the existing entries (see the `## Panadol/Ibuprofen/Antihistamine "as needed" consent — migration 0025 — 2026-09-16` section immediately below it as the template for tone/format). State: what was built (login activity tracking, `users.login_history`, the new admin screen), the migration number and that it **must be applied to prod before this code deploys**, the `npm run typecheck`/`npm run test` pass counts (fill in the real before/after numbers from Task 2 Step 6), and the `sw.js` version bump (old → new).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record login activity tracking change"
```

---

## Final note for whoever runs this plan

**Do not apply migration `0026` to production and do not push to `master` without the owner's explicit go-ahead in this session.** This repo auto-deploys on push to `master` with no separate release gate, and camp is 8 days away — the owner asked for changes to be made carefully. Implement and verify everything locally (typecheck, vitest, `node --check`), then stop and report back for a final review before anything touches prod or gets pushed.
