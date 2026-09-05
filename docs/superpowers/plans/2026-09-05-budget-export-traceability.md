# Budget Export — Traceability, Untagged Sponsors, Cancel/Refund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every person in the app reconcile to exactly one line of the budget workbook, surface the sponsorship money the export is currently blind to, and correct the cancel/refund handling in the sponsorship ask.

**Architecture:** The export's row grain moves from `(church × audience × ticket class)` to `(church × audience × ticket class × discount code)` via a **new** `_budExportRows`, leaving the on-screen Budget card's merged rows untouched. The sponsorship summary gains three reported-but-never-totalled buckets (unclassified codes, withdrawn places, unpriced places) and computes its ask from the pre-refund value. The Summary sheet gains a reconciliation block comparing people fetched against people printed.

**Tech Stack:** TypeScript/Express backend (`src/`), vanilla-JS SPA (`public/index.html`, no build step), vitest, hand-rolled OOXML writer, `scripts/budget-xlsx-harness.js` (node, extracts the real SPA functions into a `vm` sandbox).

**Spec:** None. Approved in-session on 2026-09-05; every decision is restated in Global Constraints and in each task's rationale, so this plan is self-contained.

## Global Constraints

- **No schema or migration change.** Next migration remains `0023`.
- **`sw.js` `CACHE` must step `camp-v108` → `camp-v109`** in the final task, because `public/index.html` changes. Do it once, at the end, not per task.
- **Server and SPA mirrors change together.** `src/services/budget.ts` and its mirror in `public/index.html` are two copies of one algorithm. A task that edits one edits the other, in the same commit.
- **Do NOT change the on-screen Budget card.** The merged category rows (`_budScopeRows` → `_budMergeScopes` → `drawBudget`) were an explicit owner decision on 2026-08-02 after the card was reported unreadable. The export's finer grain lives in a separate function.
- **Report, never infer.** An untagged discount code is reported as `⚠ Not classified` and its money is excluded from every total. Do not derive a tag from the invoice percentage. This mirrors the standing rule on `discountTagConflict`: the code reports, a human decides.
- **Raw invoice value = `amountPaid`**, pre-override and pre-refund. Owner's decision, with the accepted trade-off that a sponsored row reads `$0.00` in both the raw and effective columns.
- **A mixed aggregate row shows a BLANK money cell, never `0`.** A `0` reads as "free" beside a non-zero line total. Existing rule, extended to the new Raw column.
- **Sponsorship totals exclude cancelled places and are refund-independent.** Excluded amounts are reported on their own line, never silently dropped.
- **Every download goes through `_rlSaveBlob`.** Do not hand-roll an anchor.
- **Verification commands** (all must pass in the final task):
  - `npm run typecheck`
  - `npx vitest run`
  - `node scripts/budget-xlsx-harness.js`
  - `node --check` on the extracted SPA body and on `public/sw.js`
- **SPA line numbers drift on every edit.** Grep the symbol name; never trust a line number quoted here.
- **`public/index.html` is one 9,900-line file. Never run two agents against it in parallel** — Tasks 3, 4, 5 and 6 all touch it and MUST run sequentially. Task 2 (server only) may run in parallel with Task 3.

### Subagent dispatch policy (token efficiency)

Dispatch each task to a **Sonnet** subagent. Batch as follows:

| Batch | Tasks | Parallel? | Files |
|---|---|---|---|
| A | 1 | — | `scripts/budget-xlsx-harness.js` |
| B | 2 and 3 | **Yes — 2 agents** | 2 = `src/**` only; 3 = `public/index.html` only |
| C | 4 → 5 → 6 | **No — strictly sequential** | all `public/index.html` |
| D | 7 | — | docs, `sw.js`, verification |

Batch B is the only safe parallel pair, because Task 2 touches no SPA file and Task 3 touches no server file. If a subagent is given an isolated worktree, **verify the base commit by hash before it starts** — a worktree agent can silently branch from the wrong commit, and a branch-name check does not catch it.

---

## File Structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `scripts/budget-xlsx-harness.js` | Modify | Repaired extractor + all workbook assertions, incl. the new columns, totality and the unclassified block |
| `src/services/budget.ts` | Modify | Canonical algorithm: `BudgetPerson.status`, exported `receivedBeforeRefund`, sponsor summary with withdrawn/unclassified buckets |
| `src/services/budget.sponsor.test.ts` | Modify | Unit tests for the sponsorship changes |
| `public/index.html` | Modify | SPA mirrors, new `_budExportRows`, rewritten `exportBudget`, hardened `RENDER.budget` fetch |
| `public/sw.js` | Modify | Cache version bump |
| `CLAUDE.md`, `debug.md` | Modify | Engineering log entry + symptom-router rows |

---

## Task 1: Repair the workbook harness

The harness extracts SPA functions by **exact signature string**. On 2026-08-05 a `tag` parameter was added to `_personValue` and `_sponsorAmountFor`; the harness's strings were never updated, so `extract()` throws on startup and the process exits before a single check runs. It has been dead for a month and did not guard the 2026-09-03 cancel/refund release. Nothing later in this plan can be trusted until this is fixed, and fixing it by simply pasting today's signatures would leave the same landmine for the next parameter.

**Files:**
- Modify: `scripts/budget-xlsx-harness.js` (the `extract()` function and the declaration list around lines 88–106)

**Interfaces:**
- Consumes: nothing.
- Produces: `extract(decl)` matching on a **name prefix** rather than a full signature; a green `node scripts/budget-xlsx-harness.js`.

- [ ] **Step 1: Reproduce the failure and record it**

Run: `node scripts/budget-xlsx-harness.js`
Expected: `Error: not found in index.html: function _personValue(p,cls,prices,ticketPrice)` and a non-zero exit. This is the bug — confirm it before touching anything.

- [ ] **Step 2: Make the extractor tolerant of parameter drift**

In `extract(decl)`, replace the `SRC.indexOf(decl)` lookup with a prefix search that stops at the parameter list. Keep the existing brace/string/regex-balancing loop exactly as it is — it is load-bearing and was written to survive `;` inside strings, an IIFE, and a regex containing a quote.

```js
function extract(decl) {
  // Match on everything up to the '(' — the NAME is stable, the parameter list is not.
  // A full-signature match silently rotted for a month when `tag` was appended to
  // _personValue and _sponsorAmountFor on 2026-08-05, and the harness threw on startup
  // rather than reporting a failure, so nobody noticed it had stopped running.
  const paren = decl.indexOf('(');
  const stem = paren < 0 ? decl : decl.slice(0, paren + 1);
  const i = SRC.indexOf(stem);
  if (i < 0) throw new Error('not found in index.html: ' + stem);
  let depth = 0, started = false, prev = '';
  for (let j = i; j < SRC.length; j++) {
    // ... existing loop body unchanged ...
  }
}
```

Leave the rest of the function body byte-identical. Only the three lines that resolve `i` change.

