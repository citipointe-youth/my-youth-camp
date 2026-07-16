# At-camp leader UX consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the tired at-camp leader's experience — one unified Sign-in/Check-in entry with a settable switchover, a merged "Students" tab (My group + Other churches), a 4-tile church-leader home, and a fix for the double-tap-to-open-profile bug.

**Architecture:** All time-based behaviour is computed **client-side** (the backend is serverless with no scheduler). Two new `CampSettings` columns drive the phase (`checkinSwitchoverTime`, `checkinPhaseOverride`); the SPA reads them and derives arrival-vs-daily. The SPA (`public/index.html`) is a single file with an inline `<script>`; navigation flows through one source of truth (`navModel`) plus a nav-token guard (`_navToken`/`_navId`/`paint()`).

**Tech Stack:** TypeScript + Express backend (`src/`), single-file vanilla-JS SPA (`public/index.html`), Supabase Postgres (numbered SQL migrations in `supabase/migrations/`), Vitest for backend tests. Auto-deploys to https://my-youth-camp.vercel.app on push to `master`.

**Companion spec:** `docs/superpowers/specs/2026-07-16-at-camp-leader-ux-consolidation-design.md` (read it first — it holds the persona, rationale, and owner-confirmed decisions).

## Global Constraints

- **Migrations are consolidated:** the live baseline is `supabase/migrations/0001`–`0004`. The new migration is **`0005`**. Do NOT touch `supabase/migrations_archive/`.
- **Supabase settings write ALL columns every save** (`saveSingleton` upserts the full column set). The migration (0005) must exist before the new columns are read/written — land Task 1 fully (incl. migration file) before any deploy.
- **SPA verification** = `node --check` on the extracted `<script>` (there is no SPA unit-test harness) + manual walkthrough. Backend changes get real Vitest tests.
- **`sw.js` is cache-first:** any change to `public/index.html` REQUIRES bumping `CACHE` in `public/sw.js` (currently `'camp-v24'` → `'camp-v25'`). Done once, in the final task.
- **Brisbane time everywhere:** never use raw `new Date().toISOString().slice(0,10)` for camp-day logic. Use the existing `localDateISO()` / `_realCampDayNumber()` and the new `brisbaneNowTime()`.
- **Timezone is fixed** at `Australia/Brisbane` (re-asserted on every settings save — do not add a timezone field).
- **Commit after every task.** Co-author trailer on commits:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Scope:** at-camp only. Pre-camp (`RENDER.people`), first-aid navigation, and the `search` screen used by first-aid are **untouched**. No new RBAC capabilities or endpoints.

---

## File structure

**Backend (exact code given in tasks):**
- `supabase/migrations/0005_checkin_switchover_settings.sql` — CREATE: two nullable-with-default columns.
- `src/core/entities/settings.ts` — MODIFY: add two required fields to `CampSettings`.
- `src/repositories/supabase/supabase.settings.ts` — MODIFY: `toSettings`, `settingsCols`, `UPDATE_COLS`.
- `src/data/seed.ts` — MODIFY: default the two fields on the seed settings row.
- `src/core/validation/content.schema.ts` — MODIFY: `UpdateSettingsSchema` accepts the two fields.
- `src/api/controllers/settings.controller.test.ts` — MODIFY: test factory + new coverage.
- Any other `CampSettings` object literal the compiler flags (test factories) — MODIFY: add the two fields.

**SPA (`public/index.html`) — anchors are current line numbers; re-confirm before editing):**
- Phase helpers `brisbaneNowTime()` / `campPhase()` — near `_realCampDayNumber` (959).
- `navModel` (1194) + `navSidebar` (1227) + `TAB_OF` (1100) — Search→Students; phase-labelled Check-in.
- `RENDER.checkin` (1761) → split into phase branch + `_renderDailyCheckin` + `_renderArrival`; generalise `fdDraw` (2518) screen target.
- New `RENDER.students` + `_renderMyGroup` / `_renderOtherChurches` (from `RENDER.myyouth` 2594 and `RENDER.search` 2180); `filterMyYouth` (2606) church grouping for zoneLeader.
- `renderHomeAtCamp` (1422) — 4-tile set, accommodation→hero line, Notes→bold slim link.
- `openCamper` (2641) — nav-token claim; Back → Students.
- New `<section class="screen" id="students">` in the static screen list (525).
- `RENDER.adminSettings` (3263) + `saveSettings` (3307) — switchover-time input + phase-override control.
- `public/sw.js` — CACHE bump.

---

## Task 1: Backend — settings switchover fields (migration + type + repo + schema + seed)

**Files:**
- Create: `supabase/migrations/0005_checkin_switchover_settings.sql`
- Modify: `src/core/entities/settings.ts:16-27`
- Modify: `src/repositories/supabase/supabase.settings.ts:14-19,40-45,58-65`
- Modify: `src/data/seed.ts:140-141`
- Modify: `src/core/validation/content.schema.ts:74-87`
- Test: `src/api/controllers/settings.controller.test.ts:11-16`

**Interfaces:**
- Produces: `CampSettings.checkinSwitchoverTime: string` (`'HH:MM'` 24h, default `'14:00'`) and `CampSettings.checkinPhaseOverride: 'auto' | 'signin' | 'checkin'` (default `'auto'`). Consumed by the SPA phase helper (Task 2) via `GET /settings`, and written by `PATCH /settings` (Task 7).

- [ ] **Step 1: Write the failing test** — add coverage to `src/api/controllers/settings.controller.test.ts`. First extend the `settings()` factory (line 11-16) so the two required fields are present:

```typescript
  return {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-07-01', endDate: '2026-07-05',
    timezone: 'Australia/Brisbane', checkInDays: [], accommodationLocked: false,
    churchLoginLocked: false, zoneLeaderLoginLocked: false,
    churchCheckinTimeRestricted: false,
    checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto',
    campMode: 'pre-camp', createdAt: now, updatedAt: now, ...over,
  };
```

