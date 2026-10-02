> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: budget money

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## Registrant export: six override/accommodation columns appended — 2026-09-23

Owner request. **Backend only** (`export.service.ts` + `container.ts`) — no SPA, schema or
migration change, so **no `sw.js` bump**. `npm run typecheck` clean, `npx vitest run` **1122 pass
/ 65 files** (+3). "Export all" and "Export filtered" (`/export/registrants`) now append, AFTER the
unchanged Elvanto block (`EXPORT_EXTRA_HEADERS`):
`Church Override (individual)` (the `formChurch` of any `allocation_overrides` row — both
`override` and `unallocated` kinds — i.e. what the form said) · `Accommodation Override
(individual)` (`Person.accommodationOverride`) · `Accommodation Override (church)`
(`Church.accommodationOverride`) · `Registered Accommodation` (`accommodationKindRaw` — ⚠ already
has the church override baked in at import; the original ticket type is not stored anywhere) ·
`Accommodation (final)` (effective `accommodationKind`) · `Discount Code (export)`.

- ⚠ **The code column is deliberately NOT named `Discount Code`** — the Form importer reads that
  header (`import.service.ts` `field(row,'Code','Discount Code',…)`), so re-importing an exported
  file would write codes back. No extra header may collide with a name the importer reads.
- `makeExportService` takes the allocation-override repo as an **optional** third arg; both
  `container.ts` paths pass it. Omit it and column 1 is silently blank.
- **Follow-up, same day (`sw.js` → `camp-v123`, SPA-only):** the Data tab's Church dropdown
  gains **"Unallocated (N)"** (value `UNALLOCATED_ID`), shown only when someone is unallocated.
  No backend change — the sentinel already works in `dataApply` and in `/export/registrants`'s
  `churchId` filter, so "Export filtered" on it yields just the unallocated people.

## AU phone normalisation — two people were two records each — 2026-09-09 (2nd)

Deploy 2 of the import-money batch; **Deploy 1 (`camp-v111`, migration `0023`) is a hard
prerequisite — see the warning below.** Backend only: `person-matching.ts` + `import.service.ts`.
**No schema, no migration, no SPA change, so NO `sw.js` bump** (still `camp-v111`).
`npm run typecheck` clean, `npx vitest run` **1083 pass / 64 files** (was 1076; **+7**).

### `replace(/\D/g,'')` is not a normalisation, it is punctuation-stripping
`phoneKey` (Form import) and `phoneDigits` (Ticket/Invoice imports) were both a bare digits
filter. Elvanto's export contains the same person's number written both ways, so
`+61424498183` reduced to `61424498183` while `0424498183` reduced to itself. They never
compared equal, `pickMatch` found no phone match, and the create branch made a **second
person**.

Measured on the real 2026-09-08 export: **708 person records from 706 humans.** Chloe Blom and
Daniella Daniel were duplicated exactly this way — +2 headcount, **+2 phantom classroom beds** in
the allocation — and **neither carried a review flag**, because every importer believed it had
found a clean unique match. The bug's own symptom is the thing that hides it.

> 🔴 **THIS FIX ALONE WOULD HAVE DESTROYED MONEY, AND THE DEPENDENCY RUNS THE OPPOSITE WAY TO
> INTUITION.** Their payments landed *because* they were split: one person record, one
> `invoice_number`, so each record held one of their two invoices and both matched tier 1.
> Merge them without `Person.invoiceNumbers` (Deploy 1, migration `0023`) and the second number
> is overwritten exactly as Dylan Foo's was — verified by ticket-file order that the survivors
> would be `022293`/`022267`, orphaning **both $40 upgrade invoices, both parent-billed**, so
> tier 2 could not rescue either. **$80, silently.** The "obviously correct" fix was the
> dangerous one; the ordering is the whole story.

### The rules are the ones in the file, not hypotheticals
Measured across all three 2026-09-08 CSVs before writing any of it:

| shape | rows | → |
|---|---|---|
| `04xxxxxxxx` | 2058 | unchanged (already canonical) |
| `+61 4xx xxx xxx` | 35 | `04xx xxx xxx` |
| `61xxxxxxxxx` (no `+`) | 4 | same |
| `+61 (0) 4xx xxx xxx` | 4 | the bracketed `0` **is** the national prefix |
| bare 9-digit `4xxxxxxxx` | 23 | leading zero restored |

- ⚠️ **The 9-digit rule changes NO current grouping** — 706 records with or without it, verified
  over all 713 form rows. It is in anyway because a 9-digit string starting `4` is unambiguously
  an AU mobile, so leaving it is the identical bug lying in wait for the first of those 23 people
  to re-register. That is the only speculative line here and it is deliberately the only one.
- ⚠️ **`046633296` (9 digits, starts `04`) is NOT normalised.** It is malformed, not a mobile
  missing its zero, and inventing a digit for it would be guessing at a real person's identity.
  Junk (`123`, `0402`) stays junk for the same reason.

### One copy of the rule, at last
`import.service.ts` no longer carries its own `phoneKey`; it imports `phoneDigits`. The two were
already documented as *"same semantics as import.service.ts's phoneKey"* — a comment is not a
mechanism, and two copies of a matching rule is how one importer starts matching a person
differently from another.

### No data operation, and that was checked, not assumed
The delete-absent sweep removes the loser by itself: both rows key to the same normalised
number, so only one is in `seenIds`. Confirmed against prod before relying on it — both
duplicates had **0 notes**, `lifecycle: registered`, and no `accommodationOverride`,
`amountPaidOverride` or `refundAmount`, so `isProtected` is false and nothing blocks the delete.
Their `allocation_overrides` rows are pruned by the same sweep.

**It takes effect on the next Form import, not on deploy** — no code change rewrites stored data.

### Verified by reverting, not asserted
Restoring the naive `replace(/\D/g,'')` fails **5 tests** across `person-matching.test.ts` and
`import.service.test.ts`. The integration tests seed prod's exact two-record state and assert the
pair collapses to one with `deleted: 1`, plus a negative case proving two genuinely different
people sharing a name still stay apart.

## Two-ticket money, the shared-invoice overwrite, the `upgrade` tag & a refund warning — migration `0023` — `camp-v111` — 2026-09-09

Backend + SPA + **migration `0023`** (`people.invoice_numbers text[]`, additive/nullable, **no
backfill** — the nightly Ticket List import repopulates it). Found by an audit of the 2026-09-06
warnings email against the 2026-09-08 exports, prompted by the owner: *"Dylan Foo should be
tracked in the budget as having spent the standard $190."* He was tracked at **$150**.
`npm run typecheck` clean, `npx vitest run` **1076 pass / 64 files** (was 1065/64; **+11**), `node --check` OK on the SPA body
(range **974–10187**, re-derived — do not trust that number on a future edit) and `sw.js`.
`sw.js` `camp-v110`→**`camp-v111`**.

### 🔴 A PERSON HELD ONE `invoice_number`, AND A SECOND TICKET OVERWROTE IT
The "bought the wrong ticket, re-buy the right one with a difference-covering code" flow makes
**two tickets with two invoices**. `ticket-import.service.ts` merges `invoiceNumber` through
`mergeOwnedFields` (last non-blank wins), so one of the two numbers was simply gone — and tier 1
of the Invoice import matches on exactly that field. The orphaned invoice fell to tier 2, the
**billing-contact name**, which only works when the payer IS the registrant.

> ⚠️ **THAT IS WHY ONLY ONE PERSON WAS VISIBLY BROKEN, AND IT MADE THE BUG LOOK LIKE AN EDGE
> CASE.** Of the seven two-ticket people in the 2026-09-08 export, Froneman / Nel / Gao paid
> under their own names, so tier 2 caught both invoices and summed them; **Blom and Daniel were
> saved by a DIFFERENT bug** — the `+61` phone split duplicates them into two person records, so
> each record carries one invoice (see STILL OPEN below); Riverstone is the shared-invoice case
> below. **Dylan Foo was the only one with a parent-paid upgrade and no duplicate to hide it**,
> and his $40 invoice `022422` is the "1 unmatched invoice" that had been sitting in the nightly
> email for days.