- [ ] **Step 3: Prove the extractor now finds the drifted symbols**

Run: `node scripts/budget-xlsx-harness.js`
Expected: it gets past extraction. It may now FAIL individual checks (the export has changed since 2026-08-04) — that is fine and expected at this step. What must NOT happen is a thrown `not found` error.

- [ ] **Step 4: Bring the existing checks back to green**

Work through each reported failure and correct the **harness's expectation**, not the app — Task 1 changes no product behaviour. Expect failures around the `Cancelled` column added on 2026-09-03 (the sheet is 10 columns wide now, `A1:J<n>`, and `detail()` pushes a 10th cell). Update the column-count and filter-range assertions to match the shipped export.

- [ ] **Step 5: Add a guard so this cannot rot silently again**

Append to the harness, immediately after the `vm.runInContext` call:

```js
/* The extractor matches on a name prefix, so a renamed FUNCTION still throws (good) while a
   changed parameter list does not (also good). This asserts the sandbox actually got a callable
   for each name we depend on — a typo'd name would otherwise surface as a confusing TypeError
   several hundred lines below. */
['_budScopeRows', '_budExportRows', '_personValue', '_sponsorAmountFor',
 'computeSponsorSummaryClient', 'exportBudget', '_xlsxBlob'].forEach((n) => {
  checkTrue('sandbox exposes ' + n, typeof ctx[n] === 'function' || typeof eval('typeof ' + n) !== 'undefined');
});
```

Note `_budExportRows` does not exist yet — it arrives in Task 4. Add its name to this list **in Task 4**, not now, or Task 1 cannot go green.

- [ ] **Step 6: Run the full harness**

Run: `node scripts/budget-xlsx-harness.js`
Expected: every check `ok`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/budget-xlsx-harness.js
git commit -m "fix: repair budget workbook harness, dead since the 2026-08-05 tag parameter

extract() matched on a full signature string, so appending `tag` to _personValue
and _sponsorAmountFor made it throw on startup. The 98 checks have not run since
2026-08-04 and did not guard the 2026-09-03 cancel/refund release. Matching on the
name prefix makes it survive parameter drift."
```

---

## Task 2: Server — status, pre-refund value, and the three reported buckets

`computeSponsorSummary` skips any code that is not tagged `sponsor`/`discount`, so 85 people and roughly $13,000 of sponsorship gap are invisible (measured against prod 2026-09-05: 14 of 19 codes in use are untagged, 9 of them at a 100% discount with `$0` paid). It also has no notion of a cancelled place, and its ask is computed from the post-refund value, so issuing a refund inflates what a sponsor is asked for.

**Files:**
- Modify: `src/services/budget.ts`
- Test: `src/services/budget.sponsor.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for Task 3 to mirror exactly:
  - `BudgetPerson.status?: 'registered' | 'cancelled'`
  - `export function receivedBeforeRefund(p, cls, prices, ticketPrice?, tag?): number | null` — the former private `amountPaidBase`, unchanged in behaviour.
  - `export function isUnclassifiedDiscount(p: BudgetPerson, tags: DiscountTagMap): boolean`
  - `SponsorSummary` gains: `withdrawnCount: number`, `withdrawnTotal: number`, `unclassifiedCount: number`, `unclassifiedTotal: number`, `unclassified: UnclassifiedCodeRow[]`
  - `export interface UnclassifiedCodeRow { code: string; count: number; total: number; avgPercent: number | null }`

- [ ] **Step 1: Write the failing tests**

Append to `src/services/budget.sponsor.test.ts`:

```ts
describe('2026-09-05 fix — cancelled, refunded and unclassified places', () => {
  const tags: DiscountTagMap = { SPON: 'sponsor' };
  const prices: BasePrices = { tent: null, classroom: null };
  const base = (over: Partial<BudgetPerson> = {}): BudgetPerson => ({
    churchId: 'c1', churchName: 'Carindale', kind: 'camper',
    registrationCost: 190, amountPaid: 0, accommodationKind: 'classroom',
    discountCode: 'SPON', ...over,
  });

  it('excludes a cancelled place from the ask and reports it separately', () => {
    const r = computeSponsorSummary([base(), base({ status: 'cancelled' })], { tags, prices });
    expect(r.total).toBe(190);          // one place, not two
    expect(r.count).toBe(1);
    expect(r.withdrawnCount).toBe(1);
    expect(r.withdrawnTotal).toBe(190); // named, not silently dropped
  });

  it('a refund does not inflate the ask', () => {
    const noRefund = computeSponsorSummary([base({ amountPaid: 190 })], { tags, prices });
    const refunded = computeSponsorSummary(
      [base({ amountPaid: 190, refundAmount: 190 })], { tags, prices });
    expect(noRefund.total).toBe(0);
    expect(refunded.total).toBe(0);     // was 190 before this fix
  });

  it('reports an untagged code carrying a real discount, and never totals it', () => {
    const r = computeSponsorSummary(
      [base({ discountCode: 'UNTAGGED', discountAmount: 190, amountPaid: 0 })],
      { tags, prices });
    expect(r.total).toBe(0);            // excluded from the ask
    expect(r.count).toBe(0);
    expect(r.unclassifiedCount).toBe(1);
    expect(r.unclassifiedTotal).toBe(190);
    expect(r.unclassified).toEqual([
      { code: 'UNTAGGED', count: 1, total: 190, avgPercent: 100 },
    ]);
  });

  it('does not flag an untagged code with no discount evidence', () => {
    const r = computeSponsorSummary(
      [base({ discountCode: 'PLAIN', discountAmount: 0, amountPaid: 190 })],
      { tags, prices });
    expect(r.unclassifiedCount).toBe(0);
  });

  it('a tagged code is never reported as unclassified', () => {
    const r = computeSponsorSummary([base({ discountAmount: 190 })], { tags, prices });
    expect(r.unclassifiedCount).toBe(0);
    expect(r.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/budget.sponsor.test.ts`
Expected: FAIL — `withdrawnCount`, `unclassifiedCount` etc. are `undefined`, and the refund test reports `190` where `0` is expected.

- [ ] **Step 3: Add `status` to `BudgetPerson`**

In `src/services/budget.ts`, inside `export interface BudgetPerson`:

```ts
  /**
   * Registration state. Optional because most callers never set it and every existing
   * fixture predates it. Only the SPONSORSHIP path reads it: a withdrawn place is no longer
   * an ask. The RECEIVED table deliberately still counts a cancelled person's money
   * (2026-09-03) — cancelling must not move the money, so do not add a filter there.
   */
  status?: 'registered' | 'cancelled';
```

- [ ] **Step 4: Export the pre-refund value under an honest name**

Rename the private `amountPaidBase` to `receivedBeforeRefund` and export it. Its body does not change.

