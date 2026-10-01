# Pulse / First-aid filter / Student-edit overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name the Unallocated pulse bar (tap → Data Import), add ‹ › session stepping to the pulse, swap the first-aid Records Today/All toggle for a day dropdown (and load every record), and route Student Data Edit church/accommodation changes through the existing override records.

**Architecture:** SPA-only edits to `public/index.html`. The decision logic is pulled into three small pure functions (`_pulseGroups`, `_faKeep`, `_stuSavePlan`) that a node harness extracts from the HTML and exercises with `vm`, the repo's established pattern for browser-only code. Rendering code calls those functions.

**Tech Stack:** vanilla JS SPA, Node `vm` harness, `tsc` + `vitest` (backend untouched).

**Spec:** `docs/superpowers/specs/2026-10-01-pulse-firstaid-studentedit-design.md`

## Global Constraints

- SPA only. No route, permission, DTO or migration change. **No database writes.**
- Repo convention: no local server, no browser. Verify with `npm run typecheck`, `npm run test`, `node scripts/pulse-fa-harness.js`, and `node --check` on the extracted SPA script.
- Every button inside a `.rowsb` flex row is `.btn … sm` with `flex:0 0 auto` (camp-v107 rule).
- Bump `public/sw.js` `CACHE` `camp-v141` → `camp-v142`.
- Brisbane dates use `localDateISO()`, never `toISOString().slice(0,10)`.
- Deploy = push `master` (Vercel auto-deploys). Then confirm `curl -s https://my-youth-camp.vercel.app/sw.js | head -1` shows `camp-v142`.

---

### Task 1: Pure helpers + harness

**Files:**
- Create: `scripts/pulse-fa-harness.js`
- Modify: `public/index.html` (add the helpers beside `renderOversightPulse`, `drawFaRecords` and `_stuFormBody`)

**Interfaces (produced):**
- `_pulseGroups(roster, byChurch) → [{key, label, raw, unalloc, total, done}]`. Insertion order; unallocated groups last.
- `_faKeep(group, filter, today, dayOf) → boolean`, where filter is `'all' | 'today' | 'YYYY-MM-DD'` and `dayOf(iso) → 'YYYY-MM-DD'`.
- `_stuSavePlan(s, b) → {patch, allocateTo: string|null, accOv: undefined|null|'tent'|'classroom'}`.

- [ ] **Step 1: Write the harness** (it extracts by name prefix, like `scripts/data-search-harness.js`). It checks:
  - `_pulseGroups`:
    - Rows with zone `''`/null/undefined become one group, `key:'__unallocated__'`, `label:'Unallocated'`, sorted last.
    - Real zones get the label `'<Zone> Zone'`.
    - byChurch mode uses the church name as the label.
    - Totals and done counts are correct.
  - `_faKeep`:
    - `'all'` keeps everything.
    - `'today'` matches on `today`.
    - A day matches on the record's own date or any amendment's date.
    - A group with no `createdAt` is never kept by a day filter.
  - `_stuSavePlan`:
    - An unchanged church gives `allocateTo:null`. A changed church gives its id.
    - The patch never contains `churchId`, `churchName`, `zone` or `accommodationKind`.
    - `accOv` is `undefined` when unchanged, `null` when cleared, and the value when it's set or changed.
- [ ] **Step 2: Run** `node scripts/pulse-fa-harness.js`. It should fail with "not found in index.html: function _pulseGroups(".
- [ ] **Step 3: Add the helpers to index.html:**

```js
// Pure (harness: scripts/pulse-fa-harness.js). A roster row with no zone (byChurch: no church) is
// a student nobody has allocated — grouped as "Unallocated" and sorted last, not a blank " Zone" bar.
function _pulseGroups(roster,byChurch){
  const groups={};
  (roster||[]).forEach(r=>{
    const raw=(byChurch?r.church:r.zone)||'';
    const un=!raw,key=un?'__unallocated__':raw;
    if(!groups[key])groups[key]={key,label:un?'Unallocated':(byChurch?raw:raw+' Zone'),raw,unalloc:un,total:0,done:0};
    groups[key].total++;if(r.checkedIn)groups[key].done++;
  });
  const out=Object.values(groups);
  return out.filter(g=>!g.unalloc).concat(out.filter(g=>g.unalloc));
}
```

```js
// Pure (harness). filter: 'all' | 'today' | 'YYYY-MM-DD'. A record is kept for a day if it OR any
// of its amendments was logged that day (Brisbane date via dayOf).
function _faKeep(g,filter,today,dayOf){
  if(filter==='all')return true;
  const day=filter==='today'?today:filter;
  const on=n=>!!(n&&n.createdAt)&&dayOf(n.createdAt)===day;
  return on(g.n)||(g.amends||[]).some(on);
}
```

```js
// Pure (harness). Splits a Student Data Edit save into: the plain PATCH (never church/zone/accommodation),
// the church re-allocation (POST /import/allocate → an allocation_overrides row that survives re-imports),
// and the individual accommodation override (undefined = unchanged, null = clear).
function _stuSavePlan(s,b){
  const patch={firstName:b.firstName,lastName:b.lastName,gender:b.gender,grade:b.grade,medical:b.medical,dietary:b.dietary};
  const allocateTo=b.churchId&&b.churchId!==s.churchId?b.churchId:null;
  const was=s.accommodationOverride||null,now=b.accOv||null;
  return {patch,allocateTo,accOv:now===was?undefined:now};
}
```