Fixed by recording **every** invoice number the Ticket List gives a person into the new
`invoiceNumbers`, and indexing all of them in tier 1 (the scalar is still indexed as a fallback
for rows written before the column existed). Rebuilt from the file each run, never appended to
the stored array — a ticket that goes away must drop its invoice back off, the same rule as
`moneyByPerson`.

### 🔴 THE SHARED-INVOICE PASS ASSIGNED MONEY, WHILE THE SINGLES PASS ACCUMULATED IT
The two passes exist for a good reason (prices are learned from single-person invoices before
family ones are split — do **not** fold them back into one). But the singles loop folded money
into `moneyByPerson` while the deferred loop did `incoming.amountPaid = paidParts[m]`, a plain
assignment. **A person on their own invoice AND a family invoice silently lost the single one,
with no `multiple-invoices-summed` warning — because the two passes counted in different
structures, so neither ever saw a second row.**

Prod fingerprint (Ava Riverstone): `amount_paid 190, discount_amount 0, discount_code
YC26BNEINTERN`. The **code** survived from the singles pass; the **$190 discount it granted was
overwritten** by her share of a $570 family invoice. A code with no value against it is the only
trace this bug leaves. Both passes now go through one `accumulate()`.

### The `upgrade` tag — a code that is recognised and worth exactly zero
An upgrade code discounts a **second** ticket to offset a **first** that was paid in full, so
nothing was foregone. Measured 2026-09-08: `YC26CLASS` (4 uses) + `YC26CLASSFULL` (1) reported
**$770 of "discount given" against $0 of actually foregone revenue**, and both were tagged
`discount`.

- `DiscountTag` gains `'upgrade'`; `TicketClass` gains `tent-upgrade`/`classroom-upgrade`.
- ⚠️ **It changes REPORTING, never the money.** `receivedBeforeRefund`'s cascade was always
  right for these people (amountPaid → registrationCost). Only `sponsor` ever needed a forcing
  rule; adding a second would re-open the 2026-08-05 class of bug.
- ⚠️ **Tagging it is what keeps it OUT of `unclassified`.** `isUnclassifiedDiscount` returns
  false the moment `discountTagFor` recognises a tag, and `SPONSOR_TAGS` excludes `upgrade`, so
  it is skipped by both branches and contributes $0. *"Recognised and worth zero"* and
  *"unknown"* are different answers — leaving these codes untagged would report them as money
  nobody can account for, which is the 2026-09-06 unclassified-codes problem in new clothes.
- 🔴 ⚠️ **`settings.service.ts` `updateDiscountCodeTags` HAS ITS OWN WHITELIST, AND IT WAS
  MISSED ON THE FIRST PASS.** It filters submitted tags against a hard-coded list and rebuilds
  `clean` as the WHOLE map — so a value it does not know is not merely rejected on its own edit,
  it is **erased from every code** the next time anyone changes any tag on the Budget screen,
  silently. The prod re-tag survived only because nothing had been re-tagged in between.
  **Adding a value to `DiscountTag` REQUIRES adding it there too.** Pinned by
  `settings.service.test.ts` and verified by reverting: removing `'upgrade'` from the whitelist
  fails that test.
- The upgrade card's `if(cls!=='classroom')return` now also admits `classroom-upgrade`. It had
  excluded every tagged class, which **emptied "Upgrade paid" of the only two people in prod who
  verifiably had paid**, while leaving three who had paid invisibly under "outstanding".

### `refund-likely` — paid, then given a free place
An intern or leader who registers and pays, and only afterwards learns their ticket is covered.
Elvanto writes a second, fully-discounted ticket; the first payment sits there with nothing
pointing at it. Prod: **Ava Riverstone and Jake Nel, $190 each.**

- Detected from a per-person **ledger of every invoice that resolved to them, recorded in BOTH
  passes** — Ava's paid place is a share of a family invoice, so a singles-only check misses her.