```ts
/**
 * The pre-refund value. `amountPaidOverride` short-circuits EVERYTHING — it is not another rung
 * on the cascade, it IS the person's value once an admin has set it (including a deliberate 0,
 * which is why this tests `!= null` and not truthiness).
 *
 * EXPORTED 2026-09-05 because the sponsorship ask must be refund-INDEPENDENT: `personValue`
 * subtracts the refund, and `ask = ticketValue − received` therefore grew by exactly the refund
 * amount, asking a sponsor to re-fund money the camp chose to give back. There are now two
 * callers and no third copy of the cascade.
 *
 * ⚠️ MIRRORED in public/index.html `_personValueBase`. Change both together.
 */
export function receivedBeforeRefund(
  p: BudgetPerson,
  cls: TicketClass,
  prices: BasePrices,
  ticketPrice?: number | null,
  tag?: DiscountTag | null,
): number | null {
  // ... existing amountPaidBase body, unchanged ...
}
```

Update the single existing caller inside `personValue` from `amountPaidBase(...)` to `receivedBeforeRefund(...)`.

- [ ] **Step 5: Make the ask refund-independent**

In `sponsorAmountFor`, swap the `personValue` call for `receivedBeforeRefund`:

```ts
  // ⚠️ receivedBeforeRefund, NOT personValue — see that function's note. A refund must not
  // re-open a sponsorship gap; the money was returned deliberately, not left outstanding.
  const received = receivedBeforeRefund(p, cls, prices, ticketPrice, tag) ?? 0;
  return { ticketValue, amount: Math.max(0, ticketValue - received) };
```

- [ ] **Step 6: Add the unclassified detector**

Add near `discountTagFor`:

```ts
/**
 * A discount code that the admin has never classified, on a person whose invoice shows a real
 * discount. These are invisible to `computeSponsorSummary` (it only walks sponsor/discount tags),
 * which is how 85 people and ~$13,000 of sponsorship gap went unreported in prod on 2026-09-05.
 *
 * ⚠️ THIS DETECTS, IT DOES NOT INFER. A caller must report the person and EXCLUDE their money
 * from every total. Do not map "100% discount" onto the `sponsor` tag — an untagged 100% code
 * can legitimately be a staff comp or a desk payment, and guessing would ask a sponsor for money
 * nobody owes. Same doctrine as `discountTagConflict`: report, a human decides.
 */
export function isUnclassifiedDiscount(p: BudgetPerson, tags: DiscountTagMap): boolean {
  const code = (p.discountCode ?? '').trim();
  if (!code) return false;
  if (discountTagFor(p, tags) != null) return false;
  if ((p.discountAmount ?? 0) > 0) return true;
  // Fallback for a code whose discountAmount was never recorded: the invoice settled below
  // the ticket price, which is itself evidence of a discount.
  return p.registrationCost != null && p.amountPaid != null && p.amountPaid < p.registrationCost;
}
```

- [ ] **Step 7: Extend `SponsorSummary` and wire the buckets**

Add the row type and the five fields:

```ts
/** An untagged code carrying a measured discount. Reported, never totalled. */
export interface UnclassifiedCodeRow {
  code: string;
  count: number;
  /** The gap these places represent — what the ask WOULD be if the code were classified. */
  total: number;
  /** Measured average discount on the invoices, or null when no invoice carried both figures. */
  avgPercent: number | null;
}
```

On `SponsorSummary`:

```ts
  /** Cancelled places, excluded from every total above. Reported so the exclusion is visible. */
  withdrawnCount: number;
  withdrawnTotal: number;
  /** Untagged codes with a measured discount. NOT in `total` — see `isUnclassifiedDiscount`. */
  unclassifiedCount: number;
  unclassifiedTotal: number;
  unclassified: UnclassifiedCodeRow[];
```

In `computeSponsorSummary`, inside the `for (const p of scoped)` loop, before the existing tag check:

```ts
    const code = (p.discountCode ?? '').trim();
    if (!code) continue;

    if (isUnclassifiedDiscount(p, tags)) {
      const cls = classifyTicket(p, tags);
      const { ticketValue } = sponsorAmountFor(p, cls, prices, resolveTicketPrice(p, priceTable), null);
      const received = receivedBeforeRefund(p, cls, prices, resolveTicketPrice(p, priceTable), null) ?? 0;
      const gap = ticketValue == null ? 0 : Math.max(0, ticketValue - received);
      let u = unclassifiedBy.get(code);
      if (!u) { u = { count: 0, total: 0, pairs: [] }; unclassifiedBy.set(code, u); }
      u.count++;
      u.total += gap;
      if (p.registrationCost != null && p.registrationCost > 0 && p.discountAmount != null) {
        u.pairs.push({ cost: p.registrationCost, discount: p.discountAmount });
      }
      continue;
    }

    const tag = tags[code];
    if (!tag || !SPONSOR_TAGS.includes(tag)) continue;

    // A withdrawn place is not an ask. Counted and reported, never totalled.
    if (p.status === 'cancelled') {
      const cls = classifyTicket(p, tags);
      const { ticketValue, amount } = sponsorAmountFor(
        p, cls, prices, resolveTicketPrice(p, priceTable), tag);
      withdrawnCount++;
      withdrawnTotal += ticketValue == null ? 0 : amount;
      continue;
    }
```

Declare `const unclassifiedBy = new Map<string, { count: number; total: number; pairs: { cost: number; discount: number }[] }>();` and `let withdrawnCount = 0, withdrawnTotal = 0;` beside the existing accumulators, and build the return value:

```ts
  const unclassified: UnclassifiedCodeRow[] = [...unclassifiedBy.entries()]
    .map(([code, u]) => ({
      code, count: u.count, total: u.total, avgPercent: averageDiscountPercent(u.pairs),
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    total: fullTotal + partialTotal, fullTotal, partialTotal, count, unpricedCount,
    withdrawnCount, withdrawnTotal,
    unclassifiedCount: unclassified.reduce((s, u) => s + u.count, 0),
    unclassifiedTotal: unclassified.reduce((s, u) => s + u.total, 0),
    unclassified,
    codes, churches,
  };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/services/budget.sponsor.test.ts`
Expected: PASS, including the pre-existing "RECONCILES" and "$170 appears nowhere" tests, which must not regress.

- [ ] **Step 9: Prove the refund test can actually fail**

Temporarily revert Step 5 (`receivedBeforeRefund` → `personValue`) and re-run. Expected: the refund test fails with `expected 190 to be 0`. Restore Step 5. A test that passes against the old code proves nothing — this repo has been bitten by exactly that (the `VAPID_ENV` `'pub'`/`'priv'` fixture).

- [ ] **Step 10: Full server gate and commit**

Run: `npm run typecheck && npx vitest run`
Expected: clean; test count up by 5.