Then append a new describe block at the end of the file (validates the schema round-trip):

```typescript
import { UpdateSettingsSchema } from '../../core/validation/content.schema';

describe('UpdateSettingsSchema — check-in switchover fields', () => {
  it('accepts a valid HH:MM switchover time and a phase override', () => {
    const parsed = UpdateSettingsSchema.parse({ checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'signin' });
    expect(parsed.checkinSwitchoverTime).toBe('14:00');
    expect(parsed.checkinPhaseOverride).toBe('signin');
  });
  it('rejects a malformed time', () => {
    expect(() => UpdateSettingsSchema.parse({ checkinSwitchoverTime: '2pm' })).toThrow();
  });
  it('rejects an unknown phase override', () => {
    expect(() => UpdateSettingsSchema.parse({ checkinPhaseOverride: 'later' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- settings.controller`
Expected: FAIL — `UpdateSettingsSchema` does not yet accept the fields / type error on the factory.

- [ ] **Step 3: Add the fields to the `CampSettings` entity** — in `src/core/entities/settings.ts`, insert after the `churchCheckinTimeRestricted: boolean;` line (currently line 27):

```typescript
  churchCheckinTimeRestricted: boolean;
  // Unified arrival→daily switchover (at-camp). Client-side phase model (serverless, no scheduler).
  // Clock time 'HH:MM' (24h, Brisbane) at which Day-1 arrival sign-in gives way to daily check-in.
  checkinSwitchoverTime: string;
  // Manual admin override of the arrival/daily phase. 'auto' = time-driven (the normal case);
  // 'signin'/'checkin' pin the phase across the app until set back to 'auto'.
  checkinPhaseOverride: 'auto' | 'signin' | 'checkin';
```

- [ ] **Step 4: Wire the Supabase repo** — in `src/repositories/supabase/supabase.settings.ts`:

In `toSettings` (after line 19, `churchCheckinTimeRestricted: ...`):

```typescript
    churchCheckinTimeRestricted: (r['church_checkin_time_restricted'] as boolean | null) ?? false,
    checkinSwitchoverTime: (r['checkin_switchover_time'] as string | null) ?? '14:00',
    checkinPhaseOverride: (r['checkin_phase_override'] as CampSettings['checkinPhaseOverride'] | null) ?? 'auto',
```

In `settingsCols` (after line 45, `church_checkin_time_restricted: ...`):

```typescript
    church_checkin_time_restricted: s.churchCheckinTimeRestricted,
    checkin_switchover_time: s.checkinSwitchoverTime,
    checkin_phase_override: s.checkinPhaseOverride,
```

In `UPDATE_COLS` (line 58-65), add the two column names before `'updated_at'`:

```typescript
  'church_login_locked', 'zone_leader_login_locked', 'church_checkin_time_restricted', 'camp_mode',
  'checkin_switchover_time', 'checkin_phase_override',
  'last_temp_passwords', 'last_exported_at',
```

- [ ] **Step 5: Default the fields on the seed row** — in `src/data/seed.ts`, after the `churchCheckinTimeRestricted: false,` line (currently 140):

```typescript
    churchCheckinTimeRestricted: false,
    checkinSwitchoverTime: '14:00',
    checkinPhaseOverride: 'auto',
```

- [ ] **Step 6: Extend the validation schema** — in `src/core/validation/content.schema.ts`, inside `UpdateSettingsSchema` (line 74-87), add before the closing `campMode` line:

```typescript
  churchCheckinTimeRestricted: z.boolean().optional(),
  checkinSwitchoverTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM 24h').optional(),
  checkinPhaseOverride: z.enum(['auto', 'signin', 'checkin']).optional(),
  campMode: z.enum(CAMP_MODES).optional(),
```

- [ ] **Step 7: Write the migration** — create `supabase/migrations/0005_checkin_switchover_settings.sql`:

```sql
-- 0005: Unified arrival→daily check-in switchover (at-camp).
--
-- Two client-side-driven settings. The SPA computes arrival-vs-daily from these + Brisbane time
-- (serverless: no scheduler). Backward-compatible & idempotent — existing settings row gets the
-- defaults (14:00 switchover, auto phase).
alter table settings add column if not exists checkin_switchover_time text not null default '14:00';
alter table settings add column if not exists checkin_phase_override text not null default 'auto';
```

- [ ] **Step 8: Fix any remaining compiler errors** — the two new fields are REQUIRED, so every full `CampSettings` object literal must include them.

Run: `npm run typecheck`
For EACH error reported (test factories in files such as `dashboard.service.test.ts`, `admin.characterisation.test.ts`, `accommodation.characterisation.test.ts`, `auth.service.test.ts`, `checkin.service.test.ts`), add the two fields to that literal:

```typescript
    checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto',
```

Re-run `npm run typecheck` until clean.