- A free place is one whose **discount covers the whole ticket**, not merely `amountPaid === 0`.
  An invoice that is simply unpaid is money still owed, not a comp, and must not read as one.
- ⚠️ **It does not set `needsReview`, and it does not touch the money.** That flag means *"this
  import is unsure what it imported"*; this import is certain — it is the **camp** that has a
  decision to make. The payment really did arrive and keeps counting until someone records a real
  refund (`refundAmount`, migration `0022`).
- ⚠️ **A refund-likely person IS still `needsReview`, and that is not this warning doing it.**
  You cannot be a refund-likely case without holding two invoices, and `multiple-invoices-summed`
  (2026-07-28) flags anyone who does, for its own unrelated reason. The two are structurally
  coupled, so a test asserting `needsReview === false` on this shape asserts the wrong thing —
  it cost a round trip during this build. What the test pins instead is ATTRIBUTION: the flag
  carries the multi-invoice REASON and never a refund one.

### `accommodation-church-override` is now the "undetermined upgrade" group, and sorts LAST
New severity **`'note'`**, ranked below `info`: *a standing fact the import cannot resolve and is
not asking anyone to fix.* Use it only where "undetermined" is the correct final answer, never as
a quieter `info`.

A blanket church override (`Citipointe Brisbane (Carindale)` → classroom) is the only thing
separating *"bought a tent ticket, sleeping in a classroom"* from *"paid for an upgrade"*, and it
**cannot tell them apart** — it applies to the whole church regardless of what anyone paid. All 12
of the tent-ticket/classroom-bed cohort are at that one church. Owner's call: *"they may or may
not pay an upgrade depending on their situation, so don't lock it to either."*

- ⚠️ **THE CODE STRING IS UNCHANGED ON PURPOSE.** Only the label, severity and message moved —
  all three are explicitly free to change; the code is the out-of-repo contract with the upload
  machine. A new parallel code would have double-reported the same rows.
- The message now **names the person**. The old one (`Accommodation "tent" overridden to
  "classroom"`) identified nobody, which made the list unusable as something to work through.
- ⚠️ **`ticket-import.service.test.ts` asserted on the WORD "overridden"** and broke on the
  reword — pattern-matching the prose is exactly the coupling `code` exists to remove. It now
  asserts the code.

### Verified against the real 2026-09-08 exports, not only unit tests
An offline harness replayed the three real CSVs through a model of the fixed pipeline
(a simulation, **not** a live import):

| | before | after |
|---|---|---|
| unmatched invoices | 1 (`022422`, $40, Dylan Foo) | **0** |
| money landing on people | $102,040 | **$102,080** |
| tier-2 (billing-name) matches | 4 | **0** |
| `refund-likely` | — | **2** (Nel, Riverstone) |

$102,080 is the Billing Contacts file's own `Amount Paid` total, so the app now accounts for
every dollar in the export. **Tier 2 falling to zero is the quiet win**: every invoice matches on
the authoritative number, so the billing-name heuristic — which can attribute a payment to the
wrong sibling — no longer runs at all on real data.

### ⚠️ STILL OPEN — read this before touching the phone matching
- ✅ **FIXED in the 2026-09-09 (2nd) entry above — read its ordering warning before touching
  this again.** `+61` vs `0` splits one person into two: `phoneKey`/`phoneDigits` were
  `replace(/\D/g,'')`, so `+61424498183` and `0424498183` do not match; Chloe Blom and Daniella
  Daniel are two person records each (+2 headcount, +2 phantom classroom beds, neither flagged).
  **FIXING THIS ALONE DESTROYS MONEY** — their payments land today *because* the split gives each
  record its own invoice number. Merged, the second number is overwritten exactly as Dylan's was.
  It is safe **only** on top of this push's `invoiceNumbers` fix; verified by file order that the
  surviving numbers would be `022293`/`022267`, orphaning both $40 upgrade invoices, both
  parent-billed. Deploy 2. **No data operation needed** — the delete-absent sweep removes the
  loser (checked: 0 notes, nothing `isProtected`).