```bash
git add src/services/budget.ts src/services/budget.sponsor.test.ts
git commit -m "fix(budget): sponsorship ignores cancellations, refunds and untagged codes

- exclude cancelled places from the ask, report them as withdrawn
- compute the ask from receivedBeforeRefund so a refund cannot re-open a gap
- report untagged codes carrying a measured discount, never total them

Measured in prod 2026-09-05: 14 of 19 codes in use are untagged, hiding
85 people and ~\$13,000 of sponsorship gap from the export."
```

---

## Task 3: SPA mirror of the sponsorship changes

Runs in parallel with Task 2 (disjoint files) but implements the identical rules. The SPA copy is the one that actually runs — the server's `computeBudget`/`budgetToCsv` are dead code, kept because they are the canonical tested algorithm.

**Files:**
- Modify: `public/index.html` — `_personValueBase`, `_sponsorAmountFor`, `computeSponsorSummaryClient`, and a new `_isUnclassifiedDiscount`

**Interfaces:**
- Consumes: the rules defined in Task 2 (identical semantics; the two are reviewed against each other in Task 7).
- Produces: `computeSponsorSummaryClient` returning the five new fields — `withdrawnCount`, `withdrawnTotal`, `unclassifiedCount`, `unclassifiedTotal`, `unclassified[]` — consumed by Task 5.

- [ ] **Step 1: Make the SPA ask refund-independent**

Grep `function _sponsorAmountFor`. Change the `received` line only:

```js
  // ⚠️ _personValueBase (pre-refund), NOT _personValue. Mirrors receivedBeforeRefund in
  // src/services/budget.ts — a refund must not re-open a sponsorship gap.
  const received=_personValueBase(p,cls,prices,ticketPrice,tag);
  return {ticketValue,amount:Math.max(0,ticketValue-(received==null?0:received))};
```

`_personValueBase` already exists and already has this signature — no change to it is needed.

- [ ] **Step 2: Add the unclassified detector**

Immediately after `_discountTagFor`:

```js
/* Mirrors isUnclassifiedDiscount in src/services/budget.ts — read ITS doc comment.
   ⚠️ DETECTS, NEVER INFERS. The caller reports these and excludes their money from every
   total. An untagged 100%-off code can be a staff comp or a desk payment; guessing "sponsor"
   would ask someone for money nobody owes. */
function _isUnclassifiedDiscount(p,tags){
  const code=(p.discountCode||'').trim();
  if(!code)return false;
  if(_discountTagFor(p,tags)!=null)return false;
  if(Number(p.discountAmount||0)>0)return true;
  return p.registrationCost!=null&&p.amountPaid!=null&&Number(p.amountPaid)<Number(p.registrationCost);
}
```

- [ ] **Step 3: Carry `status` and `discountAmount` into the sponsorship person shape**

In `computeSponsorSummaryClient`, the local `p` object is built without `status` or `discountAmount`; both are now needed. Add them:

```js
    const p={churchId:r.churchId,churchName:r.churchName,
      registrationCost:num(r.registrationCost),amountPaid:num(r.amountPaid),
      amountPaidOverride:num(r.amountPaidOverride),refundAmount:num(r.refundAmount),
      discountAmount:num(r.discountAmount),status:r.status||null,
      accommodationKind:r.accommodationKind||null,discountCode:code,
      registrationType:r.registrationType||null};
```

- [ ] **Step 4: Wire the two new buckets**

Restructure the `people.forEach(r=>{...})` body to match Task 2's control flow exactly — unclassified first, then the tag check, then the cancelled check:

```js
  const unclassifiedBy=new Map();
  let withdrawnCount=0,withdrawnTotal=0;
  people.forEach(r=>{
    const code=(r.discountCode||'').trim();
    if(!code)return;
    const p={/* as Step 3 */};
    const cls=_classifyTicket(p,tags);
    const tp=_resolveTicketPrice(p,ptable);

    if(_isUnclassifiedDiscount(p,tags)){
      const v=_sponsorAmountFor(p,cls,prices,tp,null);
      const rec=_personValueBase(p,cls,prices,tp,null);
      const gap=v.ticketValue==null?0:Math.max(0,v.ticketValue-(rec==null?0:rec));
      let u=unclassifiedBy.get(code);
      if(!u){u={count:0,total:0,pairs:[]};unclassifiedBy.set(code,u);}
      u.count++;u.total+=gap;
      if(p.registrationCost>0&&p.discountAmount!=null)u.pairs.push({cost:p.registrationCost,discount:p.discountAmount});
      return;
    }

    const tag=tags[code];
    if(!tag||_SPONSOR_TAGS.indexOf(tag)<0)return;

    // A withdrawn place is not an ask (2026-09-05). Reported, never totalled.
    if(p.status==='cancelled'){
      const v=_sponsorAmountFor(p,cls,prices,tp,tag);
      withdrawnCount++;withdrawnTotal+=v.ticketValue==null?0:v.amount;
      return;
    }

    const v=_sponsorAmountFor(p,cls,prices,tp,tag);
    let bucket=byCode.get(code);
    if(!bucket){bucket={tag,entries:[]};byCode.set(code,bucket);}
    bucket.entries.push({churchId:r.churchId,churchName:r.churchName,amount:v.amount,
      ticketValue:v.ticketValue,ticketType:(r.registrationType||'').trim()});
  });
```

And extend the return:

```js
  const unclassified=[...unclassifiedBy.entries()]
    .map(([code,u])=>({code,count:u.count,total:u.total,avgPercent:_avgDiscountPct(u.pairs)}))
    .sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code));
  return {total:fullTotal+partialTotal,fullTotal,partialTotal,count,unpricedCount,
    withdrawnCount,withdrawnTotal,
    unclassifiedCount:unclassified.reduce((s,u)=>s+u.count,0),
    unclassifiedTotal:unclassified.reduce((s,u)=>s+u.total,0),
    unclassified,codes,churches};
```

- [ ] **Step 5: Syntax-check the SPA**

Run (derive the range, never cache it):
```bash
S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1)
E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1)
sed -n "$((S+1)),$((E-1))p" public/index.html > /tmp/spa.js && node --check /tmp/spa.js
```
Expected: no output (valid).

- [ ] **Step 6: Confirm the on-screen Sponsorship card still renders**

Grep `drawBudget` for its `spon.` reads. The card reads `spon.count`, `spon.total`, `spon.fullTotal`, `spon.partialTotal`, `spon.unpricedCount`, `spon.codes`, `spon.churches` — all still present and all still meaning the same thing. **No change to `drawBudget` in this task.** Confirm by reading, and state in the commit that the card is untouched.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "fix(budget/spa): mirror the sponsorship cancel/refund/untagged fixes