- [ ] **Step 9: Run tests + typecheck to verify green**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; all tests PASS (including the three new schema cases).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/0005_checkin_switchover_settings.sql src/core/entities/settings.ts src/repositories/supabase/supabase.settings.ts src/data/seed.ts src/core/validation/content.schema.ts src/**/*.test.ts
git commit -m "feat(settings): add check-in switchover time + phase override fields"
```

---

## Task 2: SPA — phase helpers (`brisbaneNowTime`, `campPhase`)

**Files:**
- Modify: `public/index.html` (insert after `_realCampDayNumber` ends, line 967)

**Interfaces:**
- Produces: `brisbaneNowTime(): string` → `'HH:MM'` 24h Brisbane clock time. `campPhase(): 'signin' | 'checkin'` — the entry the unified surface should show. Consumed by Tasks 3, 5, 7.
- Consumes: existing globals `SETTINGS`, `PREVIEW_MODE`, `_realCampDayNumber()`.

- [ ] **Step 1: Insert the helpers** — in `public/index.html`, immediately after line 967 (the closing `}` of `_realCampDayNumber`), add:

```javascript
// Current Brisbane clock time as 'HH:MM' (24h), zero-padded, comparable to checkinSwitchoverTime.
// formatToParts + the '24'→'00' guard avoids the midnight '24:00' quirk some engines emit.
function brisbaneNowTime(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Brisbane',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  let h=(parts.find(p=>p.type==='hour')||{}).value||'00';
  const m=(parts.find(p=>p.type==='minute')||{}).value||'00';
  if(h==='24')h='00';
  return h+':'+m;
}
// Which face the unified Sign-in/Check-in surface shows. 'signin' = Day-1 arrival before the
// switchover; 'checkin' = daily roll-call. Manual override (admin) wins; otherwise time-driven.
function campPhase(){
  const o=(SETTINGS&&SETTINGS.checkinPhaseOverride)||'auto';
  if(o==='signin'||o==='checkin')return o;
  const day1=PREVIEW_MODE?(((SETTINGS&&SETTINGS.campDay)||1)===1):(_realCampDayNumber()===1);
  const sw=(SETTINGS&&SETTINGS.checkinSwitchoverTime)||'14:00';
  return (day1&&brisbaneNowTime()<sw)?'signin':'checkin';
}
```

- [ ] **Step 2: Syntax-check the SPA script**

Run (Git Bash): `sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d' > /tmp/spa.js && node --check /tmp/spa.js && echo OK`
Expected: `OK` (no syntax error). If the file has multiple `<script>` blocks, extract the main one containing `function campPhase` and check that.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(spa): add campPhase()/brisbaneNowTime() phase helpers"
```

---

## Task 3: SPA — unified Sign-in/Check-in entry (phase-branched `RENDER.checkin`)

Fold Day-1 arrival sign-in into the Check-in surface: one nav id (`checkin`) renders arrival before the switchover, daily check-in after. The bottom-tab label/icon derive from phase.

**Files:**
- Modify: `public/index.html` — `navModel` (1213-1221), `RENDER.checkin` (1761), `fdDraw` (2518-2567)

**Interfaces:**
- Consumes: `campPhase()` (Task 2).
- Produces: `_renderDailyCheckin()` (the existing daily body), `_renderArrival()` (arrival body painted into the `checkin` screen). Both reachable only through `RENDER.checkin`.

- [ ] **Step 1: Generalise `fdDraw` to target a configurable screen** — the arrival draw currently hard-codes the `firstday` screen. Add a module-level var and repoint the two DOM writes.

Immediately BEFORE `RENDER.firstday=async function(){` (line 2507) add:

```javascript
// The arrival ("first day sign in") body can render into either the standalone `firstday`
// screen (legacy/direct) or the unified `checkin` screen (phase==='signin'). fdDraw writes here.
let _fdScreen='firstday';
```

In `RENDER.firstday` (line 2507-2517), make it set the target before drawing — change the first line of the body to:

```javascript
RENDER.firstday=async function(){
  _fdScreen='firstday';
  paint('firstday','<p class="note-hint" style="margin-top:40px;text-align:center">Loading…</p>','First Day Sign In','Select students to confirm');
```

In `fdDraw` (2518), replace the tail that writes to the DOM. Change line 2563-2566 from:

```javascript
  const el=document.getElementById('firstday');
  if(el)el.innerHTML=html;
  document.getElementById('barT').textContent='First Day Sign In';
  document.getElementById('barS').textContent=(notIn.length-pendingCount)+' remaining';
```

to:

```javascript
  const el=document.getElementById(_fdScreen);
  if(el)el.innerHTML=html;
  document.getElementById('barT').textContent='First Day Sign In';
  document.getElementById('barS').textContent=(notIn.length-pendingCount)+' remaining';
```

- [ ] **Step 2: Add `_renderArrival` (arrival body into the checkin screen)** — immediately AFTER the end of `RENDER.firstday` (line 2517, the `};`), add:

```javascript
// Arrival sign-in rendered INTO the unified `checkin` screen (phase==='signin'). Reuses the exact
// first-day arrival flow (window._fd* state + fdDraw/fdToggle/fdConfirmAll), only redirecting its
// output to the active `checkin` screen so the tab highlight, Back stack and nav token stay stable.
async function _renderArrival(){
  _fdScreen='checkin';
  paint('checkin','<p class="note-hint" style="margin-top:40px;text-align:center">Loading…</p>','First Day Sign In','Select students to confirm');
  const [camperPage,regList]=await Promise.all([api('/campers?pageSize=300'),api('/registrants')]);
  const campers=(Array.isArray(camperPage)?camperPage:camperPage.items||[]).filter(c=>c.kind==='student');
  const camperIds=new Set(campers.map(c=>c.id));
  const registrants=(Array.isArray(regList)?regList:[]).filter(c=>c.kind!=='leader'&&!camperIds.has(c.id));
  window._fdAll=[...registrants,...campers];
  window._fdPending=new Set();
  window._fdGender='all';window._fdGrade='all';
  fdDraw();
}
```

- [ ] **Step 3: Rename the daily check-in render + add the phase branch** — rename the existing `RENDER.checkin` (line 1761) to `_renderDailyCheckin`, leaving its whole body unchanged. Change line 1761 from:

```javascript
RENDER.checkin=async function renderCheckin(){
```

to:

```javascript
async function _renderDailyCheckin(){
```

Then, immediately BEFORE `_renderDailyCheckin` (new line at 1761), add the single entry point:

```javascript
// Unified entry: one nav id, phase-branched. Arrival sign-in before the switchover, daily after.
RENDER.checkin=async function(){
  if(campPhase()==='signin'){ await _renderArrival(); return; }
  await _renderDailyCheckin();
};
```

Note: `selDay`/`setFilter` (1872-1873) call `RENDER.checkin()` — in the daily phase this re-enters `_renderDailyCheckin` correctly; they never appear in the arrival UI, so no change needed.

- [ ] **Step 4: Make the Check-in nav tab label/icon phase-driven** — in `navModel` (1194), the at-camp church/zoneLeader/director/admin branches each build a Check-in tab as `T('checkin','check','Check-in')`. Introduce a phase-aware token at the top of `navModel` and use it in all at-camp branches.

After the `const T=(id,icon,label)=>({id,icon,label});` line (1195) add:

```javascript
  const _ci=()=> (typeof campPhase==='function'&&campPhase()==='signin')
    ? T('checkin','check','Sign-in') : T('checkin','check','Check-in');
```

Then in each **at-camp** branch (lines 1213-1221) replace the literal `T('checkin','check','Check-in')` with `_ci()`. There are three occurrences (church/zoneLeader 1214, director 1216, admin 1220). Leave the pre-camp branches untouched (they have no checkin tab). Also update `navSidebar`'s hard-coded admin-at-camp list (line 1231): change `T('checkin','check','Check In')` to `_ci()` — add the same `const _ci` helper inside that block, or compute the label inline:

```javascript
  if(role==='admin'&&mode==='at-camp'){
    const T=(id,icon,label)=>({id,icon,label});
    const ciLabel=(typeof campPhase==='function'&&campPhase()==='signin')?'Sign-in':'Check In';
    return [T('home','home','Home'),T('checkin','check',ciLabel),T('search','search','Search'),
            T('notifs','bell','Notices'),T('accom','classroom','Accommodation Allocations'),T('admin','gear','Admin Settings')];
  }
```

(The tab text refreshes on the next `buildTabs()`/nav — i.e. next home visit or settings sync; the screen content itself always reflects live phase. This is acceptable — a leader hits Home or the tab, which re-derives it.)

- [ ] **Step 5: Syntax-check the SPA script**

Run (Git Bash): `sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d' > /tmp/spa.js && node --check /tmp/spa.js && echo OK`
Expected: `OK`.

- [ ] **Step 6: Manual smoke (local)** — start the app (`npm run dev` or the repo's documented run command), log in as a church leader in at-camp mode. With `checkinPhaseOverride='auto'` and today = Day 1 before 14:00 (or set override to `signin` via DB/settings), the Check-in tab shows the arrival sign-in list and tab reads "Sign-in"; with override `checkin` (or Day 2+), it shows the daily roster and reads "Check-in". Confirm arrival ticking + Confirm still signs students in.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat(spa): unify arrival sign-in into phase-branched Check-in entry"
```

---

## Task 4: SPA — "Students" tab (merge My Youth + Search)

Introduce a `students` screen hosting a `.seg` control with **My group** (default) and **Other churches**. Repurpose the at-camp Search bottom tab into Students. First-aid's `search` screen/tab is untouched.

**Files:**
- Modify: `public/index.html` — static screens (533), `TAB_OF` (1100-1106), `navModel` (1213-1221), `navSidebar` (1231), `RENDER.myyouth` (2594), `filterMyYouth` (2606), `RENDER.search` (2180)

**Interfaces:**
- Consumes: existing `/campers`, `/search`, `/search/contact/:id/:role`.
- Produces: `RENDER.students(subtab)`, `_renderMyGroup()`, `_renderOtherChurches()`, `switchStudentsTab(sub)`. `openCamper` Back target (Task 6) relies on the `students` screen existing.

- [ ] **Step 1: Add the static `students` screen** — in `public/index.html`, after line 533 (`<section class="screen" id="myyouth"></section>`) add:

```html
    <section class="screen" id="students"></section>
```

- [ ] **Step 2: Extract My-group rendering into `_renderMyGroup`** — the current `RENDER.myyouth` (2594-2605) fetches `/campers`, builds the filter bar, and calls `filterMyYouth()` into `#myYouthList`. Generalise it to render into a caller-provided container id (default keeps `myyouth` working). Replace `RENDER.myyouth` (2594-2605) with:

```javascript
RENDER.myyouth=async function(){ await _renderMyGroup('myyouth'); };
// My-group roster (At camp / Signed out / Late arrivals) rendered into `screenId`. Used by the
// legacy `myyouth` screen and by the merged Students tab (screenId='students').
async function _renderMyGroup(screenId){
  paint(screenId,'<p class="note-hint" style="margin-top:40px;text-align:center">Loading…</p>','Student Search','At camp · signed out · late');
  const page=await api('/campers?pageSize=300');
  const items=Array.isArray(page)?page:page.items||[];
  const isWide=['zoneLeader','director','admin'].includes(ACTOR.role);
  const zones=[...new Set(items.map(c=>c.zone))].sort();
  const zoneFilterHtml=isWide?`<select id="myZoneF" onchange="filterMyYouth()"><option value="all">All zones</option>${zones.map(z=>`<option value="${z}">${z} Zone</option>`).join('')}</select>`:'';
  window._myYouthAll=items;
  const base=`<div class="rowsb" style="margin-bottom:8px"><span class="lbl" style="margin:0">Your group</span>${helpTip('Everyone in your group, split into At camp, Signed out, and Not yet arrived. Tap a name to see their details and contacts.')}</div><div class="filters">${zoneFilterHtml}<select id="myGenderF" onchange="filterMyYouth()"><option value="all">All genders</option><option value="female">Girls</option><option value="male">Guys</option></select><select id="myGradeF" onchange="filterMyYouth()"><option value="all">All grades</option>${GRADES.map(g=>`<option value="${g}">Yr ${g}</option>`).join('')}<option value="leaders">Leaders</option></select></div><div id="myYouthList"></div>`;
  document.getElementById(screenId).querySelector('#myYouthList')?document.getElementById(screenId).innerHTML=base:document.getElementById(screenId).innerHTML=base;
  filterMyYouth();
}
```

> Simplify the last two lines to just `document.getElementById(screenId).innerHTML=base; filterMyYouth();` — the `#myYouthList` container lives inside `base`, and `filterMyYouth` finds it by id regardless of the parent screen. (The verbose ternary above is redundant; use the two clean lines.)

- [ ] **Step 3: Add church grouping to `filterMyYouth` for zone leaders** — in `filterMyYouth` (2606-2640), the three sections (`atCamp`, `signedOut`, `notArrived`) each render a flat `.map(myRow)`. For `zoneLeader`, group each section by church with sub-headings. Replace the section-building block (lines 2624-2639, from `let html='';` to the end of the function) with:

```javascript
  const groupByChurch=ACTOR.role==='zoneLeader';
  function section(title,rows){
    if(!rows.length)return '';
    let out=`<h3 class="sec">${title} (${rows.length})</h3>`;
    if(groupByChurch){
      const by={};rows.forEach(c=>{(by[c.churchName]||(by[c.churchName]=[])).push(c);});
      Object.keys(by).sort().forEach(ch=>{
        out+=`<div class="lbl" style="margin:8px 0 2px">${esc(ch)}</div>`+by[ch].map(myRow).join('');
      });
    }else{
      out+=rows.map(myRow).join('');
    }
    return out;
  }
  let html='';
  html+=section('At camp',atCamp);
  html+=section('Signed out of camp',signedOut);
  if(notArrived.length){
    html+=`<h3 class="sec">Late arrivals (${notArrived.length})</h3>`;
    html+=`<div class="infobox" style="font-size:.8rem;margin-bottom:8px">First Day Sign In is closed. Sign in late arrivals here — tap a name, then “Sign in to camp”. A note is logged automatically.</div>`;
    if(groupByChurch){
      const by={};notArrived.forEach(c=>{(by[c.churchName]||(by[c.churchName]=[])).push(c);});
      Object.keys(by).sort().forEach(ch=>{html+=`<div class="lbl" style="margin:8px 0 2px">${esc(ch)}</div>`+by[ch].map(myRow).join('');});
    }else{
      html+=notArrived.map(myRow).join('');
    }
  }
  if(!html)html='<p class="note-hint" style="margin-top:24px;text-align:center">No one matches these filters.</p>';
  el.innerHTML=html;
}
```

(The `myRow` closure and the `atCamp`/`signedOut`/`notArrived` computations above it stay exactly as they are.)

- [ ] **Step 4: Extract Other-churches search into `_renderOtherChurches`** — the current `RENDER.search` (2180-2183) has a first-aid guard and paints the search UI into `search`. Keep `RENDER.search` for first-aid, and add a reusable body that paints into a given screen. Replace `RENDER.search` (2180-2183) with:

```javascript
RENDER.search=function(){
  if(ACTOR&&ACTOR.role==='firstAid'){renderSearchFirstAid();return;}
  _renderOtherChurches('search');
};
// Camp-wide contact lookup (masked leader phone reveal) rendered into `screenId`.
function _renderOtherChurches(screenId){
  paint(screenId,`<div class="rowsb" style="margin-bottom:8px"><span class="lbl" style="margin:0">Find another church's leader</span>${helpTip('Search any camper or leader by name. Tap a result to reveal masked contact details.')}</div><div class="search"><span>${ic('search')}</span><input id="q" placeholder="Type a student's name…" oninput="doSearch(this.value)"></div><div id="results"><p class="note-hint">Type a name to find any camper or leader across the camp.</p></div>`,'Student Search','Find any camper');
}
```

(`doSearch`/`runSearch`/`reveal` at 2184-2202 are unchanged — they operate on `#q`/`#results` by id.)

- [ ] **Step 5: Add `RENDER.students` + the seg switcher** — immediately AFTER `_renderOtherChurches` (from Step 4) add:

```javascript
let STUDENTS_SUB='mygroup';
RENDER.students=async function(){
  const seg=`<div class="seg" id="studentsSeg" style="margin-bottom:10px">
      <button class="${STUDENTS_SUB==='mygroup'?'on':''}" onclick="switchStudentsTab('mygroup')">My group</button>
      <button class="${STUDENTS_SUB==='others'?'on':''}" onclick="switchStudentsTab('others')">Other churches</button>
    </div><div id="studentsBody"></div>`;
  // Paint the shell first so the seg is stable, then fill the body for the active sub-tab.
  paint('students',seg,'Student Search',STUDENTS_SUB==='mygroup'?'Your group':'Find any camper');
  await _renderStudentsBody();
};
async function _renderStudentsBody(){
  const host=document.getElementById('studentsBody');
  if(!host)return;
  if(STUDENTS_SUB==='others'){
    host.innerHTML=`<div class="rowsb" style="margin-bottom:8px"><span class="lbl" style="margin:0">Find another church's leader</span>${helpTip('Search any camper or leader by name. Tap a result to reveal masked contact details.')}</div><div class="search"><span>${ic('search')}</span><input id="q" placeholder="Type a student's name…" oninput="doSearch(this.value)"></div><div id="results"><p class="note-hint">Type a name to find any camper or leader across the camp.</p></div>`;
    return;
  }
  // My group: fetch + render the roster into #studentsBody.
  host.innerHTML='<p class="note-hint" style="margin-top:40px;text-align:center">Loading…</p>';
  const page=await api('/campers?pageSize=300');
  const items=Array.isArray(page)?page:page.items||[];
  const isWide=['zoneLeader','director','admin'].includes(ACTOR.role);
  const zones=[...new Set(items.map(c=>c.zone))].sort();
  const zoneFilterHtml=isWide?`<select id="myZoneF" onchange="filterMyYouth()"><option value="all">All zones</option>${zones.map(z=>`<option value="${z}">${z} Zone</option>`).join('')}</select>`:'';
  window._myYouthAll=items;
  host.innerHTML=`<div class="filters">${zoneFilterHtml}<select id="myGenderF" onchange="filterMyYouth()"><option value="all">All genders</option><option value="female">Girls</option><option value="male">Guys</option></select><select id="myGradeF" onchange="filterMyYouth()"><option value="all">All grades</option>${GRADES.map(g=>`<option value="${g}">Yr ${g}</option>`).join('')}<option value="leaders">Leaders</option></select></div><div id="myYouthList"></div>`;
  filterMyYouth();
}
function switchStudentsTab(sub){
  STUDENTS_SUB=sub;
  document.querySelectorAll('#studentsSeg button').forEach(b=>b.classList.remove('on'));
  const idx=sub==='mygroup'?0:1;
  const btns=document.querySelectorAll('#studentsSeg button');if(btns[idx])btns[idx].classList.add('on');
  _renderStudentsBody();
}
```

> Note: `RENDER.students` deliberately inlines the My-group markup (rather than calling `_renderMyGroup`) so both sub-views share the single `#studentsBody` container. `_renderMyGroup`/`RENDER.myyouth` from Steps 2 remain only for the legacy `myyouth` screen and become dead once Task 5 removes its home tile — leave them defined (harmless) unless a later cleanup removes them.

- [ ] **Step 6: Repoint navigation from `search`→`students`** — in `navModel` (1194), the at-camp church/zoneLeader (1214) and director (1216) branches contain `T('search','search','Search')`. Replace those two with `T('students','users','Students')`. For admin at-camp (1220) also replace `T('search','search','Search')` with `T('students','users','Students')`. In `navSidebar`'s admin-at-camp list (Step 4 of Task 3 already edited this block) replace `T('search','search','Search')` with `T('students','users','Students')`. **Do NOT touch the first-aid branch (1199)** — it keeps its own `search` tab.

- [ ] **Step 7: Map `students` + `camper` in `TAB_OF`** — in `TAB_OF` (1100-1106) so the Students tab highlights for its screen and for an opened profile. Change the `checkin:'checkin',search:'search',...` line (1104) to add `students:'students'`, and change the `camper:'home'` mapping (1106) to `camper:'students'`:

```javascript
  checkin:'checkin',search:'search',students:'students',allstudents:'allstudents',records:'records',notifs:'notifs',compose:'notifs',
  data:'data',
  camper:'students',myyouth:'students',firstday:'checkin',schedule:'schedule',devotional:'home',faq:'home',notes:'home',testimonies:'home',budget:'home',accom:'home',import:'import'};
```

(Also remaps `myyouth`→`students` and `firstday`→`checkin` so any lingering navigation highlights the right tab.)

- [ ] **Step 8: Syntax-check the SPA script**

Run (Git Bash): `sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d' > /tmp/spa.js && node --check /tmp/spa.js && echo OK`
Expected: `OK`.

- [ ] **Step 9: Manual smoke (local)** — as a church leader at-camp, tap the **Students** bottom tab → lands on **My group** (roster with At camp / Signed out / Late arrivals); tap a name → profile opens, sign-in/out works. Switch the seg to **Other churches** → name search + "Call primary/secondary" reveal works. Log in as a **zone leader** → My group shows church sub-headings within each section.

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "feat(spa): merge My Youth + Search into a Students tab with My group/Other churches"
```

---

## Task 5: SPA — 4-tile church-leader home

**Files:**
- Modify: `public/index.html` — `renderHomeAtCamp` (1422-1445)

**Interfaces:**
- Consumes: `campPhase()` (Task 2), the `students`/`checkin` nav (Tasks 3-4), `canReadNotes()`.

- [ ] **Step 1: Rework the church-leader tile set** — in `renderHomeAtCamp` (1422), replace the tile-building block (lines 1432-1445, from `const tiles=[];` down to the director `Student Data Table` push) with a role-aware build. The church-leader path caps at 4 tiles + accommodation-in-hero + a Notes slim link; other roles keep their existing tiles.

Replace lines 1432-1445 with:

```javascript
  const tiles=[];
  const phase=campPhase();
  const entryLabel=phase==='signin'?'First Day Sign In':'Daily Check-in';
  const entryIcon=phase==='signin'?'check':'check';
  // Unified Sign-in/Check-in entry — one tile, phase-labelled, routes to the Check-in surface.
  tiles.push(`<div class="tile" onclick="gotoTab('checkin')"><div class="ic">${ic(entryIcon)}</div><div class="l">${entryLabel}</div></div>`);
  tiles.push(`<div class="tile" onclick="go('testimonies')"><div class="ic">${ic('star')}</div><div class="l">Submit Testimonies</div></div>`);
  tiles.push(`<div class="tile" onclick="go('schedule')"><div class="ic">${ic('calendar')}</div><div class="l">Schedule</div></div>`);
  tiles.push(`<div class="tile" onclick="go('devotional')"><div class="ic">${ic('book')}</div><div class="l">Devotional</div></div>`);
  // Non-church roles keep their existing extra tiles (Notices / Data). Church stays at exactly 4.
  if(ACTOR.role!=='church'){
    if(ACTOR.role!=='director')tiles.push(`<div class="tile" onclick="gotoTab('notifs')"><div class="ic">${ic('bell')}</div><div class="l">Notices</div></div>`);
    if(ACTOR.role==='director')tiles.push(`<div class="tile" onclick="go('data')"><div class="ic">${ic('note')}</div><div class="l">Student Data Table</div></div>`);
  }
  // Testimonies & Notes → slim full-width bold link below the grid (not a tile).
  const notesLinkHtml=canReadNotes()?`<div class="card tap" onclick="go('notes')" style="margin-top:10px"><div class="rowsb"><div style="font-weight:700">${icSm('note')} Testimonies &amp; Notes</div><span style="color:var(--muted)">›</span></div></div>`:'';
  // Accommodation → one-line strip inside the hero (church, real at-camp only).
  const accomLineHtml=(ACTOR.role==='church'&&!PREVIEW_MODE)?`<div style="margin-top:8px;color:#cfe0ff;font-size:.78rem">${icSm('classroom')} Your accommodation: ${esc(myAccom)}</div>`:'';
```

- [ ] **Step 2: Inject the accommodation line + notes link into the layout** — a little further down, the `html` template (line 1457-1465) builds the hero + tiles. Add `accomLineHtml` inside the hero card and `notesLinkHtml` after the tiles. Change the `html` assignment (1457-1465) to:

```javascript
  const html=`<div class="hero">${heroMark()}<div class="k">${esc(SETTINGS?.campName||'Youth Camp')} · Live</div>
    <h2>Hi ${esc(d.greetingName||ACTOR.displayName)}</h2>
    <div style="color:#cfe0ff;font-size:.82rem">${ACTOR.role==='admin'?'Back office':ACTOR.role==='director'?'Director':ACTOR.role==='zoneLeader'?(esc(ACTOR.zone)+' Zone Leader'):'Church · '+esc(ACTOR.zone)+' Zone'}</div>
    ${accomLineHtml}
    ${digestHtml}</div>
  ${myDayHtml}
  <div class="tiles">${tiles.join('')}</div>
  ${notesLinkHtml}
  <div id="homePulse"></div>
  <div class="rowsb" style="margin-top:18px"><h3 class="sec" style="margin:0">Notices</h3></div>
  <div id="homeNotices" style="margin-top:10px">${noticesHtml}</div>`;
```

(The old church "Your Accommodation" tile at 1442 and the "My Youth Details" tile at 1435 are gone — both were inside the replaced block in Step 1. `myAccom` is still computed at 1427-1431 and now feeds `accomLineHtml`.)

- [ ] **Step 3: Syntax-check the SPA script**

Run (Git Bash): `sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d' > /tmp/spa.js && node --check /tmp/spa.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Manual smoke (local)** — as a church leader at-camp, the home shows **exactly 4 tiles** (Sign-in/Check-in · Submit Testimonies · Schedule · Devotional), a one-line accommodation strip in the hero, and a bold **Testimonies & Notes** link below the grid. The first tile's label follows the phase; tapping it opens the Check-in surface. Confirm no "My Youth Details" tile remains (it's on the Students tab).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(spa): 4-tile church-leader home; accommodation→hero line, notes→slim link"
```

---

## Task 6: SPA — fix profile double-tap (nav-token claim)

**Reproduce first**, then fix by having `openCamper` claim the nav token so an in-flight list re-render can't steal the screen back.

**Files:**
- Modify: `public/index.html` — `openCamper` (2641, 2670-2675)

**Interfaces:**
- Consumes: nav core `_navToken`/`_navId`/`_showScreen` (1125-1152).

- [ ] **Step 1: Reproduce the bug** — as a church leader at-camp on the Students → My group list (which uses the stale-while-revalidate list render), tap a name once. Observe whether the profile fails to open on the first tap and needs a second. Note the behaviour (the hypothesis: the background list `paint()` lands after `openCamper` and `_showScreen('camper')`, and because `openCamper` never set `_navId='camper'`, the list paint's `_showScreen(list)` steals focus back). If it does NOT reproduce, STOP and report — do not apply a speculative fix.

- [ ] **Step 2: Claim the nav token in `openCamper`** — in `openCamper` (2641), the tail (2670-2675) pushes the stack and calls `_paint`/`_showScreen` but never updates `_navId`/`_navToken`. Change lines 2670-2675 from:

```javascript
  const camperEl=document.getElementById('camper');
  if(camperEl)camperEl.scrollTop=0;
  if(push&&STACK[STACK.length-1]!=='camper')STACK.push('camper');
  _paint('camper','',fullName,p.zone+' Zone');
  _showScreen('camper');
}
```

to:

```javascript
  const camperEl=document.getElementById('camper');
  if(camperEl)camperEl.scrollTop=0;
  if(push&&STACK[STACK.length-1]!=='camper')STACK.push('camper');
  // Claim the nav token so a list screen's in-flight stale-while-revalidate paint() (which calls
  // _showScreen back to itself) is dropped by paint()'s stale-guard instead of stealing focus.
  ++_navToken; _navId='camper';
  _paint('camper','',fullName,p.zone+' Zone');
  _showScreen('camper');
}
```

- [ ] **Step 3: Verify the fix** — repeat Step 1's reproduction. The profile now opens on the **first** tap. Also confirm Back from the profile returns to **Students → My group** (TAB_OF maps `camper`→`students` from Task 4).

- [ ] **Step 4: Syntax-check the SPA script**

Run (Git Bash): `sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d' > /tmp/spa.js && node --check /tmp/spa.js && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "fix(spa): open camper profile on first tap (claim nav token)"
```

---

## Task 7: SPA — Admin Settings controls (switchover time + phase override) + cache bump

**Files:**
- Modify: `public/index.html` — `RENDER.adminSettings` (3287-3292), `saveSettings` (3316-3319)
- Modify: `public/sw.js` — CACHE (line 1)

**Interfaces:**
- Consumes: the settings fields from Task 1 (via `SETTINGS`), PATCH `/settings`.

- [ ] **Step 1: Add the switchover-time input + phase-override control** — in `RENDER.adminSettings` (3263), after the church-check-in-restriction toggle block (ends line 3290) and before the Save button (3291), insert:

```javascript
    <label style="margin-top:16px">Arrival → daily check-in switchover</label>
    <div class="two-col">
      <div><label>Switchover time (Day 1)</label><input class="fld" id="stSwitchover" type="time" value="${esc(s.checkinSwitchoverTime||'14:00')}"></div>
      <div><label>Phase</label>
        <div class="seg" id="stPhaseSeg">
          <button type="button" class="${(s.checkinPhaseOverride||'auto')==='auto'?'on':''}" data-phase="auto" onclick="setPhaseOverride('auto')">Auto</button>
          <button type="button" class="${s.checkinPhaseOverride==='signin'?'on':''}" data-phase="signin" onclick="setPhaseOverride('signin')">Sign-in</button>
          <button type="button" class="${s.checkinPhaseOverride==='checkin'?'on':''}" data-phase="checkin" onclick="setPhaseOverride('checkin')">Check-in</button>
        </div>
      </div>
    </div>
    <p class="note-hint">On Day 1, arrival sign-in switches to daily check-in at the time above. <b>Auto</b> follows that time; <b>Sign-in</b> / <b>Check-in</b> force the phase across the whole app until set back to Auto.</p>
