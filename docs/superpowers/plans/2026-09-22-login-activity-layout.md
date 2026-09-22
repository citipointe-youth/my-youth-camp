# Login Activity Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder and compact the admin "Login activity" screen: leadership/first-aid accounts first, church logins alphabetically after; one-line rows; the row itself expands to show history.

**Architecture:** SPA-only (`public/index.html`). Ordering + labelling move into a new pure function `_loginActivityOrder(users)` so a node harness (`scripts/login-activity-harness.js`, same extract-by-name pattern as `contact-export-harness.js`) can test it. `RENDER.loginActivity` renders from it.

**Tech Stack:** vanilla JS SPA, node `vm` harness.

**Spec:** Owner request 2026-09-22 (no separate spec — owner asked to skip straight to plan):
1. Leadership/first-aid accounts at the top, then church entries alphabetically.
2. Summary rows much less tall.
3. Remove the "Church" type and church name line (the church is in the username).
4. Leadership rows read "Admin: <username>".
5. No "History (n)" link — a logged-in row is itself tappable to expand.

## Global Constraints

- No backend, DTO, schema or migration change.
- `sw.js` `CACHE` must step `camp-v118` → `camp-v119` (standing rule: index.html changed).
- Repo convention: no dev server / browser; verify with `npm run typecheck`, `npx vitest run`, `node --check` on the SPA script body, and the harness.
- Interpretations chosen (flag to owner):
  - "Admin: <username>" is read as **role label + username** — `Admin: admin`, `Director: director`, `Zone leader: yellowzone`, `First aid: firstaid`.
  - Leadership order: Admin → Director → Zone leader → First aid, then username.
  - Church order: by **church name, then username**, so each church's `b-`/`g-`/`all-` logins sit together (pure username sort would put every `b-` before every `g-`).
  - An inactive account keeps a small "· inactive" suffix on its label (it was on the removed line and is still worth seeing).
  - The "N of M church logins haven't logged in yet" summary line stays.

---

### Task 1: Ordering/label function + harness + render + docs

**Files:**
- Modify: `public/index.html` (`/* ===== LOGIN ACTIVITY ===== */` block, `RENDER.loginActivity`; add `.la-*` CSS)
- Create: `scripts/login-activity-harness.js`
- Modify: `public/sw.js` (CACHE → `camp-v119`)
- Modify: `CLAUDE.md` (new dated section at top), `debug.md` (symptom router note)

**Interfaces:**
- Produces: `_loginActivityOrder(users) -> Array<{u, label, leader:boolean}>` — `users` is the `GET /accounts/users` array (`role`, `username`, `churchName`, `status`, `loginHistory`). **Extracted by name by the harness — never rename it.**

- [ ] **Step 1: Write the failing harness** `scripts/login-activity-harness.js`

```js
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function extract(decl) { /* same brace-matching extractor as contact-export-harness.js */ }
const ctx = { console, JSON, Object, String, Array }; vm.createContext(ctx);
vm.runInContext(extract('function _loginActivityOrder('), ctx);
const U = (role, username, churchName, extra) => Object.assign({ role, username, churchName: churchName || null, status: 'active', loginHistory: [] }, extra);
const users = [
  U('church', 'g-victory', 'Victory Church'), U('firstAid', 'firstaid'), U('church', 'b-grace', 'Grace Point'),
  U('admin', 'admin'), U('church', 'b-victory', 'Victory Church'), U('zoneLeader', 'yellowzone'),
  U('director', 'director'), U('church', 'g-grace', 'Grace Point', { status: 'inactive' }),
];
const out = ctx._loginActivityOrder(users);
check('order', out.map(r => r.u.username), ['admin','director','yellowzone','firstaid','b-grace','g-grace','b-victory','g-victory']);
check('labels', out.map(r => r.label), ['Admin: admin','Director: director','Zone leader: yellowzone','First aid: firstaid','b-grace','g-grace · inactive','b-victory','g-victory']);
check('leader flag', out.map(r => r.leader), [true,true,true,true,false,false,false,false]);
check('does not mutate input', users[0].username, 'g-victory');
check('empty', ctx._loginActivityOrder([]).length, 0);
```

- [ ] **Step 2: Run it — expect FAIL** `node scripts/login-activity-harness.js` → `not found in index.html: function _loginActivityOrder(`

- [ ] **Step 3: Implement** — add above `RENDER.loginActivity`:

```js
function _loginActivityOrder(users){
  const RANK={admin:0,director:1,zoneLeader:2,firstAid:3};
  const LBL={admin:'Admin',director:'Director',zoneLeader:'Zone leader',firstAid:'First aid'};
  const isL=u=>u.role!=='church';
  return [...(users||[])].sort((a,b)=>{
    if(isL(a)!==isL(b))return isL(a)?-1:1;
    if(isL(a))return (RANK[a.role]??9)-(RANK[b.role]??9)||String(a.username).localeCompare(String(b.username));
    return String(a.churchName||'').localeCompare(String(b.churchName||''))||String(a.username).localeCompare(String(b.username));
  }).map(u=>({u,leader:isL(u),label:(isL(u)?(LBL[u.role]||u.role)+': ':'')+u.username+(u.status==='inactive'?' · inactive':'')}));
}
```

Rewrite the row renderer: a logged-in row is a `<details class="la-row">` whose `<summary>` holds label (left, ellipsis) + relative last-login (right); the body lists `dtFmt` timestamps. A never-logged-in row is a plain `<div class="la-row">` with "Never logged in". CSS (`.la-row` compact padding ~7px 12px, 5px gap, `summary` marker hidden, a small chevron that rotates on `[open]`).

- [ ] **Step 4: Run harness — expect all ok.** Then `npm run typecheck`, `npx vitest run`, `node --check` on the extracted SPA script body and `public/sw.js`.

- [ ] **Step 5: Bump `sw.js` → `camp-v119`; add CLAUDE.md section + debug.md note; commit; push `master`; verify `curl -s https://my-youth-camp.vercel.app/sw.js | head -1` shows `camp-v119`.**