- **`Total Due` is never read.** Invoice `022709` (Sebastian Hans) is $340 of tickets with $170
  paid and **$170 still due**; the split writes $85/$85 across two people, unflagged, and the debt
  appears nowhere. 1 of 614 — but it is the only invoice in the file where
  `tickets − discount ≠ paid`.
- **The upgrade card still shows the Carindale cohort as "outstanding"** ($320 across 10 people).
  The owner chose to surface this as the last warning group rather than as a Budget bucket, so the
  card is unchanged — but it still asserts money is owed that may not be.
- **`NOOSASPONSOR100`** appeared in the 2026-09-08 export untagged — $190 excluded from the
  sponsorship total until someone classifies it on the Budget screen. Data, not code.

## Budget card clipping, unclassified sponsorship on screen, director-only shortcuts, Data search, sheet tooltips — `camp-v110` — 2026-09-06

Six-task batch (`docs/superpowers/plans/2026-09-06-budget-data-screen-fixes.md`), five owner-
reported defects plus the terminal cache/docs task. **SPA-only** (`public/index.html`) for the
five fixes; this task touches only `sw.js`/`CLAUDE.md`/`debug.md`. **No schema or migration
change** — next migration is still `0023`. `npm run typecheck` clean, `npx vitest run` **1065
pass / 64 files** (UNCHANGED from the prior `camp-v109` entry below — no `src/**` file was
touched by this batch), `node scripts/budget-xlsx-harness.js` **142 ok** (unchanged, same
reason), `accom-export-harness.js` and `filter-persist-harness.js` both clean, NEW
`scripts/data-search-harness.js` **28 checks, all ok**. `node --check` OK on the SPA body (range
**974–10164**, re-derived — do not trust that number on a future edit) and on `public/sw.js`.
`sw.js` `camp-v109`→**`camp-v110`**.

### The `.budchurch` 1200px cap — clipped, not scrolled, and it was latent in all five card types
`.budchurch-body` was a max-height accordion: `max-height:0;overflow:hidden` collapsed,
`.budchurch.open .budchurch-body{max-height:1200px}` open — **with no `overflow-y` at all**. Past
1200px of content the rows below the cap were simply gone, not reachable by scrolling. This hit
the Discount codes card first (19 real codes in prod render well past 1200px) but was equally
latent in the other four `.budchurch` cards — Sponsorship, the ticket-prices gate, upgrade
tracking, and every per-church card — the moment any of them grew enough rows. Fixed by dropping
the cap to `max-height:none;overflow:visible` when open, for all five.

> ⚠️ **The open/close ANIMATION WAS DELIBERATELY TRADED AWAY, and this is a one-way door.**
> `max-height:none` is not an animatable CSS value, so a card now snaps open/closed instead of
> sliding. This was a conscious choice — a card that hides data past a hardcoded cap is a
> correctness bug; a card that doesn't slide is cosmetic. **Do NOT "restore the animation" by
> reintroducing a finite `max-height` cap** (even a much bigger one, e.g. `20000px`) — that
> recreates the identical clipping bug at a larger N, which is exactly the failure this fix
> exists to close. If the animation is ever wanted back, it needs a JS-measured height (e.g.
> `scrollHeight` written into an inline `max-height` on open), not a CSS constant.

### Unclassified sponsorship money is now on screen, not only in the export
`unclassifiedCount`/`unclassifiedTotal`/`unclassified` (the untagged-but-discounted rows) have
been computed by `computeSponsorSummaryClient` since the `camp-v109` batch below, but were
rendered **only** on the export's Summary sheet — a figure deliberately excluded from every
on-screen total was therefore invisible on the one screen a director actually looks at. A
warnbox naming the untagged codes and their excluded total now renders inside the Sponsorship
card itself (`public/index.html:5008` area). This follows the same **REPORT, NEVER INFER**
doctrine already in this file: the box reports what invoice evidence shows and excludes it from
every total; it does not map a discount percentage onto a tag.

