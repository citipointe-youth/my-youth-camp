# CLAUDE.md — Youth Camp Platform

> ⚠️ **The three "2026-08-02" headings below were misdated** — `git log` puts those commits on
> **2026-08-01**. Dates in this file are hand-written and have drifted; trust `git log` over a
> heading.

## Budget export traceability — the harness was dead for a month, ~$13,000 of sponsorship was invisible — `camp-v109` — 2026-09-06

7-task branch (`budget-export-traceability`). **No schema or migration change** — next migration
is still `0023`. `npm run typecheck` clean, `npx vitest run` **1065 pass / 64 files** (was
1059/64; **+6**, no new files), `node scripts/budget-xlsx-harness.js` **142 ok** (was 133 —
**+9**, the final fix wave below), `node --check` OK on the SPA body (range **967–10074**,
re-derived) and `sw.js`, `node scripts/accom-export-harness.js` and `node
scripts/filter-persist-harness.js` both clean. `sw.js` `camp-v108`→**`camp-v109`**.

### 🔴 Final fix wave (same day, before deploy) — the reconciliation itself had two bugs
A whole-branch review (structurally invisible to the per-task reviews above, which each only see
one commit's diff) found the reconciliation block this branch added was **wrong in exactly the
two ways a reconciliation must never be wrong**: a false alarm on a correct export, and a real
failure that produced no alarm at all. Files touched: `public/index.html` (`exportBudget`),
`scripts/budget-xlsx-harness.js`, `debug.md`. **`src/**` untouched.**

- 🔴 **Finding A — the reconciliation false-positived on EVERY single-ministry export.**
  `fetched` read `window._budgetFetch.count` — the CAMP-WIDE population `RENDER.budget` sets
  ONCE and never re-scopes — while `printed` (via `rep.churches`, built from the SAME `scope`
  `exportBudget` passes to `computeBudgetClient`) correctly covered only the selected church.
  Reproduced: 5 people, 3 at Victory; scope=`all` → "Difference: 0, OK"; scope=Victory →
  "People fetched: 5", "People on 'By ministry': 3", "Difference: 2", plus the "Do not rely on
  the totals above" warning — on a completely correct export. This fired the first time anyone
  used the ministry dropdown, a normal pre-existing workflow, not an edge case. **Fixed by
  scoping `fetched` from the SAME source array** (`window._budgetRegs`), filtered with the
  **identical predicate** `computeBudgetClient` itself uses
  (`!scope||scope==='all'||r.churchId===scope`) — never re-derived any other way, or the two can
  drift apart again. The guarded degradation to `null` when `window._budgetFetch` is absent is
  unchanged.
- 🔴 **Finding B — an isolated `/campers` failure never reached the Summary sheet.**
  `window._budgetFetch.count` is computed from the **already-shrunk** `_budgetRegs` array (it is
  set AFTER the campers fetch fails), so a lone fetch failure gives `fetched === printed`,
  `diff === 0`, and the error text — gated on `if(diff)` — never rendered at all. The on-screen
  warnbox in `drawBudget` was never affected; this was only about the exported workbook. Fixed:
  the fetch-error line is now printed whenever `window._budgetFetch.error` is set, **independent
  of `diff`** — the two notes are different failures and can appear separately or together.
- 🔴 **Finding C — the debug.md symptom-router row for this was itself wrong**, in both
  directions: it said a short camper fetch alone could cause a non-zero Difference (false, per
  Finding B — it gives `diff===0`) and called a grouping bug "the" cause while never naming the
  actual dominant one (the scope dropdown, Finding A). Rewritten — see the 2026-09-06 row in
  `debug.md`'s symptom router.
- **Harness work, PROVEN to catch both regressions, not just assumed to:** `sel` is now
  configurable (`SEL_VALUES.budChurch`, was hardcoded `'all'`) and `computeBudgetClient`'s stub
  is scope-aware, so section 10 can exercise a genuinely single-ministry export. Reverting
  Finding A's fix (back to `fetched=window._budgetFetch.count`) fails all 3 of section 10's new
  checks (`fetched` reads camp-wide 19 instead of the scoped 15, `Difference` reads 4 instead of
  0, and the false "Do not rely" warning reappears). Reverting Finding B's fix (restoring the
  `if(diff)`-gated error text) fails section 11's "the fetch error is on the Summary sheet EVEN
  THOUGH Difference is 0" check. Both proofs restored to green afterward — **142 ok**.
- **`sw.js` stays at `camp-v109` — one bump covers this whole branch, and a second would be
  churn.** The standing rule is that `public/index.html` changing means `CACHE` must step, and it
  did: prod (`origin/master`) serves `camp-v108`, this branch ships `camp-v109`. **`v109` has
  never been deployed**, so the fix wave rides the same unreleased version — an installed PWA
  goes straight from `v108` to a `v109` that already contains it. Do NOT bump to `v110` before
  pushing; the rule is one step per DEPLOYED version, not one per commit.

### The harness had been silently dead for a month, straight through the 2026-09-03 release
`scripts/budget-xlsx-harness.js`'s `extract()` matched functions by their **full signature**, and
a `tag` parameter was appended to two of them on 2026-08-05 without the harness being re-run. It
threw on startup from that day forward — **ZERO checks ran for a month**, including through the
2026-09-03 cancel/refund release, which shipped with no harness coverage at all despite touching
the exact code this file exports. Fixed by matching on a **name prefix** instead of the full
signature, plus a sandbox guard that fails loudly (naming the missing symbol) if a function this
script depends on is ever renamed or absent — see the `['_budScopeRows', '_budExportRows', …]`
list in the script, which itself had to be updated when `_budExportRows` was added in Task 4.

### Untagged discount codes were invisible to the sponsorship ask — measured, not estimated
Only **5 of 19** discount codes in prod use are classified in `settings.discount_code_tags`
(`KH100`, `YC26YP`, `YC26EFT`, `YC26CASH`, `VICTORY50`). The other 14 were silently excluded from
`computeSponsorSummary`/`computeSponsorSummaryClient`, which only ever walked `sponsor`/`discount`
tags — an untagged code, however deep the discount on its invoices, contributed **nothing** to the
reported sponsorship gap.

| Code | People | $ gap | Discount |
|---|---|---|---|
| `YC26BNESPONSOR` | 30 | $5,700 | 100% |
| `ALIVE100` | 11 | $1,730 | 100% |
| `YC26ELEVATION` | 8 | $1,480 | 100% |
| `YC26STAFF` | 5 | $950 | 100% |
| `YSPINESPONSOR` | 3 | $530 | 100% |
| `YC26NORTHINTERN` + `YC26KHPARENTS` + `YC26REDINTERN` | 6 | $1,020 | 100% |
| `SWB100` | 1 | $190 | 100% |
| `YSNORTH50` | 9 | — | 50% |
| `VICTORYBNE100` | 5 | — | 47% |
| `YC26BNEINTERN` | 3 | — | 67% |
| `YC26CLASS` | 3 | — | 86% |
| `YC26CLASSFULL` | 1 | — | 90% |

**64 people / $11,600** on 100%-discount untagged codes, plus **21 more** on partially-discounted
untagged codes — **~85 people, ~$13,000** of sponsorship gap that never appeared anywhere on the
Budget screen or its export. Prod otherwise measured clean for the 2026-09-03 feature the harness
missed: **0 cancellations, 0 amount-paid overrides, exactly 1 refund** — so the cancel/refund
defects this branch also fixes were real bugs, just latent against prod's actual data.

> ⚠️ **REPORT, NEVER INFER.** `isUnclassifiedDiscount`/`_isUnclassifiedDiscount` detect an
> untagged code with real invoice evidence of a discount and report it — as a person, a dollar
> gap, and a named code on the Summary sheet's "Unclassified discount codes" block — and
> **exclude** its money from every total. **Do not map a discount percentage onto a tag** (e.g.
> "100% off → sponsor"). An untagged 100%-discount code can legitimately be a staff comp or a desk
> payment that was never meant to be a sponsorship ask; guessing would ask a real sponsor for
> money nobody owes. **The totals only move once a human classifies the code** on the Budget
> screen. This is the same doctrine as the pre-existing `discountTagConflict` check — report,
> don't correct.

### Sponsorship loop order — cancelled-gated, then unclassified, then tagged
`computeSponsorSummary` (server) and `computeSponsorSummaryClient` (SPA) both run, per person, in
this exact order: **(1)** skip a blank discount code; **(2)** resolve `tag` and `unclassified` and
derive `inAskPopulation = (tag is sponsor/discount) || unclassified`; **(3)** if
`status==='cancelled'`, count it into `withdrawnCount`/`withdrawnTotal` **only if** it was in the
ask population, then `continue`/`return` — a cancelled person on an `inperson` tag or a plain
untagged code with no discount evidence was never part of any ask and is skipped outright, not
counted as withdrawn; **(4)** if `unclassified`, accumulate into the unclassified bucket and
`continue`/`return`; **(5)** otherwise, if untagged or not a sponsor/discount tag, `continue`/
`return`; **(6)** accumulate into the tagged sponsor/discount bucket. Both implementations call
the **pre-refund** value (`receivedBeforeRefund` server-side, `_personValueBase` in the SPA) for
every gap calculation — **never** `personValue`/`_personValue`, which subtracts the refund. A
refund must not re-open a sponsorship gap the camp already chose to give back.

- ⚠️ **A cancellation is gated on being IN the ask population, not counted unconditionally.**
  This was a real bug found and fixed mid-branch (review round 1→2): a cancelled person on an
  untagged-but-discounted code was briefly falling through into `unclassifiedTotal` instead of
  `withdrawnCount`/`withdrawnTotal`. The cancelled check must run **first**, before the
  unclassified check, and must itself be scoped to `inAskPopulation`.
- Verified side-by-side, 2026-09-06: the two implementations are identical in order and
  condition. The one structural (non-semantic) difference is that the SPA precomputes `cls`/`tp`
  once per person before branching, while the server computes `classifyTicket`/
  `resolveTicketPrice` inline inside whichever branch needs them — both are pure functions of
  already-known inputs, so this changes nothing observable, only when a value already implied by
  the inputs gets computed.

### `_budExportRows` — export-only, deliberately a SECOND function
New in Task 4: export rows grouped by **(ticket class × discount code)**, with totality guaranteed
by construction (every person lands in exactly one bucket keyed by `cls+'\0'+code`, so Σ row
counts always equals the fetched population — see the reconciliation block below).

> ⚠️ **`_budExportRows` must NOT be merged with `_budScopeRows`.** The on-screen Budget card
> deliberately keeps `_budScopeRows`'s campers/leaders-merged rows (owner decision, 2026-08-02) —
> that shape answers "what did this ministry owe" for a director glancing at the screen. The
> export needs the finer (ticket class × code) grain to name which discount code sits behind each
> line. These are two different questions with two different correct shapes; DRYing them into one
> function would force one of the two screens to answer the wrong question.
- **OR-accumulate `unclassified` per row, never overwrite.** `isUnclassifiedDiscount` depends on
  the PERSON (`discountAmount`/`amountPaid`/`registrationCost`), not the code alone, so two people
  sharing one untagged code can disagree — found in review (2026-09-06): overwriting would let a
  classified member's `false` silently clear a genuinely-unclassified row. A false positive
  (over-reporting) is safe; a false negative here would print "Full price" on a row that actually
  holds a discounted, unreported person.

### `exportBudget` — 11 columns, a Summary reconciliation block, and a bug the harness itself found
New columns (`By ministry` sheet): **Church, Row type, Audience, Accommodation, Code used, Code
type, Number, Raw invoice value, Effective $ to budget per ticket, Effective $ to budget total,
Cancelled**. Summary gained a **reconciliation block** (people fetched from the app vs. people
printed on `By ministry`, with the difference stated loudly — "Do not rely on the totals above" —
rather than as a quiet number nobody checks) and an **unclassified-codes block** naming each
untagged code, its headcount and its excluded dollar gap. ⚠️ **As of the 2026-09-06 final fix
wave, "people fetched from the app" is SCOPED to whatever ministry `budChurch` has selected, the
same as "people printed"** — see Finding A above. A single-ministry export reconciling against
the camp-wide population was the exact bug that wave fixed.

> 🔴 **`_avgDiscountPct` was missing from the harness's own extraction list, and that silently
> broke the SECOND `exportBudget()` call in the same test run.** `exportBudget`'s own try/catch
> swallows every internal error into a toast (by design — a broken build must not crash the whole
> screen) — so the missing extraction turned into a silent `ReferenceError` inside the export,
> `_rlSaveBlob` never ran, and every downstream check kept reading the **FIRST** (untagged) run's
> stale blob. The checks still **passed**, against the wrong workbook. Found only because the
> failure mode was investigated rather than accepted. Fixed two ways: `_avgDiscountPct` added to
> the extraction list, and a new **`assertExportOk()`** called after every `await
> ctx.exportBudget()`, asserting the internal catch never fired (`!lastToast ||
> !/Could not build/.test(lastToast)`) — so a broken build now fails loudly, at the exact call
> that broke it, instead of producing confusing unrelated-looking diffs several hundred lines
> later.

> ⚠️ **Raw invoice value = `amountPaid` — the owner's explicit choice** (2026-09-05), taken
> *before* any override or refund. **Accepted trade-off: a sponsored row reads `$0.00` in BOTH the
> Raw invoice value AND the Effective $ columns** — a sponsor invoice genuinely settles at $0, so
> there is nothing to distinguish. The gap lives in the Sponsorship block, not on the row. Do not
> "fix" this by substituting `registrationCost` for a sponsored row's raw value — that would
> contradict the same owner ruling that makes `personValue`'s grand total read as MONEY RECEIVED,
> not the value of every place.
> ⚠️ **A row padded with bare `null` entries emits ONE cell, not eleven.** `_xlSheetXml` **skips**
> a bare `null` array entry entirely, while `_xc('', style)` emits a real styled `<c/>` blank —
> these look identical in the source array but are NOT identical in the emitted XML. Harness
> section **7a** asserts the **EMITTED width** of the sponsorship-heading, camp-total and header
> rows (11 cells each, counted in the unzipped XML), not just their source-array length — a
> regression here would otherwise silently narrow a styled row without any test noticing, because
> the source array can lie about what actually reaches the file.

### Task 6 — the camper fetch failure is recorded, not swallowed
`RENDER.budget`'s camper fetch used to `.catch(()=>[])` — a genuine fetch failure was
indistinguishable from "this camp has no leaders yet". It now records `window._budgetFetch =
{count, error}`, and the Summary sheet's reconciliation reads it. An on-card warnbox surfaces the
same failure on screen (unaffected by anything below).

⚠️ **Corrected 2026-09-06 (Finding B) — the error used to be folded INTO the "Difference"
explanation, gated on `if(diff)`, which meant it never printed at all for an isolated `/campers`
failure** (`window._budgetFetch.count` is computed from the already-shrunk `_budgetRegs` array,
so `fetched === printed` and `diff === 0` in exactly that case). It now prints on its own line
whenever `window._budgetFetch.error` is set, regardless of `diff` — see the final fix wave above.

### Real-Excel verification — done, with one honest caveat
`BUDGET_XLSX_OUT=C:/tmp/budget.xlsx node scripts/budget-xlsx-harness.js`, then opened over COM
automation (Excel installed on this machine). **Confirmed by reading the file back through
Excel itself, not assumed:** opened with **no repair prompt**; **11 columns** on `By ministry`
matching the spec exactly; header row bold with fill `0x1E1B4B` (`#1E1B4B`); church-total rows
(`Citipointe, Carindale`, `Grace Point`) bold with fill `#EDE9FE`; the camp total (`All
ministries`) bold, white text, fill `#4F46E5`; `FreezePanes=True`, `SplitRow=1`; `AutoFilterMode=
True` with range `$A$1:$K$8`, stopping **before** the blank spacer row and the sponsorship
heading, exactly as designed.

> ⚠️ **The Summary reconciliation did NOT read "Difference 0 OK" when dumped this way, and that
> is the harness's fixture, not a defect.** The harness's only `BUDGET_XLSX_OUT` write-out path
> reuses the same fixture that section 8 uses to prove the mismatch-detection path actually fires
> (20 people fetched vs. 19 printed → `Difference: 1`, with the "Do not rely on the totals above"
> warning) — there is no separate "clean" fixture wired to the env-var dump. The reconciliation
> **mechanism** is fully verified (both in the harness's exact-number checks and by reading the
> real cells back through Excel above); what was NOT verified in real Excel is the zero-difference
> rendering, because the one fixture available deliberately isn't zero. If a future session wants
> to eyeball "Difference 0 OK" in real Excel, it needs a second fixture or a temporary local edit
> to the harness's people array — not a claim that this was seen and wasn't.

## Import warnings are grouped and VISIBLE — `code` is an out-of-repo contract — `camp-v108` — 2026-09-04

Backend + SPA. **No schema or migration change** — next migration is still `0023`.
`npm run typecheck` clean, `npx vitest run` **1059 pass / 64 files** (was 1055/63; **+4**, **+1
file**), `node --check` OK on the SPA body (range **967–9859**, re-derived) and `sw.js`.
`sw.js` `camp-v107`→**`camp-v108`**.

### The screen had been throwing away every warning since the importers were written
All three import services have always returned `warnings: Array<{row, message}>`
(`import.service.ts:38`, `ticket-import.service.ts:42`, `invoice-import.service.ts:53`), and
`_renderImportPreview` rendered **only `r.errors`**. On a real 2026-09-02 run that silently
discarded **117 messages** (25 Form + 15 Ticket + 77 Invoice) — including the row-1 care-column
warning whose entire reason for existing (2026-08-04 (2d)) is to be *"visible in the dry-run
preview before anything is confirmed"*. It never was.

> ⚠️ **THE OWNER'S UPLOAD MACHINE POSTS TO THE API DIRECTLY AND WAS THE ONLY THING SEEING THESE.**
> A script on a separate PC posts the three CSVs to `/import/csv`, `/import/tickets`,
> `/import/invoices` and emails a per-file summary (`created=… errors=… warnings=…`). That is why
> the counts were known while the app showed nothing, and it is why the **response shape is a
> contract with a client that cannot be typechecked from this repo.**

### `ImportWarningCode` — add freely, NEVER rename
New `src/core/types/import-warning.ts`: `ImportWarning {row, message, code}`, the
`ImportWarningCode` union (**27 codes**), and `IMPORT_WARNING_META` (label + severity
`critical`/`review`/`info`) beside it, so adding a code without a label is a **type error**.
Every one of the 22 `warnings.push()` sites across the three services now supplies a `code`.
`message` stays free-text and may be reworded at will — **that is the whole point of the code**,
so nothing has to pattern-match the prose.

- ⚠️ **The three shared-invoice split outcomes get DISTINCT codes**
  (`shared-invoice-split-by-price` / `-residual` / `-equally`). Only `-equally` sets
  `needsReview`. The 2026-08-07 (2nd) entry turns entirely on being able to tell *"the split is
  too sensitive"* apart from *"why is this flagged"*, and until now nothing in the data could.
- **Adding a code is additive and safe for the script** — it reads `.length`. **Renaming one
  silently breaks its grouping**, with no error on either side. There is no test that can catch a
  rename (a test cannot know intent); the comment at the top of the file carries that rule.

### The guard test is source inspection, and it is proven to catch a regression
`src/services/import-warning-codes.test.ts` (4 tests) scrapes the three services: every
`warnings.push({…})` literal must contain a `code:` key, and every emitted code string must have
an `IMPORT_WARNING_META` entry. **Verified by reverting, not asserted:** deleting the `code:` line
from `ticket-import.service.ts`'s unknown-ticket-type warning fails the suite naming
`ticket-import.service.ts:163`.

- ⚠️ **The second scrape must strip `=== '…'` comparison operands first.** The invoice split
  assigns its code through a typed local, and the ternary's `split.method === 'ticket-price'`
  comparisons otherwise read as codes — the first version of this test failed on
  `'ticket-price'`/`'residual'`, which are split METHOD names, not warning codes.
- It also asserts `emitted.size >= 20`, so a regex that silently matches nothing cannot make the
  suite pass vacuously — the same too-weak-fixture failure as the `VAPID_ENV` `'pub'`/`'priv'`
  placeholders.

### SPA — collapsed, grouped by severity, and it must degrade rather than throw
`_warnGroupHtml(r)` + `IMPORT_WARN_LABELS` + `_warnMeta` render a `<details>` per file —
*"⚠ 77 warnings in 4 categories"* — containing one nested `<details>` per code
(*"70 · Matched by billing-contact name only"*), capped at `WARN_ROW_CAP` (25) rows per group.
Groups sort **critical → review → info**, then by count; the block auto-opens only when its worst
severity is `critical`. Wired into both the dry-run preview card and the post-confirm result, and
both now print a warnings count beside the errors count.

- ⚠️ **`IMPORT_WARN_LABELS` is a hand-kept DISPLAY MIRROR of `IMPORT_WARNING_META`, not a rule.**
  `public/index.html` has no build step so it cannot import the real one. An **unknown code
  degrades to a prettified version of the code string** rather than throwing or dropping the
  warning, so adding a server-side code without touching the SPA is safe — it just reads slightly
  worse. A 4th test flags any declared code missing a SPA label, as a nudge, not a correctness gate.
- This is deliberately **not** the fourth-copy-of-a-rule failure: the mirror carries labels and
  severities (presentation), never the decision about *when* a warning fires.

### Two things the numbers revealed, neither a bug
- **Invoice `updated` legitimately exceeds the file's row count** (481 rows → 560 updated). It
  counts distinct **people touched** (the `firstTouch` guard on the `touched` map), and one
  shared-invoice row touches several people — consistent with the measured 44 shared invoices over
  101 people.
- ⚠️ **AN UNMATCHED INVOICE IS INVISIBLE INSIDE THE APP, AND STILL IS.** It never creates a person
  (`Person.churchId` is non-nullable, the export has no church column), so it can carry no
  `needsReview` flag and cannot appear on the Data tab. `_confirmImport` counts it into the
  **"Review N flagged records"** button, which filters on `needsReview` — **so that portion of the
  count leads to a screen that cannot show it.** The same 1 unmatched invoice persisted across
  2026-09-01 and 09-02. It is now at least *named* in the preview (`invoice-unmatched`, severity
  `critical`), but reconciling it still has no in-app destination. Left as-is deliberately — the
  fix is a real screen, not a bigger warning.

## Override search-result buttons — `camp-v107` — 2026-09-04

The **Add** / **Change church** buttons in the three Data Import override cards' search results
were full-width. Cause is the trap already documented above `ovRow`: a bare `.btn` is
`display:block;width:100%`, and inside a `.rowsb` flex row that `width:100%` becomes the item's
**flex-basis**, so the button eats the row and wraps each name/church onto three lines on a phone.
Fix (the same one `ovRow`'s Undo button already carried): `class="btn ghost sm"` +
`style="flex:0 0 auto;min-width:…"` on the button, `style="flex:1;min-width:0"` on the text block.
Applied in `_renderOvSearch`, `_renderIndivSearch`, `_renderCrSearch`.

**Rule: every button placed inside a `.rowsb` must be `.btn … sm` with `flex:0 0 auto` (or carry
an explicit `width:auto`).** Grep `class="btn` near `rowsb` before adding a new one.

## Individual overrides, cancellations & refunds — migration `0022` — 2026-09-03

Five new nullable `people` columns land in migration **`0022`**: `accommodation_override`,
`amount_paid_override`, `refund_amount`, `refunded_at`, `cancelled_at`. **`0022` must be applied
to prod BEFORE this code pushes** — same standing rule as `0016`–`0021`: `supabase.people`'s
mapper reads these columns on every person save, so a person write fails until they exist.

**✅ APPLIED AND DEPLOYED (2026-09-04).** `0022` was applied to prod FIRST, then `master` pushed.
The MCP `apply_migration` recorded the history row as `20260903195203`, reconciled to `'0022'` per
the standing rule (collision guard returned 0 first); `schema_migrations` now reads `0001`–`0022`
contiguous, 22 rows against 22 files. All five columns verified `is_nullable=YES` with no default,
and 596 existing people were unchanged (every new column null). Deployed as `dpl_6K1HBT4E…`
(`source:"git"`, commit `cbbab80`, ready in 23s); prod `/ready` returned `db:ok` in 1ms and
`sw.js` serves `camp-v106`. **Two decisions were deliberately left open for the owner** — see
"Open decisions" at the end of this section.

### What was built
Two new **Data Import** cards (Individual accommodation override, and cancel/refund) let an
admin/director hand-correct a single registration without an importer touching it: force a
person's accommodation kind regardless of what the Ticket List/Invoice say, force their
amount-paid, or record a refund against them. A registration can also be **cancelled**
(`lifecycle:'cancelled'`) without being deleted. Backend budget maths (`src/services/budget.ts`)
and its SPA mirror (`public/index.html`) both learned to respect the two overrides and the refund;
the server API, the Form-import delete guard, and the Budget/accommodation/Data-Import screens
were all updated to keep cancelled people visible where their money or their room still matters.

### The mapper chokepoint and its raw carrier — read this before patching `accommodationKind`
`accommodationKind` on a mapped `Person` is the **EFFECTIVE** value — `toPerson` resolves it as
`accommodationOverride ?? accommodationKindRaw`. `accommodationKindRaw` is what `personColumns`
actually **persists**. **Anyone patching `accommodationKind` on a mapped person must set the raw
carrier too, or the edit silently does not persist** — the resolved value gets read back on the
next load exactly as before, because the importers' column never moved.

Four sites had this bug latent (all now fixed, all now set both fields together):
- `import.service.ts` — the Form import's create and update paths.
- `ticket-import.service.ts` — the Ticket List import.
- `allocation.service.ts` — the manual church-allocation path (`accommodationKindForChurch`).
- `person.service.ts`'s `update()` — the generic PATCH path (any hand-correction screen).

A future fifth site is not caught by the compiler — `accommodationKindRaw` is `?:` optional on
`Person`, so a plain `{ accommodationKind: x }` patch type-checks fine while doing nothing useful.

### Cancel does not change the budget — `includeCancelled` has THREE callers, not one
Cancelling a registration must not silently drop the person's money — both `isRegistrant` and
`isCamper` exclude `lifecycle:'cancelled'`, so without an escape hatch a cancelled person's value
would vanish from every screen that reads either view. `PersonService.listRegistrants`'s
`includeCancelled` option is that escape hatch, gated to director/admin (server-side) so a church
login can't widen its own scope with a query param. **Three callers pass it**: the Budget screen,
`RENDER.accom` (the accommodation export — a cancelled person's room/tent placement is still real
until they're actually moved out), and `_loadAllocation` (the Data Import screen, which needs to
keep showing a cancelled person's card so the cancel/refund UI can still reach them). Do not
document or assume this is a single-caller field — it was, and stopped being true partway through
this work; check `person.service.ts`'s own comment above `listRegistrants` before trusting a stale
description of it.

The **five budget-side SPA filters were deliberately relaxed** to keep counting a cancelled
person's money (via `includeCancelled=1` on the `/registrants` fetch) — the **ops-side filters
were deliberately NOT relaxed**, and still exclude cancelled people via `r.status!=='cancelled'`
at (grep-verified, 2026-09-03) `public/index.html:3341`, `:5169`, `:5244`, `:5335`, `:7767`. A
cancelled student must not appear on a live roster or an ops list; their money must not disappear
from a ledger. **These line numbers drift on every SPA edit — re-grep `status!=='cancelled'`
before trusting them; do not copy them forward on faith.**

### `atCamp` and `lifecycle` are orthogonal by design — the cancel transition is the ONE exception
The presence model (see "Presence model (P0)" below) treats `atCamp` and `lifecycle` as
independent on purpose. **The cancel transition deliberately breaks that rule, and this is the
single highest-value thing to understand about this feature:** `person.service.ts`'s `update()`
forces `atCamp:false` the instant `lifecycle` moves to `'cancelled'` (and clears `cancelledAt` on
the reverse transition). This is safe ONLY because `checkin.service.ts`, `checkin-warnings.ts` and
`dashboard.service.ts` all filter their rosters/counts on `atCamp` and **never read `lifecycle`
at all**. Without the forced flip, cancelling someone would leave them `atCamp:true` forever —
still on the live check-in roster, still counted in "still to check in", still showing as
physically present at camp days after the office cancelled their registration.

**Do not "fix" this back into pure orthogonality.** The predictable way this regresses: someone
reads the P0 invariant below, notices the cancel patch violates it, and "cleans it up" by removing
the forced `atCamp:false`. The visible consequence is silent and delayed — nothing breaks that
day, but the next check-in session puts a cancelled student back on the roster as if nothing had
happened, and nothing in `tsc`/`vitest` will catch it because both sides of that coupling are
already individually tested; only the interaction is fragile.

### The Form-import sweep guard, and the `ponytail:` note
The Form import deletes anyone absent from the uploaded CSV (the upload is authoritative) — a
cancelled registration or a hand-set override is exactly the kind of person who legitimately
stops appearing in a re-export, so `import.service.ts`'s `isProtected(p)` guard exempts anyone
with `lifecycle==='cancelled'` or a non-null `accommodationOverride`/`amountPaidOverride`/
`refundAmount` from the delete sweep. The `ponytail:` note beside it names the honest ceiling:
**these five columns living directly on `people` means this ONE guard is the only thing standing
between a re-import and losing an override outright.** A new delete path — another importer, a
manual purge, **`admin.service.ts`'s `reset()` and `newYear()`, both of which call
`personRepo.deleteAll()` unconditionally** — is not covered by this guard and would take every
override, refund and cancellation with it. This is disclosed, not hidden: the note already names
"a manual purge, the new-year rollover" as needing the same guard; say it here in plain terms too,
because `reset`/`newYear` are real, reachable admin operations, not hypothetical ones. If this
ever bites, the upgrade path is the `allocation_overrides` side-table pattern keyed on
`firstNameKey`/`lastNameKey`/`mobileKey` (`src/core/entities/allocation-override.ts:12-18`), which
survives a hard delete by construction — unlike a column on `people`.

`isProtected` also has a second, quieter dependency worth naming: it never tests `refundedAt`/
`cancelledAt` directly, only `lifecycle`/`refundAmount`/`accommodationOverride`/
`amountPaidOverride`. That's safe only because `person.service.ts`'s `update()` keeps the two
timestamp fields in lockstep with the fields the guard actually checks, in both directions. There
is no compiler or test enforcing that pairing — a future refactor to the cancel/refund patch in
`person.service.ts` could drift the timestamps out of sync with the fields this guard reads, and
the guard would keep compiling and keep passing its own tests while silently protecting the wrong
set of people. There is now a short comment at `isProtected` pointing back at this.

### Open decisions (deliberately NOT made during implementation)

Both were raised by the final whole-branch review and left for the owner rather than settled
autonomously. Neither blocks the deployed feature.

1. **A `church` login can reach the new override/cancel fields by direct API call.**
   `person.service.update` requires only `registrant:write`, which `church` holds, and
   `registrant.controller` handles `accommodationOverride`/`amountPaidOverride`/`refundAmount`/
   `status` on the same path as every other patchable field. No UI exposes this to a church
   account, but the API does. It is **consistent with the existing convention** on that endpoint —
   `amountPaid`, `needsReview` and `ticketNumber` are likewise only UI-gated for church logins —
   so tightening it is a deliberate change to an established pattern that could break live church
   workflows, not an obvious bug fix. It is nonetheless new reach over *money* fields. Options:
   gate these four behind `budget:manage`/`admin:manage` for non-owner-scoped actors, or accept
   the inherited convention explicitly. **No task review ever asked this question** — it surfaced
   only at the whole-branch pass.
2. **The accommodation export now lists cancelled people by full name and church** in a Summary
   appendix, on a sheet that was previously pure aggregate counts. That shape was chosen because
   un-filtering the allocation sheets would have moved live room/cohort/tent counts, which was
   forbidden. It is correct, but it is a first for that export and is privacy-adjacent, so it is
   flagged for explicit sign-off rather than assumed.

## Church previews see DAY 1 ONLY of the devotional — 2026-08-07 (3rd)

Owner request on launch eve. **SPA-only** — no backend, DTO, schema or migration change.
`npm run typecheck` clean, `npx vitest run` **1013 pass / 62 files** (unchanged — browser-only),
`node --check` OK on the SPA body (range **967–9558**, re-derived) and `sw.js`. `sw.js`
`camp-v96`→**`camp-v97`**. New `scripts/devotional-preview-harness.js` (**19 checks**).

### ⚠️ The existing day lock is INERT PRE-CAMP, which is the whole reason this was needed
`RENDER.devotional`'s original rule is `isCampToday && dy !== today` — it only bites when TODAY is
a camp day. Camp is 2026-09-28, so from the leaders' handout day a church login could tap
**"Preview at-camp view"** on the home screen (that card is shown in pre-camp to *all* roles) and
read **all four days** of devotional content weeks early. Day 1 is the only one meant to be
visible as a sample.

- New **`_devoDay1Only()`** — church role AND (`PREVIEW_MODE` || `ACCOUNT_PREVIEW`). Covers both
  preview kinds: the church's own at-camp preview and an admin previewing a church login (whose
  stated promise is "exactly as they see it").
- ⚠️ **`DEVO_DAY` is forced on EVERY render, not just when unset.** It is module-level and survives
  navigation, so a day picked before the preview was entered — or before the at-camp overlay was
  toggled on — would otherwise persist straight into the locked view.
- `selDevoDay` carries the same gate. The locked buttons already don't call it; this is
  belt-and-braces against a stale inline handler in an already-rendered screen.
- ⚠️ **Deliberately does NOT touch a real at-camp session** — there `isCampToday` already pins the
  view to today, which is stricter and correct — **nor any non-church role**. Harness cases 5–7
  pin all three no-regression paths.

> ⚠️ **CLIENT-SIDE BY NECESSITY, NOT BY OVERSIGHT — and NOT a privacy boundary.** `PREVIEW_MODE` is
> a purely client-side construct and the bearer token is the church's **real** token, so the server
> cannot distinguish a preview read of `/devotional/:day` from a genuine at-camp one. Proportionate
> because the content is a spoiler, not private data. **Do not "harden" this server-side** without
> first giving preview a real server-visible representation.

**`scripts/devotional-preview-harness.js`** runs the REAL extracted functions against stubs and
**self-extracts the block by its `/* ===== DEVOTIONAL ===== */` comment markers rather than a line
range** — the ranges quoted in this file have drifted repeatedly. **Proven to catch a regression,
not merely to pass:** replacing `_devoDay1Only`'s body with `return false` fails **8 of the 19**
checks.

## 86 stale "needs review" flags cleared — a DATA operation, no code change — 2026-08-07 (2nd)

Owner: *"the data import review is slightly too sensitive… if it calculates someone's amount from
an invoice and it matches a ticket price that has more than 15 entries, it's good."* **Measured
against prod first, and the premise no longer held: there was nothing left to loosen.** No code
change — no `invoice-split.ts`, no importer, no schema, no `sw.js` bump. One `UPDATE`.

### The flags were RESIDUE, not sensitivity — and the distinction is the whole entry

88 people were flagged. All 86 of the shared-invoice ones already held **correct** per-person
costs — every value exactly $150 or $190, including the mixed `190 + 190 + 150` family on invoice
`022439` that was the $176.67/$176.67/$176.66 case in the 2026-08-04 (4th) section. The camp has
exactly two prices (`Classroom Accommodation` $190 × 201, `EARLY BIRD | Tent Accomodation`
$150 × 113), and of the 86: **0 missing a ticket type, 0 missing a cost, 0 with an odd cost, 86/86
with a `confirmed` `accommodationKind`.**

> ⚠️ **A PRICED TICKET TYPE MEANS BRANCH 1 OF `resolveInvoiceSplit`, WHICH NEVER FLAGS.** So every
> one of those 86 would resolve clean on a re-import — they were the tail of the 2026-08-04 (2b)
> ordering bug, whose money was repaired while `needs_review` was not, exactly as `debug.md` says
> ("no code change rewrites stored data"). Camp-wide check: **44 shared invoices, 101 people, and
> all 44 have every person on a priced type.** There is no flagged split left that the current
> rules would flag.

**The proposed ">15 entries" threshold was therefore NOT built, deliberately.** With a two-price
catalogue where both prices have 100+ holders, it accepts no decomposition the current code
rejects and rejects none it accepts — dead code with a maintenance cost. ⚠️ It also **cannot** be
allowed to silence the one-tent-one-classroom case: both prices there are well-established, so a
popularity rule would accept an arbitrary one of the two assignments, which is the
reconciles-perfectly-but-wrong number that case exists to catch. If a third ticket type ever makes
the catalogue $150/$170/$190, revisit it as a *guard* ("distrust a lone decomposition leaning on a
thin-sample price"), never as "accept more".

### What was actually done
`update people set needs_review=false, needs_review_reason=null, updated_at=now() where
needs_review and needs_review_reason ilike '%split equally%'` → **86 rows.** No money column
touched. The 86 ids were captured before the write.

**2 flags remain and are legitimate, left alone on purpose** — one *Multiple active tickets (2)*
(ticket #31489) and one *Multiple invoices (2) — amounts were summed*. Those are the duplicate
detectors in `ticket-import.service.ts:235` / `invoice-import.service.ts:422`, not the split, and
they are the two rows genuinely worth a human look.

⚠️ **A bulk "mark all as reviewed" button was designed and NOT built** (owner's call, after the
measurement). Scope was to be the currently-filtered rows, gated `import:run` (admin + director),
sending explicit ids rather than a filter spec — *do not* re-implement the Data tab's filter
predicate server-side, that is the fourth-copy-of-a-rule failure. Revisit only if another batch
of flags ever appears; single flags are fine through the existing per-row modal.

### The four things that set the flag (nobody could find this list before)
`ticket-import.service.ts:288` unmatched ticket row → flagged orphan · `:235` 2+ active tickets ·
`invoice-import.service.ts:422` 2+ invoices · `:526` unresolvable shared invoice. **Only the last
is the auto-split** — the other three flag no matter how clean the numbers are, which is why "the
split is too sensitive" and "why is this flagged" are usually different questions.

## 🔴 Supabase Pro + the connection sizing that actually mattered — 2026-08-07

**Infrastructure + a one-line code change**, no schema/migration. `npm run typecheck` clean,
`npx vitest run` **1013 pass / 62 files** (unchanged — config, not logic). No `sw.js` bump
(backend only). Commit `4dfac4a`. Full numbers + the go/no-go table live in
**`docs/SESSION-MODE-CUTOVER.md`** ("WINDOW 2, PART ONE"); the standing reference is the
**"session-mode cutover + connection sizing"** block further down this file. This section is the
*why*.

| | Before | After |
|---|---|---|
| Plan / compute | Free / Nano | **Pro / Micro** |
| `max_connections` | 60 | **60 (UNCHANGED)** |
| Supavisor Pool Size | 15 | **30** |
| App pool `max` (`client.ts`) | 5 | **3** |
| **Vercel instances served at once** | **3** | **10** |

### 🔴 Two things here are counter-intuitive and both cost real capacity if forgotten

**1. UPGRADING THE PLAN BUYS NO CONNECTIONS.** `max_connections` scales with **compute**, and
**Micro is 60 — identical to the free Nano.** Only Small (90) and above move it. Pro bought
daily backups, no auto-pause and PITR eligibility. Measured before *and* after the upgrade: 60
both times. ⚠️ `SESSION-MODE-CUTOVER.md` step 6 says "read `max_connections` on the paid
config" — followed literally it reads 60, **looks like the gate passed, and proves nothing.**

**2. THE BINDING CONSTRAINT WAS NEVER `max_connections` — IT WAS THE SUPAVISOR POOL SIZE.**
Prod is on the **session-mode** pooler, where a connection holds a dedicated Postgres backend
for its whole life instead of being multiplexed. So:

```
concurrent Vercel instances served  =  Supavisor pool size / client.ts max
```

At the untouched defaults (**15 / 5**) that was **THREE INSTANCES** — against a 100–200-leader
AM check-in burst. The 4th instance onward would have **queued**, and queuing at check-in is
indistinguishable from an outage to a leader holding a phone. This was live and unnoticed for
the entire life of the deployment; `max_connections` (60, never close to exhausted) would never
have revealed it, because Supavisor caps the backends long before Postgres does.

⚠️ **The two numbers are HALF OF A PAIR, in two different systems** — one in the Supabase
dashboard, one in this repo. Changing either alone silently moves the ceiling and nothing in
CI, `tsc` or `vitest` will catch it. **Redo the arithmetic and change both together.**

### Why `max: 3` and not lower

Queries here run **2–40ms** (a live `/ready` probe measured 21ms cold, 2–3ms warm), so
per-instance parallelism was never the constraint — **connection slots were**. CMS ran healthy
on `max: 2`. ⚠️ **Never `max: 1`**: it caused head-of-line blocking in CMS, where one slow query
held the ONLY connection and froze every request on that instance, **including login**.

### Operational lessons worth keeping

- ⚠️ **Set compute size FIRST, then pool size** — a resize can reset the pool to the new default,
  so setting the pool first risks silently losing it.
- **`statement_timeout = 15s` on role `postgres` survived BOTH the plan upgrade and the compute
  restart** — verified, not assumed. Still re-check it after any future resize; it is a role
  config, not a migration, and would be lost if the project were ever recreated.
- **A compute resize is ~2 minutes of hard downtime.** During it the DB refuses connections
  outright (an MCP query returned *"Connection terminated due to connection timeout"*). Do
  resizes in a deliberate window — this is exactly why the sizing was settled before the church
  handout rather than in September.
- **`/ready` is the fastest recovery signal after a resize** — poll it until `db:"ok"` returns
  rather than guessing. It is what confirmed recovery here.

### Still outstanding — the burst load test
`SESSION-MODE-CUTOVER.md` step 8, deliberately deferred to **~mid-September**. Owner's decision
2026-08-07: **run the leaders' day on Micro + 30/3, reassess then.** ⚠️ If that test wants more
headroom the move is **Small + pool 50**, *not* a smaller `client.ts max` — 3 is the floor worth
having. 30 backends + ~15 used by Supabase's own services already sits near the practical
ceiling of Micro's 57 usable.

## 48h sessions + a session KILL SWITCH, church-only password reset, `/ready`, throttle 10→15 — 2026-08-05 (2nd)

Pre-launch batch. The churches get their passwords on **Sat 2026-08-08** (~100 leaders log in
and browse; camp itself is 2026-09-28). Backend + SPA + **migration `0021`**. `npm run
typecheck` clean, `npx vitest run` **1013 pass / 62 files** (was 990/61; **+23**, **+1 file**).
`node --check` OK on the SPA body (range **967–9518**, re-derived) and `sw.js`. `sw.js`
`camp-v92`→**`camp-v93`**. Built by three parallel Sonnet subagents on disjoint file sets
(auth / accounts+http / SPA), each verified independently afterwards.

> ⚠️ **DEPLOY ORDER IS NOT FREE CHOICE. Apply `0021` to prod BEFORE pushing the code.**
> `supabase.settings` writes **every column on every save**, so until the columns exist every
> settings save, mode switch and new-year **fails in prod**. Same standing rule as `0015`–`0020`.

### 1 — 🔴 LOCKING A ROLE DIDN'T LOG ANYONE OUT, AND THE TTL DOUBLING MADE THAT WORSE

`churchLoginLocked` / `zoneLeaderLoginLocked` only ever blocked **new logins** — the comment
block in `auth.service.ts` said so outright. Sessions are stateless HMAC (`signSession`) with no
revocation, so an admin who locked the churches after camp left **every leader already holding a
token signed in until it expired** — a live session into minors' PII after the admin believes
it is closed. Doubling the TTL to 48h doubles that window, which is why the two ship together
and must not be separated.

- **`TOKEN_TTL_MS` 24h → 48h.** *Why:* leaders run this as an **installed PWA on iPhones**, and
  iOS AutoFill is unreliable inside the installed app (it works in Safari). Every expiry means
  hand-typing a password on a phone at camp.
- **`issuedAt` (epoch ms) now travels in the signed payload** (`signSession`/`parseSession`).
- **Two nullable ISO columns on `CampSettings`** — `churchSessionsValidFrom`,
  `zoneLeaderSessionsValidFrom` (migration `0021`). `resolveToken` revokes a `church`/`zoneLeader`
  token whose `issuedAt` predates the matching epoch.
- ⚠️ **PER-ROLE, NOT ONE GLOBAL EPOCH.** A global epoch would sign the **admin** out at the
  exact moment they lock the churches — i.e. the one action that most needs an admin still
  logged in. Per-role mirrors the existing per-role toggles and leaves admin/director/firstAid
  unaffected **by construction** (there is no epoch field for them to read).
- **Wired to the existing toggle, no new admin control.** `settings.service.update()` stamps the
  epoch on a **false→true transition only**.
  - ⚠️ **Turning the lock back OFF must NOT clear the stamp.** A fresh login mints a newer
    `issuedAt` and works fine; old tokens stay dead. Clearing it would resurrect them.
  - ⚠️ **A redundant true→true save must NOT re-stamp** (found by the subagent, not in the
    spec). Otherwise an admin renaming the camp minutes after locking the churches would kill a
    session that logged in one second earlier. There is a test pinning this.

### 1b — The cost is bounded to 60s, and it FAILS OPEN on purpose

`resolveToken` did **zero I/O** and that was deliberate. It still does for every role except
church/zoneLeader — `isSessionRevoked` returns `false` immediately for anyone else. When it does
read settings it goes through `response-cache.ts` at a **60s** TTL, so lock-to-logout latency is
up to 60s (owner-accepted).

- ⚠️ **A SETTINGS-READ FAILURE ALLOWS THE REQUEST.** A transient DB blip must never lock the
  whole camp out mid-check-in. The failure direction is deliberate — do not "harden" it to deny.
- ⚠️ **The failure is deliberately NOT cached**, so the next call retries rather than pinning
  "nothing is revoked" for a full 60s on one transient error.
- ⚠️ **The cache is instance-scoped (inside `makeAuthService`), not module-scoped.** Module scope
  leaks one test's settings fixture into the next test in the same process and makes the
  revocation tests non-deterministic.
- **Legacy tokens** (minted before `issuedAt` existed): **missing `issuedAt` + epoch set →
  REVOKE**. At deploy no epoch is set, so nothing breaks; the rule only bites once a role is
  actually locked, which is the intent.
- `makeAuthService(users, settings?)` takes settings **optionally** (many unit tests build it
  without one) — undefined is treated as "no epoch on record". **Both real composition paths
  (`container.ts:212` and `:367`) pass it**, verified; if a third is ever added and forgets, the
  kill switch silently does nothing.

### 2 — A CHURCH-ONLY "randomise & export", beside the existing all-accounts one

Since 2026-08-03 the one button rotated church logins **and** all leadership accounts
(director/zoneLeader/firstAid/secondary admins, never the original admin). The owner needs to
re-issue **church** passwords after Saturday without invalidating the leadership logins.

- New `randomizeChurchOnlyPasswords(actor)` (`admin:manage`), route
  **`POST /accounts/churches/randomize-church-passwords`**, same `ChurchCredential[]` shape.
- ⚠️ **REFACTORED, NOT COPY-PASTED.** The church loop is now the single private
  **`rotateChurchLogins()`** (`account.service.ts:248`); `randomizeChurchPasswords` calls it and
  then adds the leadership loop. Two divergent copies of credential rotation is exactly how the
  wrong accounts get rotated.
- The load-bearing test asserts every **non-church password hash is byte-identical before and
  after**, and that no leadership row leaks into the CSV. A test that only checked the returned
  rows would pass while silently rotating passwords.
- SPA: one shared **`_pwRandomiseExport(endpoint, filenamePrefix, noneMsg, toastVerb)`** backs
  both buttons — do not write a second exporter. Church-only downloads as
  `church-passwords-<date>.csv` vs `camp-passwords-<date>.csv` so they don't collide in
  Downloads. (The upload path matches on the **`Username` column, not the filename**, so both
  round-trip.)
- ⚠️ **FIFTH BRUSH WITH THE FLEX BUG — the row now has THREE buttons.** `.btn` is
  `display:block;width:100%`, which becomes the flex-basis. The row is `flex-wrap:wrap`, the two
  randomise buttons are `flex:1;min-width:150px`, Upload stays `flex:0 0 auto;width:auto;
  min-width:92px`. Previously fixed 2026-07-08, twice on 2026-08-02, and 2026-08-05.

### 3 — `GET /ready` — because `/health` stays GREEN through a total DB outage

`/health` returns `{status:'ok'}` **without touching the database**. It is a liveness probe, so
an uptime monitor pointed at it reports healthy while every screen 503s — the exact failure it
looks like it is watching for.

- New **`GET /ready`**: `select 1` via the existing `getSqlClient()` singleton, raced against a
  **5s `READY_DB_TIMEOUT_MS`** (well under `maxDuration:30` and the role-level 15s
  `statement_timeout`), so a hung pooler fails fast instead of hanging the monitor.
- **200 `{status:'ready',db:'ok',ms}` / 503 `{status:'degraded',db:'error'}`.** The **status
  code** is the contract — monitors alert on non-2xx.
- ⚠️ **Unauthenticated on purpose** (a monitor can't log in) and the body **never** carries a
  connection string, hostname or driver error — that detail goes to `logger` only.
- `PERSISTENCE !== 'supabase'` returns `{status:'ready',db:'n/a'}` — honest, not a fake pass:
  there is no DB to check.
- ⚠️ **Do NOT add a DB check to `/health`.** The pair is the point. **An external monitor must
  be repointed at `/ready` to actually catch a pooler outage.**

### 4 — Login throttle 10 → 15 failures (owner)

`express-adapter.ts`. **A church login is SHARED by several leaders**, so the ip+username bucket
is not one person's typos — it is the whole church's, and on a church/camp WiFi they share the
IP too. At 10, a handful of leaders fumbling the handed-out password locked their **entire
church** out for 15 minutes on the very day the passwords go out. 15 keeps a real brute-force
backstop (keyspace ~117k since 2026-07-31) while absorbing normal fumbling. Window and
failures-only keying unchanged.

### 5 — ~~iOS: tell people about the 🔑 key~~ — SHIPPED THEN REMOVED THE NEXT DAY (`camp-v95`)

iOS 18 **does** support AutoFill in an installed web app, but the saved credential sits behind
the key (🔑) button in the QuickType bar rather than being offered prominently as in Safari — so
leaders hand-type. `_loginTips()` gained one line when `_isIOS() && _isStandalone()`.

⚠️ **Removed 2026-08-06 at the owner's request: it was one line of small print too many.** The
login screen is back to its two links. **The PREMISE IS STILL TRUE and still worth knowing** when
someone reports "AutoFill doesn't work in the installed app" — it just doesn't belong on the
login screen, where a third line competed with the two links that actually go somewhere. If it
is ever needed again, put it in `/save-password.html`, not `_loginTips()`. A `DON'T RE-ADD`
comment sits at the removal site.

Still true and load-bearing for whatever *does* live in `_loginTips()`: `_isIOS`/`_isStandalone`
are declared *after* it runs but **hoist** (function declarations) and both self-wrap in
try/catch — **don't "fix" that by moving things.** The UA gate (phones only) and the
can't-throw-on-the-login-gate property must both be preserved. Both helpers remain in use by the
push card, so neither is dead code. `#mcpGate` deliberately untouched throughout.

### 6 — "Send a test" is admin-only (follow-up push, `camp-v94`)

The push card on the Notices screen showed **Send a test** to every account with alerts on. It
was clutter for the ~100 church/leader logins. Now gated on `ACTOR.role === 'admin'`.

- ⚠️ **UI-ONLY HIDE — `POST /push/test` stays open to any authenticated account, deliberately.**
  `sendTestToUser(actor.id, …)` only ever pushes to the **caller's own** devices, so there is
  nothing to escalate and no security reason to lock the route. Read the 2026-07-31 push section
  before "hardening" it: the route exists so a device can be *proven working*, and an admin
  diagnosing a leader's phone may still want it reachable.
- **Trade-off accepted by the owner:** a leader can no longer self-test that alerts reach their
  phone — that diagnosis now goes through an admin. Zero cost at the time of the change
  (`push_subscriptions` was empty), but it will matter once leaders opt in at the training day.

### Needs on-device eyeballing (tsc/vitest cannot prove any of it)
The **three-button** password row at ~360px · an end-to-end run of the church-only button
against the live endpoint · the login screen back at **two** tip lines (`camp-v95`).

### Verified live in prod after the push
`sw.js` served `camp-v93`; **`GET /ready` → `200 {"status":"ready","db":"ok","ms":2}`** — first
end-to-end proof the readiness probe reaches Postgres through the session-mode pooler from
`syd1`. Migration `0021` applied to prod **before** the code push, and its history row
reconciled from the generated `20260805100813` back to **`0021`** (the N6 label drift), so prod
now reads a clean `0001`–`0021`.

**An external uptime monitor is live against `/ready` as of 2026-08-05** (owner). ⚠️ Keep it
pointed there, **never at `/health`** — `/health` never touches the DB and stays 200 through a
total pooler outage, which is the whole reason `/ready` exists.

## 🔴 Sponsor/discount tags were silently ignored on anyone missing an accommodation kind — 2026-08-05

Found by an independent feature review of the budgeting/costing code (asked to look specifically
for false positives/negatives), not owner-reported — the effect had been live since the
2026-07-29 ticket-classification rewrite. Backend (`src/services/budget.ts`) + SPA mirror
(`public/index.html`). **No schema or migration change.** `npm run typecheck` clean, `npx vitest
run` **990 pass / 61 files** (was 981/61; **+9**), `node --check` OK on the SPA body (range
**966–9497**, re-derived) and `sw.js`. `sw.js` `camp-v91`→**`camp-v92`**.

### The bug: `classifyTicket` decided BOTH the display bucket AND whether the tag applied at all
`classifyTicket` returned `'unknown'` the instant `accommodationKind` wasn't exactly `'tent'` or
`'classroom'` — **before it ever looked at the discount code's tag.** `accommodationKind` is owned
by the Ticket List import, a separate CSV from Invoice; a registrant who has been through Form +
Invoice but not yet matched to a Ticket List row (a straggler, an admin-added student, someone
absent from that export) sits with `accommodationKind: null` for as long as that gap lasts, no
matter how confidently their discount code has been tagged `sponsor` on the Budget screen.

> ⚠️ **THIS WAS TWO BUGS WEARING ONE CAUSE, IN OPPOSITE DIRECTIONS.** `personValue` only forced
> the sponsor $0 when `cls` was literally `'tent-sponsor'`/`'classroom-sponsor'` — which requires
> `accommodationKind` to be known — so for an unknown-kind sponsor case it fell through to
> `registrationCost` instead:
> - **Grand total: FALSE POSITIVE.** Their full ticket price was counted as money received, even
>   though a sponsor code means nothing arrived. The total read higher than the camp actually holds.
> - **Sponsorship card: FALSE NEGATIVE.** The same fallback fed into `sponsorAmountFor`'s "received"
>   figure, computing `ask = ticketValue − received = 0`. A genuine outstanding sponsorship ask
>   vanished from the fundraising total with no warning — worse than the grand-total error, because
>   there was no flag at all pointing at it (the person still shows under "Accommodation not
>   recorded" ⚠️, but that flag says nothing about the sponsorship figure also being wrong).

### The fix: the tag is resolved independently of the display bucket
New **`discountTagFor(p, tags)`** / SPA **`_discountTagFor(p,tags)`** — the code lookup extracted
out of `classifyTicket`, callable regardless of `accommodationKind`. `classifyTicket` still returns
`'unknown'` when the kind is unrecorded (that part was correct — we genuinely don't know tent vs
classroom, so there is no `unknown-sponsor` row), but `personValue`/`_personValue` and
`sponsorAmountFor`/`_sponsorAmountFor` now take the **tag itself** as an explicit parameter and
check it directly: `cls === 'tent-sponsor' || cls === 'classroom-sponsor' || tag === 'sponsor'`.

- ⚠️ **`discount` and `inperson` do NOT need the same forcing rule.** `discount` never zeroed
  anything to begin with (it just changes the bucket label; the value cascade — amountPaid →
  registrationCost — was always correct regardless of `cls`). `inperson` still requires a known
  `accommodationKind` to pick between `prices.tent`/`prices.classroom`, and falling through to
  `amountPaid`/`registrationCost` when that's unknown is the existing, deliberate, documented
  behaviour ("falls through rather than inventing a number") — **only `sponsor` was actually broken.**
- **Every call site now passes the tag through**, not just `cls`: `computeBudget`'s scope loop,
  `computeSponsorSummary`'s loop (which already had the tag in scope — it's how it found the code
  in the first place, so this is never a re-derivation), and the SPA mirrors
  `_budScopeRows`/`computeBudgetClient`/`computeSponsorSummaryClient`/`_budUpgrades`.
- **9 new tests** — `budget.test.ts` (`discountTagFor`, `personValue` with `cls:'unknown'` +
  each tag, a `computeBudget` invariant case) + `budget.sponsor.test.ts` (a $190 sponsor case with
  `accommodationKind: null` asserting the ask is still $190, and the matching `computeBudget` call
  reading $0 received). None of the existing 981 tests needed a fixture change — `tag` is an
  optional trailing parameter, so every prior 4-argument call site was already correct.

### If a budget/sponsorship figure still looks off after this
Check whether the person in question actually has a Ticket List row (`accommodationKind` non-null)
— this fix only restores the sponsor $0 rule for the *unrecorded-accommodation* case; it does not
change anything for a person whose accommodation is already known and correctly bucketed. Compare
against `git log` for `481bd33` if the fix's presence in the running build is ever in doubt (bumped
`sw.js` to `camp-v92`, same convention as every other SPA-touching push).

## Password UPLOAD — the reverse of the credentials export — 2026-08-05

Owner request: *"a small button to the right of it for 'upload' that does the exact reverse (sets
the passwords for account names found that match)"*, with resilience for blank passwords and for
a file covering only a subset of churches. Backend + SPA. **No schema or migration change** —
next migration is still `0021`. `npm run typecheck` clean, `npx vitest run` **981 pass / 61 files**
(was 950/60; **+31**, and **+1 FILE** — a new test file), `node --check` OK on the SPA body
(range **966–9477**, re-derived) and `sw.js`. `sw.js` `camp-v90`→**`camp-v91`**.
Built by two parallel Sonnet subagents (backend / SPA — disjoint files), then independently
reviewed by a third, which found the race in "The dry run is not a nicety" below.

Export the credentials CSV, edit the Password column, upload it back. Same card, same columns,
so the round trip is exact. Reads `.xlsx` too, free, via the existing `_readImportFile`.

### The decision logic is a PURE module, and that is the point
New **`src/services/password-import.ts`** — `parsePasswordRows` / `planPasswordImport` /
`missingPasswordColumns` / `PASSWORD_IMPORT_COLUMNS` / `MIN_IMPORT_PASSWORD_LENGTH`. No repo, no
hashing, no clock. `account.service.importPasswords` only does the three things a pure function
cannot: read the users, hash, save.

> **Almost every rule in this feature is a FAILURE path** — a blank cell, an unknown username, a
> half-filled sheet, the same login listed twice. Those are exactly the cases nobody exercises by
> hand before camp, so they had to be testable without fixtures. 19 tests on the planner, 6 on the
> service.

### The rules, and why each one is what it is
- ⚠️ **A BLANK PASSWORD CELL SKIPS THE ROW. It must NEVER clear a password.** The natural way to
  say "don't change this one" in a spreadsheet is to empty the cell, and the natural (wrong)
  reading of that is "set it to nothing" — which would lock a church out with no error at all.
  `parsePasswordRows` deliberately KEEPS a username-with-no-password row so the planner can count
  it as a deliberate skip rather than silently losing it.
- **Accounts absent from the file are untouched by construction** — they are simply never in
  `plan.apply`. That is what makes a one-church or a few-leaders list safe, and it needs no
  special case.
- ⚠️ **Matching is the `Username` column ONLY, lowercased.** Usernames are stored lowercased and
  unique, so it is exact. **Do not add a church/gender fallback** — a church-name typo would then
  set the *wrong account's* password, and it would reconcile perfectly to whoever read the sheet.
  An unrecognised username is reported by name, never guessed at.
- ⚠️ **The original admin is refused even when listed** (`findOriginalAdmin`), same reasoning as
  `randomizeChurchPasswords`: it is the recovery account, and a typo there is how a camp ends up
  with no way into the back office at all.
- ⚠️ **INACTIVE ACCOUNTS ARE SET — deliberately, and this DIFFERS from
  `randomizeChurchPasswords`, which skips them.** The owner chose it explicitly. The two are not
  inconsistent: randomise *distributes* a CSV, and putting a working credential for a deactivated
  login into a distributed file is the opposite of deactivating it; this direction *consumes* a
  curated file, where pre-staging an account you are about to reactivate is a real thing to want.
  Every inactive username is reported back — "set, but the account is deactivated and still cannot
  log in" — because a password that works on a login that doesn't is otherwise a silent trap.
- ⚠️ **A missing `Username`/`Password` column is a HARD ERROR naming the columns actually found.**
  `field()` returns `''` both for an empty column and for one it cannot find, so without this the
  wrong file parses as "every row blank" and the import reports a clean, successful, entirely
  empty run. Same silent-success shape as the renamed care column (2026-08-04) and the
  double-encoded snapshot. `missingColumns()` is reused, so ordinary case/spacing drift still
  does not trip it.
- **Same username twice with DIFFERENT passwords → both rejected**, named. Picking one would set a
  password the admin cannot predict. An identical duplicate is a copy-paste and applies once.
- **Under 6 chars → that row rejected, every other row still applies** (matches
  `SetPasswordSchema`'s `z.string().min(6)`; keep the two in step).
- **`mustChangePassword: false`**, matching the randomise path. These ARE the real passwords the
  admin chose and is handing out, not admin-set temporaries.
- ⚠️ **No plaintext password is ever in the response.** `PasswordImportResult` carries counts and
  usernames only. The request already carried them; echoing them into a response a browser caches
  and logs widens the exposure for free. There is a test asserting the password string appears
  nowhere in the serialised result.

### The dry run is not a nicety
`POST /accounts/passwords/import {csvData, dryRun}` (`admin:manage`). The SPA previews first, then
confirms.

> **The two mistakes this feature invites are both SILENT: a mistyped username sets nothing, and
> the wrong file entirely matches nothing.** Without a preview both are indistinguishable from
> success. When `willSet` is 0 the preview says so in a warnbox and **renders no Confirm button
> at all** — a button that would "succeed" at doing nothing is worse than none.

Every skipped row is **named, not just counted**. "3 not matched" sends an admin back to a 30-row
spreadsheet with no idea which three, which is how a genuinely wrong file gets confirmed anyway.
`dryRun` runs the identical code path and stops before the writes, so the preview cannot disagree
with what the confirm then does **on the server**. The client was a different story:

> ⚠️ **THE PREVIEW AND THE CONFIRM COULD DESCRIBE DIFFERENT FILES — found in independent review,
> fixed same day.** `_pwUpCsv` was armed synchronously after the file read but the box was
> painted after the *network* await, so two overlapping uploads could split them: pick a file,
> realise mid-request it is the wrong one, tap Upload again and pick another; if the FIRST
> request's response lands last it repaints the box with the OLD file's preview and filename
> while the confirm button holds the NEW file's text. You would then confirm a file you never
> reviewed — on the one screen in the app that rewrites credentials, and the preview is this
> feature's entire safety net.
>
> Fixed with `_pwUpSeq`: bump on entry, blank `_pwUpCsv` immediately (a superseded upload must
> never leave a live confirm behind), and bail after **every** await if another upload started.
> **The armed text is assigned last, beside the paint** — that pairing is the actual fix; the
> sequence alone would not guarantee it. `_pwUpConfirm` likewise **captures the csv and the
> sequence BEFORE awaiting `confirmSheet`**, or a new upload started while that sheet is open
> would blank it (posting nothing) or replace it (posting a file the confirmation never
> described). **Do not "simplify" either half back into a bare module variable read after an
> await.**

### The parser and the column guard must accept the SAME headers
Also from the review: `parsePasswordRows` accepted a `Login` column that `missingPasswordColumns`
knew nothing about, so a `Login,Password` file was **rejected up front with a message claiming
`Username` was missing** while the parser would have read it perfectly. Resolved by DELETING the
speculative aliases rather than teaching the guard about them — `field()` already normalises, so
the single `'Username'` alias resolves `User name` / `USERNAME` / `user_name`, exactly matching
what `missingColumns()` accepts. ⚠️ **Add an alias to BOTH or NEITHER**: a guard stricter than the
parser rejects good files, a guard looser than it lets a silently-empty run through. There is a
`describe` block asserting the two agree across five header spellings and disagree on none.

### Round-trip test — the one that proves the feature works
`describe('round trip from the real credentials export')` rebuilds the exporter's output
byte-for-byte (BOM + CRLF + quoted fields, including a church name containing a comma) and feeds
it back through the real parser. Its value is **pinning the column names and quoting across the
two sides** — rename a column on either end and this fails instead of the feature silently
no-opping. ⚠️ It does *not* prove BOM handling: that is double-covered anyway (`parseCsv` strips
the BOM **and** `field()`/`missingColumns()` normalise it away), so removing either one alone
would not fail a test.

### SPA
`uploadPasswords` / `_pwUpPreview` / `_pwUpNote` / `_pwUpConfirm` / `_pwUpCsv`, immediately after
`randomizeChurchPasswords`. The button sits in a flex row beside it.

- ⚠️ **FOURTH OCCURRENCE OF THE SAME FLEX BUG, pre-empted this time.** `.btn`'s base CSS is
  `display:block;width:100%`, and inside a flex row that `width:100%` becomes the **flex-basis**,
  so a bare `.btn` claims the row and squeezes its sibling to nothing. The Upload button is
  `btn ghost sm` + `flex:0 0 auto;width:auto;min-width:92px`, and Randomise is `flex:1;min-width:0`.
  Previously fixed 2026-07-08 and twice on 2026-08-02.

## Medical consent on the profile + the budget export is a styled workbook — 2026-08-04 (5th)

Two owner items. **SPA-only** (`public/index.html`) — no backend, DTO, schema or migration change.
`npm run typecheck` clean, `npx vitest run` **950 pass / 60 files** (unchanged — both changes are
browser-only), `node --check` OK on the SPA body (range **966–9361**, re-derived) and `sw.js`.
`sw.js` `camp-v88`→**`camp-v90`** (v89 the two items, v90 the owner's layout corrections in 2b).
`scripts/budget-csv-harness.js` is **replaced** by `scripts/budget-xlsx-harness.js` (**98 checks**);
the accom-export and filter-persist harnesses pass.

### 1 — Medical consent is back on the student profile, for the church that brought them
Owner: *"medical consent status should be visible to the church they attend when their profile is
opened up by their church's leader."*

It had been there and **AC-6 removed the whole consents line**, which left `firstAid` as the only
role that could see it. But the church leader is the person who physically takes a student to a
doctor, and the one who has to ring a parent first when consent is missing — reading it should not
require a first-aid login. New **`_medConsentRow(p)`**, rendered on **both** profile screens:
`_paintPerson` (pre-camp `/registrants`) and `openCamper` (at-camp `/campers`).

- **No new data crosses the wire and no scope widened.** `consentMedical` was already on
  `RegistrantDto` **and** `CamperDto` — it was being sent and thrown away. Both single-person
  fetches are gated by `canAccessPerson`, so a church still sees only its own students, and a
  redacted cross-church search hit still cannot be drilled into.
- ⚠️ **STUDENTS ONLY** (`isL?'':…`, matching the Medical/Dietary/Parent rows it sits with). The
  Elvanto field is *"I give medical consent for my child as listed above"* — a parent answering
  about a minor. A leader consents for themselves, so a red **Not granted** pill against a leader
  would be a pure false alarm.
- **Not-granted also prints a one-line instruction**, not just a pill: *"contact the
  parent/guardian before any treatment."* A leader who has never hit this state should not have to
  infer what the absence means.
- **`_MED_CONSENT_CLAUSE` is now ONE const**, shared with the first-aid Student Info card, which
  had the wording inline. Two screens answering "what was actually consented to" with two
  paraphrases is how they end up disagreeing. Shown on both states, granted and not: the same text
  is what has *not* been agreed to when consent is missing.
- **Media and supervision consent stay off the profile.** Those are paperwork questions for the
  office; medical consent is the only one a leader acts on at camp.

### 2 — 🟠 THE BUDGET EXPORT IS A STYLED THREE-SHEET WORKBOOK, AND SHEETJS COULD NOT HAVE DONE IT
Owner: *"the budget export should be an excel sheet so that excel formatting/styles can be used to
make it more clear what is the 'total' and what is the 'lower level detail' — currently it is hard
to read when there is several rows labelled for each church."*

> ⚠️ **THE VENDORED SHEETJS ACCEPTS `cell.s` AND SILENTLY DISCARDS IT.** `xlsx.full.min.js` is the
> **Community** build and cell styling is a Pro feature, so `{font:{bold:true},fill:{…}}` is taken,
> ignored, and written as an ordinary cell — the file still opens, and the formatting is simply
> gone. **Measured, not assumed:** a probe workbook with a bold red-filled `A1` came back with
> `<fonts count="1">` and `<fills count="2">`, i.e. the defaults and nothing else. It *does* write
> `!cols`, `!merges` and number formats (`z`), which is why the accommodation export is fine on it
> — bold and fills are the two things this request is entirely about. **Do not "simplify" the
> writer below back onto `XLSX.write`.**

So the workbook is written by hand — which is far less work than it sounds, because **`_zipBlob`
already existed** (hand-rolled for the registration-list `.zip`, verified by extracting a real
archive with Windows' own Expand-Archive). An xlsx is a zip of six small XML parts. New:
`_xmlEsc` / `_xlCol` / `XS` / `_XL_STYLES` / `_xc` / `_xn` / `_xlSheetXml` / `_xlSheetName` /
`_xlsxBlob`.

- ⚠️ **TWO THINGS CORRUPT THE FILE WITH NO USABLE ERROR** (Excel says "we found a problem with some
  content" and names nothing). Both are asserted by the harness: **`fills[0]` must be `none` and
  `fills[1]` must be `gray125`** — Excel reserves those slots, so inserting a colour at the front
  shifts every fill in the book — and **the children of `<worksheet>` have a schema-fixed order**
  (`sheetViews` → `cols` → `sheetData` → `autoFilter`). Emitting the filter before the data
  validates as nothing.
- **Strings are written INLINE** (`t="inlineStr"`), not through a shared-string table: one fewer
  part and one fewer index to keep consistent, for a few hundred rows.
- ⚠️ **A styled BLANK cell is still emitted** (`<c r="C5" s="8"/>`). Skip it and the fill stops
  halfway across a total row — which is the exact visual cue this change exists to add.
- **Two sheets: Summary · By ministry** (three for a few hours — see the follow-up below). Summary
  carries the figures a director quotes; sponsorship is appended to the bottom of By ministry.
  **The sponsorship block is omitted entirely when there is nothing to ask for** — a heading over
  an empty block sends the reader looking for a number that does not exist.
- **The hierarchy IS the answer to the complaint.** The repeated church name is still on every row,
  because the sheet has to stay filterable and pivotable — but it recedes to **muted grey**, a
  church total is **bold on lavender with a rule above it**, and the camp total is **white on
  indigo**. ⚠️ **Do not "tidy" the repetition away by blanking the church cell**; that breaks the
  filter, and the muting already answers what was actually reported.

**Every hard-won property of the CSV carried over, and the harness pins each one:** `Row type` is
still a real column (summing every row still double-counts, and that trap must stay visible —
filter to `Detail` and the maths is trustworthy); Accommodation/Payment type are still derived from
the class KEY, never parsed out of the display label; `Unit price` is still **blank, never 0**, on a
mixed-value row; sponsorship is never typed `Detail`.
The **BOM rule is the one thing that does not carry over, and only because it cannot apply**: xlsx
stores text as UTF-8 XML, so the em dash that started the whole "weird symbols" thread is simply
correct. (⚠️ The rule still binds every *CSV* in this file.)

- **It REPLACES the CSV; there is now one budget export.** Two exports of the same figures drift,
  and "opens anywhere" is not an advantage over a workbook Excel, Numbers, Sheets and LibreOffice
  all open natively. `exportBudget` is now **async** and disables its button while building.
- **`scripts/budget-xlsx-harness.js` — 87 checks** over the real extracted functions: the package
  structure (every declared sheet has both a relationship *and* a content-type override, or Excel
  repairs the file by dropping it), both corruption rules, the style of every row kind, the
  detail-rows-sum-to-total trap, the full class-key mapping, the owner's $150/$190 sponsor
  differential with **$170 appearing nowhere**, and a read-back through the **vendored SheetJS** —
  a completely separate implementation of the read side, so the package is not merely well-formed
  XML but a real xlsx. ⚠️ Its extractor had to be rewritten to skip strings, comments and regex
  literals: the writers contain `;` inside a string (`&quot;`), an IIFE whose closing brace is not
  the end of its statement (`const _CRC_T=…`), and a regex holding a quote character.
- ✅ **VERIFIED IN REAL EXCEL, not just in the harness** (`BUDGET_XLSX_OUT=… node
  scripts/budget-xlsx-harness.js`, then opened over COM). It opened with **no repair prompt** and
  read back: header **bold on `#1E1B4B`**, detail row not bold on white with `$#,##0.00`, church
  total **bold on `#EDE9FE`**, camp total **bold on `#4F46E5`**, `FreezePanes=True SplitRow=1`,
  `AutoFilterMode=True`, and the em dash intact in the title.
- **`computeBudget`/`budgetToCsv` in `src/services/budget.ts` remain DEAD CODE** — nothing routes
  to them, the live budget is entirely the SPA mirror. Left alone (they are the canonical, tested
  algorithm), but do not assume the server CSV is what anyone downloads: **it never was**.

### 2b — Owner's layout corrections, same day (the workbook shipped twice)
Four changes after seeing the first build. `scripts/budget-xlsx-harness.js` is now **98 checks**,
and each correction is pinned so a later "tidy-up" cannot quietly reverse it.

- **The church total LEADS its block; the detail sits under it.** A spreadsheet subtotal
  conventionally follows its rows, which is why it was built that way — but the question this
  sheet is opened to answer is *what did each ministry owe*, and a total that arrives last has to
  be hunted for at the bottom of a block whose length varies by ministry. Scrolling now reads as a
  list of ministry totals with the working underneath. The row keeps its top border, which now
  separates one ministry from the previous one.
- **Summary lost the `Ministries` row and the whole Reconciliation section.**
- **The sponsorship section lost its `Places` column.** A headcount beside an ask invites
  "$830 ÷ 6 places", which is the per-place average the band split exists to avoid. The count is
  still computed and still drives the unpriced warning — it is just no longer presented as a
  figure.
- **🟠 SPONSORSHIP MOVED OFF ITS OWN SHEET, BACK ONTO "BY MINISTRY"** (after a blank row and a
  heading), and **the band rows are gone** — per ministry, per code only.

> ⚠️ **THAT MOVE COST THE STRUCTURAL GUARANTEE, SO THREE THINGS NOW CARRY IT AND ALL THREE ARE
> TESTED.** On its own sheet, money-not-yet-arrived simply could not be summed into money-received.
> Sharing a sheet, that separation rests on: **(1)** the blank spacer row, **(2)** the distinct
> `Row type` values (`Sponsor by ministry` / `Sponsor total`, never `Detail`), and **(3)** the
> autofilter range stopping at the camp total, so "filter to Detail" cannot pull the block into the
> same table. The harness checks each one individually and names which failed.

> ⚠️ **DROPPING THE BAND ROWS REMOVED THE EARLY-BIRD / FULL-PRICE DIFFERENTIAL FROM THE EXPORT —
> NOT FROM THE PRODUCT.** `computeSponsorSummaryClient` still computes `bands`, the Sponsorship
> card on the Budget screen still opens each code into them, and the "$170 appears nowhere" test
> still passes. **Do not delete `bands` on the strength of this export no longer printing it**;
> there is a harness check asserting the bands are still computed while no band row is written.

✅ Re-verified in real Excel after these changes: church totals at rows 2 and 6 bold on `#EDE9FE`
with their detail beneath, camp total row 8 on `#4F46E5`, blank row 9, heading row 10, sponsorship
rows 11–13, sponsor total row 14 on `#4F46E5`.

## Owner batch — invoice review sensitivity, the By-ministry table, a label — 2026-08-04 (4th)

Four owner items. Backend + SPA + one **prod data repair** (no schema or migration change).
`npm run typecheck` clean, `npx vitest run` **939 pass / 60 files** (was 915/59; **+24**),
`node --check` OK on the SPA body (range **967–9112**, re-derived) and `sw.js`. All three
harnesses pass. `sw.js` `camp-v87`→**`camp-v88`**.

### 1 — 🟠 THE SCHEDULE WAS NEVER LOST. IT WAS ON THE WRONG DATES, AND HAD BEEN FOR DAYS.
Owner, after the wipe: *"the schedule data was lost — can it be restored?"* All 48 rows and the
devotional were sitting in the table the whole time, keyed to **2026-07-31 → 08-03** while
`check_in_days` read **2026-09-28 → 10-01**. The Schedule screen looks up by date, found nothing,
and rendered blank — which is indistinguishable from deleted.

> ⚠️ **THIS WAS THE 2026-07-31 CRON TEST, AND THIS FILE PREDICTED IT IN WRITING.** That session
> temporarily moved the camp dates to that day to get inside a check-in lead window, then
> **reverted them by SQL**. `remapDays()`/`applyDayMoves()` re-key schedule and devotionals by
> POSITION, so only a change made through the admin UI carries them across — a direct SQL revert
> strands every row on the old dates. The note saying exactly that is still in the 2026-07-31
> section. **The rollover is innocent here**; Save Defaults then snapshotted the stranded state
> and the restore reproduced it faithfully.

Repaired with the positional remap by hand (`07-31→09-28 … 08-03→10-01`, one `update … case`).
A plain UPDATE was safe **only because the source and target date sets are disjoint** — that is
the whole reason `remapDays` deletes-then-reinserts, since an overlapping shift collides on day 2.
Verified after: 10/16/16/6 items on the four camp days, devotional on day 1. **The day shapes
corroborate the mapping** — day 1 starts 14:00 with a site briefing, day 4 ends 11:30 with pack
bags, exactly the AC-1 PM-only/AM-only camp shape. ⚠️ **Save Defaults must be re-run**, or the
snapshot keeps carrying the stranded dates into the next rollover.

### 2 — 🟠 A SHARED INVOICE'S REVIEW FLAG ASKED ONLY ONE QUESTION, AND IT WAS THE WRONG ONE
Owner: *"the data import review is slightly too sensitive — when it auto-splits an invoice, if
the numbers cleanly match a ticket price then don't flag for review. Also consider the use case
where the two tickets might be one tent, one classroom."*

The 2026-08-02 split had exactly two outcomes: every person's ticket **TYPE** has a learned price
→ split by price; otherwise → equal split **and flag everyone**. But the ticket type is not the
only evidence on the row — **the invoice TOTAL is evidence too**:

```
$340, one known $190 classroom + one unpriced ticket → the residual is $150,
and $150 is a real ticket price. There is nothing here to adjudicate.
```

New **`src/services/invoice-split.ts`** (`resolveInvoiceSplit`, pure, 21 tests). The rule is now:
state per-person costs whenever the total decomposes into catalogue prices **in exactly one way**.
One way is a fact; more than one is a real ambiguity and the flag is earned.

- ⚠️ **THE TENT/CLASSROOM CASE STILL FLAGS, AND THAT IS THE POINT OF IT.** Two unpriced tickets
  totalling $340 against a {$150,$190} catalogue give one multiset but **two assignments** — we
  do not know which sibling is which. **Recording the tent price against the classroom camper is
  a wrong number that reconciles to the cent**, the worst kind. So the resolver enumerates
  assignment VECTORS, not multisets: `{150,190}` and `{190,150}` are two answers, not one.
- **A CONFIRMED `accommodationKind` is what breaks that tie.** If $150 is known to mean tent and
  one sibling is confirmed tent, only one assignment survives and it resolves cleanly. ⚠️ **Only
  `confirmed` may be passed in** — a `guessed` kind was itself inferred from an invoice total by
  `buildAccommodationPriceLookup`, so feeding it back lets a guess confirm itself.
- ⚠️ **THE RESOLVED AND GIVE-UP PATHS CAN PRODUCE IDENTICAL NUMBERS AND MUST STILL DIFFER ON THE
  FLAG.** $300 over two unpriced tickets resolves to $150+$150 — the same figures as the equal
  split, but derived rather than assumed. "Provably even" is not "we gave up". There is a test
  asserting exactly that pair.
- Unchanged: all-types-priced never flagged, **including when a shared discount means the tickets
  exceed the total** — apportioning it in proportion to what each ticket cost is how a shared
  discount works. `splitExact`'s largest-remainder rounding is untouched.
- `MAX_UNPRICED_SLOTS = 4` bails rather than searching wide: prod's largest shared invoice is
  three people, and a wide search is likelier to find a coincidental second decomposition (which
  flags anyway) than a real answer. The search also stops at the second solution — nobody ever
  asks how many there are, only whether there is one.
- `ticketPriceCatalogue()` (new, `ticket-prices.ts`) returns distinct **prices**, not types — two
  types at $150 are one candidate figure, and offering it twice would make one decomposition look
  like two.

### 2b — 🔴 …AND THE REAL CAUSE WAS ORDERING, NOT SENSITIVITY. SHARED INVOICES NOW RUN SECOND.
Follow-up the same day, from the owner asking whether a re-import was needed. Measured against
prod: **287 people, 41 shared invoices, and all 92 people on them flagged. Not one resolved** —
which no amount of loosened rules explains.

> **Only the Invoice import writes `registrationCost`.** So on the first import into a
> freshly-wiped camp every cost is null, `buildTicketPriceTable` returns an **EMPTY** table, and
> every shared invoice falls to the equal split. **The prices were sitting in the very CSV the
> importer was reading.** The old comment said the table is built "ONCE from the pre-run state…
> which is why the two must not be interleaved" — correct for a top-up into an established camp,
> exactly wrong for the first import into an empty one. Running the import twice fixed it, and
> nobody should have to know that.

Shared invoices are now **deferred to a second pass**: every single-person row is applied first,
the price table is rebuilt from the pre-run people **overlaid with what the first pass just
wrote**, and the groups are resolved against that. **Do not fold this back into one pass.**

- ⚠️ **Only `touched` is overlaid — never the groups' own equal-split output.** Otherwise a guess
  teaches the table a price and is then validated by it. There is a test: two `Mystery`-ticket
  groups at $500 each stay flagged rather than the first one's $250 becoming "the price".
- **Verified by reverting, not asserted.** Pointing the second pass back at the pre-run state
  makes the new test fail with `expected 170 to be 190` — the equal split, i.e. the exact prod
  symptom.
- ⚠️ **This does not repair stored rows.** `needsReview` and the money live on the person; a
  deploy cannot rewrite them. The 92 flags clear on the next **Billing Contacts** import, which
  is idempotent (accumulation starts from the rows in the file, never the stored value).
- Of the 92, 89 had the right money by luck — most family invoices are siblings on the SAME
  ticket type, so an equal split lands on the true price. The 3 exceptions are one mixed 3-person
  invoice recorded as $176.67/$176.67/$176.66 instead of $190/$190/$150.

### 2c — 🟠 CARE-TEXT AUDIT: PLACEHOLDERS WERE REACHING THE MEDICAL ALERT
Owner: *"check if all medical and dietary conditions are parsed effectively and flexible for
other future things."* Audited by running the **real exports** (`Camp data/27.7` and `21.7`)
through the parser and reporting structure only — never dumping a minor's care text.

**What the real data looks like** (2026-07-27 export, 203 rows): medical 29 non-empty / 0 junk;
dietary 48 non-empty / **33 junk**; other-meds 39 / **17 junk**. So roughly two-thirds of the
dietary column is people typing "nil". The junk stripping is load-bearing, not cosmetic.

> ⚠️ **AND IT WAS MISSING THE REAL SPELLINGS.** `JUNK` matched the raw lowercased value, so it
> caught `n/a` and `none` but **not `n.a.`, `n.a` or `not applicable`** — all three verbatim in
> those exports. `medicalFlag` is `medicalConditions.length > 0 || otherMedications != null`, so
> a person whose only "condition" is the words *not applicable* gets a **medical flag on the
> check-in roster** and a red **Medical alert** card on the first-aid screen reading
> `Meds: not applicable`. **An alert that cries wolf is worse than no alert** — this is the one
> screen where teaching a first-aider to skim costs something real.

`isPlaceholderCareText` now matches on a **case-, punctuation- and spacing-stripped** key, so
`N/A` / `n.a.` / `N.A. ` / `na` are one entry. Verified against the real values: exactly the
three placeholders dropped, **all 12 genuine ones preserved** (`asthmatic`, `anaphylaxis`,
`type1 diabetic`, `epipen`, `fluoxetine`, …).

- ⚠️ **WHOLE-VALUE ONLY. Never extend this to substring matching** — `none of the above except
  asthma`, `No nuts` and `Nil by mouth after 8pm` all survive, and there are tests for them.
- ⚠️ **Adding a token is a one-way door for the data** — a match is DELETED. `unknown` and
  `not sure` are deliberately kept: in a medical field those are statements, not blanks.

### 2d — A RENAMED CARE COLUMN WOULD HAVE IMPORTED BLANK AND REPORTED SUCCESS
`field()` returns `''` both for a column that is empty and for one it cannot find. So if Elvanto
ever renames `Medical Conditions` to `Medical Conditions (if any)`, **every registrant imports
with no medical data and the import reports complete success** — the same silent-success shape as
the snapshot wipe higher up this file. New `missingColumns()` + `CARE_COLUMNS`; the Form import
now raises a row-1 warning naming any absent care column, visible in the **dry-run preview**
before anything is confirmed. It normalises headers exactly as `field()` does, so ordinary case
and spacing drift still does not warn.

**Reported, deliberately NOT changed — `medicalConditions`/`dietaryRequirements` are typed
`string[]` but the importer only ever writes 0 or 1 element** (`medical ? [medical] : []`). In the
real export 6 medical and 3 dietary values contain commas, and 3 other-meds values contain
newlines. Consequences: the first-aid alert renders one run-on `Condition: Asthmatic, Nut Allergy,
Hay fever` row instead of three, and `_ALLERGY_RE` classifies the **whole** dietary cell, so
`Vegetarian, nut allergy` moves entirely into the clinical alert.

> ⚠️ **DO NOT "just split on commas" without deciding this properly.** It cuts both ways:
> splitting turns `Nut, egg and dairy allergy` into `Nut` + `egg and dairy allergy`, and the
> first fragment then fails `_ALLERGY_RE` and drops out of the medical alert into the quiet
> Dietary card. Today's behaviour over-alerts; naive splitting would under-alert on a real
> allergy. Over-alerting is the safe direction, so it stays until the owner picks a rule.

### 3 — The By-ministry table lists every church, including the ones with nothing
Owner: *"the home page for admin/director should show all churches with accounts (even when they
have 0 regos)."* It was aggregated from `/registrants` alone, so **a church could only appear once
it had registered somebody** — the ministries a director most needs to chase were precisely the
rows that were missing. `RENDER.home` now also fetches `/accounts/churches` (oversight roles only,
already warmed by `_prefetch`, `.catch(()=>[])` so an empty list is just the old behaviour) and
seeds every church at zero before counting registrants over the top.

- ⚠️ **REGISTRANTS STILL CREATE THEIR OWN ROW when no church record matches.** That is how the
  `__unallocated__` sentinel bucket keeps appearing. Do not "tidy" this into a lookup against the
  church list only — unallocated people would silently vanish from the totals.
- Rows are **alphabetical**, and a zero row is **muted with an em dash rather than five 0s** —
  five zeros read as five measurements. "Who has sent nothing in" is answered by scanning for grey.
- Interpreted as *all churches*, not *only churches that have a login*: after the restore 15 of
  the 29 have no `b-`/`g-` account yet, and those are the rows most worth seeing. Say so if the
  narrower reading was meant.

### 4 — "Classroom — paid in person" → "Classroom in person"
Owner request; same for the tent class. Changed in **both** copies — `CLASS_LABEL` in
`src/services/budget.ts` and the `_BUD_CLASSES` mirror in the SPA — which is the standing rule for
anything in that table. Display only: the `TicketClass` KEYS (`classroom-inperson`) are untouched,
and they are what the CSV's Accommodation/Payment columns are derived from, so the export is
unaffected.

## 🔴 THE NEW-YEAR ROLLOVER EMPTIED PRODUCTION — a double-encoded snapshot — 2026-08-04 (3rd)

Owner: *"I just saved then rolled over to a new year but can't find out how to restore the
baseline."* There is nothing to find — **the restore is not a button, it is the second half of
`newYear`** — and it had already run, restoring **nothing** over the live camp.
`npm run typecheck` clean, `npx vitest run` **915 pass / 59 files** (was 911/58; **+4**).
**No schema or migration change.** Backend repo only — no SPA change, `sw.js` NOT bumped.

### What it cost
Measured against prod, not inferred. The rollover ran `2026-08-04 11:18:04Z`, ten seconds after
the compliance export (so the historical record is safe). Immediately after: **0 churches, 1 user,
0 classrooms, 0 FAQs, 0 schedule items, 0 devotionals, 0 temp passwords.** The snapshot held
**29 churches, 32 accounts, 34 classrooms, 6 FAQs, 48 schedule items, 1 devotional** the whole
time.

### 🟠 THE PAYLOAD WAS JSON-ENCODED TWICE AND EVERY LAYER AGREED IT WAS FINE
`saveDefaults` wrote `JSON.stringify(obj)` and cast it `::jsonb`. **The cast declares the
parameter type as jsonb, so postgres.js runs its own jsonb serializer over the string it is
handed** — a second encoding. The column ended up holding a jsonb **string**
(`jsonb_typeof(snapshot) = 'string'`), not an object.

> ⚠️ **THE READ SIDE THEN CONVERTED THAT INTO SIX EMPTY ARRAYS, SILENTLY.** `toDefaults` cast the
> string `as Record<string, unknown>` — which compiles clean — so every `snap['churches']` read
> `undefined` and every `?? []` fallback fired. `newYear`'s `if (!defaults)` guard passed, because
> the ROW existed. `replaceAll(churchRepo, [])` is a delete-everything, and that is exactly what
> it did, six times, plus `userRepo.deleteAll()` keeping only admins.
>
> **The `?? []` was the whole failure.** A missing collection and an unreadable snapshot are not
> the same event, and defaulting the second one to "empty" turns a corrupt read into a wipe.

- **`toDefaults` now THROWS** on a non-object snapshot, naming the type it got. **Do not soften
  this back into a cast.** An unreadable baseline must stop the rollover before a single delete,
  never empty it.
- **The write uses `sql.json()`** and lets postgres.js serialize. **Never `JSON.stringify` +
  `::jsonb` again.** Every other repo in that folder already passed objects through
  `this.sql(cols)`; this file was the only one hand-rolling the cast — **and the only Supabase
  repo with no mapper test**, which is the whole reason it survived.
- The `as unknown as JSONValue` cast is what the stringify was really working around
  (`CampDefaults` collections are `unknown[]`, which postgres.js's `JSONValue` rejects). Reaching
  for `JSON.stringify` to satisfy the type-checker is what produced the double encoding.
- `created_at` is now updated on conflict too — it had been pinned to the FIRST save ever
  (2026-07-27), so a snapshot re-saved on 08-02 still read as a week old.
- **`supabase.defaults.mapper.test.ts` — 4 tests.** ⚠️ **The malformed fixture MUST be the
  double-encoded STRING form.** An object fixture passes against the broken mapper and proves
  nothing; that is precisely how this shipped. Verified the old mapper body against the real
  production row: it returns `{churches:[],users:[]}`.

### Recovery — DONE, same day
The snapshot text was intact. The row was repaired in place
(`update defaults set snapshot = (snapshot #>> '{}')::jsonb`) and the scaffold re-inserted from
it: **29 churches, 31 accounts** (snapshot admins skipped — the live admin is the recovery
account, same rule as `newYear`), **34 classrooms, 6 FAQs, 48 schedule items, 1 devotional**.
`users.church_name`/`zone` were backfilled from `churches` afterwards — a sibling CTE's inserts
are not visible to another CTE in the same statement, so the join in the user insert saw an empty
table.

⚠️ **Two things the restore could NOT fix, both pre-existing in the baseline:**
- **15 of the 29 churches have no login** — the snapshot only ever held **28 church accounts
  (14 `b-`/`g-` pairs)**. Close it with **Split church accounts**, which regenerates a missing
  sibling from `slugifyUsername(church.name)`.
- **Every restored account is passwordless** (`password_hash` null, `must_change_password` true) —
  the snapshot strips hashes by design, and the rollover's temp-password list generated 0 entries
  because it saw 0 users. Fixed by **Randomise & export passwords**.

 **This year's people are
NOT recoverable from it and are not meant to be** — `newYear` purges them by design; they
re-import from the Elvanto CSVs. The snapshot is also from **08-02**, so anything created on
08-03/04 was not in it, and it strips password hashes by design (the rollover's temp-password
list generated 0 entries because it saw 0 users).

> **Standing lesson: `saveDefaults` and `newYear` are one mechanism and must be tested as one.**
> A snapshot that cannot be read is indistinguishable, at the call site, from a camp with nothing
> in it.

## Sponsorship: the differential, the ask, and "camper" → "student" — 2026-08-04 (2nd)

Three owner items. Backend (`budget.ts`) + SPA + docs. `npm run typecheck` clean, `npx vitest run`
**911 pass / 58 files** (was 894/57; **+17**), `node --check` OK on the SPA body (range
**966–9085**, re-derived) and `sw.js`. All three harnesses pass. `sw.js` `camp-v86`→**`camp-v87`**.
**No schema or migration change.**

### 1 — 🟠 ONE SPONSOR CODE IS NOT ONE AMOUNT, AND EVERY VIEW OF A CODE SAID IT WAS
Owner: *"a church may have a discount sponsor code that is used across both tent early bird and
tent full price ticket prices. In this case the codes applied for early bird would be a lower value
sponsor than the ones on the regular tickets. This differential should be able to be seen."*

Nothing on the Budget screen could show it. Every existing view of a discount code — the `×N` count
chip, the `purpose` pill, `avgPercent`, the tag dropdown — **collapses the code to a single
figure**, and for this question an average is not merely imprecise, it is *unusable*:

> A code covering five $150 early-bird tents and five $190 standard tents averages **$170** — a
> number that describes nobody and that **no sponsor can be invoiced for**. There are two asks
> here, not one, and the arithmetic that hides the difference is the arithmetic the owner needs.

New **`computeSponsorSummary`** in `src/services/budget.ts` (+ SPA mirror
`computeSponsorSummaryClient`). Its `SponsorCodeRow.bands` keeps each distinct amount separate:
**more than one band IS the differential**, and each band names the ticket type(s) behind it, so a
row reads `$190 each · Tent Accomodation · × 2 · $380` rather than a blended figure.

> ⚠️ **THE ASK IS DEFINED AS THE GAP THE BUDGET ALREADY IMPLIES, not a second opinion:**
>
> ```
> sponsor amount = the place's ticket value − what personValue counts as received
> ```
>
> That is load-bearing. `personValue` is what makes the grand total read as MONEY RECEIVED (see its
> doc comment), so this figure is exactly what must arrive from elsewhere for the camp to be whole —
> **sponsor total + grand total = the value of every place**, and there is a test asserting it.
> Recompute the ask from `discountAmount` instead and the two stop reconciling, which is how a
> director ends up with three different answers to "what do we still need?".

- **`sponsor` and `discount` tags are both in scope** (the owner's own phrase is "discount sponsor
  code") but are reported under their own tag and **totalled separately** — `fullTotal` vs
  `partialTotal`. A full place and a half place are not the same ask.
- ⚠️ **`inperson` is deliberately EXCLUDED.** That money *was* received; it was just taken by hand
  at the desk instead of by invoice. Counting it would invent a shortfall. There is a test.
- ⚠️ **An unpriceable place is COUNTED AND FLAGGED, never totalled as $0.** A $0 ask reads as
  "already covered", which is the opposite of "we don't know". `unpricedCount` drives a warnbox
  saying the total under-reads.
- **Ticket value uses the same cascade as the in-person branch of `personValue`** — their own
  `registrationCost` → the learned price for their ticket TYPE (`ticket-prices.ts`) → the admin's
  scalar setting. "What is this place worth" is the identical question in both places, and it is
  what makes the early-bird/full-price split fall out for free. The price table is built from the
  FULL set before scoping, same as `computeBudget`, so a filtered view still prices what the whole
  camp knows.
- **`src/services/budget.sponsor.test.ts` — 17 tests**, including the owner's exact 3×$150 +
  2×$190 case, an explicit assertion that **$170 appears nowhere**, the reconciliation invariant,
  and that the per-code and per-church breakdowns are two views of one figure.

### 2 — The Sponsorship card, and where its total lives
A new **"Sponsorship needed"** card on the Budget screen (right column, above Discount codes),
answering the owner's *"a toggle button which reveals for each code, church and the total for the
camp of required sponsor money"*.

- **The camp total sits in the card HEADER, readable while collapsed.** It is the figure a director
  carries into a conversation; putting it behind a disclosure repeats the 2026-08-02 mistake where
  a correct-but-hidden warning cost real money. The card only renders when there is something to
  ask for.
- **Per-code and per-church are one `.seg` toggle apart, not side by side** — they are the same
  money asked twice, and showing both at once doubles the page for no new information. Tapping a
  row opens its bands (per code) or its codes (per church).
- **`_sponsorView` is module-level, not read from the DOM**, so the choice survives `_budRedraw()`.
  Classifying a code redraws the screen, and a director working down the code list would otherwise
  be flipped back to the other view on every save — the same class of annoyance `_budRedraw` was
  written to fix.
- **CSV**: new `Sponsor band` / `Sponsor unpriced` / `Sponsor by ministry` / `Sponsor total` row
  types. ⚠️ **None of them is `Detail`, and that is deliberate** — sponsorship is money that has
  NOT arrived, so typing it as `Detail` would sum it into the received column and re-create exactly
  the double-count the `Row type` column was added to prevent. A harness check asserts both halves.
  A `Sponsor band` row is one asking PRICE, not one person, which is how the differential reaches
  the spreadsheet.

### 3 — "Camper" is gone from the interface; `kind: 'camper'` stays in the domain
Owner: *"update wherever in the app 'camper' is labelled for students in the app as a 'student'
label"*. The 2026-07-28 copy pass caught the detail-screen header and called it "the only
user-facing use of that word" — it was not. Eighteen strings remained, mostly on Budget and Search.

> ⚠️ **THE DOMAIN VALUE IS UNTOUCHED.** `BudgetPerson.kind` is `'camper' | 'leader'`,
> `RegistrantDto.kind` maps to `'camper'`, and `r.kind === 'camper'` appears throughout the SPA.
> **Those are data, not labels** — rewriting them silently changes what the code matches on and
> would empty the budget's student rows. Only display strings changed.

Changed: the Budget screen (`N students · N leaders`, the `Students` detail line, the church
sub-line, the home nav card), the student search screen (heading, placeholder, both tooltips, the
`paint()` subtitle), the accommodation 75% tooltip, the notice-title lock-screen warning, the
reset confirmation, the wizard's At Camp Info summary, and the backend's `Camper not found` error
(8 call sites across `note.service` / `search.service`). **The budget CSV's audience column is now
`Student`** — in `budgetToCsv` *and* the SPA export, which had drifted to different labels anyway.
A harness check asserts the word "Camper" appears nowhere in the export.

## Saved-view rework (wrong premise) + budget CSV rebuilt — 2026-08-04

Two owner corrections to the 2026-08-03 work. SPA-only. `npm run typecheck` clean, `npx vitest
run` **894 pass / 57 files** (unchanged — browser-only), `node --check` OK on the SPA body
(range **966–8902**, re-derived) and `sw.js`. `sw.js` `camp-v85`→**`camp-v86`**. **No schema or
migration change.**

### 1 — 🟠 THE FILTER-PERSISTENCE FEATURE WAS BUILT ON THE WRONG DEPLOYMENT MODEL
The behaviour shipped on 2026-08-03 was right; the UI wrapped around it was not, because the
premise was inverted. **Record this, because it is not derivable from the code:**

> **ONE ACCOUNT, MANY PHONES.** A church login like `b-citipointe-brisbane` is shared by ~20
> leaders, **each signed in on their own phone**. Devices are personal; ACCOUNTS are shared. It
> is **not** a pool of shared devices, which is what the first version assumed.

Everything follows from that, and the consequences are the opposite of what was built:

| | First version (wrong premise) | Corrected |
|---|---|---|
| What a saved filter *is* | a transient state someone may have forgotten | a **standing preference** — "I look after Yr 7 boys", forever |
| Therefore the UI | an **amber warning** banner, every launch | a **quiet neutral** saved-view strip |
| Wording | "Filtered — N people **hidden** · Clear" | "Showing Yr 7 · Guys — 12 of 47 · Show all" |

> ⚠️ **DO NOT MAKE THAT STRIP AMBER, RED OR A `.warnbox` AGAIN.** Under the real model it
> renders on every launch for a leader whose whole job is one year level — an alarm fired
> forever at a correct choice is how a camp learns to swipe past banners, including the ones
> that matter. There are two harness assertions pinning this: the markup must contain no
> `warn`/`danger`/`alert` class, and must not use the words "hidden"/"hiding".

`shown of total` replaced the hidden count for the same reason: a Yr 7 leader is not hiding
anyone, they are looking at their group. Same information, no implication of a problem.

The residual risk is real but small and is already handled where it actually bites — the
check-in screen's "All checked in" banner qualifies itself with `(filtered)`, and the saved-view
strip sits directly above it naming the slice.

**The per-account storage key survived the correction**, but its justification changed: it is
not about shared devices (`localStorage` is per-device anyway), it is about the rare second
login on one handset — a leader covering the other gender, an admin borrowing a phone.

### 2 — 🟠 THE BUDGET CSV: TWO CAUSES, ONE OF THEM AN INVISIBLE CHARACTER
Owner: *"the category column has weird symbols in it and isn't very reader-friendly."*

**Cause 1 — no UTF-8 BOM.** Excel on Windows opens a `.csv` as the system ANSI codepage unless
the file begins with a BOM. Several category labels contain an **em dash** — `Tent — paid in
person`, and `labelForRow` appends `— $150` — which is three UTF-8 bytes and renders as `â€"` in
Windows-1252. That is the reported "weird symbols", exactly.

> ⚠️ **An audit of every export settled which files were affected, rather than guessing.**
> `src/utils/csv.ts`'s `toCsvString` **already** prefixes the BOM, so every SERVER-built CSV
> (registrants, sign-in/out, notes) was always fine. Of the client-built ones, the first-aid and
> password CSVs carried a literal BOM; **the budget CSV was the only one that did not — and it
> is also the only one whose data contains non-ASCII.** That is why it was the single visible
> failure. **Any new client-built CSV must start with `﻿`.** It is invisible in an editor, so
> the way this regresses is somebody tidying a string concatenation and seeing no difference.

**Cause 2 — one column carried three facts.** `Category` was the on-screen display label:
accommodation type + payment class + unit price (`Classroom — paid in person — $190`). The price
was **already** in its own `UnitPrice` column, so it was duplicated, and neither of the other two
facts could be sorted, filtered or pivoted on.

New columns: **Church · Row type · Audience · Accommodation · Payment type · Discount code ·
People · Unit price · Line total**.

- **Accommodation and Payment type are derived from the class KEY** (`_budAccom` / `_budPayment`),
  never string-parsed out of the display label. The label is written for a phone screen and
  carries the em dash; the keys are the stable contract with `budget.ts`. A harness check walks
  **every** entry in `_BUD_CLASSES` and asserts both map to a known value, so adding a tenth
  ticket class cannot silently produce a blank column.
- **`Row type` is new and fixes a real arithmetic trap.** `Audience` used to hold
  `Camper`/`Leader`/`Total`/`Grand Total` together, so a naive SUM over the amount column
  **double-counted every subtotal**. A reader (or a pivot) can now filter to `Detail` and trust
  the total. There is a harness check asserting detail rows alone sum to the grand total *and*
  that summing every row does not — the trap has to stay visible.
- ⚠️ **`Unit price` stays BLANK, never 0, on a mixed-value row** — a 0 reads as "free" while the
  line total says otherwise. Unchanged rule, same as `budgetToCsv` in `budget.ts`.
- Also now CRLF line endings and a dated filename via `_exportName`, matching every other export.
- ~~**`scripts/budget-csv-harness.js`** — 30 checks over the real extracted `exportBudget`,
  including the BOM as raw `EF BB BF` bytes, "no em dash anywhere in the payload", a church name
  containing a comma, and the full class-key mapping table.~~
  **SUPERSEDED 2026-08-04 (5th) — the budget export is now a styled .xlsx** and this file is
  deleted; `scripts/budget-xlsx-harness.js` replaces it and carries every assertion above that
  still applies. **The BOM checks are gone because the BOM is gone**: an xlsx is UTF-8 XML, so
  there is nothing to mis-decode. ⚠️ **The BOM rule still binds every other CSV in this file** —
  see the section at the top.


## Accommodation export + roster filters persist across logins — 2026-08-03 (2nd)

Two owner follow-ups. SPA-only. `npm run typecheck` clean, `npx vitest run` **894 pass / 57
files** (unchanged — both are browser-only), `node --check` OK on the SPA body (range
**963–8833**, re-derived) and `sw.js`. `sw.js` `camp-v83`→**`camp-v85`** (v84 the export, v85 the
filters). **No schema or migration change.**

### 1 — Accommodation allocations: a 4-sheet Excel export
Closes the one real gap the 2026-08-03 export audit found — accommodation had no export of any
kind. Button sits at the top of the allocations screen; sheets are **Summary**, **Classrooms by
ministry**, **Classrooms by room**, **Tents**.

> ⚠️ **BUILT CLIENT-SIDE FROM THE DATA THE SCREEN IS ALREADY RENDERING**
> (`window._accomRegs` / `_accomRooms` / `_accomAlloc` → `accomGroups` / `accomChurches` /
> `tentDist`), and that is the whole reason it is not a server endpoint. Those SPA helpers
> **mirror** `src/services/accommodation-allocation.ts`; a server-generated workbook would be
> computed from the *other* copy of the rules. If the two ever drift, the spreadsheet would
> quietly disagree with the map the director is reading — and a director reconciling a room list
> against a screen has no way to tell which one is lying. Same reasoning as the check-in status
> PNG. **Do not move this server-side.**

- **Cohorts now carry `stu` and `ld` alongside `n`**, computed in `_accomGenderGroups` /
  `_accomYearGroups` at the same moment `n` is, with `n === stu + ld` always. The export needs
  the student/leader split per cohort and re-deriving it there would have been a **fourth** copy
  of that arithmetic. Additive — nothing on screen reads them yet and `n` is unchanged.
- ⚠️ **"Capacity of those classrooms" is the capacity of the rooms a cohort OCCUPIES, not
  capacity reserved for it.** A room shared between two cohorts contributes its full capacity to
  both, so that column is **not additive** down the page. The per-room sheet is the one that
  answers capacity questions without double counting; the header wording is deliberate.
- Written with the **already-vendored SheetJS** (`public/vendor/xlsx.full.min.js`, 0.18.5, lazy
  loaded by `_ensureXlsx`). **Verified it can WRITE, not just read** — the repo had only ever
  used it to convert xlsx→CSV on import — by round-tripping a real workbook through
  `XLSX.write` → `XLSX.read`. No new dependency. xlsx rather than CSV because four sheets was
  the request and CSV cannot carry them.
- ⚠️ Sheet names are capped at 31 chars and must avoid `: \ / ? * [ ]`. A bad one **throws on
  append** — that is exactly how the compliance workbook 500'd for weeks on
  `'Sign-in/Sign-out Log'`.
- **`_ensureXlsx`'s error message no longer says "try exporting as CSV instead"** — it now backs
  an export with no CSV alternative, so that was advice which could not be followed.
- The button is rendered **outside `#accomBody`**, like the overrides card: `drawAccom()` rewrites
  that div on every allocation change and would otherwise wipe the button's disabled state
  mid-export. It reads `window._accom*` at click time, so it always exports the current state
  without needing a re-render.
- **`scripts/accom-export-harness.js`** — 10 scenarios over the REAL extracted functions (never a
  reimplementation): the 50-person split threshold, `n === stu + ld` reconciliation, a shared
  room, a partially-placed cohort, tent ceil-to-7 with students and leaders counted **separately**
  (pooling 15 + 8 would give 4 tents, not 5), the under-75% fold-in, cancelled rows, people with
  no accommodation type, the empty camp, and a stale allocation entry pointing at a group that no
  longer exists. `node scripts/accom-export-harness.js`.

### 2 — Check-in and My-students filters persist across logins (owner request)
Remembered per device and restored at next sign-in. `_filtKey` / `_saveFilters` /
`_restoreFilters` / `_clearFilters` / `_filterActive` / `_filterBanner`.

> ⚠️⚠️ **THE PREMISE BELOW WAS WRONG WHEN FIRST WRITTEN AND WAS CORRECTED BY THE OWNER ON
> 2026-08-04 — see the 2026-08-04 section at the top of this file.** The original version
> assumed shared devices and shipped an amber WARNING banner as a safety mitigation. The real
> deployment model is the opposite: **one shared account across ~20 personal phones** (a church
> login like `b-citipointe-brisbane` is used by every boys' leader, each on their own handset).
> So a saved filter is a **standing preference** ("I look after Yr 7 boys"), not a transient
> state anyone forgets — and warning about it on every launch alarms a leader about a choice
> that is correct. The banner is now a quiet, neutral saved-view strip. Everything else in this
> section still stands.

- ⚠️ **Keyed PER ACCOUNT** (`ycp_filters_<username>`), matching `ycp_initials_<username>` /
  `ycp_ciq_<username>`. `localStorage` is already per-device, so on the real model this key is
  effectively "this leader's phone" — the account in it costs nothing and keeps the rare second
  login on one handset (a leader covering the other gender, an admin borrowing a phone) from
  inheriting a view that is not theirs. There is a harness check for that case.
- ⚠️ **`_restoreFilters` resets to defaults FIRST, then overlays**, and type-checks every value.
  A corrupt or partial blob must never leave a key `undefined`: an undefined filter compares
  false against everything and **silently empties the roster** with no error. A numeric `grade`
  is rejected rather than coerced, because filters compare as strings.
- **Every read and write is `try`/`catch`ed** — `localStorage` throws outright in some privacy
  modes, and this runs on the check-in screen, which must never fail to render.
- **`MY_FILTER` is new state.** The My-students filter previously lived ONLY in the DOM
  (`filterMyYouth` read `sel('myZoneF')` directly), so it did not survive a tab change, let alone
  a login. The selects are now the input and `MY_FILTER` is the state, via `setMyFilter()`.
- Restored at all **three** session-start paths (`doLogin`, `submitChangePassword`,
  `_tryRestoreSession`) **before the first paint**, so neither screen renders unfiltered and then
  jumps — and on **both** account-preview swaps, so an admin's own filter does not silently narrow
  the roster of the account they are inspecting.
- **`scripts/filter-persist-harness.js`** — 22 checks over the real functions against a stub
  `localStorage`: round trip, the b-/g- isolation case, five malformed-blob shapes, a throwing
  `localStorage`, and banner content (including "Leaders" not rendering as "Yr leaders", and the
  singular/plural of the hidden count).


## 16-item owner batch — push latency, parent masking, Android review — 2026-08-03

Owner list of 20 items; one was withdrawn during clarification (a check-in-screen button,
superseded by the check-in-status export below) and three were verification requests answered
in prose rather than code. `npm run typecheck` clean, `npx vitest run` **894 pass / 57 files**
(was 885/56; **+17**), `node --check` OK on the SPA body (range **956–8564**, re-derived) and
`sw.js`. `sw.js` `camp-v82`→**`camp-v83`**. **No schema or migration change** — next migration
is still `0021`.

### 1 — 🟠 URGENT NOTICES WAITED ON A 5-MINUTE POLL, AND THE JITTER TAXED THE SMALL CASE
Owner: *"urgent notices take a while to arrive… review low-risk ways to reduce the delay, then
do a similar review of the incidents notifications (max 10-15 devices)."*

Two independent delays, and the guess in the question was the smaller one:

| Source | Cost | Fix |
|---|---|---|
| Nothing pushed a notice until the next `pg_cron` tick | 0–5 min, **mean 2.5 min** | `push.sendNow()` at creation |
| `PUSH_JITTER_MS` spread every send over 4s regardless of audience size | mean **2s** | `PUSH_JITTER_MIN_SENDS` |

**`sendNow(n)`** on the push service, called from `notification.service.send` (urgent only) and
`incident.service.log` (high severity only). The container now builds `push` BEFORE those two so
it can be injected; both params are **optional**, so every existing test constructs them
unchanged and an absent push service is exactly the old behaviour.

- ⚠️ **IT GOES THROUGH `claimForPush`, AND THAT IS THE ONLY THING MAKING IT SAFE.** The claim is
  atomic and **permanent**. If `sendNow` claims, the tick's `pushSentAt == null` filter skips it;
  if it loses a race, `claimedIds` will not contain the id and it sends nothing. **Do not
  "optimise" this into a direct `sendOne` loop that skips the claim** — a duplicate push is not
  self-correcting.
- ⚠️ **A SCHEDULED NOTICE IS GATED OUT EXPLICITLY**, not left to the audience resolver.
  `canSeeNotification` would resolve an empty audience for a future `scheduledFor` — but relying
  on that means CLAIMING it now and **burning its one permanent claim**, so it could never push
  when it actually published. `publishesNow` is checked in `send()`.
- **It never throws and never reports failure upward.** The notice row is already committed and
  is the guaranteed channel; the tick stays the safety net. Worst case = the old behaviour.
- **Awaited, not fire-and-forget** — on serverless the function can be frozen the moment the
  response is written, so a detached send is not reliably delivered. Cost is bounded: an
  incident's ~10-15 devices now land in well under a second.

**`PUSH_JITTER_MIN_SENDS = 20`** — below that many total (notice × device) sends, the jitter is
skipped entirely. Its stated purpose is stopping 100+ devices opening the app in the same
second; an incident alert is 10-15 devices, so every one of them was paying a mean 2s for a
crowd that does not exist. A camp-wide urgent notice (~224 sends) is far above the threshold and
keeps the full window. **Both sides are tested** — a change that silently dropped the jitter
altogether looks identical on the small-batch test alone.

> **The cron cadence was deliberately NOT changed.** `*/1` instead of `*/5` was considered and
> rejected: with immediate send in place the tick's two real jobs do not benefit — the check-in
> warning already fires on a **60-minute** lead window, where 5-minute granularity is irrelevant
> — so it would buy only scheduled-notice push precision, at 5× the invocations and 5× the rows
> in `net._http_response`.

### 2 — The high-severity push no longer says "Incident logged"
`buildPushPayload`'s `leadersOnly` branch now returns a **fixed** `title: 'High priority
incident'` / `body: 'Open app to view'` instead of the notice's stored title. On a lock screen
"Incident logged" reads as a filing confirmation — something already handled — which is the
opposite of what it means. **`leadersOnly` is set by exactly one code path** (`incident.service
.log` on high severity), so that branch is always an incident alert.
The **zone is dropped from the push on purpose**; the in-app notice and Notices list keep the
full `Incident logged · <Zone> Zone` title. Tests pin both the wording and that the zone does
not leak into the payload.

### 3 — 🟠 A CHURCH LOGIN'S PARENT NUMBERS ARE NOW MASKED AND AUDITED
Owner: *"church login, students screen, mask parents number until revealed by clicking (then
have it be clickable to call similar to the first aid account). Also check it gets logged."*

`maskParentForFirstAid` → **`maskParentPhone`**, driven by
**`PARENT_PHONE_MASKED_ROLES = {firstAid, church}`** (firstAid alone since 2026-07-17).

- ⚠️ **THE MASK HAS TO BE AT THE DTO BOUNDARY, NOT IN THE SPA.** Hiding it client-side while the
  real number still travels in the `/campers` JSON makes the reveal theatre — it is one devtools
  tap away, and far worse **the audit row is never written**, because nothing forced a call to
  the audited endpoint. Masking server-side is what makes `GET /search/contact/:id/parent` the
  only route to the number.
- **It was already logged, and that was verified rather than assumed.** Church holds
  `camper:read:sensitive`, and `revealContact` records kind **`parent-contact`** to
  `reveal_audit` → the compliance workbook's "Sensitive Reveals" sheet. No new capability and no
  schema change; what changed is that a church now *has* to go through it.
- **director / admin / zoneLeader are deliberately unaffected** — they run the camp, and a
  masked roster adds an audited tap to routine oversight for no safeguarding gain.
- SPA: **`_parentPhoneCell(p,id)`** renders a Reveal button, and `faRevealLeader` (reused
  verbatim) swaps it for a `tel:` link on success — one tap to reveal, one to call, same as
  first aid. ⚠️ **It detects the mask by looking for `*` in the value, NOT by testing the role.**
  A role test here silently offers a Reveal button for a cleartext number (or hides one for a
  masked one) the moment the server's rule changes. It is also why the pre-camp `/registrants`
  path, which is not masked, still renders a plain `tel:` link correctly.
- 9 new tests in `parent-phone-mask.controller.test.ts`, including one asserting the raw number
  appears **nowhere** in the serialized detail DTO.

### 4 — "Randomise & export passwords" now covers every account but the original admin
Was church logins only. Now also director / zone leader / first aid / **secondary admins**, in
the same operation and the same CSV (new `Role` column; `Gender` is blank on a leadership row,
because only church logins are gender-scoped).

- ⚠️ **THE ORIGINAL ADMIN IS EXCLUDED, AND THIS IS LOAD-BEARING.** It is the recovery account —
  the one login that cannot be deleted, deactivated or demoted by anyone including itself. An
  admin pressing this button is often already locked out of something; rotating the password out
  from under their own live session and returning the new one only via a CSV download that could
  fail is how a camp ends up with no way in at all. Secondary admins **are** rotated.
- **Inactive accounts are skipped** — rotating a deactivated login puts a working credential for
  it into a distributed CSV, the opposite of deactivating it.
- `mustChangePassword` is still **not** set (these are the real handed-out passwords).
- The button **moved to its own card at the top** of Accounts & churches. It used to sit in the
  Churches card header, which was right when it only touched church logins and now describes
  itself wrongly as well as being hard to find. Filename `church-passwords` → `camp-passwords`.

### 5 — Check-in status export (PNG), and both export cards collapsed
New **Check-in status (PNG)** card on Records & Export, below Registration lists: pick a camp
day, get an image of how many check-ins each church **missed**, worst first, morning + afternoon
summed. Counts only — no names. `_csGather` / `_csDraw` / `exportCheckinStatusPng`, drawn with
the same canvas conventions as `_rlDraw` so the two images read as a set.

- **"Missed" is the ROSTER's definition, not a second one.** A miss is a person on that session's
  roster who is not checked in. The roster already excludes leaders and anyone not `atCamp`, so a
  student who never arrived is not counted. Re-deriving that population from `/registrants` would
  produce a bigger number than the one the leader was looking at on the check-in screen — the
  fastest way to make an accountability report nobody trusts. `checkedIn` is
  **last-entry-wins**, consistent with the check-in screen and `churchesBehind`.
- ⚠️ **SESSIONS COME FROM `GET /checkin/sessions`, NEVER CONSTRUCTED AS `day~am` + `day~pm`.**
  Under AC-1 the first camp day is **PM-only** and the last is **AM-only**, so building both ids
  by hand 404s on exactly the two days most likely to be checked.
- Rows are **one per church with the `b-`/`g-` logins summed** (owner's choice) — that is who
  gets chased. Ties break on name so the image is stable between runs.
- Both this and **Registration lists** are now default-collapsed `<details class="setg">`
  (owner request). ⚠️ **Do not add `open`** — same standing rule as the three Data Import cards.
  The `<select>`s stay in the DOM while collapsed, so `sel('rlChurch')` and
  `_loadRegListChurches()` work regardless of open state.

### 6 — 🟠 THE KEYBOARD SCROLL BUG IS NOT THE ONE `_fixViewportGap` FIXES
Owner: *"often when a keyboard is opened the screen will slightly scroll up and not return when
the keyboard is minimised."* This is why the 2026-07-29 fix did not address it:

> `_fixViewportGap` re-scrolls to `window.scrollY` — it repairs the **layout** against a stale
> viewport height. The reported bug is about the **position**. Focusing an input makes the
> browser scroll it into view (real and wanted); dismissing the keyboard grows the viewport back
> but nothing returns the document, because as far as the browser is concerned that scroll was
> legitimate and is now simply where you are. **Both functions are needed.**

New `_kbScroll` / `_kbArmedAt` / `_kbVH` / `_KB_SETTLE` / `_kbRestore`: capture the offset on
`focusin`, restore it once the keyboard has gone.

- ⚠️ **It must not fight a deliberate scroll.** If the user scrolls while typing, that position
  is theirs. The capture is **disarmed by any scroll outside `_KB_SETTLE` (350ms)** — the
  browser's scroll-into-view lands within a couple of frames of focus; a human scroll does not.
- ⚠️ **Restores only on a genuine shrink-then-grow of `visualViewport`.** A `<select>` opens a
  picker on Android without resizing the visual viewport, and a focusout with no keyboard
  involved must be a no-op, or merely tapping a dropdown would jump the page. `INPUT|TEXTAREA`
  only (never `SELECT`), phone only (`_isWide()` returns early), and clamped to `scrollHeight`
  so it cannot scroll past the end of a page that shrank while the keyboard was up.

### 7 — Android compatibility review (owner request) + four low-risk fixes
Reviewed against the SPA, `sw.js`, `manifest.json` and `push.service.ts`. **The two things most
likely to be wrong were verified correct:** the `_vpKick` viewport hack is gated
`_vpIsStandalone() && _vpIsIOS()` and is provably inert on Android, and every modern API in use
(`CompressionStream`, `PushManager`, `visualViewport`, `beforeinstallprompt`, credentials) is
feature-detected. The maskable 192/512 icons are correct. Fixed:

- **🔴 `exportBudget()` never appended its anchor to the document** before clicking it — the one
  export in the file that skipped it. A detached-anchor click is unreliable on mobile Chromium,
  so this button could silently do nothing on an Android phone.
- **Six exports revoked their object URL in the same tick as `.click()`.** The repo's own lesson
  (`_rlSaveBlob`, 2026-07-31: *"revoking immediately can cancel the download on some mobile
  browsers"*) had only ever been applied to the PNG export. All seven download sites now route
  through **`_rlSaveBlob` / `_saveTextFile`** — append, click, remove, revoke after 20s. ⚠️
  **Route every new download through these. Do not hand-roll the anchor dance again.**
- **The push `badge` was the full-colour app icon.** Android masks `badge` to a silhouette using
  the **alpha channel alone**, and `icon-192.png` is an opaque gradient tile — every pixel
  opaque, so it rendered as a featureless blob in the status bar. iOS ignores `badge` entirely,
  which is why iOS-only testing never showed it. New **`public/icons/badge-mono.png`**: the
  tent+cross glyph on transparency, 96×96 grey+alpha, generated by hand (there is no image
  library in this repo) and **verified by decoding it back and rendering it as ASCII**, not
  assumed. Keep it transparent — a filled background reintroduces the blob. `icon` correctly
  stays the full-colour tile.
- **`renotify: true` added.** Replacing a notification that shares a `tag` is **silent** on
  Android by default, so a second high-severity incident would quietly overwrite the first in the
  tray with no alert at all. Collapsing is still wanted; being silent about it is not.
- **`::-webkit-calendar-picker-indicator{display:none}` is now Safari-scoped.** On iOS the whole
  time field opens the picker so hiding the indicator is free; on Android Chrome that indicator
  **is** the element that opens it, so the schedule editor's time fields could have been typable
  with the picker unreachable.

**Reviewed and deliberately NOT changed:** `requireInteraction` on push (a judgement call about
how insistent an alert should be — worth a decision, not a silent default), and the body-scroll
shell, which uses no Android-incompatible syntax but has never been device-verified there.

### 8 — The rest
- **Leader contacts is PRE-CAMP ONLY on the church home** (`_contactsCardHtml` returns `''` at
  camp). Editing four emergency numbers is not something to invite while an incident is in
  progress. ⚠️ `RENDER.mycontacts` itself is **not** hard-gated — admin/director reach the same
  screen, and a hard mode gate has stranded real records on this codebase before (the 2026-07-17
  incidents revert). This hides a nav entry point, nothing else.
- **Testimonies & Notes: the record TYPE badge moved to the top-right**, beside the year level.
  It was the last item on a run-on grey footer line, so the one fact deciding whether a tile is
  worth reading moved horizontally depending on the church name's length. The name now
  ellipsises rather than shoving the badge off the row.
- **The Records filter is a dropdown-style multi-select** (`.msel`), replacing the chips, plus a
  new **Day** dropdown — four controls that tile as an even 2×2 on a phone. ⚠️ **Not a native
  `<select multiple>`** (needs ctrl/cmd-click on desktop, renders as a cramped scrolling box on
  iOS). Semantics are unchanged, including the important one: **an EMPTY set means ALL**, and the
  button reads "All records" rather than "0 selected", which says the opposite. Day matches on
  `localDateISO(n.createdAt)` — **Brisbane, not the UTC slice**, which would file everything
  logged before 10am local under the previous day. "Before camp" is a real option: incidents and
  notes genuinely get logged ahead of camp and would otherwise vanish the moment a day was picked.
- **The Schedule screen opens on TODAY** when today is a camp day, else day 1
  (`_schedDefaultDay`). It always opened on day 1, so from day 2 of camp every visit started on
  the wrong day — and day 1 is the one day nobody needs to look up.
- **The medical-consent tick carries the real consent clause** in a tooltip, on both the granted
  and not-granted states — the same text is what has *not* been agreed to when it is missing.
- **The alerts consent sheet is about a third of its old length.** ⚠️ Do not cut the lock-screen
  line or the "no names" line to shorten it further — those two are the substance of the consent.

### Two verification requests — answered, no code change
- **Renaming the Citipointe logins to `CP-<location>`: SAFE.** Church **name** and Elvanto import
  matching are keyed on `Church.name` (`import.service.ts` matches `Attendee's Church` against a
  lowercased name map); `username` is referenced nowhere in any of the three importers. The
  schema allows hyphens and capitals, and `_churchUserBase`'s `^[bg]-` strip round-trips
  `CP-Carindale` intact. **Three caveats, all operational:** (a) `account.service.updateUser`
  **lowercases every username on save**, so it will store and display `cp-carindale` — the login
  works, the capitals do not stick without a code change; (b) `ycp_initials_<username>` and
  `ycp_ciq_<username>` are keyed on the username, so **a rename orphans saved initials and any
  unsynced offline check-ins — let the queue drain before renaming**, and expect leaders to
  re-enter initials and re-save the credential in their password manager; (c) if one of a renamed
  pair is ever deleted, "Split church accounts" / "Randomise passwords" regenerates the sibling
  from `slugifyUsername(church.name)`, producing a mismatched pair.
- **Excel/CSV export: yes, for every dataset that matters.** The compliance workbook (`.xlsx`, 9
  sheets), sign-in/out CSV, registrants CSV, offline sign-in sheet (`.xlsx`), notes CSV, budget
  CSV, first-aid CSV and the passwords CSV all open in Excel. Gaps, all minor: **incidents**,
  **check-in history** and **reveal audit** have no standalone export and are reachable only
  inside the workbook (director/admin); **accommodation allocations have no export at all**.
  Registration lists are PNG/ZIP by design — the same roster is available as CSV elsewhere.


## Owner batch — the budget was discarding money a code said had been paid — 2026-08-02

Four owner items. `npm run typecheck` clean, `npx vitest run` **877 pass / 56 files** (was 870;
**+7**), `node --check` OK on the SPA body (range **927–8185**, re-derived) + `sw.js`.
`sw.js` `camp-v81`→**`camp-v82`**. **No schema or migration change.**

### 1 — 🟠 A DISCOUNT CODE'S TAG AND ITS INVOICES CAN DISAGREE, AND THE TAG DECIDES THE MONEY
Owner: *"the grey '50% off' next to `YC26YP` doesn't seem accurate — it's been classed as a full
sponsor."* **The pill was right. So was the tag. They contradict each other, and nothing said so.**

Measured against prod, not inferred: `YC26YP` has 2 people, `75/150` and `95/190` — **exactly 50%
off, both**. It is tagged `sponsor`. `personValue` hard-codes a `sponsor` code to **$0**, so **$170
that genuinely arrived is being counted as nothing.** (`VICTORY50` is the same 50% tagged
`discount` and is consistent — which is what makes `YC26YP` look like a mis-tag rather than a bug.)

> ⚠️ **THE TWO FACTS HAVE DIFFERENT AUTHORS AND THE SCREEN PRESENTED THEM AS ONE.** The grey pill is
> **measured** from the invoices; the dropdown under it is what a human **declared**, and the budget
> follows the declaration. Read together they look like one statement about the code, which is
> exactly why a straight contradiction survived unnoticed.

New `averageDiscountPercent` + `discountTagConflict` in `budget.ts` (mirrored as `_avgDiscountPct` /
`_discountTagConflict`); `DiscountCodeRow` gained `avgPercent` and `tagConflict`. The pill now reads
**"50% Off on invoices"** — naming its source — and a warnbox states the disagreement in full.

- **It REPORTS, it does not correct.** A code really can be a full sponsorship recorded badly
  upstream. The invoices are evidence, not authority; only a human knows which side is wrong.
  **Do not "fix" this by making the tag follow the money, or vice versa.**
- **`inperson` is never checked.** A code that zeroes an invoice because cash was taken at the desk
  is *expected* to read ~100% (prod: `YC26EFT`, `YC26CASH`), and a partial one is a legitimate
  part-cash arrangement. There is nothing to contradict.
- **`avgPercent: null` ≠ 0%.** Null means no invoice ever carried both figures; 0% means measured
  and full price. Only null suppresses the check — conflating them invents false alarms.
- `FULL_DISCOUNT_PERCENT` (97) is now **one constant shared** by the ticket-difference label and the
  sponsor check. They were the same judgement written twice.

### 2 — Classifying a code no longer resets the Budget screen
`_saveDiscountTag` called `RENDER.budget()` — a full screen re-entry that re-fetches, collapses
every `.budchurch`, and jumps to the top. The dropdown that triggers it lives in the **Discount
codes** card near the bottom of a long screen, so the admin was thrown back to the top once per
code they classified. Now **`_budRedraw()`**: a tag is applied at classification time and is not
stored on a person, so there is **nothing to re-fetch** — it recomputes from `window._budgetRegs`
and restores the open card ids + scroll position.

### 3 — Data Import: "Undo" → "Unallocate" on the designated list
`ovRow` takes an `actionLabel`; cardB keeps `Undo`, cardC says `Unallocate`. **Same `undoOverride`
call from both** — only the wording differs, because the two reversals mean different things
(back to the form's church vs back to the unallocated list).

> ⚠️ **THIRD OCCURRENCE OF THE SAME FLEX BUG.** The button was a bare `.btn`, whose base CSS is
> `display:block;width:100%` — and inside a flex row that `width:100%` becomes the **flex-basis**,
> so it claimed most of the row and squeezed the name to nothing. Fixed identically to the Confirm
> button in this same card on 2026-07-08: **`btn ghost sm`** (`.btn.sm` sets `width:auto`) +
> `flex:0 0 auto;min-width:92px`, with `flex:1;min-width:0` on the text block.

### 4 — "Accommodation overrides" moved to the allocations screen, collapsed
Off Admin → Accommodation setup (which is for naming rooms) and onto **Accommodation allocations**,
beside the map that shows where everyone sleeps. `_accomOverrideCard`, default-collapsed, summary
counts **how many are SET** (not how many churches exist — that is the question a closed disclosure
has to answer alone). Setup keeps a count + an "Open" button; the Churches tooltip was repointed.

- ⚠️ **It is rendered OUTSIDE `#accomBody`.** `drawAccom()` rewrites that div on every allocation
  change, so building the card inside it would slam the `<details>` shut — and drop a half-changed
  `<select>` — every time someone placed a group in a room.
- ⚠️ **Admin-only**, though the screen is director+admin: `PATCH /accounts/churches/:id` is
  `admin:manage`, so a director would get a control that can only 403.

## 🔴 `GET /import/allocations` had been 500ing for a MONTH + the allocation cards — 2026-08-01

Started as an owner request to collapse the Data Import cards; the follow-up report ("I still can't
see Designated from OTHER, and the screen doesn't update when I confirm an allocation") uncovered
two real defects underneath it. `npm run typecheck` clean, `npx vitest run` **870 pass / 56 files**
(was 866/55; **+4**), `node --check` OK on the SPA body + `sw.js`. `sw.js` `camp-v79`→**`camp-v81`**
(v80 the collapse, v81 the two fixes). **No schema or migration change.**

### 1 — 🔴 A TYPE CAST THAT WAS A LIE 500'd THE ENDPOINT FROM THE DAY IT SHIPPED
`supabase.allocation-override.ts`'s mapper read `createdAt: r['created_at'] as string`. **postgres.js
returns `timestamptz` as a `Date`**, so that cast compiled clean and handed the service a Date;
`listOverrides`' `b.updatedAt.localeCompare(a.updatedAt)` then threw
**`localeCompare is not a function`** on *every* call. Confirmed in the Vercel runtime logs — 11 of
11 calls in a 40-minute window returned **500**, on a feature live since **2026-07-03**.

> ⚠️ **THE SPA HID IT PERFECTLY.** `api('/import/allocations').catch(() => [])` turned a 500 into an
> empty array, so the screen rendered "Church overrides (0)" and — because `cardC` is gated on
> `designated.length` — **no Designated-from-OTHER card at all**. That is indistinguishable from
> "nothing has been allocated yet", which is why nobody reported it for a month. `_loadAllocation`
> now collects failures in `_allocErrs` and `_renderAllocCards` prints them above the cards. **Keep
> the catches** (one dead endpoint must not blank the screen) **but never discard the reason again.**

Fixed with `toISO()` in the mapper, matching what **every other repo in that folder already did**
(`(r['x'] as Date).toISOString()`) — this was the only one that cast instead of converting.
**A timestamp column must be CONVERTED at the mapper, never cast.** The mapper is now exported as
`toAllocationOverride` (the `toIncident`/`toNote` convention) with
`supabase.allocation-override.mapper.test.ts` beside it.

> ⚠️ **The test fixture MUST use real `Date` objects.** A fixture of ISO strings passes against the
> broken mapper and proves nothing — the same too-weak-fixture failure as the `VAPID_ENV`
> `'pub'`/`'priv'` placeholders. **Verified, not assumed:** reverting the mapper makes 2 of the 4
> tests fail with the exact production `TypeError`.

### 2 — Allocating someone didn't update the screen (30s client cache)
`allocatePerson`/`confirmOverride`/`undoOverride` all called `_invalidate('/registrants')`, which
does **not** match the `path.startsWith('/import')` branch — so `/import/unallocated` and
`/import/allocations` were never dropped from the SPA's 30s GET cache, and the `_loadAllocation()`
immediately after re-rendered the **pre-allocation** arrays. The write had genuinely succeeded (the
DB rows were there); only the screen was stale. All three now call `_invalidate('/import/…')`, and
that branch's `Cache.del` list gained `'/import'`.

⚠️ Standing rule this is the second instance of: **a write must invalidate the collection keys the
screen re-reads, and `_invalidate` matches on PREFIX** — passing a path that lands in the wrong
branch fails silently and looks like "the save didn't work".

### 3 — The cards themselves (the original request)
**Unallocated registrants**, **Church overrides** and **Designated from "OTHER"** are now all
`<details>` with **no `open` attribute**, count in the `<summary>`. Item 8 (2026-07-31) collapsed
only the third; this finishes it, so the CSV upload card stops being pushed off the fold.
**Do not add `open` to any of the three.**

**Unallocated registrants**, **Church overrides** and **Designated from "OTHER"** are now all
`<details>` with **no `open` attribute**. The count moved into each `<summary>`, so "is there
anything to do here?" is still answerable without expanding anything, and the CSV upload card —
the screen's actual primary job — stops being pushed off the fold by them. Item 8 (2026-07-31)
collapsed only the third one; this finishes the job. **Do not add `open` to any of the three.**

> ⚠️ **The "Override a church allocation" search input lives INSIDE cardB's `<details>`.** That is
> safe — a closed `<details>` keeps its children in the DOM, and `_renderOvSearch` null-guards
> `#ovSearchResults` — but do not move the search out of the disclosure on the assumption a
> collapsed card is unreachable. Same for the per-person church `<select>` (`#alloc_<id>`) that
> `allocatePerson` reads out of cardA.

**Where these cards live**, since this cost a round trip: **`RENDER.import`** — admin console →
**Data Import** tile, or the pre-camp bottom-nav Data Import tab. **Not** Admin → Settings, **not**
Records & Export.

> **Debugging lesson: the DB said the feature was fine and it was not.** Querying
> `allocation_overrides` over MCP showed 6 healthy rows with `kind='unallocated'`, and reading the
> SPA showed correct render logic — so the first two rounds of diagnosis concluded "this should be
> working". **The MCP SQL tool serialises timestamps to strings, which is exactly the difference
> that was breaking production.** What settled it in one call was
> `get_runtime_logs(query='/import/allocations')`. **Reach for the runtime logs before re-reading
> code that looks correct.**

## Budget: family invoices were silently unpriced, + ticket prices are now DERIVED — 2026-08-02 (3rd)

`npm run typecheck` clean, `npx vitest run` **866 pass / 55 files** (was 850; **+16**), SPA + `sw.js`
`node --check` OK, `sw.js` `camp-v78`→**`camp-v79`**. No schema change.

Two owner questions, one root cause between them: **the budget could not price a ticket it had not
seen an invoice for.**

### E — 🔴 A SHARED FAMILY INVOICE ZEROED EVERY PERSON ON IT
Owner: *"why are a bunch of tickets showing as $0 with no discount code?"* Measured against prod:

| people on invoice | invoices | had money | missing |
|---|---|---|---|
| 1 | 153 | **all** | 0 |
| 2 | 26 | **none** | 52 |
| 3 | 4 | **none** | 12 |

**64 of 217 people, ~$11,760 of ticket value.** Not a matching failure — a deliberate branch in
`invoice-import.service.ts` that withheld the money from everyone on a multi-registrant invoice,
reasoning *"cannot attribute a shared total to individuals"*.

> ⚠️ That reasoning was true of the TOTAL and false of the INVOICE. We know each person's ticket,
> and the ticket has a price. A $340 invoice covering a $190 classroom and a $150 tent is not
> ambiguous at all. **A defensible-sounding rationale hid the single biggest hole in the budget for
> weeks** — the withheld money looked exactly like a $0 ticket, which is why the owner read it as a
> data problem rather than an import one.

Fixed: shared invoices are **split**. Weight by each person's ticket price when all are known (exact
when the invoice equals the sum of the tickets; apportions a shared discount in proportion when not);
equal split **plus `needsReview`** when any price is unknown, because that one really is a guess.
`splitExact()` uses largest-remainder so the parts sum to the invoice **exactly** — a per-person
`Math.round` drifts cents and the camp total stops matching the sum of its own rows.

**This is backfilled by re-importing the Billing Contacts CSV — the fix cannot repair rows already
stored as null.** Tell the owner that explicitly; a code deploy alone changes nothing here.

### F — Ticket prices are DERIVED from the invoices, not configured
Owner: *"what if there is a standard tent and an early bird tent price?"* There is no answer with two
scalar settings, which is what `tentPrice`/`classroomPrice` were.

**The price was already in the data.** `registrationCost` comes from the invoice and each ticket type
has exactly one distinct cost (prod: `Classroom Accommodation` $190 × 108, `EARLY BIRD | Tent
Accomodation` $150 × 45). New `src/services/ticket-prices.ts` + SPA mirror learns a price per ticket
type; a standard-tent ticket prices itself the day its first invoice lands, with nothing to maintain.

`personValue`'s in-person cascade is now **their own `registrationCost` → the learned price for their
ticket type → the scalar setting**. The settings survive only as a last resort for a type nobody has
an invoice for, and the Camp settings section is relabelled "(optional)" to say so.

> ⚠️ **Tie-break in `buildTicketPriceTable` is deliberately the LOWER price.** This values money as
> *received*, so guessing high invents income nobody paid. `distinctCosts > 1` is the flag for an
> ambiguous type. Do not "improve" it to `max`.

Consequences worth knowing:
- The grand total went **$24,290 → $26,340** on the in-person cascade alone (+$2,050), *without
  anyone entering a price*. Verified by running both implementations over a real 217-person dump —
  server and SPA agreed to the cent, with the settings both blank and set.
- The upgrade card from section D now works with the settings blank: it finds the $190 classroom
  reference itself and reports **$40 upgrade, $160 outstanding**.
- The old "set the ticket prices" warning **fired on an empty setting, which no longer means
  anything**. It now fires on a *measured* failure — a person who paid in person whose ticket type
  has no price from any source — and names the ticket type. That is the only case a human must fix.

## Budget: in-person pricing was inert, + tent→classroom upgrade tracking — 2026-08-02 (2nd)

`npm run typecheck` clean, `npx vitest run` **850 pass / 54 files** (SPA-only change), SPA + `sw.js`
`node --check` OK, `sw.js` `camp-v77`→**`camp-v78`**. No schema change.

### C — 🟠 "PAID IN PERSON SHOULD BE VALUED AT THE TICKET PRICE" — IT ALREADY WAS. THE WARNING WAS HIDDEN.
`_personValue` has returned the base ticket price for an `inperson`-tagged code since 2026-07-29 and
the logic was never wrong. **Prod had `settings.tent_price` and `classroom_price` NULL** (verified by
query, not inferred), so every in-person ticket fell through to `amountPaid` — usually 0 — and the
owner reasonably read the `10 × $0` on the card as "this isn't being counted". Real impact: **11
people, ~$2,050 missing from the grand total** at the camp's own prices.

> ⚠️ **THE WARNING THAT SAID EXACTLY THIS ALREADY EXISTED AND WAS USELESS.** It was rendered inside
> the *Discount codes* card — **collapsed by default, second column**. A warning behind a closed
> disclosure is not a warning. This is the second time a correct-but-invisible signal has cost real
> debugging time on this screen. **Do not move it back inside a collapsible.**

Now `priceGate`, at the very top of the budget body, stating the consequence (*"N people paid in
person … the total below under-reads"*) rather than just naming a setting, with an **Open Camp
settings** button — admin only, because `adminSettings` is admin-gated and a director would bounce.

**Before diagnosing any budget figure as wrong, check the two prices are set.** Almost every "the
budget is under-reading" report will be this.

### D — Tent → classroom upgrade tracking (new)
Owner: show who paid the tent→classroom upgrade vs who is in a classroom without it. The signal is a
**divergence between two fields that normally agree**, because one is derived from the other at
import:

- `registrationType` — the verbatim Elvanto ticket (`"EARLY BIRD | Tent Accomodation"`).
- `accommodationKind` — where they actually sleep. Starts as the mapped ticket type, then is
  overwritten by the **church accommodation override**, whose stated purpose in `import.service.ts`
  is *"corrects wrong ticket-type purchases"*.

So `accommodationKind === 'classroom'` **while the ticket says tent** is the upgrade population.
Nothing else identifies it: money alone cannot, because a $150 classroom person and a $150 tent
person are identical once you stop looking at the ticket.

Verified against prod: **5 people, all at Carindale.** Four paid $150 and owe the $40 difference;
one paid $190 against a $150 ticket, i.e. already upgraded. Those four are exactly the `4 × $150`
that used to be buried in the Classroom row's run-on breakdown line.

- **`_budTicketKind` mirrors `mapTicketType`** in `src/services/ticket-import.service.ts` — substring
  match, **classroom tested first** (`"Classroom Accommodation"` contains neither trap, but a future
  `"Tent → Classroom Upgrade"` ticket name would hit both). Drift there silently mis-sorts people.
- **Sponsor / discount / in-person classes are excluded on purpose.** A sponsored classroom place is
  $0 by design; listing it as "hasn't paid" would put a real person on a debtors list wrongly. Only
  the plain `classroom` class is considered.
- **"Paid the upgrade" has two definitions and both ship**, because the definitive one needs a
  setting the camp may not have filled in: classroom price set → did they reach it; not set → did
  they pay *more than their own ticket cost*. The fallback correctly finds the one $190-against-$150
  person with both prices still NULL. The **amount owed** is only shown when the price exists — no
  invented numbers.
- People with nothing recorded are a **third bucket**, not defaulted into "hasn't paid". We don't
  know, and the card says so.

## Owner follow-up: Home-return jitter + budget cards merged — 2026-08-02

Two owner reports against the 2026-08-01 build. `npm run typecheck` clean, `npx vitest run`
**850 pass / 54 files** (unchanged — both changes are SPA-only), SPA + `sw.js` `node --check` OK,
`sw.js` `camp-v76`→**`camp-v77`**. No schema change; next migration is still `0021`.

### A — 🟠 THE VIEWPORT KICK HAD A SECOND, DIFFERENT JITTER: A COLLAPSE-AND-REKICK LOOP
The 08-01 fix held for the two triggers it was written for (launch, keyboard dismiss — owner
confirmed both). What survived was *"the whole screen jitters occasionally when returning to the
Home screen"*, and it is **not the same bug**, which is why the 08-01 guards did not catch it.

08-01 was a *feedback* loop — our kick caused a resize, the resize listener kicked again. This one
is a **collapse** loop, and it needs iOS to be *cooperating*:

> Home's content is shorter than the viewport, so the document is not scrollable. The kick makes it
> scrollable for two frames and iOS grows the view — then `restore()` puts the height back, the
> document is un-scrollable again, and **iOS collapses the view straight back**. The shortfall
> returns, the verify-retry sees it, kick again. It stopped only when `_vpTries` hit `_VP_KICK_MAX`,
> i.e. **it ran out of budget rather than succeeding.**

> ⚠️ **THE RETRY CHAIN WAS CONFLATING TWO OPPOSITE FAILURES** — "iOS ignored the kick" and "iOS
> accepted the kick and then undid it". Retrying is right for the first and actively harmful for the
> second, because each retry buys another visible chrome animation and the collapse is guaranteed to
> follow. Any future change here must keep them distinguishable.

Fixed with **the latch** (`_vpLatched` / `_vpLatchValue()` / `_vpApplyLatch()`): once a shortfall has
been seen on this device, `<html>` keeps a permanent `min-height` of **`screen.height + 1px`**, so the
document stays scrollable by that 1px even on a short screen and iOS has no reason to collapse. The
kick then only has to land once.

- **`screen.height`, not `100%`/`100dvh`.** Every viewport-relative unit reports the SHORT height in
  the bug state — that is the nature of this bug — so a percentage would latch the document to
  exactly the height it must exceed. `screen.height` is the only true reference (same reason
  `_vpShortfall()` uses it).
- **The latch is applied BEFORE `prev` is captured** inside `_vpKick`, so `prev` *is* the latch and
  `restore()` stays a single write. Applying it after the capture restores the pre-latch height and
  the loop survives the first kick.
- **It is never released.** Releasing it is precisely what re-creates the collapse. Total cost: 1px
  of scroll travel on otherwise-short screens, iOS standalone only, only after the bug has actually
  been observed on that device.
- Re-applied on `orientationchange` — `screen.height` is orientation-adjusted, so a stale latch would
  be far too tall in landscape.

Also tuned, all secondary to the latch: `_VP_KICK_SETTLE` 500→**800** (covers the chrome animation),
`_VP_KICK_MAX` 5→**3**, and the retry now **backs off** (`_VP_KICK_VERIFY × _vpTries` = 1.2s, 2.4s,
3.6s). A device that ignored two kicks will not answer a third delivered fast, and every attempt costs
a visible animation.

> **Proven, not assumed.** `scripts/vpkick-harness.js` gained scenario 6, which models iOS collapsing
> the view on a non-scrollable document. Neutering the latch makes it fail 3 of its 4 checks
> (1 kick → 3, shortfall unresolved, budget exhausted) — the command is in the script header. The
> harness's kick probe also moved from the `min-height` write to the **1px scroll**, since the latch
> now writes `min-height` permanently; the scroll is the real mechanism anyway.

### B — Budget cards: campers and leaders merged into one row, detail behind a tap
Owner: still hard to follow, *"especially just below the 'Classroom' subheadings"*. The 08-01 rebuild
fixed the wrapping but kept the underlying shape — campers rows and leaders rows as two separate
labelled lists — so **"Classroom" appeared twice with two different sets of numbers**, and neither
was the figure a director wants (what did this ministry owe for classroom?). Under each sat the
run-on `↳ 72 × $190 · 4 × $150 · 43 × $0`.

Now one row per category, campers + leaders summed, tap to open: the audience split (Campers /
Leaders, which the owner asked for) and the price breakdown as an **aligned mini-table** in the same
columns as the row above it. The screenshot's card goes from 4 rows + 4 sub-lines + 2 section
headings to **2 rows**. A row is only tappable when it has something behind it (both audiences, or
more than one price, or a code) — a dead chevron is worse than none.

- **`_budMergeScopes()` is display-only and deliberately client-side.** It changes no computed value;
  every field is a sum of fields `budget.ts` already produces. **Do not mirror it into
  `src/services/budget.ts`**, and **do not delete `church.campers` / `church.leaders`** — the CSV
  export still walks them unmerged, which is the right shape for a spreadsheet.
- Two merges that can assert something the data does not support, both guarded and both worth a test
  if this is touched again: **`codeHint` survives only if every contributing scope reported the same
  code** (campers all on `YC26EFT` + leaders all on `YC26LDR` must not render as "all YC26EFT"), and
  `valueBreakdown` counts are added per distinct value so the panel still sums to `count`.

## Independent review of the 2026-07-30/31 work — five defects fixed + budget cards — 2026-08-01

An independent review of the previous two days (30 commits, ~8,600 insertions) against the
then-current `HEAD` (`57e0dc2`). The gate was re-run and confirmed the claims below it:
`npm run typecheck` clean, `npx vitest run` **832 pass / 54 files** as documented. Five defects
were found, all fixed here, plus the owner's Budget-screen rebuild and a follow-up fix to the
2026-07-31 viewport kick. `npm run typecheck` clean, `npx vitest run` = **850 pass / 54 files**
(was 832; **+18**). SPA + `sw.js` `node --check` OK. `sw.js` `camp-v74`→**`camp-v76`**
(v75 budget cards, v76 viewport jitter). **No schema or migration change** — next migration is
still `0021`.

### 1 — 🔴 THE PUSH FAN-OUT COULD NOT FINISH INSIDE `maxDuration: 30`, AND FAILED PERMANENTLY
The block comment sized the per-tick cap against *"concurrency 10 and ~325ms/send"* and concluded
a capped tick cost **~3.5s**. **That concurrency was never implemented.** The loop was strictly
sequential AND slept the jitter *before every individual send* (`sleep(random() * PUSH_JITTER_MS)`,
mean 2000ms), so a full-cap tick cost `40 × ~2325ms ≈ 93 SECONDS` against a 30s ceiling — killed at
roughly send 13 of 40.

> ⚠️ This does not degrade gracefully, which is why it ranked above everything else found.
> `claimForPush` sets `push_sent_at` BEFORE the send loop and **the claim is permanent**, so every
> notice not reached before the kill is never pushed and never retried. Realistic trigger: 26
> church logins hitting their window boundary together at one device each ≈ 60s → about half the
> churches silently never get their check-in warning.

Fixed: sends are flattened to one task per notice×device, each awaits its own jitter *in parallel*,
then passes through a small counting semaphore (**`PUSH_SEND_CONCURRENCY = 10`**). Worst case is now
`PUSH_JITTER_MS + ceil(N / PUSH_SEND_CONCURRENCY) × ~325ms` ≈ **5.3s** for a full cap. New
**`PUSH_TICK_BUDGET_MS = 30_000`** records the ceiling the arithmetic must respect. **Latent, not
live** — prod had 2 subscriptions, so it would have first failed at camp scale, after the training-day
install.

### 2 — 🔴 A notice larger than the per-tick cap could NEVER be sent
`if (item.subs.length <= budget)` with `budget` starting at 40 meant a notice with 41+ subscriptions
failed on **every** tick, forever — deferred 288 times a day until it expired. The reachable case is
the worst one: an **urgent camp-wide notice** reaches every login (~104+ subscriptions). The comment's
defence ("the next tick picks it up") holds for many small notices, never for one large one.
Fixed with a forward-progress guarantee: when nothing else is claimable, the **largest** notice is
claimed **alone** (safe now that the send loop has real concurrency).

> ⚠️ **`PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS` WAS FIRST SET TO 200 FROM THE WRONG NUMBER** —
> "~156 = 26 churches × 6 devices". That undercounts twice: prod has **28** churches and **every
> church has TWO gender-scoped logins** (`b-`/`g-`), so a camp-wide notice reaches ~56 church
> accounts plus oversight — ~224 sends at 4 devices each, i.e. **over the ceiling**, so the single
> most important notice the system can send would still have been dropped. Now **400**, derived
> from the time budget (~17s) rather than a headcount, so it survives the camp growing again.
> **Size this against the ACCOUNT count, never the church count.**

A notice past the ceiling now logs `NOT SENT` naming the id and size (no title/body — the
lock-screen rule). The original bug was hard to find precisely because `deferred` was counted and
never surfaced; it must never fail silently again. It is deliberately **not claimed**, so raising
the ceiling later still delivers it.

### 3 — The 587 lines of push tests were structurally incapable of catching #1
Every test injected `sleep: async () => {}`, so wall-clock cost was never modelled. Same failure
shape as the `VAPID_ENV = 'pub'/'priv'` fixture that let table-text reach production: **a fixture
too weak to exercise the class of bug it appears to cover.** Timing is now modelled with fake
timers, a stubbed 325ms send latency and worst-case jitter, asserting completion inside
`PUSH_TICK_BUDGET_MS`. These fail against the old loop (~173s of virtual time needed). A further
test pins the ceiling's observability and that an over-ceiling notice stays unclaimed.

### 4 — `canSeeNotification` did not enforce expiry, though it claimed to
It is documented as the SINGLE SOURCE OF TRUTH for audience "including expiry" and is used in both
directions (feed, and the push audience resolver) — but there was no `expiresAt` check. Harmless in
practice because both callers pre-filter via `findActive()`; a live trap for the next caller, since
passing `findAll()` results would push **expired** notices to phones. The check is now in the
function (belt-and-braces with `findActive()`, verified against every caller first) and the
docstring describes the relationship honestly.

### 5 — Same-day duplicate registrations were still not ordered
The item-7 sort (2026-07-31) keyed on `normalizeDate`, which is **date-only by contract**. Verified
against the real export (`../Sample Data New/Form-Submissions_*.csv`): values are date-only
`DD/MM/YYYY` (`21/05/2026` confirms day-first), so the sort *does* work and its `rowNum` tiebreak is
correctly stable — **but two submissions on the SAME DAY tie** and fall back to original file order,
which Elvanto does not guarantee is chronological. "Register, then re-register an hour later to
upgrade" is a same-day action, so the exact scenario the fix was written for was the one case it
could not order.

New **`submissionSortKey()`** in `elvanto-mapping.ts` (a SEPARATE helper — `normalizeDate` keeps its
date-only contract, other callers depend on it) keeps a time component when the cell has one and
parses today's date-only format identically. When duplicates genuinely tie, the warning now says the
file's order **could not** determine which is most recent and to check by hand, instead of falsely
promising "latest wins".

> ⚠️ **A 12-HOUR TIME MUST BE CONVERTED, NOT TRUNCATED.** The first version of this helper accepted
> `2:32 PM` and dropped the meridiem, yielding `02:32` — sorting an afternoon submission BEFORE an
> 11:00 AM one and silently inverting the merge the key exists to guarantee, with no warning because
> the key still looked valid. The 12am/12pm boundary is the case naive `+12` arithmetic breaks;
> there are tests for both.

### Budget screen — cards restructured (owner request)
> *"almost impossible to follow in terms of quickly understanding code usage and total money for
> each ministry."* Owner reviewed three options and chose **keep the cards, restructure each one** —
> a summary table and a two-tab split were both explicitly REJECTED. Don't reintroduce them.

Each category row is a fixed 3-track grid (`.budrow`, `minmax(0,1fr) auto auto`): label truncates
with ellipsis, quantity and amount never wrap or shrink; code chips and value breakdowns move to
their own `.budrow-sub` line. Four specific fixes, all owner-selected:
- **`11 × —` is gone.** An em-dash unit price on a mixed row read as missing data; rows now show a
  people count plus a real breakdown (`9 × $105 · 2 × $0`).
- **The duplicated `Church total` row is gone** — the card header already carries it.
- **The code-usage denominator is unified.** The card said `4 of 15` while the camp-wide panel said
  `2 used of 217` — the same kind of fact against two different denominators (church vs camp
  registrants), the single most confusing thing on the screen. The card now shows a plain `×N` chip
  and the panel leads with the same chip, demoting the ratio to quiet secondary text.
- **Per-church codes render as a compact inline chip row**, so "which codes did this ministry use"
  is answerable without expanding anything.

⚠️ **`valueBreakdown` was added to BOTH `src/services/budget.ts` and the SPA mirror**, not
client-side only — the two copies drifting is a documented recurring failure here. `Bucket.values`
became a `Map<value,count>`; `Σ breakdown counts === row.count` always, and the
grand-total-equals-sum-of-rows invariant is unchanged and still tested. Per-church code counts are
still **derived by scoping** `computeDiscountCodeSummary`, never counted a second way.
**Not device-verified** — needs an eyeball at ~360px (ellipsis on long church names, `.budchip-row`
wrapping) and at ≥980px (the `.bud-grid` split).

## ✅ The viewport kick no longer jitters — the fix was self-triggering — 2026-08-01

Owner: *"when the horizontal bar pull down triggers, half the time it will jitter up/down rapidly
(10 times within 1 second) then it will be correctly pulled down."* SPA-only. `sw.js` → `camp-v76`.

### Root cause: `_vpKick` re-entered the resize it caused
A kick changes layout, so iOS fires `visualViewport.resize` — and that listener scheduled **another**
kick 120ms later. The cooldown was measured from the kick's START, so an echo landing after it had
lapsed passed the guard and kicked again, firing another resize. On top of that the launch volley
`[120,400,900,1600]` was four **uncoalesced** timers stacking onto the echoes. Every kick makes iOS
animate its chrome, and that animation is the visible jitter. It settled only once the shortfall hit
0 and every path began early-returning — hence "jitter, then correct", and hence intermittent.

> The old comment claimed *"each attempt early-returns the instant the shortfall is 0, so at most one
> of these does any work."* That is only true once a kick has **already succeeded**, and iOS does not
> resize instantly. Treat that sentence as the lesson: the guard you reason about statically is not
> the guard that runs during a 600ms animation.

### Three rules now, all load-bearing
1. **Coalescing** — every trigger goes through `_vpKickSoon`, which REPLACES the pending timer, so a
   burst collapses to one kick.
2. **Echo suppression** — a resize within `_VP_KICK_SETTLE` (500ms) of our own kick is OUR echo and
   is ignored. This is the loop-breaker. **Do not call `_vpKickReset()` from the resize listener** —
   resize is the echo path, and resetting there restores the unbounded oscillation.
3. **Verify-then-retry** — the fixed volley is GONE. `restore()` schedules one re-measure; only a
   surviving shortfall kicks again, capped at `_VP_KICK_MAX` (5) roughly 1s apart.

⚠️ **`_VP_KICK_VERIFY` MUST stay greater than `_VP_KICK_COOLDOWN`**, or the retry lands inside its own
cooldown, early-returns, and the chain dies silently after one attempt.

⚠️ **A COOLDOWN BLOCK MUST RESCHEDULE, NOT DROP.** Because `_vpKickSoon` coalesces by *replacing* the
pending timer, a late resize echo can cancel the verify-retry queued by `restore()`; if that
replacement then lands inside the cooldown and simply returned, the chain would die and a device that
ignored the first kick would never be kicked again — the fix silently stopping after one attempt.
**This bug was in the first version of this fix and was caught only by the harness below.**

### Verified in isolation — `scripts/vpkick-harness.js` + `scripts/vpkick-compare.js`
The real functions are extracted from `public/index.html` and run against stubbed globals and a fake
clock (`node scripts/vpkick-harness.js <extracted.js>`; the extraction ranges are in the script
header). Five scenarios pass: cooperative launch = **exactly 1 kick**; iOS ignoring = capped at 5,
spaced ≥900ms; 5 rapid triggers = **1 kick**; fast echo = bounded; focused input = **no kick**.
The comparison run against the previous commit's code, on a device modelled as never accepting:

| | kicks in 12s | spacing | stops? |
|---|---|---|---|
| Old (as shipped 2026-07-31) | **20**, unbounded | ~608ms | never |
| New | **5** | ~944ms | yes, capped |

Two harness failures on the way were STUB bugs, not code bugs, and are worth knowing before reusing
it: **`_vpIsIOS` reads a BARE `navigator`**, not `window.navigator`, so a sandbox without it throws
and every kick silently early-returns; and **`_vpKickAt` initialises to `0`**, so a fake clock
starting at `0` blocks the very first cooldown check — start the clock at a real epoch value.
Modelling the iOS chrome animation as a **stream** of resize events rather than a single echo is what
exposed the retry-chain bug; a single-echo model shows nothing.

### The readout gained `kick tries`
`_vpTries + ' / ' + _VP_KICK_MAX`, beside `kicks fired` (five taps on the header title). `kicks fired`
alone cannot tell a smooth single kick from an oscillation. On a good launch this reads **1 / 5**;
climbing toward 5 means iOS is genuinely ignoring the kick, while a high `kicks fired` with `tries`
back at 0 means repeated NEW triggers, not a runaway chain.

**Still device-only.** The failure mode stays deliberately benign: if iOS ignores us the shortfall
simply remains and the result is the old tall bar, never a clipped nav.

## 14-item owner batch — reveal audit, admin accounts, church contacts — 2026-07-31

Owner bug/improvement list (14 numbered items). Backend + SPA + **migration `0020`**
(`reveal_audit`, **applied to prod and history-reconciled to `'0020'` BEFORE the code push**).
`npm run typecheck` clean, `npx vitest run` = **832 pass / 54 files** (was 794/49; **38 new**).
SPA + `sw.js` `node --check` OK. `sw.js` `camp-v73`→**`camp-v74`**.

### 5 — Sensitive reveals are now a real, exportable audit (migration `0020`)
Before this, the ONLY trail for a Medicare or contact reveal was a `logger.info('[audit] …')`
line in the Vercel runtime logs — which the owner cannot read, cannot export, and which rolls
off. New `reveal_audit` table + entity + repo trio + `reveal-audit.service.ts`, surfacing as the
**"Sensitive Reveals"** sheet in the compliance workbook (When / What / Student / Church /
Account / Role / Leader initials).

- ⚠️ **THE REVEALED VALUE IS NEVER STORED.** No number, no fragment. `people.medicare_number`
  and `parent_phone` are encrypted at rest precisely so a database reader cannot see them; an
  audit table holding a plaintext copy of everything anyone looked at hands back exactly what
  that encryption removes. There is a test asserting the row's key set, so adding such a field
  fails the suite.
- **`record()` NEVER THROWS.** A first-aider standing over an injured child needs the number
  more than the camp needs a perfect log. On failure it logs and returns null; the log line is
  the fallback trail, i.e. exactly what existed before the table.
- **Covers medicare AND contact reveals** (owner's choice), as three `kind`s —
  `medicare` / `parent-contact` / `leader-contact`, constrained by a CHECK so a typo can't
  create a silent fourth category.
- **It resolves the ACCOUNT USERNAME, not `actor.displayName`** — a church displayName is the
  church name and is IDENTICAL for the `b-` and `g-` logins, so recording it alone could not
  answer "which login revealed this". One indexed `userRepo.findById` per reveal; a reveal is a
  deliberate human tap, not a per-request cost.
- `person_name`/`church_name` are denormalised and there is deliberately **no FK to `people`** —
  the audit must stay readable after a rollover deletes the person, and a cascade would erase
  the record of the reveal along with its subject.
- Purged by **`reset()`, `resetLogs()` AND `newYear()`** (the standing "a new repository must be
  added to all of them in the same commit" rule).
- The two first-aid page notes were reworded to describe what is actually recorded.

### 2 — Secondary admin accounts; the ORIGINAL admin is protected
`createUser`/`updateUser` no longer refuse `role: 'admin'`. A secondary admin is a **full peer**
— it can do everything including creating further admins.

> **`findOriginalAdmin(users)` = the EARLIEST-CREATED admin** (id as a deterministic tiebreak).
> Deliberately NOT hard-coded to the seed id `user_seed_admin`: a new-year rollover or a fresh
> deployment can produce a working camp whose first admin has a different id, and a constant
> would leave those installations with no protected account at all.

The original cannot be **deleted, deactivated or demoted** — by anyone, **including itself**. It
is the recovery account. `reset()` keeps ALL admins (not just the original): reset requires an
admin actor, so deleting secondary admins would let one destroy its own account mid-wipe.
SPA: `admin` is in the role picker (with a warning box), admins appear on the Accounts screen
with an "Original" pill, and the original renders **without** a delete button — offering a
button that can only 403 is worse than not offering it. Admin accounts stay non-previewable.

### 12 — Notices auto-expire 6 hours after PUBLISH
`NOTICE_TTL_HOURS = 6` + `defaultNoticeExpiry(publishAt, explicit?)`. Measured from
`scheduledFor ?? createdAt`, **not composition** — a notice written Monday to publish Thursday
must live six hours after it appears, not expire two days before anyone can see it.
`findActive()` already filters on `expiresAt`, so this alone drops it off Home and Notices
together. **Rescheduling moves the expiry with it.** An explicit `expiresAt` still wins — this
changed the DEFAULT, not the capability. System notices (check-in warning, incident alert) set
their own expiry and never come through here.

### 11 — Church logins set their own four leader contacts
New capability **`church:contacts:write`** (church + director + admin) and a NARROW route
`PATCH /accounts/churches/:id/contacts` with its own `UpdateChurchContactsSchema`.

> ⚠️ **The capability is not the gate.** `updateChurchContacts` also checks
> `actor.churchId === id` for non-oversight roles — without it any church could rewrite every
> other church's emergency numbers. And the schema is separate from `UpdateChurchSchema` on
> purpose: a shared schema is one `.optional()` away from letting a church rename itself or move
> its own zone. There is a test asserting a name/zone/override sent to this endpoint is ignored.

SPA: new `RENDER.mycontacts` screen (**and its `<section class="screen" id="mycontacts">` in the
shell** — a missing one of those is the 2026-07-17 blank-screen bug) reachable from a
**"Leader contacts"** card on BOTH church home variants. Field ids are identical to
`RENDER.adminContacts`' so `saveContacts` is shared verbatim; that function now posts to the new
narrow route for every role. Owner chose all four contacts, not just the login's own gender.

### 7 — Duplicate registrations (the "delta cost to upgrade" case)
- **Form import now processes rows in `Date Submitted` order** before merging. The merge was
  already "latest wins, but a blank cell never clobbers a known value" — which is exactly the
  behaviour wanted — but it only gives the right answer if the latest submission is processed
  LAST, and the Elvanto export does not guarantee chronological order. The sort is **stable**
  and undated rows sort first, so a file with no `Date Submitted` column keeps its original
  order exactly (nothing regresses). ⚠️ **`rowNum` is captured from the ORIGINAL position** —
  reporting a sorted index would point the admin at the wrong line of their spreadsheet.
- A repeat name in one file now raises a **warning** naming the person; silent merging is
  correct but invisible.
- **Invoice accumulation was VERIFIED, not rewritten** — `moneyByPerson` already sums
  `amountPaid`/`discountAmount`/`feesAmount`/`taxAmount` across rows in a run, takes
  `registrationCost` from the latest row, sets `needsReview`, and is idempotent on re-import.
  New tests pin all of it (a $150 ticket + a $40 delta reads as $190 paid, not $40).

### 1 — Per-church discount code counts on Budget
`ChurchBudget.discountCodes` (+ the SPA mirror in `computeBudgetClient`) — rendered inside each
church's expandable row via `_budChurchCodes(c)`. **Derived by scoping
`computeDiscountCodeSummary` to the one church, never counted again**, so the per-church numbers
cannot disagree with the camp-wide card. Read-only there on purpose: the classification dropdown
stays camp-wide, because a tag applies to the CODE across the whole camp — two editable copies
would read as a per-church setting and it isn't.

### The rest
- **4 — the Site map button is gone from the first-aid Search landing.** firstAid has no Home
  screen (`RENDER.home` redirects it here), so that was the role's only map route; every other
  role keeps its Home hero Map button and `RENDER.sitemap` is untouched. ⚠️ The explanatory
  comment sits INSIDE a JS template literal — it must never contain a backtick (it did, once,
  and took the whole script out).
- **6 — revealed numbers are diallable.** The reported case: first aid reveals a parent's number
  and then has to retype ten digits. The reveal control is a `<button>` (it has to be — the
  reveal is an audited action), so on success it is **replaced with an `<a href="tel:">`**
  rather than trying to make one element be both. The students-search `reveal()`, which only
  toasted the number into a message that vanishes, now opens a sheet with a Call button. The
  Data tab's Mobile column runs through `telLink`.
- **8 — the Data Import overrides card is SPLIT.** It was conflating finished work
  (`kind === 'unallocated'` — designated from OTHER) with deliberate manual corrections.
  Designated-from-OTHER is now its own **default-collapsed** section below; both people lists
  scroll internally at `ALLOC_VISIBLE_ROWS = 4` (mirrored by `.alloc-scroll`'s max-height —
  change both together). Undo behaves identically from either section.
- **9 — the admin Settings save button floats** (`.setg-save`, `position:fixed` above the nav,
  z-index 105). ⚠️ Fixed, never absolute — the phone `.app` grows with content and is not
  viewport height. A `.setg-savepad` spacer keeps the last section clear.
- **10 — the "Your day · N still to check in" card is hidden during the sign-in phase**
  (`campPhase()==='signin'`), so day 1 doesn't show a backlog for a session that hasn't opened.
  Do NOT re-derive this from the day number — `SETTINGS.campDay` is the preview-only toggle.
- **13 — the Testimonies & Notes "Record" dropdown is now multi-select chips** (`NOTE_CATS`,
  `NOTE_CAT_OPTIONS`, `_toggleNoteCat`). ⚠️ **An EMPTY set means ALL** — it is a normal state you
  reach by deselecting the last chip, and showing nothing there would look broken. Chips rather
  than `<select multiple>`, which needs ctrl/cmd-click on desktop and is a cramped scrolling box
  on iOS.
- **14 — a collapsed "Leaders" sub-menu on Students → My group** (`_loadMyLeaders`,
  `_sortLeaders`, `leaderRow`), below "Not signed in". Signed-in first, then alphabetical by
  FIRST name. Leaders are excluded from the check-in roster and from the "Not signed in" list,
  so no screen answered "which of my leaders are actually here". ⚠️ **Scope is NOT computed
  client-side** — both feeds are already narrowed by `canAccessPerson`; re-deriving the gender
  rule here is how a `b-` login ends up seeing the girls' leaders. Filtered by zone/gender but
  NOT by grade (a leader has no grade; any year level would empty the list).

### 3 — Churches (data operation, not code)
The owner's master list holds 28 real churches; prod had 15. The 15 missing were created (zone
Yellow, with `b-`/`g-` logins) and **`Citipointe North` was merged into
`Citipointe North (Caboolture)`**. ⚠️ Names must match the Elvanto export string EXACTLY or the
Form import auto-creates a duplicate on the next run. `Connect Church Caboolture` is in prod but
not on the master list and was left alone — it has a real person attached.


> **Scope:** the real **camp** app — TS/Express backend (`src/`) + `public/` SPA. The offline demos live in `../youth app demo/CLAUDE.md` (that folder is the Vercel deploy source for the **demo** at `yc-camp-demo`). **This repo auto-deploys the real app to https://my-youth-camp.vercel.app on push to `master`.** Project map: `../CLAUDE.md`. Sibling app: `../youth-allocation-platform/CLAUDE.md`. Change workflow: `../CHANGE-PROMPTS.md`.

Guidance for Claude Code when working in this package. Read this before editing.

> **📋 Check `docs/PLANNED-IMPROVEMENTS.md` every time you read this file.** It holds an
> approved-but-unbuilt design (discount codes → "paid in full" budget classification) and a
> list of topics the owner wants questioned/scoped in a future session (editor initials, sign-in
> UX, time-lock behavior outside camp dates, etc). Keep flagging it here until it's cleared out.

## What this is

A **combined** youth camp management platform that merges two previously separate apps:

- **Hub** (pre-camp): registrant management, accommodation allocation, blue card & payment tracking, registration codes, FAQ
- **Portal** (at-camp): daily check-in (twice daily), student notes, zone notifications, schedule, devotionals, contact search, CSV import

An admin can switch the entire app between modes via `POST /admin/mode`. Other logged-in sessions pick up the mode change automatically on next home-tab navigation (no logout required) — `RENDER.home` re-fetches `/settings` and rebuilds tabs if `campMode` changed.

The app is **platform-agnostic**: persistence is in-memory (optionally snapshotted to JSON files), with a Supabase backend deployed to production (`PERSISTENCE=supabase`). Swapping the backend touches only `src/container.ts` + new repository implementations.

## ✅ DEPLOYED — live on Supabase (2026-06-22)

**Production: https://my-youth-camp.vercel.app** (`PERSISTENCE=supabase`). The port from
in-memory to a real Supabase backend is done and serving traffic.

| | |
|---|---|
| **GitHub** | `citipointe-youth/my-youth-camp` — **auto-deploys from `master`** |
| **Vercel** | team `citipointe-youth`, project `my-youth-camp` (serverless via `api/index.ts`) |
| **Supabase** | ref `nwfafrgojqkxylbppywo` (Sydney); all 16 tables applied; reached via `DATABASE_URL` — **session pooler, port 5432** since the 2026-08-07 cutover (was the transaction pooler on 6543) |
| **Login** | `admin` (username, not email); password set in the DB post-deploy |

Trackers: **`CHANGELOG.txt`** (phase-by-phase + KNOWN RISKS), `docs/PROGRAM-LOG.md` (initiative log),
`docs/PROGRAM-SUMMARY.md`, `docs/CODE-QUALITY-LOG.md`, `docs/PLANNED-IMPROVEMENTS.md` (approved-but-
unbuilt designs + topics queued for future brainstorming), `docs/archive/` (historical).

### ⚠️ Two deploy-only gotchas — DON'T regress these (neither is caught by `tsc`/`vitest`)
1. **`tsconfig` must emit CommonJS** (`module: CommonJS`, `moduleResolution: Node`). Switching
   back to `ESNext`/`Bundler` makes `@vercel/node` crash on load with *"Cannot use import
   statement outside a module"* (it runs the traced output as CJS). Mirrors the CMS config.
2. **`.gitignore` must keep the `/data/` rule anchored** (leading slash). An unanchored
   `data/` also matches `src/data/`, which silently drops `src/data/seed.ts` from git — CLI
   deploys still work but the git auto-deploy fails with *"Cannot find module './data/seed'"*.

### Status of the bigger roadmap
- **Gate 0 passes** — `npm run typecheck` clean, **261 tests pass**.
- **Supabase repo layer is complete and wired** (`PERSISTENCE==='supabase'` branch in `container.ts`); migrations applied; all repos verified round-tripping in prod (R11 closed).
- **Phase 1 (Person unification) is COMPLETE.** The unified `Person` entity/repo/service is the live path. `/registrants` and `/campers` are lifecycle-filtered DTO views over `PersonService` — no separate Registrant/Camper services exist. The Supabase layer targets the `people` table. `docs/STEP4-SWITCHOVER.md` has been archived.
- **Fixed defects** (now compiler-confirmed): app-won't-start, accommodation availability (B1), reset/new-year (A3/A4), timezone (B3), CSV import perf + BOM (C1), remind scoping (C2), stateless auth + security headers + login rate-limit.

### Audit fixes applied (2026-06-23)
A deep audit across three areas was completed and all bugs addressed. Key changes:

**Permissions & RBAC:**
- `attendance:write` is now a separate permission from `checkin:write`. `firstAid` gets `attendance:write` (sign-in/out only); all other roles get both. `PersonService.signEvent` asserts `attendance:write`; `checkIn` still asserts `checkin:write`. firstAid is now blocked from daily session check-ins at the API level, not just the UI.

**Mode switching:**
- `RENDER.home` re-fetches `/settings` on every home-tab navigation and silently updates `CAMP_MODE` + rebuilds tabs if the admin switched mode on another device. No logout required.

**SPA bug fixes:**
- **BUG-04**: `chevron` and `clock` added to `ICONS` — firstAid rows, wizard, and schedule tab no longer show blank SVGs.
- **BUG-05**: `TAB_OF.schedule` corrected from `'home'` to `'schedule'` — firstAid Schedule tab now highlights correctly.
- **BUG-06**: Dead `api('/campers')` call removed from `renderOversightPulse` — no more double fetch on every at-camp home load.
- **BUG-07**: Leader phone numbers in search results now use `telLink()` — tappable on mobile.
- **BUG-03**: `revealMedicare` no longer re-fetches `/campers/:id`; uses `_currentCasualtyCard` set by `openCasualtyCard` — audit POST still fires.
- **BUG-09**: Director gets a wide-nav sidebar (`Home, Check-in, Search, Notes, Import, Records & Export`) instead of a blank nav. Records & Export tile already shown for director on the admin console.
- **BUG-16**: `doNewYear()` year is now `SETTINGS.year + 1` (not `new Date().getFullYear() + 1`).

**Wipe guard (BUG-01, BUG-02, BUG-19):**
- `adminNewYear()` (Admin → Data path) now redirects to the guided close-out flow instead of calling the backend without `force`/`confirmWipe`. The "Purge & start new year" button is replaced with a link to Records & Export.
- `adminReset()` now requires typing the confirmation string AND sends `force:true` + `confirmWipe` to the backend. 409 responses show a modal pointing to Records & Export.
- Admin → Data no longer has two competing new-year paths (BUG-19 resolved).

**Backend:**
- **BUG-08**: Audit controller reads settings *after* the service call so `lastExportedAt` stamp never races with `lastTempPasswords` clearing.
- Import service preserves existing `elvantoMeta` on update if the CSV row has no `dateSubmitted`.

**New tests:**
- `access-control.test.ts`: 6 firstAid permission + `canAccessPerson`/`canAccessChurch` cases (BUG-11).
- `import.service.test.ts`: 3 dry-run cases — no-persist, phantom-church, `dryRun:true` in result (BUG-10).
- `person.service.test.ts`: 4 `listMedicalWatch` cases — atCamp filter, departed excluded, church scoping, firstAid access (BUG-12).
- `admin.characterisation.test.ts`: `BadRequestError` import added; `force:true` alone throws `BadRequestError` for `newYear` (BUG-13).

## At-camp bug/feature batch (13 items) — deployed 2026-07-24

Admin-requested batch from an at-camp review. SPA + backend (`search.service.ts`, item-1 removal)
+ **migration `0012`** (drops `sign_out_history.parents_met`, applied to prod AFTER the code push).
`npm run typecheck` clean, `npm run test` = **579 pass**, SPA `node --check` OK. `sw.js`
`camp-v33`→`camp-v34`. Design: `docs/superpowers/specs/2026-07-24-atcamp-bug-batch-design.md`.

- **1 — "Parents met at pickup" removed entirely.** The Yes/No control is gone (a plain text
  reminder stays); `parentsMet` stripped from the `SignOutEvent` entity, Zod schema,
  `attendance.controller`, `supabase.people` mapper, and BOTH audit exports (workbook + CSV);
  `openCamper`'s "Parents met" row removed. **Migration `0012`** drops the column.
- **2 — Non-church accounts auto-use the account name.** New SPA helper **`_actingName()`** (church
  → saved initials, else `ACTOR.displayName`) replaces the typed "Your name" field on **sign-out,
  sign-in, add-note and testimony**. Sign-in is now one tap for every role. **Only the first-aid log
  form still asks for a name.**
- **3 — Admin console top note removed.**
- **4 — Church daily-check-in session switching.** All sessions are browsable; the current one is
  marked `•` and selected by default. A restricted church viewing a NON-current session gets a
  view-only banner + greyed status pills (`sessionLocked` in `_renderDailyCheckin`). This replaced
  the old static "<label> only" pill whose tooltip was unreadable (the reported bug).
- **5 / 9 / 11 — Row restyle + `gbadge()`.** New shared **`gbadge(c)`** helper renders a
  grade/gender badge ("Y11"/"LDR") to the LEFT of the name on BOTH the daily check-in (`rowHtml`)
  and My-group (`myRow`) rows; gender-coloured (`.gbadge.male/.female`, leaders violet). Church
  logins no longer repeat their own church on tiles (rows collapse to one line, fit more per
  screen); buttons slightly smaller.
- **6 / 10 — "All churches" search cross-scope.** `search.service.search()` now lets
  church/zoneLeader find ANY arrived camper across churches AND genders (item 10), but
  **`redactSensitive()`** blanks medical/dietary/medication/medicare/parent/blue-card/consents/DOB/
  contact for any hit OUTSIDE the actor's `canAccessPerson` scope (item 6). director/admin/firstAid
  unchanged. `GET /campers/:id` still gates on `canAccessPerson`, so redacted hits can't be
  drilled into.
- **7 — "Other churches" → "All churches"** label; misleading "find another church's leader"
  heading corrected.
- **8 — My group is the default Students sub-tab** on every open (`STUDENTS_SUB` reset in
  `RENDER.students`).
- **12 — Devotional greys non-current days** and defaults to today (`localDateISO()`); all days
  stay selectable outside the camp dates.
- **13 — Home hero tinted to the login's zone** (gradient from `ZONE_COLORS` into navy) for
  zoneLeader/church, with the role subtitle removed for those two roles; admin/director unchanged.

**Follow-up (same day, SPA-only, `sw.js` `camp-v34`→`camp-v35`):**
- **"Not signed in" moved off the daily check-in screen** to the bottom of the My-students screen
  (`filterMyYouth`) as a `<details>` dropdown with the same one-tap "Sign in to camp" button; built
  by new helper `_loadMyNotSignedIn(previewSim,campers)` (/registrants + not-atCamp campers w/o
  sign-out history, deduped). The check-in load dropped its `/campers` fetch as a result.
- **My-students "Signed out of camp" is now a `<details>` dropdown** too (the old always-open
  "Late arrivals" block is folded into the "Not signed in" dropdown). `filterMyYouth` refactored
  with shared `grouped()`/`dropdown()` helpers.
- **"All churches" search: church name coloured by the student's gender** (blue/pink) in the
  `runSearch` findcard.

**Follow-up 2 (same day, SPA-only, `sw.js` `camp-v35`→`camp-v36`):**
- **Confirm before signing in from the My-students "Not signed in" list** (`signInConfirmList` →
  `_confirmSignInList` → `signInPrompt`). Sign-in from the camper profile and the first-day arrival
  flow stay one-tap.
- **Scroll position preserved on sign-in / check-in-out** across three roster screens: daily
  check-in (new `_rCheckin()` wraps the action re-renders in `_performCheck`/`undoCheck`/`drainQueue`/
  `_retryFailedCheckins` — `selDay`/`setFilter` still reset to top), My-students (`_refreshAfterAttendance`
  now captures/restores the screen scrollTop around the full re-nav), and first-day arrival (`fdDraw`
  captures/restores before its `innerHTML` swap, fixing the jump on every tick/confirm). Root cause:
  `paint()` preserves scroll on a clean same-screen repaint, but paths that repaint an empty/loading
  shell first clamp it.

**Follow-up 3 (same day, CSS-only, `sw.js` `camp-v36`→`camp-v38`):**
- **Black bar under the bottom nav on home-indicator iPhones fixed — copied YS Connection's nav
  layout.** Root cause: the fixed-height `.app` (`height:100dvh`) doesn't quite reach the physical
  screen bottom on a home-indicator phone, and the bottom nav is a flex child clipped at the app's
  edge — so the near-black `body` backdrop (`#0b0a1a`) showed through the home-indicator strip and
  no amount of nav `padding-bottom` could cover it (v37's `max(6px,env(safe-area-inset-bottom))`
  padding was necessary but insufficient on its own). Fix (matching YS's `body{background:var(--paper)}`
  + `.bot-nav`): **`body` background is now light (`var(--paper)`)** so that strip (and the desktop
  letterbox) blends with the near-white nav instead of reading black; the nav keeps the full-inset
  reservation and gained a soft top shadow (`0 -2px 10px`); the `.app` box-shadow was softened for
  the light backdrop. Supersedes the Bug-3 2026-07-17 fractional-inset tweak.
- **Follow-up 4 (`camp-v38`→`camp-v39`): bottom nav pinned to the true viewport bottom.** The nav
  (`.tabs`) was still floating above the home indicator with a light gap below it, because it was a
  flex child of the fixed-height `.app` (`height:100dvh`) which doesn't reach the physical screen
  bottom on iOS. Copied YS Connection's `.bot-nav`: `.tabs` is now `position:fixed;left:0;right:0;
  bottom:0;z-index:100`, so it sticks to the visual-viewport bottom and adapts as the browser
  toolbar shows/hides. `.screen` bottom padding raised to `calc(64px + env(safe-area-inset-bottom))`
  so content clears the fixed bar. (`#tabs{display:none}` at >=980px still hides it for the sidebar.)
- **Follow-up 4 also: At-Camp Info schedule editor time/activity overlap.** `_schedRow`'s native
  `<input type="time">` could overflow its 96px cell into the Activity field on iOS. Time column
  narrowed to 86px, gap 6->8px, `.sched-row input{overflow:hidden}` clips native overflow, and
  `.sched-row .sr-t` gets tighter horizontal padding (less white space around the value).

**Follow-up 5 (`camp-v40`→`camp-v41`, CSS-only): the real iOS bottom-nav bug — `overflow:hidden` shell.**
The `position:fixed` bottom nav floated above the home indicator on iPhones (in Safari AND standalone,
verified by loading the live page in a real browser: the nav is provably `position:fixed;bottom:0` at
the viewport bottom in Chrome, but iOS floats it). Root cause: **iOS mis-positions `position:fixed`
descendants of an `overflow:hidden` ancestor** — the app shell was `body`/`.app { height:100dvh;
overflow:hidden }`, so iOS pinned the nav to the app's short 100dvh edge, not the true viewport bottom.
YS Connection has no such `overflow:hidden` shell (its body scrolls naturally), which is why its fixed
nav sits correctly. Fix: dropped `overflow:hidden` and switched `height:100dvh`→`min-height:100dvh` on
`body` + `.app`. Internal scroll still lives on `.stage`/`.screen` (unchanged), so no JS/scroll-logic
change; the ≥980px grid re-sets its own `height:100dvh` on `#app`. If iOS still floats after this, the
next step is the full YS body-scroll model (screens flow in the document, sticky header) — a larger
change deferred because this minimal one targets the exact documented trigger.

**Follow-up 6 (`camp-v41`→`camp-v42`, CSS+JS): full YS Connection body-scroll conversion — the
fix that finally worked.** Follow-up 5's minimal `overflow:hidden` removal was NOT sufficient on the
user's iOS — the nav still floated (the shell was still a fixed 100dvh flex column whose screens
scrolled internally, so the body never actually scrolled and the fixed nav still anchored to the
app's 100dvh edge, not the dynamic-toolbar viewport bottom). Converted the PHONE shell to YS
Connection's natural body-scroll model:
- `.bar` → `position:sticky;top:0;z-index:30` (was `relative`) — pins to viewport top as the body scrolls.
- `.stage` → plain `flex:1` (dropped `position:relative;overflow:hidden`).
- `.screen` → normal in-flow block: `overflow-x:hidden;padding:… calc(64px+safe-area)` (dropped
  `position:absolute;inset:0;overflow-y:auto;overscroll-behavior;-webkit-overflow-scrolling`). The
  active screen now flows in the document and the **body** scrolls, so `position:fixed` `.tabs`
  anchors to the true visual-viewport bottom on iOS (exactly why YS's nav sits correctly).
- **≥980px grid re-establishes the internal-scroll shell** so the desktop layout is unchanged:
  `html,body{height:100dvh;overflow:hidden}`, `#stage{position:relative;overflow:hidden}`,
  `#stage .screen{position:absolute;inset:0;overflow-y:auto}`, `#bar{position:relative}`.
- **JS scroll refactor** — because a screen's scroll now lives on the *document* on phone but on the
  *screen element* on desktop, added a layout-aware helper: `_isWide()` (`innerWidth>=980`) and
  `_scroller(el)` (returns `el` on desktop, `document.scrollingElement` on phone). Routed every
  save/restore through it: `_spinner`, `paint` (samePaint keepY), `_rCheckin`, `fdDraw`,
  `openCamper`, `_refreshAfterAttendance`. `_navTo` now resets the document scroll to top on phone
  navigations (all screens share one document scroll, so a genuine nav must reset; in-place
  refreshes bypass `_navTo` and are preserved by `paint()`). The `#stage`-based `_r*` reloaders were
  already scroll no-ops (stage never scrolled) and stay so — `paint()` handles real preservation.
  The import-guide modal's own `igBody.scrollTop` (its own scroll container) is untouched.

**Follow-up 7 (`camp-v42`→`camp-v43`, CSS-only): overlays anchored to `.app` re-pinned to the
viewport after the body-scroll conversion.** Follow-up 6 made `.app` grow with content on phone, so
every `position:absolute` overlay that was a direct child of `.app` (and relied on `.app` == the
viewport) started anchoring to the bottom/height of the tall page instead of the screen. Reported
symptom: the incident-log confirmation **toast showed at the very bottom** (off-screen when scrolled).
Fixes — all switched `position:absolute`→`position:fixed` so they track the viewport in both layouts:
- **`.toast`** → `position:fixed`, and moved to float near the **top** (`top:calc(env(safe-area-inset-top)
  + 60px)`, slides down into view, `z-index:110`) per the owner's request — was `bottom:88px`.
- **`.modal`** (`#modal` bottom-sheet) → `position:fixed;inset:0` — a sheet opened while scrolled
  down had been landing at the bottom of the page.
- **`.ig-wrap`** (`#impGuide` Elvanto guide overlay) → `position:fixed;inset:0`.
- **`#login,#mcpGate`** (full-screen gates) → `position:fixed;inset:0` (+ `overflow-y:auto` so a
  tall form scrolls internally now that it can't use body-scroll).
`#nprog` (the top loading bar) is a child of the sticky `.bar`, not `.app`, so it was unaffected.
GOTCHA for future overlays: any full-viewport overlay/toast MUST be `position:fixed`, never
`position:absolute` — the phone `.app` is not viewport-height, it grows with the scrolling content.

## Notification hardening before the check-in warning is switched on — 2026-07-30

Deep review of the notification/web-push work ahead of enabling it for camp. Backend + SPA +
**migration `0018`** (`notifications.target_user_id`). `npm run typecheck` clean,
`npm run test` = **704 pass** (was 688; 16 new), SPA + `sw.js` `node --check` OK.
`sw.js` `camp-v54`→`camp-v55`.

> **Read this first if you are about to enable the tick.** Phases 1–3 of the web-push design are
> merged, but **nothing fires**: migration `0014` is unapplied and `CRON_SECRET` is unset, so
> `cron.service` has never run in prod. Everything below is the set of defects that would have
> landed the moment it did. **Migration `0018` must be applied to prod BEFORE this code pushes** —
> `supabase.notifications.save()` writes `target_user_id` on every save, so any notice write
> (including `incident.service.log`) fails until the column exists.

### 1 — Notices are addressed PER LOGIN, not just per scope (`targetUserId`)
The scheduler counts outstanding check-ins **per login** (gender-scoped `b-`/`g-` accounts hold
different numbers) but wrote a **church-scoped** notice, and `canSeeNotification` matched church
scope on `churchId` alone. So `b-victory` and `g-victory` each saw **both** notices — two
contradictory counts with no way to tell which was theirs — and admin/director saw *every*
church's, because oversight roles bypass scope checks. Proven by test before fixing.

`Notification.targetUserId` + one clause in `canSeeNotification`: a targeted notice goes to that
one login and **nobody else, deliberately including admin and director**. Null on every
human-authored notice, which stays scope-addressed exactly as before. `target_user_id` is in
`notifColumns`, `toNotif` **and the on-conflict `do update set` list** — miss that last one and
the value silently never persists (the repo's documented recurring bug class).

### 2 — Check-in warnings now EXPIRE at the window they warn about
They were created `expiresAt: null` + `priority:'urgent'` and nothing ever cleaned them up: a
camp would accumulate hundreds of permanent urgent rows, the Notices screen deletes one at a
time, and the bulk "Clear all notifications" button was removed on 2026-07-29. `expiresAt` is now
the window close (`ChurchBehind.windowEndAt`), which `findActive()` already filters on — so each
warning self-destructs when it stops being actionable. The `dedupe_key` row outlives the expiry,
so an expired notice is never re-created.
New **`zonedToInstant(tz, date, time)`** in `src/utils/date.ts` is the inverse of `zonedNow` —
the check-in code keeps wall-clock strings, and `new Date(date+'T'+time+'Z')` is the
UTC-vs-Brisbane bug that has hit this repo twice (it lands 10 hours early). Computed inside
`warnWindow`, where the camp zone is already in hand; a caller must not re-derive it.

### 3 — Feeds order by PUBLISH time, not `createdAt` (`publishedAt`/`byPublishedDesc`)
A scheduled notice's `createdAt` is when it was *composed*. Composed Monday for Thursday, with
three notices sent in between, it published in **4th place** — and Home renders only
`feed.slice(0,3)`, so it could publish without appearing on Home at all. Ordering is now
`scheduledFor ?? createdAt`, in `getActorFeed` and in the dashboard.

### 4 — `dashboard.service.latestNotification` uses `canSeeNotification`
It carried a hand-rolled **copy** of the audience rules (the duplicate this file already warned
about) and had drifted two ways: it never implemented the `scheduledFor` withhold — so a notice
scheduled days ahead was returned, **title and body**, the moment it was composed — and it denied
admin/director the see-every-scope rule they have everywhere else. Nothing in the SPA reads
`latestNotification` today, so there was no visible symptom; it was still going over the wire.
**There is now one copy of these rules. Do not re-inline them.**

### 5 — The urgent-priority tooltip was lying
It promised "pops up a full-screen alert they must tap to dismiss". The modal was deleted
2026-07-26 and item 18 (2026-07-28) limited the banner to `leadersOnly` incident alerts, so an
urgent human notice gets **no banner and no modal** — just a red card. Reworded to say plainly
that nothing interrupts anyone until they next open the app.

### 6 — `newYear` deletes push subscriptions
`reset()` did (bug 16); `newYear` did not, and was relying by accident on the `users` FK cascade —
which works on Supabase but not in-memory, and stops working the moment an account survives a
rollover. Same standing rule as `reset()`: **a new repository must be added to both in the same
commit.**

### 7 — The in-memory notification repo enforces the `dedupe_key` unique index
It didn't, so the scheduler's dedupe existed **only** on Supabase: in dev and in tests every tick
in the lead window created another duplicate, and `cron.service`'s `23505` branch was unreachable
except by a hand-faked error. `InMemoryNotificationRepository.save` now raises the same SQLSTATE.
A new test runs twelve real ticks through the real repo and asserts exactly one notice survives.

**Also:** `clearAll` threw a bare `Error` (→ 500 "the app is broken") instead of `ForbiddenError`.

**Known and deliberately NOT changed:** `estimateAudience` still runs a full people scan on every
send (≈10 AES field decrypts per person) to compute `audienceEstimate`, which **nothing reads**;
`churchRepo` is injected into `makeNotificationService` and unused. Left alone as a separate
cleanup — see the load note in `docs/PLANNED-IMPROVEMENTS.md`.
**↑ SUPERSEDED the same day — this was done in the second half of the session, see item 14 below.**

## Notification hardening, part 2 — load fixes, incidents, and web push SHIPPED — 2026-07-30

Same day, second half. The owner answered the seven open questions (recorded in
`docs/PLANNED-IMPROVEMENTS.md`) and **web push is shipping for this camp**. Everything in the
section above plus everything here went to prod in one push. `npm run typecheck` clean,
`npm run test` = **749 pass / 49 files** (was 704/48; **45 new**). SPA + `sw.js` `node --check` OK.
`sw.js` `camp-v55`→**`camp-v56`**. **Migrations `0018` AND `0019` were applied to prod BEFORE the
push**, both reconciled to clean version labels and verified present by query.

> ⚠️ **The `node --check` extract range has MOVED.** `public/index.html` grew: the script body is
> now lines **847–6681** (was 834–6410 at this section's own push). Don't cache that
> range — derive it, e.g.
> `S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1)`. The naive
> `<script>…</script>` regex still fails because the file contains the literal `</script>`.

### 8 — `checkIn`/`signEvent` no longer flush the dashboard cache
`invalidateDashboardCache()` wipes **every** entry globally, and the cache is keyed on
`(role, churchId, zone, genderScope)` — **not per device** — so ~100 devices collapse to ~30 keys
(~4:1). These two are the only **bursty** writes in the app: at a check-in window every leader taps
through a roster at once, and each tap was destroying the cache for all 30 keys precisely while
every device was loading `/home`. Cost of not invalidating is bounded by the 30s TTL, and a leader
mid-rush is on the roster screen (always live), not the dashboard. Every other writer still
invalidates. **The two tests were INVERTED, not deleted** — they now pin stale-within-TTL and
correct-after-TTL, so the trade-off can't be silently undone.

**An audit of all ~31 `invalidateDashboardCache()` call sites says do NOT generalise this.** Only
three others cannot affect a dashboard DTO (`splitChurchAccounts`, `randomizeChurchPasswords`,
`updateDiscountCodeTags`) and all three are rare admin operations where the flush costs nothing.
Burst frequency, not correctness, is the whole reason these two changed.

### 9 — `/home` uses `findByChurch` for church logins
New `personsInScope(actor)` in `dashboard.service`. `findAll()` on Supabase means the whole `people`
table **plus every row of `check_in_history` and `sign_out_history`** — at camp ~700 people and
~3,500 history rows, fetched and decrypted on every uncached request, to then discard all but the
~30 a church may see. Applied to BOTH the pre-camp and at-camp branches.
⚠ **`canAccessPerson` is still the real gate and must stay.** `findByChurch` knows nothing about
`genderScope`, so dropping that filter as "already scoped" would show `b-victory` the girls'
numbers — there is a test for exactly that. Narrowing a query cannot widen access.
Deliberately NOT extended to `zoneLeader` via `findByZone`: `canAccessPerson` also admits people
whose *church* sits in the zone, and the two can disagree after a re-zone. Field decryption was
left alone on purpose (34ms for 700×10 — row volume is the cost, not AES).

### 10 — Push fan-out is capped per tick, and jittered
`MAX_PUSH_SENDS_PER_TICK = 40` (`push.service.ts`). All 26 church logins hit their window boundary
together, so one tick can generate 26 notices → ~104 sends at 4 devices/church, ~156 at 6. With
`maxDuration: 30` and ~325ms/send that is ~8.5–13s, and the failure is **not graceful**: the
`push_sent_at` claim is taken BEFORE sending, so a timeout loses those pushes **permanently**.
Capping keeps the worst tick to ~3.5s; the remainder is simply not claimed, so the next tick takes
it (60-min lead ÷ 5-min tick = 12 ticks ≈ 480 capacity). **The cap is applied at NOTICE granularity,
not device** — a notice's claim is all-or-nothing, so splitting its devices across ticks would drop
the second half rather than defer it. `PUSH_JITTER_MS = 4000` spreads sends so 100+ devices don't
all open the app in the same second.

### 11 — Web push phases 4–6 (VAPID, subscribe API, service worker, opt-in UI, sender, pruning)
Owner's decision: push ships for this camp. New `web-push` dependency, `src/services/push.service.ts`,
`src/api/controllers/push.controller.ts`, three routes (`GET /push/config`,
`POST`/`DELETE /push/subscribe`, all `auth:true`), sw.js `push` + `notificationclick` handlers, and
an "Alerts on this device" card on both home screens.

- **⚠ INERT WITHOUT VAPID KEYS, BY DESIGN.** This shipped to prod *before* the keys exist. With any
  of the three env vars unset, `/push/config` returns `configured:false`, the SPA card renders
  nothing, and **the sender returns before claiming anything**. That last part is load-bearing:
  claiming would set `push_sent_at` on notices that were never sent, and the claim is permanent, so
  every notice created before the keys are set would be silently swallowed forever.
- **⚠ A SERVER-STORED `body` IS NEVER PUT IN A PUSH PAYLOAD.** `buildPushPayload` keys off the
  trigger and does not read `notification.body`, `incident.summary` or any person field. The reason
  is NOT the transport (payloads are genuinely E2E-encrypted; Apple/Google/Mozilla can't read them)
  — it is the **lock screen**: the SW decrypts and hands it to the OS, which renders it on a locked
  phone with "Show Previews: Always" (the iOS default), legible to whoever is holding it. That would
  print a field this codebase encrypts at rest and hides from church/firstAid accounts onto the most
  public surface the device has, and it inverts `leadersOnly` — the *account* is a leader, the
  *person reading the screen* is whoever picked the phone up. There are tests asserting the payload
  never contains a body. The check-in warning is the one exception and carries only an aggregate
  count, a session label and a time.
- **Audience is resolved by `canSeeNotification`**, the same predicate the feed uses, run in reverse
  over the users table. Do not write a second copy — the failure mode is pushing a `leadersOnly`
  incident to a church login whose feed correctly hides it.
- **`isPushSuppressed` (D8)** — `churchLoginLocked`/`zoneLeaderLoginLocked` are read in exactly one
  other place (`auth.service.login`) and block LOGIN only. A subscription is session-independent, so
  without this a locked-out leader's phone buzzes forever and the owner's post-camp lock would be a
  false sense of closure. Suppressed at send time, not deleted, so unlocking restores alerts with no
  re-subscribe. `mustChangePassword` is deliberately NOT suppressed.
- **Pruning**: 404/410 deletes the row immediately (the standard self-cleaning contract);
  429/5xx increments `failure_count` and deletes at 10; `pruneStale()` reclaims anything with no
  success in 90 days.
- **SPA safety contract** — `_pushCardHtml()` returns a STATIC EMPTY `<div>` and nothing else; all
  work happens in `_renderPushCard()`, which is async, fully try/caught, and writes only into that
  div. **Keep this shape.** The card is on the Home screen of every role, so a render-time throw
  would blank the app's landing screen for everyone — and `Notification`/`PushManager` are absent or
  throwing on some older iOS. The card also hides itself in `PREVIEW_MODE`/`ACCOUNT_PREVIEW` (an
  admin previewing a church account must not register their own phone against it).
- **Deep link**: the SPA has no URL router, so `notificationclick` `postMessage`s the target screen
  to a focused client and falls back to `openWindow('/?nav=…')`, consumed once at boot by
  `_consumePushNav()` (which strips the query so a refresh doesn't re-navigate).
- `push` was added to `API_RE` in `sw.js`; `internal` is still deliberately absent (the cron tick is
  server-to-server and never passes through a service worker).

### 12 — Incidents: optional `occurredAt` + 12-hour alert expiry (migration `0019`)
Owner approved 4.5 and 4.6 only. `occurredAt` is **optional** — logged without it is valid and must
never warn. The high-severity `leadersOnly` alert now expires `INCIDENT_ALERT_TTL_HOURS = 12` after
creation (prod had 2 sitting permanently); `findActive()` already filters on `expiresAt`, so that is
the whole of the cleanup. Low-severity raises no notice at all — unchanged.
⚠ **The SPA must send a full ISO instant.** `<input type="datetime-local">` yields a bare wall-clock
string with no zone; the schema **rejects** it on purpose, because parsing that server-side is the
UTC-vs-Brisbane bug that has hit this repo twice. `_incOccurredISO()` converts via `new Date(v)`
(which reads it as device-local — and the device is at camp) and returns `null` when empty.
`occurred_at` is in `toIncident`, `incidentColumns` **and** the on-conflict `do update set` list.

**Owner DECLINED**, do not build without asking again: incident **review state** (4.1), **server-side
acknowledgement** of high-severity alerts (4.2), **zone-scoping** `incident.list()` (4.3 — zone
leaders keep camp-wide visibility, confirmed intended), and **soft delete** (4.4 — hard delete
stays). Cross-zone incident *filing* also stays allowed; §3.4 only constrained `zone` to the four
`ZONE_NAMES` so a typo can't silently mis-file a record.

### 13 — `account.service.listChurches` was a drifted copy of `canAccessChurch`
Found by a duplicate-rule audit. It special-cased admin/director/zoneLeader then fell through to
`c.id === actor.churchId` for "everyone else" — and `firstAid` is in that fall-through with **no
`churchId`**, so `GET /accounts/churches` returned first aid an **empty list**, while the canonical
rule grants firstAid every church as it does everywhere else. Latent (no first-aid screen calls it
yet) and uncovered by any test, which is how it survived. Now `churches.filter((c) =>
canAccessChurch(actor, c.id, c.zone))`, with tests for all four roles. **This is the second
hand-rolled copy of an audience rule found in one day — do not inline these.**

### 14 — `estimateAudience` deleted (supersedes the "deliberately NOT changed" note above)
It scanned the whole `people` table (~10 AES decrypts/person) on every send and every
audience-changing edit, to populate `audienceEstimate` — which **nothing reads**: no DTO exposes it,
`public/index.html` references it zero times, and `incident.service` was already writing a hard-coded
`0`. Deleted along with the `personRepo`/`churchRepo` params it was the only user of.
**The field and its column are KEPT**, not dropped: `cron.service` writes a genuinely meaningful
number into it (students still to check in), and retaining the column avoids a migration and matches
the `discount_code_overrides` precedent. An edit now preserves the existing value rather than
recomputing it. If a real "who will see this?" figure is ever wanted, compute it from
`canSeeNotification` over the USERS table (tens of rows), never by scanning people.

### ~~Still gated on the owner~~ — ALL TURNED ON 2026-07-31, see the section below

## ✅ THE BOTTOM-NAV / TALL-WHITE-BAR BUG IS ACTUALLY FIXED — 2026-07-31

**Seventh attempt, and the first one verified on a device instead of assumed.** Follow-ups 3-7
(2026-07-24), the 2026-07-26 `html{background:#fff}` change and the 2026-07-28 `.tabs::after`
change were all blind guesses at this. SPA-only (`public/index.html`); no backend, schema or
migration change. `sw.js` `camp-v68`→**`camp-v73`** across the whole investigation.

> **If a bar/gap/floating-nav symptom EVER comes back: turn on the viewport readout FIRST (five
> taps on the header title) and read `SHORTFALL`. Do not start editing CSS.** That is the entire
> lesson of this session.

### The actual root cause
iOS gives the installed PWA a **layout viewport ~58-62px SHORTER than the screen** — at launch,
and again after a keyboard is dismissed. Measured on the owner's iPhone 16 Pro (402x874pt):

| | broken | after one drag |
|---|---|---|
| `innerHeight` / `scrollHeight` / `vv.height` | 816 (and 812 on another screen) | **874** |
| `nav.bottom` | 816 | 874 |
| `screen.height` | 874 | 874 |
| white at the bottom of the screen | **96pt** | 34pt |

`874 - 812 = 62` = exactly `safe-area-inset-top`; `62 + 34` = exactly the 96pt of white measured.
The nav is at `bottom:0` of the viewport it was given — it is the **viewport** that is short.

### ⚠️ Why six previous attempts all missed it
**Every metric a page can normally read agrees with itself in the broken state.** `innerHeight`,
`clientHeight`, `scrollHeight`, `visualViewport` and `100dvh` ALL report the short height, and
BOTH nav-gap checks (`innerHeight - nav.bottom`, `vv.height + vv.offsetTop - nav.bottom`) read
**0**. Nothing inside the layout viewport can see the problem. **`window.screen.height` is the
only reference that reports the true height** — that is what made this findable at all.

### ⚠️ TWO THINGS THAT DO NOT WORK — both tried on 2026-07-31, do not repeat
1. **Moving the nav down** (`transform:translateY(<shortfall>)`). Built on the inference that
   `safe-area-inset-bottom` reporting 34px while broken proved the WEB VIEW still covered the
   screen and only the layout viewport was short. **That inference is FALSE.** The web view is
   short too: with `innerHeight` 816 the last painted row of a full-screen screenshot was 815pt —
   **the document cannot paint past `innerHeight`.** The nav went to 841-874 and was clipped
   ("half of the nav bar was hidden"), strictly worse than the bar it replaced. Reverted same day.
   The strip below belongs to iOS. No transform, negative margin or ancestor height can reach it.
2. **`.tabs::after`** (the 120px white slab, 2026-07-28 Bug 15). It painted below the nav's bottom
   edge, which is already at `innerHeight` — so it was clipped and **never visible**. Removed;
   removing it changed nothing on screen. This also finally explains Bug 15 properly: that strip is
   **not** filled with the manifest `background_color` (`#0b1220`, near-black), it is filled by iOS
   extending the **document's own backdrop colour** — which is why `html{background:#fff}` fixed its
   *colour* in 2026-07-26 and why it read light-purple when `html`/`body` carried `--paper`.
   **`html`/`body` backgrounds are the only control over that strip's colour.**

### The fix that works — `_vpKick()`
The strip can't be painted, so the view has to actually get bigger, and the one thing observed to do
that is **a real scroll**. `_vpKick()` briefly makes the document 200px taller than the viewport,
scrolls 1px, and puts both back.

**That "briefly taller" step is the whole trick.** On Home the content is shorter than the viewport
(`scrollHeight === innerHeight`), so the document is **not scrollable and there is nowhere to scroll
to** — which is why the pre-existing `_fixViewportGap()` (`scrollTo(0, scrollY)`, 2026-07-29) is a
no-op in exactly the state that needs it, and why the bug never self-corrected. Both remain: this
one re-sizes the view, `_fixViewportGap` restores scroll position after a keyboard.

**Two triggers, both owner-reported and both covered:** app launch (retried over the first 1.6s —
iOS is still moving things well after the first frame, hence 62px on one screen and 58px on
another) and keyboard-dismiss (via `visualViewport.resize` + `focusout`). A keyboard does **not**
change `innerHeight` on iOS, only `visualViewport.height`, so the shortfall reads 0 while typing and
the kick correctly stays asleep until the keyboard has gone.

Guards, all load-bearing: gated to iOS standalone with a plausible-range check (in Safari and on
Android that same `screen.height - innerHeight` difference is legitimate browser/system chrome, and
kicking there would scroll the page for no reason); never while an input is focused; a
`_vpKicking` flag + 600ms cooldown, because the kick changes layout and can re-enter through the
resize listener that called it; and the restore runs in a double rAF **and** on the throw path, so
a failure mid-kick cannot strand the document with 200px of dead scroll space. It stops firing by
itself once the shortfall reaches 0. Verified in isolation — 14 cases run against the real
extracted functions with stubbed globals (detection, Safari/Android inertness, both restores,
re-entrancy, cooldown).

### The readout is KEPT — `_vpDbg*` + `.vpdbg`, off by default, five taps on the header title
Built as a throwaway; **do not delete it as leftover debug code.** It is the only reason this was
diagnosed, it caught the failed `translateY` attempt immediately (`kicks fired` + `SHORTFALL`
distinguish "never ran" from "ran and iOS ignored it"), and it caught the deploy miss below.
Costs a cached-boolean check every 500ms when off; `pointer-events:none` so it can never swallow
a tap; every read wrapped, since it renders on every screen for every role.

### ⚠️ DEPLOY GOTCHA THAT COST A WHOLE TEST CYCLE — a push is NOT proof of a deploy
`48459c0` reached `origin/master` and **Vercel never created a deployment for it.** The last
production build stayed at the previous commit and prod served the old `sw.js` twenty minutes
later, so the owner's test screenshots were of a build without the fix in it — which nearly read as
"the fix doesn't work". Same webhook miss recorded on 2026-07-17. Recovered with an **empty commit**
to produce a fresh push event; it built in ~30s.
**When asking the owner to test on a device, verify the deploy landed first** — `curl -s
https://my-youth-camp.vercel.app/sw.js | head -1` and check the `camp-vNN` you just shipped, or grep
the live HTML for a symbol you just added. This supersedes the "no need to poll Vercel" line in the
verify-and-deploy convention **for device-test cycles specifically**; for ordinary pushes it still
holds. (`vercel deploy --prod --yes` is the documented CLI fallback but was blocked by a permission
rule in this session.)

## 🔐 SECRET INCIDENT + `VAPID_PUBLIC_KEY` was never a key — 2026-07-31

Found while chasing the follow-up to the iOS fix below: after the activation fix landed, the
iPhone prompted correctly, permission was granted, and subscribe then failed with
**`InvalidCharacterError`** — `atob()` in `_urlB64ToUint8`.

**`VAPID_PUBLIC_KEY` in production contained 180 characters of pasted TABLE TEXT**, not a key:
rows for `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `CRON_SECRET`, complete with pipes,
`mailto:`, and literal `\n`. The four secrets were added ~2h earlier (the section below on the
tick going live) and a multi-line paste landed in one variable. Read directly from
`vercel env pull`, not inferred.

### ⚠️ This was a secret exposure, not just a broken feature
`GET /push/config` returns `publicKey` **verbatim to the client** and is `auth:true`. So every
logged-in device that rendered Home in that window was served the VAPID **private** key and
**`CRON_SECRET`** in a JSON response, readable in devtools by any leader account. `CRON_SECRET`
was live and working (the tick was returning 200), and because `claimForPush` takes the
`push_sent_at` claim BEFORE sending, anyone holding it could have permanently swallowed real
check-in warnings by triggering the tick.

**Full rotation performed** (owner authorised): a fresh VAPID keypair and a fresh 32-byte
`CRON_SECRET` were generated and set for **Production and Preview**, and the Supabase Vault
`cron_secret` was updated to match. The exposed values are dead.

**Verified, not assumed** (after the redeploy — env vars only reach a NEW build, and the old
build was still serving the leaked value until it landed):
- **`VAPID_PUBLIC_KEY` byte-exact** — pulled back and compared to the generated key: 65 bytes,
  leading `0x04`, and the *exact browser `atob()` path* (pad → `-_`→`+/` → decode) succeeds.
- **`CRON_SECRET` end-to-end** — the cron job's OWN command was run verbatim from the DB
  (`net.http_get` + `vault.decrypted_secrets` → `/internal/cron/tick`) and
  `net._http_response` returned **200** `{"ok":true,…}`. That exercises the exact path
  `pg_cron` uses, so Vercel and the Vault are proven in agreement.
  ⚠ The route is **`/internal/cron/tick`** — read it from `cron.job.command`, don't guess it
  (`/internal/push-tick` 404s).
- **All three VAPID vars pass shape validation in prod** — `cron.service` calls
  `isPushConfigured()` on EVERY tick, so a malformed value would have logged `[push] VAPID_…`.
  The runtime logs are clean across the post-deploy ticks, which is a positive result for the
  private key and subject even though both are sensitive and unreadable.
- ❗ **Still unproven: that the private key is the mathematical PAIR of the public key.** Both
  came from one `generateVAPIDKeys()` call and one write operation, and the public half
  verified byte-exact, so the risk is low — but only a real push delivering to a real device
  proves it. `pushAttempted` is still 0 because there are still zero subscriptions.

### Gotchas learned doing the rotation — read before touching env vars again
- **`vercel env add` IGNORES stdin when it detects an agent** (`--non-interactive` is the
  default then). Both `< file` and `cat file |` reported *success* and wrote **empty strings**.
  Use **`--value`**. Three separate "successful" writes were silently empty before this was
  caught — always verify a write, never trust the exit code.
- **This project stores new env vars as `type=sensitive` by default**, and a sensitive value is
  **never readable back** — not by `vercel env pull` (returns `""`) and not by the REST API even
  with `decrypt=true`. `vercel env ls` shows "Encrypted" for both types, so it does not tell
  them apart. Use `--no-sensitive` for genuinely public values.
- **`VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` are now stored NON-sensitive, deliberately.** The
  public key is served to every client by design, so nothing is lost — and it makes the value
  verifiable, which is the only reason this bug was findable at all. **Keep them non-sensitive.**
  The private key and `CRON_SECRET` stay sensitive.
- `vercel env pull` returns `""` for many working vars (`PERSISTENCE`, `DATABASE_URL`,
  `SESSION_SECRET`…). **An empty pull does NOT mean an empty value** — it usually means
  sensitive. Do not "fix" a var on that basis.

### Hardening so this cannot recur (this is the actual code change)
`readPushConfig` now `trim()`s all three values and **validates their shape**: the public key
must decode as base64url to **65 bytes with a leading `0x04`** (uncompressed P-256 point), the
private key to **32 bytes**, and the subject must start with `mailto:` or `https://`. Anything
else → `null`, i.e. `configured:false`, so the feature is **cleanly inert and nothing is served
to a client**, plus a `console.error` naming the variable and its length — **never its value**.
Client side, `_isValidVapidKey()` re-checks before rendering, so a bad key hides the card rather
than offering a button that can only fail after the user has already granted OS permission.

> ⚠️ **The `VAPID_ENV` test fixture was `'pub'`/`'priv'`** — placeholders of exactly the class
> that broke production, so the suite was structurally incapable of catching this and every
> test passed while prod served table text. It is now a real throwaway keypair. **Do not
> shorten it back.** Six regression tests cover the malformed cases, including the literal
> table-paste string.

## Alerts offer extended to every role + prod notices cleared — 2026-07-31

`_maybeOfferPushAfterInitials` is now **`_maybeOfferAlerts`** — it has two entry points and the
old name described only one. `sw.js` → `camp-v68`. SPA-only.

**`_offerAlertsAfterLogin()`** is called from all **three** post-sign-in paths, and all three
are needed: `doLogin`, `submitChangePassword` (a `mustChangePassword` account lands there, not
in `doLogin`), and `_tryRestoreSession` (reopening the installed app). 900ms delay — longer
than the initials path, because Home is still painting immediately after sign-in.

> ⚠️ **It skips church accounts deliberately.** `enforceInitials()` has already opened a
> blocking, unskippable modal on that path. A second modal 900ms later would replace it and
> leave the account with **no initials set** — which then blocks every attributed write. Church
> logins keep getting the offer after they save their initials instead.

Every existing gate still applies, so it remains **at most one offer per device, ever**:
permission `default`, iOS installed, `ycp_push_asked` unset, server VAPID key valid.

### Production data: notices cleared

All `notifications` rows deleted at the owner's request — **32**: 30 `Check-in closing soon
(test)` from the 06:09 test-button run (it reached 30 church logins, so the button works at
real scale), and 2 `Incident logged` alerts from 27–28 July.

**The 6 rows in `incidents` are untouched.** Those notices are only the *alerts*; the incident
records themselves live in their own table and were never in scope. `push_subscriptions` (2)
also untouched, so no device has to re-subscribe. Verified after: `notifications` 0,
`incidents` 6, `push_subscriptions` 2.

## Alerts offered when a leader sets their initials — 2026-07-31

`_maybeOfferPushAfterInitials()`, called 600ms after `_confirmEnforceInitials` (the login
gate — the main path) and after `_confirmInitials` when initials were **set**, not cleared.
`sw.js` → `camp-v67`. SPA-only.

**Why initials:** a PWA gets **no install-time hook** — nothing fires on Add to Home Screen —
so there is no "on installation" moment to hang this off. Setting initials is the closest this
app has to *a person has just claimed this device*, which is when the offer makes sense.

**It opens OUR consent sheet, not the OS prompt**, and both reasons matter:
1. an OS prompt fired straight off the initials save explains nothing, and a tap on "Allow" is
   not meaningful consent to a safeguarding-adjacent alert that renders on a lock screen;
2. it runs from a `setTimeout`, so **user activation is already gone and WebKit would refuse
   `requestPermission()` outright**. The sheet's own button restores it — the same
   `_pushOn`/`_pushConsentGo` split that fixed the original iOS bug. Do not "simplify" this
   into a direct `requestPermission()` call; that is the 2026-07-31 bug rebuilt.

**Every gate must pass:** not a preview mode; `serviceWorker` + `PushManager` + `Notification`
present; `Notification.permission === 'default'` (granted/denied are never re-promptable, so
asking is pure noise); on iOS, installed to the Home Screen; never asked before on this device;
and the server's VAPID key present and valid. The asked-flag (`localStorage.ycp_push_asked`) is
written **before** the sheet opens, so cancelling is respected — one offer per device, ever.
Anyone who declines can still turn alerts on from Notices.

> ⚠️ **SCOPE: initials are CHURCH ACCOUNTS ONLY** (`_isChurchAccount`). Admin, director, zone
> leader and first-aid logins never set initials, so they **never see this offer** and must use
> the Notices card. Church logins are the accounts that receive the check-in warning, so this is
> the right audience — but it is not "every role gets prompted", and nobody should assume it is.

Also corrected the consent sheet copy: it still promised an alert for any camp notice, and only
**urgent** ones alert since the priority change earlier the same day.

## Admin test button for the check-in warning — 2026-07-31

**`Admin → Settings → Check-in & timing → Send test check-in alert`** →
`POST /admin/test-checkin-warning` → `cron.testCheckinWarnings(actor)` (`admin:manage`).
`sw.js` → `camp-v66`.

**Why it exists:** job B's gate needs four conditions true *at once* — restriction on, a camp
day, inside a window, ≤60 minutes left. So the check-in warning could not be rehearsed; the
first time anyone saw it work would be the morning it had to work.

It runs the **real** pipeline with only the timing gate replaced: `churchesBehindFor` (the
genuine per-login counting rule) → notice creation → `canSeeNotification` audience resolution
→ claim → web-push fan-out.

### `checkin-warnings.ts` is now split — don't re-merge it

`churchesBehind` (timing gate) delegates to the new exported **`churchesBehindFor`**
(counting). Both callers share the counting rule *on purpose*: present, non-leader, per
gender-scoped LOGIN, last check-in entry wins. **A test that reimplemented the count would
prove only that the second implementation works.**

**`testWarnWindow()`** resolves a session without the gate: the genuinely open session if
there is one (highest fidelity), else `currentSession()` — today's, else the most recent past,
else the first upcoming. It floors the expiry at `CHECKIN_TEST_TTL_MINUTES`, because after
camp the natural window end is in the past and `findActive()` would hide every test notice the
instant it was written.

### Three deliberate differences from a real warning

| Difference | Why |
|---|---|
| Title says **`(test)`** | These land in real church accounts' Notices feeds. An alert indistinguishable from the real one, out of camp season, is how a leader learns to distrust the alert that matters. |
| **`includeZero: true`** | Production must never say "0 students still to check in" (design D4 condition 4). But a test that silently sent nothing because everyone happens to be checked in reads as a broken button. The response reports **`churches`** and **`churchesWithOutstanding`** separately so "reached 12 logins" can't be mistaken for "the counting was exercised". |
| Dedupe key carries the **run timestamp** | Makes the button repeatable, and means it can never collide with — or *consume* — a real `checkin-warn:<session>:<user>` key. A test that burned the real key would suppress the genuine warning for that session. There is a test asserting a real warning created first survives two test runs. |

The triggering admin gets a copy addressed to them. Without it the button is **unobservable to
the person pressing it** — real warnings are `targetUserId`-scoped to church logins, so an
admin's own phone stays silent no matter how well it works.

SPA: `confirmSheet` **before** sending — this writes into every church login's feed and rings
every church device with alerts on, so it must never fire on a mis-tap.

Verified: `npm run typecheck` clean; `npx vitest run` **794 pass / 49 files** (was 785, +9);
`node --check` OK on `sw.js` and the SPA body (extract range **847–6958**, re-derived).

## Push behaviour batch — titles, urgent-only, self-test, blank-screen fix — 2026-07-31

The owner's first real subscription worked, and using it surfaced four things. All four were
in the same round trip. `sw.js` → `camp-v65`.

### 1. 🐞 Opening the app from a notification landed on a BLANK screen

**Root cause, confirmed not inferred:** `buildPushPayload` returned `screen: 'notices'` for an
ordinary notice. **There is no `notices` screen** — the SPA's Notices screen is **`notifs`**.
`_navTo` → `_spinner` finds no element and does nothing, then `_showScreen` strips `.active`
off every `<section class="screen">` and matches nothing. Result: an empty app frame, **no
exception, nothing in any log**, which is why nothing caught it. The two system triggers were
unaffected — `checkin` and `incidents` are both real ids — so only tapping a *notice* did it.

Fixed in two independent places, on purpose:
- the payload now says `notifs`, and a test scrapes `<section class="screen" id="…">` out of
  `public/index.html` and asserts **every** screen this function can emit actually exists;
- the SPA routes both deep-link paths (warm `postMessage`, cold `/?nav=`) through
  **`_pushNavTo()`**, which falls back to `home` for an unknown id and refuses to navigate at
  all when there is no session. Not redundant with the first fix: **notifications already
  delivered to a phone keep their old payload forever**, so the guard is what makes the
  already-sent ones survivable.

### 2. The notice's TITLE now travels; the body still never does

Owner request: identify the notification, keep the detail behind the app. So `buildPushPayload`
sends `n.title` and still sends a fixed string for `body`. The long lock-screen block comment in
`push.service.ts` is updated rather than deleted — **the body rule is unchanged and still the
important one**; it is the field carrying incident summaries and free text about named minors.

Exposed titles are `Check-in closing soon`, `Incident logged · <Zone> Zone` (both system-fixed),
and the subject a director/zone leader types. That last one is author-controlled — **the one
place a leader can put a camper's name on every recipient's lock screen.** Accepted trade,
mitigated twice: `pushTitle()` collapses whitespace and caps at `PUSH_TITLE_MAX` (80), and the
compose screen tells the author their title shows on locked phones.

### 3. Normal-priority notices no longer buzz anyone — `isPushable()`

Before this, *every* active notice pushed, so "dinner is at 6" alerted every leader's phone —
the fastest route to a camp where everyone has turned alerts off, urgent ones included. Now:
**urgent → push; normal → in-app only.** Incident alerts and check-in warnings are matched
structurally as well as by priority, so neither can be silently demoted by a later edit.

⚠ The gate runs in the **cron filter, before `resolvePushAudience`** — a filtered notice is
never claimed, so it stays `pushSentAt: null` and is re-examined on all 288 ticks a day until
it expires. Fine for a pure predicate over a field already in memory; **not** fine after a
per-user subscription lookup. `sendForNotifications` applies it a second time, deliberately:
the caller decides *when* to push, the service decides *what may be pushed at all*.

### 4. `POST /push/test` — prove a phone works without waiting for a real alert

Neither real trigger can be exercised on demand: an incident alert means logging a fake
incident against real people, and the check-in warning needs a camp day, a lead window, and a
church genuinely behind. The self-test reuses the check-in warning's **exact** shape (title,
`tag`, `screen: 'checkin'`), so it proves VAPID signature → APNs/FCM → `sw.js` → deep link.
**It does not prove `churchesBehind` arithmetic — delivery only.** Button: *Send a test*, on
the alerts card on Notices, visible once the device is subscribed.

Security: the user id comes from the **session, never the body**. A body-supplied id would make
this "send an arbitrary push to any account", and the payload renders as a genuine camp alert on
a locked phone. It writes no notification row, and a failed test does **not** count towards
`PUSH_FAILURE_LIMIT` — a leader debugging their own phone taps it repeatedly, and ten taps must
not delete the subscription they are testing.

Verified: `npm run typecheck` clean; `npx vitest run` **785 pass / 49 files** (was 771, +14);
`node --check` OK on `sw.js` and on the SPA script body (extract range **847–6920**, re-derived).

## "Alerts on this device" — iOS opt-in fixed + moved to Notices — deployed 2026-07-31

Owner bug report: the Home card's "Turn on alerts" button worked on a laptop but an **installed
iPhone** answered *"Could not turn on alerts on this device"*. SPA-only (`public/index.html`), no
backend/schema change. `npm run typecheck` clean, `npx vitest run` = **765 pass / 49 files**
(unchanged — this is browser-only code). SPA + `sw.js` `node --check` OK. `sw.js`
`camp-v62`→**`camp-v63`**.

### The bug: user activation is lost across `await` in WebKit
The generic toast was the `catch` in `_pushOn`, so the failure was a **throw**, not one of the
"not possible here" branches. The only browser-behaviour difference in that code path is user
activation: `_pushOn` did `await confirmSheet(...)` and *then* called
`Notification.requestPermission()`. **WebKit scopes user activation to the event handler's own
call stack**, so a call made after an `await` — even one resolved from a click — has already left
that stack and is rejected with `NotAllowedError`. Chrome uses a *time-based* transient-activation
window instead, which is exactly why it worked on the laptop and looked device-specific.

`_pushOn` is now split in two and **must stay split**: it only opens the consent sheet, and
**`_pushConsentGo`** is the sheet's own `onclick`, calling `requestPermission()` as its first
statement (before `closeModal()`, before anything async). The rest moved to **`_pushFinish`**.
Both API shapes are handled (Promise return *and* the legacy callback arg).

> ⚠️ Do NOT "tidy" this back into one `async` function, and do not re-introduce `confirmSheet`
> here. Any `await` between the tap and `requestPermission()` re-creates the bug, and it is
> invisible on every desktop browser.

### The generic toast is gone (`_pushFail`)
One bare "Could not turn on alerts on this device" covered permission, service worker, push
service and API failures alike — which is why placing this cost a full deploy-and-retest cycle.
The toast now names the error: `NotAllowedError` = activation/permission, `AbortError` = the OS
push service refused, anything else = our API.

> **This fix is reasoned, not device-proven** — it cannot be verified without an installed
> iPhone. If it still fails, the toast now says which step, and that is a one-tap diagnosis.

### Moved off Home to the Notices screen (owner request)
`_pushCardHtml()`/`_renderPushCard()` are gone from **both** Home renders (`RENDER.home` and
`renderHomeAtCamp`); `RENDER.notifs` is now the **only** caller, in both its branches (feed and
Scheduled). The card is also compact now — a `btn ghost sm` labelled button, no card chrome and no
heading, since the screen is already titled "Notices".

**Roles that can reach it:** church/zoneLeader/director have Notices as a bottom-nav tab; admin
reaches it via the Admin console tile (pre-camp) or the at-camp home Notices tile — `extras` render
only in the ≥980px sidebar, so those tiles are load-bearing (see the 2026-07-31 tile section below).
⚠ **`firstAid` has no Notices screen at all and therefore cannot opt in** — but it could not before
either: `RENDER.home` redirects firstAid straight to Search, so the Home card never rendered for
that role. Not a regression; flagged because it is now the only role with no route.

**There is deliberately still a tap.** A PWA gets no install-time permission hook — no event fires
at "Add to Home Screen", and both iOS Safari and Chrome refuse a gesture-less
`requestPermission()` (silently on iOS). "It should just ask on install" is not implementable; the
earliest possible prompt is a tap after first launch.

## The tick is LIVE — secrets set, `0014` applied, warning proven end-to-end — 2026-07-31

Config + verification only. **No application code changed** (this section and the redaction in
`docs/DEPLOY-NEXT-STEPS-2026-07-30.md` are the entire diff). The chain described in the two
2026-07-30 sections above is now actually running.

- **Vercel env vars set** (Production **and** Preview): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  (Sensitive), `VAPID_SUBJECT`, `CRON_SECRET` (Sensitive), via `vercel env add`. Redeployed —
  env vars only reach a NEW build.
- **`cron_secret` is in Supabase Vault** and matches Vercel. **Verified, not assumed:** before
  scheduling anything, a one-off `net.http_get` was fired from the DB using
  `vault.decrypted_secrets` against the real prod route — `net._http_response` returned **200**.
  That exercises the exact path `pg_cron` uses, so `0014` was never applied on hope.
- **Migration `0014` APPLIED** and its history row **reconciled** from the generated timestamp
  `20260731011901` to version `'0014'`. `cron.job` = `camp-push-tick`, `*/5 * * * *`, `active`.
  First automated run 01:20:00Z `succeeded` → 200.
- **✅ THE MIGRATION HISTORY DRIFT IS FIXED (2026-07-31).** All six rows (`0009`–`0012`,
  `0016`–`0017`) were reconciled from their generated timestamps in one statement, deriving the
  version from each row's own `name` (`set version = left(name,4) where version ~ '^\d{14}$' and
  name ~ '^\d{4}_'`) after a collision guard returned 0. **`supabase_migrations.schema_migrations`
  now reads exactly `0001`–`0019`, contiguous** — 19 rows, 19 files on disk — for the first time
  since the 2026-07-16 consolidation. A `supabase db push` now correctly sees everything applied.
  Reversal mapping if ever needed: `20260720012415`→`0009`, `20260723131647`→`0010`,
  `20260723131721`→`0011`, `20260723181751`→`0012`, `20260728114005`→`0016`,
  `20260729125651`→`0017`.
  ⚠️ **This only stays clean if every future `apply_migration` is followed by the reconcile step.**
  That step has now been skipped six times historically; it is not optional on this project.

### The end-to-end test (run against prod, then fully reverted)
The unit tests were not trusted. Camp dates were temporarily today's, the church time restriction
on, and the PM window narrowed to put "now" inside the 60-minute lead. One tick returned
**`checkinWarningsCreated: 6, failed: 0`** and wrote exactly what the 2026-07-30 hardening claims:

- **Per-login addressing (item 1) CONFIRMED** — `b-citipointe-brisbane` got **20** and
  `g-citipointe-brisbane` got **17**, each `target_user_id`-addressed to that one login. This is
  the exact bug item 1 fixed; before it, both accounts saw both contradictory counts.
- **Expiry (item 2) CONFIRMED** — `expires_at = 02:14Z` = 12:14 Brisbane = the window close.
  Correct to the minute, so `zonedToInstant` is not re-introducing the UTC-vs-Brisbane bug (the
  old failure landed 10 hours early).
- **Dedupe CONFIRMED** — an immediate second tick returned `checkinWarningsCreated: 0`.
- Copy pluralises correctly ("1 student" / "20 students"); `audience_estimate` carries the
  remaining count (the reason item 14 kept the column).

Reverted after: the 6 notices deleted, PM window restored to `12:00`/`23:00`.

> ⚠️ **CHANGING THE CAMP DATES IN THE UI MOVES THE SCHEDULE AND DEVOTIONALS WITH THEM.**
> `remapDays()`/`applyDayMoves()` re-key both by POSITION (2026-07-28 item 3). After the date
> change all 48 schedule items + the devotional sat on `2026-07-31`–`08-03`. **So camp dates must
> be reverted through the admin UI, never by SQL** — a direct SQL revert strands every schedule
> and devotional row on the old dates and those screens go blank. Remap is lossless only while
> the day COUNT matches (shrinking hides the surplus).

### Web-push §12 q9–12 ANSWERED — nothing organisational gates rollout
Metadata transfer to Apple/Google/Mozilla **accepted**; **no under-18 login holders** (all are
compliance-trained leaders — re-ask if that ever changes); the **youth team** owns the privacy /
compliance update; the iOS Add-to-Home-Screen install happens at the **pre-camp training day**.
Full record + the caveats that survive: `docs/PLANNED-IMPROVEMENTS.md` 2026-07-31 section.
⚠ The install still forces a **re-login** (separate storage partition, randomised `Word.###`
password, initials re-prompt) — fine at a training day, painful mid-camp. **If the training day
slips, that cost comes back.**

### Clean-up batch, same day — passwords, check-in dedup, Notices route, history drift
Built by two parallel subagents in isolated worktrees (backend / SPA — disjoint files), merged and
gated together. `npm run typecheck` clean, `npx vitest run` = **765 pass / 49 files** (was 759; 6
new). SPA + `sw.js` `node --check` OK. `sw.js` `camp-v61`→**`camp-v62`**.

- **B8 — church passwords widened to `Word.###`** (three zero-padded digits, `Donkey.683`).
  Keyspace ~11.7k → ~117k. ⚠ **Existing passwords are hashed and stay valid, so the wider keyspace
  does NOT take effect until someone re-runs "Randomise & export church passwords" and
  redistributes the CSV.** Owner's plan is to do that at the pre-camp training day, alongside the
  iOS install. Also fixed latent arithmetic in the `minLength` backstop — a result is
  `word.length + 4` chars, and the code still said `- 3`.
- **N5 — `withCheckIn` is now idempotent.** A replayed identical entry is a no-op instead of
  writing a duplicate row into the compliance export. ⚠ It compares **only against the last entry
  for that same session**, never the whole history, because "checked in" is **last-entry-wins**
  (`toRosterEntry`, `checkin-warnings.ts`): a genuine in→out→in is three real entries and must keep
  working. There are tests pinning both halves. `atCamp`/`lifecycle` still untouched (P0 invariant).
- **Notices tile restored to the admin console, pre-camp only** — see that section below.
- **Migration history drift fixed** — see above.
- **`.claude/` added to `.gitignore`.** Agent worktrees live there and were **not** ignored: a
  stray `git add -A` would have published a second full copy of the tree to this **public** repo,
  and `vitest` was globbing them (147 files / 2289 tests instead of 49 / 765 — a badly misleading
  green). Remove worktrees before trusting a test count.

**Owner DECLINED this round, do not build without asking again:** a hard pre-camp mode gate on
`RENDER.incidents` (it is already unreachable pre-camp via every nav path; a hard gate was built
and reverted on 2026-07-17 because it stranded real safeguarding records — prod holds 6 incidents,
3 high-severity, all logged pre-camp); removing the Budget & Costings console tile; and S7's
`POST /admin/reset` hardening (the export guard still latches open after the first export — the
only real barrier remains the client modal + typed phrase).

### Push is configured but STILL UNPROVEN
`pushAttempted: 0` on every tick — there are **zero** `push_subscriptions`, so no push service has
ever been contacted and no notification has reached a device. `/push/config` is `auth:true` and was
never read with a session, so `configured:true` is **inferred** from the env vars being present in
the build, not observed. **Do not claim push works** until a real device subscribes and receives
one. The iOS adoption problem (no permission prompt until Add to Home Screen) is unchanged and is
still the biggest risk.

## "Other" removed from the student gender picker — deployed 2026-07-31

Owner request, SPA-only, no backend/schema change. `sw.js` `camp-v60`→**`camp-v61`**.
`npm run typecheck` clean, `npm run test` = 759 pass (unchanged — browser-only code).

`_stuFormFields`' `#seGen` (Individual Student Data Edit → add & edit) now offers **Male /
Female only**.

> ⚠️ **It was NOT simply deleted, and must not be "tidied" into a plain two-option select.**
> `'other'` records genuinely exist in prod: `import.service.ts` defaults a brand-new person to
> `gender:'other'` when the Form CSV's Gender cell is blank or unparseable (`Person.gender` is
> non-nullable and needs *some* value), and **this screen is exactly where an admin fixes them**.
> With the option gone, such a student's `<select>` would fall back to its FIRST option — Male —
> so saving any unrelated field would silently re-record them as male. Gender drives
> `genderScope` visibility for `b-`/`g-` church logins and the accommodation pools, so that is a
> real data change, not a cosmetic one.

Instead: anything that isn't `male`/`female` renders a **blank "— Select —" placeholder**, and
`stuSave`/`stuCreate` both refuse with *"Choose Male or Female"* until a real choice is made.
Add (`s` null) gets the placeholder too, so a new student can't be created as male by
inattention either — that was pre-existing behaviour and is now closed.

**`GENDERS` in `src/core/types/enums.ts` still contains `'other'` and the backend still accepts
it.** Deliberate: the import default depends on it, and narrowing the enum would make every
existing `'other'` row fail validation on read. This change is about what an admin can *choose*.
The other three gender `<select>`s in the SPA are filters and were already Male/Female only.

## Registration lists: second export button (.zip) — deployed 2026-07-31

Owner request, SPA-only, no backend/schema change. `sw.js` `camp-v59`→**`camp-v60`**.
`npm run typecheck` clean, `npm run test` = 759 pass (unchanged — this is browser-only code).

The card now has **Download images** (the original staggered per-file downloads) and
**Download as .zip**. Both call the shared **`_rlGenerate(say)`**, which does the fetch, the
tiering and the drawing exactly once, so the two buttons can never produce different sets —
`exportRegistrationPngs` and `exportRegistrationZip` only differ in how they deliver the result.
`_rlSaveBlob` is the one anchor-click download helper.

### The zip writer is hand-rolled (`_zipBlob`, `_crc32`, `_deflateRaw`, `_dosDateTime`, `_CRC_T`)
**Nothing in this repo can make a zip** — `exceljs` writes xlsx and is server-side, and the
browser's vendored `xlsx` build doesn't expose one. Adding JSZip for a single button was not
worth a new vendored dependency. Classic 32-bit layout: local header + data per entry, then the
central directory, then the EOCD. **No zip64**, so entries and the archive cap at 4GB — a set of
name-only PNGs is a few hundred KB, so that limit is unreachable here.

- **DEFLATE comes from the platform**, `CompressionStream('deflate-raw')` (Chrome 80+, Safari
  16.4+, Firefox 113+). Where it is absent — **or where deflating makes the entry BIGGER, which
  is the normal case for a PNG, since PNG is already deflated** — that entry falls back to STORE
  (method 0). A store-only zip is still a completely valid zip.
- ⚠ **The CRC and the uncompressed-size field always describe the ORIGINAL bytes**, never the
  deflated ones; only the compressed-size field is the deflated length. Getting that backwards
  produces an archive that looks fine until something tries to extract it.
- The central-directory entry's last field is the offset of that entry's **local** header, not
  its data.
- A real DOS date/time is written. A zero date is accepted by most tools but shows as an invalid
  timestamp in Windows Explorer.

**Verified, not assumed:** the real `_zipBlob` was run in node over two entries — one highly
compressible (exercising DEFLATE) and one of random bytes (exercising the STORE fallback, which
is what a PNG hits) — and the resulting archive was extracted by **Windows' own
`Expand-Archive`** with byte-identical SHA256 hashes on both entries. `_crc32` also matches the
standard `"123456789"` → `0xCBF43926` vector.

If the zip ever fails to build, `exportRegistrationZip` catches it and points the user at the
"Download images" button, which shares all the generation code and cannot be affected.

## Notices tile removed from the Admin console — deployed 2026-07-31

Owner request, SPA-only (`public/index.html`), no backend/schema change. `sw.js`
`camp-v58`→**`camp-v59`**. `npm run typecheck` clean, `npm run test` = 759 pass (unchanged —
nothing tested referenced this tile). SPA + `sw.js` `node --check` OK.

`RENDER.admin`'s Data group no longer renders `_adminTile('bell','Notices',…)`. Nothing else
changed: the five other `gotoTab('notifs')` call sites are notice-card taps and post-send
redirects, and the `notifs` screen, route and nav entries are all intact.

> ✅ **THE GAP THIS OPENED WAS CLOSED THE SAME DAY — see the 2026-07-31 section at the top.**
> Removing the tile left an admin on a PHONE in PRE-CAMP with no route to Notices at all: the
> 4-slot phone bottom nav gives Notices' old slot to Data Import (bug 6), and `navModel`'s
> `extras` — where Notices lives for admin — render **only in the ≥980px sidebar**. The tile is
> now **restored under "Camp setup", gated to pre-camp** (at camp the at-camp home grid already
> carries one, so a console entry would be a duplicate route). **Do not remove it again without
> re-opening that gap, and do not "fix" it by re-cutting the 4-slot bottom nav**, which was
> deliberately arranged.

The stale comment in `navModel` that pointed at this tile ("Notices is also reachable via a
button on Admin Settings (bug 5)") has been corrected in the same commit.

## Four-item owner batch — deployed 2026-07-31

Owner batch: Android install prompt, gender-narrowed hero accommodation, a new registration-list
PNG export, and a testimony-picker tidy. SPA + one DTO field. **No schema or migration change.**
`npm run typecheck` clean, `npm run test` = **759 pass / 49 files** (was 756; 3 new). SPA +
`sw.js` `node --check` OK. `sw.js` `camp-v57`→**`camp-v58`**.
Design: `docs/superpowers/specs/2026-07-31-four-item-owner-batch-design.md`.

### 1 — Android "install as web app" prompt (`_installBanner`)
`beforeinstallprompt` is a **Chromium** event — Safari/iOS never fires it, so **the iPhone path is
untouched by construction** and there is no "not iOS" test anywhere. `/install.html`, linked from
`_loginTips`, remains the iOS story and is unchanged.

New `#installBanner` div on the login screen (between the sign-in card and the help links),
`_installBanner()` called at boot beside `_loginTips()`. It `preventDefault()`s the event
(suppressing Chromium's mini-infobar), stashes it in `_deferredInstall`, and renders our own
Install / Not now strip.

⚠ **`prompt()` is called INSIDE the tap handler (`_installGo`), never from the event listener.**
Chromium refuses a gesture-less `prompt()` in some versions and **the refusal is silent** — the
user would get nothing at all and there'd be no fallback surface. Do not "simplify" this into an
auto-fire. The event is also **single-use**: `_installGo` nulls it and hides the banner regardless
of the user's choice; Chromium re-fires on a later visit if they dismissed the native dialog.

"Not now" and the `appinstalled` event both set `localStorage['ycp_installdismissed']`, which
suppresses the banner permanently on that device. Gated to **Android** UAs (desktop Chromium fires
the same event; the owner asked for phones). Every path is `try/catch`ed — this runs on the login
gate where a throw is maximally visible, and `localStorage` throws outright in some privacy modes.

### 2 — Church hero accommodation narrowed to the login's gender
`renderHomeAtCamp()` mapped **every** room from `/accommodation/church-rooms/:churchId`, which is
church-scoped but **not** gender-scoped — so a `b-`/`g-` account saw both teams' rooms. Now
filtered by `ACTOR.genderScope` (already on the client via `toSafeUser`, and via the restored
session). Two deliberate behaviours: **a `null` genderScope keeps both rooms** (an unsplit account
must not get a blank line), and an empty filter result falls through to the existing
"To be confirmed". Display-only — the endpoint was already access-gated, and narrowing a display
cannot widen access.

### 3 — Registration lists (PNG) — new export
New card on Admin → Records & Export (`RENDER.adminData`), **admin + director**. Church dropdown
(filled after paint by `_loadRegListChurches`, defaulting to *Citipointe Brisbane* **matched on
NAME, not a hard-coded id** — church rows are recreated by the new-year rollover and their ids do
not survive it) + a Split override. Symbols: `_rlSlug`/`_rlSortKey`/`_rlSort`/`_rlName`/`_rlFit`/
`_rlTier`/`_rlSheets`/`_rlDraw`/`exportRegistrationPngs`, and `RL_W`/`RL_PAD`/`RL_ROW`.

Tier from the **student** count only (leaders never move the threshold): `<50` one whole-church
image, `50–100` Guys + Girls, `>100` one per year level. **Plus a Leaders image at every tier**,
one per church (not per grade). Overridable from the Split dropdown. Verified by running the pure
helpers in node: all three splits list every person, with the boundaries exactly at 49/50/100/101.

- **⚠ NAMES ONLY on the image.** No payment status, no accommodation, no medical or contact data.
  These get forwarded to leaders over consumer messaging apps; this codebase encrypts most of that
  at rest and it must not be re-published on a shareable picture. Same reasoning as the push-payload
  rule in item 11 above.
- **Students with no grade recorded get their own "Grade not recorded" sheet.** Silently dropping a
  registered student from a roll-call export is the worst failure this feature can have.
- **`dateSubmitted` was added to `RegistrantDto`** — the only backend change in the batch, no
  schema change (`elvanto_meta` already round-trips). It is the Elvanto **form submission** date;
  `createdAt` only says when the IMPORT created the row, so a bulk import ties a whole batch and
  ordering by it is meaningless. Sort key falls back `dateSubmitted` → `createdAt` → name, and
  every step is needed. Order is oldest registration at top.
- **Drawn client-side on a `<canvas>`.** There is no image library in this repo (server `exceljs`,
  browser vendored `xlsx` — neither makes pictures) and doing this in a Vercel function would add
  a dependency and a memory cost for something the browser does natively. **Do not move it
  server-side.** Canvas does not wrap or clip text, hence `_rlFit`.
- **Downloads are staggered ~300ms.** Mobile Safari and Chrome throttle simultaneous downloads and
  **silently drop the tail** — an unstaggered loop loses most of a 7-image by-grade run. The
  object URL is revoked on a 20s timer for the same reason (immediate revoke cancels the download
  on some mobile browsers).

### 4 — Testimony picker no longer prints the church
`RENDER.testimonies`' `<option>` was `Name · Church`. Removed for **all** roles: a church login's
list is already church-scoped by `_scoped('/campers')` so the label was noise, and admin/director
losing a tiebreak between two identically-named students in different churches was accepted as
rare. `churchName` stays on the built `items` array.

## Church check-in refused — the UI locked on the wrong rule — 2026-07-31

Reported: *"Daily check-ins for the admin account work but on a church account it gives '1 check-in
didn't save — tap to retry'."* Backend + SPA, **no schema/migration change**. `npm run typecheck`
clean, `npm run test` = **756 pass / 49 files** (was 749; 7 new). SPA + `sw.js` `node --check` OK.
`sw.js` `camp-v56`→**`camp-v57`**.

**Root cause — two rules that look alike and are not.** `currentSession()` answers *"which session
should the screen open on"* and, once camp dates exist, **never returns null**: with no session
today it falls back to the most recent past one, or the first upcoming one. `allowedWindowSession()`
answers *"which session may a restricted church WRITE to right now"* and returns **null** outside
camp days and outside the AM/PM windows. The SPA locked its roster on the first
(`sessionLocked = churchRestricted && SEL_SESSION !== CUR_ID`) while the backend gated writes on the
second. On a camp day they roughly coincide, which is why it survived since 2026-07-23; the camp
dates are 2026-09-28–10-01, so **before camp they diverge completely** — `CUR_ID` came back as
`2026-09-28~pm`, `SEL_SESSION` defaulted to it, the lock evaluated false, every row was tappable,
and every tap 403'd. Admin was unaffected because `assertSessionAllowed` returns immediately for
every role except `church`. Prod confirmed the preconditions: at-camp mode,
`church_checkin_time_restricted = true`, today not in `check_in_days`.

**This is the third hand-rolled copy of a backend rule found in two days** (after
`dashboard.latestNotification` and `account.listChurches`). The pattern is identical: the UI
re-derives a decision the server already owns, the copy drifts, and the disagreement only shows up
in a state nobody tested.

- **One rule, exposed as data.** New `allowedSession()` in `checkin.service.ts` returns
  `{session, restricted, reason}`. **`assertSessionAllowed` now calls it** rather than repeating the
  window arithmetic, and a new `GET /checkin/sessions/allowed` (actor-scoped, `auth:true`) serves the
  same answer to the SPA. A test asserts the two agree across in-window, out-of-window and
  non-camp-day instants. `getCurrentSession`'s interface doc now says NAVIGATION ONLY in as many
  words.
- **The SPA locks on `ALLOWED_ID`**, fetched only when `churchRestricted` (no extra round-trip for
  anyone else) and **failing closed** — an error means locked, since a restricted church could not
  have written anyway. When nothing is allowed the info box prints the server's own sentence
  ("…the morning window is 06:00–12:00 … on camp days only") instead of the misleading "tap the
  highlighted session (•)", which pointed at a session that was equally refused.
- **The server's explanation is no longer thrown away.** `drainQueue`'s catch kept only a counter,
  so a permanent 403 rendered as *"tap to retry"* — advice that can never work. It now keeps the
  first `e.message` in `_checkinFailReason` and the banner shows it. Cleared by `_retryFailedCheckins`.

⚠ **Not a regression from the 2026-07-30 push** — latent since item 11 (2026-07-23) and only
reachable outside camp dates. **Nothing about the camp-window policy changed**; a church still
cannot check in outside a window, which is the intended safeguard. **To test check-in before camp,
turn off Admin → Camp settings → Check-in & timing → the church restriction toggle** (or add today
to the camp dates). That toggle is the supported escape hatch and no code change should replace it.

## Schedule editor: copy / paste day — deployed 2026-07-30

Owner request. **SPA-only** (`public/index.html`) — no backend, schema or migration change.
`sw.js` `camp-v53`→`camp-v54`. Most camp days share a near-identical shape, so the admin was
retyping the same 10–15 rows for every day.

Each day's card in the At-Camp Info → Schedule editor now has **Copy day** and **Paste day**
beside "+ Add row" (Save moved to its own full-width row beneath, so the four actions don't
crowd on a phone). New symbols: **`_schedClip`** (module-level clipboard), **`_schedReadRows(d)`**,
**`copySchedDay(d)`**, **`pasteSchedDay(d)`**.

Two deliberate choices, both easy to "helpfully" break:
- **The clipboard holds the LIVE EDITOR rows, not what's saved on the server**, so a day can be
  copied mid-edit before it has ever been saved. `_schedReadRows` is now the single
  filled-rows-only reader, shared with `saveSchedDay` — so what you copy is exactly what that
  day would have saved.
- **Paste fills the target day's EDITOR only.** Nothing is written until the admin presses that
  day's Save, which keeps `PUT /schedule/day` as the one write path and makes a mis-paste
  recoverable by leaving the screen and coming back. **Do not auto-save on paste.**

Paste REPLACES the day and confirms first (`confirmSheet`) whenever the target already has rows;
pasting onto the day you copied from, or with an empty clipboard, just toasts. The clipboard is
module-level, so it survives `_rSched()`'s re-render and sub-tab navigation but not a page
reload — it's a scratch buffer, intentionally not persisted.

## Seven-item owner batch — deployed 2026-07-29

Owner-requested batch. SPA + backend + **migration `0017`** (`settings.discount_code_tags`,
`tent_price`, `classroom_price` — **applied to prod BEFORE the code push**, as
`supabase.settings` writes every column on every save). `npm run typecheck` clean,
`npm run test` = **688 pass** (was 670; 18 new), SPA `node --check` OK. `sw.js`
`camp-v52`→`camp-v53`. Design: `docs/superpowers/specs/2026-07-29-seven-item-batch-design.md`.
Symptom router: `debug.md`, section "2026-07-29 — seven-item owner batch".

### 1 — Schedule rows ~30% shorter, duration inline
The duration moved ONTO the time line (`9:00 · 30m`) instead of sitting on a second line under
it — `.sch-dur` lost `display:block` and the `.sch-item` time column widened `62px`→`92px` to
fit. `_schedHeight` was recut `min(190,max(54,40+mins*0.38))` → `min(133,max(38,28+mins*0.27))`,
a uniform ~30% reduction at every point of the curve (30m 54→38px, 1h 63→44px, cap 190→133px).
`.sch-list` gap 7→5px, `.sch-item` padding `10px 13px`→`7px 11px`. The compression (rather than
a linear scale) is still deliberate — a 30-minute item must stay tappable.

### 2 — Budget: TICKET CLASSIFICATION replaced the Full/Half/Part cost bands
The owner does not think in cost bands, and the tent/classroom split was invisible in the budget
entirely. A category is now a **`TicketClass`**: the accommodation kind crossed with a payment
**tag the admin sets on the DISCOUNT CODE**, plus one bucket for unrecorded accommodation.

| tag | tent | classroom |
|---|---|---|
| *(no code / untagged)* | Tent | Classroom |
| `inperson` | Tent — paid in person | Classroom — paid in person |
| `sponsor` | Tent full sponsor | Classroom full sponsor |
| `discount` | Discounted tent | Discounted classroom |

plus **Accommodation not recorded** (flagged with the warning triangle, never dropped — the
grand-total-equals-sum-of-rows invariant still holds and is still tested). Nine buckets, fixed
display order, **identical for campers and leaders**.

The tag lives on the CODE, not the person, because the codes already ARE the mechanism: a
no-code invoice is a plain full-price ticket and every concession, sponsorship and
pay-at-the-desk arrangement is expressed as a code against that baseline. One tag covers
everyone who used it — no per-person data entry.

- **`src/services/budget.ts`** — new `classifyTicket`/`personValue`/`labelForClass`/`labelForRow`;
  **`labelForAmount` and `applyDiscountOverrides` are DELETED**. `computeBudget`'s second
  argument is now an options object `{tags, prices, filterChurchId}`, not a bare church id.
  `CategoryRow.key` is a `TicketClass`; new `CategoryRow.valueMissingCount`; `amount` now means
  "the uniform per-person value, or null when the row's members paid different amounts" — which
  is NOT the same as `unrecorded` (true only for the `'unknown'` row). `budgetToCsv` writes a
  BLANK UnitPrice cell for a mixed row (a `0` there reads as "free" beside a non-zero LineTotal).
- **⚠ THE GRAND TOTAL NOW READS AS "MONEY RECEIVED", NOT "VALUE OF ALL PLACES".** `personValue`
  prefers `amountPaid` over `registrationCost`, and a `sponsor`-tagged code contributes `$0`.
  This follows directly from the owner's decision that a full sponsor counts as $0: a
  100%-discount invoice records `registrationCost: 180, amountPaid: 0`, so preferring
  `registrationCost` would count every sponsored place as revenue and contradict it. Precedent
  already existed in `_paidOrCostRow`. **To read it the other way, swap the last two lines of
  `personValue` AND its SPA mirror `_personValue` — nothing else changes.**
- **The Budget screen's per-code dollar field is gone.** "Mark paid in full" (shipped
  2026-07-27) is replaced by a classification dropdown — the tag implies the value, so there is
  nothing to type. `PATCH /settings/discount-overrides` → **`PATCH /settings/discount-tags`**;
  `SettingsService.updateDiscountCodeOverrides` → `updateDiscountCodeTags`. Same **`budget:manage`**
  gate (admin + director). Unknown tag values are silently dropped, not rejected — clearing a tag
  is a normal edit, and the dropdown's "plain" option submits an empty string.
- **`settings.tentPrice`/`classroomPrice` are BACK** (they were deliberately dropped by migration
  `0004`) with a **narrower job**: a reference full price, editable in Admin → Camp settings →
  **Ticket prices**. They value an `inperson` ticket and define what "discounted" is measured
  against. **They are NOT the source of any registrant's recorded cost — do not restore the old
  price × headcount behaviour.** Null = not set, which makes an `inperson` tag fall back to the
  person's recorded amount (the Budget screen warns when that is happening).
- **Migration `0017`** seeds `discount_code_tags` with `'inperson'` for every key that was in
  `discount_code_overrides` — that is exactly what that field meant (EFTPOS/cash collected at
  registration). The old column is left in place and still round-trips, unused, so a rollback is
  possible. `docs/PLANNED-IMPROVEMENTS.md`'s 2026-07-20 section is now marked BUILT-THEN-SUPERSEDED
  (it had been stale since the day it shipped).

### 3 — "Clear all notifications" removed from Data Export/Reset
Owner request. The backend route `DELETE /admin/notifications` is **left in place, unused** —
same precedent as the 2026-07-28 removal of the standalone sign-in/out CSV button. `adminClear()`
is deleted from the SPA. Notices are deleted individually on the Notices screen. Don't re-add a
bulk button without asking.

### 4 — Imported first/last names are capitalised
New `titleCaseName()` in `elvanto-mapping.ts`, applied at the name read sites in
`import.service`, `ticket-import.service` and `invoice-import.service`. It fixes **only** names
that are entirely upper-case or entirely lower-case; anything already mixed-case is returned
untouched, so `McDonald`, `O'Brien`, `de Silva` and `van Wyk` survive. Deliberately NOT inside
`field()` (that helper also reads church names, ticket types and emails) and NOT in
`offline-signin.service` (it matches, never stores). **Import path only — no backfill script
against prod**; the authoritative Form import re-reads every registrant on every run, so
existing bad names self-correct on the next import.

### 5 — iOS keyboard-dismiss scroll restore
`_fixViewportGap()`, ported verbatim from YS Connection: a same-position `scrollTo` on the next
frame, wired to `visualViewport.resize` with a delegated `focusout` fallback. On the phone
body-scroll shell, closing the keyboard restores the viewport but not the scroll position and
leaves the sticky header / fixed nav laid out against the stale keyboard-open height. **This is
NOT a replacement for the 2026-07-26/28 `html`+`body` background and `.tabs::after` rules** —
those paint over the exposed strip, this restores the scroll. Both are needed.

### 6 — Two login-screen help links
`public/install.html` (Add to Home Screen) and `public/save-password.html` (save the login to the
phone's password manager by hand, for when it never offers). **Standalone static pages, not
in-app overlays** — the SPA shell isn't up on the login screen, which is why YS does it this way
too. Rendered by `_loginTips()` on iOS/Android user agents only. Both derive the site address
from `location.host` so they are correct on any deployment, and **neither calls `/settings`** (the
camp app has no `ministryConfig.branding.appName`; that block was dropped in the port).

### 7 — Remember-password review
Applied: the last username is saved to `localStorage['ycp_lastuser']` and prefilled at boot
(**never the password**), which also gives the password manager a stable id to match on;
`doLogin` now `await`s ~150ms before hiding the form, because Safari's save-heuristic can miss a
credential whose password field is torn down in the same tick; `#mcpGate` is a real `<form>` with
a hidden `autocomplete="username"` field (that gate is dormant — `MUST_CHANGE_PASSWORD_ENFORCED`
is `false` — so this is pre-emptive). **Deliberately NOT applied** (owner declined): firing
`navigator.credentials.store()` on the change-password path as well as login.

## 28-item bug/improvement batch — deployed 2026-07-28

Owner-requested batch (25 numbered items + 3 folded in mid-session). SPA + backend +
**migration `0016`** (`settings.site_map_image`, **applied to prod BEFORE the code push** —
`supabase.settings` writes every column on every save, so the column must exist first).
`npm run typecheck` clean, `npm run test` = **670 pass** (was 634; 36 new), SPA `node --check` OK.
`sw.js` `camp-v50`→`camp-v51`. Full symptom router for everything below: `debug.md`, section
"2026-07-28 — 28-item bug/improvement batch".

### Schedule
- **1 — "+ Add row" inserts after the last-focused row** (`_schedLastRow`/`_schedFocus`/
  `addSchedRow`), falling back to append when nothing has been touched or the remembered row
  belongs to another day's table.
- **2 — The schedule plan view is now a proportional, colour-coded timeline.** `RENDER.schedule`
  + `SCHED_CATEGORIES`/`schedCategory()`/`_schedMinutes()`/`_schedHeight()` + `.sch-*` CSS.
  Colour comes from a keyword match on the activity TITLE (session → violet, zone battle → rose,
  pre show → teal, meal words → amber, everything else → grey). Each item's height is the time
  until the NEXT item starts; the last item of the day runs to 24:00 (what "Lights Out" wants).
  Heights are deliberately compressed (`40 + mins*0.38`, clamped 54–190px) so a 30-minute item
  stays tappable and an overnight block doesn't push the day off screen. The admin editor is
  visually unchanged but gained a `helpTip` quoting the keyword list via `_schedKeywordHelp()` —
  one source of truth with `SCHED_CATEGORIES`.
- **3 — Moving the camp dates now carries day-keyed content with it.** `remapDays()` +
  `applyDayMoves()` in `settings.service.ts` (wired with the devotional + schedule repos in
  `container.ts`). Devotionals and schedule items are stored against an absolute DATE but authored
  per day NUMBER, so shifting the start date used to strand every one of them on dates the app no
  longer reads — the data was intact but every screen went blank. They are now re-keyed by
  POSITION (old day 1 → new day 1). Rows are deleted then re-saved, because an overlapping shift
  means day 2's old date IS day 1's new date. **Shrinking the camp hides rather than deletes** the
  surplus day, so lengthening again (or fixing a mistyped date) recovers it. Applied to the
  schedule as well as devotionals — identical mechanism, identical silent-loss failure.

### Accommodation & budget
- **5 — Second-level classroom split.** A church×gender pool over `SPLIT_THRESHOLD` (50) still
  splits into `7-9`/`10-12`; a bracket that is ITSELF over 50 now splits again into single year
  levels `Y7`…`Y12` — up to 6 pools per gender, 12 per church, gender always honoured.
  `yearGroupsFor`/`spreadLeaders` (`accommodation-allocation.ts`, tested) + the SPA mirrors
  `_accomYearGroups`/`_spreadLeaders`. Leaders halve across brackets then spread evenly across
  that bracket's year levels (remainder to the earliest year); unknown-grade youth ride with the
  bracket's lowest year. `classroom_allocations.bracket` is unconstrained `text` — no migration.
- **4 — Budget category rows were blank.** `_budScopeRows` built rows with no `label` while
  `drawBudget`'s `catRow` renders `esc(r.label)`, so every line under a church's Campers/Leaders
  heading was empty (a null-cost row showed a bare warning triangle). `_budLabel(amount, full)`
  now fills it; `full` was already being passed in for exactly this purpose and was unused.
- **23 / B — Navigation to allocations and budget.** Admin → Accommodation setup gained a button
  straight to the allocations map. Budget & Costings gained an admin-console tile, a card on Data
  Export/Reset, and a sidebar entry for admin AND director in BOTH modes (it was pre-camp-only, so
  an admin on a laptop mid-camp had no route to it at all).

### Accounts, home, first aid
- **13 — The two gendered church logins are edited as ONE unit.** Previously both `b-`/`g-` tiles
  opened the same modal, which only ever found the FIRST account — so editing the girls' username
  silently rewrote the boys' one and the pair collided into an unusable state. Account Info and
  Bulk Church Update now take a single BASE username and re-apply the `b-`/`g-` prefix per account
  (`_churchUserBase`/`_churchAccts`/`_churchPrefix`); church name, zone and delete already applied
  to both. Passwords stay per account (owner's call). The accounts screen renders one joined
  `.ch-pair` card per church with a light-blue Boys half and a light-pink Girls half, so the UI
  matches how the pair actually behaves.
- **14 — A church login is greeted by its FULL name.** `dashboard.service.greetingName` no longer
  truncates to the first word for `role==='church'` (a personal leadership login still gets its
  first name). `_heroNameCls` drops names over 14 chars to half size and lets them wrap.
- **20 — First aid: "Signed in only" filter, ON by default** on both Search and All Students.
  Inert pre-camp (nobody has signed in yet). `_faSignedInOnly`/`_faSignedInFilter`.
- **21 — First aid: revealing a parent number no longer 404s.** `search.service.revealContact`
  required lifecycle ≥ arrived while `resolveContacts` deliberately did not, so the Student Info
  card would render a masked number for a not-yet-arrived student that could never be revealed.
  `canAccessPerson` is still the real gate.
- **22 — Cross-gender secondary contact.** `contactsForPerson()`: a person leads with their own
  gender's contacts, and if that gender has a primary but no backup, the OPPOSITE gender's primary
  becomes the secondary. A gender that already lists two leaders is untouched.
- **8 — Site map (NEW).** `settings.siteMapImage` (**migration `0016`**) holds a client-baked
  `data:image/...` URI; the server stores an opaque string and the Zod schema rejects anything that
  isn't a data-image URI (no remote URL → no SSRF/tracking-pixel surface).
  **The page CSP must keep `img-src 'self' data:`** — this is the app's only data-URI image, and a
  bare `img-src 'self'` blocks all three `<img>` sites (crop probe, settings preview, Map screen).
  The symptom is a misleading "Could not read that image file" toast on a valid PNG, because the
  block surfaces as the probe `Image`'s `onerror`. Missed in the original port (2026-07-28) and
  fixed 2026-07-29; YS Connection's CSP already allowed it, which is why the cropper worked there.
  A "Map" button sits on the Home hero for every role (firstAid has no home screen, so it gets one
  on its Search landing) and is hidden entirely until a map is uploaded. Upload + crop live in
  Admin → Camp settings → Camp details & dates. **The crop tool is a port of YS Connection's logo
  cropper** (`_openLogoCropModal`/`_cropRectFor`/`_cropClampPan` in `Project 7`) generalised from a
  fixed square to an arbitrary aspect ratio — `vp` became `vpW`/`vpH` throughout and the modal
  offers Portrait/Tall/Square/Landscape, defaulting to whichever is closest to the image's own
  shape. Output is ~1400px on the long edge (the sample map's building labels are unreadable
  below that), PNG first with a JPEG 0.92 → 0.8 fallback if it exceeds the 1.6M-char cap.

### Admin console, data & reset
- **9 — "Data reset" (was "Factory reset").** Three tools, least → most destructive: Clear all
  notifications (moved here, and no longer at-camp-only), **Reset logs** (NEW), Full reset.
- **`resetLogs` (NEW, `POST /admin/reset-logs`)** clears exactly what a compliance workbook
  contains — every person's check-in and sign-in/out history (returning them to "not signed in";
  `cancelled` people keep their lifecycle), all notes/testimonies/first-aid records, all incidents.
  Registrations, churches, accounts, accommodation, schedule, devotionals, FAQ and settings are all
  kept. Notifications are deliberately NOT included (their own button). Guarded by the same
  export-or-force gate as a full reset.
- **16 — Incidents survived a "full reset".** `makeAdminService` was never given the incident or
  push-subscription repos, so `reset()`'s wipe list was silently incomplete — no compiler or test
  covered it. Both are now constructor params and both are cleared. **Any new repository must be
  added to `reset()` in the same commit.**
- **Typed confirmations are case-insensitive** (`_CONFIRM_PHRASE`/`_confirmPhraseOk`) — a phone
  auto-capitalising "I understand…" no longer reads as a failed confirmation. The canonical string
  still goes over the wire; only the typed comparison is loosened.
- **10 — Notices + Scheduled notices merged** into one screen with Sent/Scheduled sub-tabs
  (`RENDER.notifs(sub)`, `NOTICE_SUB`), moved under the **Data** heading. The "Communications"
  group is gone; `RENDER.scheduled` survives as a redirecting alias.
- **11 — Every admin-console tile has an icon** (`_adminTile` is now the single tile builder, so a
  new entry can't miss its glyph). Three new `ICONS` keys: `swap`, `dollar`, `map`.
- **25 — The standalone "Sign-in/out log (.csv)" export button is gone** — that data is already a
  sheet in the workbook. The backend route is left in place, unused.
- **24 — Every audit sheet is newest-first.** The Sign-in & Sign-out timeline still folds its
  running totals CHRONOLOGICALLY and reverses afterwards, so each row's counts remain correct for
  the moment it happened and the top row carries the live totals.
- **6 — Tooltips clamp inside the `.screen`, not just the viewport**, so a bubble can't be clipped
  by the ≥980px `overflow:hidden` content column / run under the sidebar.
- **7 — The "accommodation override has moved…" note is removed** from Account Info.
- **15 — The light-purple strip under the bottom nav.** The 2026-07-26 `html{background:#fff}` fix
  only covered the CANVAS; the strip iOS exposes below the layout viewport is also painted by the
  BODY box, which still carried `--paper`. `body` is now white with `--paper` on `.app` alone, and
  **`.tabs::after`** extends the nav's white surface 120px below it (inside the nav's own stacking
  context, starting at `top:100%`, so it can never cover content).
- **17 — Incident high-severity toggle reads "High · alert zones"** (and the screen's infobox was
  reworded to match it rather than the reverse).
- **18 — The "Got it" banner is incident-only.** `_urgentAlerts` also requires
  `_isIncidentNotice(n)`; acknowledgement was only ever meant for incidents. Since `leadersOnly`
  notices are filtered server-side for church/firstAid, **those roles now never acknowledge
  anything** — the intended outcome. An ordinary urgent notice is read in the Notices list.
- **19 — "Validation failed" when adding a note from the Students screen.** The SPA posted
  `sessionId: SEL_SESSION`, which is genuinely `null` outside the check-in screen, and Zod's
  `.optional()` rejects `null`. `AddNoteSchema` now uses `.nullish()` and the SPA omits the key.
  **New optional fields on schemas the SPA posts to should be `.nullish()`, not `.optional()`.**

### Imports (items 12 + the three folded-in items)
- **12 — Spurious "Missing firstName or lastName" on a file that imports fine.** A trailing blank
  line is spreadsheet padding, not a defect: `isBlankRow()` (`elvanto-mapping.ts`) skips an
  entirely-blank row silently in all three importers. `field()` also gained a normalised header
  fallback (lowercase, non-alphanumerics stripped) so "First name" / "FIRST NAME" / "First  Name"
  resolve. A genuinely half-filled row still errors.
- **Ticket-type corrections + the accommodation override — verified, not rewritten.** The Ticket
  List update path already re-parses `Ticket Type` every run and applies `churchOverride` ahead of
  it; a regression test now pins that.
- **Multiple tickets / invoices for one person (the "bought the wrong ticket, pay the difference
  with a code" flow).** Tickets: the later row's type already won (the corrected ticket) — it now
  also warns naming the winning ticket and sets `needsReview`. Invoices: money fields ACCUMULATE
  across rows (`amountPaid`/`discountAmount`/`feesAmount`/`taxAmount` summed, `registrationCost`
  from the latest row), plus a warning and `needsReview`. ⚠ Accumulation starts from the rows in
  THIS file, never from the stored value, so **re-importing the same export is idempotent and
  cannot double-count** — covered by a test; don't "simplify" it to read the person's existing value.
- **Pending deletions are named.** The Form import is authoritative and deletes anyone absent from
  the file; the result carried only a COUNT, so a spelling change or wrong export could silently
  drop real registrants. Each absent person now gets a warning naming them and their church (capped
  at 50), visible in the DRY-RUN preview before anything is confirmed.
- **Ticket-difference discount codes are labelled honestly.** A code averaging ≥97% of the ticket
  price is the pay-the-difference correction, not a sponsored place. Still counted in the budget's
  discount breakdown (owner's decision) but labelled "Ticket difference — already paid" rather than
  reading as "100% Off".

### Copy pass (Sonnet sub-agent review, same session)
A consistency review of every `helpTip`, `.note-hint`, `.infobox`/`.warnbox`, `.sub` and
`emptyState` string. Applied: the detail-screen header said "Camper" (the only user-facing use of
that word — now "Student"); two notices strings omitted admin from who can send; the first-day
arrival tooltip and toast said "student" although the roster includes leaders; the wide-role search
placeholder said "camper"; the Churches and site-map tooltips were trimmed; the duplicated
sensitive-note explanation lost its redundant bubble (the always-visible `.sub` stayed, and the now
unused `_SENSITIVE_HELP` const was deleted); the incident infobox was reworded to match the
"alert zones" button. **Deliberately NOT applied:** the reviewer's proposal to rename every
"ministry" to "church" on the accommodation/budget screens — the owner uses both terms naturally
(their own bug list says "ministry"), so that is a vocabulary decision for them, not a cleanup.

## Migration files consolidated — 2026-07-16

`supabase/migrations/` was collapsed from 24 files (`001`–`023`, incl. a duplicate
`004`) into four 4-digit files: `0001_baseline_schema.sql` (full end-state, minus the
deprecated `settings.tent_price`/`classroom_price` columns, reflecting the encrypted
`people` shape), `0002_rls.sql` (RLS on all 18 tables — 17 enabled directly in that file
at the time of this consolidation, plus `incidents` (migration `0007`, added after) —
also closes the gap where the old `020` never enabled RLS on `allocation_overrides`),
`0003_seed.sql` (admin + settings singleton, verbatim from the old `002`), and
`0004_drop_deprecated_columns.sql` (gated drop of the two dead pricing columns). The 24
originals are preserved verbatim in `supabase/migrations_archive/` (historical record;
outside the CLI's scanned folder). Historical prose in this file that cites an old
migration number (e.g. "migration `013` added `bracket`") still refers to those
archived files.

**Migrations have since progressed to `0008`** (`0005` unified check-in/sign-in entry,
`0006` gender-scoped church accounts, `0007` incidents — the table that brought the count
to 18, RLS enabled in that same migration — `0008` leaders-only notifications); next
migration = `0009` (revokes the public/anon/authenticated execute grant on the
Supabase-provisioned `rls_auto_enable()` event-trigger function and codifies that
function + its `ensure_rls` trigger in a tracked migration for the first time).
Since then: **`0010`** (scheduled notices — `notifications.scheduled_for`), **`0011`**
(check-in windows — four `checkin_window_*` cols + `church_checkin_time_restricted`), and
**`0012`** (2026-07-24 — drops `sign_out_history.parents_met`; applied to prod after the code
push that stopped writing it). Since then: **`0013`** (push subscriptions + notification claim
columns — **applied to prod** 2026-07-26), **`0014`** (pg_cron/pg_net + the tick schedule —
committed but **deliberately NOT applied**), **`0015`** (discount-code overrides — **applied to
prod 2026-07-27**, immediately before that push; the "not applied" note here was stale and was
corrected on 2026-07-28 after verifying `settings.discount_code_overrides` exists in prod), and
**`0016`** (2026-07-28 — `settings.site_map_image text` for the site-map feature, **applied to
prod BEFORE the code push**, as `supabase.settings` writes every column on every save).
Since then: **`0017`** (2026-07-29 — `settings.discount_code_tags` plus the returning
`tent_price`/`classroom_price`, for the budget ticket classification; **must be applied to prod
BEFORE the code push**, and it also back-fills the tags from the retired `discount_code_overrides`).
Since then: **`0018`** (2026-07-30 — `notifications.target_user_id`, per-login notice addressing;
**must be applied to prod BEFORE the code push**, as `supabase.notifications.save()` writes the
column on every notice save) and **`0019`** (2026-07-30 — `incidents.occurred_at`, optional).
**Both were APPLIED to prod on 2026-07-30 immediately before the push, and both history rows were
reconciled** from their generated timestamps (`20260730122502`/`20260730122518`) to `'0018'`/`'0019'`
and verified present by query. Since then: **`0020`** (2026-07-31 — the `reveal_audit` table; **applied to prod and
reconciled to version `'0020'` BEFORE the code push**). Next migration = **`0021`**. See the 2026-07-26 web-push section at
the bottom of this file for the gating conditions on `0014`.

✅ **~~Newly-observed history drift~~ — ALL SIX ROWS RECONCILED 2026-07-31.** `0009`–`0012` and
`0016`–`0017` had all been recorded under generated timestamps because the reconcile step was
skipped six times. Fixed together as its own task, exactly as this note asked for. **The history
table now reads exactly `0001`–`0019` with no gaps**, so `supabase db push` no longer sees six
phantom-unapplied migrations. Details + the reversal mapping are in the 2026-07-31 section near
the top of this file.

**Prod reconciled 2026-07-16 (code) + 2026-07-17 (DB).** The code-ref removal (dropping
`tentPrice`/`classroomPrice` from the settings entity/schema/seed/mapper + fixtures)
deployed to `master` first (must precede the column drop). Then against prod
(`nwfafrgojqkxylbppywo`): `0002` was run and was a **verified no-op** — all 17 tables
already had RLS on, *including* `allocation_overrides` (so the gap the old `020` left had
already been closed by the time this ran); `0004` dropped `settings.tent_price`/
`classroom_price` for real (both were present; 0 remaining after, 21 settings columns
left); a metadata history catch-up inserted `0001`–`0004` as applied and the old
timestamp-versioned rows (`005`–`023`) were **pruned**, so `supabase_migrations.
schema_migrations` now reads exactly `0001`–`0004`. Verified after: settings singleton
readable, a real admin settings save succeeds. A future `supabase db push` sees all four
already applied and does nothing. Design:
`docs/superpowers/specs/2026-07-16-migration-consolidation-design.md`.
Next future migration = `0005`.

## Improvement Initiative — Phases 1–7 deployed (2026-06-28)

A 7-phase improvement program (CMS engineering-maturity patterns onto this app's identity) was
completed and deployed to production on 2026-06-28. See `docs/PROGRAM-LOG.md`,
`docs/PROGRAM-SUMMARY.md`, `docs/CODE-QUALITY-LOG.md`, and the dated `CHANGELOG.txt` section.
Contract changes that supersede notes below:
- **Responsive system:** `:root` now has a fluid **type scale** (`--t-display`…`--t-micro`) and the
  `html` root font scales 16→17→18px at 768/1280. Continuous breakpoints (540/768/900/1280) sit
  before the 980px sidebar block; the content column widens 460→820px below 980. Use the `--t-*`
  tokens (and `--pad`, gender `--male/--female`, tint `--violet-d/--lav` etc.) — don't hardcode.
- **Icons:** SVG-only (no emoji). `ICONS` registry + `ic()` and new size helpers
  `icSm/icLg/icXl(n,cls)` + `emptyState(icon,msg)`. Adding a glyph = add to `ICONS`.
- **Navigation:** **single source** `navModel(role,mode)` → `{tabs,extras}`. `buildTabs` (bottom)
  and `_renderWideNav` (sidebar, via `navSidebar`) both derive from it — change nav in ONE place.
  Church/zoneLeader now have a populated desktop sidebar; admin at-camp sidebar = Home, Check In,
  Search, Notices, Accommodation Allocations, Admin Settings.
- **Budget:** REBUILT. Costs come from per-registrant `registrationCost` (NOT
  `CampSettings.tentPrice/classroomPrice`, which are now deprecated/unused — removed from the
  Settings UI, columns left in DB). Pure logic: `src/services/budget.ts` (`computeBudget`/
  `labelForAmount`/`budgetToCsv`). Categories = distinct cost per (church, camper|leader); null
  cost = "Cost not recorded" ($0, flagged, never dropped); grand total reconciles to the sum of all
  line totals. SPA `RENDER.budget`/`drawBudget` mirror it (collapsible church rows + client CSV).
- **Check-in sessions (AC-1):** `buildSessions` now makes the **first** camp day **PM-only**, the
  **last** day **AM-only**, interior days AM+PM (1-day camp = PM-only).
- **Accommodation (PC-10):** a church×gender classroom pool **>50** splits into `7-9`/`10-12`
  sub-pools (keys `${churchId}|${gender}|${bracket}`); leaders halved across brackets;
  `AllocationOccupant` gained `grade`. Single-gender/auto-fill/cascade unchanged. Tent City headings
  show total student/leader tents (PC-11).
- **Removed concepts:** "unpaid" is gone from the home DTO/UI (PC-3); FAQ/Help is pre-camp only
  (PC-7). `paymentStatus` field + reminders feature remain.
- **Service worker:** `sw.js` is now `camp-v7` (stepped v3→v4 P1 →v5 P4 →v6 P5 →v7 P6); `API_RE` includes `/export` (was missing).

### Phase 4 (first-aid login UX) — deployed 2026-06-28
- **firstAid nav** = **Search · Records · Schedule** (`navModel('firstAid')`). Search is the landing
  (no `home` tab — `gotoTab` redirects home→search for firstAid). **Medical Watch removed** (no Watch
  tab, no `/campers/medical` on the first-aid path).
- **First-aid records** = `StudentNote{category:'firstaid'}` (no migration). Body is 4 labelled lines
  `Problem:`/`Treatment:`/`First-aider:`/`Brought by:`. Written via `POST /notes` (category-scoped),
  read via **`GET /notes/firstaid`** (only firstaid category, `canAccessPerson`-scoped).
- **RBAC:** new `note:write:firstaid` (firstAid+director+admin) and `note:read:firstaid`
  (firstAid+zoneLeader+director+admin+**church**, the last own-church only). `note.service.add`
  asserts the firstaid capability **only** when `category==='firstaid'`; first-aiders can write/read
  ONLY first-aid records, never general notes/testimonies. **church can READ own-church first-aid
  records but not WRITE them** and has no general `note:read`.
- **Student Info** (renamed from "Casualty Card", `openStudentInfo`) leads with the student's
  **ministry leader** contacts (primary+secondary, via the existing `GET /search/contacts/:id`
  masked-contact path + audited reveal — no new permission); parent is the bottom fallback. Medical
  alert + consent are tone-softened; allergy-type dietary items are merged into the alert.
- **Admin Notes** (`RENDER.notes`/`drawNotes`): a **"First-aid"** Record-filter option + amber badge +
  Problem/Treatment body render; the notes CSV export already carries them (category column).
- **Tokens:** added `--ink-2` (darker secondary text) + softened `--alert-*`/`--consent-*` palette;
  all first-aid hardcoded hex tokenised (C1/C3 for these screens).

## UI/bugfix batch — deployed 2026-06-30

A small fix batch (admin-requested) shipped on 2026-06-30:
- **Account login locks (NEW).** `CampSettings` gained `churchLoginLocked` + `zoneLeaderLoginLocked`
  (both default `false`; migration `014`). Two **manual** toggles in admin **Settings**
  (`RENDER.adminSettings`/`saveSettings`, `.tgl` switch). When on, accounts of that role are
  blocked **at login only** — `auth.service.login` checks the lock *after* the password (so a
  locked account can't be probed) and throws `UnauthorizedError`. **Existing signed sessions keep
  working until their 12h TTL** (no per-request enforcement — stateless tokens carry the actor).
  admin/director/firstAid are never affected. `makeAuthService(users, settingsRepo?)` — the
  settings repo is optional (login lock is a no-op when absent, e.g. in unit tests). There is **no**
  automatic date-based trigger (deliberately dropped — the app is serverless with no scheduler).
- **Devotional editor:** the per-day **Save** button moved to the tile's **top-right**, inline with
  the day header (`RENDER.adminDevos`, `.rowsb` header row).
- **Tooltips (`helpTip`):** budget "Total registration fees" tip **removed**; long tips shortened;
  `_clampTip()` (called from `_toggleTip` on tap + a delegated `mouseover`) nudges the bubble so it
  never runs off either screen edge. Added brief at-camp tips to **first-day sign-in, daily
  check-in, My Youth, student search, testimonies**.
- **Accommodation allocations page** (`drawAccom`): heading **"Classroom rooms" → "Classrooms"**;
  **"Not in a classroom allocation" → "Classrooms (Pending Allocation)"**; the pending-allocation
  table now pads **every** column (not just the first) so it doesn't crowd on a phone, count
  right-aligned. (The separate Accommodation **setup** screen `RENDER.adminAccom` still says
  "Classroom rooms" — the rename was scoped to the allocations page only.)

## UI/UX fix batch — deployed 2026-07-01

Admin-requested batch (pre-camp). **SPA-only** (`public/index.html`) — no backend/schema change,
no migration. Verified: SPA `node --check` OK, `npm run typecheck` clean, `npm run test` = 270 pass.
- **Schedule-edit overlap (phone):** `_schedRow` grid is now `96px minmax(0,1fr) auto` (row **and**
  its header) + a `.sched-row input{min-width:0}` rule. Native `<input type="time">` keeps
  `min-width:auto` and was overflowing the fixed 92px Time track into the Activity field on narrow
  screens — the `minmax(0,1fr)` + `min-width:0` lets both inputs shrink to their tracks.
- **Setup wizard (`WIZARD_STEPS`) expanded + reordered** into a logical setup flow:
  Camp settings → Churches → Accounts → **Accommodation rooms** → **Accommodation allocation** →
  Schedule → **Devotionals** → **FAQ** → **Ministry contacts**. The four new steps (`accomAlloc`
  →`accom`, `devos`→`adminDevos`, `faq`→`adminFaq`, `contacts`→`adminContacts`) auto-detect "done"
  like the originals: allocation = any room in `/accommodation/allocations` has an occupant;
  devotionals = any `checkInDays` day has verse/reflection/prayer; FAQ = ≥1 `/faq` entry; contacts =
  any church has ≥1 named leader. ("Accommodation" → "Accommodation rooms" to distinguish it from
  the new allocation step.) Each step also carries a `tip` rendered as a `helpTip('…')` bubble beside
  its label (Bug 3 — a short tooltip per wizard item).
- **Global top loading bar (`#nprog`, NEW):** a thin accent bar under the top edge, driven from
  `_doFetch` via reference-counted `_npStart`/`_npDone` (creeps to 90%, snaps to 100% on completion,
  fades). Addresses the "screen sits still 1–1.5s after a button push" complaint (genuine serverless
  + Supabase round-trip latency; stale-while-revalidate revisits showed no loading hint). **Only real
  network requests drive it** — cached GETs bypass `_doFetch`, so instant navigations don't flash the
  bar. `#nprog` is the first child of `.app` (absolute `top:0`); tune colour/height in that one CSS rule.
- **Latency quick-win:** `_prefetch` now also warms `/accounts/churches` + `/accounts/users` for
  admin/director on login (the Accounts, Ministry-contacts and Wizard screens then open from cache).

## Feature batch — deployed 2026-07-02

Admin-requested batch (SPA + backend + **migration 016**, applied to prod):
- **Account Info (Accounts screen):** "Rename" + "Change username" are consolidated into one
  **Account Info** modal per tile (edit icon; key = password, trash = delete — the separate @
  username action is gone, `editUsername`/`saveUsername` deleted). Leadership modal = name +
  username + zone (zoneLeader) + status; church modal = church name + login username + zone +
  **accommodation override**.
- **Accommodation override (NEW):** `Church.accommodationOverride: 'tent'|'classroom'|null`
  (`churches.accommodation_override`, migration `016`). At **CSV import**, every **student** of a
  church with an override is forced to that kind (create + update paths, `churchOverrideById` map
  in `import.service`); leaders never overridden; a warning row is emitted when a CSV value is
  actually changed. Churches that deliberately split ticket types leave it unset. Set via Account
  Info; `UpdateChurchSchema.accommodationOverride`.
- **At-camp admin console:** Setup Wizard tile is **pre-camp only**; at-camp shows **"Individual
  Student Data Edit"** (`RENDER.adminStudents`, admin only): all students (merged
  `/registrants`+`/campers`), church/gender/grade filters + name search, row-tap edit of core
  fields (name, church, gender, grade, accommodation, medical, dietary) via
  `PATCH /registrants/:id`, and manual **Add student** (`POST /registrants`) created as
  `registered`/not-at-camp (signs in via First-day arrivals). Backend: registrant PATCH accepts
  `churchId/churchName/zone`; create accepts `medical`/`dietary`; **`CamperDto` gained
  `accommodationKind`**; SPA `_invalidate('/registrants')` now also clears `/campers`+`/checkin`.
- **Tooltips:** church auto-creation + override explained on the "Add a church" card and the
  wizard Churches step.

## UI/UX fix batch — deployed 2026-07-02 (at-camp bug list)

Admin-requested batch (at-camp, from "Admin Mode: at camp"). **SPA-only** (`public/index.html`) —
no backend/schema change, no migration. Verified: SPA `node --check` OK, `npm run typecheck`
clean, `npm run test` = 275 pass.
- **Daily check-in tile decluttered:** `rowHtml` (in `RENDER.checkin`) dropped the initials avatar,
  the "med" medical-flag badge, and the always-visible grey sync dot (per-row sync state is now a
  silent no-op — the existing top-of-list `ci-sync` banner is the only sync-status UI). The
  check-in button is now a primary solid pill labelled "Check in"/"Check out" (ghost once already
  checked in), sized larger than the ghost "Add note" button beside it.
- **`.pill` badges no longer wrap on phone:** ("View ›" on the Data/Budget/Accommodation nav cards
  was breaking onto two lines when squeezed by a long sibling in the same `.rowsb`) — `.pill` CSS
  gained `white-space:nowrap;flex-shrink:0`.
- **Phone-number display normalized (`fmtPhone`, NEW):** AU mobiles now always render as
  `0411 928 301` regardless of source formatting, including CSV imports that lost the leading 0 to
  spreadsheet numeric coercion upstream (a 9-digit `4xxxxxxxx` is re-prefixed with `0`). Applied
  everywhere a phone number is *displayed* (Data tab, `telLink`, first-aid leader/parent contacts,
  student search reveal, Student Info/camper detail) — editable phone `<input>` fields (ministry
  contacts editor) are untouched so admins can still type freely. Masked contact numbers
  (`0411****01`) pass through unchanged.
- **Data tab (`RENDER.data`) is sortable:** clicking a column header cycles
  unsorted→ascending→descending→unsorted (`dataSort`); unsorted is the **default import order**
  (`_dataCache` sorted by `createdAt` ascending client-side, since `/registrants` itself returns
  alphabetical order) rather than whatever order the last sort left it in.

## Multi-source CSV import (Form / Ticket List / Invoice) — deployed 2026-07-02

Elvanto now exports three separate CSVs instead of one manually-merged file. Full design at
`docs/superpowers/specs/2026-07-02-multi-source-import-design.md`. **Column headers were
corrected against a real sample** (`Sample Data New/` sibling folder, 2026-07-02) after initial
implementation — real Ticket List headers are `Event Occurrence information` (not `Event
Occurrence`) and `Invoice Payment Status` (not `Payment Status`); real Invoice/Billing Contacts
headers are plain `First Name`/`Last Name` (not `Billing First Name`), `Fees Paid` (not `Fees`),
`Total Tax` (not `Tax`). Ticket List also has a `Ticket Status` column not anticipated at design
time — a ticket whose status isn't `Active` (case-insensitive) is now skipped with a warning
rather than treated as confirmed accommodation truth (e.g. a cancelled/refunded ticket). All of
this is covered by `src/services/multi-source-import.integration.test.ts`, which runs sample
files modelled on a real export end-to-end through all three importers in sequence and asserts the
final state — including that the Invoice file's billing contact is often a **parent**, not the
registrant (e.g. an invoice billed to "Robin Thompson" covering attendee "Ivy Thompson"),
which is exactly why invoice-number matching is tier 1 and billing-name matching is only a
fallback. The multi-alias `field(row, ...)` pattern made all of these corrections low-risk,
additive changes — no matching/merge logic needed to change.

- **Three backend services, one shared core.** `src/services/import.service.ts` (existing, Form —
  `POST /import/csv`, unchanged behaviour except the blank-clobber fix below) stays the
  authoritative full-roster import (church-scoped matching, **still deletes anyone absent from the
  file**). Two new sibling services, mirroring the existing `church-import.service.ts` pattern:
  `src/services/ticket-import.service.ts` (`POST /import/tickets`) and
  `src/services/invoice-import.service.ts` (`POST /import/invoices`) — **neither ever deletes**.
  All three share `src/services/person-matching.ts` (NEW): `findPersonMatch` (cross-church name
  index, exact-then-bounded-Levenshtein-≤2 fuzzy fallback, only auto-matches a single unambiguous
  candidate) and `mergeOwnedFields` (a field only overwrites if the incoming value is non-blank —
  the same primitive that fixed the Form-import bug below).
- **Field ownership, enforced structurally (not by convention):** Form owns grade/gender/medical/
  dietary. Ticket List owns `accommodationKind` (+ NEW `accommodationKindConfidence:
  'guessed'|'confirmed'|null` — Ticket List always sets `'confirmed'`, unconditional overwrite,
  unless `Church.accommodationOverride` applies, which still wins and is also `'confirmed'`), NEW
  `ticketNumber`, NEW `invoiceNumber`, `paymentStatus`. Invoice owns `registrationCost` (reused as
  "ticket total"), `discountCode` (reused), NEW `discountAmount`/`amountPaid`/`feesAmount`/
  `taxAmount`, and may **guess** `accommodationKind` (`confidence:'guessed'`, never overwrites a
  `'confirmed'` value) by exact-cents-matching the invoice total against a price→type table built
  **dynamically every run** from already-confirmed Ticket-List people this season (requires ≥3
  confirmed samples at that exact price AND a ≥90% kind-majority before trusting it).
- **No confident match → orphan + flag, never silently discarded (Ticket List/Invoice only).**
  Ticket List creates a new `Person` with NEW `needsReview:true` + `needsReviewReason` (no
  `churchId` — verified this makes it invisible to church/zoneLeader RBAC scoping automatically,
  visible only to admin/director). **Invoice never creates a person** — `Person.churchId` is
  non-nullable and the Invoice export has no church field, so an unmatched invoice goes into the
  response's `unmatchedInvoices[]` for manual reconciliation instead of a fabricated record. An
  invoice matching >1 person (shared invoice number) withholds all `$`/accommodation fields for
  everyone in the group (can't attribute a shared total) but still applies a flat `discountCode`.
- **Form-import blank-clobber bug fixed:** `parseGender`/the update-merge branch previously reset
  a matched person's `gender` to `'other'` (and several other fields to blank) whenever the
  current CSV row's cell was empty — a real, live bug on ordinary Form re-imports, unrelated to
  the new sources. Blank cells now preserve the existing value on update; `'other'` remains the
  create-time default only. `zone` is deliberately still unconditional (it's church-derived, not
  CSV-derived — re-importing is how it stays in sync with the church record).
- **SPA:** one upload screen, a Form/Ticket List/Invoice `.seg` source selector
  (`IMPORT_SOURCES`/`setImportSource`/`_importUploadCardHtml`, same segmented-control pattern as
  the check-in day selector) reusing the existing dry-run→preview→confirm flow, parameterized by
  endpoint. Data tab (`RENDER.data`) gained a `needsReview` filter + column (`reviewCell`/
  `openReviewModal`/`_markReviewed` — PATCHes `needsReview:false`, no merge tool, manual
  reconciliation only) and an `Accommodation` column with an amber "Guessed" pill only on
  `confidence==='guessed'` (no badge for `'confirmed'`/`null`, matching the app's only-badge-the-
  exceptional-state convention).
- **Migration `017_ticket_invoice_import_fields.sql`** — 8 new nullable `people` columns (+
  `needs_review not null default false`); also fixed a **pre-existing, unrelated** bug where
  `PERSON_UPDATE_COLS` (Supabase `on conflict do update set` list) was missing `elvanto_meta`/
  `medicare_number`/`church_unlisted_note`, so those three fields silently never updated on save.

## Bug-list batch — leader presence, sensitive notes, budget, log totals — deployed 2026-07-03

Admin-requested batch of 7 items. Design doc: `docs/superpowers/specs/2026-07-03-bug-batch-design.md`.
`npm run typecheck` clean, `npm run test` = 409 pass, SPA `node --check` OK. Migration `019`
applied to prod. `sw.js` `camp-v14`→`camp-v15`.

- **Leader at-camp presence (NEW).** `admin.service.ts` `setMode`: on the **pre-camp → at-camp**
  transition only, every non-cancelled `kind:'leader'` person not already `atCamp` is bulk
  sign-in'd (`withSignEvent` from `person-lifecycle.ts` — the same transition a normal sign-in
  uses, so `atCamp`/`lifecycle`/`signOutHistory` stay fully consistent with the presence
  invariants above) via a single `personRepo.saveMany` — **not** a per-leader round trip, so this
  can't reintroduce mode-switch latency. **(2026-07-06 addendum)** the reverse transition
  (**at-camp → pre-camp**) now also reverts everyone still `atCamp` — see "Follow-up — mode-switch
  revert" further down; the forward bulk-sign-in described here is unchanged. Leaders stay excluded from the twice-daily check-in
  roster (`checkin.service.getSessionStatus` now filters `kind !== 'leader'`) and from
  `dashboard.service`'s `checkInsDue` (same filter — a leader never gets a `checkInHistory` entry
  and would otherwise sit permanently "due"); `totalAtCamp`/`totalExpected` are **not** filtered —
  leaders count as physically at camp. SPA My Youth (`RENDER.myyouth`/`filterMyYouth`) gained a
  **"Leaders"** grade-filter option and its "Late arrivals" bucket now includes leaders (was
  student-only) — covers a leader added after the bulk sign-in already ran; they get the same
  existing "Sign in to camp" button on `openCamper`, no new UI. `signOutPrompt`/`signInPrompt` take
  an `isLeader` flag and adapt copy ("this leader" vs "this youth"; the parents-met question is
  skipped for leaders).
- **Sensitive notes/testimonies (NEW).** `StudentNote.sensitive` (migration `019`,
  `notes.sensitive boolean not null default false`). A "Mark as sensitive" toggle on both the "Add
  note" modal (`notePrompt`) and "Submit testimony" screen (`RENDER.testimonies`), default off.
  `note.service.forCamper` (the profile-notes read path) drops `sensitive:true` notes for
  `actor.role==='church'` only — zoneLeader/director/admin still see them (with a small
  "Sensitive" pill in `openCamper`'s notes list). The previously-false "Visible to zone leaders &
  directors only" subtitle on the note modal is gone, replaced by a `helpTip` describing the real
  rule.
- **Budget discount-code breakdown (NEW).** `src/services/budget.ts` `computeDiscountCodeSummary`
  (pure, tested) — each distinct `discountCode` used → count, against `totalInScope` (total
  registrants in the same scope as the rest of the budget table). SPA mirror
  `computeDiscountSummaryClient`; rendered as a new collapsible "Discount codes" card at the bottom
  of `RENDER.budget`/`drawBudget`, same collapse pattern (`_budToggle`) as the per-church rows.
- **Sign-in/out log running totals.** `audit-export.service.ts` `buildSignInOutTimeline`: the
  "Sign-in & Sign-out Log" (both the compliance workbook sheet and `exportSignInOutCsv`) is now
  **one chronological timeline** across every person (students AND leaders) instead of grouped
  per-person — two new columns, **Total Students Signed In** / **Total Leaders Signed In**, show
  the running per-kind count immediately after each row's event. Leader events from the new bulk
  sign-in flow feed into this exactly like any other event.
- **Mode-switch lag fix.** `switchMode()` (SPA) already applies the fresh `campMode` locally right
  after `POST /admin/mode` succeeds, but the `RENDER.home()` it called next unconditionally
  re-fetched `/settings` again — a 3rd sequential round-trip for no new information. `RENDER.home`
  now takes a `skipModeSync` flag; `switchMode` passes it (other already-open sessions still get
  the re-sync on their next home nav, unaffected). Also closed a related cache-correctness gap:
  `_invalidate` didn't clear `/settings` on an `/admin/mode` write, so a same-session cached read
  within the 30s TTL window could briefly see the stale pre-switch mode.
- **Review Data Import (audit, no behaviour change).** Confirmed the flow: Ticket List/Invoice rows
  that can't be confidently matched get `needsReview:true` → an amber badge on the Data tab
  (`reviewCell`) → `openReviewModal` → "Mark reviewed" (`_markReviewed`, clears the flag only,
  never auto-merges — by design). Added a `helpTip` inside `openReviewModal` explaining what to
  check (name/church spelling, accommodation/cost) before confirming.
- **Import row-order robustness (confirmed, no change).** All three importers match people by a
  name(+phone) key (`person-matching.ts` cross-church index; `import.service.ts`
  `nameChurchKey`) — never by CSV row position. Added a shuffled-row-order regression test to
  `multi-source-import.integration.test.ts`.

## Bug-list batch — audit columns, discount purpose, contacts save, Data Import nav — deployed 2026-07-03

Admin-requested batch of 6 items (from "Account: Admin, Mode: Pre-Camp"). SPA + backend
(`audit-export.service.ts`, `budget.ts`), **no schema/migration change**. `npm run typecheck`
clean, `npm run test` = 413 pass, SPA `node --check` OK. `sw.js` `camp-v16`→`camp-v17`.

- **Audit workbook columns.** Attendees sheet gained an **Accommodation** column
  (`accommodationDisplay(p.accommodationKind)` → "Tent"/"Classroom"/blank). Notes &
  Testimonies and First-Aid Records sheets both gained **Grade** + **Gender** columns.
- **Budget discount-code purpose (auto-derived, no manual entry).** Each discount code's
  card row now shows a pill like "25% Off" or "$20 Off" next to the code —
  `deriveDiscountPurpose` (`budget.ts`) averages `discountAmount/registrationCost` across
  everyone who used the code; snaps to 25/50/70/100% if within 3 points of a tier, else
  falls back to the average flat dollar amount (`purpose: null` when no one using the code
  has both fields recorded). SPA mirror `_deriveDiscountPurpose`. **`BudgetPerson` gained
  `discountAmount`** (already present on `RegistrantDto`, just not previously passed
  through to the budget calc). Also fixed a laptop-only layout complaint — the discount
  card read as a wide, mostly-empty table below the church cards — `RENDER.budget` now
  splits into a 2/3 summary + 1/3 discount-codes column at `≥980px` (`.bud-grid` CSS,
  inside the existing 980px block); stacks normally below that. The discount card still
  starts collapsed by default in both layouts (unchanged).
- **Ministry contacts save no longer blows away the whole screen.** `saveContacts(id)`
  used to call `_rContacts()` → a full `RENDER.adminContacts()` re-render (re-fetches every
  church, rebuilds every card) — which collapsed every other open card and dropped any
  unsaved edits an admin had typed into other churches while working down the list. It now
  just PATCHes and updates that one card's "N/4 Contacts" pill in place
  (`_updateContactPill`), leaving every other card exactly as the admin left it. The
  now-unused `_rContacts()` wrapper was deleted.
- **Data Import moved to its own admin console tile + nav entry.** The CSV/Excel upload
  card (`_importUploadCardHtml`) is gone from the admin **Data** screen — that screen is
  renamed **"Data Export/Reset"** (was "Data, Reset & Exports") and is export/reset-only
  now. Import lives at the previously-built-but-unreachable `RENDER.import` screen
  (`'import'` nav id), now wired up: a new **"Data Import"** tile on the admin console, and
  — **pre-camp only** — the admin bottom-nav Notices tab is replaced with a **Data Import**
  tab (new `upload` icon in `ICONS`). Notices is still reachable pre-camp via a new button
  at the top of **Admin Settings** (`RENDER.adminSettings`). **At-camp admin nav (desktop
  sidebar) is unchanged** — Notices stays there; this was a deliberate scope decision (the
  bug list didn't specify a mode, and the owner chose pre-camp-only for the swap).

## Elvanto export guide on the import screen — deployed 2026-07-03

**SPA-only** (`public/index.html` + static images), no backend/schema change. The import upload
card (`_importUploadCardHtml`, both `RENDER.adminData` and `RENDER.import`) gained a ghost button
**"How do I export these files from Elvanto?"** → `openImportGuide()`, a full-screen 3-step
screenshot walkthrough (`#impGuide` overlay in the shell; `IMPORT_GUIDE` data; `_igDraw`/`_igGo`/
`_igZoom`/`_igTs`/`_igTe`). One step per import file — Form / Ticket List / Billing Contacts —
each with a short caption + real Elvanto screenshots served from **`public/img/import-help/`**
(`form-export.png`, `events-export.png`, `ticket-export.png`, `billing-export.png`; the Ticket
List step shows two images: where the Events Export button is, then the export popup). Steps
flick via ‹/› buttons, dot indicators, or **touch swipe** (≥48px horizontal); screenshots are
wide Elvanto strips so **tap-to-zoom** toggles a 220%-width horizontally-scrollable view
(`.ig-imgwrap.zoom`) for phones. `sw.js` `camp-v15`→`camp-v16` (HTML changed; images ride the
normal cache-first static path).

## First-aid export + login-enumeration hardening — deployed 2026-07-03

- **First-aid Records CSV export (SPA):** `RENDER.records` gained an **Export** button →
  `exportFaRecords()`, which builds a CSV client-side from the already-loaded `window._faRecsAll`
  (via `_faParse`) — columns Student/Problem/Treatment/First-aider/Brought by/Logged by/Logged at,
  filename via `_exportName`. **No backend or permission change** (firstAid holds only
  `note:read:firstaid`). Exports the loaded records (`/notes/firstaid?limit=100`), not just the
  on-screen filter.
- **Login user-enumeration hardening (backend, `auth.service.login`):** a missing / inactive /
  passwordless account now runs an **equal-cost dummy scrypt** (`DUMMY_PASSWORD_HASH`) and returns
  the same `Invalid credentials` as a wrong password — previously an unknown username skipped
  scrypt (fast) and a passwordless account had a distinct message, which (with the login limiter
  keyed per ip+username) was a usable timing/message oracle. `auth.service.test.ts` +3 (395 pass).
  **Deliberately NOT changed:** the stateless-token trade-off where a deactivated user's existing
  token stays valid to its 12h TTL — closing it needs a per-request DB lookup (user-facing latency).
- **`sw.js` is now `camp-v13`** (v9→v10→v11 import/Excel →v12 security headers/CSP →v13 first-aid export).

## Bug-list + import redesign + Excel + security headers — deployed 2026-07-02 (late)

Large admin batch (SPA + backend + **migration 018**). `npm run typecheck` clean, `npm run test`
= 275→**392 pass**, SPA `node --check` OK. sw.js `camp-v9`→`camp-v12`.

- **Import UI REDESIGNED — SUPERSEDES the segmented-selector description in the multi-source
  section above.** The manual Form/Ticket/Invoice `.seg` picker is **gone**. One upload field
  (`_importUploadCardHtml`) takes **1–3 files at once**; each file's type is **auto-detected from
  its column headers** (`_detectImportType`/`_IMPORT_SIGNATURES`), so a file can't be sent to the
  wrong importer. Files run in dependency order **Form→Ticket→Invoice** in a single combined
  preview→confirm (`adminUpload`→`_renderImportPreview`→`_confirmImport`). Unknown files are
  rejected with their columns shown + a manual type/skip choice (`_renderImportUnknown`). No file
  is mandatory. Per-source **last-imported** timestamps show on the screen (`_loadImportStamps`).
  The three backend import endpoints/services are **unchanged**; the redesign is SPA-only plus a
  controller-layer timestamp stamp (`src/api/controllers/_import-stamp.ts`).
- **Excel (.xlsx/.xls) import:** vendored **SheetJS** at `public/vendor/xlsx.full.min.js`,
  **lazy-loaded** on first Excel use (`_ensureXlsx`; same-origin so CSP `script-src 'self'`
  allows it; no eval/Function). `_readImportFile` converts Excel→CSV (`_xlsxToCsv`, header-matched
  sheet selection) then the CSV pipeline is unchanged. (CMS + its Connection Audit already have
  Excel via their own dependency-free `readXlsx` — no CMS change was needed.)
- **Migration 018** (`018_defaults_and_import_timestamps.sql`, applied to prod) — 4 nullable
  `timestamptz` on `settings`: `defaults_saved_at` (bugs 6/10 — shown on the Data screen's Save
  Defaults card + the close-out checklist; stamped in `admin.service.saveDefaults`) and
  `form/tickets/invoices_imported_at` (the import last-upload lines). **`supabase.settings` writes
  ALL settings columns on every save**, so this HAD to be applied before/with deploy.
- **Audit workbook 500 FIXED** (`audit-export.service.ts`): worksheet name `'Sign-in/Sign-out Log'`
  had an illegal `/` → ExcelJS threw on `addWorksheet`, so the download had **never** worked.
  Renamed to `'Sign-in & Sign-out Log'`. Added a dedicated **First-Aid Records** sheet (parsed
  4-line body; excluded from Notes & Testimonies). Regression test: `audit-export.service.test.ts`.
- **Compliance filenames** now include camp year + export date (`_exportName`).
- **First-aid Search/All-Students → profile fix:** `openStudentInfo`/`openFirstAidLog` now paint
  the **active** first-aid screen (`_faScreen()`) instead of hard-coding `'search'` (which
  `paint()`'s stale-guard dropped when on the `allstudents` screen); Back is origin-aware.
- **Add-note button** on student profiles (`openCamper`, `stuEdit`), camper-only + note-writer-only.
- **Director at-camp home** hides the Notices tile (nav unchanged). **Phone overscroll/side-drag**
  fixed via `.screen{overflow-x:hidden;overscroll-behavior:contain}` + body `overscroll-behavior`.
  **Church tooltip** moved to the Churches list tile. **Laptop tooltip** flips up near the bottom
  edge (`_clampTip` + `.htip-pop.flip-up`).
- **Security headers (zero user friction):** `express-adapter` disables `X-Powered-By`; adds HSTS
  (prod), COOP+CORP `same-origin`, and `Cache-Control: no-store` on API/export responses (static
  stays cacheable); CSP meta gained `frame-ancestors 'none'`.

## App icon + home-hero brand mark — updated 2026-07-02

The Home Screen (PWA "Add to Home Screen") icon was a thin outlined triangle in an off-brand
navy/blue that didn't match the app's actual purple/violet palette and didn't read as a tent.
Replaced via a brainstormed multi-option review (4 SVG concepts sent to the user for comparison
at both full size and realistic 60/76px home-screen size before picking one).
- **`public/icons/icon.svg`** — new design: the app's real header gradient (`#7c3aed`→`#1e1b4b`,
  135deg, matching `.hero`/header exactly) on a rounded-square (`rx="96"`), with a proper white
  A-frame tent (sloped roof, mid-purple `#9333ea` triangular door flap for depth, a ground line,
  two guy-lines) and a simple white cross standing above the peak like a chapel-tent flag. Content
  is kept within the maskable-icon safe zone (roughly a centered 80%-diameter circle) so it
  survives OS circle/squircle cropping. `manifest.json` is unchanged (already `"sizes":"any"`,
  `"purpose":"any maskable"`, SVG-only — no PNG generated yet).
- **`public/sw.js` `CACHE` bumped `camp-v7`→`camp-v8`** — the service worker cache-firsts icons,
  so without a version bump, anyone who already added the app to their home screen would keep
  seeing the old icon indefinitely.
- **Gap closed (2026-07-04):** `public/icons/icon-180.png`/`icon-192.png`/`icon-512.png` exist,
  match the SVG design, and are referenced by both `index.html` (`apple-touch-icon` +
  `<link rel="icon">`) and `manifest.json`. The SVG stays the manifest's `sizes:"any"` entry.
- **`heroMark()` (NEW, `public/index.html`)** — a reduced-detail, 16%-opacity white version of the
  same tent+cross mark (no background square, just the line art), absolutely positioned on the
  right side of a `.hero` card. Added as the **first child** of both Home hero cards (pre-camp
  `RENDER.home` and at-camp `renderHomeAtCamp`) so it paints behind the greeting text, matching
  how `.hero`'s existing `:before`/`:after` decorative circles already behave (`.hero` already has
  `position:relative;overflow:hidden`, so the mark clips cleanly like those do). Not used anywhere
  else — if a fifth hero-style card gets added later (budget, devotional) and should also carry
  the mark, call `heroMark()` there too rather than duplicating the SVG markup.

## Security & perf hardening ported from CMS — 2026-07-02

- **CSP meta tag** (`public/index.html` `<head>`): defence-in-depth alongside the SPA's escaping
  discipline. `'unsafe-inline'` stays for script-src/style-src (required by the inline-script/
  onclick architecture); the policy blocks external script/resource loads it doesn't need.
  `style-src`/`font-src` allow Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com` — Plus
  Jakarta Sans, the app's only external resource); `connect-src 'self'` covers all API calls
  (relative paths only). **A CSP typo isn't caught by tsc/vitest** — after any change to the
  policy, hard-load the prod URL and check the browser console for CSP violations. `sw.js`
  `CACHE` bumped to `camp-v9` alongside this change (HTML changed).
- **Server-side response cache** (`src/utils/response-cache.ts` + `src/services/dashboard-cache.ts`,
  ported from CMS): a 30s-TTL in-memory cache wraps the `/home` dashboard DTO
  (`dashboard.service.ts`). Cache key is `${role}:${churchId ?? '_'}:${zone ?? '_'}` — **must**
  include actor scope, since the DTO is role/church/zone-scoped and a shared key would leak one
  church's data to another. `invalidateDashboardCache()` is called from every write that can
  change the DTO (person create/update/remove/checkIn/signEvent, all 4 import services,
  admin reset/newYear/clearNotifications, settings update/setMode, notification send/remove/
  clearAll, account church create/update/delete) — when in doubt the rule was invalidateAll,
  correctness over hit rate. **Lives in its own module** (`dashboard-cache.ts`, not inside
  `dashboard.service.ts`) to avoid a circular import: `dashboard.service.ts` already imports
  `canAccessPerson` from `person.service.ts`, so a writer-side import back from
  `dashboard.service.ts` would cycle. Deliberately **not** applied to
  `checkin.service.getSessionStatus` — the at-camp roster must stay live. Same serverless
  caveat as CMS: only helps within a warm instance.

## Unallocated registrants & church-allocation overrides — implemented 2026-07-03 (branch)

Design: `docs/superpowers/specs/2026-07-03-unallocated-registrants-allocation-design.md`; plan:
`docs/superpowers/plans/2026-07-03-unallocated-registrants-allocation.md`. Backend + SPA + **migration
`020_allocation_overrides.sql`** (⚠ **apply to prod before/with deploy**). `sw.js` `camp-v17`→`camp-v18`.
`npm run typecheck` clean, `npm run test` = **431 pass**.

- **Unallocated sentinel church.** A registrant whose `Attendee's Church` is the exact literal
  `OTHER - please specify below` (or blank) is assigned `churchId = '__unallocated__'`
  (`UNALLOCATED_CHURCH_ID`, `churchName = 'Unallocated'`, `zone = ''`) instead of the old behaviour
  of auto-creating a junk church from that string. Constants + pure helpers live in
  `src/services/church-allocation.ts`. Sentinel people are RBAC-invisible to church/zone logins
  (scoped by churchId; `zone=''` keeps zoneLeaders out) and are excluded from accommodation grouping
  (`accommodation.service.ts` `occupants()` filters the sentinel). They surface as an "Unallocated"
  bucket in budget (informative, low priority).
- **Persistent overrides.** `AllocationOverride` (`src/core/entities/allocation-override.ts`, table
  `allocation_overrides`, repo trio + `container` wiring) records a MANUAL church allocation keyed by
  the person's name(+mobile) identity. The **Form importer** (`import.service.ts`) re-applies them at
  church-resolution time (`matchOverride`, before zone/accommodation are derived), so a manual
  allocation **wins over the CSV on every re-import**, survives the delete-absent sweep (never deleted
  or duplicated), and automatically inherits the assigned church's zone + accommodation override.
  Duplicate name+mobile → skipped with a warning (never mis-assigned). Overrides whose person withdrew
  (absent from a re-import) are pruned. Purged by reset/new-year (`admin.service.ts`).
- **API + RBAC.** New `allocation:manage` capability (**director + admin**). `allocation.service.ts` +
  `allocation.controller.ts`: `GET /import/unallocated`, `GET /import/allocations`,
  `POST /import/allocate {personId,churchId}` (upserts override + moves the person + applies the
  church accommodation override immediately, via the shared `accommodationKindForChurch` helper),
  `DELETE /import/allocations/:id` (reverts to sentinel, or to the form's named church for `override`
  kind). Allocation target = existing churches only.
- **SPA.** `RENDER.import` (Data Import screen) gained two cards below the upload: **"Unallocated
  registrants (N)"** (per-person church dropdown + Confirm) and **"Church overrides / forced
  allocations (N)"** (the tracked list with Undo + a name-search "Override a church allocation" control
  with a confirm modal). `_loadAllocation`/`_renderAllocCards`/`allocatePerson`/`overridePrompt`/
  `confirmOverride`/`undoOverride`; the SPA's `UNALLOCATED_ID` must match the backend constant.

## Admin bug batch + offline sign-in + director digest — deployed 2026-07-04

Large overnight admin-requested batch (8 numbered bugs + 2 new features), SPA + backend +
**no schema migration** (reused existing `amountPaid`/`formImportedAt` columns). `npm run
typecheck` clean, `npm run test` = **442 pass** (11 new), SPA `node --check` OK. `sw.js`
`camp-v18`→`camp-v20` (two HTML-changing pushes in the batch).

- **Director navigation restored.** Director had `import:run`+`allocation:manage`
  (`access-control.ts`) and `RENDER.import`/`RENDER.adminData` already accepted director, but
  `navModel` gave director no route to either in any mode — a regression. `RENDER.data` (the
  pre-camp "Data" tab, also reachable at-camp via the home tile "Student Data Table") now has
  two buttons: **Data Import** (`go('import')`) and **Records & Export** (`go('adminData')`).
  `RENDER.adminData`'s Close-out and Clear-notifications cards are now `isAdmin`-gated (same
  pattern as Save Defaults/Factory Reset) so a director viewing via this new route never sees an
  action the backend would 403 on.
- **Brisbane-anchored "today" (`localDateISO()`, NEW).** `new Date().toISOString().slice(0,10)`
  is UTC, so anywhere from midnight to 10am Brisbane it read yesterday's date. New helper
  mirrors the backend's `zonedNow()` via `Intl.DateTimeFormat('en-CA',{timeZone:'Australia/
  Brisbane'})`; takes an optional instant to convert (used to compare a server `createdAt`
  timestamp against "today" in Brisbane, not just slice its UTC date). Fixes `_realCampDayNumber()`
  (header Day badge + the home-tile First-Day/Testimonies switch, which reads it) and
  `drawFaRecords`'s "Today" filter on First-aid Records.
- **"Not Signed In" section on check-in (`RENDER.checkin`, NEW).** A collapsed `<details>` at
  the bottom of the daily check-in screen listing the viewer's scoped students with
  `atCamp!==true` — ANY lifecycle stage (never-arrived AND already-checked-out/departed), fetched
  via `/registrants`+`/campers` in parallel with the roster status (same dedup pattern as
  `RENDER.firstday`). Each row has a direct "Sign in to camp" button (`signInPrompt`). Does not
  touch `checkin.service`'s roster contract (still atCamp-only).
- **Zone-leader per-church pulse (`renderOversightPulse`).** zoneLeader's home pulse now groups
  by `r.church` instead of `r.zone` (their roster is already zone-scoped, so the old zone grouping
  produced one aggregate bar) — amber below **70%** (`PULSE_AMBER_PCT`, new `.bar7.amber` CSS).
  Tapping a church bar sets `FILTER.church` and jumps to Check-in (`_pulseGoToChurch`). Director/
  admin deliberately KEPT the existing per-zone bars (would be 10+ bars camp-wide otherwise).
- **Setup wizard + return chip + console regroup.**
  - `WIZARD_STEPS` gained an **"Import registrations"** step between Accounts and Accommodation
    rooms (done-check: any person exists OR `settings.formImportedAt` set) — **10 steps total**.
  - **"Back to setup (step N of 10)" chip**: a *persistent* banner (`_wizardChipHtml`, hooked into
    `paint()` itself) shown on any screen that's a `WIZARD_STEPS` target while a
    `sessionStorage['ycp_wizardReturn']` flag is set — set by `_wizardGo(i)` when a wizard row is
    tapped, cleared on returning to `RENDER.adminWizard` or on logout. Deliberately NOT wired into
    each individual save handler (~10 screens) — one shared hook instead.
  - **Admin console tiles regrouped** under three headings (`RENDER.admin`), **re-ordered again
    same day** per follow-up feedback — current final order:
    - **Camp setup**: Setup Wizard → Camp settings → Accommodation → At-Camp Info → Switch mode.
    - **People & churches**: Accounts & churches, Ministry contacts.
    - **Data**: Data Import, Data Export/Reset (Records & Export for director), + Individual
      Student Data Edit (at-camp only — not explicitly specified in the reorder request, kept
      here as the closest fit since it has no other home in this console).
- **Batch schedule saves.** New `PUT /schedule/day` (`schedule.service.ts` `replaceDay`,
  `IScheduleRepository.replaceDay` — in-memory does delete+re-set on the Map, Supabase does
  delete-then-multi-row-insert inside one `sql.begin` transaction) replaces `saveSchedDay`'s old
  N-deletes-then-N-creates loop. **`Route`/`BufferRoute` method unions and the Express adapter's
  method cast had no `'PUT'`** — added, since this was the first `PUT` route in the app (also
  added to `Access-Control-Allow-Methods`).
- **Copy/label/trust batch.**
  - `_paintPerson`'s "Paid" field showed `registrationCost` (ticket price, not what was actually
    paid). New `_paidOrCostRow(s)`: shows `amountPaid` labelled **"Paid"** when an Invoice import
    recorded one, else `registrationCost` labelled **"Cost"**.
  - Check-in screen's stale "Notes visible to zone leaders & directors only" hint corrected to
    match the real rule (church sees non-sensitive notes too).
  - `RENDER.notes` subtitle: **"Your zone: `<zone>`"** for zoneLeader (was hardcoded "All zones ·
    whole camp", never true for a zone-scoped read); director/admin unchanged. Also gained an
    optional `presetFilter` param (used by the new digest card below) that pre-selects a Record
    filter option.
  - `RENDER.adminAccom` (accommodation **setup** screen): "Classroom rooms" → **"Classrooms"**,
    matching the allocations page (the two screens had drifted).
  - `notePrompt`'s leader-name field already prefilled from `LAST_LEADER` — `reviewNote` no
    longer *requires* it (backend already attributes the note to the logged-in actor; the typed
    name is just folded into the body as a "logged by" annotation when present).
- **Schedule/FAQ/Devotionals condensed → "At-Camp Info" (`RENDER.atCampInfo`, NEW).** One admin
  screen with three sub-tab buttons (Schedule/FAQ/Devotionals, defaults to Schedule) replacing
  three separate console tiles/nav entries. Old `RENDER.adminFaq`/`adminDevos`/`adminSchedEdit`
  bodies became internal content-builders (`_acFaqBody`/`_acDevosBody`/`_acScheduleBody`) called
  by the merged screen; `_rFaq`/`_rSched` re-render helpers now call `RENDER.atCampInfo('faq'|
  'schedule')`. `WIZARD_STEPS`' schedule/devos/faq rows still route here, each pinned to its own
  sub-tab via `go('atCampInfo', arg)`. (`adminFaqEdit` — a pre-existing, already-unreachable
  at-camp FAQ screen with no nav path to it — was left alone, out of scope.)
- **Offline Sign-In (NEW, `src/services/offline-signin.service.ts`).** Fallback bulk sign-in for
  churches who prefer paper/bulk sign-in over the app, at the bottom of the Data Import screen.
  `GET /export/offline-signin` (exceljs) builds ONE workbook — every registered **student**
  (leaders excluded), all churches, sorted by church then surname — columns First/Last/Church/
  Gender/Grade + blank **"Signed In?"**, with an obviously-fake "Sample Student" row demonstrating
  `Y`. `POST /import/offline-signin` re-parses a filled sheet (`parseCsv`) and bulk-signs-in every
  row marked exactly `Y` that matches an existing student by **First+Last+Church text** (no id
  column) and isn't already `atCamp` — via the same `withSignEvent`+`saveMany` bulk pattern as the
  leader bulk sign-in in `admin.service.setMode`. The Sample row is matched by name and always
  skipped, regardless of what's typed in its Church cell. SPA reuses the existing client-side
  `_readImportFile` (CSV/Excel via lazy SheetJS) to parse the upload, then POSTs the raw CSV text
  — the backend does all matching (consistent with the Form/Ticket/Invoice import architecture,
  and testable with vitest). A plain `confirm()` gate precedes the POST (no separate dry-run mode
  — a lower-effort deliberate choice for this fallback feature). 9 new tests
  (`offline-signin.service.test.ts`).
- **Director + admin morning digest card (NEW, at-camp home hero).** "Day N · X/Y checked in
  this session · Z churches complete · K first-aid records today", each figure tappable
  (`_digestCardHtml`/`_renderDirectorDigest`, same paint-immediately-then-inject-async pattern as
  `renderOversightPulse`, called un-awaited from `renderHomeAtCamp`). Required one backend DTO
  addition: `AtCampDashboard.sessionExpected` (the atCamp-non-leader population subject to the
  CURRENT session — same population `checkInsDue` is computed against) so the SPA can derive
  "X/Y checked in" as `sessionExpected - checkInsDue` / `sessionExpected` with no extra fetch.
  "Churches complete" re-fetches `/checkin/sessions/current` + status independently of
  `renderOversightPulse` (harmless — both hit the SPA's 30s client `Cache`, so this is a cache hit
  in practice, not a second real network call) and groups by church (`done===total`, regardless
  of the per-role pulse-bar grouping above). "First-aid records today" fetches
  `/notes/firstaid?limit=100` and filters via `localDateISO()`. Tapping "churches complete" or the
  check-in ratio jumps to Check-in; tapping first-aid jumps to `RENDER.notes` pre-filtered
  (`go('notes','firstaid')`) — reachable for admin too via their existing "Testimonies & Notes"
  home tile even though admin has no permanent nav entry to Notes at-camp.
- **`icons-180/192/512.png` gap (CLAUDE.md correction only, no code change).** These PNGs already
  existed, matched the SVG design, and were already referenced in `index.html`+`manifest.json` —
  the "known gap, not yet fixed" note below was stale from an earlier session and has been
  corrected in place.

## Bug batch — Unallocated FK crash, at-camp Data tab, preview banner, Reg type — deployed 2026-07-06

Admin-requested 3-bug batch. `npm run typecheck` clean, `npm run test` = 442 pass, SPA
`node --check` OK. No migration.

- **Unallocated-import crash FIXED (Supabase-only, not caught by vitest).** `people.church_id`
  has a real FK to `churches(id)`, but the `__unallocated__` sentinel (church-allocation.ts,
  2026-07-03) was never a `churches` row — writing it threw a foreign-key violation, surfaced
  to the SPA as the generic "An unexpected error occurred". `src/repositories/supabase/
  supabase.people.ts` now maps the sentinel to/from SQL `NULL` at the I/O boundary
  (`personColumns`/`toPerson`/`findByChurch`) — `NULL` is already FK-legal (`on delete set
  null`) and the domain model never sees it; `Person.churchId` still always reads as either a
  real id or `__unallocated__`. **Prod data note:** 10 people already sat with `church_id
  NULL`/`church_name 'OTHER - please specify below'` from an old auto-created "OTHER" church
  that had since been deleted (its FK cascade nulled `church_id` but left the denormalized
  `church_name`/`zone` stale) — this is what made a re-import see them as "absent" (10
  flagged for deletion) while the replacement row crashed on save. One-off prod SQL
  corrected their `church_name`→`'Unallocated'`/`zone`→`''` in place (same ids, no data
  loss); the repo fix means they now round-trip correctly on every future import.
- **Data tab missing at-camp leaders FIXED.** `RENDER.data` (the Data/registrants table) only
  fetched `/registrants` (`lifecycle==='registered'`). At-camp, **every leader is bulk-signed-in
  on the mode switch** (2026-07-04 presence feature) — their lifecycle becomes `arrived`, which
  drops them out of `/registrants` permanently, since nothing ever demotes a camper back to
  registrant. Regular students don't show this since they're promoted individually as they
  physically arrive. `RENDER.data` now also fetches `/campers` and merges in any not already
  present by id (same dedup pattern as `RENDER.firstday`), so the table always shows the full
  roster regardless of lifecycle. `CamperDto` gained `registrationType` (was registrant-only)
  so the "Reg type" column doesn't go blank for a merged-in camper row.
- **"Reg type" column wired to real data.** It read a `Type`/`Registration Type` Form CSV
  column that doesn't exist in any real Elvanto export (Form/Ticket List/Invoice all lack it) —
  always blank. `ticket-import.service.ts` now stores the Ticket List's real `Ticket Type` text
  (e.g. `"EARLY BIRD | Tent Accomodation"`) as `registrationType` (added to the service's
  `OWNED_KEYS`, same never-clobber-with-blank rule as `ticketNumber`/`invoiceNumber`).
- **Preview banner code-spill fixed.** `${ic('preview')}` sat in static `<body>` HTML markup
  (not a JS template literal), so the browser printed it literally instead of rendering the
  SVG. `#previewBanner .pb-label` is now an empty span (`id="pbLabel"`) filled via
  `ic('preview')` at boot, once `ICONS`/`ic` are defined.

## Follow-up — mode-switch revert, Budget/Data leader visibility — deployed 2026-07-06

Same-day follow-up after the batch above: the admin flagged leaders were still missing from
Budget and Home, with Cost blank on the Data tab. Root cause (found by querying prod
directly): the camp had at some point been switched to at-camp (bulk-signing in leaders and
some students who then signed in for real testing) and back to pre-camp — but `setMode` only
ever handled the forward transition, so everyone who was `atCamp` stayed stuck at
`lifecycle:'arrived'`/`atCamp:true` even in pre-camp mode, invisible to every screen that reads
the registrants view (`lifecycle==='registered'`). `npm run typecheck` clean, `npm run test` =
444 pass (2 new), SPA `node --check` OK. No migration.

- **`admin.service.ts` `setMode` now reverts on at-camp -> pre-camp.** Mirrors the existing
  forward bulk-sign-in: anyone still `atCamp` (any kind, not just leaders — a student who
  individually signed in during at-camp testing has the same problem) is force-set back to
  `lifecycle:'registered'`/`atCamp:false` with an audit `SignOutEvent` appended (reason "Camp
  mode reverted to pre-camp"). This bypasses `withSignEvent`/`applyCheckIn` deliberately — the
  presence model has no normal transition back to `'registered'` (arrived/checked_out only
  cycle between each other), so a direct field assignment is the only way to undo the forward
  bulk transition. Already-cancelled or already-checked-out people are untouched. **One-off
  prod data correction** applied the same revert directly via SQL to the 10 leaders + 15
  students already stuck this way (same ids, `sign_out_history` audit rows added to match what
  the code now does automatically).
- **`switchMode()` (SPA) warns before reverting to pre-camp** — the confirm dialog now says
  anyone currently signed in at camp will be automatically signed out.
- **Budget now includes arrived leaders/students.** `RENDER.budget` only fetched
  `/registrants` — same gap as the Data tab fix above. Now merges `/campers` in (deduped by
  id, same pattern). `CamperDto` gained `registrationCost`/`discountCode`/`discountAmount` so
  a merged-in camper row prices and discount-codes correctly (`registrationType` was already
  added for the Data tab's "Reg type" column — `exportBudget()` and the discount-codes card
  get this for free since they both read the same merged `window._budgetRegs`).

## Church home screen simplification — deployed 2026-07-06 (SPA-only)

Admin request, church role only, both modes. No backend/schema change.

- **At-camp: Notices tile removed from church home.** `renderHomeAtCamp`'s tile-building now
  excludes `ACTOR.role==='church'` from the Notices quick-tile (mirrors the existing
  director exclusion) — church still reaches Notices via its bottom-nav tab, just not as a
  home tile.
- **Pre-camp: tent/classroom breakdown replaced with two simple tiles for church.** The
  "Registrations by accommodation" 4-tile band (Student/Leader × Tent/Classroom,
  `statband-4`) is now conditional on role — church instead gets a plain 2-tile
  `.statband` ("Students" / "Leaders", from the already-scoped `h.totalCampers`/
  `h.totalLeaders`); zoneLeader/director/admin are unchanged. The existing "Your
  registrations" total card just below (with its own "X campers · Y leaders" sub-line) was
  left as-is — not explicitly in scope.

## First-aid pre-camp testing — deployed 2026-07-06

Admin request. Superseded an earlier same-day approach (a dedicated sample church + 25 fake
students, fully reverted — see git history around commit `6c3bf3d` if it ever needs
resurrecting) once a cleaner fix was found: first-aid can already **search** any real
registrant regardless of arrival status (`search.service.ts` already lets `firstAid` see
`isRegistrant` people, not just `isCamper` ones — pre-existing, not new). The actual gap was
`note.service.ts`, which required `isCamper()` before a first-aid record could be
created/read at all — meaning first-aid record-keeping was completely untestable pre-camp
(nobody is a "camper" until the real Day-1 sign-in), and would have stayed broken even
against fake sample data seeded as `lifecycle:'registered'`. `npm run typecheck` clean,
`npm run test` = 450 pass (10 new). No schema change, no fake data.

- **`note.service.ts` `firstAidEligible(actor, person)`** — `isCamper(person) ||
  (actor.role==='firstAid' && isRegistrant(person))`. Used in place of the bare `isCamper`
  check in both `add()` (creating a record) and `recentFirstAid()` (reading them back).
  Every other role's note-eligibility is unchanged — only firstAid gets the pre-camp
  allowance, and only for people it can otherwise already access. A cancelled person is
  still never eligible for anyone.
- **`admin.service.ts` `setMode`** — on the real pre-camp → at-camp transition (same branch
  as the existing leader bulk-sign-in), every `category:'firstaid'` note is deleted. Safe and
  unambiguous: a real first-aid incident cannot happen before the camp is physically live, so
  every first-aid record that exists while still in pre-camp mode is by definition a test one.
  Testimonies and general notes are untouched.
- **"Not on site" flag suppressed pre-camp (SPA-only follow-up).** `faResultRow` (shared by
  Search and All Students — both already listed pre-camp registrants via the existing
  `scope=all`/`isRegistrant` fallback, no change needed there) and `openStudentInfo`'s header
  badge only show the red "Not on site"/"signed out / not on site" flag when
  `CAMP_MODE==='at-camp'`. Pre-camp, being "not on site" is the universal expected state, not
  an exception worth flagging on every single row — the flag returns as soon as the camp goes
  live.

## Commands (run from this folder)

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4200 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest
```

Default port: **4200**. Set `PORT=xxxx` to override.

> **Verify & deploy convention:** verify changes with `npm run typecheck` + `npm run test` (+ grep/
> reasoning) — **do not start a localhost dev server or drive a browser to test**, and flag CSS/
> layout changes for the user to eyeball on-device. GitHub is linked to Vercel, so a **push to
> `master` is the deploy** — no need to poll Vercel or curl prod to confirm it shipped.

### Persistence modes & env vars

| `PERSISTENCE` | Backend |
|---|---|
| `memory` (default) | In-memory; demo seed runs on startup |
| `json` | In-memory + JSON files in `DATA_DIR` |
| `supabase` | Supabase Postgres (requires `DATABASE_URL`) — **the live production backend** (ref `nwfafrgojqkxylbppywo`; use the **SESSION-pooler URL on port 5432** — `aws-…pooler.supabase.com`, user `postgres.<ref>` — **not** the IPv6-only direct host `db.<ref>.supabase.co`, which is also :5432 but will not work on Vercel) |

```
PORT=4200
NODE_ENV=production
PERSISTENCE=supabase           # production; "memory" for local dev with seed data
DATABASE_URL=<supabase-connection-string>
SESSION_SECRET=<32+ random bytes>   # REQUIRED in prod — tokens are forgeable without it (warns on startup)
DATA_DIR=./data                # only for PERSISTENCE=json
CORS_ORIGINS=https://camp.<your-domain>   # lock this; '*' warns in prod
```

Auth is **stateless HMAC sessions** (signed with `SESSION_SECRET`) — no server-side token
store, so logout is client-side and tokens stay valid until their 12h TTL.

### Production DB config — role-level query timeout (NOT in migrations, 2026-07-06)

`ALTER ROLE postgres SET statement_timeout = '15s'` is applied on the prod DB (ref
`nwfafrgojqkxylbppywo`). The per-connection `statement_timeout: 15000` in `client.ts` is
**not reliably enforced through the pooler** (CMS proved a trivial query ran 4+ min despite
it), so the ceiling is enforced at the DB-role level like Supabase's own roles. This lives
on the role, **not** in `supabase/migrations/` — it survives new-year rollover but **must be
re-applied if the Supabase project is ever recreated.** Verify with
`select rolconfig from pg_roles where rolname='postgres';`.

### ✅ DONE — session-mode cutover + connection sizing (2026-08-07). Runbook: `docs/SESSION-MODE-CUTOVER.md`

Prod is on the **session-mode pooler (port 5432)**, **Supabase Pro**, **Micro** compute.
Confirmed by measurement 2026-08-07, not assumed:

| | |
|---|---|
| `max_connections` / reserved | **60 / 3** → 57 usable · ~15 used by Supabase's own services |
| Supavisor **Pool Size** | **30** (was the 15 default) |
| App pool `max` (`client.ts`) | **3** (was 5) |
| Role `statement_timeout` | `15s` — survived both the plan upgrade and the compute restart |

> 🔴 **UPGRADING THE PLAN BUYS NO CONNECTIONS. `max_connections` scales with COMPUTE, and
> MICRO IS 60 — IDENTICAL TO THE FREE NANO.** Only Small (90) and above raise it. Pro bought
> backups, no auto-pause and PITR eligibility. Do not read "we're on paid now" as headroom.

> ⚠️ **THE REAL CEILING IS THE SUPAVISOR POOL SIZE, AND IT IS HALF OF A PAIR.** In session mode
> a connection holds a dedicated backend for its whole life, so
> **`instances served = pool size / client.ts max`**. At the defaults (15 / 5) that was **three
> Vercel instances** before everything else queued — nowhere near a 100–200-leader AM burst, and
> queuing at check-in looks exactly like an outage. At **30 / 3** it is **ten**. Change either
> number and you silently move that ceiling: **redo the arithmetic, and change both together.**

**Still outstanding: the burst load test** (`SESSION-MODE-CUTOVER.md` step 8) — deliberately
deferred to ~mid-September. If it wants more headroom the move is **Small + pool 50**, *not* a
smaller `client.ts max`: 3 is the floor worth having (`max:1` caused head-of-line blocking in
CMS, where one slow query froze every request on the instance including login).

⚠️ **Set compute size FIRST, then pool size** — a resize can reset the pool to the new default.
Re-verify the role `statement_timeout` after any resize.

Two env gotchas that still matter here:

- **The app reads only `DATABASE_URL`** (`src/config/env.ts`) — never `POSTGRES_URL*` or any
  other var the **Supabase→Vercel integration** syncs. So the integration's env sync does
  **not** control the app's DB connection *as long as `DATABASE_URL` is a manually-set Vercel
  var* (which it is — `DATABASE_URL` is not a name the integration manages). Switch modes by
  editing that manual var's port; a resync can't revert a var the integration doesn't own.
  **Still, re-verify `DATABASE_URL` is present + on the intended port after any upgrade or
  integration resync.**
- **Session mode = the Supabase *Session pooler* string** (`aws-…pooler.supabase.com:5432`,
  user `postgres.<ref>`). Do **not** use the *Direct connection* (`db.<ref>.supabase.co:5432`,
  IPv6-only — won't work on Vercel) or the integration's `POSTGRES_URL_NON_POOLING` (that's
  the direct one). Both are port 5432 but different hosts.

## UI fix — Data Import "Confirm" button overwide on phone — deployed 2026-07-08

**SPA-only** (`public/index.html`), no backend/schema change. `_renderAllocCards` (Data Import →
"Unallocated registrants" card): the per-person church `<select>` (`style="flex:1"`) sat next to a
plain `<button class="btn">Confirm</button>` inside a `.rowsb` flex row. `.btn`'s base CSS is
`display:block;width:100%`, and inside a flex container an unconstrained `width:100%` becomes the
item's flex-basis — so the button claimed almost the whole row and squeezed the `<select>` down to
just its native dropdown arrows on a narrow phone screen. Fixed with an inline override on that one
button (`style="width:auto;flex:0 0 auto;margin-top:0"`) so it sizes to its own content and the
church picker gets the space. `sw.js` `camp-v20`→`camp-v21` (HTML changed).

## Forced password change for admin-set/temp passwords — deployed 2026-07-11 (public-repo privacy audit)

> **⚠️ DISABLED 2026-07-11, at the owner's request** (same day it shipped). The gate is a no-op:
> `MUST_CHANGE_PASSWORD_ENFORCED = false` in both `src/api/http/express-adapter.ts` and
> `public/index.html` (two separate constants that must be flipped together — bump `sw.js`'s
> `CACHE` when you touch the HTML one). Everything else described below — the flag-setting in
> `account.service`/`admin.service`, the `must_change_password` column, the self-service
> `POST /accounts/me/password` endpoint, the frontend gate screen — is still fully wired up and
> dormant. Flipping both constants back to `true` re-enables it immediately, retroactively
> covering any account flagged while it was off (an admin password reset or new-year rollover
> still sets the flag even while enforcement is disabled).

A privacy audit of the public GitHub repo (`citipointe-youth/my-youth-camp`) found two issues:
`src/services/multi-source-import.integration.test.ts` (plus two comments referencing it) carried
real PII from an actual 2026-07-02 Elvanto export (names, DOB, mobile numbers, emails, Medicare
numbers, a medical condition, addresses) — replaced with fictional sample data (the tests only
ever asserted on structural values — names-as-lookup-keys, grades, ticket/invoice numbers, amounts
— never on the PII fields themselves, so nothing else needed to change). And, mirroring the CMS
audit finding, `CLAUDE.md`'s seed-account table sat directly under a documented shared default
password, and `public/index.html`'s demo quick-login button ships that literal password (plus the
real username list) in the production JS bundle regardless of the `_isDemoHost()` UI gate — unlike
CMS, no migration seeds named production accounts with it, so this closes the gap for good rather
than reacting to one already-leaked list.

- **`User`/`Actor.mustChangePassword`** (`src/core/entities/user.ts`), embedded in the signed
  session token (`toActor()` in `auth.service.ts`) and enforced in `express-adapter.ts` right
  after `resolveContext`: any route without `allowMustChangePassword: true` on its `Route` entry
  throws `MustChangePasswordError` (403, code `MUST_CHANGE_PASSWORD`) for a flagged actor. Only
  `GET /auth/me`, `POST /auth/logout`, and the new `POST /accounts/me/password` are allowlisted.
- **New self-service endpoint**, `POST /accounts/me/password` (`account.service.changeOwnPassword`)
  — this app previously had no way for an account holder to change their own password, only
  `POST /accounts/users/password` (admin resetting someone else). Verifies the current password
  server-side, then clears the flag; the only path that ever clears it.
- **Who gets flagged:** `account.service.setPassword` (admin resets an existing account's
  password) and the new-year rollover's generated temp passwords (`admin.service.ts` `newYear`) —
  both were previously admin-chosen/generated passwords trusted with no enforcement (temp
  passwords were advisory-only: "should set their own password"). Deliberately **NOT** flagged:
  `createUser`/`createChurchWithAccount` (initial account creation, admin present) — narrower
  scope, matching the equivalent CMS decision, to avoid extra friction on accounts an admin just
  walked someone through setting up.
- **Frontend** (`public/index.html`): `doLogin()`/`_tryRestoreSession()` check
  `ACTOR.mustChangePassword` and route to `_showChangePasswordGate()` (a full-page gate reusing
  the `#login` card styles) instead of the normal app shell. `_doFetch` also catches a
  `MUST_CHANGE_PASSWORD` response code defensively (a stale cached `ACTOR` without the flag hitting
  a gated route) and shows the same gate. `sw.js` `camp-v21`→`camp-v22` (HTML changed; →`v23` for
  the disable toggle above).
- **Migration `021_must_change_password.sql`** — adds `users.must_change_password` (default
  `false` — does not retroactively flag any existing row; no email-list backfill was needed since,
  unlike CMS, no migration here ever seeded named production accounts with a known password).

## Account preview (read-only impersonation) — deployed 2026-07-15

Admin → Accounts (`RENDER.adminAccounts`) gets a **Preview** (eye) button on every **active
non-admin** account tile (church / zoneLeader / director / firstAid; never admin). It drops the
admin into a real, RBAC-scoped session as that account, but **read-only** — every write is blocked
client-side, so sign-in/out logs, notes, and audited reveals are never touched. Distinct from the
same-user "At-camp preview" section below, which this composes with. Design + rejected alternatives:
`docs/superpowers/specs/2026-07-15-account-preview-design.md`; plan:
`docs/superpowers/plans/2026-07-15-account-preview.md`. `npm run typecheck` clean, `npm run test`
= **465 pass**, SPA `node --check` OK. `sw.js` `camp-v23`→`camp-v24`. **No migration.**

- **Backend:** `POST /accounts/users/:id/preview` (admin-only) → `AccountService.previewAccount`
  (validates active + non-admin) then `AuthService.issueTokenFor(id,{mustChangePassword:false})`
  mints a real scoped token. **`issueTokenFor(userId, actorOverrides?)` is NEW** on `AuthService`
  (the app had no token-minting-for-another-user path before; `signSession` is module-private); all
  existing call sites are unaffected. The account controller gained an `auth` dependency (wired in
  `router.ts`). **No preview flag on the `Actor`** — read-only is enforced entirely client-side
  (deliberate scope decision: admin-only feature; the client guard reliably prevents the accidental
  writes that would pollute the audit; the minted token is fully capable server-side).
- **Frontend (`public/index.html`):** `enterAccountPreview(id)`/`exitAccountPreview()` swap the API
  token + `ACTOR`, `Cache.clear()`, and rebuild nav/tabs from the swapped actor (real RBAC, no
  client-side scoping duplication). The admin's own session is stashed in `_previewStash`, mirrored
  to `localStorage['ycp_preview_stash']` so a mid-preview refresh restores into the preview
  (restored in `_tryRestoreSession`). The write-guard in `api()` now blocks non-GET when
  `PREVIEW_MODE || ACCOUNT_PREVIEW`. The preview POST uses `_doFetch` (not `api`) so it isn't
  self-blocked. `confirmEnterAccountPreview(id)` shows a confirm modal first (looks the account up
  from `window._allUsers`, not via the `onclick` string).
- **Mode composition:** `ACCOUNT_PREVIEW` is orthogonal to `PREVIEW_MODE` (both can be true). A
  generalized banner (`_updatePreviewBanner`, driven by `updateModeUI`) shows "Previewing: NAME
  (role) — mode · read-only"; when the real global mode is pre-camp it offers a **Switch to at-camp
  view** toggle (`_togglePreviewMode`) that flips the `PREVIEW_MODE` overlay, giving the pre-camp /
  at-camp / at-camp-preview views of that account. The existing same-user at-camp preview home card
  is unchanged.
- **Also:** `updateModeUI` role badge gained a `firstAid` → "First aid" case (previously fell
  through to "Church"), now visible because firstAid accounts are previewable.

## Field encryption at rest (people/notes sensitive columns) — implemented 2026-07-16

Sensitive `people`/`notes` columns are encrypted at rest with AES-256-GCM so raw DB access
(incl. Supabase staff/SQL editor) reveals only ciphertext, while every service/export still
sees plaintext. Design: `docs/superpowers/specs/2026-07-16-field-encryption-design.md`; plan:
`docs/superpowers/plans/2026-07-16-field-encryption.md`. Backend + migrations only — **no
SPA change, `sw.js` not bumped**. `npm run typecheck` clean, `npm run test` = **479 pass**
(14 new). Migrations `022`/`023` + the backfill script are **operator-gated** (see the plan's
Deployment Runbook) — code alone does not change prod data.

- **Scope + seam:** the codec (`src/utils/field-crypto.ts`, pure `node:crypto`) is called
  ONLY inside the Supabase row↔entity mappers — `supabase.people.ts` (`toPerson`/
  `personColumns`) and `supabase.notes.ts` (`toNote`/`noteColumns`). Services, in-memory/json
  persistence, and the SPA are all unaware encryption exists; `memory`/`json` dev modes stay
  fully plaintext. Encrypted `people` columns: `medical_conditions`, `dietary_requirements`,
  `other_medications`, `medicare_number`, `blue_card_number`, `blue_card_expiry`,
  `parent_guardian_name`, `parent_phone`, `parent_relation`, `consents`. Encrypted `notes`
  column: `body`.
- **Envelope:** `v1.<keyId>.<iv_b64url>.<tag_b64url>.<ct_b64url>` — the `v1.` prefix is the
  "already encrypted?" test (`isEncrypted`), which makes the backfill idempotent and lets
  reads tolerate a table that's any mix of ciphertext + not-yet-migrated plaintext. Every
  ciphertext is bound via AAD to `"<table>:<column>:<id>"`, so a value can't be swapped
  between rows/columns without the decrypt failing (auth-tag check).
- **Column shape:** `text[]`/`jsonb`/`date` fields (`medical_conditions`,
  `dietary_requirements`, `consents`, `blue_card_expiry`) move to new nullable `*_enc text`
  columns (migration `022`) since they can't hold a single ciphertext string in place; plain
  `text` scalars (`other_medications`, `medicare_number`, `blue_card_number`, `parent_*`,
  `notes.body`) are encrypted in place. `null`/`undefined`/`''`/`[]` always round-trip to the
  same empty value — never stored as ciphertext (`maybeEncrypt`/`maybeDecrypt`).
- **Key management:** `FIELD_ENCRYPTION_KEY` (base64, 32 bytes, active) + optional
  `FIELD_ENCRYPTION_KEY_ID` (default `k1`); `FIELD_ENCRYPTION_KEY_PREV` / `_PREV_ID` (default
  `k0`) for decrypt-only during rotation. See `SECURITY-ACTIONS.md` "1b" for generation +
  the rotation procedure. **Losing the key = losing the data permanently — that is the
  security property, not a bug.**
- **Rollout (Deployment Runbook in the plan, operator-gated):** apply `022` → deploy the
  encryption-aware code (reads decrypt-or-passthrough, writes emit ciphertext) → run
  `scripts/backfill-field-encryption.ts` (idempotent/resumable, re-saves every person + note
  through the encryption-aware repos) → verify every row is encrypted → apply `023` (drops
  the four legacy plaintext `people` columns) → `VACUUM FULL people; VACUUM FULL notes;` to
  physically purge plaintext from disk. Rollback is safe any time before `023`.

## At-camp leader UX consolidation — deployed 2026-07-17

Collapsed the at-camp leader's three near-identical "find a person" surfaces into two, and
unified Day-1 arrival sign-in into the daily Check-in surface. Design:
`docs/superpowers/specs/2026-07-16-at-camp-leader-ux-consolidation-design.md`; plan:
`docs/superpowers/plans/2026-07-17-at-camp-leader-ux-consolidation.md`. `npm run typecheck`
clean, `npm run test` = **482 pass**. `sw.js` `camp-v24`→`camp-v25`. **Migration `0005`.**

- **Unified Sign-in/Check-in entry.** One nav id (`checkin`), phase-branched:
  `campPhase()` (new helper, near `_realCampDayNumber`) returns `'signin'` on Day 1 before a
  settable switchover time, else `'checkin'`. `RENDER.checkin` is now a thin wrapper that
  branches to `_renderArrival()` (the old `RENDER.firstday` arrival flow, redirected into the
  `checkin` screen via a module-level `_fdScreen` var so `fdDraw` can target either screen) or
  `_renderDailyCheckin()` (the original `RENDER.checkin` body, renamed). Nav tab label/icon
  ("Sign-in" vs "Check-in") derive from phase via a `_ci()` helper in `navModel`. New
  `CampSettings` fields: `checkinSwitchoverTime` (`'HH:MM'`, default `'14:00'`) and
  `checkinPhaseOverride` (`'auto'|'signin'|'checkin'`, default `'auto'`) — admin-editable in
  Camp Settings (`stSwitchover`/`stPhaseSeg`/`setPhaseOverride`, confirm-gated when forcing away
  from Auto since it flips every live session's entry).
- **Students tab** (`RENDER.students`, replaces the at-camp Search tab for
  church/zoneLeader/director/admin — **first-aid's own `search` screen is untouched**). A `.seg`
  control hosts **My group** (default — ex-`RENDER.myyouth`/`filterMyYouth`, now grouped by
  church for zoneLeader) and **Other churches** (ex-`RENDER.search`'s masked-contact lookup, now
  `_renderOtherChurches`). `TAB_OF` maps `camper`/`myyouth`→`students`, `firstday`→`checkin`.
  `RENDER.myyouth`/`_renderMyGroup` are kept (the legacy `myyouth` screen/home tile are gone, but
  the function is harmless dead code, same pattern as other superseded renderers in this file).
- **4-tile church-leader home.** `renderHomeAtCamp` caps the church role at exactly 4 tiles
  (unified entry, Submit Testimonies, Schedule, Devotional); "My Youth Details" tile removed
  (→ Students tab); "Your Accommodation" demoted to a one-line hero strip; "Testimonies & Notes"
  demoted to a bold slim link below the grid. Other roles keep their existing extra tiles
  (Notices/Data) — the 4-tile cap is church-specific, not global.
- **Double-tap-to-open-profile bug: investigated, does NOT reproduce, no fix applied.** The
  spec's hypothesis was that `openCamper` never claims `_navId`/`_navToken`, so a list screen's
  stale-while-revalidate refetch finishing after it calls `paint()`→`_showScreen(list)` and
  steals focus back. Confirmed half the hypothesis (`openCamper` genuinely never claims the nav
  token) but disproved the other half with a live repro harness (patched `api()` to delay the
  My-group list's background `/campers` refetch by 1.5s, called `openCamper` mid-delay, checked
  `document.querySelector('.screen.active')`): the profile stayed open throughout. Reason — the
  Students-tab refactor above (`_renderMyGroup`/`_renderStudentsBody`) writes the post-fetch list
  content via a direct `element.innerHTML=` assignment instead of a second `paint()` call, and
  `paint()` is the only thing that calls `_showScreen()`. No second paint → nothing left to steal
  focus. If this class of bug resurfaces (e.g. a future list refactor reintroduces a second
  `paint()` call), `openCamper` claiming `++_navToken; _navId='camper'` before painting is the
  known-good fix (same pattern as the earlier first-aid `_faScreen()` fix) — just not needed today.
- **Migration `0005` reconciliation (branch predated the 2026-07-16 consolidation).** This work
  started on a branch cut before "Migration files consolidated" (above) landed on `master` — its
  migration was originally authored as `024_...` against the old `001`-`023` numbering, and its
  backend changes (settings entity/repo/schema/seed/tests) were written before `master`'s
  `tentPrice`/`classroomPrice` removal. Reconciled by merging `origin/master` into the feature
  branch before merging to `master`: renumbered the migration file to `0005_...`, resolved 2 trivial
  test-fixture conflicts (both sides touching the same settings-literal line), verified
  `tentPrice`/`classroomPrice` fully gone and the new fields intact, then re-ran the full gate.
  **Applying the migration via the Supabase MCP tool records the history row under a generated
  timestamp version, not the file's `0005`** — breaks the clean sequence the consolidation
  established, so a follow-up `update supabase_migrations.schema_migrations set version='0005'
  where version='<generated timestamp>'` is required after every `apply_migration` call on this
  project until/unless the tooling is changed to accept an explicit version.
- **Deploy note:** the GitHub→Vercel webhook did not pick up this push for several minutes (no
  BUILDING deployment appeared); `vercel deploy --prod --yes` was used as a manual fallback and
  hit a transient `ECONNRESET` on the first two attempts (ended up moot — the git-triggered
  deployment eventually landed on its own, confirmed by `source:"git"` on the ready deployment,
  not `"cli"`). If this recurs, checking `mcp__plugin_vercel_vercel__get_deployment` on the
  `-git-master-` alias is the fastest way to tell whether it's actually stuck or just slow.

## Feature batch — gender accounts, incidents, initials, passwords + bug fixes — 2026-07-17

Large admin-requested batch (7 features + 3 bugs), built by parallel subagents then hardened by
three code-review passes. **Migrations `0006`/`0007`/`0008` applied to prod** (additive; history
reconciled to `0001`–`0008`). `sw.js` `camp-v25`→`camp-v26`. `npm run typecheck` clean, `npm run
test` = **533 pass**. Verified end-to-end against a running instance (incident isolation, export
RBAC, gender-account creation, password export, parent-mask, login-form attrs).

- **Feature 2 — gender-scoped church logins (`b-`/`g-`).** Every church now has **two** logins:
  `b-<slug>` (scoped to the church's **male** students **and** male leaders) and `g-<slug>`
  (female). `users.gender_scope` (`'male'|'female'|null`, migration `0006`) rides the session
  `Actor`; enforced in **one place** — `canAccessPerson` (`person.service.ts`) narrows by gender,
  and every read path (registrant list incl. the `?churchId` fast-path, roster, search,
  dashboard, accommodation) funnels through it. `createChurchWithAccount` creates BOTH accounts;
  `splitChurchAccounts` (idempotent) back-fills + retires the legacy combined login;
  `scripts/split-church-accounts.ts` + `POST /accounts/churches/split` expose it. **Scope rule:**
  only a person of the *concrete opposite* gender is denied — someone recorded `'other'` or with
  an unset gender is visible to **both** logins so no minor is left without a custodian (review
  Finding 3). A church login also **cannot reassign a person's church/gender/zone** via PATCH, and
  `update()` re-asserts scope on the patched result (fail-closed, Finding 4). Legacy accounts /
  non-church roles have `gender_scope=null` = see all genders.
- **Feature 6 — memorable randomised church passwords + export.** `src/utils/memorable-password.ts`
  → `Word.###` (capitalised noun + 3 digits, e.g. `Donkey.683`; ≥6 chars — widened from the
  original `Word.##` 2-digit form on 2026-07-31, ~11.7k → ~117k keyspace; existing hashed
  passwords stay valid, only NEW ones use the wider form). Auto-generated on
  church-account creation AND re-generated for ALL church logins by an admin **"Randomise & export
  church passwords"** button (`POST /accounts/churches/randomize-passwords`, **admin-only**) that
  also splits/retires legacy logins and returns `{username,church,gender,password}` rows the SPA
  downloads as CSV. `mustChangePassword` is deliberately **never** set (these are the real handed-
  out passwords). ⚠ Keyspace is small (~10k) — mitigated by the login rate-limiter; fine for a
  short-lived camp, revisit if longer-lived (review Finding 5).
- **Feature 3 — Incidents.** `Incident` entity + `incidents` table (migration `0007`); `summary`
  is **encrypted at rest** (AES-256-GCM envelope in `supabase.incidents.ts`, exactly like
  `notes.body` — child-safety data). New `incident:manage` capability = **zoneLeader + director +
  admin** (post AND view; delete = admin/director only). Home tile + `RENDER.incidents` (summary
  textarea + low/high toggle + newest-first list). **Low** = recorded only; **high** = also raises
  an **urgent notification carrying the summary** to all zone leaders/directors/admins. That
  notification is **leaders-only** (`Notification.leadersOnly`, migration `0008`): filtered out of
  church/firstAid feeds in `notification.service.getActorFeed` **and** the duplicate filter in
  `dashboard.service` `latestNotification` (Finding C), and its **body is encrypted at rest** in
  `supabase.notifications.ts` when `leadersOnly` (Finding B — the summary must not sit plaintext in
  `notifications.body`). Incidents also appear as an **"Incidents" option in the Notes-page
  Record-filter** (read-only, leadership only) and get their own **sheet in the audit workbook**.
- **Feature 4 — leader initials + audit capture (church accounts only).** After login a church
  account (incl. `b-`/`g-`) is prompted (skippable) for the leader's initials, stored per-account
  in `localStorage['ycp_initials_<username>']`, shown as a header `✎` badge, and used to seed the
  existing `LAST_LEADER` prefill (sign-in/out + note forms). Initials ride existing fields into the
  audit trail — `CheckInEntry.leaderId` (daily check-in), `SignOutEvent.leaderName` (sign-out) —
  and surface as a **"Leader Initials"** column in the export. **Reveals now log for real:**
  medicare + masked-contact reveals emit an `[audit]` log line with actor id + initials (Finding
  D — previously they returned `revealedBy` but recorded nothing; this app has no reveal-audit
  table, the log line IS the trail). **No migration** (reuses existing fields).
- **Feature 1 — preview auto check-in (SPA, client-side only).** In the 👁 at-camp preview overlay
  (`PREVIEW_MODE`) while the real mode is pre-camp, everyone-except-a-deterministic-5 shows as
  checked in so the roster + Students list look populated. Simulation lives at the read/render
  boundary — `_previewSimActive`/`_previewCanonicalPeople`/`_previewNotCheckedInIds` (last-5 by
  surname, floored to 0 for ≤5-person camps)/`_previewIsPresent`/`_previewLocalFlips` — and is
  applied consistently to the roster, the My-group/Students list, AND `openCamper`'s presence
  render (so drilling in doesn't contradict the row). Check-in taps flip **locally only** (no
  `CHECKIN_QUEUE`, no false "didn't save" banner). **Never fires a network write** (the `api()`
  `PREVIEW_MODE||ACCOUNT_PREVIEW` guard remains the backstop).
- **Feature 5 — iOS PWA login autofill.** The login card is a real `<form id="loginForm">`
  (submit → `doLogin()`), username has `autocomplete="username"`+`autocapitalize="none"`, password
  `autocomplete="current-password"`+`type="password"`, both with stable `name`. Enables iOS
  Keychain autofill of a saved credential (device-only to fully confirm).
- **Feature 7 — setup wizard.** The separate Schedule/FAQ/Devotionals steps are merged into ONE
  **"At Camp Info"** step (`go('atCampInfo')`, done = any of the three has content) — **8 steps**
  now. Each step's `helpTip` tooltip is replaced by a plain **one-sentence summary** line.
- **Bug 1 — first-aid contact masking swapped.** The **leader** number now shows **plainly**
  (`resolveContacts` returns it unmasked, no reveal); the **parent** number is masked behind the
  audited reveal (`revealContact(…, 'parent')`, gated `camper:read:sensitive`). Crucially the
  parent phone is also masked in the **`/campers` DTO for the firstAid role**
  (`camper.controller.maskParentForFirstAid`) so it isn't returned in cleartext at all (Finding 1
  from the SPA review — the reveal would otherwise be illusory). Other roles' parent contact is
  unchanged.
- **Bug 2 — accommodation override applies to leaders too.** The church accommodation override now
  forces **everyone** in the church (students AND leaders) on **all** paths — Form import
  (`import.service`), Ticket-List import (`ticket-import.service`), and manual allocation
  (`accommodationKindForChurch` in `church-allocation.ts`, used by `allocation.service`). The
  earlier commit only fixed the Form path (review Finding 3).
- **Bug 3 — bottom white bar.** `.tabs` reserved the full `env(safe-area-inset-bottom)`; reduced to
  `calc(2px + env(safe-area-inset-bottom) * 0.15)`. CSS-only — eyeball on a home-indicator phone.
- **New capability `export:compliance` (director+admin).** The camp-wide compliance exports (master
  audit workbook + sign-in/out + check-in CSV, `audit-export.service`) were gated on
  `camper:read:sensitive`/`camper:read`, which **church/zoneLeader hold** — so a church login could
  download the whole workbook (all-zone PII, notes, incidents, temp passwords). Now gated on the
  new `export:compliance` capability (review Finding A — a pre-existing hole the Incidents sheet
  widened).
- **Rollout note for existing prod churches — DONE.** The code + migrations deployed, and the
  admin ran **"Randomise & export church passwords"** on 2026-07-17/18: all 5 real prod churches
  are split into `b-`/`g-` logins (10 accounts, 0 unsplit), the legacy combined logins retired,
  and the CSV distributed.

## Follow-up fixes — 2026-07-17/18 (post-deploy)

Two admin-reported issues after the batch above went live, root-caused against real prod data
(Supabase `nwfafrgojqkxylbppywo` queries, not guesswork) and a live browser repro. `sw.js`
`camp-v26`→`camp-v27`→`camp-v28`. `npm run typecheck` clean, `npm run test` = 533 pass throughout.

- **"Randomise & export passwords" showed 'network error' after a successful export (commit
  `7660ad6`).** Root cause: the operation had actually **succeeded** — prod evidence at the time
  showed all churches already split with 0 unsplit accounts, and the admin's downloaded CSV was
  the real, valid output. The error came from `_rAccts()` (a cosmetic accounts-list refresh)
  running *inside the same `try`* as the export and failing transiently, making a fully
  successful randomise look broken. `randomizeChurchPasswords()` now downloads the CSV
  **first** — that response is the only copy of the new passwords, so nothing after it can mask
  or override a successful export — and the refresh failure is now swallowed separately.
- **Incidents screen was completely blank (commit `7660ad6`).** Root cause: the Feature 3 batch
  added `RENDER.incidents` + the home tiles but never added the screen's DOM container — the
  shell pre-declares a fixed set of `<section class="screen" id="…">` divs (see "Frontend files"
  below) and there was **no `id="incidents"`**. `paint`/`_showScreen`/`_spinner` all silently
  no-op when `getElementById(id)` is null, so the form/list/buttons rendered into nothing. Fixed
  by adding `<section class="screen" id="incidents">` to the shell. This had shipped undetected
  because unit tests don't touch the DOM — **caught only by a live browser check**, which is why
  a redeploy affecting the SPA should get at least one visual smoke pass when the Chrome
  extension is available, not typecheck/test alone.
- **Incidents access briefly restricted to at-camp only, then reverted (commits `7660ad6` →
  `756c7b1`).** The same commit that fixed the blank screen also added a `CAMP_MODE!=='at-camp'`
  gate to `RENDER.incidents` (an admin request: "the incidents menu shouldn't be available
  pre-camp mode") plus removed the pre-camp home card. This turned out to be **too broad**: the
  real prod camp was still pre-camp (camp dates are 2026-09-28–10-01), 2 real incidents had
  already been logged pre-camp before the gate landed, and **zoneLeader/director have no other
  console** to reach the Incidents screen from — so the gate made any pre-camp incident
  permanently unreviewable/undeletable until the mode switch, a safeguarding dead-end. Reverted:
  `RENDER.incidents` is **role-gated only** (`canManageIncident()`, unchanged from the original
  design) and the pre-camp home card is back. The literal "shouldn't be available pre-camp"
  request is not implemented as full lockout — flagged to the admin as a deliberate trade-off
  (declutter vs. safeguarding accessibility); revisit if a lighter-touch decluttering (e.g. a
  settings-page link, matching the Notices/Data-Import precedent below) is still wanted.
- **"Testimonies & Student Notes" renamed to "Testimonies & Notes"** (`RENDER.notes`'s `paint()`
  title, commit `756c7b1`) — admin-requested, cosmetic only.

## Testimonies & Notes — incident severity badge + zone accent — deployed 2026-07-18

Admin-requested 2-item batch (leadership screen only — admin/director/zoneLeader; church doesn't
reach this screen's incident view since `incident:manage` excludes church). **SPA-only**
(`public/index.html`), no backend/schema change (both `severity` on `Incident` and zone data were
already present, just not surfaced/joined here). `npm run typecheck` clean, `npm run test` = 533
pass. `sw.js` `camp-v28`→`camp-v29`.

- **Incident low/high badge.** `drawNotes`'s `badge()` (previously a flat `<span class="pill
  warn">Incident</span>` for every incident record) now reads `n.severity` — **"Incident · High"**
  keeps the alarming red `pill warn`, **"Incident · Low"** downgrades to the calmer amber `pill
  amb`. `severity` was already threaded onto the synthesised `incidentRecs` in `RENDER.notes`
  (`cat:'incident',severity:i.severity,...`) from `GET /incidents` — it just wasn't read in the
  badge. `badge()` now takes the whole record `n` instead of just the category string `c` (call
  site: `badge(n)`, not `badge(c)`).
- **Zone colour accent (left edge).** New `ZONE_COLORS` (mirrors `ZONES`/backend `ZONE_NAMES` —
  the zone names literally ARE colours: `Yellow #eab308`, `Blue #4f46e5`, `Black #1e1a3a`, `Red
  #e11d48`) + `zoneAccentStyle(z)` helper, both near the `ZONES` const (~line 804). Each record
  card in `drawNotes` gets an inline `style="${zoneAccentStyle(n.zone)}"` — a 4px `border-left`
  in the zone's colour, same visual pattern `.ncard` already uses for its urgent/zone accents.
  **Zone resolution, in order:** (1) the attached student's zone (`n.camperId` → `cmap` from the
  already-fetched `/campers` join — unchanged); (2) for a camper-less general note/testimony,
  the zone of the church that logged it — `RENDER.notes` now also fetches `GET
  /accounts/churches` (role-scoped, safe for every role that reaches this screen) and builds
  `churchZoneById`, looked up via the note's `authorChurchId` (only set when the author is a
  `church` role — `note.service.ts`'s `authorChurchId: actor.churchId`); (3) no student, no
  resolvable church (e.g. a general note logged by a director/admin/firstAid/zoneLeader, or an
  incident with no `zone` set) → **no accent**, plain card, "zone-agnostic" by design.
  `signedOut`/`incidentRecs` already carried their own `zone` field unchanged (student's zone /
  the incident's own `zone`, respectively) — only the general-note fallback path is new.
  **Gotcha avoided:** the new churches fetch in `RENDER.notes` must NOT be named `churches` — a
  local `const churches` (the distinct church-name list for the Ministry filter dropdown) is
  already declared later in the same function; the fetched array is named `churchRows` instead.

## Frontend fixes batch — two-pass UX review — deployed 2026-07-19

Two independent frontend reviews (own pass + a blind second-opinion subagent, combined into
one published artifact) produced 14 findings, prioritised Now/Next/Later. Plan written to
`docs/FRONTEND-FIXES-PLAN-2026-07-18.md` before implementation; owner pre-authorized the full
batch (all 3 tiers) including deploy, so this shipped in one session rather than the usual
review-then-approve cadence. **SPA-only** (`public/index.html`), no backend/schema change.
`npm run typecheck` clean, `npm run test` = 2132 pass. `sw.js` `camp-v29`→`camp-v30`.
Multiple pieces were built in parallel by isolated Sonnet subagents (git worktrees, merged
sequentially to avoid stomping each other in this single 4,800-line file) — see the commit
history on the (now-merged, deleted) `frontend-fixes` branch for the individual subagent
commits if you need the granular diffs.

- **Grade null bug.** `'Grade '+p.grade`/`'Grade '+s.grade` (Student Info + My Youth heroes,
  the two highest-traffic profile screens) now guard with `||'—'`, matching the pattern already
  used elsewhere in the file.
- **Check-in session picker overflow.** `#dayseg` (the twice-daily session picker — 8-13
  buttons on a normal 5-7 day camp, not the 4-day/6-session test camp this was originally
  missed on) now scrolls + snaps instead of squeezing labels unreadable past ~6 sessions.
- **First Aid alert-box severity was backwards.** "No medical conditions" (reassuring) used to
  render in the same loud amber `.fa-alert` box as a real medical flag; "no leader contact on
  file" (the actually actionable gap) rendered in the quiet `.fa-lead` card. Swapped: reassuring
  cases now use a new `.fa-neutral` shell (same box as `.fa-lead`, generic name since it's not
  leader-specific); "no leader contact" now uses `.fa-alert`.
- **3 highest-blast-radius `confirm()`/`prompt()` sites → in-page modal** (`switchMode`,
  `adminReset` full-wipe, `doNewYear` rollover) — the app's own `.sheet`/`#modal` system was
  already good where used (Account Preview), native dialogs block the JS thread and one was
  confirmed to freeze a tab solid during testing. `adminReset`'s type-to-confirm text ("I
  understand this cannot be undone") now lives in the modal with a disabled-until-exact-match
  button, mirroring the close-out screen's existing 3-checkbox pattern. `doNewYear`'s
  `confirm()` was **deleted outright, not modalised** — its only caller (`RENDER.adminCloseOut`)
  already gates the trigger button behind those same 3 checkboxes, so the native dialog was
  pure redundancy. The other 13 `confirm()`/`prompt()` call-sites in the file are unchanged
  (out of scope by design — see the plan doc for the full list).
- **First Aid "All Students" no longer requires picking a church first.** `RENDER.allstudents`
  renders the full camp-wide roster on open (church/zone[new]/gender/grade all optional
  filters now, church no longer a prerequisite). **No pagination/virtualization added** — this
  app has no lazy-render pattern anywhere else, and a flat `.map().join('')` of a few hundred
  simple rows is expected to be fine; flag it if a real 400+-person camp shows jank on-device,
  it's an easy follow-up if actually needed.
- **Design-token dedup pass.** ~35 of the ~200 hardcoded hex-color/font-size literals scattered
  through the JS template strings were tokenized onto existing `--root` tokens — deliberately
  conservative (pure 1:1 value substitution only; ambiguous near-matches were left alone rather
  than force-mapped, to guarantee zero rendering change). "Not on site" pill now uses the
  existing `.pill.warn` modifier instead of a hand-rolled inline style.
- **Mode-switch now announces itself.** `_applyModeChange()` (the function both the cross-tab
  `storage` listener and the on-refocus `visibilitychange` handler funnel through) used to
  update the UI silently; it now toasts "Camp switched to At Camp/Pre-Camp mode". The function's
  existing `mode===CAMP_MODE` guard already means it only ever runs on a genuine change, so no
  separate one-time/dedup flag was needed.
- **Two review findings turned out to be non-issues on investigation** (documented rather than
  silently dropped, since the original report is still published and shouldn't be treated as
  gospel by a future session): (1) the review's "unify the two day computations" concern —
  `_realCampDayNumber()` (real at-camp) vs `SETTINGS.campDay` (the `PREVIEW_MODE`-only manual
  toggle) are deliberately separate, already documented at their declaration, and never both
  active at once — no drift risk. (2) the review's "add optimistic UI to check-in" — check-in
  already has a full optimistic-update implementation (`CHECKIN_QUEUE`, `drainQueue`,
  `_optimisticState`, a failure-retry banner, a 4s undo window — see the `B-1`-tagged comments),
  added in an earlier batch after the review's source material was written.
- **Also fixed while auditing error states:** 4 genuine fetch-failure `catch` blocks (`_navTo`,
  `RENDER.allstudents`, `RENDER.records`, `offlineSignInUpload`) were using the muted
  `.note-hint` style instead of the alarm-styled `.err` class. **Correction to the original
  finding:** `.err` turned out to be used *only* by the two login-form errors before this,
  not an established general-error system app-wide — so this was a small, targeted extension of
  `.err`'s usage, not a "restore consistency" fix. `.err` defaults to `display:none` (built for
  the static login-error divs, toggled via JS) — the 4 new usages needed an explicit
  `style="display:block"` since they're freshly-created elements, not toggled ones.
- Admin console tile grouping and the check-in tab id/label drift were **documented, not
  changed** (both were explicit Now/Next-tier decisions to leave alone — see the plan doc).
- **Deliberately out of scope for this session:** live browser/device testing — the owner is
  doing a manual phone pass themselves afterward, specifically on the session picker at 8+
  sessions, the full unfiltered 400+-entry roster, the First Aid alert box, and the new
  confirm-modal flow (see `docs/FRONTEND-FIXES-PLAN-2026-07-18.md`'s checklist).

## UI/bug batch — incident alerts, overlay stacking, preview phases — deployed 2026-07-26

Admin-requested batch of 10 items from a phone pass. **SPA-only except one backend one-liner**
(`dashboard-cache.ts`) — no schema/migration change. `npm run typecheck` clean, `npm run test` =
**580 pass** (+1 new regression test), SPA `node --check` OK. `sw.js` `camp-v43`→`camp-v44`.
Two design/assessment docs were produced alongside and are NOT implemented — see the bottom of
this section.

- **Light-purple bar under the bottom nav / login card (screenshots 1, 2, 8).** The CANVAS
  background paints the strip below the body box that iOS briefly exposes when the dynamic toolbar
  retracts or the keyboard dismisses (it vanishes on the next scroll — exactly the reported
  symptom). `html` had no background, so the canvas inherited `body`'s `--paper` and that transient
  strip read as a light-purple bar under the near-white nav. **`html{background:#fff}`** stops the
  propagation; `body` keeps `--paper` for the app column. Accepted side effect: the letterbox
  either side of the capped `.app` column between ~540–980px is now white. At ≥980px `#app` is
  `max-width:none` so nothing changes there. Supersedes the 2026-07-24 Follow-up 3 reasoning (the
  light body background was necessary but addressed the *black* bar, not this one).
- **Deleted incident stayed on screen until reload.** `_invalidate()` had no `/incidents` branch,
  so a `DELETE /incidents/<id>` fell through to the generic `Cache.del(path)` — which only matches
  keys equal to or *under* `/incidents/<id>`, leaving the cached `/incidents` LIST key intact for
  the 30s TTL. Added `else if(path.startsWith('/incidents'))Cache.del('/incidents','/notifications')`.
  **Notices were checked and are fine** (`/notifications/<id>` already hits a prefix branch), but
  **`/faq/<id>` had the identical latent bug** and got the same treatment. ⚠️ GOTCHA for future
  endpoints: any write to `/<resource>/<id>` needs an explicit `_invalidate` branch naming the
  collection key — the fall-through does NOT clear the list.
- **Incident alerts: full-screen modal → compact Home banner.** The "Incident logged" bottom sheet
  fired on **every** app open and was disruptive. Now: **`leadersOnly`** (set by exactly one code
  path — `incident.service.log`; every other notification is created `leadersOnly:false` — so it is
  a reliable incident marker with no schema change) drives a new `_isIncidentNotice()`. New helpers
  `_noticeFeed()` / `_urgentAlerts()` / `_alertBannerHtml()` / `_ackAlert()` + `.inc-banner`
  CSS. A red, left-accented strip sits **above the hero on Home** (both pre-camp and at-camp — the
  pre-camp variant matters, incidents have been logged pre-camp), one row per unacknowledged high
  incident, tap the text to open Incidents, "Got it" to acknowledge. **Acknowledgement is per
  device** (`localStorage`, reusing the existing `_DISMISS_KEY` store) — owner chose this over a
  server-side per-user ack table; a leader on a second device or after clearing site data will be
  alerted again. **Incident notices no longer appear in ANY notice list** — filtered out of the Home
  notices AND `RENDER.notifs` (owner decision). The backend still creates the notification: it is
  what the banner reads, and the push design hangs off the same record. **Deliberately unchanged:**
  a genuine human-sent urgent notice still pops the modal (`_checkUrgentNoticesFromFeed` now
  excludes incidents only) — that is a director choosing to interrupt everyone.
  **↑ SUPERSEDED SAME DAY (`camp-v44`→`camp-v45`): the bottom sheet is GONE entirely.** Keeping the
  modal for human-sent urgent notices meant Home could show an alert banner at the TOP *and* a
  sheet at the BOTTOM at the same time (reported immediately on an at-camp preview: prod has both
  a `leadersOnly` "Incident logged" AND a non-incident urgent "Scheduled 1" live). There is now
  exactly **ONE alert surface**: `_urgentAlerts`/`_alertBannerHtml`/`_ackAlert` render EVERY
  unacknowledged urgent notice — incident or human-sent — in the top banner, with the row's tap
  target routing by kind (incident → Incidents screen, else → Notices). `_checkUrgentNoticesFromFeed`,
  `checkUrgentNotices` and `_ackUrgent` are **deleted**. ⚠️ Do NOT reintroduce a blocking dialog for
  notices — that is the exact complaint this replaced.
- **Home notices = the 3 most recent REAL notices** (`_noticeFeed(feed).slice(0,3)` on both home
  variants; both already sliced to 3, the bug was incidents eating the slots).
- **Bottom sheets were rendering UNDER the bottom nav** (screenshots 5 "Switch to At-Camp" and 7
  "Bulk Church Update" — both had their primary button hidden). `.tabs` is `z-index:100`; `.modal`
  was **50**, `.ig-wrap` 55, `#login`/`#mcpGate` 60 — all below it. New documented ladder:
  **nav 100 < modal/guide 120 < toast 130 < login/gate 140 < tooltip 200 < undo toast 9999.**
  ⚠️ GOTCHA (now recorded in the CSS): a full-viewport overlay must be `position:fixed` **AND**
  above 100. This is the companion rule to the 2026-07-24 Follow-up 7 `absolute`→`fixed` sweep.
- **Schedule editor rows compacted.** The 7 default empty rows per day inherited full-size `.fld`
  padding/type (sized for one-per-line form fields, not a dense repeating grid). `.sched-row .fld`
  now has its own tighter padding/font/radius; time column `86px`→`80px` (header grid updated to
  match — they must stay in sync).
- **Camp settings short fields capped.** `.setg input[type=time|date|number]{max-width:190px}` —
  a "6:00 am" value no longer sits in a phone-width box. Free-text fields (camp name) unchanged.
- **Notices subtitle showed a literal `&amp;`.** `_paint` sets the title/subtitle via
  **`.textContent`**, so an HTML entity is never decoded. `'Camp &amp; zone updates'` → `'Camp &
  zone updates'`. The other ~20 `&amp;` occurrences are inside `innerHTML` strings and are correct
  — only `paint()`'s 3rd/4th args must use a bare `&`.
- **Send-a-notice: Normal vs Urgent tooltip.** `helpTip` beside the Priority label explaining that
  Urgent additionally pops a full-screen alert on next open.
- **At-camp preview: Day 1 / Day 2 toggle → Sign-in / Through camp.** `SETTINGS.campDay` and
  `switchDay()` are **gone**, replaced by an in-memory `_previewPhase` + `switchPreviewPhase()`.
  Rationale: the two things worth rehearsing are the two FACES of the check-in surface, and "Day 2"
  was a misleading proxy (it still ran through the switchover-time rule, and implied testimonies
  only open on day 2 — they are always open). `campPhase()` now returns `_previewPhase` outright in
  preview, ahead of both the time rule and the admin's saved `checkinPhaseOverride` (which belongs
  to the real camp). The header badge reads "Sign-in ›" / "Through camp ›" and toggles on tap. On
  Home, `isDay1` is forced true in preview so the First-Day button and the Daily Check-in tile are
  **both always rendered, one live and one greyed**; greyed-tap copy is preview-aware ("Tap the
  … badge up top"). Testimonies screen subtitle "Day 2+" → **"Open all camp"**.
- **`dashboard-cache.ts` `_actorKey` was missing `genderScope`** (the ONE backend change). Found by
  the launch-readiness pass below, then confirmed with a test that fails without the fix. `b-victory`
  and `g-victory` are both `role:church` with the same `churchId`/`zone`, so they **collided in one
  30s cache slot** — whichever fetched first seeded the other gender's dashboard figures. Counts
  only (no names/PII crossed) but still one gender's roster reported to the other custodian. Latent
  since Feature 2 / migration `0006` (2026-07-17). +1 regression test in `dashboard.service.test.ts`.
  ⚠️ Any future scoping dimension must be added to that key too.

**Two docs produced, NOT implemented (owner reviews before anything ships):**
- **`docs/superpowers/specs/2026-07-26-web-push-design.md`** — Web Push (PWA) via Vercel Cron,
  covering three triggers only: high-severity incidents, scheduled notices firing at their real
  minute (replacing today's lazy-fire), and check-in-window-closing warnings (the deferred item 10).
  Supersedes/absorbs `2026-07-23-web-push-design.md`. Includes the privacy assessment. Headline
  recommendation: **title-only payloads — a server-stored `body` never enters a push payload**
  (`notifications.body` is encrypted at rest when `leadersOnly`; shipping it to Apple to render on
  a lock screen would defeat that). Notes a real blocker: `HttpRequest` (`src/api/http/types.ts`)
  has **no `headers` field**, so a `CRON_SECRET`-guarded route cannot read `Authorization` today.
  Would need migration `0013`.
- **`docs/LAUNCH-READINESS-2026-07-26.md`** — assessment for the ~2026-08-05 launch to ~100
  leaders. Biggest finding: prod is still on the **transaction-mode pooler (port 6543)** with
  `max: 5` — the exact configuration behind YS Connection's multi-day outage at 30–40 users —
  and `docs/SESSION-MODE-CUTOVER.md` is written but marked not-yet-done. Compounding it,
  `getSessionStatus`/`/home`/`/registrants`/`/campers`/search **all** call `personRepo.findAll()`,
  and the SPA never passes `?churchId`, so the indexed fast-path is dead code in practice. 8
  BLOCKING items, most of them owner-side dashboard checks.

## Accommodation fold-in fix + override relocation — deployed 2026-07-20

Admin-requested batch of 3 items, found while testing against a realistic sample data set
(`../Sample Data New/*-2026-07-16-v2.csv`) where **no church cleared the 75% classroom
threshold**. **SPA + backend** (`src/services/accommodation-allocation.ts`), no schema/migration
change. `npm run typecheck` clean, `npm run test` = 554 pass (3 new
`accommodation-allocation.test.ts` cases).

- **Root-cause bug (this is what broke "girls' leader counts"):** a church under the 75%
  classroom-eligibility threshold got **no classroom group** (correct, unchanged), but its
  classroom-*preference* people were never folded into Tent City either — `tentDistribution`
  only counted a literal `accommodationKind==='tent'`. With the realistic sample data (every
  church landed 31–67%, well under 75%), this meant every church's classroom-preference people —
  students **and leaders**, both genders — were invisible on the whole Accommodation Allocations
  screen. Confirmed against the real sample: 10 of 12 imported leaders were female, several
  classroom-kind, and they simply didn't appear anywhere until this fix.
  - Fix: `isEligible`/`tallyChurches` (backend) is now the single eligibility check shared by
    `computeGroups` (unchanged behaviour — still excludes ineligible churches from classroom
    groups) and `tentDistribution`, which now folds in anyone whose personal
    `accommodationKind==='classroom'` but whose church isn't eligible. SPA `tentDist` mirrors
    this exactly (calls `accomChurches` first for the eligibility check, same as
    `accomGroups` does). Verified end-to-end against the real sample data: every registered
    person now reconciles to either a classroom group or a tent count — zero silently dropped.
- **Pending-allocation table split.** The old single "Classrooms (Pending Allocation)" table
  mixed two different states (eligible groups still awaiting a room, and ineligible
  under-75% churches). `drawAccom` now renders two sections: **"Classrooms (Pending
  Allocation)"** (eligible-but-unplaced groups, plus anyone with no accommodation type
  recorded yet — also previously invisible) and a new **"Under 75% — Moved to Tents"**
  section beneath it, whose rows now say the person is counted in Tent City below rather than
  the old, inaccurate "not allocated". Tooltips on both headings (and the Tent City help
  tooltip) updated to match.
- **Ministry accommodation override relocated.** `Church.accommodationOverride` (tent/classroom/
  no override) used to be set inside the church's **Account Info** modal
  (`editChurchName`/`saveChurchName`). It's now a dedicated "Accommodation overrides" card on
  **Admin → Accommodation setup** (`RENDER.adminAccom`, `saveChurchOverride` — instant per-row
  save via the existing `PATCH /accounts/churches/:id` endpoint, no backend change). The Account
  Info modal shows a one-line pointer to the new location instead; the Accounts screen's
  Churches tooltip was updated to match.

## Architecture

```
api (Express) → controllers → services → repositories (interfaces) → core
```

- **`src/core/`** — pure types, entities, enums, Zod schemas, errors. No imports from other layers.
- **`src/repositories/`** — interfaces (DB-swap surface) + in-memory implementations + JSON file persistence.
- **`src/services/`** — all business logic + RBAC. Depend on repo *interfaces* only.
- **`src/api/`** — thin controllers → declarative route table (`http/router.ts`) → Express adapter. Express lives only under `src/api/http/` and `src/api/middleware/`.
- **`src/container.ts`** — composition root. The only file that names concrete repositories.

## Roles

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `church` | Own church | Registrant read/write, daily check-in, write notes |
| `zoneLeader` | Own zone | All of above (zone-scoped), read notes, send zone notices, read registrants in zone |
| `director` | All | All of above (camp-wide), import, camp-wide notices |
| `admin` | All + back office | Everything + admin:manage (settings, accounts, accommodation, FAQ, schedule, devotionals, mode switch) |
| `firstAid` | All | `camper:read`, `camper:read:sensitive`, `attendance:write` (attendance only, NOT `checkin:write`), **`note:write:firstaid`** + **`note:read:firstaid`** (Phase 4 — first-aid records only, never general notes/testimonies). No admin, no pre-camp data. |

Additional `admin` accounts can be created (2026-07-31). The **original** admin — the
earliest-created one, see `findOriginalAdmin` — cannot be deleted, deactivated or demoted by
anyone, including itself; secondary admins are full peers in every other respect.

## Camp mode

`CampSettings.campMode: 'pre-camp' | 'at-camp'`

- Controls which tabs and admin tiles appear in the UI.
- Switched via `POST /admin/mode { campMode }`.
- Admin console is **identical in both modes** — admins can configure at-camp content (devotionals, schedule) while still in pre-camp mode.

## At-camp preview (client-side only)

Users in pre-camp mode can tap **"👁 Preview at-camp view"** on the pre-camp home screen to enter a read-only preview of the at-camp UI. This is **entirely client-side** — no backend change, no mode switch.

- **State:** `PREVIEW_MODE: boolean` (in-memory only, never persisted).
- **Entry:** `enterPreview()` — sets `PREVIEW_MODE=true`, flips `CAMP_MODE` to `'at-camp'` locally, shows amber `#previewBanner` strip, rebuilds tabs, navigates home.
- **Exit:** `exitPreview()` — restores `CAMP_MODE` from `SETTINGS.campMode`, removes banner, rebuilds tabs.
- **Write blocking:** the `api()` function short-circuits any non-GET request while `PREVIEW_MODE` **or `ACCOUNT_PREVIEW`** is true — shows a toast and throws. Covers every write in the app without per-screen changes.
- **Logout safety:** `logout()` clears `PREVIEW_MODE`/`ACCOUNT_PREVIEW`/`_previewStash` before POSTing to `/auth/logout` so the write guard never blocks logout itself.
- All roles can enter preview. Preview uses real live data (campers, schedule, devotionals already imported).
- **Banner is shared with account preview** (see "Account preview" above): `#previewBanner`'s label/toggle/exit are driven by `_updatePreviewBanner()` (called from `updateModeUI`); the Exit button dispatches via `_exitAnyPreview()` to `exitPreview()` (same-user) or `exitAccountPreview()` (account preview).

## Daily check-in (twice daily)

**De-linked from the schedule (2026-06-25).** Check-in sessions are now derived purely from
`CampSettings.checkInDays` — **two synthetic sessions per camp day** (Morning 08:00 / Afternoon
13:00), generated in `src/services/checkin-sessions.ts`. The schedule is unrelated to check-in
(it is pure plan communication); `ScheduleItem.isCheckInPoint` and `getCheckInPoints` no longer
exist.

- **(AC-1, 2026-06-29)** the **first** camp day generates a **PM session only** (arrive at lunch),
  the **last** day an **AM session only** (depart at lunch); interior days keep AM+PM; a 1-day camp
  is PM-only.
- Session id = **`${day}~am` / `${day}~pm`** (e.g. `2026-09-28~pm`) — delimiter is `~`, URL-safe (a `#` would be parsed as a URL fragment when the id is put in a request path; SPA also `encodeURIComponent`s it); this is the key in
  `Camper.checkInHistory[].sessionId`.
- `getCurrentSession()` picks today's AM before midday / PM after (camp tz); falls back to the
  most recent past session. Both `checkin.service` and `dashboard.service` use the shared pure
  helper (`buildSessions` / `currentSession`).
- `checkInDays` is auto-generated from start/end dates in the admin Settings screen (each date
  inclusive); setting the start date pre-fills the end date to the 4th day.
- The frontend shows compact session labels (`Mon AM`, `Mon PM`).
- **Optimistic check-in queue** (`CHECKIN_QUEUE`): taps flip local state immediately and drain to the server in order. Retries with exponential backoff on network failure; hard-drops on 4xx. Undo toast gives 4-second reversal window.

## Presence model (P0 — critical invariant)

`atCamp` and `lifecycle` are **orthogonal**:

- `atCamp` — is the person **physically on site right now?** Only written by `withSignEvent` (attendance sign-in/sign-out path).
- `lifecycle` — registration state machine: `registered → arrived → checked_out → departed | cancelled`. Only `withSignEvent` advances this beyond `registered`.
- `withCheckIn` (daily session log) **never** touches `atCamp` or `lifecycle`. It appends to `checkInHistory` only.
- **`withCheckIn` is idempotent per (session, person, type) — N5, 2026-07-31.** If the LAST entry for the same `sessionId` already has the same `type`, the write is a no-op and the person is returned unchanged (no `updatedAt` bump), so a crash-replay from the SPA's persisted check-in queue can't write a duplicate row into the compliance export. ⚠ It compares against the **last entry for that session only**, never the whole history, because **"checked in" is LAST-ENTRY-WINS** (`toRosterEntry`, `checkin-warnings.ts`) — a genuine in → out → in is three real entries and must keep working. Tests: `person-lifecycle.test.ts`.
- `checkIn()` in `person.service.ts` guards: throws `BadRequestError` for `lifecycle === 'cancelled'` OR `atCamp === false`. Day-1 first-arrival must go through `signEvent` (attendance sign-in), not the daily check-in path.
- The check-in roster in `getSessionStatus` filters on `p.atCamp === true`, not `isCamper(p)` — departed campers (`atCamp:false`) never appear on the daily roster.
- `checkInsDue` on the at-camp dashboard is scoped to `atCampNow` (persons with `atCamp===true`), not all `isCamper()` persons. This prevents departed campers inflating the "still to check in" count.

## Key design rules

- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks.
- **Validation inside services**: all external input parsed with Zod inside the service, not the controller.
- **Repos return deep clones**: in-memory base repository clones on every read/write.
- **Accommodation lock**: `CampSettings.accommodationLocked` — server blocks non-admin writes when true.
- **Extensionless imports**: ESM, `moduleResolution: "Bundler"`, no `.js` extensions. Each folder has an `index.ts` barrel.
- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`. Guard all indexed access.

## Frontend files

| File | Purpose |
|------|---------|
| `public/index.html` | Production SPA — rebuilt 2026-06-10 from the demo. UI redesigned 2026-06-23 (indigo/purple palette, Plus Jakarta Sans). |
| `ui-mocks.html` | Static HTML mock renders of all key screens — shows the redesigned UI and P0–P4 feature updates. Open in a browser. |
| `../youth app demo/camp-platform.html` | Standalone offline demo — all API calls handled by an embedded MockAPI. The **original UI source of truth**. |

## Design system (updated 2026-06-23)

All tokens live in `:root` in `public/index.html`. Do not use hardcoded hex values for these colours anywhere — use the CSS variables.

| Token | Value | Usage |
|---|---|---|
| `--navy` | `#1e1b4b` | App background, header gradient end |
| `--blue` | `#4f46e5` | Primary buttons, active state, links |
| `--blue2` | `#818cf8` | Progress bar fills, secondary highlights |
| `--purple` | `#9333ea` | Tile icons, hero gradient start, pre-camp badge |
| `--violet` | `#7c3aed` | Button gradient start, header gradient start |
| `--teal` | `#06b6d4` | Devotional hero card |
| `--paper` | `#f5f4ff` | App background (light purple tint) |
| `--line` | `#e4e2f5` | Borders |

**Font:** Plus Jakarta Sans (Google Fonts, loaded in `<head>`). System font stack is the fallback.

**Header bar:** `linear-gradient(135deg, var(--violet), var(--navy))`.

**Hero cards:** `radial-gradient(130% 130% at 0% 0%, #9333ea, #1e1b4b 72%)` with two decorative pseudo-element circles.

**Tab bar active state:** pill background `#ede9fe` with `color: var(--blue)`. No underline indicator.

**Buttons:** `linear-gradient(135deg, var(--violet), var(--blue))`. `.btn.ghost` uses `#f1f0ff` background with `#3730a3` text.

## SPA ↔ backend contract (rebuild notes)

The SPA was forked from an earlier demo and had drifted onto the demo's **MockAPI contract**, which differs from the real Express API. When porting a screen from `camp-platform.html`, watch these (the rebuild fixed them all):

- **No envelope.** The backend returns results *bare* (`res.json(result)`); errors are an HTTP error status + `{code,message}`. `api()` returns the bare result and throws on non-2xx. (The demo's MockAPI used `{ok,data}` and `d.actor`; real login returns `{token,user}` and the SPA builds `ACTOR` + a client-side `displayName`.)
- **`/campers` returns a bare array**, not `{items}`. Camper `kind` is `'student'|'leader'`.
- **Check-in status** = `{session, roster:[{camperId,firstName,lastName,church,zone,gender,grade,medicalFlag,checkedIn,lastEntry}], checkedInCount, totalCount}` — roster now includes gender/grade/medicalFlag directly (no second `/campers` fetch needed).
- **Attendance** is `POST /attendance/sign-in|sign-out` with a `camperId` body (not `/campers/:id/sign-*`). Notes for a camper = `GET /notes/camper/:id`. Search reveal = `GET /search/contact/:camperId/:role` (role like `male-primary`).
- **`/home`** DTO differs by mode: pre-camp has `totalCampers/totalLeaders/noBlueCardCount/accommodationSummary[]/perChurchBreakdown[]` (no gender split, no church `code`, no `expected`); the by-ministry M/F table and church code are derived client-side from `/registrants` and `/accounts/churches`.
- **Accommodation (reworked 2026-06-27 to match the prototype):** classroom **rooms** (`/accommodation/classrooms`, name+capacity) + an **allocation map** (`GET/PATCH /accommodation/allocations` = `{roomId:[{key:"churchId|gender", n}]}`) + eligible-group helper (`/accommodation/groups`) + church-facing `/accommodation/church-rooms/:churchId`. Allocatable **groups** = per church×gender (students **and** leaders pooled together) where **≥75% of that church's campers are classroom-kind**; the SPA **auto-fills** a room to capacity (remainder shown as "unallocated"), rooms are **single-gender** (enforced in the service via `validateAllocations` AND the SPA dropdown), and un-allocate cascades freed people into other rooms. **Tents** are not allocated — `tentDistribution` auto-buckets tent-kind campers into **7-person tents, students and leaders separate** (display only). **(2026-07-20)** also folds in anyone whose `accommodationKind==='classroom'` but whose church is under the 75% threshold (see "Accommodation fold-in fix" below) — nobody is left uncounted just because their church didn't clear the classroom eligibility bar. The old `AccommodationBlock` + per-church `reservations` model is **gone** (DB tables dropped in migration `004`). **(SUPERSEDED 2026-06-29 — see "Improvement Initiative" above):** `CampSettings.tentPrice/classroomPrice` are now **deprecated/unused** — removed from the Settings UI; Budget reads per-registrant `registrationCost`, not settings. The eligible-group logic now also **splits a church×gender pool >50 into `7-9`/`10-12` brackets** (PC-10). Pure logic + types: `src/services/accommodation-allocation.ts`. The church "Your accommodation" home tile is shown **only in real at-camp** (`campMode==='at-camp' && !PREVIEW_MODE`).
- **Notes** require a `camperId`; a **testimony** is a note with `category:'testimony'` (so the testimonies screen picks a student). `/notes/recent` has no camper details (joined from `/campers`); `/notes/export` returns a **CSV string** (downloaded directly) with a Category column.
- **Admin paths**: `/accounts/users`, `/accounts/churches`, `/admin/defaults`, `DELETE /admin/notifications`, `/import/csv` (body `{csvData}`, CSV only), `/devotional/:day` (path param). Passwords are **min 8**. Church create needs `churchName`+`zone`+`account*` fields only. (Password edits use `POST /accounts/users/password` `{userId,password}`.)

> **Field removal (2026-06-25):** self-registration was dropped (all registrants arrive via CSV).
> Removed from `Church`: `code`, `selfRegisterSlug`, `expectedCount`, `youthPastorName`,
> `contactEmail` (church name + a **separate** login username are the identity; matching/import is
> by **name**). Removed from `CampSettings`: `checkInLocation`, `checkInFrom`, `registerBaseUrl`.
> Migrations `008`/`009` dropped the columns in prod. The SPA Accounts screen is now one row per
> login (leadership + churches) with rename/username/password/delete icon actions + a legend.

> **SPA perf (2026-06-25):** a 30s client `Cache` wraps GET in `api()` (invalidated on writes via
> `_invalidate`), `_prefetch()` warms common endpoints after login, and `_navTo` is
> stale-while-revalidate (shows the previous render instead of a spinner on revisits). The shell
> (header/tab bar) was already persistent. `sw.js` cache bumped to `camp-v2`.
- **`CamperDto`** includes `dateOfBirth` (added 2026-06-23) — available on all at-camp screens without a separate fetch.

**Backend additions made for the rebuild** (see git history): optional `StudentNote.category` (+ create-schema + enriched CSV export), `DELETE /notifications/:id`, and `contacts` added to `UpdateChurchSchema` (so the ministry-contacts editor can persist). The check-in screen handles an empty session list gracefully (note: `POST /admin/reset` re-seeds without schedule items, so no sessions exist until the schedule is configured).

## Known SPA efficiency rules (do not regress)

- `/registrants` is fetched **once** in `RENDER.home()` before the `isWide` branch — not once per branch.
- `renderOversightPulse()` does **not** fetch `/campers` — roster data (`gender`, `grade`, `medicalFlag`) comes directly from the `/checkin/sessions/:id/status` DTO.
- `renderHomeAtCamp()` fetches `/notifications` once in the initial `Promise.all`. The urgent-notice popup uses `_checkUrgentNoticesFromFeed(feed)` with the pre-fetched feed — never a second `/notifications` call.
- `renderOversightPulse()` is called without `await` from `renderHomeAtCamp()` — the home screen paints immediately and the pulse bars inject asynchronously into `#homePulse`.

## Seed demo accounts

Logins are **usernames**, not emails (`User.username`; case-insensitive). Real
contact emails live on Person/Church, separate from the login id. The demo
quick-login panel only appears on localhost/dev (gated by `_initDemoLogin()`).

| Username | Role | Church/Zone |
|----------|------|-------------|
| `victory` | church | Victory Church · Yellow |
| `gracepoint` | church | Grace Point Church · Blue |
| `riverbend` | church | Riverbend Community · Black |
| `yellowzone` | zoneLeader | Yellow Zone |
| `director` | director | — |
| `admin` | admin | — |

Local `PERSISTENCE=memory` dev/demo mode: password `demo1234` for all of the
above (`src/data/seed.ts`, never touches production — production has no user-seeding
migration beyond the single admin row in `002_seed_admin.sql`, which is seeded with a
`null` password_hash so login is rejected until an operator sets one). Passwords are
min 6 chars. Admin can create/edit accounts (editable username + uniqueness), set
passwords, and activate/deactivate (`toggleStatus`; the sole admin can't be
deactivated). **Forced password change (see "Security notes" below):** any account
whose password was set by an admin (`setPassword`) or generated by the new-year
rollover (`lastTempPasswords`) is flagged `mustChangePassword` and can do nothing but
change its own password (`POST /accounts/me/password`) until it does — this closes the
gap where an admin-set password following this documented convention (e.g. `demo1234`)
could otherwise grant a same-day login to a real account.

## Year-to-year reuse  (reset vs new-year semantics — decided 2026-06-18)

1. Admin sets up churches, accounts, accommodation, FAQ, schedule, devotionals.
2. `POST /admin/defaults` (`saveDefaults`) — snapshots the scaffold (churches, accounts,
   accommodation, FAQ, schedule, **devotionals**) as the baseline. Snapshot strips
   password hashes.
3. After camp: `POST /admin/new-year` (`newYear`) — the **routine rollover**: purges
   people + transient data (registrants/campers/notes/notifications) and **restores**
   the scaffold from the baseline snapshot; keeps the admin account + camp settings
   (bumps year, forces pre-camp). **Requires a saved snapshot.** Restored accounts come
   back password-less (snapshot strips hashes) — operator must set passwords (KNOWN RISK R9).
4. `POST /admin/reset` (`reset`) — **full wipe to bare**: deletes ALL data including the
   scaffold and every non-admin account; keeps only the single admin + camp settings.
   **No** snapshot restore (this fixed defect A4, where reset used to load the snapshot
   then never restore from it).

Both destructive ops use bulk `deleteAll()` (Supabase: `TRUNCATE`), not row-by-row deletes.

## Overnight admin batch — items 1-9,11 — deployed 2026-07-23

Large admin-requested batch (SPA + backend + **migrations 0010 & 0011**, both applied to prod
before the code push). Design: `docs/superpowers/specs/2026-07-23-overnight-batch-design.md`.
`npm run typecheck` clean, `npm run test` = **577 pass**, SPA `node --check` OK. `sw.js`
`camp-v32`→`camp-v33`. **Item 10 (proactively warning churches ~1h before a check-in window
closes) + full Web Push are DEFERRED** to `docs/superpowers/specs/2026-07-23-web-push-design.md`
(a real scheduler + push infra this serverless app doesn't have yet).

- **Item 1 — iOS password save (best-effort).** `#loginForm` (already a real `<form>` submit with
  `autocomplete="username"`/`current-password`) gained an explicit `type="text"` username and, in
  `doLogin`, a feature-detected `navigator.credentials.store(new PasswordCredential(...))` (helps
  Chrome/Edge/Android SAVE the credential; **Safari/iOS has no Credential Management API** — there
  the native form-submit heuristic is the only lever, and autofill of an *existing* saved password
  is the reliable path). Not a guaranteed fix on old iOS.
- **Item 2 — session TTL 12h → 24h.** `auth.service.ts` `TOKEN_TTL_MS`. Comments updated in
  `auth.service.ts`/`rate-limiter.ts`/`express-adapter.ts`.
- **Item 3 — de-janked attendance workflow.** `signInConfirm`/`signOutConfirm`/`_doSignIn` now
  re-render the **originating list in place** (`_refreshAfterAttendance` — reads `STACK` top; only
  refreshes the profile when the action started ON the profile) instead of hopping to `openCamper`.
  A church leader signs a student in with **one tap** (`signInPrompt` → direct `_doSignIn`, no
  modal). `_invalidate('/attendance')` now also clears `/registrants`+`/campers` so the re-rendered
  list is fresh immediately (this is the "sign-in latency" item from PLANNED-IMPROVEMENTS).
- **Item 4 — flat grouped settings page.** `RENDER.adminSettings` rebuilt as collapsible `<details
  class="setg">` sections (Camp details & dates · Check-in & timing · Account access) with
  done-state pills; one Save button still writes everything (every input stays in the DOM). **The
  Notices card was removed from Camp Settings** (owner request) → Notices + Scheduled notices now
  live in a new **Communications** group on the admin console (`RENDER.admin`). The setup wizard is
  still reachable from the console but is no longer the primary settings surface.
- **Item 5 — no leader auto-check-in on mode switch.** `admin.service.setMode` no longer bulk-signs-
  in leaders on the pre-camp→at-camp transition. Leaders start `atCamp:false` and are signed in
  manually via My-group "Late arrivals" (existing path). The at-camp→pre-camp revert block and the
  practice-first-aid-note wipe are unchanged.
- **Item 6 — audit/exports sorted by date/time.** `audit-export.service.ts`: the Daily Check-in Log
  (workbook + `exportCheckInLogCsv`) is flattened across all people and sorted by `ci.timestamp`;
  Notes & Testimonies, First-Aid Records, and Incidents sheets sorted by `createdAt`. Sign-in/out
  timeline was already chronological.
- **Item 7 — enforced church initials.** `enforceInitials()` (non-dismissible, no Skip) runs at
  login + session restore for church accounts; `_ensureInitials()` guards the attributed writes
  (check-in, sign-in/out, first-day, note, testimony) as a backstop. Initials are **auto-applied**
  everywhere and **never requested per action** (the "Your name" fields on note/testimony/sign-out
  are hidden for church; sign-in is one-tap). The header ✎ badge (`promptInitials(true)`) is the
  quick-switch when a different leader takes the device. `LEADER_INITIALS` + per-account
  `localStorage['ycp_initials_<user>']` plumbing unchanged.
- **Item 8 — home First-Day Sign-In split from Daily Check-in.** `renderHomeAtCamp`: **First Day
  Sign In** is now a **wide button between the hero and the tiles** (Day-1 only; greyed once past
  the switchover), and **Daily Check-in** is the first **tile** (greyed during the sign-in phase).
  No more single tile that switches its own label. `openCheckinFace(face)` sets a one-shot
  `_forceCheckinFace` consumed by `RENDER.checkin` so an explicit tap opens the intended face while
  greying enforces the time gate. `.tile.tdis` / `.wide-signin` / `.btn.bdis` CSS; `_ampm()` helper.
- **Item 9 — scheduled notices (in-app, lazy-fire, NO cron).** `Notification.scheduledFor`
  (migration **`0010`**, `notifications.scheduled_for timestamptz`). A future-scheduled notice is
  withheld from **every** audience feed until `scheduledFor <= now` (`getActorFeed` filter) — it
  surfaces on the next feed fetch after that instant, no scheduler needed. New service methods
  `scheduled(actor)` (own if zoneLeader, all if director/admin) + `update(actor,id,input)`
  (`UpdateNotificationSchema`; creator or director/admin); `remove` widened so a creator can delete
  their own. Routes `GET /notifications/scheduled`, `PATCH /notifications/:id`. Supabase `save`
  on-conflict set list widened to persist edits. SPA: `RENDER.compose` gained a **When** (Send now /
  Schedule) segment + `datetime-local` (converted as **Brisbane UTC+10** via `_localInputToIso`);
  `RENDER.scheduled` lists/edits/deletes pending notices; reachable from Notices + the admin console.
- **Item 11 — church check-in hard AM/PM windows.** `CampSettings.checkinWindow{Am,Pm}{Start,End}`
  (**optional** fields, defaults 06:00/12:00/12:00/22:00; migration **`0011`** adds four `text`
  columns AND sets `church_checkin_time_restricted = true` for the existing prod row). Pure
  `allowedWindowSession(days,today,now,windows)` in `checkin-sessions.ts` returns the one session a
  church may write now, or **null** outside a window / on a non-camp day. `checkin.service`
  `assertSessionAllowed` rewritten to use it (church only; no-op unless restricted) with a clear
  `ForbiddenError`. `churchCheckinTimeRestricted` now **defaults ON** (seed.ts + the prod UPDATE);
  admin can edit the windows + toggle in the settings "Check-in & timing" section.

**Migration state:** prod now has `0010` + `0011` applied (verified: `notifications.scheduled_for`
present; four `settings.checkin_window_*` columns present; `church_checkin_time_restricted = true`).
The repo's `supabase/migrations/` holds `0001`–`0011`. Next future migration = `0012`.
(**Superseded — see the 2026-07-26 section below: the repo now holds `0001`–`0015`, prod is at
`0013`, and the next migration is `0016`.**)

## Web push phases 1-3 + bundled launch-readiness batch — 2026-07-26

Plan: `docs/superpowers/plans/2026-07-26-web-push-phase1-3.md`; progress + deviations:
`.superpowers/sdd/progress.md` (read that before trusting any summary here — it records the
deferred findings and the prod-drift discovery). Backend + SPA + **migrations `0013`/`0014`/
`0015`**. `npm run typecheck` clean, `npm run test` = **634 pass / 48 files**. `sw.js`
`camp-v47`→`camp-v48`. **No push is actually sent yet** — this release builds the scheduler,
the audience rule, the subscription table and the warning detector; the fan-out is a later phase.

### Scheduled tick — Supabase `pg_cron`, NOT Vercel Cron

- **`GET /internal/cron/tick`** (`src/api/controllers/cron.controller.ts`, registered `auth:false`
  in `router.ts`) sits OUTSIDE the app's auth layer and is guarded by a shared secret instead:
  `Authorization: Bearer <CRON_SECRET>`, compared with `timingSafeEqual`. Two traps are handled
  explicitly and must not be "simplified" away — (1) `timingSafeEqual` **throws** on a length
  mismatch, so `secretMatches` length-checks first (a naive call leaks length as a 500 instead of
  a 401); (2) an **unset** `CRON_SECRET` fails CLOSED, otherwise a misconfigured deploy would let
  anyone fire the tick with an empty bearer. It throws `UnauthorizedError` rather than returning
  an error object, because the adapter only maps thrown errors to a non-200.
  This route needed `HttpRequest.headers` — the type had **no headers field at all** before this
  release (`src/api/http/types.ts`).
- **`makeCronService`** (`src/services/cron.service.ts`) is the tick body. Phase 1-3 scope is job
  B only (create in-app check-in-closing notices). It runs **288 times a day**, so it must be
  cheap when idle: the pure `warnWindow()` gate runs off settings alone and short-circuits before
  the people table is touched. Per-church failures are caught individually (`failed` counter) so
  one bad church cannot abort the rest of the tick, and dedupe detection keys off **SQLSTATE
  `23505`**, never the error message — matching `/dedupe_key/i` on the text would silently swallow
  a "column does not exist" and report success.
- **The scheduler is Supabase `pg_cron` + `pg_net`, not Vercel Cron.** The Vercel plan is
  **Hobby, whose cron is daily-only** — useless for a warning that must fire ~60 minutes before a
  check-in window closes. `vercel.json` is **deliberately unmodified**; do not add a `crons` block
  to it. The schedule lives in migration `0014` so it is in git rather than existing only as
  invisible prod state.

### Migration state (this is the bit that bites)

- **`0013_push_subscriptions.sql` — APPLIED to prod.** `push_subscriptions` table (+ RLS, 2
  indexes) and `notifications.push_sent_at` / `notifications.dedupe_key`. Verified against
  `nwfafrgojqkxylbppywo` after applying; history row reconciled to version `'0013'` (the MCP
  `apply_migration` tool records a generated timestamp — see the `0005` note above, this is still
  required after every apply on this project).
- **`0014_push_cron_schedule.sql` — APPLIED to prod 2026-07-31**, history row reconciled to
  `'0014'`. Both preconditions (route live; `cron_secret` in Vault matching Vercel's
  `CRON_SECRET`) were satisfied AND the secret match was proven by a one-off `net.http_get`
  returning 200 before the schedule was created. See the 2026-07-31 section near the top.
  The warning at the top of the file about silent 404/401s still applies to any future
  re-apply or URL change — `pg_net` is fire-and-forget and `net._http_response` is the only
  place a failure ever shows up.
- **`0015_discount_code_overrides.sql` — APPLIED to prod 2026-07-27**, immediately BEFORE the push
  that merged this whole branch to `master` (see the 2026-07-27 section at the bottom). One
  `settings.discount_code_overrides jsonb not null default '{}'`; verified present, and the history
  row reconciled from the generated timestamp `20260726211058` to version `'0015'`. It had to go in
  first because of the standing rule: **`supabase.settings` writes ALL settings columns on every
  save**, so once the code is live, any settings save (and mode switch, and new-year) fails until
  the column exists.
- **Next migration = `0016`.**
- **Prod drift found, reported, STILL NOT fixed:** migrations `0009`–`0012` are applied but recorded
  under generated timestamp versions (`20260720012415`, `20260723131647`, `20260723131721`,
  `20260723181751`). The schema is correct; only the version labels drifted, because the
  reconciliation step was skipped four times. ⚠ Consequence: a `supabase db push` would consider
  those four **unapplied and try to re-run them**. Deliberately left alone (rewriting four history
  rows is a bigger call than the one row this session introduced) — fix it as its own task.

### `canSeeNotification()` — the single notification-audience rule

`src/services/notification-visibility.ts` — extracted verbatim from `getActorFeed`, which now
calls it (`notification.service.ts:54`). It owns ALL of it: `leadersOnly` filtering (church and
firstAid excluded), zone/church scope, expiry, and the `scheduledFor > now` withholding.
**Do not reimplement any of those rules anywhere else.** The push audience resolver in a later
phase calls this same function, and the whole point of the extraction is that a leader can never
be pushed a notice they cannot see in the app. Note `dashboard.service`'s `latestNotification`
still carries its own duplicate `leadersOnly` filter (pre-existing) — if you touch audience rules,
check that one too.

### `churchesBehind()` / `warnWindow()` — `src/services/checkin-warnings.ts`

Pure, fully tested, **clock injected** (`zonedNow(tz, now)`) so there is no hidden `Date.now()`.
`warnWindow()` is the cheap settings-only gate; `churchesBehind()` does the roster work. Three
traps are baked in and must not be "cleaned up":

1. **"Checked in" is last-entry-wins**, matching `toRosterEntry` in `src/api/dto/person.dto.ts`
   exactly. A student checked in and then out is NOT checked in. Diverge from this and the push
   count disagrees with the roster the leader is staring at.
2. **AC-1**: the first camp day is **PM-only** and the last day is **AM-only**, so there is no
   AM window to warn about on day 1 and no PM window on the last day. This arrives as
   `allowedWindowSession()` returning null, which is easy to mistake for a bug.
3. **Brisbane, not UTC.** `DEFAULT_TZ = 'Australia/Brisbane'` mirrors `checkin.service.ts` and
   must stay byte-identical to it, or the reminder and the enforcement disagree.
   `WARN_LEAD_MINUTES = 60`.

### S2 — check-in queue persistence

`_ciqKey()` / `_persistQueue()` / `_restoreQueue()` (`public/index.html`). `CHECKIN_QUEUE` is now
mirrored to `localStorage` under a **per-account** key (`ycp_ciq_<username>`) on every push/shift,
and rehydrated once at boot (`window._ciqRestored` guard). Two things worth knowing:

- **Initials are captured at QUEUE time, not drain time** (`_queueEntry` stores
  `initials: LEADER_INITIALS`). A rehydrated entry must keep its original author — the ✎ badge may
  have been switched to a different leader before the queue drains.
- **Stale-session entries are DROPPED, with a toast.** On restore, anything whose `sessionId` is
  not the currently-selected session is discarded (its window has closed; the POST would 403) and
  the count is toasted so it can be reconciled against the paper sheet, rather than vanishing.
- ⚠ **Deferred finding — FIXED 2026-07-31 by server-side dedup (see below).** persistence
  introduced a narrow double-submit window. In `drainQueue` the `await` can resolve (server write
  committed) before the sync shift+persist runs; a crash in that one-tick gap replays the entry on
  reboot, and `withCheckIn` had no `(sessionId, camperId)` dedup — so that was a duplicate row in
  the compliance export. Pre-S2 the same crash simply LOST the tap. Displayed state was unaffected
  (last-entry-wins in `toRosterEntry`). The owner chose **server-side dedup** over a client
  idempotency key — `withCheckIn` is now idempotent.

### Discount-code overrides

- **`applyDiscountOverrides(people, overrides)`** (`src/services/budget.ts`, pure + tested) maps a
  discount code to a "paid in full" amount before `computeBudget` runs. SPA mirror
  `_applyDiscountOverrides` / `_saveDiscountOverride` / `_prefillDiscountOverride` on the Budget
  screen; hostile codes go through `esc(jsq())` in the inline handler.
- **New capability `budget:manage` = admin + director ONLY.** Deliberately NOT folded into
  `admin:manage` — widening `admin:manage` would have handed director the entire back office. If
  you need another finance-ish permission, add it beside `budget:manage`; do not widen the admin one.
- **`PATCH /settings/discount-overrides`** (`settings.service.ts`, asserts `budget:manage`); the
  key is present in the Supabase settings `UPDATE_COLS` list (miss that and the save is a silent
  no-op — the same trap as `elvanto_meta` back in migration `017`).

### S5 / S6 (from the launch-readiness list)

- **`assertFieldEncryptionKey()`** (`src/utils/field-crypto.ts`) is now called from `src/app.ts`
  at boot, guarded on `PERSISTENCE === 'supabase'`, right beside `assertSessionSecret()`. A
  missing/malformed key used to boot green and then 500 on every person read — indistinguishable
  from "the app is broken" at camp with no engineer. ⚠ Minor, deferred: the `try/catch` around
  `Buffer.from(raw,'base64')` is dead code (Node never throws on bad base64, it silently drops
  invalid chars) — the 32-byte length check does all the real validation.
- **`_scoped(path)`** (`public/index.html`) appends `?churchId=<ACTOR.churchId>` for church logins
  on `/registrants` and `/campers` reads, so the indexed backend fast-path (`scopedAll` →
  `findByChurch`) stops being dead code in practice. ⚠ It **must** be used for the `api()` call AND
  for any `_allCached()`/`_prefetch()` key for the same resource — `Cache.get` is an exact-key
  lookup, so a mismatch silently disables the prefetch/stale-while-revalidate hit (no error, just
  slower). Follow-up fix in the same batch: deterministic `(last_name, first_name)` ordering on all
  10 people finders, so the scoped and unscoped paths return the same order.

### Four SPA UI changes (owner request, out of plan — commit `6b454d6`)

1. **Floating arrival confirm bar.** `.fd-confirm` was `position:sticky;bottom:10px`, which pins to
   the bottom of the CONTENT, not the viewport — on the phone body-scroll shell that stranded it at
   the end of a long roster. Now `position:fixed`, `z-index:105` (between `.tabs` 100 and `.modal`
   120), with a spacer keeping the last row clear. Same rule as the documented overlay gotcha.
2. **Leaders now appear on the arrival screen.** They were filtered out of BOTH the `/campers` and
   `/registrants` feeds, so a leader missed by the bulk sign-in could not be signed in there at all.
   They badge "Leader" instead of "Yr -" and the grade filter gains a Leaders option. They stay
   excluded from the twice-daily check-in roster — that is a different screen, do not "fix" it.
3. **Incidents moved off the home tile grid** to a slim full-width link, below "Testimonies & Notes"
   and above the Notices summary. **⚠ REVERTED 2026-07-27 — this was a MISREAD of the request.**
   What the owner wanted moved below Testimonies & Notes was the urgent-alert *banner*, not the
   menu tile. Incidents is a tile in the grid again; see the 2026-07-27 section below.
4. **Schedule editor time boxes tightened** — column `80px`→`64px`, gap `8`→`6px`, and the time
   input itself on `--t-xs` with 4px/2px padding, centred. See the CSS gotcha below for why this
   took several attempts.

### ⚠️ CSS GOTCHA — `.sched-row .sr-t` vs `.sched-row .fld` are EQUAL specificity

Both are (0,2,0). The time input carries **both** classes (`<input class="fld sr-t" type="time">`),
so **whichever rule appears LAST in the stylesheet wins** — and a `.sr-t` rule placed ABOVE
`.sched-row .fld` is **silently dead**. That is exactly why three separate attempts to shrink the
schedule time boxes had no visible effect: each one narrowed the grid track while the `.fld`
padding/font below it kept overriding the `.sr-t` sizing, and `overflow:hidden` on
`.sched-row input` hid the overflow instead of the box actually fitting. The `.sr-t` block now
sits **after** `.sched-row .fld` (~line 383 in `public/index.html`) with a comment saying so.
**Keep it there.** If `.sr-t` ever needs to win from anywhere, raise its specificity
(e.g. `input.sr-t.fld`) rather than relying on source order again.

### Also

- `public/sw.js` is now **`camp-v48`** (v45→v46 for the early SPA batch, →v47 for the schedule-time
  fix, →v48 here for the queue persistence + discount-override UI + `?churchId` scoping). Standing
  rule unchanged: `public/index.html` changing means `CACHE` must step, because iOS standalone PWAs
  are documented as lazy about picking up a new worker.
- `API_RE` in `sw.js` was **deliberately NOT extended** with `push` or `internal`. Nothing in the
  SPA calls a `/push` endpoint yet (later phase), and the cron tick is server-to-server — it never
  passes through a service worker.

## Small SPA fix batch + the web-push branch finally shipped — deployed 2026-07-27

**This is the release that actually put the 2026-07-26 web-push/launch-readiness work into prod.**
Everything described in the section above had been sitting unmerged on `feat/web-push-phase1-3`
(9 commits) while `origin/master` — and therefore production — was still at `369437c`. This release
applied migration `0015` to Supabase FIRST, then merged the branch plus four owner-requested SPA
fixes to `master`. `npm run typecheck` clean, `npm run test` = **634 pass / 48 files**, SPA
`node --check` OK. `sw.js` `camp-v48`→**`camp-v49`**. All four fixes are **SPA-only**
(`public/index.html`) — no backend, schema or migration change beyond applying `0015`.

> **Process lesson worth keeping:** CLAUDE.md described the 2026-07-26 batch in the past tense while
> none of it was on `master`. Prose in this file records what was *built*, which is not the same as
> what is *deployed* — when reloading context, check `git log origin/master..HEAD` before assuming
> a documented feature is live.

1. **Incidents is a menu TILE again; the ALERT BANNER is what moved.** The 2026-07-26 change
   (commit `6b454d6`, item 3) demoted the Incidents tile to a slim full-width link — a misread of
   the owner's request. Reverted: `canManageIncident()` pushes the tile back into the `.tiles` grid
   in `renderHomeAtCamp` and `incidentsLinkHtml` is deleted. What was actually meant to move is
   **`_alertBannerHtml(feed)`** — the red strip with the **"Got it"** acknowledgement button — which
   was at the very head of the Home markup and now renders **immediately above the "Notices"
   heading** near the bottom, on **both** home variants (at-camp `renderHomeAtCamp` and pre-camp
   `RENDER.home`). Note this moves *every* urgent alert, not just incident-raised ones — there is
   deliberately only one alert surface (see the 2026-07-26 notes), so human-sent urgent notices
   move with it.
2. **Testimony student picker = arrived students only.** `RENDER.testimonies` no longer merges
   `/registrants` into the dropdown — it reads `/campers` alone (which is `isCamper`, i.e.
   lifecycle ≥ `arrived`). **This deliberately reverses the earlier "CH-2" fix** that added
   pre-arrival youth because a church's list "looked empty". Someone who signed in and later
   signed out is still selectable (a testimony can be logged after they head home); someone who
   never arrived is not. The screen is only reachable from the at-camp home tile, so a
   sparse-looking list pre-camp is correct, not a bug. **Do not re-add the `/registrants` merge**
   without checking with the owner — it has now been flipped in both directions.
3. **All three Camp Settings sections start collapsed.** `RENDER.adminSettings`'s first
   `<details class="setg">` lost its hardcoded `open`. Cosmetic only — every input still lives in
   the DOM regardless of collapse state, which is exactly why the single `saveSettings()` PATCH
   still writes all of them (that invariant is load-bearing; don't "optimise" it by rendering
   section bodies lazily).
4. **The bottom-nav Check-in/Sign-in label now follows the phase.** `navModel._ci()` always
   computed the right label, but `buildTabs()` only ran at login and on a mode switch — so the tab
   froze at whatever phase was current when the session started and still read **"Sign-in"** after
   the app had moved into check-in. New **`_syncNavPhase()`** (declared beside `campPhase()`)
   caches the last-built phase in `_navPhase` and re-runs `buildTabs()` only on a real change.
   Called from `RENDER.home` (covers the Day-1 switchover time passing), `switchPreviewPhase()`
   (the preview toggle, which never rebuilt the nav at all) and `saveSettings()` (an admin pinning
   `checkinPhaseOverride`). `RENDER.home`'s `/settings` re-sync **also now adopts
   `checkinPhaseOverride` + `checkinSwitchoverTime`** — previously it copied only `campMode`, so an
   admin's phase change never reached an already-open session at all. The **desktop sidebar never
   had this bug** (`_renderWideNav` runs on every `paint()`); it was bottom-nav-only.

## Session-restore auth fix — deployed 2026-07-27

Reported symptom: *"I loaded in and saw a 'Missing bearer token' error; on refresh it had fixed."*
Confirmed from the Vercel runtime logs (five 401s in one tick — `/home`, `/notifications`,
`/checkin/sessions`, `/accounts/churches`, `/accounts/users`, i.e. exactly `_prefetch()`'s set,
with **`/settings` conspicuously absent**). Two independent defects, both in `public/index.html`,
both fixed. `sw.js` → `camp-v50`.

1. **`_tryRestoreSession()` validated nothing.** `GET /settings` is deliberately **`auth: false`**
   (`router.ts:82` — the login screen renders camp name/branding before anyone has a token), and it
   was the only call the restore path made before hiding the login screen. So an **expired token
   passed the gate**: the app rendered as if signed in and only collapsed a tick later when
   `_prefetch()`'s authenticated calls 401'd. Restore now does **`await api('/auth/me',{noCache:true})`**
   — an `auth: true` route — before touching `/settings`. On failure `_doFetch` already runs
   `sessionExpired()` and the existing `catch` clears `localStorage`, so the next load is a clean
   login screen. **Never use an `auth:false` route as a session probe**; `/settings` and `/setup`
   are the two that look tempting.
2. **The 401 handler was guarded on `&& TOKEN`.** `_prefetch()` issues five requests in the same
   tick. The first 401 called `sessionExpired()`, which nulls `TOKEN` — so the remaining four fell
   *past* the guard and threw the server's raw message, `Missing bearer token`, into a toast. That
   is the string the owner saw. The guard is now `path.indexOf('/auth/login')!==0`:
   `sessionExpired()` is idempotent so a cascade collapses into one banner, and `/auth/login` stays
   excluded because **its** 401 means *wrong password* and must keep its own message on the form.

Not a bug, worth knowing: sessions are **stateless HMAC, 24h TTL, no sliding refresh**
(`TOKEN_TTL_MS`, `auth.service.ts:10`). Everyone re-logs in daily; the fix just makes that land as
"Session expired — please sign in again." instead of a raw error.

### Still outstanding (owner decision)

- **Migration `0014` (pg_cron push tick) is applied to nothing.** Prerequisite 1 is now satisfied —
  `GET /internal/cron/tick` is live in prod (verified: returns 401 without the bearer, so the route
  is registered). Prerequisite 2 is not: it needs `CRON_SECRET` set in Vercel **and** the same value
  in Supabase Vault as `cron_secret`. **The Vercel MCP server has no env-var tool**, so the Vercel
  half must be done by hand (dashboard, or `vercel env add` once the CLI is installed); the Supabase
  half can be done over MCP. Note this is a **Supabase pg_cron** schedule, not a Vercel cron —
  `vercel.json` has no `crons` key on purpose, because Hobby-plan Vercel crons are daily-only and
  the check-in-window warning needs `*/5`.
- **Migration history drift on `0009`–`0012`** (recorded under generated timestamp versions), so a
  `supabase db push` would try to re-run them. Unchanged.