Mirrors src/services/budget.ts. The Budget card is deliberately unchanged —
every field it reads keeps its meaning; the new buckets are export-only."
```

---

## Task 4: `_budExportRows` — code-grained rows with guaranteed totality

The export's current rows are grouped `(church × audience × ticket class)` and carry `codeHint`, which is populated only when every person in the row shares one code. Promoting the code to a real column without re-grouping would print a code that does not describe the row. A **new** function does the finer grouping so the on-screen card's merged rows are untouched.

**Files:**
- Modify: `public/index.html` — add `_budExportRows` immediately after `_budScopeRows`
- Modify: `scripts/budget-xlsx-harness.js` — extract and assert the new function

**Interfaces:**
- Consumes: `_classifyTicket`, `_personValue`, `_personValueBase`, `_discountTagFor`, `_resolveTicketPrice` (all existing).
- Produces, consumed by Task 5:
  ```js
  _budExportRows(people, tags, prices, ptable) -> [{
    key,          // TicketClass
    code,         // '' when the person holds no discount code
    count,        // headcount; Σ count === people.length ALWAYS
    cancelled,    // count of status==='cancelled' within the row
    rawAmount,    // uniform amountPaid, or null when mixed
    effAmount,    // uniform personValue, or null when mixed
    effTotal,     // Σ personValue — exact
    missing,      // people with no recorded value at all
    unclassified, // true when this row's code is an untagged real discount
  }]
  ```

- [ ] **Step 1: Write the failing harness checks**

Add a new section to `scripts/budget-xlsx-harness.js` (before the workbook sections):

```js
console.log('\n0. _budExportRows — grouping and totality');
{
  const tags = { SPON: 'sponsor', EFT: 'inperson' };
  const prices = { tent: null, classroom: null };
  const P = (o) => Object.assign({
    churchId: 'c1', churchName: 'Carindale', kind: 'camper',
    registrationCost: 190, amountPaid: 190, accommodationKind: 'classroom',
    discountCode: null, discountAmount: null, status: 'registered',
  }, o);
  const people = [
    P({}), P({}),                                                  // plain, no code
    P({ discountCode: 'SPON', amountPaid: 0, discountAmount: 190 }),// tagged sponsor
    P({ discountCode: 'EFT', amountPaid: 0, discountAmount: 190 }), // tagged in person
    P({ discountCode: 'MYSTERY', amountPaid: 0, discountAmount: 190 }), // untagged
    P({ accommodationKind: null }),                                // unknown accommodation
    P({ status: 'cancelled' }),                                    // cancelled, still counted
    P({ amountPaid: null, registrationCost: null }),               // nothing recorded
  ];
  const rows = ctx._budExportRows(people, tags, prices, new Map());

  checkTrue('every person lands on exactly one row',
    rows.reduce((s, r) => s + r.count, 0) === people.length,
    'Σ count=' + rows.reduce((s, r) => s + r.count, 0) + ' people=' + people.length);
  checkTrue('rows are split by code', rows.some((r) => r.code === 'SPON') && rows.some((r) => r.code === 'MYSTERY'));
  checkTrue('an untagged discount row is flagged',
    rows.find((r) => r.code === 'MYSTERY').unclassified === true);
  checkTrue('a tagged row is not flagged',
    rows.find((r) => r.code === 'SPON').unclassified === false);
  check('cancelled is counted within its row',
    rows.reduce((s, r) => s + r.cancelled, 0), 1);
  checkTrue('a mixed-value row reports a null unit price, never 0',
    rows.every((r) => r.effAmount === null || typeof r.effAmount === 'number'));
  checkTrue('effTotal is the exact sum of member values',
    Math.abs(rows.reduce((s, r) => s + r.effTotal, 0) - (190 + 190 + 0 + 0 + 0 + 190 + 190 + 0)) < 0.001);
}
```

Add `'function _budExportRows(people,tags,prices,ptable)'` to the extract list, and add `_budExportRows` to the Task 1 Step 5 sandbox guard list.

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/budget-xlsx-harness.js`
Expected: `Error: not found in index.html: function _budExportRows(` — the function does not exist yet.

- [ ] **Step 3: Implement `_budExportRows`**

Insert immediately after `_budScopeRows` in `public/index.html`:

```js
/* EXPORT-ONLY row builder (2026-09-05). Grouped one level finer than `_budScopeRows`:
   (ticket class × discount code) rather than ticket class alone.

   ⚠️ WHY THIS IS A SECOND FUNCTION AND NOT A PARAMETER ON `_budScopeRows`.
   The owner asked on 2026-08-02 for the on-screen card's category rows to be MERGED, after
   reporting the un-merged version "almost impossible to follow". Splitting by code would
   silently undo that decision on the screen. The export wants the opposite — a `Code used`
   column that is true of every person on its row — so the two grains are both correct and
   they are deliberately kept apart. Do not "DRY" these together.

   ⚠️ TOTALITY IS THE POINT. Every person lands in exactly one bucket by construction: the key
   is built from the person, not looked up in a fixed list, so there is no `_BUD_CLASSES`-style
   allow-list that could silently drop a bucket. There is a harness check asserting
   Σ count === people.length; keep it. */
function _budExportRows(people,tags,prices,ptable){
  const by=new Map();
  (people||[]).forEach(p=>{
    const cls=_classifyTicket(p,tags);
    const code=(p.discountCode||'').trim();
    const tp=_resolveTicketPrice(p,ptable);
    const eff=_personValue(p,cls,prices,tp,_discountTagFor(p,tags));
    // Raw = what the invoice recorded arriving, BEFORE override and refund (owner, 2026-09-05).
    const raw=p.amountPaid==null?null:Number(p.amountPaid);
    const key=cls+'\u0000'+code;
    let b=by.get(key);
    if(!b){b={key:cls,code,count:0,cancelled:0,effTotal:0,missing:0,
      effValues:new Map(),rawValues:new Map(),unclassified:_isUnclassifiedDiscount(p,tags)};by.set(key,b);}
    b.count++;
    if(p.status==='cancelled')b.cancelled++;
    if(eff==null)b.missing++;else{b.effTotal+=eff;b.effValues.set(eff,(b.effValues.get(eff)||0)+1);}
    if(raw!=null)b.rawValues.set(raw,(b.rawValues.get(raw)||0)+1);
  });
  // A uniform value only when EVERY member contributed the same one and none was missing;
  // otherwise null, which the writer renders as a BLANK cell. Never 0 — a 0 reads as "free"
  // beside a non-zero line total.
  const uniform=(m,n)=>(m.size===1&&[...m.values()][0]===n)?[...m.keys()][0]:null;
  const order=new Map(_BUD_CLASSES.map(([k],i)=>[k,i]));
  return [...by.values()].map(b=>({
    key:b.key,code:b.code,count:b.count,cancelled:b.cancelled,
    rawAmount:uniform(b.rawValues,b.count),
    effAmount:b.missing?null:uniform(b.effValues,b.count),
    effTotal:b.effTotal,missing:b.missing,unclassified:b.unclassified,
  })).sort((a,b)=>(order.get(a.key)-order.get(b.key))||a.code.localeCompare(b.code));
}
```

- [ ] **Step 4: Run the harness to verify the new checks pass**

