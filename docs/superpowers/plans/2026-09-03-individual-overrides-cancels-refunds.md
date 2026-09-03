# Individual Overrides + Registration Cancels/Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-student accommodation and amount-paid overrides plus registration cancel/refund handling to the Data Import screen, without any importer ever touching them.

**Architecture:** Five additive nullable columns on `people`. The accommodation override is resolved **once** on the read path in the Supabase people mapper (`accommodationKind = accommodation_override ?? accommodation_kind`), so ~14 existing read sites pick it up unchanged. A companion raw carrier (`accommodationKindRaw`) keeps the write path writing the importers' value, never the resolved one. Money overrides land in `personValue` (server) and its SPA mirror. Cancel reuses `lifecycle: 'cancelled'` and is kept out of the budget's exclusion by a new `includeCancelled` option.

**Tech Stack:** TypeScript (strict) + Node, vitest, postgres/Supabase, single-file vanilla-JS SPA (`public/index.html`).

**Spec:** The approved brief supplied in-session on 2026-09-03 ("Individual accommodation override / Registration cancels / refunds"), settled against commit `f3ef67b`. Sections referenced below as §N.

## Global Constraints

- **Live application with real data.** Every migration is additive only — `add column if not exists`, nullable, no defaults that rewrite rows, no drops, no renames. Nothing may alter or delete an existing row's data.
- **Overrides always overrule.** The three importers (Form, Ticket List, Invoice) must never read, write, or clear any new override column.
- **Overrides persist across re-imports**, in any order, any number of times.
- `npm run typecheck` and `npm run test` must both pass.
- Accommodation kinds are exactly `'tent' | 'classroom'`; absence is `null`, never a third value (`src/core/types/enums.ts:15-16`).
- Section title is exactly **"Registration cancels / refunds"**. Church control relabels to exactly **"Church accommodation override"**.
- New cards are **collapsed by default** — plain `<details>` with no `open` attribute (standing owner rule, `public/index.html:8244-8247`).
- **Do not attempt browser verification.** The owner does it.

## Baseline verification (already done — do not redo)

Confirmed at `f3ef67b`: `public/index.html` is 9,567 lines; latest migration is `0021_session_revocation_epoch.sql`; `personValue` at `budget.ts:270-286`; `_budRedraw` at `index.html:4913-4920`; `_renderAllocCards` at `:8224-8310`; `_renderOvSearch` at `:8312-8321`; relabel targets at `:5115` and `:6833-6834`; `"Church overrides"` (leave alone) at `:8291`. Cancelled filters at `:3341, 3703, 4340, 4407, 4487, 4577, 4655, 5126, 5201, 5292, 7708-7709`.