```

Then, immediately AFTER the `RENDER.adminSettings` function (after line 3294 `};`), add the segment handler + confirm:

```javascript
window._phaseOverride=null;
function setPhaseOverride(v){
  // Manual flip changes every live session's entry — confirm before pinning away from Auto.
  if(v!=='auto'){
    const proceed=confirm('Force the '+(v==='signin'?'arrival sign-in':'daily check-in')+' phase for everyone until set back to Auto?');
    if(!proceed)return;
  }
  window._phaseOverride=v;
  document.querySelectorAll('#stPhaseSeg button').forEach(b=>b.classList.toggle('on',b.dataset.phase===v));
}
```

- [ ] **Step 2: Send the two fields on save** — in `saveSettings` (3307), read the controls and add them to the PATCH body. After the `const churchCheckinRestrict=...` line (3318) add:

```javascript
    const switchover=document.getElementById('stSwitchover')?.value||'14:00';
    const phaseOverride=window._phaseOverride||document.querySelector('#stPhaseSeg button.on')?.dataset.phase||'auto';
```

Then extend the PATCH body object (line 3319) — add the two fields inside the `body:{...}`:

```javascript
    await api('/settings',{method:'PATCH',body:{campName:val('stName'),year:Number(val('stYear'))||new Date().getFullYear(),startDate:val('stStart'),endDate:val('stEnd'),timezone:'Australia/Brisbane',checkInDays:days,churchLoginLocked:churchLock,zoneLeaderLoginLocked:zoneLock,churchCheckinTimeRestricted:churchCheckinRestrict,checkinSwitchoverTime:switchover,checkinPhaseOverride:phaseOverride}});
