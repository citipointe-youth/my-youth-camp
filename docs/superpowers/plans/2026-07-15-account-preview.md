# Account Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin open a real, RBAC-scoped, **read-only** preview session as any active non-admin account (church / zoneLeader / director / firstAid) from Admin → Accounts, composing with the existing at-camp mode preview.

**Architecture:** The backend mints a real, fully-scoped session token for the target account (new `AuthService.issueTokenFor` + `AccountService.previewAccount`, exposed via `POST /accounts/users/:id/preview`). The SPA swaps that token in, stashes the admin's own session, and blocks every write **client-side** in `api()` (so no audit record is ever created). A generalized preview banner shows who/which-mode is being previewed and offers an at-camp overlay toggle (reusing the existing `PREVIEW_MODE` machinery) when the real global mode is pre-camp.

**Tech Stack:** TypeScript + Express backend (`src/`, layered controllers→services→repositories), single-file SPA (`public/index.html`), Vitest, Supabase in prod (no schema change here).

**Spec:** `docs/superpowers/specs/2026-07-15-account-preview-design.md`

## Global Constraints

- **Read-only is enforced CLIENT-SIDE only.** The minted token is a normal fully-scoped token; the backend adds no preview flag and rejects nothing extra. Writes are blocked in the SPA `api()` non-GET guard.
- **Previewable roles = all non-admin:** `church`, `zoneLeader`, `director`, `firstAid`. Never `admin`.
- **No DB schema / migration change. No new middleware.**
- Backend verified with `npm run typecheck` (clean) + `npm run test` (Vitest). SPA verified with `node --check` on the extracted script + on-device eyeball — **do NOT start a localhost server or drive a browser** (repo convention, see `debug.md`).
- The repo **auto-deploys `master` to production on push**. Commit per task; the user controls pushing.
- Any change to `public/index.html` requires bumping `public/sw.js`'s `CACHE` version (last task).
- SPA line numbers below are approximate (they drift) — **grep the named symbol to confirm** before editing.
- Existing `Actor` shape (from `src/services/auth.service.ts` `toActor`): `{ id, role, churchId, churchName, zone, displayName, mustChangePassword }`.

---

### Task 1: Backend — `AuthService.issueTokenFor`

Mints a real signed token for an arbitrary active user, with optional actor overrides. No current equivalent exists (`signSession` is module-private).

**Files:**
- Modify: `src/services/auth.service.ts` (interface `AuthService` ~line 93; `makeAuthService` return object ~line 100–153)
- Test: `src/services/auth.service.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: existing private `signSession(actor, expiresAt)`, `toActor(user)`, `TOKEN_TTL_MS`; `IUserRepository.findById`.
- Produces: `issueTokenFor(userId: string, actorOverrides?: Partial<Actor>): Promise<string | null>` on the `AuthService` interface.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/auth.service.test.ts`:

```typescript
describe('AuthService.issueTokenFor', () => {
  it('mints a token resolveToken accepts, carrying the target actor', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1', churchName: 'Victory' });
    const svc = makeAuthService(repo);
    const token = await svc.issueTokenFor('c1');
    expect(token).toBeTruthy();
    const actor = await svc.resolveToken(token!);
    expect(actor?.id).toBe('c1');
    expect(actor?.role).toBe('church');
    expect(actor?.churchId).toBe('ch1');
  });

  it('applies actorOverrides (mustChangePassword:false wins over the user record)', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', mustChangePassword: true });
    const svc = makeAuthService(repo);
    const token = await svc.issueTokenFor('c1', { mustChangePassword: false });
    const actor = await svc.resolveToken(token!);
    expect(actor?.mustChangePassword).toBe(false);
  });

  it('returns null for a missing or inactive user', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { id: 'x1', username: 'off', status: 'inactive' });
    const svc = makeAuthService(repo);
    expect(await svc.issueTokenFor('nope')).toBeNull();
    expect(await svc.issueTokenFor('x1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- auth.service`
Expected: FAIL — `svc.issueTokenFor is not a function` (TS may also error that the method is missing from the interface).

- [ ] **Step 3: Add `issueTokenFor` to the interface**

In `src/services/auth.service.ts`, extend the `AuthService` interface (after `logout`):