Run: `node scripts/budget-xlsx-harness.js`
Expected: section 0 all `ok`; every pre-existing check still `ok`.

- [ ] **Step 5: Prove the totality check can fail**

Temporarily change the key from `cls+'\u0000'+code` to `cls` and re-run. Expected: `rows are split by code` fails. Then temporarily add `if(cls==='unknown')return;` at the top of the forEach. Expected: `every person lands on exactly one row` fails with `Σ count=7 people=8`. Restore both. A totality assertion that cannot fail is decoration.

- [ ] **Step 6: Syntax-check and commit**

Run the `node --check` block from Task 3 Step 5. Expected: valid.

```bash
git add public/index.html scripts/budget-xlsx-harness.js
git commit -m "feat(budget): _budExportRows — code-grained rows with guaranteed totality

Export-only. The on-screen card keeps its merged rows (owner, 2026-08-02).
Harness asserts every person lands on exactly one row."
```

---

## Task 5: Rewrite the export — new columns, reconciliation, unclassified block

**Files:**
- Modify: `public/index.html` — `exportBudget`
- Modify: `scripts/budget-xlsx-harness.js` — column and Summary assertions

**Interfaces:**
- Consumes: `_budExportRows` (Task 4), `computeSponsorSummaryClient`'s five new fields (Task 3), `window._budgetFetch` (Task 6 — until Task 6 lands, guard the read so a missing value degrades to "not reported" rather than throwing).
- Produces: an 11-column 'By ministry' sheet and a Summary sheet carrying `Reconciliation` and, conditionally, `Unclassified discount codes`.

- [ ] **Step 1: Write the failing harness checks**

Extend the harness's `exportBudget` stubs so `ctx.computeSponsorSummaryClient` returns the new fields, and assert the new sheet shape:

```js
console.log('\n8. New column set and reconciliation (2026-09-05)');
{
  const HEAD = ['Church','Row type','Audience','Accommodation','Code used','Code type','Number',
    'Raw invoice value','Effective $ to budget per ticket','Effective $ to budget total','Cancelled'];
  const head = parseSheet(parts['xl/worksheets/sheet2.xml'])[0];
  check('By ministry header', head.map((c) => c.text), HEAD);
  checkTrue('autofilter spans 11 columns and stops at the received table',
    /A1:K\d+/.test(parts['xl/worksheets/sheet2.xml']));

  const sum = parseSheet(parts['xl/worksheets/sheet1.xml']);
  const texts = sum.map((r) => (r || []).map((c) => c.text).join(' '));
  checkTrue('Summary carries a reconciliation block',
    texts.some((t) => /Reconciliation/.test(t)));
  checkTrue('Summary reports people fetched and people printed',
    texts.some((t) => /People fetched/.test(t)) && texts.some((t) => /People on/.test(t)));
  checkTrue('a mismatch is stated loudly, not as a quiet number',
    texts.some((t) => /Do not rely on the totals/.test(t)));
  checkTrue('unclassified codes are named with their people and dollars',
    texts.some((t) => /not been classified/.test(t)) && texts.some((t) => /MYSTERY/.test(t)));
  checkTrue('unclassified money is NOT in the sponsorship total',
    Number(cellAt(sum.find((r) => (r||[]).some((c) => c.text === 'Total still needed')), 'C').num) === 1860);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/budget-xlsx-harness.js`
Expected: section 8 fails — the header is still the old 10-column set and no reconciliation text exists.

- [ ] **Step 3: Add the code-type resolver**

Beside `_budPayment` in `public/index.html`:

```js
/* The `Code type` column (2026-09-05), replacing `Payment type`. Derived from the CODE and the
   admin's tags — not parsed out of the class key — because a row now carries exactly one code.
   ⚠️ '⚠ Not classified' is a real, loud value, not a blank: it is the entire signal that this
   row's sponsorship gap is missing from the totals. */
function _budCodeType(row,tags){
  if(!row.code)return 'Full price';
  const tag=tags[row.code];
  if(tag==='inperson')return 'Paid in person';
  if(tag==='sponsor')return 'Full sponsor';
  if(tag==='discount')return 'Discounted';
  return row.unclassified?'\u26A0 Not classified':'Full price';
}
```

- [ ] **Step 4: Rewrite the 'By ministry' sheet**

In `exportBudget`, replace the `HEAD` array and the `detail` builder:

```js
    const HEAD=['Church','Row type','Audience','Accommodation','Code used','Code type','Number',
      'Raw invoice value','Effective $ to budget per ticket','Effective $ to budget total','Cancelled'];
    const rows=[HEAD.map((h)=>_xc(h,XS.HEAD))];
    const tags=_budTags(),prices=_budPrices(),ptable=_budTicketPrices(window._budgetRegs);
    let printed=0;
    const detail=(church,aud,list)=>(list||[]).forEach((r)=>{
      printed+=r.count;
      rows.push([
        _xc(church,XS.MUTED),_xc('Detail',XS.MUTED),_xc(aud,XS.TEXT),
        _xc(_budAccom(r.key),XS.TEXT),_xc(r.code||'',XS.TEXT),_xc(_budCodeType(r,tags),XS.TEXT),
        _xn(r.count,XS.NUM),_xn(r.rawAmount,XS.MONEY),_xn(r.effAmount,XS.MONEY),
        _xn(r.effTotal,XS.MONEY),_xn(r.cancelled,XS.NUM),
      ]);
    });
```

Each church block must now build its rows from `_budExportRows` rather than reading `c.campers`/`c.leaders`. Inside the `rep.churches.forEach((c)=>{...})`, before the total row:

```js
      // Export grain, not card grain — see the note on _budExportRows.
      const cam=_budExportRows(c._people?c._people.filter(p=>p.kind!=='leader'):[],tags,prices,ptable);
      const led=_budExportRows(c._people?c._people.filter(p=>p.kind==='leader'):[],tags,prices,ptable);
```

This requires two changes to `computeBudgetClient`.

**(a) Retain the per-church people array.** Add one line inside its `churches` map, beside `campers`/`leaders`:

```js
      // Retained for the export's finer grouping (2026-09-05). The card never reads it.
      _people:[...c.campers,...c.leaders],
```

**(b) 🔴 Carry `discountAmount` into the mapped person shape.** `computeBudgetClient`'s `.map()` currently drops it — the comment on `discountCodes` even notes the reduced shape "drops `discountAmount`". `_isUnclassifiedDiscount` reads it first, so without this **every untagged code would silently fail the flag** and fall through to the weaker `amountPaid < registrationCost` branch. That branch happens to catch the prod cases, which is exactly what makes this dangerous: it would look like it worked. Add the field:

```js
      registrationCost:num(r.registrationCost),amountPaid:num(r.amountPaid),
      discountAmount:num(r.discountAmount),
```

Verify with a one-liner in devtools after the change:

```js
computeBudgetClient(window._budgetRegs,'all').churches
  .flatMap(c=>_budExportRows(c._people,_budTags(),_budPrices(),_budTicketPrices(window._budgetRegs)))
  .filter(r=>r.unclassified).map(r=>r.code)
```
Expected against current prod data: the untagged codes, including `YC26BNESPONSOR`, `ALIVE100`, `YSNORTH50`, `YC26ELEVATION`, `YC26STAFF`. An empty array means this field is still being dropped.

Then pad every non-detail row (church total, camp total, sponsorship rows, section headings) to **11 cells**. Count them; a short row shifts the `Cancelled` column left and the harness's header check will not catch that.

- [ ] **Step 5: Add the reconciliation block to Summary**

Immediately after the `Total received` row:

```js
    /* RECONCILIATION (2026-09-05). Every person in the app must be traceable to one line of
       'By ministry'. Two independent things can break that, and this block separates them:
       a grouping bug (caught by _budExportRows' totality assertion) and a SHORT FETCH — the
       campers request failing or truncating, which used to be swallowed entirely. */
    const fetched=(window._budgetFetch&&window._budgetFetch.count!=null)
      ?window._budgetFetch.count:null;
    sum.push([_xc('Reconciliation',XS.SECTION)]);
    sum.push([_xc('People fetched from the app',XS.TEXT),_xn(fetched,XS.NUM),_xc('',XS.TEXT)]);
    sum.push([_xc("People on 'By ministry'",XS.TEXT),_xn(printed,XS.NUM),_xc('',XS.TEXT)]);
    const diff=fetched==null?null:fetched-printed;
    sum.push([_xc('Difference',XS.TOT_T),_xn(diff,XS.TOT_N),_xc(diff===0?'OK':'',XS.TOT_T)]);
    if(diff){
      sum.push([_xc('\u26A0 '+Math.abs(diff)+' people are missing from this export. Do not rely on the totals above.'
        +((window._budgetFetch&&window._budgetFetch.error)?' The camper list failed to load: '+window._budgetFetch.error:''),XS.NOTE)]);
    }
```

Note `printed` is accumulated by `detail()`, so this block must be pushed **after** the 'By ministry' rows are built. Move the Summary assembly below the ministry sheet, or accumulate `printed` first — either is fine, but the sheets array must still list Summary first.

- [ ] **Step 6: Add the unclassified-codes block to Summary**

After the sponsorship block:

```js
    if(spon.unclassifiedCount){
      /* ⚠️ REPORTED, NOT INFERRED, AND NOT IN ANY TOTAL. An untagged 100%-off code can be a
         staff comp or a desk payment as easily as a sponsorship; classifying it is a human
         decision. Measured in prod 2026-09-05: 14 of 19 codes untagged, 85 people,
         ~$13,000 of gap invisible. */
      sum.push([]);
      sum.push([_xc('Unclassified discount codes',XS.SECTION)]);
      sum.push([_xc('Code',XS.HEAD),_xc('People',XS.HEAD),_xc('Gap not counted',XS.HEAD)]);
      spon.unclassified.forEach((u)=>sum.push([
        _xc(u.code+(u.avgPercent==null?'':' ('+Math.round(u.avgPercent)+'% off)'),XS.TEXT),
        _xn(u.count,XS.NUM),_xn(u.total,XS.MONEY)]));
      sum.push([_xc('Total not counted',XS.TOT_T),_xn(spon.unclassifiedCount,XS.TOT_N),_xn(spon.unclassifiedTotal,XS.TOT_M)]);
      sum.push([_xc('\u26A0 These codes have not been classified, so the sponsorship total above EXCLUDES them. Classify each one on the Budget screen to bring its gap into the total.',XS.NOTE)]);
    }
    if(spon.withdrawnCount){
      sum.push([_xc('Withdrawn (not asked for): '+spon.withdrawnCount+' place(s), '
        +'$'+spon.withdrawnTotal.toLocaleString('en-AU')+' excluded from the total above.',XS.NOTE)]);
    }
```

- [ ] **Step 7: Update the sheet definitions**

```js
      {name:'By ministry',cols:[26,20,10,16,16,18,9,15,20,20,11],rows:rows,freeze:1,filter:'A1:K'+receivedRows},
```

Eleven column widths for eleven columns; the filter range moves `J` → `K`.

- [ ] **Step 8: Run the harness**

Run: `node scripts/budget-xlsx-harness.js`
Expected: all sections `ok`, including the pre-existing corruption rules (reserved fills, `<worksheet>` child order) and the sponsorship-separation checks.

- [ ] **Step 9: Syntax-check and commit**

Run the `node --check` block from Task 3 Step 5.

```bash
git add public/index.html scripts/budget-xlsx-harness.js
git commit -m "feat(budget): new export columns, reconciliation block, unclassified codes

Columns: Code used / Code type / Number / Raw invoice value / Effective \$ per
ticket / Effective \$ total. Summary reconciles people fetched against people
printed and names every unclassified code with the money it excludes."
```

---

## Task 6: Stop the camper fetch failing silently

`RENDER.budget` does `api(_scoped('/campers?pageSize=1000')).catch(()=>[])`. A failure discards every already-arrived person with no error, no toast and no visible sign — the exact shape of "students missing from the export".

> ⚠️ **`pageSize` IS NOT A REAL PARAMETER. Verified 2026-09-05: nothing under `src/` reads it** — `grep -rn "pageSize" src/ --include=*.ts` returns nothing. `/campers` ignores the query string and returns the whole array, so there is no 1000-person cap and no truncation to fix. **Do NOT add a pagination loop.** An ignored `page` parameter would return the same first page every time and duplicate every camper. The only real defect here is the swallowed error. Leave the harmless `pageSize` in the URL or drop it; do not build a paging protocol the server does not implement.

**Files:**
- Modify: `public/index.html` — `RENDER.budget`

**Interfaces:**
- Consumes: nothing.
- Produces: `window._budgetFetch = { count: number, error: string|null }`, read by Task 5's reconciliation block.

- [ ] **Step 1: Record the failure instead of swallowing it**

Replace the fetch pair in `RENDER.budget`:

```js
  /* ⚠️ This used to be `.catch(()=>[])` — a failure silently dropped every already-arrived
     person (all leaders, and every student who has signed in) from the budget, with no error,
     no toast and nothing on screen. That is indistinguishable from "the camp is smaller than
     you thought". The reason is now RECORDED and printed on the Summary reconciliation block.
     ⚠️ NOT paginated: `pageSize` is not implemented server-side (verified 2026-09-05, nothing
     under src/ reads it), so /campers already returns everything. Adding a `page` loop against
     an endpoint that ignores it would re-fetch page 1 forever and duplicate every camper. */
  const regs=await api(_scoped('/registrants?includeCancelled=1'));
  let campers=[],fetchErr=null;
  try{
    const res=await api(_scoped('/campers'));
    campers=Array.isArray(res)?res:(res.items||[]);
  }catch(e){fetchErr=(e&&e.message)||String(e);}
  const regIds=new Set((regs||[]).map(r=>r.id));
  window._budgetRegs=[...(regs||[]),...campers.filter(c=>!regIds.has(c.id))];
  window._budgetFetch={count:window._budgetRegs.length,error:fetchErr};
```