**The mapper is `src/repositories/supabase/supabase.people.ts`, not `supabase.people.mapper.ts`** (§3.2's path is stale; only the test file carries the `.mapper.` infix). `toPerson` is at `:100`, `personColumns` at `:310`, `PERSON_UPDATE_COLS` at `:365`.

## ⚠️ Correction to §3.2 — the read-modify-write check came back POSITIVE

§3.2 asks to verify no write path does a read-modify-write of `accommodationKind`. **Three do**, so the mapper chokepoint cannot ship as written:

- `person.service.ts:275-283` — `update()` spreads `existing` (a mapped `Person`) and calls `repo.save()`.
- `ticket-import.service.ts:193` — `let finalKind = existing.accommodationKind`, written back at `:222`.
- `import.service.ts:421` — `accommodationKind: accommodationKind ?? match.accommodationKind`.

All three funnel into `personColumns()` (`supabase.people.ts:343`), which writes `accommodation_kind: p.accommodationKind`, and `accommodation_kind` is in `PERSON_UPDATE_COLS` (`:370`). So a resolved override would be baked into the importers' raw column on the next edit to that person — silent data corruption on a live DB, violating Global Constraint 1.

**Owner-approved mitigation (chosen in-session):** keep the chokepoint, add a raw carrier.

- `toPerson` sets `accommodationKind` = **effective** (`override ?? raw`) and `accommodationKindRaw` = the raw column.
- `personColumns` persists `accommodationKindRaw`, falling back to `accommodationKind` when the field is `undefined`.
- `undefined` vs `null` is load-bearing: `undefined` = "not built by the mapper" (a hand-constructed new person), so the fallback is correct and **no existing `Person` construction site needs changing**. `null` = "the mapper says the raw column is empty".
- The three read-modify-write sites above must carry the raw value through explicitly. Task 2 does this and locks each with a test.

## File Structure

**Create**
- `supabase/migrations/0022_individual_overrides.sql` — the five columns.

**Modify (server)**
- `src/core/entities/person.ts` — six new optional fields.
- `src/repositories/supabase/supabase.people.ts` — `toPerson` resolution + raw carrier; `personColumns`; `PERSON_UPDATE_COLS`.
- `src/api/dto/person.dto.ts` — expose override/money/cancel fields.
- `src/services/budget.ts` — `personValue` override + refund.
- `src/services/person.service.ts` — `update()` override fields + cancel side effects; `listRegistrants` `includeCancelled`.
- `src/api/controllers/registrant.controller.ts` — PATCH schema, `includeCancelled` query param.
- `src/services/import.service.ts` — protected-people guard in the delete-absent sweep.
- `src/services/ticket-import.service.ts`, `src/services/invoice-import.service.ts` — raw carrier only; no override reads/writes.
- `src/services/audit-export.service.ts`, `src/services/offline-signin.service.ts` — `Cancelled` column.

**Modify (SPA — all in `public/index.html`)**
- `_personValue` mirror; `computeBudgetClient`/`_budScopeRows`; `RENDER.budget` fetch + 5 budget-side cancelled filters; `_loadAllocation`/`_renderAllocCards` + two new cards and their handlers; two relabels; three export builders.

**Tests (extend existing files; do not add new ones where one covers the module)**
- `src/services/budget.test.ts`, `src/repositories/supabase/supabase.people.mapper.test.ts`, `src/api/dto/person.dto.test.ts`, `src/services/person.service.test.ts`, `src/services/import.service.test.ts` (create only if absent), `src/services/audit-export.service.test.ts`.

---

### Task 1: Migration `0022_individual_overrides.sql`

**Files:**
- Create: `supabase/migrations/0022_individual_overrides.sql`

**Interfaces:**
- Produces: columns `accommodation_override`, `amount_paid_override`, `refund_amount`, `refunded_at`, `cancelled_at` on `people`. Task 2 maps them.

Columns inherit the `people` table's existing RLS; migration `0021` adds no per-column policy and neither does this one.

- [ ] **Step 1: Write the migration**

```sql
-- 0022: per-person accommodation / amount-paid overrides + cancel & refund (2026-09-03).
--
-- The Data Import screen gains two admin tools: "Individual accommodation override" (this
-- person sleeps HERE and/or paid THIS, regardless of what the three CSVs say) and
-- "Registration cancels / refunds".
--
-- `accommodation_override` beats the Ticket List, the Invoice AND churches.accommodation_override.
-- It is resolved on the READ path only (supabase.people.ts `toPerson`), so every existing consumer
-- of accommodationKind honours it with no code of its own; `accommodation_kind` keeps meaning
-- "what the importers said" and is never written from the resolved value (see accommodationKindRaw).
--
-- `amount_paid_override` short-circuits the whole personValue cascade (inperson tag -> sponsor tag
-- -> amount_paid -> registration_cost). `refund_amount` is then subtracted from whatever the base
-- came out as. Cancelling does NOT change the budget — cancel state lives in `lifecycle`;
-- `cancelled_at` is an audit stamp only, kept because this is money-adjacent.
--
-- NO importer reads or writes any of these five columns, and the Form import's delete-absent sweep
-- skips anyone carrying one (import.service.ts) so a re-import cannot destroy them.
--
-- ⚠️ MUST BE APPLIED TO PROD BEFORE THIS CODE PUSHES. `supabase.people` writes every column in
-- personColumns()/PERSON_UPDATE_COLS on every save, so person saves fail until these exist —
-- the same standing rule as 0016, 0017, 0018, 0020 and 0021.
--
-- All five are nullable with no default, so applying this changes nothing about existing rows.
alter table people add column if not exists accommodation_override text
  check (accommodation_override in ('tent','classroom') or accommodation_override is null);
alter table people add column if not exists amount_paid_override numeric;
alter table people add column if not exists refund_amount numeric;
alter table people add column if not exists refunded_at timestamptz;
alter table people add column if not exists cancelled_at timestamptz;
```

- [ ] **Step 2: Verify it parses and matches house style**

Run: `cat supabase/migrations/0022_individual_overrides.sql && ls supabase/migrations/ | tail -3`
Expected: file listed after `0021_session_revocation_epoch.sql`; five `add column if not exists` statements, no `not null`, no `default`, no `drop`, no `alter column`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0022_individual_overrides.sql docs/superpowers/plans/
git commit -m "feat(db): 0022 individual accommodation/amount overrides + cancel & refund columns"
```

---

### Task 2: `Person` entity, mapper resolution, and the raw carrier

This is the task that makes everything else free. It also closes the read-modify-write hole documented above.

**Files:**
- Modify: `src/core/entities/person.ts:96` (add fields after `accommodationKind`)
- Modify: `src/repositories/supabase/supabase.people.ts:137,144-145` (`toPerson`), `:343` (`personColumns`), `:365-382` (`PERSON_UPDATE_COLS`)
- Modify: `src/services/person.service.ts:275-283`, `src/services/ticket-import.service.ts:193,222,276`, `src/services/import.service.ts:421,473`, `src/services/invoice-import.service.ts:438,481`
- Test: `src/repositories/supabase/supabase.people.mapper.test.ts`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `Person.accommodationOverride`, `Person.accommodationKindRaw`, `Person.amountPaidOverride`, `Person.refundAmount`, `Person.refundedAt`, `Person.cancelledAt` — all optional (`?:`). `Person.accommodationKind` becomes the **effective** value for every reader. Tasks 3, 4, 6, 9 and 12 consume these names.

- [ ] **Step 1: Write the failing mapper tests**

Add to `src/repositories/supabase/supabase.people.mapper.test.ts`. Reuse whatever row-fixture convention that file already uses; the rows below show only the fields that matter. If no `baseRow()`/hand-built-person helper exists, define them locally at the top of this new `describe` from an existing test's fixture in the same file — do not invent new shared helpers.

```ts
describe('individual accommodation override (0022)', () => {
  it('resolves accommodationKind from accommodation_override and marks it confirmed', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: 'classroom',
      accommodation_kind_confidence: 'guessed' }, [], []);
    expect(p.accommodationKind).toBe('classroom');       // effective
    expect(p.accommodationKindRaw).toBe('tent');         // what the importers said
    expect(p.accommodationOverride).toBe('classroom');
    expect(p.accommodationKindConfidence).toBe('confirmed');
  });

  it('falls through to accommodation_kind when there is no override', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: null,
      accommodation_kind_confidence: 'guessed' }, [], []);
    expect(p.accommodationKind).toBe('tent');
    expect(p.accommodationKindRaw).toBe('tent');
    expect(p.accommodationOverride).toBeNull();
    expect(p.accommodationKindConfidence).toBe('guessed');
  });

  it('maps the money and cancel fields', () => {
    const p = toPerson({ ...baseRow(), amount_paid_override: 250, refund_amount: 50,
      refunded_at: new Date('2026-09-01T00:00:00Z'), cancelled_at: new Date('2026-09-02T00:00:00Z') }, [], []);
    expect(p.amountPaidOverride).toBe(250);
    expect(p.refundAmount).toBe(50);
    expect(p.refundedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(p.cancelledAt).toBe('2026-09-02T00:00:00.000Z');
  });

  // THE REGRESSION GUARD. Without this, saving an overridden person bakes the override
  // into the importers' accommodation_kind column and the original value is gone for good.
  it('personColumns persists the RAW accommodation kind, never the resolved override', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: 'classroom' }, [], []);
    const cols = personColumns(p);
    expect(cols['accommodation_kind']).toBe('tent');
    expect(cols['accommodation_override']).toBe('classroom');
  });

  it('personColumns falls back to accommodationKind for a hand-built person (no raw carrier)', () => {
    const cols = personColumns({ ...handBuiltPerson(), accommodationKind: 'tent' });
    expect(cols['accommodation_kind']).toBe('tent');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/repositories/supabase/supabase.people.mapper.test.ts`
Expected: FAIL — `accommodationKindRaw` / `accommodationOverride` are not properties of `Person`.

- [ ] **Step 3: Add the entity fields**

In `src/core/entities/person.ts`, immediately after `accommodationKind?: AccommodationKind | null;` (`:96`):

```ts
  /**
   * The EFFECTIVE accommodation is `accommodationKind` above — `toPerson` resolves it as
   * `accommodationOverride ?? accommodationKindRaw` so every reader honours the override with
   * no further change. These two fields are the inputs to that resolution.
   *
   * Individual accommodation override (Data Import → "Individual accommodation override").
   * Beats the Ticket List, the Invoice, and `Church.accommodationOverride`.
   * NO importer ever reads, writes or clears this.
   */
  accommodationOverride?: AccommodationKind | null;
  /**
   * The raw `accommodation_kind` column as stored — what the three importers own.
   *
   * ⚠️ `personColumns` persists THIS, not `accommodationKind`, so saving a person who carries an
   * override cannot bake the resolved value into the importers' column. `undefined` means this
   * Person was not built by the mapper (a hand-constructed new import row), and `personColumns`
   * then falls back to `accommodationKind`. Any code that patches `accommodationKind` on a
   * MAPPED person MUST set this too — see person.service.update and the two importers.
   */
  accommodationKindRaw?: AccommodationKind | null;
  /**
   * Individual amount-paid override. Short-circuits the ENTIRE personValue cascade (inperson
   * tag → sponsor tag → amountPaid → registrationCost). NO importer ever touches it.
   */
  amountPaidOverride?: number | null;
  /** Refund issued against this registration; subtracted from their budget value. Partial refunds are normal. */
  refundAmount?: number | null;
  /** When the refund was recorded. Money-adjacent audit stamp. */
  refundedAt?: ISODateString | null;
  /**
   * Audit stamp for the → cancelled transition. The cancel STATE itself lives in `lifecycle`
   * (there is deliberately no second cancelled concept) — this only records when it happened.
   */
  cancelledAt?: ISODateString | null;
```

- [ ] **Step 4: Resolve in the mapper**

In `src/repositories/supabase/supabase.people.ts`, replace `:137`:

```ts
    /* THE OVERRIDE CHOKEPOINT. Resolved once, here, on the read path: every consumer of
       accommodationKind (dashboard counts, allocation grouping, tent distribution, the
       allocations screen + its 4-sheet export, budget classifyTicket, the audit workbook,
       the Data tab) honours an individual override with no code of its own. The raw column
       rides alongside as accommodationKindRaw and is what personColumns writes back. */
    accommodationKind:
      ((row['accommodation_override'] as Person['accommodationKind']) ??
        (row['accommodation_kind'] as Person['accommodationKind'])) ?? null,
    accommodationKindRaw: (row['accommodation_kind'] as Person['accommodationKind']) ?? null,
    accommodationOverride: (row['accommodation_override'] as Person['accommodationOverride']) ?? null,
```

Replace the `accommodationKindConfidence` mapping at `:144-145`:

```ts
    /* An override is a human decision, so it reads as 'confirmed'. This is also what stops the
       Invoice import's price-guessing from touching an overridden person
       (invoice-import.service.ts:434-439 only guesses when nothing better exists). */
    accommodationKindConfidence: row['accommodation_override'] != null
      ? 'confirmed'
      : ((row['accommodation_kind_confidence'] as Person['accommodationKindConfidence']) ?? null),
```

Add alongside the other money fields (after `taxAmount`, `:150`). `refunded_at`/`cancelled_at` come back as `Date` from the driver, matching `created_at`/`updated_at` at `:156-157`:

```ts
    amountPaidOverride: (row['amount_paid_override'] as number | null) ?? null,
    refundAmount: (row['refund_amount'] as number | null) ?? null,
    refundedAt: row['refunded_at'] ? (row['refunded_at'] as Date).toISOString() : null,
    cancelledAt: row['cancelled_at'] ? (row['cancelled_at'] as Date).toISOString() : null,
```

- [ ] **Step 5: Make the write path persist the raw value**

In `personColumns`, replace `:343`:

```ts
    /* ⚠️ RAW, never p.accommodationKind — that field is the RESOLVED effective value and writing
       it back would bake an override into the importers' column, destroying what the CSV said.
       `undefined` = hand-built person (no mapper), so fall back. See Person.accommodationKindRaw. */
    accommodation_kind: (p.accommodationKindRaw !== undefined ? p.accommodationKindRaw : p.accommodationKind) ?? null,
    accommodation_override: p.accommodationOverride ?? null,
    amount_paid_override: p.amountPaidOverride ?? null,
    refund_amount: p.refundAmount ?? null,
    refunded_at: p.refundedAt ?? null,
    cancelled_at: p.cancelledAt ?? null,
```

Add to `PERSON_UPDATE_COLS` (`:365-382`) as a new trailing group:

```ts
  // Individual overrides + cancel/refund (0022). Never written by any importer.
  'accommodation_override', 'amount_paid_override', 'refund_amount', 'refunded_at', 'cancelled_at',
```

- [ ] **Step 6: Carry the raw value through the four read-modify-write sites**

`src/services/person.service.ts` — in `update()`, after the `nextLifecycle` line and before building `updated`:

```ts
      /* A patch that sets accommodationKind is setting the IMPORTERS' value (the manual
         hand-correction path), so it must move the raw carrier too — personColumns persists
         accommodationKindRaw, and leaving it holding `existing`'s stale value would silently
         discard the edit. The individual override is a separate field and is untouched here. */
      const rawPatch: Partial<Person> = safeRest.accommodationKind !== undefined
        ? { accommodationKindRaw: safeRest.accommodationKind }
        : {};
```

and include `...rawPatch` in the `updated` literal, immediately after `...safeRest`.

`src/services/ticket-import.service.ts` — at `:193`:

```ts
            // RAW, not the resolved effective value: this import owns accommodation_kind and must
            // never write an individual override back into its own column.
            let finalKind: Person['accommodationKind'] = existing.accommodationKindRaw ?? existing.accommodationKind ?? null;
```

At the `:222` patch object add `accommodationKindRaw: finalKind,` immediately after `accommodationKind: finalKind,`. At the `:276` new-person literal add `accommodationKindRaw: parsedKind,` after `accommodationKind: parsedKind,`.

`src/services/import.service.ts` — at `:421`:

```ts
              accommodationKind: accommodationKind ?? match.accommodationKindRaw ?? match.accommodationKind,
              accommodationKindRaw: accommodationKind ?? match.accommodationKindRaw ?? match.accommodationKind,
```

At the `:473` new-person literal add `accommodationKindRaw: accommodationKind,` after `accommodationKind,`.

`src/services/invoice-import.service.ts` — after `:438` (`incoming.accommodationKind = guess;`):

```ts
              incoming.accommodationKindRaw = guess;
```

and at the `:481` new-person literal mirror whatever it assigns to `accommodationKind` into `accommodationKindRaw`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/repositories/supabase/supabase.people.mapper.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 8: Run the importer suites for regressions**

Run: `npx vitest run src/services/ticket-import src/services/invoice-import src/services/import`
Expected: PASS — all pre-existing behaviour preserved (the raw-carrier fallback makes hand-built persons behave exactly as before).

- [ ] **Step 9: Commit**

```bash
git add src/core/entities/person.ts src/repositories/supabase/supabase.people.ts src/repositories/supabase/supabase.people.mapper.test.ts src/services/person.service.ts src/services/ticket-import.service.ts src/services/invoice-import.service.ts src/services/import.service.ts
git commit -m "feat(person): resolve individual accommodation override on the read path

Adds accommodationOverride + the accommodationKindRaw carrier so personColumns keeps
persisting the importers' value. Without the carrier, person.service.update /
ticket-import:193 / import.service:421 would each write the resolved override back into
accommodation_kind and destroy what the CSV said."
```

---

### Task 3: Expose the new fields on the DTOs

**Files:**
- Modify: `src/api/dto/person.dto.ts:27,95` (interfaces), `:151` (`toRegistrantDto`), `:209` (`toCamperDto`)
- Test: `src/api/dto/person.dto.test.ts`

**Interfaces:**
- Consumes: Task 2's `Person` fields.
- Produces: `RegistrantDto.accommodationOverride | amountPaidOverride | refundAmount | refundedAt | cancelledAt`. `status` already exists at `:149`. Tasks 12, 13 and 14 consume these.

- [ ] **Step 1: Write the failing test**

Add to `src/api/dto/person.dto.test.ts`, following that file's existing person-fixture convention:

```ts
it('carries the individual overrides and cancel/refund fields to the SPA', () => {
  const dto = toRegistrantDto({ ...personFixture(), accommodationKind: 'classroom',
    accommodationOverride: 'classroom', amountPaidOverride: 250, refundAmount: 50,
    refundedAt: '2026-09-01T00:00:00.000Z', cancelledAt: null, lifecycle: 'cancelled' });
  expect(dto.accommodationKind).toBe('classroom'); // already resolved by the mapper
  expect(dto.accommodationOverride).toBe('classroom');
  expect(dto.amountPaidOverride).toBe(250);
  expect(dto.refundAmount).toBe(50);
  expect(dto.refundedAt).toBe('2026-09-01T00:00:00.000Z');
  expect(dto.status).toBe('cancelled');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/api/dto/person.dto.test.ts`
Expected: FAIL — property `accommodationOverride` does not exist on `RegistrantDto`.

- [ ] **Step 3: Add the fields**

To the `RegistrantDto` interface (around `:27`) and the `CamperDto` interface (around `:95`):

```ts
  /** Raw individual override, so the Data Import panels can show raw vs effective. */
  accommodationOverride: Person['accommodationOverride'];
  amountPaidOverride: number | null;
  refundAmount: number | null;
  refundedAt: string | null;
  cancelledAt: string | null;
```

And in both `toRegistrantDto` (`:151`) and `toCamperDto` (`:209`), after the existing `accommodationKind:` line:

```ts
    accommodationOverride: p.accommodationOverride ?? null,
    amountPaidOverride: p.amountPaidOverride ?? null,
    refundAmount: p.refundAmount ?? null,
    refundedAt: p.refundedAt ?? null,
    cancelledAt: p.cancelledAt ?? null,
```

If `tsc` shows `CamperDto` has no `status` field and Task 16's exports need one, add `status: p.lifecycle === 'cancelled' ? 'cancelled' : 'registered',` to it — otherwise leave `CamperDto`'s shape alone beyond the five fields.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/api/dto/person.dto.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/dto/person.dto.ts src/api/dto/person.dto.test.ts
git commit -m "feat(dto): expose individual overrides and cancel/refund on registrant/camper DTOs"
```

---

### Task 4: `personValue` — override short-circuits, refund subtracts (server)

**Files:**
- Modify: `src/services/budget.ts:94-110` (`BudgetPerson`), `:270-286` (`personValue`)
- Test: `src/services/budget.test.ts`

**Interfaces:**
- Produces: `BudgetPerson.amountPaidOverride`, `BudgetPerson.refundAmount`. Task 5 mirrors this logic exactly in the SPA.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/budget.test.ts`, reusing that file's existing `BudgetPerson` fixture helper (called `bp()` below — use whatever it is actually named):

```ts
describe('personValue: individual overrides (0022)', () => {
  const prices = { tent: 300, classroom: 400 };

  it('amountPaidOverride beats the inperson-ticket branch', () => {
    const p = { ...bp(), amountPaid: 100, registrationCost: 300, amountPaidOverride: 250 };
    expect(personValue(p, 'tent-inperson', prices, 300, 'inperson')).toBe(250);
  });

  it('amountPaidOverride beats a sponsor code (which otherwise forces $0)', () => {
    const p = { ...bp(), amountPaidOverride: 250 };
    expect(personValue(p, 'tent-sponsor', prices, null, 'sponsor')).toBe(250);
  });

  it('amountPaidOverride beats amountPaid and registrationCost', () => {
    const p = { ...bp(), amountPaid: 100, registrationCost: 300, amountPaidOverride: 250 };
    expect(personValue(p, 'unknown', prices, null, null)).toBe(250);
  });

  it('an override of 0 is honoured, not treated as absent', () => {
    const p = { ...bp(), amountPaid: 100, amountPaidOverride: 0 };
    expect(personValue(p, 'unknown', prices, null, null)).toBe(0);
  });

  it('a refund subtracts from the normal cascade', () => {
    const p = { ...bp(), amountPaid: 300, refundAmount: 50 };
    expect(personValue(p, 'unknown', prices, null, null)).toBe(250);
  });

  it('a refund subtracts from an override too', () => {
    const p = { ...bp(), amountPaid: 100, amountPaidOverride: 250, refundAmount: 50 };
    expect(personValue(p, 'unknown', prices, null, null)).toBe(200);
  });

  it('a refund against an unknowable value stays null, not a negative number', () => {
    const p = { ...bp(), amountPaid: null, registrationCost: null, refundAmount: 50 };
    expect(personValue(p, 'unknown', prices, null, null)).toBeNull();
  });

  it('leaves the existing cascade untouched when neither field is set', () => {
    const p = { ...bp(), amountPaid: 100, registrationCost: 300 };
    expect(personValue(p, 'unknown', prices, null, null)).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/services/budget.test.ts`
Expected: FAIL — `amountPaidOverride` not on `BudgetPerson`; refund cases return the un-refunded value.

- [ ] **Step 3: Implement**

Add to the `BudgetPerson` interface after `amountPaid` (`:109`):

```ts
  /** Individual amount-paid override — beats this entire cascade. Never set by an importer. */
  amountPaidOverride?: number | null;
  /** Refund issued; subtracted from whatever the base value came out as. */
  refundAmount?: number | null;
```

Rewrite the body of `personValue` (`:276-286`) as:

```ts
  const base = amountPaidBase(p, cls, prices, ticketPrice, tag);
  if (base == null) return null;              // unknowable stays unknowable — never a bare -refund
  return base - (p.refundAmount ?? 0);
}

/**
 * The pre-refund value. `amountPaidOverride` short-circuits EVERYTHING — it is not another rung
 * on the cascade, it IS the person's value once an admin has set it (including a deliberate 0,
 * which is why this tests `!= null` and not truthiness).
 *
 * ⚠️ MIRRORED in public/index.html `_personValueBase`. That copy is what the live Budget screen
 * and its export actually run; this one is dead server-side. Change both together.
 */
function amountPaidBase(
  p: BudgetPerson,
  cls: TicketClass,
  prices: BasePrices,
  ticketPrice?: number | null,
  tag?: DiscountTag | null,
): number | null {
  if (p.amountPaidOverride != null) return p.amountPaidOverride;
  if (cls === 'tent-inperson' || cls === 'classroom-inperson') {
    if (ticketPrice != null) return ticketPrice;
    const fallback = cls === 'tent-inperson' ? prices.tent : prices.classroom;
    if (fallback != null) return fallback;
  }
  if (cls === 'tent-sponsor' || cls === 'classroom-sponsor' || tag === 'sponsor') return 0;
  if (p.amountPaid != null) return p.amountPaid;
  if (p.registrationCost != null) return p.registrationCost;
  return null;
}
```

Keep the existing doc comment above `personValue` and add a line naming the two new inputs.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/services/budget.test.ts src/services/budget.sponsor.test.ts`
Expected: PASS, including every pre-existing sponsor/in-person case.

- [ ] **Step 5: Commit**

```bash
git add src/services/budget.ts src/services/budget.test.ts
git commit -m "feat(budget): amountPaidOverride short-circuits personValue; refunds subtract"
```

---

### Task 5: Mirror Task 4 in the live SPA budget

`src/services/budget.ts` is dead code server-side — the live Budget screen is the JS mirror. **These two must agree; this repo has already been bitten by them diverging.** Do not ship Task 4 without this.

**Files:**
- Modify: `public/index.html:4206-4216` (`_personValue`), `:4410-4412` (`computeBudgetClient` person projection), plus every other projection that feeds `_personValue`

**Interfaces:**
- Consumes: Task 3's DTO fields — `amountPaidOverride` and `refundAmount` now arrive on `/registrants` rows.

- [ ] **Step 1: Mirror the value logic**

Replace `_personValue` (`:4206-4216`) with:

```js
/* MIRROR OF src/services/budget.ts `personValue` — the two MUST agree; the server copy is dead
   code and this is what the live Budget screen and its export actually run. Change both together.
   `amountPaidOverride` short-circuits the whole cascade (an admin's stated figure IS the value,
   including a deliberate 0); the refund then subtracts from whatever the base came out as. */
function _personValue(p,cls,prices,ticketPrice,tag){
  const base=_personValueBase(p,cls,prices,ticketPrice,tag);
  if(base==null)return null; // unknowable stays unknowable — never a bare negative refund
  return base-(p.refundAmount!=null?Number(p.refundAmount):0);
}
function _personValueBase(p,cls,prices,ticketPrice,tag){
  if(p.amountPaidOverride!=null)return Number(p.amountPaidOverride);
  if(cls==='tent-inperson'||cls==='classroom-inperson'){
    if(ticketPrice!=null)return ticketPrice;
    const fb=cls==='tent-inperson'?prices.tent:prices.classroom;
    if(fb!=null)return fb;
  }
  if(cls==='tent-sponsor'||cls==='classroom-sponsor'||tag==='sponsor')return 0;
  if(p.amountPaid!=null)return p.amountPaid;
  if(p.registrationCost!=null)return p.registrationCost;
  return null;
}
```

- [ ] **Step 2: Carry the two fields into the projected person**

`computeBudgetClient` (`:4410-4412`) builds a trimmed person via `.map()`; the new fields must ride along or `_personValue` never sees them. Add to that object literal, after `amountPaid:num(r.amountPaid),`:

```js
      amountPaidOverride:num(r.amountPaidOverride),refundAmount:num(r.refundAmount),
```

- [ ] **Step 3: Do the same for every other projection that feeds `_personValue`**

Run: `grep -n "amountPaid:num(" public/index.html`
For each hit (`_budScopeRows` and the sponsorship / `:4340` / `:4487` / `:4577` / `:4655` builders), add the same two fields. **A projection that omits them silently ignores overrides in that one card** — check every hit, not just the first.

- [ ] **Step 4: Verify the mirror matches, by eye**

Run: `sed -n '/^function _personValueBase/,/^}/p' public/index.html && sed -n '/^function amountPaidBase/,/^}/p' src/services/budget.ts`
Expected: the same branches in the same order. There is no automated test for the SPA copy — this diff-by-eye is the check, and it is why the mirror comment exists.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(budget-spa): mirror amountPaidOverride/refund into the live budget"
```

---

### Task 6: `PersonService.update` — override fields, cancel side effects, timestamps

**Files:**
- Modify: `src/services/person.service.ts:264-290` (`update`)
- Test: `src/services/person.service.test.ts`

**Interfaces:**
- Consumes: Task 2's fields.
- Produces: patching `{ lifecycle: 'cancelled' }` also sets `atCamp: false` and stamps `cancelledAt`; patching `refundAmount` stamps `refundedAt`. Task 8 feeds it; Task 13 triggers it.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/person.service.test.ts`, reusing its existing service+repo harness:

```ts
describe('cancel / refund / overrides (0022)', () => {
  it('clearing atCamp is what makes a cancel reach check-in, warnings and the dashboard', async () => {
    const p = await svc.create(admin, baseInput());
    await repo.save({ ...(await repo.findById(p.id))!, atCamp: true });
    const out = await svc.update(admin, p.id, { lifecycle: 'cancelled' } as Partial<Person>);
    expect(out.lifecycle).toBe('cancelled');
    expect(out.atCamp).toBe(false);
    expect(out.cancelledAt).not.toBeNull();
  });

  it('un-cancelling clears the cancelledAt stamp', async () => {
    const p = await svc.create(admin, baseInput());
    await svc.update(admin, p.id, { lifecycle: 'cancelled' } as Partial<Person>);
    const out = await svc.update(admin, p.id, { lifecycle: 'registered' } as Partial<Person>);
    expect(out.lifecycle).toBe('registered');
    expect(out.cancelledAt).toBeNull();
  });

  it('accepts the individual overrides without touching the raw importer value', async () => {
    const p = await svc.create(admin, { ...baseInput(), accommodationKind: 'tent' });
    const out = await svc.update(admin, p.id, { accommodationOverride: 'classroom' } as Partial<Person>);
    expect(out.accommodationOverride).toBe('classroom');
    expect(out.accommodationKindRaw ?? out.accommodationKind).toBe('tent');
  });

  it('stamps refundedAt when a refund is recorded, and does not imply a cancel', async () => {
    const p = await svc.create(admin, baseInput());
    const out = await svc.update(admin, p.id, { refundAmount: 50 } as Partial<Person>);
    expect(out.refundAmount).toBe(50);
    expect(out.refundedAt).not.toBeNull();
    expect(out.lifecycle).toBe('registered'); // refund and cancel are independent
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/services/person.service.test.ts`
Expected: FAIL — `atCamp` stays true (it is stripped from every patch at `:269`), no stamps.

- [ ] **Step 3: Implement**

In `update()`, after the `rawPatch` block added in Task 2 Step 6:

```ts
      /* ⚠️ `atCamp` and `lifecycle` are ORTHOGONAL by design (person.ts:129-130) and atCamp is
         stripped from every patch above — deliberately. This ONE transition couples them, because
         checkin.service.ts:113-121, checkin-warnings.ts:179-188 and dashboard.service.ts:207-215
         all filter on atCamp and never consult lifecycle: without this, a cancelled student stays
         on the check-in roster and in the "still to check in" count. Do not "fix" this back.
         Cancelling deliberately does NOT change the budget — their money keeps counting until
         Refund is pressed (see listRegistrants `includeCancelled`). */
      const cancelling = nextLifecycle === 'cancelled' && existing.lifecycle !== 'cancelled';
      const unCancelling = nextLifecycle === 'registered' && existing.lifecycle === 'cancelled';
      const cancelPatch: Partial<Person> =
        cancelling ? { atCamp: false, cancelledAt: nowISO() }
        : unCancelling ? { cancelledAt: null }
        : {};
      // A refund is money leaving — stamp when. Independent of cancel in both directions.
      const refundPatch: Partial<Person> =
        safeRest.refundAmount !== undefined && safeRest.refundAmount !== existing.refundAmount
          ? { refundedAt: safeRest.refundAmount == null ? null : nowISO() }
          : {};
```

and extend the `updated` literal to:

```ts
      const updated: Person = { ...existing, ...safeRest, ...rawPatch, ...cancelPatch, ...refundPatch,
        id: existing.id, lifecycle: nextLifecycle, updatedAt: nowISO() };
```

`accommodationOverride`, `amountPaidOverride` and `refundAmount` flow through `safeRest` untouched — they are not in the destructured strip-list, so they need no further handling.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/services/person.service.test.ts src/services/person-lifecycle.test.ts src/services/checkin.service.test.ts src/services/checkin-warnings.test.ts src/services/dashboard.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/person.service.ts src/services/person.service.test.ts
git commit -m "feat(person): cancel clears atCamp and stamps cancelledAt; refunds stamp refundedAt"
```

---

### Task 7: `listRegistrants` — `includeCancelled`

**Files:**
- Modify: `src/services/person.service.ts:63` (interface decl), `:170-186` (impl)
- Test: `src/services/person.service.test.ts`

**Interfaces:**
- Produces: `listRegistrants(actor, churchId?, opts?: { includeCancelled?: boolean })`. Task 8 surfaces it as a query param; Task 14 is the only caller that sets it.

- [ ] **Step 1: Write the failing tests**

```ts
describe('listRegistrants includeCancelled (0022)', () => {
  it('excludes cancelled people by default — every ops list depends on this', async () => {
    const p = await svc.create(admin, baseInput());
    await svc.update(admin, p.id, { lifecycle: 'cancelled' } as Partial<Person>);
    expect((await svc.listRegistrants(admin)).map(r => r.id)).not.toContain(p.id);
  });

  it('includes them when asked, so the budget still counts their money', async () => {
    const p = await svc.create(admin, baseInput());
    await svc.update(admin, p.id, { lifecycle: 'cancelled' } as Partial<Person>);
    expect((await svc.listRegistrants(admin, undefined, { includeCancelled: true })).map(r => r.id)).toContain(p.id);
  });

  it('ignores includeCancelled for a church login (budget is director/admin only)', async () => {
    const p = await svc.create(admin, baseInput());
    await svc.update(admin, p.id, { lifecycle: 'cancelled' } as Partial<Person>);
    expect((await svc.listRegistrants(churchActor, undefined, { includeCancelled: true })).map(r => r.id)).not.toContain(p.id);
  });
});
```

Use whatever the file already calls its church-scoped actor for `churchActor`; if none exists, build one matching the fixture style of the church-scope tests already in that file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/services/person.service.test.ts -t includeCancelled`
Expected: FAIL — `listRegistrants` takes two arguments.

- [ ] **Step 3: Implement**

Update the interface declaration to `listRegistrants(actor: Actor, churchId?: string, opts?: { includeCancelled?: boolean }): Promise<Person[]>;`, then the implementation — **keeping every existing comment in that method verbatim**:

```ts
    async listRegistrants(actor, churchId, opts = {}) {
      assertCan(actor, 'registrant:read');
      /* `includeCancelled` exists for ONE caller: the Budget screen. Cancelling must not silently
         drop a person's money (both isRegistrant and isCamper exclude cancelled), so the budget —
         and only the budget — sees them; their value keeps counting until a Refund is recorded.
         Gated to director/admin, which is exactly who can open the budget and the Data Import
         screen, so a church login can never widen its own scope with a query param. */
      const includeCancelled = opts.includeCancelled === true
        && (actor.role === 'director' || actor.role === 'admin');
      const keep = (p: Person) => isRegistrant(p) || (includeCancelled && p.lifecycle === 'cancelled');
      // Preserve the legacy churchId fast-path access check (registrant.service.list).
      if (churchId) {
        const items = await repo.findByChurch(churchId);
        const zone = items[0]?.zone;
        // canAccessChurch matches the old registrant behaviour incl. the empty-church
        // edge (zone undefined -> zoneLeader denied).
        if (!canAccessChurch(actor, churchId, zone)) {
          return [];
        }
        // canAccessChurch is gender-unaware; re-filter through canAccessPerson so a
        // gender-scoped (b-/g-) login can never pull the other gender via ?churchId.
        return items.filter(keep).filter((p) => canAccessPerson(actor, p));
      }
      const all = await scopedAll(actor, {});
      return all.filter(keep);
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/services/person.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/person.service.ts src/services/person.service.test.ts
git commit -m "feat(person): includeCancelled option on listRegistrants for the budget only"
```

---

### Task 8: Extend the `PATCH /registrants/:id` schema and the list query param

Reuse this endpoint — do **not** add new endpoints. The existing role gate stays.

**Files:**
- Modify: `src/api/controllers/registrant.controller.ts:15-18` (`list`), `:72-110` (`update` patch builder)

**Interfaces:**
- Consumes: Tasks 6 and 7.
- Produces: `PATCH /registrants/:id` accepts `accommodationOverride`, `amountPaidOverride`, `refundAmount`; `GET /registrants?includeCancelled=1`. Tasks 11, 12, 13 and 14 call these.

- [ ] **Step 1: Accept the query param in `list`**

```ts
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const churchId = req.query['churchId'];
      // Budget/Data-Import widening only; PersonService re-gates it to director/admin.
      const includeCancelled = req.query['includeCancelled'] === '1' || req.query['includeCancelled'] === 'true';
      return (await person.listRegistrants(req.ctx.actor, churchId, { includeCancelled })).map(toRegistrantDto);
    },
```

- [ ] **Step 2: Validate before building the patch**

Immediately before the `patch` literal (`:72`), next to the existing validation in that handler:

```ts
      const ovRaw = b['accommodationOverride'];
      if (ovRaw !== undefined && ovRaw !== null && ovRaw !== 'tent' && ovRaw !== 'classroom') {
        throw new BadRequestError('accommodationOverride must be tent, classroom or null');
      }
      for (const k of ['amountPaidOverride', 'refundAmount'] as const) {
        const v = b[k];
        if (v !== undefined && v !== null && !Number.isFinite(Number(v))) {
          throw new BadRequestError(`${k} must be a number or null`);
        }
      }
```

- [ ] **Step 3: Accept the three override fields in the patch builder**

Add to the `patch` object literal, after the `accommodationKindConfidence` entry:

```ts
        /* Individual overrides (0022, Data Import). `null` is a meaningful value for all three
           (clear the override / clear the refund), so these test `!== undefined`, matching every
           other entry here. No importer can reach this path. */
        ...(b['accommodationOverride'] !== undefined && {
          accommodationOverride: b['accommodationOverride'] as Person['accommodationOverride'],
        }),
        ...(b['amountPaidOverride'] !== undefined && {
          amountPaidOverride: b['amountPaidOverride'] == null ? null : Number(b['amountPaidOverride']),
        }),
        ...(b['refundAmount'] !== undefined && {
          refundAmount: b['refundAmount'] == null ? null : Number(b['refundAmount']),
        }),
```

- [ ] **Step 4: Typecheck and run the API suites**

Run: `npx tsc --noEmit && npx vitest run src/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/controllers/registrant.controller.ts
git commit -m "feat(api): PATCH /registrants accepts overrides+refund; GET takes includeCancelled"
```

---

### Task 9: Protect overridden/cancelled people from the Form import's delete sweep

This guard is the only thing standing between a Form re-import and the loss of an override.

**Files:**
- Modify: `src/services/import.service.ts:500-535`, plus the import-result type that carries `deleted`
- Test: `src/services/import.service.test.ts` (extend; create only if no import.service test file exists)

**Interfaces:**
- Produces: `ImportResult.retained: number` alongside the existing `deleted`.

- [ ] **Step 1: Write the failing test**

```ts
it('never deletes an absent person who carries an override, a refund or a cancellation', async () => {
  // Someone withdrew, was refunded, and is no longer in the church's Elvanto export.
  const keep = await seedPerson({ firstName: 'Cancelled', lastName: 'Camper', lifecycle: 'cancelled' });
  const overridden = await seedPerson({ firstName: 'Over', lastName: 'Ridden', accommodationOverride: 'tent' });
  const ordinary = await seedPerson({ firstName: 'Plain', lastName: 'Person' });

  const res = await importer.importCsv(admin, csvWithNobody(), { dryRun: false });

  expect(await repo.findById(keep.id)).not.toBeNull();
  expect(await repo.findById(overridden.id)).not.toBeNull();
  expect(await repo.findById(ordinary.id)).toBeNull();
  expect(res.deleted).toBe(1);
  expect(res.retained).toBe(2);
});

it('does not warn that a protected person will be deleted in a dry run', async () => {
  await seedPerson({ firstName: 'Cancelled', lastName: 'Camper', lifecycle: 'cancelled' });
  const res = await importer.importCsv(admin, csvWithNobody(), { dryRun: true });
  expect(res.warnings.some(w => w.message.includes('will be DELETED'))).toBe(false);
  expect(res.retained).toBe(1);
});
```

Build `seedPerson`/`csvWithNobody` from the harness the existing import tests already use; if `src/services/import.service.test.ts` does not exist, create it modelled on `src/services/ticket-import.service.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/import.service.test.ts`
Expected: FAIL — all three deleted; `retained` undefined.

- [ ] **Step 3: Implement the guard**

Replace `:501-502` (`const absentIds = ...` / `const deleted = ...`):

```ts
      // Anyone in the DB but not in the uploaded CSV is removed (the upload is authoritative)…
      const absentIdsAll = allPersons.map((p) => p.id).filter((id) => !seenIds.has(id));

      /* …EXCEPT anyone carrying an admin decision that this CSV knows nothing about. The Form
         export is Elvanto's view of who is registered, so a cancelled student or someone with a
         hand-set override is EXACTLY the person who stops appearing in it — and hard-deleting
         them would take the override, the refund and their whole record with it. Overrides must
         survive re-imports in any order, any number of times.

         ponytail: these five columns live ON `people`, so this guard is the only thing protecting
         them from a hard delete. If a new delete path ever appears (another importer, a manual
         purge, the new-year rollover) it needs the same guard — or move the data to the
         `allocation_overrides` side-table pattern keyed on firstNameKey/lastNameKey/mobileKey
         (src/core/entities/allocation-override.ts:12-18), which survives a delete by design. */
      const isProtected = (p: Person) =>
        p.lifecycle === 'cancelled' ||
        p.accommodationOverride != null ||
        p.amountPaidOverride != null ||
        p.refundAmount != null;
      const absentSetAll = new Set(absentIdsAll);
      const protectedPeople = allPersons.filter((p) => absentSetAll.has(p.id) && isProtected(p));
      const protectedIds = new Set(protectedPeople.map((p) => p.id));
      const absentIds = absentIdsAll.filter((id) => !protectedIds.has(id));
      const deleted = absentIds.length;
      const retained = protectedPeople.length;

      for (const p of protectedPeople) {
        warnings.push({
          row: 0,
          message:
            `${p.firstName} ${p.lastName} (${p.churchName || 'no church'}) is no longer in this file but ` +
            'was KEPT — they have a cancellation, refund or individual override recorded',
        });
      }
```

The existing `absentPeople` warning block below derives from `absentIds`, so protected people drop out of the "will be DELETED" warnings automatically. **Verify `absentSetForWarning` is built from `absentIds`, not `absentIdsAll`.**

Add `retained` to the returned object (`:539`) and to the `ImportResult` type (search for where `deleted:` is declared).

- [ ] **Step 4: Confirm no importer owns the new columns**

Run: `grep -n "accommodationOverride\|amountPaidOverride\|refundAmount\|refundedAt\|cancelledAt" src/services/import.service.ts src/services/ticket-import.service.ts src/services/invoice-import.service.ts`
Expected: matches **only** inside the `isProtected` guard above. In particular `invoice-import.service.ts:174`'s owned-field list and the Form import's blank-clobber allowlist (`import.service.ts:393`) must contain none of them. If any other match appears, remove it.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/services/import.service.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/import.service.ts src/services/import.service.test.ts
git commit -m "fix(import): never delete an absent person carrying a cancel, refund or override"
```

---

### Task 10: `_renderAllocCards` — stop collapsing every card and jumping to the top

Today `_renderAllocCards` ends with an unconditional `wrap.innerHTML=...` (`:8309`), re-emitting every `<details>` with no `open`. So every allocate / override / undo collapses all three cards and loses scroll position. Fix it for the existing cards **before** adding two more that would inherit it.

**Files:**
- Modify: `public/index.html:8248-8310`

**Interfaces:**
- Produces: `_renderAllocCards()` preserves open `<details>` (keyed by `data-ac`) and scroll position across a rewrite. Tasks 12 and 13 rely on it.

- [ ] **Step 1: Key every card**

Add a `data-ac` attribute to each of the three existing `<details>` open tags:
- cardA (`:8248`): `<details data-ac="unallocated">`
- cardB: `<details data-ac="designated">`
- cardC (summary at `:8291`): `<details data-ac="churchov">`

Leave all three `<summary>` texts exactly as-is — the `:8291` "Church overrides" label is a different feature (manual church reassignment) and must not be touched.

- [ ] **Step 2: Preserve open state and scroll across the rewrite**

Replace `:8309` (`wrap.innerHTML=errCard+cardA+cardB+cardC;`) with:

```js
  /* Same capture/reapply as `_budRedraw` (:4913). Before this, EVERY write on this screen
     (allocate, override, undo) re-emitted all the cards with no `open` attribute, so the whole
     screen collapsed and jumped to the top mid-task. paint()'s samePaint/keepY guard (:2488)
     does not help here — this writes #allocWrap.innerHTML directly and never goes through paint.
     `data-ac` keys the cards (and the per-student rows in the two override cards) so reopening
     is stable across a re-render that changes list contents.
     This restores only what the operator themselves opened — the collapsed-by-default rule
     above (:8244) still stands, so do NOT add `open` to any card's markup. */
  const openKeys=[...wrap.querySelectorAll('details[data-ac]')].filter(d=>d.open).map(d=>d.getAttribute('data-ac'));
  const sc=_scroller(document.getElementById('import'));
  const y=sc?sc.scrollTop:0;
  wrap.innerHTML=errCard+cardA+cardB+cardC;
  openKeys.forEach(k=>{const d=wrap.querySelector(`details[data-ac="${k}"]`);if(d)d.open=true;});
  if(sc)sc.scrollTop=y;
}
```

- [ ] **Step 3: Confirm the scroll container is right**

Run: `grep -n "paint('import'" public/index.html`
Expected: `RENDER.import` paints to screen id `'import'` (`:8145`), so `_scroller(document.getElementById('import'))` matches `_budRedraw`'s `_scroller(document.getElementById('budget'))`. Do not hand-roll the phone-vs-desktop branch — `_scroller`/`_isWide` (`:1992-1993`) own it.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "fix(data-import): keep cards open and hold scroll position across a re-render

_renderAllocCards rewrote #allocWrap wholesale on every allocate/override/undo, so the
screen collapsed and jumped to the top mid-task. Adopts _budRedraw's capture/reapply."
```

---

### Task 11: Load cancelled registrants into the Data Import screen's state

The cancels/refunds card must still show a person after they are cancelled — but `/registrants` drops cancelled people, so without this the row silently vanishes the instant Cancel is pressed. One fetch, no behaviour change to the existing cards.

**Files:**
- Modify: `public/index.html:8192` (`_allocState`), `:8201-8212` (`_loadAllocation`)

**Interfaces:**
- Consumes: Task 8's `includeCancelled` param.
- Produces: `_allocState.regsAll` (registrants **including** cancelled) alongside the unchanged `_allocState.regs` (active only). Tasks 12 and 13 read these.

- [ ] **Step 1: Widen the fetch and split the result**

Change the state initialiser (`:8192`) to include `regsAll:[]`. In `_loadAllocation`, rename the destructured binding from `regs` to `allRegs` and change its grab to:

```js
    grab(_scoped('/registrants?includeCancelled=1'),'Registrants'),
```

Then replace the assignment (`:8211`) with:

```js
  /* ONE fetch, two views. `regs` stays exactly what it always was — active registrants — so the
     unallocated/designated/church-override cards and their search are untouched. `regsAll` keeps
     the cancelled people the cancels/refunds card needs to still show after a cancel lands.
     A church login is re-gated server-side and just gets the active list back either way. */
  const _all=allRegs||[];
  _allocState={unallocated:unallocated||[],regs:_all.filter(r=>r.status!=='cancelled'),
    regsAll:_all,churches:churches||[],overrides:overrides||[]};
```

- [ ] **Step 2: Verify no existing card silently gained cancelled people**

Run: `grep -n "_allocState.regs" public/index.html`
Expected: every pre-existing hit still reads `_allocState.regs` (active only). Only code added in Tasks 12–13 may read `_allocState.regsAll`.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(data-import): load registrants including cancelled, keep regs active-only"
```

---

### Task 12: New card — "Individual accommodation override"

**Files:**
- Modify: `public/index.html` — new module state near `:8192`; new `cardD` inside `_renderAllocCards`; new handlers after `undoOverride` (`:8351`)

**Interfaces:**
- Consumes: Tasks 8, 10, 11; DTO fields from Task 3.
- Produces: `_indivIds`, `_crIds`, `indivAdd(id)`, `indivRemove(id)`, `indivSave(id)`, `_renderIndivSearch()`, and the shared `accLabel`/`money` formatters used by Task 13.

- [ ] **Step 1: Add the working-list state**

Next to `_allocState` (`:8192`):

```js
/* The two override cards are working lists, not queries: the admin searches a student in, acts,
   and the row stays put. They live in module state because _renderAllocCards rewrites
   #allocWrap wholesale — anything held only in the DOM would not survive a save. */
let _indivIds=[];   // "Individual accommodation override"
let _crIds=[];      // "Registration cancels / refunds"
```

- [ ] **Step 2: Build the card**

Inside `_renderAllocCards`, after cardC and before the `errCard` line:

```js
  const accLabel=k=>k==='tent'?'Tent':k==='classroom'?'Classroom':'—';
  const money=v=>v==null?'—':'$'+Number(v).toFixed(2);
  const indivRows=_indivIds.map(id=>{
    const p=_allocState.regs.find(r=>r.id===id); if(!p)return '';
    const ch=_allocState.churches.find(c=>c.id===p.churchId);
    const ov=p.accommodationOverride||'';
    return `<div class="card" style="padding:10px"><details data-ac="indiv:${esc(p.id)}">
      <summary style="cursor:pointer;font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</summary>
      <div class="sub" style="margin-top:6px">Individual accommodation: <b>${esc(accLabel(p.accommodationKind))}</b>${ov?' · overridden':''}</div>
      <div class="sub">Church accommodation: <b>${esc(accLabel(ch&&ch.accommodationOverride))}</b></div>
      <label class="sub" style="display:block;margin-top:8px">Accommodation override</label>
      <select class="fld" id="indivAcc_${esc(p.id)}">
        <option value=""${ov===''?' selected':''}>Leave unchanged</option>
        <option value="tent"${ov==='tent'?' selected':''}>Tent</option>
        <option value="classroom"${ov==='classroom'?' selected':''}>Classroom</option>
      </select>
      <div class="sub" style="margin-top:8px">Amount paid: <b>${esc(money(p.amountPaidOverride!=null?p.amountPaidOverride:p.amountPaid))}</b>${p.amountPaidOverride!=null?' · overridden':''}</div>
      <label class="sub" style="display:block;margin-top:4px">New amount paid</label>
      <input class="fld" id="indivAmt_${esc(p.id)}" type="number" step="0.01" inputmode="decimal" placeholder="Leave blank to keep existing">
      <div class="rowsb" style="gap:6px;margin-top:8px">
        <button class="btn ghost" onclick="indivRemove('${esc(p.id)}')">Remove from list</button>
        <button class="btn" style="width:auto;flex:0 0 auto;margin-top:0" onclick="indivSave('${esc(p.id)}')">Save override</button>
      </div>
    </details></div>`;
  }).join('');
  /* Collapsed by default like every other card on this screen (:8244). */
  const cardD=`<div class="card"><details data-ac="indivcard">
    <summary style="cursor:pointer;font-weight:700">Individual accommodation override (${_indivIds.length})</summary>
    <p class="note-hint" style="text-align:left">Set where one student sleeps, and/or what they paid, regardless of the ticket list, the invoice or their church's accommodation. Survives re-imports.</p>
    <input class="fld" id="indivSearch" oninput="_renderIndivSearch()" placeholder="Search a student to add…">
    <div id="indivSearchResults"></div>
    ${indivRows}
  </details></div>`;
```

and extend the innerHTML line from Task 10 to `errCard+cardA+cardB+cardC+cardD`.

- [ ] **Step 3: Add the picker and handlers**

After `undoOverride` (`:8351`), copying the `_renderOvSearch` house pattern (live `oninput`, min 2 chars, `.slice(0,8)`). These must be top-level functions — the `onclick=` attributes need globals:

```js
function _renderIndivSearch(){
  const box=document.getElementById('indivSearchResults'); if(!box) return;
  const q=(document.getElementById('indivSearch').value||'').trim().toLowerCase();
  if(q.length<2){box.innerHTML='';return;}
  // Active registrants only — you do not set sleeping arrangements for a cancelled student.
  const hits=_allocState.regs.filter(r=>_indivIds.indexOf(r.id)<0
    && `${r.firstName} ${r.lastName}`.toLowerCase().includes(q)).slice(0,8);
  box.innerHTML=hits.length?hits.map(p=>`<div class="rowsb" style="gap:6px;padding:4px 0">
    <div><div style="font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</div><div class="sub">${esc(p.churchName)}</div></div>
    <button class="btn ghost" onclick="indivAdd('${esc(p.id)}')">Add</button>
  </div>`).join(''):'<p class="note-hint">No matches.</p>';
}
function indivAdd(id){ if(_indivIds.indexOf(id)<0)_indivIds.push(id); _renderAllocCards(); }
function indivRemove(id){ _indivIds=_indivIds.filter(x=>x!==id); _renderAllocCards(); }

async function indivSave(id){
  const sel=document.getElementById('indivAcc_'+id), amtEl=document.getElementById('indivAmt_'+id);
  const body={};
  // Blank means "keep whatever exists" for BOTH fields — they are independent.
  if(sel&&sel.value)body.accommodationOverride=sel.value;
  const raw=amtEl?String(amtEl.value).trim():'';
  if(raw!==''){
    const n=Number(raw);
    if(!isFinite(n)||n<0){toast('Enter a valid amount');return;}
    body.amountPaidOverride=n;
  }
  if(!Object.keys(body).length){toast('Both fields are blank — nothing to save');return;}
  try{
    await api('/registrants/'+id,{method:'PATCH',body});
    toast('Override saved');_invalidate('/registrants');await _loadAllocation();
  }catch(e){toast(e.message||'Failed');}
}
```

- [ ] **Step 4: Check the markup and handlers line up**

Run: `grep -n "indivSearch\|indivAcc_\|indivAmt_\|_renderIndivSearch\|indivAdd\|indivRemove\|indivSave" public/index.html`
Expected: every id/handler referenced in the markup has exactly one definition, and each handler is declared at top level (not nested inside another function).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(data-import): Individual accommodation override card"
```

---

### Task 13: New card — "Registration cancels / refunds"

Two **independent** actions: you can refund someone still attending, and cancel someone whose money you keep. Neither implies the other.

**Files:**
- Modify: `public/index.html` — `cardE` in `_renderAllocCards`; handlers after Task 12's

**Interfaces:**
- Consumes: Tasks 8, 10, 11, and Task 12's `_crIds` / `money` formatter.
- Produces: `crAdd(id)`, `crRemove(id)`, `crCancel(id)`, `crCancelConfirm(id)`, `crRefund(id)`, `_renderCrSearch()`.

- [ ] **Step 1: Build the card**

After cardD:

```js
  const crRows=_crIds.map(id=>{
    const p=_allocState.regsAll.find(r=>r.id===id); if(!p)return '';
    const cancelled=p.status==='cancelled';
    return `<div class="card" style="padding:10px">
      <div style="font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</div>
      <div class="sub">${esc(p.churchName||'No church')} · paid ${esc(money(p.amountPaidOverride!=null?p.amountPaidOverride:p.amountPaid))}${p.refundAmount!=null?' · refunded '+esc(money(p.refundAmount)):''}</div>
      <div class="sub">${cancelled?'<b>Registration cancelled</b>':'Registered'}</div>
      <div class="rowsb" style="gap:6px;margin-top:8px">
        <button class="btn ghost" onclick="crRemove('${esc(p.id)}')">Remove from list</button>
        ${cancelled?'':`<button class="btn" style="width:auto;flex:0 0 auto;margin-top:0" onclick="crCancel('${esc(p.id)}')">Cancel registration</button>`}
      </div>
      <div class="rowsb" style="gap:6px;margin-top:8px">
        <input class="fld" id="crAmt_${esc(p.id)}" type="number" step="0.01" inputmode="decimal" placeholder="Refund amount" style="flex:1">
        <button class="btn alt" style="width:auto;flex:0 0 auto;margin-top:0" onclick="crRefund('${esc(p.id)}')">Refund</button>
      </div>
    </div>`;
  }).join('');
  const cardE=`<div class="card"><details data-ac="crcard">
    <summary style="cursor:pointer;font-weight:700">Registration cancels / refunds (${_crIds.length})</summary>
    <p class="note-hint" style="text-align:left">Cancelling removes someone from the check-in roster and every on-screen list, but keeps their money in the budget — record a refund separately. The two actions are independent.</p>
    <input class="fld" id="crSearch" oninput="_renderCrSearch()" placeholder="Search a student to add…">
    <div id="crSearchResults"></div>
    ${crRows}
  </details></div>`;
```

and extend the innerHTML line to `errCard+cardA+cardB+cardC+cardD+cardE`.

- [ ] **Step 2: Add the picker and handlers**

```js
function _renderCrSearch(){
  const box=document.getElementById('crSearchResults'); if(!box) return;
  const q=(document.getElementById('crSearch').value||'').trim().toLowerCase();
  if(q.length<2){box.innerHTML='';return;}
  // regsAll, not regs: an already-cancelled student must still be findable, to refund them.
  const hits=_allocState.regsAll.filter(r=>_crIds.indexOf(r.id)<0
    && `${r.firstName} ${r.lastName}`.toLowerCase().includes(q)).slice(0,8);
  box.innerHTML=hits.length?hits.map(p=>`<div class="rowsb" style="gap:6px;padding:4px 0">
    <div><div style="font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</div><div class="sub">${esc(p.churchName)}${p.status==='cancelled'?' · cancelled':''}</div></div>
    <button class="btn ghost" onclick="crAdd('${esc(p.id)}')">Add</button>
  </div>`).join(''):'<p class="note-hint">No matches.</p>';
}
function crAdd(id){ if(_crIds.indexOf(id)<0)_crIds.push(id); _renderAllocCards(); }
function crRemove(id){ _crIds=_crIds.filter(x=>x!==id); _renderAllocCards(); }

function crCancel(id){
  const p=_allocState.regsAll.find(r=>r.id===id); if(!p)return;
  modal(`<div class="h3" style="margin-top:0">Cancel registration</div>
    <p class="note-hint" style="text-align:left">Cancel <b>${esc(p.firstName)} ${esc(p.lastName)}</b>'s registration? They drop off the check-in roster and every on-screen list immediately. <b>Their money stays in the budget</b> — record a refund separately if one is owed.</p>
    <div class="rowsb" style="gap:6px;margin-top:10px">
      <button class="btn ghost" onclick="closeModal()">Keep registered</button>
      <button class="btn" onclick="crCancelConfirm('${esc(id)}')">Cancel registration</button>
    </div>`);
}
async function crCancelConfirm(id){
  try{
    await api('/registrants/'+id,{method:'PATCH',body:{status:'cancelled'}});
    closeModal();toast('Registration cancelled');_invalidate('/registrants');await _loadAllocation();
  }catch(e){toast(e.message||'Failed');}
}

async function crRefund(id){
  const el=document.getElementById('crAmt_'+id);
  const raw=el?String(el.value).trim():'';
  if(raw===''){toast('Enter a refund amount');return;}
  const n=Number(raw);
  if(!isFinite(n)||n<0){toast('Enter a valid amount');return;}
  try{
    // Independent of cancel in both directions — refunding does not withdraw the registration.
    await api('/registrants/'+id,{method:'PATCH',body:{refundAmount:n}});
    toast('Refund recorded');_invalidate('/registrants');await _loadAllocation();
  }catch(e){toast(e.message||'Failed');}
}
```

- [ ] **Step 3: Check every id and handler resolves**

Run: `grep -n "crSearch\|crAmt_\|_renderCrSearch\|crAdd\|crRemove\|crCancel\|crRefund" public/index.html`
Expected: one definition each, `crCancelConfirm` present, all declared at top level.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(data-import): Registration cancels / refunds card"
```

---

### Task 14: Budget screen — see cancelled people, so cancelling does not move the money

`isRegistrant` and `isCamper` both exclude cancelled, so today flipping the flag would silently drop that person from the budget. The server half is Task 7; this is the SPA half.

**Files:**
- Modify: `public/index.html:4594` (`RENDER.budget` fetch), and **only** the five budget-side filters at `:4340, 4407, 4487, 4577, 4655`

- [ ] **Step 1: Widen the budget's own fetch**

At `:4594`, change the registrants call to `api(_scoped('/registrants?includeCancelled=1'))`. Leave the `/campers` call alone — cancelled people are never campers.

- [ ] **Step 2: Relax the five budget-side filters**

At each of `:4340, 4407, 4487, 4577, 4655`, drop the `.filter(r=>r.status!=='cancelled')` link from the chain, leaving every other filter in place. Put this comment above the first one (`:4340`):

```js
  /* Cancelled people are DELIBERATELY still here (0022). Cancelling a registration must not move
     the money — their value keeps counting until a Refund is recorded against them. Every
     non-budget list on this screen and elsewhere still excludes them (:3341, :5126, :5201,
     :5292, :7708) and must keep doing so. */
```

**Do not touch** `:3341, 3703, 5126, 5201, 5292, 7708-7709` — those are ops lists.

- [ ] **Step 3: Verify exactly five filters moved**

Run: `grep -n "status!=='cancelled'" public/index.html`
Expected: hits remain at the five ops-list sites (line numbers shifted by earlier tasks) and **none** inside `computeBudgetClient`, `_budScopeRows`, the sponsorship builder, or `exportBudget`'s row source.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(budget): keep cancelled registrations in the budget until refunded"
```

---

### Task 15: Relabel the church-level control

**Files:**
- Modify: `public/index.html:5115`, `:6833`

- [ ] **Step 1: Rename both**

`:5115` → `<summary style="cursor:pointer;font-weight:700">Church accommodation override (${set} set)</summary>`

`:6833` → `<div style="font-weight:700">Church accommodation override</div>`

Leave `:6834`'s `${ovSet} set · now on the allocations screen` sub-line as-is.

- [ ] **Step 2: Confirm the unrelated feature was not touched**

Run: `grep -n "Accommodation overrides\|Church accommodation override\|Church overrides" public/index.html`
Expected: two "Church accommodation override" hits; zero "Accommodation overrides"; **"Church overrides" still present** at the old `:8291` — that is manual church *reassignment* (`AllocationOverride`), a different feature.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): relabel Accommodation overrides -> Church accommodation override"
```

---

### Task 16: Exports — keep cancelled rows, add a `Cancelled` column

One consistent rule across every export: cancelled people stay in, marked. They are hidden from on-screen ops lists only.

**Files:**
- Modify: `src/services/audit-export.service.ts:135-171`, `src/services/offline-signin.service.ts:44-46`
- Modify: `public/index.html` — budget export (`exportBudget`, `:4961+`), accommodation 4-sheet export, check-in status PNG export
- Test: `src/services/audit-export.service.test.ts` (extend; create if absent)

Leave `src/services/export.service.ts:68` alone — that is the new-year snapshot scaffold, not a roster export.

- [ ] **Step 1: Write the failing audit-export test**

Read `audit-export.service.ts:135-171` first and match whatever shape it actually returns; adapt the accessors below to it.

```ts
it('keeps cancelled people in the audit workbook, flagged', async () => {
  await seedPerson({ firstName: 'Gone', lastName: 'Away', lifecycle: 'cancelled' });
  const wb = await auditExport.build(admin);
  const sheet = wb.sheets[0];
  expect(sheet.header).toContain('Cancelled');
  const row = sheet.rows.find(r => r.includes('Gone'));
  expect(row).toBeDefined();
  expect(row![sheet.header.indexOf('Cancelled')]).toBe('Yes');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/audit-export.service.test.ts`
Expected: FAIL — the row is absent (the builder is gated on `isCamper(p)`, which excludes cancelled).

- [ ] **Step 3: Fix the two server exports**

`audit-export.service.ts` — widen the `isCamper(p)` gate to `isCamper(p) || p.lifecycle === 'cancelled'`, add `'Cancelled'` to the header array, and append `p.lifecycle === 'cancelled' ? 'Yes' : ''` to each row in the matching position. Comment:

```ts
      /* Cancelled people stay IN every export, marked — one consistent rule (they are hidden from
         on-screen ops lists only). An export is the audit trail: someone who withdrew after paying
         is exactly who a reconciliation needs to see. */
```

`offline-signin.service.ts:44-46` — same: stop filtering cancelled out, add the column.

- [ ] **Step 4: Fix the three SPA exports**

Run: `grep -n "_accomRegs\|function exportBudget\|function exportAccom\|toBlob\|toDataURL" public/index.html` to locate the three builders, then add a `Cancelled` column/marker sourced from `r.status==='cancelled'` to each: `exportBudget` (`:4961+`), the accommodation 4-sheet export (built from `window._accomRegs/_accomRooms/_accomAlloc`), and the check-in status PNG. `exportBudget` reads `window._budgetRegs`, which already includes cancelled people via Task 14 — it needs the column only.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/services/audit-export.service.test.ts src/services/offline-signin.service.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/audit-export.service.ts src/services/offline-signin.service.ts src/services/audit-export.service.test.ts public/index.html
git commit -m "feat(exports): keep cancelled rows inline with a Cancelled column"
```

---

### Task 17: Full verification and documentation

**Files:**
- Modify: `CLAUDE.md`, `debug.md`

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run test`
Expected: both green. Fix every `Person` fixture the compiler flags — all six new fields are optional, so churn should be minimal; if `tsc` flags many, re-check that no field was accidentally declared required.

- [ ] **Step 2: Confirm the guarantees hold in the code, not just in the tests**

```bash
# No importer touches an override column.
grep -n "accommodationOverride\|amountPaidOverride\|refundAmount" src/services/*import*.ts
#   -> only import.service.ts's isProtected guard.

# The resolved value is never persisted.
grep -n "accommodation_kind:" src/repositories/supabase/supabase.people.ts
#   -> the single personColumns line, reading accommodationKindRaw first.

# The two budget copies still agree.
sed -n '/^function _personValueBase/,/^}/p' public/index.html
sed -n '/^function amountPaidBase/,/^}/p' src/services/budget.ts
```

- [ ] **Step 3: Update `CLAUDE.md`**

Add a new dated section (2026-09-03) covering:
- What was built: the two Data Import cards, the five `0022` columns, cancel/refund semantics.
- **The mapper chokepoint and its raw carrier.** `accommodationKind` on a mapped `Person` is the EFFECTIVE value; `accommodationKindRaw` is what gets persisted. Anyone patching `accommodationKind` on a mapped person must set the raw carrier too, or the edit silently does not persist. Name the four sites that had this bug latent.
- **Cancel does not change the budget.** `includeCancelled` exists for exactly one caller; the five budget-side SPA filters were relaxed and the ops-side ones deliberately were not.
- **`atCamp` and `lifecycle` are orthogonal by design** — the cancel transition couples them for this one case, on purpose, because check-in/warnings/dashboard filter on `atCamp` and never read `lifecycle`. Say so explicitly, or someone will "fix" it back.
- The Form-import sweep guard, and the `ponytail:` note that it is the only thing protecting these five columns from a hard delete.
- The standing rule that `0022` must be applied to prod **before** this code pushes.

- [ ] **Step 4: Update `debug.md`**

Add two entries:
- **The Data Import screen collapsed and jumped to the top on every write.** `_renderAllocCards` rewrote `#allocWrap.innerHTML` wholesale, re-emitting every `<details>` with no `open`; `paint()`'s `samePaint`/`keepY` guard never applies because this bypasses `paint()`. Fixed by adopting `_budRedraw`'s capture/reapply keyed on `data-ac`.
- **Cancelling a registration silently dropped it from the budget.** `isRegistrant` and `isCamper` both exclude `lifecycle: 'cancelled'`, so setting the flag removed the person's money from the totals with no visible cause. Fixed with `includeCancelled` for the budget path only; their value now counts until a refund is recorded.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md debug.md
git commit -m "docs: individual overrides, cancel/refund semantics, and two Data Import traps"
```

---

## Known risks (state these in the final report)

- **The `people`-column choice has a residual ceiling.** Task 9's guard is the only thing between a Form re-import and the loss of an override. A new delete path (another importer, a manual purge, the new-year rollover) would take the records with the person. Upgrade path if it bites: the `allocation_overrides` side-table pattern keyed on `firstNameKey`/`lastNameKey`/`mobileKey` (`src/core/entities/allocation-override.ts:12-18`), which survives a hard delete. A `ponytail:` comment at the guard names this.
- **Two budget implementations must stay in lockstep.** `src/services/budget.ts` is dead server-side; the SPA mirror is what runs. This repo has already been bitten by them diverging. Tasks 4 and 5 are one change in two places.
- **`accommodationKindRaw` is a footgun by construction.** Patching `accommodationKind` on a mapped person without setting the raw carrier silently fails to persist. Mitigated by the mapper round-trip test, the entity comment, and fixes at all four known sites — but a new site would not be caught by the compiler.
- **`atCamp`/`lifecycle` coupling** is deliberate for the cancel transition only, and documented in `CLAUDE.md` so it is not reverted.
- **No way to clear an override once set.** §3.7 specifies the select as blank/tent/classroom with blank meaning "keep existing", so the UI as specified cannot revert an override to "no override". The API accepts `null` for all three fields, so the capability exists server-side — only the UI omits it. Flagged, not built: it is a spec decision, not an oversight.
- **`tsc`/`vitest` cannot prove**: any SPA behaviour (both new cards, the collapse/scroll fix, the three SPA exports, the SPA budget mirror), nor that migration `0022` has been applied to prod. Per this repo's standing convention these are listed for the owner's browser pass.