```typescript
export interface AuthService {
  login(input: unknown): Promise<{ token: string; user: SafeUser }>;
  resolveToken(token: string): Promise<Actor | null>;
  logout(token: string): Promise<void>;
  /** Mint a real signed session token for an arbitrary active user (admin account preview).
   *  actorOverrides let the caller force fields on the embedded actor (e.g. mustChangePassword:false). */
  issueTokenFor(userId: string, actorOverrides?: Partial<Actor>): Promise<string | null>;
}
```

- [ ] **Step 4: Implement `issueTokenFor`**

In the `makeAuthService` return object, add after `logout`:

```typescript
    async issueTokenFor(userId, actorOverrides) {
      const user = await users.findById(userId);
      if (!user || user.status !== 'active') return null;
      return signSession({ ...toActor(user), ...(actorOverrides ?? {}) }, Date.now() + TOKEN_TTL_MS);
    },
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `npm run test -- auth.service && npm run typecheck`
Expected: PASS (all auth.service tests green; typecheck clean).

- [ ] **Step 6: Commit**

```bash
git add src/services/auth.service.ts src/services/auth.service.test.ts
git commit -m "feat(auth): add issueTokenFor for account preview"
```

---

### Task 2: Backend — `AccountService.previewAccount`

Validates that the target is an active non-admin account and returns its `SafeUser`. Mirrors the existing `toggleStatus`/`deleteUser` guard pattern.

**Files:**
- Modify: `src/services/account.service.ts` (interface `AccountService` ~line 25–39; return object ~line 46+)
- Test: `src/services/account.service.test.ts` (CREATE — no account test file exists yet)

**Interfaces:**
- Consumes: `assertCan(actor, 'admin:manage')`, `IUserRepository.findById`, `toSafeUser`, `NotFoundError`, `BadRequestError`.
- Produces: `previewAccount(actor: Actor, id: string): Promise<SafeUser>` on the `AccountService` interface.

- [ ] **Step 1: Write the failing tests**

Create `src/services/account.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { makeAccountService } from './account.service';
import {
  InMemoryUserRepository,
  InMemoryChurchRepository,
  InMemoryPersonRepository,
} from '../repositories/in-memory';
import type { User, Actor } from '../core/entities/user';

const ADMIN: Actor = {
  id: 'admin', role: 'admin', churchId: null, churchName: null, zone: null,
  displayName: 'Ada Admin', mustChangePassword: false,
};
const NON_ADMIN: Actor = { ...ADMIN, id: 'c1', role: 'church', displayName: 'Church' };

async function seed(repo: InMemoryUserRepository, over: Partial<User>): Promise<User> {
  const now = new Date().toISOString();
  const user: User = {
    id: 'u', firstName: 'Vic', lastName: 'Tory', username: 'victory',
    role: 'church', churchId: 'ch1', churchName: 'Victory', zone: 'Yellow',
    status: 'active', passwordHash: 'x', createdAt: now, updatedAt: now, ...over,
  } as User;
  await repo.save(user);
  return user;
}

