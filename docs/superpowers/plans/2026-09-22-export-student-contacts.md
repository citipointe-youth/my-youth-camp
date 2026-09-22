# Export Student Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Export student contact" button to the top-middle of the My Youth snapshot card that downloads an `.xlsx` of the people in scope (students + leaders) with Type, First name, Last name, Grade, Email, Phone (+ Church for wide roles).

**Architecture:** Browser-only, in `public/index.html`. A pure row builder `_contactExportRows(regs, withChurch)` turns the already-loaded `/registrants` rows into an array-of-arrays; a button handler `exportStudentContacts()` feeds it `scopeRegs()` and writes the workbook with the vendored SheetJS, exactly like `exportAccommodation()` (~line 5711). No backend, DTO, schema, or migration change — `RegistrantDto` already carries `firstName/lastName/email/mobile/grade/kind/status/churchName`, and none are masked for any role.

**Tech Stack:** Vanilla JS SPA (`public/index.html`, no build step), vendored SheetJS 0.18.5 (`public/vendor/xlsx.full.min.js`, lazy-loaded by `_ensureXlsx`), Node harness scripts in `scripts/` (vitest cannot reach SPA code).

**Spec:** The design approved in chat on 2026-09-22 (no separate spec file — bounded change). Reproduced here:

- **Placement:** top-middle of the My Youth snapshot card (`buildPeopleSnap`), between the "Students" count (left) and the accommodation badge (right). On narrow phones the button wraps to its own centred row beneath them rather than overlapping.
- **Roles:** every role that sees My Youth — `church`, `zoneLeader`, `director`, `admin`.
- **Who is exported:** `scopeRegs()` — the login's own scope + the Church dropdown for director/admin. Gender, Grade and search filters are ignored. **Cancelled registrants excluded** (`status==='cancelled'`). **Students AND leaders.**
- **Columns:** `Type` (Student/Leader), `First name`, `Last name`, `Grade` (blank for leaders), `Email`, `Phone`; plus a leading `Church` column when `_isWideRole()` (director/admin/zoneLeader).
- **Sort:** Church (when present) → Students before Leaders → last name → first name.
- **Phone:** through `fmtPhone` (e.g. `0411 928 301`), written as a text cell so the leading 0 survives.
- **File:** one sheet named `Contacts`, filename via `_exportName('contacts','xlsx')` → `youth-camp-<year>-contacts-<date>.xlsx`.

## Global Constraints

- SPA-only: touch `public/index.html`, `public/sw.js`, one new `scripts/` harness, `CLAUDE.md`, `debug.md`. **No** `src/` or `supabase/` change.
- No new dependency. Use the vendored SheetJS via `_ensureXlsx()` — never add a `<script>` tag or npm package.
- Bump `public/sw.js` `CACHE` from `'camp-v117'` to `'camp-v118'` (installed PWAs keep the old `index.html` otherwise).
- User-facing copy is exactly **"Export student contact"** (button) — the owner's wording.
- `master` auto-deploys to production (https://my-youth-camp.vercel.app). **Do not push** — commit locally only; the owner decides when to push.
- Commit with `git -c core.autocrlf=true` if CRLF noise appears; stage files by name, never `git add -A`.
- Commit messages end with the session's attribution lines (see the executing session's system reminder).

## File map

| File | Change | Responsibility |
|---|---|---|
| `public/index.html` | Modify — add `_contactExportRows` + `exportStudentContacts` just above `RENDER.people` (~line 3123); edit `buildPeopleSnap`'s header row (~line 3154); add CSS next to `.accbadge` (~line 691) | Feature |
| `scripts/contact-export-harness.js` | Create | Runs the REAL `_contactExportRows` + `fmtPhone` extracted from `index.html`, plus a SheetJS round-trip proving phone cells are text |
| `public/sw.js` | Modify line 1 | Cache bump |
| `CLAUDE.md`, `debug.md` | Modify (top entry / Pre-camp screens table) | Project docs convention |

## Execution routing (token efficiency)

| Task | Suggested executor | Why |
|---|---|---|
| 1 — row builder + harness | **Sonnet subagent** | Fully specified code; mechanical |
| 2 — button, handler, CSS, cache bump | **Sonnet subagent** | Fully specified code; mechanical |
| 3 — browser verification | **Main session (Opus)** | Needs judgment on layout at phone width + opening the file |
| 4 — docs | **Sonnet subagent** | Copy-in text below |

Each subagent prompt should include: this plan's path, the task number, the repo path `C:\Users\thoma\OneDrive\Claude Programs\Project 9 - Camp Platform\youth-camp-platform-masterv2`, and "do not push". Verify each subagent's diff (`git show --stat HEAD` + read the hunk) before the next task — agent summaries describe intent, not results.

---

### Task 1: Pure row builder `_contactExportRows` + harness

