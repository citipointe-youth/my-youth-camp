# Budget & Data screen fix batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five owner-reported defects on the Budget & Costings and Data screens — a clipped collapsible card, sponsorship money invisible because its codes are unclassified, a tooltip clipped inside a bottom sheet, two shortcut buttons that should be director-only, and a missing free-text search on the Data table.

**Architecture:** All five changes are **frontend-only**, confined to `public/index.html` (CSS + SPA JS) plus `sw.js` and two harness/doc files. **No database migration, no schema change, no `src/**` change, no API change.** The live database is therefore untouched by this batch and cannot be corrupted by it — the next migration number stays `0023`.

**Tech Stack:** Vanilla SPA in a single `public/index.html` (no build step), Node harness scripts under `scripts/` that `vm`-extract real functions from the SPA, vitest for `src/`, Vercel auto-deploy on push to `master`.

**Spec:** None — the owner elected to skip the design doc (2026-09-06). The authoritative background is `CLAUDE.md` §"Budget export traceability" (2026-09-06) and `debug.md` §"Symptom router → 2026-09-06". Root-cause analysis for each item is recorded in the task's own preamble below.

## Global Constraints

- **`public/index.html` changing means `sw.js`'s `CACHE` MUST step.** Prod currently serves **`camp-v109`** (verified 2026-09-06 by `curl -s https://my-youth-camp.vercel.app/sw.js | head -1`). `v109` **is deployed** — CLAUDE.md's claim that it never was is stale and Task 6 corrects it. This batch therefore ships **`camp-v110`**. One step for the whole batch, not one per commit.
- **No migration.** Next migration number remains `0023`. Do not create one.
- **Do not start a dev server or drive a browser.** Verify with `npm run typecheck`, `npx vitest run`, `node --check` on the SPA body, and the harness scripts. CSS/layout is eyeballed on-device by the owner — say so, don't claim visual proof.
- **`node --check` on the SPA body:** the script body range is re-derived each time, do not trust a remembered range. See Task 6 for the command.
- **Every button placed inside a `.rowsb` must be `.btn … sm` with `flex:0 0 auto`** (CLAUDE.md, `camp-v107`). A bare `.btn` is `display:block;width:100%` and eats the flex row.
- **REPORT, NEVER INFER** (CLAUDE.md, 2026-09-06). Nothing in this batch may map a discount percentage onto a tag. Task 2 surfaces unclassified codes; it must not classify them.
- Line numbers in this plan are from the 2026-09-06 working tree and **drift on every SPA edit**. Grep the named symbol before editing; the symbol names are the stable contract.

---

## Task 1: Budget collapsible cards can no longer clip their content

**Owner report:** *"Budget and costings screen, when dropping down discount codes, only part of the list can be scrolled down to."*

**Root cause (verified 2026-09-06):** it is not the `<select>`. Each per-code dropdown has only 4 options (`_BUD_TAGS`, `public/index.html:4128`). The container is the problem:

```css
.budchurch-body{max-height:0;overflow:hidden;transition:max-height .26s ease;}
.budchurch.open .budchurch-body{max-height:1200px;}
```

This is a max-height accordion with **permanent `overflow:hidden` and no `overflow-y`**. Opening only raises the cap to a hardcoded **1200px**. Each `discRow` is ~60–100px (code chip, ×N chip, purpose pill, a full-width `<select>` on its own line, sometimes a `warnbox`); prod has **19 codes**, so the card renders well past 1200px and everything below the cap is clipped with **no scrollbar able to reach it**.

The same rule governs four other cards that have simply not outgrown 1200px yet: Sponsorship (`~4979`), ticket-prices gate (`~5031`), upgrade tracking (`~5045`), and every per-church card (`~4890`). Owner decision (2026-09-06): fix all five.

**Accepted trade-off, stated plainly:** removing the cap removes the open/close *animation*, because `max-height:none` is not an animatable value. The cards will snap open and closed instead of sliding. This is deliberate — a card that hides data is a correctness bug, a card that does not slide is a cosmetic one. The rejected alternative was raising the cap to a bigger number (e.g. `20000px`), which keeps a janky, badly-timed animation and leaves the identical bug in place at a larger N. `overflow:visible` when open is part of the fix, not incidental: it also un-clips any `.htip-pop` tooltip inside a budget card, which is the same defect Task 5 fixes for bottom sheets.