describe('AccountService.previewAccount', () => {
  let users: InMemoryUserRepository;
  let svc: ReturnType<typeof makeAccountService>;
  beforeEach(async () => {
    users = new InMemoryUserRepository();
    await users.init();
    const churches = new InMemoryChurchRepository();
    const people = new InMemoryPersonRepository();
    await churches.init();
    await people.init();
    svc = makeAccountService(users, churches, people);
  });

  it('rejects a non-admin actor', async () => {
    await seed(users, { id: 'c1' });
    await expect(svc.previewAccount(NON_ADMIN, 'c1')).rejects.toThrow();
  });

  it('throws NotFound for a missing id', async () => {
    await expect(svc.previewAccount(ADMIN, 'nope')).rejects.toThrow(/not found/i);
  });

  it('rejects an admin target', async () => {
    await seed(users, { id: 'a2', role: 'admin', username: 'admin2' });
    await expect(svc.previewAccount(ADMIN, 'a2')).rejects.toThrow(/admin/i);
  });

  it('rejects an inactive target', async () => {
    await seed(users, { id: 'c1', status: 'inactive' });
    await expect(svc.previewAccount(ADMIN, 'c1')).rejects.toThrow(/not active/i);
  });

  it('returns a SafeUser (no passwordHash) for each non-admin role', async () => {
    for (const role of ['church', 'zoneLeader', 'director', 'firstAid'] as const) {
      const id = 'id_' + role;
      await seed(users, { id, role, username: 'u_' + role });
      const safe = await svc.previewAccount(ADMIN, id);
      expect(safe.id).toBe(id);
      expect((safe as Record<string, unknown>).passwordHash).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- account.service`
Expected: FAIL — `svc.previewAccount is not a function`.

- [ ] **Step 3: Add `previewAccount` to the interface**

In `src/services/account.service.ts`, add to the `AccountService` interface (after `deleteChurch`):

```typescript
  /** Admin-only: validate a target account for read-only preview; returns its SafeUser. */
  previewAccount(actor: Actor, id: string): Promise<SafeUser>;
```

- [ ] **Step 4: Implement `previewAccount`**

In the `makeAccountService` return object, add (e.g. after `toggleStatus`):

```typescript
    async previewAccount(actor, id) {
      assertCan(actor, 'admin:manage');
      const user = await userRepo.findById(id);
      if (!user) throw new NotFoundError('Account not found');
      if (user.status !== 'active') throw new BadRequestError('Account is not active');
      if (user.role === 'admin') throw new BadRequestError('Admin accounts cannot be previewed');
      return toSafeUser(user);
    },
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `npm run test -- account.service && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/account.service.ts src/services/account.service.test.ts
git commit -m "feat(account): add previewAccount validation"
```

---

### Task 3: Backend — controller handler + route

Wire the auth service into the account controller, add a `preview` handler, and register the route.

**Files:**
- Modify: `src/api/controllers/account.controller.ts` (whole file — add `auth` dep + `preview`)
- Modify: `src/api/http/router.ts` (controller construction ~line 50; account routes block ~line 198–207)

**Interfaces:**
- Consumes: `AccountService.previewAccount` (Task 2), `AuthService.issueTokenFor` (Task 1), `req.ctx.actor`, `req.params['id']`.
- Produces: `POST /accounts/users/:id/preview` → `{ token: string, user: SafeUser }`.

- [ ] **Step 1: Add `auth` to the controller deps and a `preview` handler**

In `src/api/controllers/account.controller.ts`:

1. Extend the imports and services interface:

```typescript
import type { HttpRequest } from '../http/types';
import type { AccountService } from '../../services/account.service';
import type { AuthService } from '../../services/auth.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface AccountControllerServices {
  account: AccountService;
  auth: AuthService;
}
```

2. Add a `preview` method to the returned object (e.g. after `update`):

```typescript
    async preview(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      const user = await services.account.previewAccount(req.ctx.actor, id);
      // mustChangePassword:false so previewing a never-logged-in seeded account doesn't
      // dead-end on its own forced-password screen (the gate is currently disabled, but
      // this keeps preview correct if it's ever re-enabled).
      const token = await services.auth.issueTokenFor(user.id, { mustChangePassword: false });
      return { token, user };
    },
```

- [ ] **Step 2: Wire `auth` into the controller and register the route**

In `src/api/http/router.ts`:

1. Update the controller construction (~line 50):

```typescript
  const account = makeAccountController({ account: services.account, auth: services.auth });
```

2. Add the route inside the `/accounts/*` block (after the `POST /accounts/users` line, ~line 199):

```typescript
    { method: 'POST', path: '/accounts/users/:id/preview', auth: true, handler: (r) => account.preview(r) },
```

- [ ] **Step 3: Verify typecheck + full test suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; all tests pass (the controller/route is a thin pass-through over the Task 1–2 logic, which is already unit-tested; typecheck confirms the deps/handler signatures line up — this matches the repo's convention of verifying backend wiring via tsc rather than an HTTP harness).

- [ ] **Step 4: Commit**

```bash
git add src/api/controllers/account.controller.ts src/api/http/router.ts
git commit -m "feat(api): POST /accounts/users/:id/preview endpoint"
```

---

### Task 4: Frontend — preview state, read-only guard, enter/exit, banner

The core SPA mechanism. All edits are in `public/index.html`. **Grep each named symbol to confirm its line** before editing — line numbers drift.

**Files:**
- Modify: `public/index.html` — state decl (~745), `api()` guard (~715), `updateModeUI` (~962), banner markup (~504), `logout` (~900), `_tryRestoreSession` (~4194), boot (~4218)

**Interfaces:**
- Consumes: `_doFetch(path,opt)` (underlying fetch, **bypasses** the `api()` write-guard), `Cache.clear()`, `updateModeUI`, `buildTabs`, `gotoTab`, `modal`, `closeModal`, `esc`, `ic`, `_findUser(id)` (defined ~2895), `SETTINGS`, `TOKEN`, `ACTOR`, `PREVIEW_MODE`, `SESSIONS`, `SEL_SESSION`.
- Produces: globals `ACCOUNT_PREVIEW`, `_previewStash`; functions `enterAccountPreview(id)`, `confirmEnterAccountPreview(id)`, `exitAccountPreview()`, `_exitAnyPreview()`, `_togglePreviewMode()`, `_updatePreviewBanner()`.

- [ ] **Step 1: Add preview state**

Find the state line (grep `PREVIEW_MODE=false;`, ~745):

```javascript
let TOKEN=null,ACTOR=null,SETTINGS=null,CAMP_MODE='pre-camp',STACK=['home'],PREVIEW_MODE=false;
```

Add immediately after it:

```javascript
// Account preview (previewing a DIFFERENT login) is orthogonal to PREVIEW_MODE (the at-camp
// mode overlay). Both can be true at once: an admin previewing church X's at-camp view.
let ACCOUNT_PREVIEW=false;
let _previewStash=null; // { token, actor } — the admin's own session while account-previewing
```

- [ ] **Step 2: Extend the read-only write-guard**

Find the `api()` non-GET guard (grep `Preview mode — sign-in actions are disabled`, ~718):

```javascript
    if(PREVIEW_MODE){toast('Preview mode — sign-in actions are disabled');throw new Error('Preview mode — read only');}
```

Replace with:

```javascript
    if(PREVIEW_MODE||ACCOUNT_PREVIEW){toast('Preview — this is read-only');throw new Error('Preview — read only');}
```

- [ ] **Step 3: Update the banner markup (second button + ids)**

Find the banner (grep `id="previewBanner"`, ~504):

```html
  <div id="previewBanner">
    <span class="pb-label" id="pbLabel">PREVIEW — at-camp view is read-only</span>
    <button class="pb-exit" onclick="exitPreview()">Exit preview ×</button>
  </div>
```

Replace with:

```html
  <div id="previewBanner">
    <span class="pb-label" id="pbLabel">PREVIEW — at-camp view is read-only</span>
    <button class="pb-exit" id="pbToggle" style="display:none" onclick="_togglePreviewMode()"></button>
    <button class="pb-exit" id="pbExit" onclick="_exitAnyPreview()">Exit ×</button>
  </div>
```

- [ ] **Step 4: Add the preview enter/exit/toggle/banner functions**

Find the existing `/* ===== AT-CAMP PREVIEW ===== */` block (grep `function enterPreview`, ~987). Add the following functions immediately after `exitPreview()` (so they sit beside the existing same-user preview):

```javascript
/* ===== ACCOUNT PREVIEW (previewing a different login, read-only) ===== */
const _previewRoleLabel=r=>r==='zoneLeader'?'Zone leader':r==='director'?'Director':r==='firstAid'?'First aid':r==='church'?'Church':r;
function confirmEnterAccountPreview(id){
  const u=_findUser(id);
  const who=esc(((u.firstName||'')+' '+(u.lastName||'')).trim()||u.username||'this account');
  modal(`<h3>Preview login</h3>
    <p style="color:var(--muted);font-size:.85rem;margin:6px 0 4px">You'll see the app exactly as <b>${who}</b> sees it, scoped to their access. This is <b>read-only</b> — nothing is saved and nothing is written to the audit.</p>
    <button class="btn" style="margin-top:10px" onclick="closeModal();enterAccountPreview('${id}')">Start preview</button>
    <button class="btn ghost" style="margin-top:6px" onclick="closeModal()">Cancel</button>`);
}
async function enterAccountPreview(id){
  let d;
  // _doFetch (not api) so the write-guard doesn't block our own POST — works even if the admin
  // is already inside the same-user at-camp preview when they click.
  try{d=await _doFetch('/accounts/users/'+id+'/preview',{method:'POST'});}
  catch(e){toast((e&&e.message)||'Could not start preview');return;}
  _previewStash={token:TOKEN,actor:ACTOR};
  localStorage.setItem('ycp_preview_stash',JSON.stringify(_previewStash));
  TOKEN=d.token;
  ACTOR={...d.user,displayName:((d.user.firstName||'')+' '+(d.user.lastName||'')).trim()};
  localStorage.setItem('ycp_token',TOKEN);localStorage.setItem('ycp_actor',JSON.stringify(ACTOR));
  Cache.clear(); // never let admin-scoped cached reads leak into the scoped preview
  SESSIONS=[];SEL_SESSION=null;
  ACCOUNT_PREVIEW=true;PREVIEW_MODE=false;
  CAMP_MODE=(SETTINGS&&SETTINGS.campMode)||'pre-camp';
  document.getElementById('previewBanner').classList.add('show');
  updateModeUI();buildTabs();STACK=['home'];gotoTab('home');
}
function exitAccountPreview(){
  if(!_previewStash){document.getElementById('previewBanner').classList.remove('show');ACCOUNT_PREVIEW=false;return;}
  TOKEN=_previewStash.token;ACTOR=_previewStash.actor;
  localStorage.setItem('ycp_token',TOKEN);localStorage.setItem('ycp_actor',JSON.stringify(ACTOR));
  _previewStash=null;localStorage.removeItem('ycp_preview_stash');
  ACCOUNT_PREVIEW=false;PREVIEW_MODE=false;
  Cache.clear();SESSIONS=[];SEL_SESSION=null;
  CAMP_MODE=(SETTINGS&&SETTINGS.campMode)||'pre-camp';
  document.getElementById('previewBanner').classList.remove('show');
  updateModeUI();buildTabs();STACK=['home'];gotoTab('home');
}
// The banner Exit button serves both preview kinds.
function _exitAnyPreview(){if(ACCOUNT_PREVIEW)exitAccountPreview();else exitPreview();}
// At-camp overlay toggle, only meaningful during account preview while the real mode is pre-camp.
function _togglePreviewMode(){
  if((SETTINGS&&SETTINGS.campMode)!=='pre-camp')return;
  if(PREVIEW_MODE){PREVIEW_MODE=false;CAMP_MODE='pre-camp';}
  else{PREVIEW_MODE=true;CAMP_MODE='at-camp';}
  SESSIONS=[];SEL_SESSION=null;
  updateModeUI();buildTabs();STACK=['home'];gotoTab('home');
}
function _updatePreviewBanner(){
  const lbl=document.getElementById('pbLabel'),tog=document.getElementById('pbToggle');
  if(!lbl||!tog)return;
  if(ACCOUNT_PREVIEW){
    const who=ACTOR?esc(ACTOR.displayName||''):'';
    const roleTxt=ACTOR?_previewRoleLabel(ACTOR.role):'';
    const modeTxt=PREVIEW_MODE?'at-camp preview':(CAMP_MODE==='at-camp'?'at-camp':'pre-camp');
    lbl.innerHTML=ic('preview')+' Previewing: <b>'+who+'</b> ('+roleTxt+') — '+modeTxt+' · read-only';
    if((SETTINGS&&SETTINGS.campMode)==='pre-camp'){
      tog.style.display='';tog.textContent=PREVIEW_MODE?'Back to pre-camp view':'Switch to at-camp view';
    }else tog.style.display='none';
  }else{
    lbl.innerHTML=ic('preview')+' PREVIEW — at-camp view is read-only';
    tog.style.display='none';
  }
}
```

- [ ] **Step 5: Drive the banner from `updateModeUI` and fix the firstAid role badge**

Find `function updateModeUI()` (grep `function updateModeUI`, ~962). Two edits:

1. The role-badge line currently has no `firstAid` case (falls through to "Church"). Find:

```javascript
  if(r&&ACTOR)r.textContent=ACTOR.role==='admin'?'Admin':ACTOR.role==='director'?'Director':ACTOR.role==='zoneLeader'?'Zone·'+ACTOR.zone:'Church';
```

Replace with:

```javascript
  if(r&&ACTOR)r.textContent=ACTOR.role==='admin'?'Admin':ACTOR.role==='director'?'Director':ACTOR.role==='firstAid'?'First aid':ACTOR.role==='zoneLeader'?'Zone·'+ACTOR.zone:'Church';
```

2. Add a call to `_updatePreviewBanner()` as the **last line inside** `updateModeUI()` (just before its closing `}`):

```javascript
  _updatePreviewBanner();
```

- [ ] **Step 6: Clear preview state on logout**

Find `function logout()` (grep `function logout()`, ~900):

```javascript
function logout(){
  // Clear preview state before the POST so the write guard doesn't block the logout call.
  PREVIEW_MODE=false;
  api('/auth/logout',{method:'POST'}).catch(()=>{});
  localStorage.removeItem('ycp_token');localStorage.removeItem('ycp_actor');
  sessionStorage.removeItem('ycp_wizardReturn');
  TOKEN=null;ACTOR=null;location.reload();
}
```

Replace the body so both preview flags + the stash are cleared before the POST:

```javascript
function logout(){
  // Clear preview state before the POST so the write guard doesn't block the logout call.
  PREVIEW_MODE=false;ACCOUNT_PREVIEW=false;_previewStash=null;
  localStorage.removeItem('ycp_preview_stash');
  api('/auth/logout',{method:'POST'}).catch(()=>{});
  localStorage.removeItem('ycp_token');localStorage.removeItem('ycp_actor');
  sessionStorage.removeItem('ycp_wizardReturn');
  TOKEN=null;ACTOR=null;location.reload();
}
```

- [ ] **Step 7: Restore a mid-preview session on refresh**

Find `_tryRestoreSession` (grep `async function _tryRestoreSession`, ~4194). After the line `ACTOR=JSON.parse(actorJson);` add:

```javascript
    const stash=localStorage.getItem('ycp_preview_stash');
    if(stash){try{_previewStash=JSON.parse(stash);ACCOUNT_PREVIEW=true;document.getElementById('previewBanner').classList.add('show');}catch(_){}}
```

(`ycp_token`/`ycp_actor` already hold the preview values while previewing, so the normal restore below re-enters the preview session; `updateModeUI()` later in this function renders the banner.)

- [ ] **Step 8: Remove the now-redundant static banner init**

Find the boot line (grep `pbLabel').innerHTML=ic('preview')`, ~4218):

```javascript
document.getElementById('pbLabel').innerHTML=ic('preview')+' PREVIEW — at-camp view is read-only';
```

Delete it — `_updatePreviewBanner()` (called from `updateModeUI`) is now the single source for the label. (The `exitPreview` same-user path already calls `updateModeUI`, so its label still renders.)

- [ ] **Step 9: Verify the SPA parses**

Extract the script and syntax-check (repo convention — no browser):

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('public/index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');fs.writeFileSync('/tmp/spa.js',m);" && node --check /tmp/spa.js
```

Expected: no output (parse OK). On Windows Git Bash use the same command; `/tmp` resolves under the Git Bash root.

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "feat(spa): account preview mechanism (read-only, mode-composing banner)"
```

---

### Task 5: Frontend — Preview button on the Accounts screen

Add an eye button to each previewable account tile.

**Files:**
- Modify: `public/index.html` — `RENDER.adminAccounts` `acctTile` + its two call sites (grep `RENDER.adminAccounts=`, ~2835)

**Interfaces:**
- Consumes: `confirmEnterAccountPreview(id)` (Task 4), `ic('preview')`, the `acctTile({title,sub,onName,onPass,onDel})` helper.
- Produces: an `onPreview` field on `acctTile`'s argument object.

- [ ] **Step 1: Add the eye button to `acctTile`**

In `RENDER.adminAccounts`, find the `acctTile` button row (grep `title="Change password"`). The row currently holds edit/key/trash. Insert a preview button **between the key and trash buttons**, rendered only when `o.onPreview` is set:

```javascript
        <button class="iconbtn" style="flex:1 1 0;min-width:0" title="Change password" aria-label="Change password" onclick="${o.onPass}">${ic('key')}</button>
        ${o.onPreview?`<button class="iconbtn" style="flex:1 1 0;min-width:0" title="Preview this login" aria-label="Preview this login" onclick="${o.onPreview}">${ic('preview')}</button>`:''}
        <button class="iconbtn danger" style="flex:1 1 0;min-width:0" title="Delete" aria-label="Delete" onclick="${o.onDel}">${ic('trash')}</button>
```

- [ ] **Step 2: Pass `onPreview` from the leadership tiles**

Find the leaders `acctTile({...})` call (grep `onName:\`editLeaderName`). Add an `onPreview` field (all leader roles — zoneLeader/director/firstAid — are previewable; skip inactive):

```javascript
    onName:`editLeaderName('${u.id}')`,onPass:`changePassword('${u.id}')`,onDel:`delAcct('${u.id}')`,
    onPreview:u.status!=='inactive'?`confirmEnterAccountPreview('${u.id}')`:''
```

- [ ] **Step 3: Pass `onPreview` from the church tiles**

Find the churches `acctTile({...})` call (grep `onName:\`editChurchName`). The church login user is `cu`; preview only when it has an active login:

```javascript
      onName:`editChurchName('${c.id}')`,
      onPass:cu.id?`changePassword('${cu.id}')`:`toast('No login account for this church')`,
      onDel:`delChurch('${c.id}')`,
      onPreview:(cu.id&&cu.status!=='inactive')?`confirmEnterAccountPreview('${cu.id}')`:''
```

- [ ] **Step 4: Verify the SPA parses**

Run the same extract-and-`node --check` command from Task 4 Step 9.
Expected: parse OK.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(spa): Preview button on non-admin account tiles"
```

---

### Task 6: Service-worker bump + docs

Bump the SW cache (HTML changed) and record the feature in the two context files.

**Files:**
- Modify: `public/sw.js` (the `CACHE`/`camp-vN` constant)
- Modify: `CLAUDE.md` (append a dated section)
- Modify: `debug.md` (SPA nav/shell notes + symptom-router rows)

- [ ] **Step 1: Bump the service-worker cache version**

Find the current version:

Run: `grep -n "camp-v" public/sw.js`

Edit that constant to the next integer (e.g. if it reads `camp-v20`, make it `camp-v21`). Installed users cache-first the shell, so without this bump they'd keep the old SPA.

- [ ] **Step 2: Append the feature section to `CLAUDE.md`**

Add a new dated section (top of the changelog stack, matching the existing house style):

```markdown
## Account preview (read-only impersonation) — deployed 2026-07-15

Admin → Accounts gets a **Preview** (eye) button on every **active non-admin** account tile
(church / zoneLeader / director / firstAid; never admin). It drops the admin into a real,
RBAC-scoped session as that account, but **read-only** — every write is blocked client-side, so
sign-in/out logs, notes, and audited reveals are never touched. Design + rationale:
`docs/superpowers/specs/2026-07-15-account-preview-design.md`.

- **Backend:** `POST /accounts/users/:id/preview` (admin-only) → `AccountService.previewAccount`
  (validates active + non-admin) then `AuthService.issueTokenFor(id,{mustChangePassword:false})`
  mints a real scoped token. `issueTokenFor(userId, actorOverrides?)` is NEW on `AuthService`
  (the app had no token-minting-for-another-user path before); all existing call sites are
  unaffected. The account controller gained an `auth` dependency (wired in `router.ts`).
  **No preview flag on the Actor, no migration** — read-only is enforced entirely client-side
  (deliberate scope decision: admin-only feature; the client guard reliably prevents the
  accidental writes that would pollute the audit).
- **Frontend (`public/index.html`):** `enterAccountPreview(id)`/`exitAccountPreview()` swap the
  API token + `ACTOR`, `Cache.clear()`, and rebuild nav/tabs from the swapped actor (real RBAC,
  no client-side scoping duplication). The admin's own session is stashed in `_previewStash`,
  mirrored to `localStorage['ycp_preview_stash']` so a mid-preview refresh restores into the
  preview (restored in `_tryRestoreSession`). The write-guard in `api()` now blocks non-GET when
  `PREVIEW_MODE || ACCOUNT_PREVIEW`. The preview POST uses `_doFetch` (not `api`) so it isn't
  self-blocked.
- **Mode composition:** account preview is orthogonal to the existing same-user at-camp preview
  (`PREVIEW_MODE`). A generalized banner (`_updatePreviewBanner`, driven by `updateModeUI`) shows
  "Previewing: NAME (role) — mode · read-only"; when the real global mode is pre-camp it offers a
  **Switch to at-camp view** toggle (`_togglePreviewMode`) that flips the `PREVIEW_MODE` overlay,
  giving the pre-camp / at-camp / at-camp-preview views of that account. The existing same-user
  at-camp preview home card is unchanged.
- **Also:** `updateModeUI` role badge gained a `firstAid` → "First aid" case (previously fell
  through to "Church"), now visible because firstAid accounts are previewable.
```

- [ ] **Step 3: Add `debug.md` entries**

Under the Navigation/shell section (near `enterPreview / exitPreview`), add:

```markdown
| `enterAccountPreview / exitAccountPreview / confirmEnterAccountPreview` | grep the name | **Account preview (2026-07-15)** — read-only impersonation of a different login. Swaps API token + `ACTOR`, stashes the admin's session in `_previewStash` (+ `localStorage['ycp_preview_stash']`). POST via `_doFetch` (bypasses the write-guard). `ACCOUNT_PREVIEW` global is orthogonal to `PREVIEW_MODE`. |
| `_updatePreviewBanner / _togglePreviewMode / _exitAnyPreview` | grep the name | Preview banner label + at-camp overlay toggle (pre-camp only) + shared Exit dispatch. Driven from `updateModeUI`. |
```

Add symptom-router rows:

```markdown
| **Preview button missing on an account / "Preview" does nothing** | SPA `RENDER.adminAccounts` `acctTile` `onPreview` (only set for active non-admin; churches need an active login `cu`) → `confirmEnterAccountPreview` → `enterAccountPreview`. Backend `POST /accounts/users/:id/preview` (`account.controller.preview` → `previewAccount` + `issueTokenFor`). |
| **Writes not blocked during account preview / an audit row appeared** | SPA `api()` guard must read `if(PREVIEW_MODE||ACCOUNT_PREVIEW)`. Read-only is CLIENT-SIDE ONLY by design — the minted token is fully capable server-side. |
| **Stranded in a preview after refresh / can't get back to admin** | `_previewStash` + `localStorage['ycp_preview_stash']` restore in `_tryRestoreSession`; `_exitAnyPreview`→`exitAccountPreview` restores the stashed admin token. `logout()` clears both preview flags + the stash before its POST. |
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run test`
Expected: clean / all pass (docs + sw don't affect either, but confirms the tree is still green).

```bash
git add public/sw.js CLAUDE.md debug.md
git commit -m "chore: bump sw cache + document account preview"
```

---

## Self-Review

**1. Spec coverage:**
- Real scoped token + server RBAC → Tasks 1–3 (`issueTokenFor`, `previewAccount`, endpoint). ✓
- Previewable roles = all non-admin → Task 2 guard (`role==='admin'` reject) + Task 5 `onPreview` (leaders always, churches when active login). ✓
- Read-only client-side → Task 4 Step 2 (`api()` guard). ✓
- No migration / no Actor preview flag → backend tasks add none. ✓
- Frontend token swap mirrors `doLogin` (`{...user,displayName}`, `ycp_token`/`ycp_actor`) → Task 4 Step 4. ✓
- `_previewStash` + localStorage mirror + boot restore → Task 4 Steps 1, 4, 7. ✓
- Banner generalization + mode toggle (pre-camp / at-camp / at-camp-preview) → Task 4 Steps 3–5. ✓
- Confirm modal before entering → Task 4 Step 4 (`confirmEnterAccountPreview`). ✓
- Keep existing same-user at-camp preview card → untouched (no task modifies `enterPreview` or the home card). ✓
- Preview POST must not self-block → Task 4 Step 4 uses `_doFetch`. ✓
- Edge case: admin console unreachable while previewing → free via `navModel`/`RENDER.admin` role gate (no task needed; noted). ✓
- Tests → Tasks 1–2 (Vitest); SPA `node --check` (Tasks 4–5) per repo convention. ✓
- sw bump + docs → Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**3. Type consistency:** `issueTokenFor(userId, actorOverrides?)` and `previewAccount(actor, id)` signatures match across interface, impl, controller, and tests. Frontend uses `confirmEnterAccountPreview`/`enterAccountPreview`/`exitAccountPreview`/`_exitAnyPreview`/`_togglePreviewMode`/`_updatePreviewBanner`/`_previewRoleLabel` consistently across Tasks 4–5. Response shape `{ token, user }` consistent (controller ↔ `enterAccountPreview`). ✓