**Files:**
- Create: `scripts/contact-export-harness.js`
- Modify: `public/index.html` — insert immediately **above** the line `RENDER.people=async function renderPeople(){` (grep for it; ~line 3123)

**Interfaces:**
- Consumes: `fmtPhone(phone)` (existing, `public/index.html` ~line 3107) — returns `''` for null, a spaced AU mobile for 9/10/11-digit inputs, else the input unchanged.
- Produces: `_contactExportRows(regs, withChurch) → Array<Array<string|number>>` — row 0 is the header; returns just the header when nothing qualifies. Task 2 calls it with `(scopeRegs(), _isWideRole())`.

- [ ] **Step 1: Write the failing harness**

Create `scripts/contact-export-harness.js`:

```js
/*
 * My Youth "Export student contact" harness (2026-09-22).
 *
 * The row builder is browser-only code (public/index.html has no build step), so vitest cannot
 * reach it. Runs the REAL functions extracted from index.html by name, then round-trips the rows
 * through the vendored SheetJS to prove phone numbers land as TEXT cells (a numeric cell drops
 * the leading 0 — the whole reason fmtPhone exists).
 *
 *   node scripts/contact-export-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Name-prefix match (not full signature) — see data-search-harness.js for why.
function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
    else if (ch === ';' && !started) return SRC.slice(i, j + 1);
  }
  throw new Error('unbalanced extraction for ' + decl);
}

const ctx = { console, JSON, Object, String, Math, Array, Number };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(['function fmtPhone(', 'function _contactExportRows('].map(extract).join('\n'), ctx);
const { _contactExportRows } = ctx;
if (typeof _contactExportRows !== 'function') throw new Error('sandbox guard: _contactExportRows missing');

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}

const P = (o) => Object.assign({ kind: 'camper', status: 'registered', grade: 9, email: null, mobile: null, churchName: 'Alpha' }, o);
const REGS = [
  P({ firstName: 'Zoe', lastName: 'Adams', churchName: 'Bravo', mobile: '0411928301', email: 'zoe@x.com', grade: 8 }),
  P({ firstName: 'Liam', lastName: 'Brown', kind: 'leader', grade: null, mobile: '412345678', email: 'liam@x.com' }),
  P({ firstName: 'Ava', lastName: 'Clark', mobile: '+61 400 111 222', email: 'ava@x.com', grade: 10 }),
  P({ firstName: 'Ben', lastName: 'Clark', grade: 7 }),
  P({ firstName: 'Gone', lastName: 'Away', status: 'cancelled', mobile: '0400000000' }),
];

console.log('\n1. Header');
check('header without church', _contactExportRows([], false)[0], ['Type', 'First name', 'Last name', 'Grade', 'Email', 'Phone']);
check('header with church', _contactExportRows([], true)[0], ['Church', 'Type', 'First name', 'Last name', 'Grade', 'Email', 'Phone']);
check('empty input -> header only', _contactExportRows([], false).length, 1);
check('null input -> header only', _contactExportRows(null, false).length, 1);

console.log('\n2. Rows without church (church login)');
const plain = _contactExportRows(REGS, false);
check('cancelled excluded', plain.length - 1, 4);
check('students first, then by last/first name', plain.slice(1).map(r => r[1]), ['Zoe', 'Ava', 'Ben', 'Liam']);
check('student row', plain[1], ['Student', 'Zoe', 'Adams', 8, 'zoe@x.com', '0411 928 301']);
check('+61 mobile normalised', plain[2][5], '0400 111 222');
check('blank email + phone are empty strings', plain[3], ['Student', 'Ben', 'Clark', 7, '', '']);
check('leader row: blank grade, 9-digit mobile regains its 0', plain[4], ['Leader', 'Liam', 'Brown', '', 'liam@x.com', '0412 345 678']);

console.log('\n3. Rows with church (wide roles)');
const wide = _contactExportRows(REGS, true);
check('sorted by church first', wide.slice(1).map(r => r[0] + ':' + r[2]), ['Alpha:Ava', 'Alpha:Ben', 'Alpha:Liam', 'Bravo:Zoe']);
check('church row shape', wide[4], ['Bravo', 'Student', 'Zoe', 'Adams', 8, 'zoe@x.com', '0411 928 301']);

console.log('\n4. SheetJS round-trip keeps phones as text');
const sj = { console, Date, Math, JSON, Uint8Array, ArrayBuffer, Buffer, TextDecoder, TextEncoder, setTimeout };
sj.window = sj; sj.self = sj; sj.global = sj;
vm.createContext(sj);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'xlsx.full.min.js'), 'utf8'), sj);
const XLSX = sj.XLSX;
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plain), 'Contacts');
const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' });
const ws = back.Sheets['Contacts'];
check('sheet name', back.SheetNames, ['Contacts']);
check('phone cell is text with leading 0', [ws['F2'].t, ws['F2'].v], ['s', '0411 928 301']);
check('grade cell is a number', [ws['D2'].t, ws['D2'].v], ['n', 8]);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/contact-export-harness.js`
Expected: throws `not found in index.html: function _contactExportRows(`

