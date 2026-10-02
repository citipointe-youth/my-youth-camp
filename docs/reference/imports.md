> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: imports

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

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