- [ ] **Step 4: Run the harness.** Expect every check `ok` and exit code 0.
- [ ] **Step 5: Commit** with the message `feat(spa): pure helpers for pulse groups, first-aid day filter, student save plan`.

### Task 2: Pulse — Unallocated bar + ‹ › session stepping

**Files:** Modify `public/index.html`: `renderOversightPulse`, `_pulseGoToChurch`, `_renderAllocCards`, and the home `homePulse` injection.

**Interfaces:**
- Consumes `_pulseGroups`.
- Produces `_pulseSess` (the session id being viewed), `_pulseStep(dir)`, `_pulseGoUnalloc()`, and `_openAllocCard` (a one-shot card key).

- [ ] **Step 1:** `renderOversightPulse(sessId)` changes:
  - Load the session list into `SESSIONS` if it's empty.
  - Set `_pulseSess = sessId || _pulseSess || current.id || SESSIONS[0].id`.
  - Fetch that session's `/status` and build the bars from `_pulseGroups`.
  - The card gets `id="homePulse"` so it can re-render itself.
  - The header is `.rowsb`: label `Check-in pulse` on the left; on the right, `‹` + `_ciLabel(session)` + `•` if current + `›`. The arrows are `btn ghost sm`, `flex:0 0 auto`, `width:auto`, and disabled at either end of the list.
  - Unallocated bars: admin/director → `onclick="_pulseGoUnalloc()"`; zoneLeader → no tap.
- [ ] **Step 2:** Add `_pulseStep(dir)`. It moves the index within `SESSIONS`, calls `renderOversightPulse(id)`, and replaces `#homePulse` with the result. The home injection already uses `outerHTML`, and keeps doing so.
- [ ] **Step 3:** `_pulseGoToChurch(church)` also sets `SEL_SESSION=_pulseSess`.
- [ ] **Step 4:** Add `_pulseGoUnalloc(){_openAllocCard='unallocated';go('import');}`. In `_renderAllocCards`, after the `openKeys` reapply, add this one-shot block: if `_openAllocCard` is set, open that `details`, `scrollIntoView`, then clear `_openAllocCard`.
- [ ] **Step 5:** Run `node --check` on the extracted SPA script, then commit.

### Task 3: First-aid Records — day dropdown + full fetch

**Files:** Modify `public/index.html`: `RENDER.records`, `faRecSeg` → `faRecDay`, `drawFaRecords`.

- [ ] **Step 1:** `RENDER.records`:
  - Fetch `/notes/firstaid?limit=1000`.
  - Replace the `.seg` with `<select class="fld" id="faRecDay" onchange="faRecDay(this.value)">`.
  - Options: Today, then each `SETTINGS.checkInDays` entry labelled `Day N · Mon 28 Sep` (the Notes label format), then All.
  - `_faRecFilter` is pre-selected.
- [ ] **Step 2:** `faRecDay(v){_faRecFilter=v;drawFaRecords();}`. Delete `faRecSeg`, after grepping to confirm nothing else calls it.
- [ ] **Step 3:** `drawFaRecords` filters with `list.filter(g=>_faKeep(g,_faRecFilter,localDateISO(),localDateISO))`. Empty state:
  - Today → "No actions logged today."
  - A day → "No actions logged on <label>."
  - All → "No actions logged yet."
- [ ] **Step 4:** Run `node --check`, then commit.

### Task 4: Student Data Edit → override records

**Files:** Modify `public/index.html`: `_stuNorm`, `_stuFormFields`, `_stuFormBody`, `stuSave`.

- [ ] **Step 1:** `_stuNorm` adds `accommodationOverride: r.accommodationOverride ?? null`.
- [ ] **Step 2:** `_stuFormFields` changes:
  - If the student's church isn't in `_stuChurches` (for example Unallocated), the church select starts with a selected `— Select church —` option with value `''`. Today it silently pre-selects the first church.
  - The accommodation select becomes `seAccOv`, with the options `— (use imported)` / Tent / Classroom, pre-selected from `accommodationOverride`.
  - When an override is set, show the hint "Individual override — survives re-imports".
  - The Add form (`s` null) keeps the old `seAcc` select so `stuCreate` is unchanged.
- [ ] **Step 3:** `_stuFormBody` reads `accOv` from `seAccOv` when it exists.
- [ ] **Step 4:** `stuSave` runs the existing validation, then `const plan=_stuSavePlan(s,b)`, then these calls in order:
  1. `PATCH /registrants/:id` with `plan.patch`.
  2. If `plan.allocateTo`, `POST /import/allocate {personId:id, churchId:plan.allocateTo}`.
  3. If `plan.accOv!==undefined`, `PATCH /registrants/:id {accommodationOverride:plan.accOv}`.

  Then call `_invalidate('/registrants')` and `_invalidate('/import/allocate')`. In a `finally` after a failure, still call `_rStu()` so the table shows what did save.
- [ ] **Step 5:** Run `node --check`, then commit.

### Task 5: Docs, cache bump, verify, deploy

- [ ] Bump `sw.js` to `camp-v142`. Add a CLAUDE.md entry at the top for `camp-v142`. Add a debug.md symptom-router entry.
- [ ] Run `npm run typecheck`, `npm run test`, `node scripts/pulse-fa-harness.js`, `node scripts/data-search-harness.js` (as a regression), and `node --check` on the SPA script.
- [ ] Commit, push `master`, and confirm the live `sw.js` shows `camp-v142`.