**Files:**
- Modify: `public/index.html:259-261` (the `.budchurch-body` CSS block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on. `.budchurch.open` remains the open-state class; `_budToggle(cid)` and `_budRedraw()` are untouched.

- [ ] **Step 1: Locate the rule**

Run:
```bash
grep -n "budchurch-body" public/index.html
```
Expected: a hit on the `.budchurch-body{max-height:0…}` declaration and one on `.budchurch.open .budchurch-body{max-height:1200px;}`, plus template usages of `class="budchurch-body"` further down the file. Only the two CSS lines are edited.

- [ ] **Step 2: Replace the open-state rule**

Find exactly:
```css
/* Budget collapsible church rows (H/§5, L3 expander) */
.budchurch-body{max-height:0;overflow:hidden;transition:max-height .26s ease;}
.budchurch.open .budchurch-body{max-height:1200px;}
```

Replace with exactly:
```css
/* Budget collapsible church rows (H/§5, L3 expander).
   ⚠️ THE OPEN STATE MUST NOT CARRY A FIXED max-height (2026-09-06). It used to be 1200px, which
   silently CLIPPED the Discount codes card once prod passed ~15 codes — `overflow:hidden` with no
   `overflow-y` means the hidden rows were not scrollable to, merely gone. Every `.budchurch` card
   grows with the data (codes, churches, sponsorship rows), so any finite cap is the same bug
   waiting on a bigger camp. `max-height:none` is not animatable, so the open/close slide is gone
   on purpose — hiding data is a correctness bug, not sliding is a cosmetic one. `overflow:visible`
   is also load-bearing: it un-clips `.htip-pop` tooltips rendered inside an open card. */
.budchurch-body{max-height:0;overflow:hidden;transition:max-height .26s ease;}
.budchurch.open .budchurch-body{max-height:none;overflow:visible;}
```

- [ ] **Step 3: Verify no other rule re-clips the card**

Run:
```bash
grep -n "budchurch" public/index.html | grep -i "overflow\|max-height"
```
Expected: only the two lines just written. If any other selector sets `overflow:hidden` on `.budchurch` or an ancestor of `.budchurch-body`, it must be reported before continuing — do not silently add a second override.

- [ ] **Step 4: Confirm the SPA still parses**

Run:
```bash
npm run typecheck
```
Expected: clean (this is a CSS-only change; typecheck covers `src/` and must stay green regardless).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "fix(budget): collapsible cards no longer clip content at 1200px

The .budchurch.open max-height:1200px cap silently hid Discount-code rows
past ~15 codes; overflow:hidden with no overflow-y made them unreachable
rather than scrollable. Removes the cap for all five card types. The
open/close animation is deliberately traded away - max-height:none is not
animatable."
```

---

## Task 2: Unclassified discount codes are visible on the Budget screen, not only in the export

**Owner report:** *"budget and costings screen, why are some codes like 'YC26BNESPONSOR' considered 'unclassified'? In the app this one for example is classified as 'full sponsor'."*

**Root cause (verified 2026-09-06 against prod):** the classifier is correct and `YC26BNESPONSOR` **is** tagged. Prod `settings.discount_code_tags` reads `{KH100:sponsor, YC26YP:discount, YC26EFT:inperson, YC26CASH:inperson, VICTORY50:discount, YC26BNESPONSOR:sponsor}`, and the 33 people carrying that code store it as exactly `YC26BNESPONSOR` (length 14, no whitespace, no case variance), so `discountTagFor`'s exact match resolves it. CLAUDE.md's "5 of 19 codes tagged" is stale; it is 6.

The real defect is a **missing surface**. `computeSponsorSummaryClient` computes `unclassified`, `unclassifiedCount` and `unclassifiedTotal` (`public/index.html:4676-4683`) — and those three fields are rendered **only in the XLSX export** (`:5290-5301`). `sponSection`, the on-screen Sponsorship card (`:4979-5000`), never renders them. So money deliberately excluded from every total is invisible in the app and only appears in a file you have to download and open, which is exactly how a stale export reads as a live contradiction.

**This task adds a report, never an inference.** It must not classify anything, must not move any total, and must not map a discount percentage onto a tag.

**Files:**
- Modify: `public/index.html` — `drawBudget`'s `sponSection` template (grep `const sponSection=`), ~`:4978-5000`

**Interfaces:**
- Consumes: `computeSponsorSummaryClient(regs, scope)`'s existing return shape — `{count, total, fullTotal, partialTotal, unpricedCount, withdrawnCount, withdrawnTotal, unclassifiedCount, unclassifiedTotal, unclassified, codes, churches}`, built at `public/index.html:4680-4683`. Each entry of `unclassified` is `{code: string, count: number, total: number, avgPercent: number|null}`.
- Produces: nothing later tasks rely on. No new function is introduced; no existing signature changes.

- [ ] **Step 1: Confirm the fields exist and are unrendered on screen**

Run:
```bash
grep -n "unclassifiedCount\|unclassifiedTotal\|spon.unclassified" public/index.html
```
Expected, before the change: hits at ~`4681-4683` (computed in `computeSponsorSummaryClient`) and ~`5290-5301` (written to the export Summary sheet) — and **no hit inside `sponSection`**. That absence is the bug. If a hit already exists inside `sponSection`, stop: the premise of this task is wrong and it must be re-investigated rather than patched.

- [ ] **Step 2: Widen the card's render gate**

The card is currently suppressed entirely when there are no *tagged* sponsor codes, which would also suppress the new block in the exact case it matters most — a camp where every discounted code is untagged.

Find exactly:
```js
  const sponSection=spon.count?`<div class="card budchurch" data-cid="sponsor" style="margin-top:14px">
```

Replace with exactly:
```js
  /* ⚠️ GATED ON unclassifiedCount TOO (2026-09-06). Gating on `spon.count` alone hid this whole
     card when every discounted code was untagged — precisely the camp that most needs to be told
     its sponsorship ask is missing. */
  const sponSection=(spon.count||spon.unclassifiedCount)?`<div class="card budchurch" data-cid="sponsor" style="margin-top:14px">
```

- [ ] **Step 3: Render the unclassified block inside the card body**

Find exactly (the existing unpriced warnbox, the last line before the `.seg` view switcher):
```js
      ${spon.unpricedCount?`<div class="warnbox" style="margin:0 0 8px">${icSm('alert')} ${spon.unpricedCount} ${spon.unpricedCount===1?'place is':'places are'} on a ticket with no known price, so the total above under-reads.</div>`:''}
```

Insert immediately AFTER it:
```js
      ${spon.unclassifiedCount?`<div class="warnbox" style="margin:0 0 8px">${icSm('alert')}
        <b>${spon.unclassifiedCount} ${spon.unclassifiedCount===1?'place is':'places are'} on a discount code nobody has classified yet.</b>
        <span style="display:block;margin-top:2px">${_money(spon.unclassifiedTotal)} is <b>NOT</b> included in the total above. Classify each code in the <b>Discount codes</b> card so its money is counted — the app will not guess, because a 100%-off code can be a staff comp as easily as a sponsorship.</span>
        ${spon.unclassified.map(u=>`<div class="buddet"><span class="buddet-k">${esc(u.code)}${u.avgPercent==null?'':` <span class="sub">${Math.round(u.avgPercent)}% off on invoices</span>`}</span><span class="buddet-n">× ${u.count}</span><b class="buddet-v">${_money(u.total)}</b></div>`).join('')}
        <div class="buddet" style="font-weight:700"><span class="buddet-k">Total not counted</span><span class="buddet-n">× ${spon.unclassifiedCount}</span><b class="buddet-v">${_money(spon.unclassifiedTotal)}</b></div></div>`:''}
```

Notes for the implementer, none of them optional:
- `_money` and `icSm` are existing SPA helpers already used two lines above; do not import or redefine them.
- `esc(u.code)` is required — the code is operator-entered data reaching innerHTML.
- `Math.round(u.avgPercent)` matches the export's formatting exactly (`public/index.html:5298`). Keep them identical; two different roundings of the same number on screen and in the workbook is its own bug report.
- `.buddet` / `.buddet-k` / `.buddet-n` / `.buddet-v` are the existing detail-row classes used by `sponBandLine`; reuse them rather than inventing a layout.

- [ ] **Step 4: Verify the SPA body still parses**

Re-derive the script body range and check it (do not trust a remembered range):
```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8');const a=s.split('\n');let st=0,en=0;a.forEach((l,i)=>{if(/^\s*<script>\s*$/.test(l)&&!st)st=i+2;if(/^\s*<\/script>\s*$/.test(l)&&st&&!en)en=i;});console.log(st,en);require('fs').writeFileSync(process.env.TEMP+'/spa-body.js',a.slice(st-1,en).join('\n'));"
node --check "$TEMP/spa-body.js"
```
Expected: prints the range, then `node --check` exits 0 with no output.

- [ ] **Step 5: Verify the export path is untouched**

Run:
```bash
node scripts/budget-xlsx-harness.js
```
Expected: `142 ok` (the count recorded in CLAUDE.md for `camp-v109`), 0 failures. This task changes only on-screen rendering; any movement in this number means the export was touched by accident.

- [ ] **Step 6: Verify no total moved**

Run:
```bash
npx vitest run
```
Expected: **1065 pass / 64 files**, matching CLAUDE.md's recorded baseline for this branch point. `computeSponsorSummary` in `src/services/budget.ts` is untouched, so any change here is a regression, not an improvement.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat(budget): show unclassified discount codes on screen, not only in the export

unclassifiedCount/Total/rows were computed by computeSponsorSummaryClient
and rendered ONLY on the export Summary sheet, so money deliberately
excluded from every total was invisible in the app. Adds a warnbox to the
Sponsorship card listing each untagged code, its people and its uncounted
gap, and widens the card's gate so it still renders when every code is
untagged. Reports only - no figure moves, nothing is inferred from a
discount percentage."
```

---

## Task 3: The Data screen shortcut buttons become director-only

**Owner report:** *"data screen, get rid of the 'data import' and 'records/export' shortcut buttons at the top."* **Owner decision on follow-up:** *"Keep it for the director login, remove for the admin login."*

**Why this is not a plain deletion:** the comment above these buttons (`public/index.html:8888-8892`) records that they were added as a regression fix — director holds `import:run` and `allocation:manage`, and `RENDER.import` / `RENDER.adminData` both accept director, but `navModel` gives director **no `import` tab and no Records & Export extra in either mode**. These two buttons are director's only reachable route to those screens. Admin reaches both from the Admin console, so for admin they are pure duplication.

**Files:**
- Modify: `public/index.html:8888-8896` (the `navCard` definition inside `RENDER.data`)

**Interfaces:**
- Consumes: `ACTOR` (module-level, `public/index.html:1143`), whose `.role` is one of `church|zoneLeader|director|admin|firstAid`. The same `ACTOR.role==='admin'||ACTOR.role==='director'` idiom is already used for `_canBudget` at `public/index.html:4902`.
- Produces: nothing later tasks rely on. `navCard` stays a string interpolated into `paint('data', …)`; when empty it contributes nothing to the DOM.

- [ ] **Step 1: Replace the definition and its comment**

Find exactly:
```js
  // BUG regression fix: director has import:run + allocation:manage (access-control.ts) and
  // RENDER.import/RENDER.adminData both already accept director — they were just unreachable
  // (navModel gives director no 'import' tab and no Records & Export extra in either mode).
  // These two buttons are the reachable entry point in both pre-camp and at-camp (the at-camp
  // home "Student Data Table" tile already routes here via go('data')).
  const navCard=`<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn ghost" style="flex:1;min-width:160px" onclick="go('import')">${icSm('upload')} Data Import</button>
    <button class="btn ghost" style="flex:1;min-width:160px" onclick="go('adminData')">${icSm('download')} Records &amp; Export</button>
  </div>`;
```

Replace with exactly:
```js
  /* ⚠️ DIRECTOR ONLY — DO NOT DELETE THIS OUTRIGHT (owner, 2026-09-06).
     BUG regression fix: director has import:run + allocation:manage (access-control.ts) and
     RENDER.import/RENDER.adminData both already accept director — they were just unreachable
     (navModel gives director no 'import' tab and no Records & Export extra in either mode).
     These two buttons are director's ONLY reachable entry point to those screens, in both
     pre-camp and at-camp. Admin reaches both from the Admin console, so for admin they are
     duplication and the owner asked for them gone — hence the role gate rather than a delete.
     If you ever need to remove them for director too, give director a nav route FIRST. */
  const navCard=(ACTOR&&ACTOR.role==='director')?`<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn ghost" style="flex:1;min-width:160px" onclick="go('import')">${icSm('upload')} Data Import</button>
    <button class="btn ghost" style="flex:1;min-width:160px" onclick="go('adminData')">${icSm('download')} Records &amp; Export</button>
  </div>`:'';
```

- [ ] **Step 2: Confirm the interpolation site still consumes `navCard`**

Run:
```bash
grep -n "navCard" public/index.html
```
Expected: exactly two hits — the definition just edited, and `paint('data',\`${navCard}<div class="card">` a few lines below. No third site.

- [ ] **Step 3: Confirm director genuinely has no alternative route (guard against a silent lockout)**

Run:
```bash
grep -n "navModel" public/index.html | head -5
```
Then read `navModel`'s body and confirm the `director` branch still emits **no** `import` tab and **no** Records & Export extra. Expected: it does not — which is precisely why the director gate must stay. If `navModel` has since gained a director route to `import`, record that in the commit message; the gate is then belt-and-braces rather than load-bearing, but leave it in place regardless.

- [ ] **Step 4: Verify the SPA body still parses**

```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8');const a=s.split('\n');let st=0,en=0;a.forEach((l,i)=>{if(/^\s*<script>\s*$/.test(l)&&!st)st=i+2;if(/^\s*<\/script>\s*$/.test(l)&&st&&!en)en=i;});require('fs').writeFileSync(process.env.TEMP+'/spa-body.js',a.slice(st-1,en).join('\n'));"
node --check "$TEMP/spa-body.js"
```
Expected: exits 0, no output.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "fix(data): shortcut buttons are director-only

Admin reaches Data Import and Records & Export from the Admin console, so
the two shortcut buttons were duplication there. Director has neither in
navModel and these buttons are their only route, so the buttons are gated
on role rather than deleted."
```

---

## Task 4: Free-text search on the Data table

**Owner report:** *"data screen, beneath the dropdown filter buttons, add a search bar which can be used to filter the table (to filter by any matching field, name, medical, phone number)."*

**Owner decisions (2026-09-06):** the search **combines** with the four existing dropdowns (AND — it narrows the current filtered set), and filtering is **live per keystroke**, not on a search-icon click.

**Why live filtering is safe here:** `_dataCache` (set once per `RENDER.data()` call, `public/index.html:8882`) already holds the **entire** merged roster from `/registrants` + `/campers?pageSize=1000`. The table is client-side filtered and sorted with **no pagination and no re-fetch** — prod is ~600 people, so each keystroke is one in-memory `.filter()` over an array that is already in hand. A 120ms debounce keeps a fast typist from re-rendering the table on every character; it is a render optimisation, not a network one.

**Phone matching is digits-only on both sides** so a typed `0412345` matches a mobile displayed by `fmtPhone` as `0412 345 678`. A short digit run is not treated as a phone lookup (threshold 3) so typing `12` does not match every number containing `12`; it still matches textually through the general haystack.

**Files:**
- Modify: `public/index.html` — `RENDER.data`'s `paint()` markup (grep `id="dfReview"`), `dataFilters()` (grep `function dataFilters`), `dataApply()` (grep `function dataApply`), and a new helper block above `DATA_COLS` (grep `const DATA_COLS=`)
- Create: `scripts/data-search-harness.js`

**Interfaces:**
- Consumes: `_dataCache` — an array of merged registrant/camper rows carrying `id, kind('camper'|'leader'), firstName, lastName, churchId, churchName, gender, grade, registrationType, registrationCost, discountCode, mobile, medicalConditions[], dietaryRequirements[], otherMedications, blueCardNumber, accommodationKind, accommodationKindConfidence, needsReview, needsReviewReason, createdAt`.
- Produces, and later tasks / the harness depend on these exact names and signatures:
  - `_dataNorm(s: any) => string` — lowercased, trimmed, null-safe.
  - `_dataDigits(s: any) => string` — every non-digit stripped, null-safe.
  - `_dataMatchQuery(r: object, q: string) => boolean` — `true` for an empty/whitespace query.
  - `_dataQInput() => void` — debounced `oninput` handler.
  - `dataClearQ() => void` — clears `#dfQ`, refocuses it, re-applies.
  - `dataFilters()` gains a `q: string` property alongside `churchId`, `gender`, `grade`, `needsReview`.

- [ ] **Step 1: Write the failing harness**

Create `scripts/data-search-harness.js` with exactly this content:

```js
/*
 * Data-screen search harness (2026-09-06).
 *
 * The Data table's free-text search is browser-only code, so vitest cannot reach it. Its failure
 * modes are all SILENT: a query that matches nothing empties a 600-row table with no error, and a
 * phone search that compares formatted text against typed digits simply never matches. Runs the
 * REAL functions extracted from public/index.html.
 *
 *   node scripts/data-search-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* Matches on a NAME PREFIX, not a full signature — a parameter added to one of these must not
 * silently kill this script the way it killed budget-xlsx-harness.js for a month (CLAUDE.md,
 * 2026-09-06). A throw here means a genuine RENAME. */
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

const NEEDED = ['function _dataNorm(', 'function _dataDigits(', 'function _dataMatchQuery('];
const ctx = { console, JSON, Object, String, Math, Array, Number };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(NEEDED.map(extract).join('\n'), ctx);
for (const sym of ['_dataNorm', '_dataDigits', '_dataMatchQuery']) {
  if (typeof ctx[sym] !== 'function') throw new Error('sandbox guard: ' + sym + ' missing after extraction');
}

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}

const ROW = {
  kind: 'camper', firstName: 'Amelia', lastName: "O'Brien", churchName: 'Victory Brisbane',
  gender: 'female', grade: 9, registrationType: 'Early Bird Tent', registrationCost: 190,
  discountCode: 'YC26BNESPONSOR', mobile: '0412345678',
  medicalConditions: ['Asthma', 'Peanut allergy'], dietaryRequirements: ['Gluten free'],
  otherMedications: 'Ventolin', blueCardNumber: 'BC-99231',
  accommodationKind: 'tent', needsReview: true, needsReviewReason: 'Ticket List name did not match',
};

check('empty query matches everything', _dataMatchQuery(ROW, ''), true);
check('whitespace-only query matches everything', _dataMatchQuery(ROW, '   '), true);
check('first name, wrong case', _dataMatchQuery(ROW, 'aMeLiA'), true);
check('last name with an apostrophe', _dataMatchQuery(ROW, "o'brien"), true);
check('full name in natural order', _dataMatchQuery(ROW, 'amelia o'), true);
check('full name in table order', _dataMatchQuery(ROW, "o'brien, amelia"), true);
check('church name', _dataMatchQuery(ROW, 'victory'), true);
check('medical condition', _dataMatchQuery(ROW, 'asthma'), true);
check('second medical condition', _dataMatchQuery(ROW, 'peanut'), true);
check('dietary requirement', _dataMatchQuery(ROW, 'gluten'), true);
check('other medications', _dataMatchQuery(ROW, 'ventolin'), true);
check('discount code', _dataMatchQuery(ROW, 'bnesponsor'), true);
check('blue card', _dataMatchQuery(ROW, 'bc-99'), true);
check('needs-review reason', _dataMatchQuery(ROW, 'did not match'), true);
check('grade', _dataMatchQuery(ROW, '9'), true);
check('mobile typed as stored', _dataMatchQuery(ROW, '0412345678'), true);
check('mobile typed as DISPLAYED (spaces)', _dataMatchQuery(ROW, '0412 345 678'), true);
check('mobile partial run of digits', _dataMatchQuery(ROW, '412345'), true);
check('no match returns false', _dataMatchQuery(ROW, 'zzzznotpresent'), false);
check('a field from another row does not match', _dataMatchQuery(ROW, 'Elevation'), false);

/* ⚠️ Null-safety is the whole point of _dataNorm/_dataDigits: a leader row has no grade, an
 * unimported person has no mobile, and `undefined` reaching String() would read as "undefined"
 * and match a search for "define". */
const SPARSE = { kind: 'leader', firstName: 'Sam', lastName: 'Lee' };
check('sparse row: name still matches', _dataMatchQuery(SPARSE, 'lee'), true);
check('sparse row: no phantom "undefined" match', _dataMatchQuery(SPARSE, 'undefined'), false);
check('sparse row: no phantom "null" match', _dataMatchQuery(SPARSE, 'null'), false);
check('sparse row: unrelated query is false', _dataMatchQuery(SPARSE, 'asthma'), false);

check('_dataDigits strips formatting', _dataDigits('0412 345 678'), '0412345678');
check('_dataDigits on null', _dataDigits(null), '');
check('_dataNorm on undefined', _dataNorm(undefined), '');
check('_dataNorm trims and lowercases', _dataNorm('  Amelia  '), 'amelia');

console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to make sure it fails**

Run:
```bash
node scripts/data-search-harness.js
```
Expected: it **throws** `not found in index.html: function _dataNorm(` — the functions do not exist yet. That throw is the failing test.

- [ ] **Step 3: Add the three pure helpers**

Find exactly (the `DATA_COLS` declaration in `public/index.html`):
```js
const DATA_COLS=[['Name','name'],
```

Insert immediately BEFORE that line:
```js
/* ── Data-table free-text search (2026-09-06) ────────────────────────────────────────────────
   Kept as three SMALL PURE FUNCTIONS on purpose: `scripts/data-search-harness.js` vm-extracts
   them by name and runs them for real, which is the only test that can reach browser-only code.
   Adding a parameter is fine (the harness matches a name prefix); RENAMING one breaks it loudly,
   which is the intent.
   ⚠️ _dataNorm/_dataDigits must stay null-safe. A leader row has no grade and an un-imported
   person has no mobile — letting `undefined` reach String() would put the literal text
   "undefined" in the haystack, so a search for "define" would match half the camp. */
function _dataNorm(s){return String(s==null?'':s).toLowerCase().trim();}
function _dataDigits(s){return String(s==null?'':s).replace(/\D+/g,'');}
/* Digits-only phone comparison so a typed 0412345 matches a mobile the table renders through
   fmtPhone as "0412 345 678". Gated at 3+ digits so typing "12" doesn't drag in every number
   containing 12 — a short numeric query still matches textually via the haystack below. */
function _dataMatchQuery(r,q){
  const needle=_dataNorm(q);
  if(!needle)return true;
  const digits=_dataDigits(needle);
  if(digits.length>=3&&_dataDigits(r.mobile).indexOf(digits)>=0)return true;
  const hay=[r.firstName,r.lastName,(r.firstName||'')+' '+(r.lastName||''),
    (r.lastName||'')+', '+(r.firstName||''),r.churchName,r.gender,r.grade,r.registrationType,
    r.discountCode,r.mobile,r.otherMedications,r.blueCardNumber,r.needsReviewReason,
    r.accommodationKind,(r.medicalConditions||[]).join(' '),(r.dietaryRequirements||[]).join(' ')]
    .map(_dataNorm).join('   ');
  return hay.indexOf(needle)>=0;
}
/* Debounced so a fast typist doesn't rebuild a 600-row table on every keystroke. Purely a render
   optimisation — the data is already in _dataCache, nothing is re-fetched. */
let _dataQT=null;
function _dataQInput(){clearTimeout(_dataQT);_dataQT=setTimeout(dataApply,120);}
function dataClearQ(){const el=document.getElementById('dfQ');if(el){el.value='';el.focus();}dataApply();}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run:
```bash
node scripts/data-search-harness.js
```
Expected: every line prints `ok`, final line `all ok`, exit 0. **24 checks.** If `sparse row: no phantom "undefined" match` fails, `_dataNorm`'s null guard was dropped.

- [ ] **Step 5: Wire the query into `dataFilters()`**

Find exactly:
```js
function dataFilters(){
  return {
    churchId:document.getElementById('dfCh')?.value||'',
    gender:document.getElementById('dfGen')?.value||'',
    grade:document.getElementById('dfGr')?.value||'',
    needsReview:document.getElementById('dfReview')?.value||'',
  };
}
```

Replace with exactly:
```js
function dataFilters(){
  return {
    churchId:document.getElementById('dfCh')?.value||'',
    gender:document.getElementById('dfGen')?.value||'',
    grade:document.getElementById('dfGr')?.value||'',
    needsReview:document.getElementById('dfReview')?.value||'',
    q:document.getElementById('dfQ')?.value||'',
  };
}
```

- [ ] **Step 6: AND the query into `dataApply()`'s predicate**

Find exactly:
```js
    if(f.needsReview==='1'&&!r.needsReview)return false;
    return true;
  });
```

Replace with exactly:
```js
    if(f.needsReview==='1'&&!r.needsReview)return false;
    // Search NARROWS the dropdown selection (owner, 2026-09-06) — it never widens it, so it is
    // the last predicate rather than a separate mode.
    if(!_dataMatchQuery(r,f.q))return false;
    return true;
  });
```

- [ ] **Step 7: Add the search input beneath the dropdown filter row**

Find exactly (the closing `</div>` of the four-select filter row, immediately before the export buttons):
```js
      <select class="fld" id="dfReview" style="flex:1;min-width:140px" onchange="dataApply()">
        <option value="">All records</option><option value="1">Needs review only</option></select>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
```

Replace with exactly:
```js
      <select class="fld" id="dfReview" style="flex:1;min-width:140px" onchange="dataApply()">
        <option value="">All records</option><option value="1">Needs review only</option></select>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input class="fld" id="dfQ" type="search" inputmode="search" autocomplete="off" spellcheck="false"
        placeholder="Search name, mobile, medical, dietary, code…" aria-label="Search the registration table"
        style="flex:1;min-width:0" oninput="_dataQInput()">
      <button class="btn ghost sm" style="flex:0 0 auto" onclick="dataClearQ()">Clear</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
```

- [ ] **Step 8: Confirm the export buttons still respect the filter**

Run:
```bash
grep -n "function dataExport" public/index.html
```
Read the function. "Export filtered" must build its rows from the same `dataFilters()`/predicate path as `dataApply()`. If it re-implements the predicate inline rather than calling shared code, **the search must be added there too** — otherwise "Export filtered" would silently ignore the search box and hand the owner a wider file than the screen shows. Record which case applies in the commit message.

- [ ] **Step 9: Verify the SPA body still parses**

```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8');const a=s.split('\n');let st=0,en=0;a.forEach((l,i)=>{if(/^\s*<script>\s*$/.test(l)&&!st)st=i+2;if(/^\s*<\/script>\s*$/.test(l)&&st&&!en)en=i;});require('fs').writeFileSync(process.env.TEMP+'/spa-body.js',a.slice(st-1,en).join('\n'));"
node --check "$TEMP/spa-body.js"
node scripts/data-search-harness.js
node scripts/filter-persist-harness.js
```
Expected: `node --check` silent, search harness `all ok`, filter-persist harness clean.

- [ ] **Step 10: Commit**

```bash
git add public/index.html scripts/data-search-harness.js
git commit -m "feat(data): free-text search over the registration table

Adds a debounced search box beneath the dropdown filters that ANDs with
them, matching name, church, gender, grade, reg type, discount code,
mobile, medical, dietary, other medications, blue card and review reason.
Phone matching compares digits only, so a typed 0412345 hits a mobile
displayed as 0412 345 678. _dataCache already holds the whole roster
client-side, so no fetch is added. New scripts/data-search-harness.js
runs the real extracted functions - 24 checks."
```

---

## Task 5: Tooltips stop being clipped inside a bottom sheet

**Owner report:** *"on phone, data screen, after clicking 'needs review' button and having the submenu pop up at the bottom, clicking the tooltip question mark has the text box truncated at the top of the submenu pop up at the bottom."*

**Root cause (verified 2026-09-06):**
- `openReviewModal` (`public/index.html:8988`) puts a `helpTip(...)` in the sheet's `<h3>` — the very first content in the sheet.
- `.htip-pop` is `position:absolute` inside `.htip` (`position:relative`, `:701`), so it is laid out **inside** `.sheet`, which is `overflow-y:auto` (`:642`) — a clipping container.
- `_clampTip` (`:1503`) measures against `.screen`, `document.documentElement.clientHeight` and the fixed `.tabs` bar. **It has no knowledge of `.sheet` at all.**
- A bottom sheet is by definition low on the screen, so the popup's default downward position frequently overflows `vh` and `_clampTip` adds `flip-up` (`:1529`). `flip-up` positions the bubble **above** the `?` — above the sheet's own content top edge — where `.sheet`'s `overflow-y:auto` clips it. The bubble is truncated even though `_clampTip`'s own arithmetic says it fits the viewport.

**The fix is app-wide, by owner decision (2026-09-06), and that is the correct scope:** every `helpTip` inside every `.sheet` has this latent bug, not just the Needs-review one. Downward remains safe inside a sheet because `.sheet` **scrolls** — an overflowing bubble extends the scroll height and is reachable. Upward is not, because it leaves the box entirely.

**Files:**
- Modify: `public/index.html` — `_clampTip` (grep `function _clampTip`), ~`:1503-1531`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on. `_clampTip(btn)` keeps its signature and both call sites (the tap handler `_toggleTip` and the delegated `mouseover` listener) are unchanged.

- [ ] **Step 1: Replace the vertical flip decision**

Find exactly:
```js
  // Vertical: the bubble sits below the "?"; if that runs off the bottom (short laptop
  // viewport, tip low on the page) and there's more room above, flip it up.
  if(r.bottom>vh-m){const btnTop=btn.getBoundingClientRect().top;if(btnTop>r.height+m)pop.classList.add('flip-up');}
}
```

Replace with exactly:
```js
  /* Vertical: the bubble sits below the "?"; if that runs off the bottom (short laptop
     viewport, tip low on the page) and there's more room above, flip it up.

     ⚠️ A BOTTOM SHEET IS A CLIPPING BOX AND flip-up ESCAPES IT (2026-09-06). `.sheet` is
     `overflow-y:auto`, and `.htip-pop` is position:absolute INSIDE it, so a flipped-up bubble
     renders above the sheet's own content top edge and is truncated there — even though the
     arithmetic above correctly says it fits the viewport. A sheet is by definition low on the
     screen, so this fired on essentially every tip in every sheet; it was reported against the
     Data screen's "Needs review" sheet, whose helpTip sits in the <h3>, i.e. at the very top of
     the sheet where there is NO room above it at all.
     Downward inside a sheet is safe and deliberately left alone: the sheet SCROLLS, so an
     overflowing bubble lengthens the scroll box and stays reachable. Upward does not — it leaves
     the box. So inside a sheet, flip up only when the bubble genuinely fits above the "?" WITHIN
     the sheet's own rect. Outside a sheet (`sheetTop` stays -Infinity) the behaviour is byte-for-
     byte what it was. */
  const sheet=btn.closest('.sheet');
  const sheetTop=sheet?sheet.getBoundingClientRect().top:-Infinity;
  if(r.bottom>vh-m){
    const btnTop=btn.getBoundingClientRect().top;
    if(btnTop>r.height+m&&btnTop-sheetTop>r.height+m)pop.classList.add('flip-up');
  }
}
```

Why `-Infinity` and not `0`: `btnTop - (-Infinity)` is `Infinity`, which is `> r.height+m` for any finite bubble, so the added clause is a no-op outside a sheet. Using `0` would instead compare against the viewport top and change behaviour on ordinary screens — a silent regression in the exact code path this task must not disturb.

- [ ] **Step 2: Confirm `.sheet` is the only clipping ancestor in play**

Run:
```bash
grep -n "overflow-y:auto\|overflow:auto\|overflow:hidden" public/index.html | grep -n "sheet\|modal\|screen"
```
Expected: `.sheet` carries `overflow-y:auto` (`:642`) and `#stage .screen` carries its own overflow on the ≥980px layout (already handled by the existing horizontal clamp). `.modal` itself is `position:fixed;inset:0` with no overflow rule, so it does not clip. If a second scrolling ancestor is found wrapping tooltips, report it rather than stacking another special case.

- [ ] **Step 3: Verify the SPA body still parses**

```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8');const a=s.split('\n');let st=0,en=0;a.forEach((l,i)=>{if(/^\s*<script>\s*$/.test(l)&&!st)st=i+2;if(/^\s*<\/script>\s*$/.test(l)&&st&&!en)en=i;});require('fs').writeFileSync(process.env.TEMP+'/spa-body.js',a.slice(st-1,en).join('\n'));"
node --check "$TEMP/spa-body.js"
```
Expected: exits 0, no output.

- [ ] **Step 4: Confirm the non-sheet behaviour is untouched by inspection**

Re-read the replaced block. The added condition is `&& btnTop-sheetTop>r.height+m`. With no `.sheet` ancestor this is `Infinity > finite` — always true — so the branch reduces exactly to the original `if(btnTop>r.height+m)`. State this in the commit message; there is no automated test for tooltip geometry in this repo and the owner verifies visually.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "fix(ui): help tooltips no longer flip up out of a bottom sheet

.htip-pop is position:absolute inside .sheet, which is overflow-y:auto, so
_clampTip's flip-up put the bubble above the sheet's content top edge where
it was clipped - reported on the Data screen's Needs-review sheet, whose
helpTip sits in the h3 with no room above it at all. _clampTip now also
measures the .sheet rect and only flips up when the bubble fits above the
? within the sheet. Outside a sheet the branch reduces to the original
condition exactly (sheetTop = -Infinity). App-wide by owner decision -
every helpTip in every sheet had this latent."
```

---

## Task 6: Cache bump and documentation

**Files:**
- Modify: `sw.js` (grep `const CACHE`)
- Modify: `CLAUDE.md`
- Modify: `debug.md`

**Interfaces:**
- Consumes: the five completed tasks above.
- Produces: nothing. Terminal task.

- [ ] **Step 1: Confirm what prod is actually serving before choosing the version**

Run:
```bash
curl -s https://my-youth-camp.vercel.app/sw.js | head -1
```
Expected: `const CACHE = 'camp-v109';`. This is the check that decides the next number — the rule is **one step per DEPLOYED version**, not per commit. If prod shows something other than `v109`, step from what prod shows, not from what this plan predicted.

- [ ] **Step 2: Bump the cache**

In `sw.js`, change `const CACHE = 'camp-v109';` to `const CACHE = 'camp-v110';`.

- [ ] **Step 3: Correct the two stale claims in CLAUDE.md**

Both were verified false on 2026-09-06 and will mislead the next reader:
1. The `camp-v109` section states *"`v109` has never been deployed"*. It **is** deployed — `curl` confirms prod serves it. Amend that sentence to record the deployment and the date.
2. The same section states *"Only **5 of 19** discount codes in prod use are classified"* and lists `YC26BNESPONSOR` in the untagged table with a $5,700 gap. Prod `settings.discount_code_tags` now reads **6** entries including `YC26BNESPONSOR: sponsor`. Amend to say the measurement was taken on 2026-09-05, that `YC26BNESPONSOR` was classified as `sponsor` on or before 2026-09-06, and that the remaining 13 codes are still untagged.

- [ ] **Step 4: Add the batch section to CLAUDE.md**

Add a new dated section at the top covering: no migration (next is still `0023`), `camp-v109`→`camp-v110`, and one paragraph per task. It must record, in plain terms:
- the `.budchurch` 1200px cap and that the open/close animation was **deliberately traded away** (Task 1);
- that `unclassifiedCount`/`unclassifiedTotal`/`unclassified` were computed since 2026-09-06 but rendered **only** in the export, and that the on-screen block reports without inferring (Task 2);
- that the Data shortcut buttons are director-only because `navModel` gives director no route, and **must not** be deleted outright without giving director a nav route first (Task 3);
- that `_dataNorm`/`_dataDigits`/`_dataMatchQuery` are extracted by name by `scripts/data-search-harness.js` — **add parameters freely, never rename** (Task 4);
- that `.htip-pop` is clipped by `.sheet`'s `overflow-y:auto` and why `sheetTop` defaults to `-Infinity` rather than `0` (Task 5).

- [ ] **Step 5: Add symptom-router rows to debug.md**

Add a `### 2026-09-06 (2nd) — budget card clipping, data search, sheet tooltips` block to the symptom router with one row per symptom:

| Symptom | Go to |
|---|---|
| A budget card shows fewer rows than its header count says | `.budchurch.open .budchurch-body` regained a finite `max-height`. It was `1200px` until 2026-09-06 and silently clipped the Discount codes card past ~15 codes. `overflow:hidden` with no `overflow-y` means the rows are gone, not scrollable to. |
| A budget card slides open again / someone "restored the animation" | Check they did not reintroduce a fixed `max-height` to do it. The animation was traded away on purpose; a finite cap is the bug. |
| A sponsored code's money is missing from the Sponsorship total | Read the unclassified warnbox now rendered inside that same card. Untagged codes with invoice evidence of a discount are reported there and excluded from every total by design — classify the code in the Discount codes card. `report, never infer` (CLAUDE.md 2026-09-06). |
| The Sponsorship card does not render at all | Its gate is `spon.count||spon.unclassifiedCount` since 2026-09-06. If it vanished when every code was untagged, the gate reverted to `spon.count` alone. |
| Director cannot reach Data Import or Records & Export | The two shortcut buttons in `RENDER.data` are their only route (`navModel` gives director neither). They are gated on `ACTOR.role==='director'` since 2026-09-06 — check the gate was not narrowed further. |
| The Data search box matches nothing / matches everything | `_dataMatchQuery`. Run `node scripts/data-search-harness.js` first — 24 checks. A throw there means one of the three functions was RENAMED, not that the search is broken. |
| "Export filtered" hands back more rows than the screen shows | `dataExport` is not going through the same predicate as `dataApply`. See Task 4 Step 8. |
| A help tooltip is cut off at the top of a bottom sheet | `_clampTip`'s `flip-up` escaping `.sheet`'s `overflow-y:auto`. Fixed 2026-09-06 by measuring the `.sheet` rect; if it is back, check `sheetTop` still defaults to `-Infinity` (using `0` silently changes non-sheet behaviour). |

- [ ] **Step 6: Full verification sweep**

Run all of these and record the actual numbers:
```bash
npm run typecheck
npx vitest run
node scripts/budget-xlsx-harness.js
node scripts/accom-export-harness.js
node scripts/filter-persist-harness.js
node scripts/data-search-harness.js
node -e "const s=require('fs').readFileSync('public/index.html','utf8');const a=s.split('\n');let st=0,en=0;a.forEach((l,i)=>{if(/^\s*<script>\s*$/.test(l)&&!st)st=i+2;if(/^\s*<\/script>\s*$/.test(l)&&st&&!en)en=i;});console.log('spa body',st,en);require('fs').writeFileSync(process.env.TEMP+'/spa-body.js',a.slice(st-1,en).join('\n'));"
node --check "$TEMP/spa-body.js"
node --check sw.js
```
Expected: typecheck clean; vitest **1065 pass / 64 files**; budget harness **142 ok**; accom + filter-persist harnesses clean; data-search harness **all ok**; both `node --check` silent.

**Report the real numbers.** If vitest or the budget harness moved, say so and explain why — this batch touches no `src/**` file and no export code, so movement in either is a regression to investigate, not a new baseline to accept.

- [ ] **Step 7: Commit**

```bash
git add sw.js CLAUDE.md debug.md
git commit -m "docs: budget/data fix batch; sw camp-v110

Also corrects two stale claims in CLAUDE.md's camp-v109 section: v109 IS
deployed (prod serves it), and 6 of 19 discount codes are now tagged, not
5 - YC26BNESPONSOR was classified as sponsor."
```

- [ ] **Step 8: Hand back to the owner for device verification**

Do **not** claim visual verification. Report what was actually run, and list what needs eyeballing on a phone:
1. Budget → Discount codes: all 19 codes reachable, nothing clipped.
2. Budget → Sponsorship: the unclassified warnbox appears with the remaining untagged codes and their uncounted total.
3. Data (admin login): the two top shortcut buttons are **gone**.
4. Data (director login): the two top shortcut buttons are **still there** and both navigate.
5. Data: type into the search box — the table narrows live, combines with the dropdowns, and `0412 345 678` and `0412345678` both find the same person.
6. Data → a "Needs review" pill → the `?` in the sheet heading: the tooltip is fully visible, not cut off at the top of the sheet.

---

## Self-Review

**Spec coverage** — five owner-reported items, five implementing tasks, plus a terminal docs/cache task:

| Owner item | Task |
|---|---|
| Discount-code list only partly scrollable | Task 1 |
| `YC26BNESPONSOR` reads "unclassified" | Task 2 |
| Tooltip truncated in the Needs-review sheet on phone | Task 5 |
| Remove the Data screen shortcut buttons | Task 3 (director-only, per owner) |
| Search bar beneath the dropdown filters | Task 4 |
| — | Task 6 (cache bump + docs, required by the global constraints) |

**Placeholder scan:** no TBD/TODO, no "add appropriate error handling", no "similar to Task N". Every code step carries the literal text to find and the literal text to write.

**Type consistency:** `_dataNorm`, `_dataDigits`, `_dataMatchQuery`, `_dataQInput`, `dataClearQ` and the `#dfQ` element id are used identically in Task 4's helper block, `dataFilters()`, `dataApply()`, the markup, the harness's `NEEDED`/sandbox-guard arrays, and Task 6's debug.md row. `spon.unclassified{,Count,Total}` in Task 2 match the shape built at `public/index.html:4680-4683`. `.budchurch.open` in Task 1 matches the class `_budToggle`/`_budRedraw` already toggle.

**Open item carried into execution:** Task 4 Step 8 is a genuine branch — whether `dataExport` shares `dataApply`'s predicate is unknown until read. If it does not, the search must be added there too, or "Export filtered" silently disagrees with the screen.