- [ ] **Step 3: Implement the row builder**

Insert directly above `RENDER.people=async function renderPeople(){` in `public/index.html`:

```js
/* My Youth "Export student contact" (2026-09-22). Everyone in scopeRegs() minus cancelled —
   students AND leaders despite the button's wording (owner's call). Pure so
   scripts/contact-export-harness.js can run it; that harness extracts it BY NAME. */
function _contactExportRows(regs,withChurch){
  const s=v=>String(v||'');
  const people=(regs||[]).filter(r=>r.status!=='cancelled').slice().sort((a,b)=>
    (withChurch?s(a.churchName).localeCompare(s(b.churchName)):0)||
    ((a.kind==='leader')-(b.kind==='leader'))||
    s(a.lastName).localeCompare(s(b.lastName))||s(a.firstName).localeCompare(s(b.firstName)));
  const head=['Type','First name','Last name','Grade','Email','Phone'];
  const rows=[withChurch?['Church',...head]:head];
  people.forEach(r=>{
    const isL=r.kind==='leader';
    // String(fmtPhone(..)) — a text cell, so Excel keeps the leading 0.
    const row=[isL?'Leader':'Student',s(r.firstName),s(r.lastName),isL||r.grade==null?'':r.grade,s(r.email),String(fmtPhone(r.mobile)||'')];
    rows.push(withChurch?[s(r.churchName),...row]:row);
  });
  return rows;
}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `node scripts/contact-export-harness.js`
Expected: every line `ok`, final line `ALL PASS`, exit code 0.

Then syntax-check the SPA body (the extract range moves every edit — derive it):

```bash
S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1); E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1); sed -n "$((S+1)),$((E-1))p" public/index.html > "$TMPDIR/spa.js" && node --check "$TMPDIR/spa.js" && echo SPA-OK
```
Expected: `SPA-OK`

- [ ] **Step 5: Commit**

```bash
git add public/index.html scripts/contact-export-harness.js
git commit -m "Add contact-export row builder for My Youth + harness"
```

---

### Task 2: Button, handler, CSS, cache bump

**Files:**
- Modify: `public/index.html` — `buildPeopleSnap` header row (~line 3154); new `exportStudentContacts` directly under `_contactExportRows`; CSS after the `.accbadge{…}` rule (~line 691)
- Modify: `public/sw.js:1`

**Interfaces:**
- Consumes: `_contactExportRows(regs, withChurch)` (Task 1); existing `scopeRegs()`, `_isWideRole()`, `_ensureXlsx()`, `_rlSaveBlob(blob,name)`, `_exportName(base,ext)`, `toast(msg)`, `icSm(name)`.
- Produces: global `exportStudentContacts()` (onclick target); button `#contactExportBtn`.

- [ ] **Step 1: Add the click handler**

Directly below `_contactExportRows` in `public/index.html`:

```js
async function exportStudentContacts(){
  const btn=document.getElementById('contactExportBtn');
  if(btn)btn.disabled=true;
  try{
    const rows=_contactExportRows(scopeRegs(),_isWideRole());
    if(rows.length<2){toast('Nothing to export yet');return;}
    await _ensureXlsx();
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Contacts');
    const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    _rlSaveBlob(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
      _exportName('contacts','xlsx'));
    toast('Contact list downloaded');
  }catch(e){
    toast(e.message||'Could not build the contact list');
  }finally{
    if(btn)btn.disabled=false;
  }
}
```

- [ ] **Step 2: Put the button in the card**

In `buildPeopleSnap`, replace these three lines:

```js
    <div class="rowsb"><div><div class="lbl" style="margin:0">Students</div><div class="bignum">${campers.length}</div></div>
    ${al.primary!=='none'?`<span class="accbadge ${al.primary}">${ACC_LABEL[al.primary]||al.primary}</span>`:''}
    </div>
```

with:

```js
    <div class="rowsb snaphead"><div><div class="lbl" style="margin:0">Students</div><div class="bignum">${campers.length}</div></div>
    <div class="snapx"><button type="button" class="btn ghost sm" id="contactExportBtn" onclick="exportStudentContacts()">${icSm('download')} Export student contact</button></div>
    ${al.primary!=='none'?`<span class="accbadge ${al.primary}">${ACC_LABEL[al.primary]||al.primary}</span>`:'<span></span>'}
    </div>
```

(The empty `<span></span>` keeps the button centred when there is no badge — `.rowsb` is `justify-content:space-between`.)

- [ ] **Step 3: CSS**

Add immediately after the `.accbadge{…}` rule (~line 691):