```

- [ ] **Step 3: Bump the service-worker cache** — in `public/sw.js` line 1, change:

```javascript
const CACHE = 'camp-v24';
```

to:

```javascript
const CACHE = 'camp-v25';
```

- [ ] **Step 4: Syntax-check both scripts**

Run (Git Bash): `sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d' > /tmp/spa.js && node --check /tmp/spa.js && node --check public/sw.js && echo OK`
Expected: `OK`.

- [ ] **Step 5: Full backend gate**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean, all tests PASS.

- [ ] **Step 6: Manual smoke (local, admin)** — open Admin → Camp settings: the switchover time shows `14:00` and the phase seg shows **Auto**. Change the time, pick **Sign-in** (confirm dialog appears), Save → toast "Settings saved". Reload; the values persist. As a church leader, the Check-in surface + home tile now reflect the forced phase; set back to **Auto** and Save to restore time-driven behaviour.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "feat(spa): admin switchover-time + phase-override controls; bump sw cache"
```

---

## Deployment note

Merging `feat/student-search-consolidation` into `master` auto-deploys to https://my-youth-camp.vercel.app. Migration `0005` must be applied to the Supabase project (Sydney, `nwfafrgojqkxylbppywo`) as part of the release — the settings save writes all columns, so the columns must exist first. After deploy: hard-load the prod URL (bypass cache) and check the console for CSP violations; walk the church-leader flow (arrival → switchover → daily check-in → Students → home 4-tile → open a profile on first tap).

---

## Self-review

**Spec coverage:**
- §2.1 unified entry → Tasks 1 (settings), 2 (phase helper), 3 (phase-branched checkin + nav label), 7 (admin controls). ✓
- §2.2 Students merge + zoneLeader church grouping → Task 4. ✓
- §2.3 4-tile home + accommodation hero line + Notes slim bold link → Task 5. ✓
- §2.4 double-tap fix (reproduce first) → Task 6. ✓
- §3 backend surface (migration, entity, repo, schema, seed) → Task 1; sw bump → Task 7. ✓
- §4 out-of-scope (swipe-to-sign-out, pre-camp, first-aid) → untouched (first-aid `search` explicitly preserved). ✓

**Type consistency:** `checkinSwitchoverTime`/`checkinPhaseOverride` names identical across entity, repo, schema, seed, SPA. `campPhase()` return `'signin'|'checkin'` used consistently in Tasks 3/5. `STUDENTS_SUB` values `'mygroup'|'others'` consistent in Task 4. `_fdScreen` set in both arrival paths.

**Known non-blocking behaviours (documented in-task):** bottom-tab label refreshes on next nav/settings sync rather than instantly at the switchover minute (screen content is always live); `_renderMyGroup`/`RENDER.myyouth` become dead code after Task 5 but are left defined (harmless).
