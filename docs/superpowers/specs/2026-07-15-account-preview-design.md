# Account preview — design

## Problem

Admins configure per-role accounts (Admin → Accounts & churches) — `church`, `zoneLeader`,
`director`, `firstAid` — but have no way to see what any of those accounts actually see once
logged in. The app's RBAC scoping (role + churchId + zone) is enforced **server-side** from the
signed session token's embedded `Actor` (`src/services/auth.service.ts` `toActor`/`signSession`,
`src/services/access-control.ts`), so an admin's own session never renders a church-scoped or
firstAid-scoped view. Today the only way to check is to log in as that account, which means
knowing or resetting its password.

Inspiration: the YS Connection app's "Admin account preview"
(`../../Project 7 - Connection Made Simple/connection-made-simple`, CLAUDE.md "Admin account
preview" + `docs/superpowers/specs/2026-07-12-admin-account-preview-design.md`). That feature
mints a real scoped token for a target cohort account and drops the admin into a real session as
that account.

Two differences make this app's version distinct from YS Connection's:

1. **Read-only.** YS Connection deliberately allowed real read+write parity (its app doesn't
   attribute writes). This app **does** keep audit trails — sign-in/out logs, note attribution,
   and *audited reveals* (`revealMedicare`, contact reveal both fire audit POSTs). A preview must
   therefore never write, or it would pollute the audit. Writes are blocked.
2. **Mode dimension.** This app has a global `campMode` (`pre-camp` / `at-camp`) plus an existing
   *same-user* "at-camp preview" (client-side `PREVIEW_MODE` overlay). The account preview must
   compose with that so an admin can preview an account in **pre-camp**, **at-camp**, or
   **at-camp preview** (at-camp view while the app is still genuinely pre-camp).

## Goal

From Admin → Accounts, the admin clicks a **Preview** (eye) button on any **active non-admin**
account row and is dropped into a real, RBAC-scoped, **read-only** session as that account — same
nav, same screens, same data scoping as if that account had logged in, but with every write
blocked. A persistent banner shows who is being previewed and in which mode, with a mode toggle
(when applicable) and an Exit button.

## The two dimensions

The feature separates **which account** from **which mode**; they are orthogonal and compose:

| | Real global mode = pre-camp | Real global mode = at-camp |
|---|---|---|
| **Account** | real scoped token for church / zoneLeader / director / firstAid | same |
| **Mode** | toggle at-camp overlay → "at-camp preview" | shows real at-camp; overlay hidden in v1 |

- **Account dimension** is a real minted token → server-side RBAC does the scoping for free (no
  client-side scoping duplication, which the app already flags as a maintenance risk and which
  YS Connection explicitly rejected).
- **Mode dimension** reuses the existing client-side `PREVIEW_MODE` overlay + Day 1/Day 2 toggle
  (`enterPreview`/`updateModeUI`) unchanged. Account preview simply adds the account axis on top.

## Decisions locked during brainstorming

- **Read-only is enforced client-side only.** The minted token is a normal, fully-scoped token;
  writes are blocked in the SPA `api()` guard (the same mechanism today's at-camp preview uses).
  Chosen over a server-side preview-token flag for lower cost, given this is an admin-only feature
  and the client guard reliably prevents accidental writes/audit entries. Residual risk (a crafted
  request under the real token could still write) is accepted.
- **Previewable roles = all non-admin:** `church`, `zoneLeader`, `director`, `firstAid`. Admin
  rows get no Preview button (previewing admin is pointless and could nest).
- **Mode composes via an in-place toggle** in the preview banner (not chosen up front, not
  real-mode-only).
- **Keep** the existing same-user "preview at-camp as admin" home card unchanged for the
  admin-as-self case.
- **The at-camp overlay toggle appears during account preview only when the real global mode is
  pre-camp** (mirrors today's `enterPreview` pre-camp-only constraint). Previewing a pre-camp view
  during real at-camp is out of scope for v1.
- No new DB table, no migration, no new middleware.

## Backend

Read-only is client-side, so the backend just mints a real scoped token — no preview flag on the
`Actor`.

**1. `AuthService.issueTokenFor(userId, actorOverrides?)`** — NEW method on the `AuthService`
interface (`src/services/auth.service.ts`). The app has no equivalent today (`signSession` is
module-private). Implementation:

```
async issueTokenFor(userId, actorOverrides) {
  const user = await users.findById(userId);
  if (!user || user.status !== 'active') return null;
  return signSession({ ...toActor(user), ...actorOverrides }, Date.now() + TOKEN_TTL_MS);
}
```

All existing behaviour is unaffected (new method; no current call site).

**2. `AccountService.previewAccount(actor, id): Promise<SafeUser>`**
(`src/services/account.service.ts`), following the existing `toggleStatus`/`remove` pattern:

```
assertCan(actor, 'admin:manage');
const user = await users.findById(id);
if (!user) throw new NotFoundError('Account not found');
if (user.status !== 'active') throw new BadRequestError('Account is not active');
if (user.role === 'admin') throw new BadRequestError('Admin accounts cannot be previewed');
return toSafeUser(user);
```

**3. Controller `preview(req)`** (`src/api/controllers/account.controller.ts`):

```
if (!req.ctx) throw new UnauthorizedError();
const user = await deps.account.previewAccount(req.ctx, req.params['id']!);
const token = await deps.auth.issueTokenFor(user.id, { mustChangePassword: false });
return { token, user };
```

The `mustChangePassword:false` override is belt-and-suspenders — the forced-password gate is
currently disabled (`MUST_CHANGE_PASSWORD_ENFORCED=false`), but the override keeps preview working
if it is ever re-enabled (previewing a never-logged-in seeded account would otherwise dead-end on
its own change-password screen).

**4. Route** (`src/api/http/router.ts`):

```
{ method: 'POST', path: '/accounts/users/:id/preview', auth: true, handler: (r) => account.preview(r) },
```

`auth: true` requires any valid token to reach the handler; the `assertCan(actor,'admin:manage')`
inside `previewAccount` is the real gate — the same two-layer pattern every Accounts endpoint uses.
No new error types, no schema/migration change.

## Frontend (`public/index.html`)

**New state (near the existing `PREVIEW_MODE` declaration, line ~745):**

```
let ACCOUNT_PREVIEW = false;      // previewing a different account (orthogonal to PREVIEW_MODE)
let _previewStash = null;         // { token, actor } — the admin's own session while previewing
```

`_previewStash` is mirrored to `localStorage['ycp_preview_stash']`. **While previewing,
`ycp_token`/`ycp_actor` hold the *preview* values** (so a mid-preview page refresh restores
straight back into the preview via the existing `_tryRestoreSession`), and the stash holds the
admin's originals. On boot, if `ycp_preview_stash` is present, set `ACCOUNT_PREVIEW=true` and show
the banner after the normal session restore.

**Accounts screen (`RENDER.adminAccounts`, ~1649):** add an **eye** icon button to every row where
`u.role !== 'admin' && u.status === 'active'`, alongside the existing edit/key/trash actions:

```
<button class="btn sm ghost" onclick="confirmEnterAccountPreview('${u.id}')"
  title="Preview this login" aria-label="Preview this login">${icSm('eye')}</button>
```

Needs an `eye` (or `preview`) glyph added to `ICONS`. `confirmEnterAccountPreview(id)` looks the
account up from the already-loaded accounts data (not by threading `displayName` through the
`onclick` string — avoids the apostrophe-escaping gotcha) and shows a confirm modal
("Preview the *X* login? You'll see exactly what they see. This is read-only.") before calling
`enterAccountPreview(id)`.

**`enterAccountPreview(id)`:**
1. `const d = await api('/accounts/users/'+id+'/preview', {method:'POST'})` → `{ token, user }`.
   (This POST must run *before* `ACCOUNT_PREVIEW` is set, or the read-only guard would block it.)
2. `_previewStash = { token: TOKEN, actor: ACTOR }`; persist to `localStorage['ycp_preview_stash']`.
3. `TOKEN = d.token; ACTOR = {...d.user, displayName:((d.user.firstName||'')+' '+(d.user.lastName||'')).trim()};`
   write both to `ycp_token`/`ycp_actor` (mirrors `doLogin`).
4. `Cache.clear()` — mandatory: prevents admin-scoped cached reads leaking into the scoped preview.
5. `SESSIONS=[]; SEL_SESSION=null;` (fresh check-in sessions for the previewed scope).
6. `ACCOUNT_PREVIEW=true; CAMP_MODE=(SETTINGS&&SETTINGS.campMode)||'pre-camp';`
7. Show `#previewBanner`; `updateModeUI(); buildTabs(); STACK=['home']; gotoTab('home');`

**`exitAccountPreview()`** — symmetric reversal: restore `TOKEN`/`ACTOR` from `_previewStash`
(and back into `ycp_token`/`ycp_actor`), clear `ACCOUNT_PREVIEW` **and** `PREVIEW_MODE`, clear
`_previewStash` + `localStorage['ycp_preview_stash']`, `Cache.clear()`,
`CAMP_MODE=(SETTINGS&&SETTINGS.campMode)||'pre-camp'`, hide banner, rebuild shell, home.

**Banner (`#previewBanner`, generalized).** Today it is hardwired to the same-user at-camp preview
("PREVIEW — at-camp view is read-only"). Generalize `updateModeUI` (which already owns the badges)
to also drive the banner label:
- **Account preview:** "Previewing: **{ACTOR.displayName}** ({role label}) — {mode} · read-only".
- **When `ACCOUNT_PREVIEW` and real global mode is pre-camp:** show a **"Switch to at-camp view"**
  / **"Back to pre-camp view"** toggle button in the banner that flips the existing `PREVIEW_MODE`
  overlay (both flags true → at-camp preview of that account). The Day 1/Day 2 badge in
  `updateModeUI` already appears whenever `PREVIEW_MODE` is set, so nothing new is needed there.
- **Same-user at-camp preview (no account):** unchanged label + Exit.

The banner's Exit button dispatches to `exitAccountPreview()` when `ACCOUNT_PREVIEW`, else the
existing `exitPreview()`.

**Read-only guard.** `api()`'s existing non-GET block extends:

```
if (method !== 'GET') {
  if (PREVIEW_MODE || ACCOUNT_PREVIEW) { toast('Preview mode — this is read-only'); throw new Error('Preview — read only'); }
  ...
}
```

Because every write is a non-GET — including the audited reveals (`revealMedicare`, contact
reveal) and the check-in queue — no audit record is ever created during a preview. Reads are
scoped server-side by the real token.

**`logout()`** clears `ACCOUNT_PREVIEW`, `PREVIEW_MODE`, and the stash (memory + localStorage)
*before* the logout POST, so the write-guard doesn't block it (matching how `logout` already
clears `PREVIEW_MODE`).

## Edge cases

- **Admin console unreachable while previewing** — free: `RENDER.admin`/`navModel` gate on
  `role==='admin'`, so a non-admin preview session can't reach Accounts or start a nested preview.
- **Screens/actions the previewed role can't do** — already hidden/blocked by real RBAC on the
  real actor; nothing simulated.
- **`RENDER.home` `/settings` re-fetch** is already guarded by `if(!PREVIEW_MODE)`; the at-camp
  overlay sets `PREVIEW_MODE`, so a composed account+mode preview is covered. In a plain account
  preview (real mode, `PREVIEW_MODE` false) the re-fetch is harmless (global settings only) and
  keeps the previewed session's mode in sync if the admin flips global mode from another device.
- **Stashed admin token expiring** (12h TTL) during a long preview → Exit restores it, the next
  API call 401s → existing login fallback. Accepted, not specially handled.
- **Target account deactivated by someone else mid-preview** — out of scope for v1.
- **`church` account with no `churchId`** — n/a; church accounts always carry a churchId. firstAid
  and director are ministry-wide and scope correctly with a null churchId.

## Testing

- `src/services/account.service.test.ts` (or the existing account test file): `previewAccount`
  rejects a non-admin actor; 404 for a missing id; rejects `role:'admin'`; rejects
  `status:'inactive'`; returns a `SafeUser` (no `passwordHash`) for each of church / zoneLeader /
  director / firstAid.
- `src/services/auth.service.test.ts`: `issueTokenFor` returns a token that `resolveToken`
  accepts, with `actorOverrides` (e.g. `mustChangePassword:false`) applied; returns `null` for an
  inactive/missing user.
- Frontend verified per repo convention — `npm run typecheck` clean, `npm run test` pass,
  `node --check` on the SPA; no localhost/browser driving (CSS/banner reviewed on-device by the
  owner). Bump `public/sw.js` `CACHE` version (HTML changed).

## Explicitly out of scope for v1

- Server-side read-only enforcement (a preview-token flag rejecting writes at the API). Client-side
  guard only, per the brainstorming decision.
- Audit logging of who previewed which account.
- Previewing admin accounts.
- Previewing a *pre-camp* view of an account while the app is in real at-camp mode.
- Any backend schema or migration change.