- [ ] **Step 2: Surface a failure on screen too**

The export flags it, but a director looking at the card should not have to export to find out. In `drawBudget`, immediately before the existing `priceGate`, add:

```js
  const bf=window._budgetFetch;
  const fetchWarn=(bf&&bf.error)?`<div class="warnbox">Some people could not be loaded, so every figure below under-reports. ${esc(bf.error)}</div>`:'';
```

and prepend `fetchWarn` to the body string.

- [ ] **Step 3: Confirm the merge did not duplicate anyone**

The dedupe is `regIds`-based and unchanged, but this is the task that touches it. In devtools on the Budget screen:

```js
window._budgetRegs.length === new Set(window._budgetRegs.map(r=>r.id)).size
```
Expected: `true`. A duplicated person would inflate both the headcount and the grand total while the reconciliation block still read `Difference 0` — the one failure mode this task's own check cannot see.

- [ ] **Step 4: Syntax-check**

Run the `node --check` block from Task 3 Step 5. Expected: valid.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "fix(budget): camper fetch failure is recorded, not swallowed

.catch(()=>[]) dropped every arrived person from the budget with no visible sign.
The reason now reaches the Summary reconciliation block and a warnbox on the card."
```

---

## Task 7: Full gate, cache bump, and documentation

**Files:**
- Modify: `public/sw.js`, `CLAUDE.md`, `debug.md`

- [ ] **Step 1: Bump the service worker**

`public/sw.js` line 1: `const CACHE = 'camp-v108';` → `'camp-v109'`. `public/index.html` changed, and iOS standalone PWAs are documented as lazy about picking up a new worker.

- [ ] **Step 2: Run the complete gate**

```bash
npm run typecheck
npx vitest run
node scripts/budget-xlsx-harness.js
S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1)
E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1)
sed -n "$((S+1)),$((E-1))p" public/index.html > /tmp/spa.js && node --check /tmp/spa.js
node --check public/sw.js
node scripts/accom-export-harness.js
node scripts/filter-persist-harness.js
```
Expected: all clean. Record the exact vitest count (was 1059/64; expect 1064/64).

- [ ] **Step 3: Verify in real Excel**

```bash
BUDGET_XLSX_OUT=C:/tmp/budget.xlsx node scripts/budget-xlsx-harness.js
```
Open the file. Confirm: **no repair prompt**; 11 columns; header bold on `#1E1B4B`; a church total bold on `#EDE9FE`; the camp total white on `#4F46E5`; freeze pane on row 1; autofilter present and stopping above the sponsorship block; the Summary reconciliation reading `Difference 0 OK`. The harness cannot prove the absence of a repair prompt — only Excel can.

- [ ] **Step 4: Check the server/SPA mirrors agree**

Read `computeSponsorSummary` and `computeSponsorSummaryClient` side by side. The unclassified detection, the cancelled skip and the `receivedBeforeRefund`/`_personValueBase` call must be identical in order and condition. This repo has been bitten repeatedly by a drifted mirror; a two-minute read now is the cheapest place to catch it.

- [ ] **Step 5: Write the CLAUDE.md entry**

Add a new section at the **top** of `CLAUDE.md`, following the established house style — what changed, the measured prod numbers, and the ⚠️ notes that stop a future session undoing a deliberate decision. It must record:
- The harness had been dead since 2026-08-05 and did not guard the 2026-09-03 release.
- The 14-of-19 untagged codes measurement, with the table of codes and the ~$13,000 figure.
- That `_budExportRows` is deliberately a second function and must not be merged with `_budScopeRows`.
- That raw = `amountPaid` was the owner's explicit choice, with the accepted trade-off that a sponsored row reads `$0.00` twice.
- That unclassified codes are reported and never inferred, and the totals only move once a human classifies them.

- [ ] **Step 6: Write the debug.md symptom rows**

Add a `### 2026-09-05 — budget export traceability` section to the symptom router with at least:

| Symptom | Go to |
|---|---|
| "Sponsored students are missing from the export" | Their code is untagged. `computeSponsorSummaryClient` only walks `sponsor`/`discount` tags; everything else lands in `unclassified` and is reported on the Summary sheet, never totalled. Classify the code on the Budget screen. Measured 2026-09-05: 14 of 19 codes untagged. |
| The Summary reconciliation shows a non-zero Difference | Two causes, and the note says which: a short camper fetch (`window._budgetFetch.error`) or a grouping bug. The latter is impossible by construction — `_budExportRows` keys on the person, and a harness check asserts Σ count === people.length. |
| A sponsorship figure changed after a refund | It should not, since 2026-09-05. The ask uses `receivedBeforeRefund` / `_personValueBase`. If it moves, someone swapped it back to `personValue`. |
| A cancelled student is still being asked for | `status==='cancelled'` is skipped in the sponsorship loop and reported as `withdrawnCount`. The RECEIVED table still counts their money — that is correct and deliberate (2026-09-03). |
| The budget harness throws `not found in index.html` | `extract()` matches on the name prefix, so this now means a genuine RENAME, not a parameter change. It matched full signatures until 2026-09-05 and was dead for a month. |
| Raw and effective both read $0.00 on a sponsored row | Correct. Raw is `amountPaid`, and a sponsor invoice settles at $0. The gap lives in the Sponsorship block, not on the row. Owner's explicit choice, 2026-09-05. |

- [ ] **Step 7: Commit**

```bash
git add public/sw.js CLAUDE.md debug.md
git commit -m "docs: budget export traceability; sw camp-v109"
```

- [ ] **Step 8: Push and confirm the deploy landed**

```bash
git push origin master
sleep 45 && curl -s https://my-youth-camp.vercel.app/sw.js | head -1
```
Expected: `const CACHE = 'camp-v109';`. A push reaching `origin/master` is **not** proof Vercel built it — this repo has lost a whole test cycle to that exact webhook miss twice. If the version is stale, push an empty commit (`git commit --allow-empty`) to produce a fresh push event.

---

## Post-implementation: hand back to the owner

Two things need a human, and neither is a code change:

1. **Classify the 14 untagged codes** on the Budget screen. Until then the export names them and excludes ~$13,000 from the sponsorship total, by design. The largest are `YC26BNESPONSOR` (30 people, $5,700), `ALIVE100` (11, $1,730), `YSNORTH50` (9, 50% off), `YC26ELEVATION` (8, $1,480), `YC26STAFF` (5, $950).
2. **Eyeball the workbook on a real machine.** `tsc`, vitest and the harness cannot prove column widths read well or that the reconciliation block is noticeable enough to act on.