```css
.snaphead .snapx{flex:1;display:flex;justify-content:center;}
@media(max-width:420px){.snaphead{flex-wrap:wrap;}.snaphead .snapx{order:3;flex-basis:100%;margin-top:4px;}}
```

- [ ] **Step 4: Cache bump**

`public/sw.js` line 1: `const CACHE = 'camp-v117';` → `const CACHE = 'camp-v118';`

- [ ] **Step 5: Verify**

```bash
S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1); E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1); sed -n "$((S+1)),$((E-1))p" public/index.html > "$TMPDIR/spa.js" && node --check "$TMPDIR/spa.js" && node --check public/sw.js && echo SPA-OK
node scripts/contact-export-harness.js
npm run typecheck
npx vitest run
```
Expected: `SPA-OK`; harness `ALL PASS`; typecheck clean; vitest all pass with the same count as before the change (~1101 / 64 files — SPA-only work, count must not move).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "My Youth: Export student contact button (xlsx, scoped, cancelled excluded)"
```

---

### Task 3: Browser verification (main session)

**Files:** none (fixes only if something fails, then re-run Task 2 Step 5 and make a NEW commit — never amend)

- [ ] **Step 1:** Start the app locally — use the `run` skill, or `npm run dev` and open the printed localhost URL; use the demo quick-login (localhost only, `_initDemoLogin`).
- [ ] **Step 2:** As a **church** login in pre-camp mode, open My Youth. At a 390px-wide viewport the button sits on its own centred row below the count/badge; at ≥430px it sits centred between them without overlapping either. Check both with and without an accommodation badge.
- [ ] **Step 3:** Tap the button. A `youth-camp-<year>-contacts-<date>.xlsx` downloads. Open it: sheet `Contacts`, no Church column, students then leaders, phones show `04xx xxx xxx` with the leading 0, leaders' Grade blank, no cancelled people. Button re-enables afterward.
- [ ] **Step 4:** As **director** (or admin): with "All churches" the file has a leading Church column sorted by church; pick one church in the dropdown and re-export — only that church. Change Gender/Grade/search — export is unaffected.
- [ ] **Step 5:** Record what was and wasn't checked on-device (real iPhone PWA download behaviour can't be proven locally — say so in the CLAUDE.md entry).

---

### Task 4: Docs

**Files:**
- Modify: `CLAUDE.md` — new section inserted after the warning block at the top (before `## Pre-camp student profile: mobile + parent phone — 2026-09-21`)
- Modify: `debug.md` — Pre-camp screens table (grep `| \`RENDER.people\` (My Youth)`)

- [ ] **Step 1: CLAUDE.md entry**

```markdown
## My Youth: "Export student contact" — 2026-09-22

Owner request. A button in the top-middle of the My Youth snapshot card (`buildPeopleSnap`,
between the Students count and the accommodation badge; wraps to its own centred row ≤420px)
downloads `youth-camp-<year>-contacts-<date>.xlsx`, one sheet `Contacts`. **SPA-only** — no
backend/DTO/schema change; `RegistrantDto` already carried every field and none is masked for
any role. `sw.js` → **`camp-v118`**.

- **Who:** `scopeRegs()` (login scope + director/admin Church dropdown; Gender/Grade/search
  ignored), **cancelled excluded**, **students AND leaders** despite the button label — owner's
  explicit choice, don't "fix" the label or drop leaders.
- **Columns:** `Type, First name, Last name, Grade (blank for leaders), Email, Phone` +
  a leading `Church` column when `_isWideRole()` (director/admin/zoneLeader).
- **Phone** goes through `fmtPhone` and is written as a TEXT cell so the leading 0 survives.
- `_contactExportRows` is pure and extracted **BY NAME** by `scripts/contact-export-harness.js`
  (also round-trips through vendored SheetJS to prove phones stay text). Never rename it without
  updating the harness. Run: `node scripts/contact-export-harness.js`.
- **Not verified on a real device:** iOS PWA download behaviour (same path as the accommodation
  export, `_rlSaveBlob`).
```

(Adjust the last bullet to whatever Task 3 actually did and didn't verify.)

- [ ] **Step 2: debug.md row** — add under the `RENDER.people` row in the Pre-camp screens table:

```markdown
| `_contactExportRows` / `exportStudentContacts` (My Youth "Export student contact", 2026-09-22) | grep the name — just above `RENDER.people`. Button `#contactExportBtn` in `buildPeopleSnap`. Wrong people/columns → `_contactExportRows` (+ `node scripts/contact-export-harness.js`); button missing/overlapping → `.snaphead`/`.snapx` CSS near `.accbadge`. |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md debug.md
git commit -m "Docs: My Youth contact export"
```

- [ ] **Step 4: Stop.** Report the commits to the owner. **Do not push** — pushing `master` deploys to production; the owner decides.