- **The card's gate widened from `spon.count` to `spon.count||spon.unclassifiedCount`.** Gating
  on `count` alone meant a camp where every discount code is currently untagged rendered **no
  Sponsorship card at all** — hiding the warning in exactly the camp that most needs to see it
  (a camp with zero tagged codes has the whole ask sitting in the unclassified bucket). The
  widened gate is what makes the warnbox reachable in that state.

### Data screen: director-only shortcuts, and why they must not be deleted outright
The Data screen's two shortcut buttons (Data Import, Records & Export) are now gated on
`ACTOR.role==='director'` (`public/index.html:8930-8932`, the `navCard` block) rather than shown
to everyone who reaches the screen. ⚠️ **These buttons MUST NOT be deleted outright.**
`navModel` gives director **no `import` tab and no Records & Export extra** in either camp mode
— admin reaches both from the Admin console, but director's *only* route to either screen is
this pair of buttons. If they are ever removed (e.g. as "redundant with admin's console tiles"),
give director a real nav route to both screens FIRST, or director loses the ability to import
data or pull exports entirely, with nothing in `tsc`/`vitest` able to catch the gap.

### `_dataNorm`/`_dataDigits`/`_dataMatchQuery` are extracted BY NAME — never rename them
New free-text search box on the Data table (`public/index.html:8973-8990`), debounced and ANDed
with the existing dropdown filters, matching name/church/gender/grade/reg type/discount
code/mobile/medical/dietary/other-medications/blue-card/review-reason. Phone matching compares
digits only (`_dataDigits`), so `0412345` matches a mobile displayed as `0412 345 678`. These
three functions are extracted **by their literal names** in the new
`scripts/data-search-harness.js`, the same contract the budget harness already has with
`_budScopeRows`/`_budExportRows`/etc. — that harness was silently dead for a month after a
rename-shaped change (see the `camp-v109` section below). **Add parameters to these three
freely; NEVER rename them**, or the harness throws instead of testing anything, with no signal
on the Data screen itself that the search regressed.

### "Export filtered" is a SERVER export and has no free-text parameter — it now asks, not silently widens
`dataExport(true)` forwards the four dropdowns as query params to `/export/registrants` — it has
no `q` parameter, so it **cannot** honour the new search box. Silently exporting the
dropdown-filtered set (wider than what the search box shows on screen) would be exactly the
"reconciles perfectly but is wrong" failure this repo keeps recording. It now calls
`confirmSheet` to ask before exporting whenever a search term is active, rather than silently
handing back a wider file. ⚠️ **If a search-aware export is ever wanted, add a `q` param
SERVER-side and forward it** — do not re-implement `_dataMatchQuery`'s predicate a second time
against the export path, which is the fourth-copy-of-a-rule failure this file already warns
about elsewhere (`dataApply`/`_dataMatchQuery` is the second copy already; a third in the export
path would be the third).

### `.htip-pop` clipped by `.sheet`'s `overflow-y:auto` — and why `sheetTop` defaults to `-Infinity`, not `0`
`.htip-pop` is `position:absolute` inside `.sheet`, which is `overflow-y:auto` — so `_clampTip`'s
existing `flip-up` branch, which nudges a tooltip bubble upward when it would overflow the
bottom of the viewport, could push the bubble **above** the sheet's own content top edge, where
the sheet's scroll container clips it. Reported on the Data screen's Needs-review sheet, whose
`helpTip` sits in the `<h3>` with no room above it inside the sheet at all. **Downward overflow
was never a problem — the sheet itself scrolls** to reveal a tooltip that runs off the bottom;
only the upward `flip-up` case escapes the box, because flipping up moves the bubble toward the
sheet's fixed (non-scrolling-past) top edge rather than into more scrollable space.

`_clampTip` (`public/index.html:1548-1552`) now also measures the nearest `.sheet`'s
`getBoundingClientRect().top` and folds it into the flip-up decision.

> ⚠️ **`sheetTop` defaults to `-Infinity`, and this is deliberate — do not "simplify" it to `0`.**
> With `-Infinity`, the added `sheet`-aware clause (`btnTop-sheetTop>r.height+m`) is a **no-op**
> for any tooltip outside a sheet, because no real `btnTop` can be more than infinitely far below
> `-Infinity` — so behaviour on every ordinary (non-sheet) screen is byte-for-byte the original
> condition. If the default were `0` instead, the clause would silently start comparing every
> non-sheet tooltip's button position against the **viewport top**, changing ordinary screens'
> flip-up behaviour as an unintended side effect of a fix that was only supposed to touch sheets.

### Needs on-device eyeballing — `tsc`/`vitest` cannot prove any of this
- All five `.budchurch` card types open/close **without an animation** (the traded-off cosmetic)
  and, more importantly, that every row in a long card (19 discount codes) is actually reachable
  now — a phone or a laptop needs to scroll a genuinely long open card and see the last row.
- The Sponsorship card's new unclassified warnbox, in a camp where every code is untagged (the
  widened-gate case) and in a camp where some codes are tagged and some are not.
- Director login: the two Data-screen shortcut buttons are present and both navigate. Admin/
  church/zoneLeader/firstAid logins: confirm nothing changed for them (the buttons were never
  role-gated any other way before this).
- The Data search box: type a partial name, a partial phone with and without spaces, and confirm
  it narrows the table live and combines correctly with the existing dropdown filters.
- "Export filtered" with an active search term: confirm the new confirm-sheet appears and that
  cancelling it does not download anything.
- The Needs-review sheet's `?` tooltip, specifically near the top of the sheet on a phone screen
  — confirm it no longer renders cut off above the sheet's visible area.

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
- **`sw.js` stayed at `camp-v109` for this whole branch — one bump per DEPLOYED version, not per
  commit.** The standing rule is that `public/index.html` changing means `CACHE` must step, and it
  did: prod (`origin/master`) served `camp-v108` when this branch started, and it shipped
  `camp-v109`. ⚠️ **CORRECTED 2026-09-06 — the claim that `v109` "has never been deployed" was
  stale the moment it was written and is now verified false**: `curl -s
  https://my-youth-camp.vercel.app/sw.js | head -1` returned `const CACHE = 'camp-v109';` on
  2026-09-06, i.e. prod had already picked it up. The very next batch (the budget-card-clipping /
  data-search / sheet-tooltip fixes, same day — see the section at the top of this file) therefore
  correctly steps to **`camp-v110`**, per the same rule this bullet states: one step per deployed
  version. Do not read an old "not yet deployed" note as still current — always `curl` prod before
  choosing the next version number.

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
**Measurement taken 2026-09-05:** only **5 of 19** discount codes in prod use were classified in
`settings.discount_code_tags` (`KH100`, `YC26YP`, `YC26EFT`, `YC26CASH`, `VICTORY50`). The other
14 were silently excluded from `computeSponsorSummary`/`computeSponsorSummaryClient`, which only
ever walked `sponsor`/`discount` tags — an untagged code, however deep the discount on its
invoices, contributed **nothing** to the reported sponsorship gap.

⚠️ **CORRECTED 2026-09-06 — `YC26BNESPONSOR` was classified on or before 2026-09-06 and is no
longer one of the untagged rows.** Prod's `settings.discount_code_tags` now holds **six** entries
— the original five above, plus `YC26BNESPONSOR: sponsor`. **13 codes remain untagged** (the table
below, minus that row). Prod was also re-queried directly on 2026-09-06: the `people` table
carries **33** rows with `YC26BNESPONSOR` (not the 30 measured on 2026-09-05), all with a discount
recorded, the code stored as exactly `YC26BNESPONSOR` (length 14, no whitespace or case variance)
— so the classification now correctly picks up all 33. The row below is kept for the historical
2026-09-05 measurement, not deleted, and is marked **CLASSIFIED** rather than removed.

| Code | People | $ gap | Discount |
|---|---|---|---|
| `YC26BNESPONSOR` — **CLASSIFIED 2026-09-06 as `sponsor`; 33 people, not 30** | ~~30~~ | ~~$5,700~~ | 100% |
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

