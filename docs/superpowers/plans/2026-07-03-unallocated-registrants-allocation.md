# Unallocated Registrants & Church-Allocation Overrides — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins/directors a way to hold "OTHER – please specify" registrants in an *unallocated* pool, allocate them to a real church (or override any registrant's church), and have those manual allocations persist authoritatively across Form re-imports.

**Architecture:** A reserved sentinel church id for unallocated people (no table row, RBAC-invisible to church/zone logins), plus a persistent `AllocationOverride` store consulted by the Form importer at church-resolution time so manual allocations survive the delete-absent sweep and compose with the existing per-church accommodation override.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Express (declarative route table), Zod validation in services, repository pattern (in-memory + JSON + Supabase Postgres), Vitest, vanilla-JS single-file SPA (`public/index.html`).

**Design spec:** `docs/superpowers/specs/2026-07-03-unallocated-registrants-allocation-design.md`

## Global Constraints

- **Extensionless ESM imports**, each folder has an `index.ts` barrel. No `.js` extensions.
- **Strict TypeScript**: guard all indexed access; no unused locals.
- **Validation inside services** with Zod, not controllers. **RBAC only in `src/services/access-control.ts`.**
- **Repos return deep clones** (in-memory base clones on read/write).
- **Sentinel church id is the exact string** `'__unallocated__'`; name `'Unallocated'`.
- **The OTHER literal is exactly** `'OTHER - please specify below'` — matched case-insensitively and trimmed, held in one constant.
- **Conflict rule: manual allocation always wins** silently over the form on every re-import until an admin changes it.
- **Allocation target = existing churches only.** Access = **admin + director** (new `allocation:manage` capability).
- **Verify with `npm run typecheck` + `npm run test`** and reasoning/grep. **Do NOT start a localhost server or drive a browser.** Flag CSS/layout for on-device eyeballing. A push to `master` is the deploy.
- **Migration `020` must be applied to prod before/with deploy** — `supabase.settings` and repos write real columns.
- **Bump `public/sw.js` `CACHE`** whenever `index.html` changes.

---

## File Structure

**Create:**
- `src/core/entities/allocation-override.ts` — the `AllocationOverride` entity interface.
- `src/services/church-allocation.ts` — pure helpers + constants (sentinel id, OTHER literal, identity keys, override match, accommodation-kind helper).
- `src/services/church-allocation.test.ts` — unit tests for the pure helpers.
- `src/services/allocation.service.ts` — list-unallocated / list-overrides / allocate / undo.
- `src/services/allocation.service.test.ts` — service tests.
- `src/api/controllers/allocation.controller.ts` — thin controller.
- `src/repositories/supabase/supabase.allocation-override.ts` — Supabase repo.
- `supabase/migrations/020_allocation_overrides.sql` — new table.

**Modify:**
- `src/repositories/interfaces/entity-repositories.ts` — add `IAllocationOverrideRepository`.
- `src/repositories/in-memory/in-memory.repositories.ts` — add `InMemoryAllocationOverrideRepository`.
- `src/repositories/supabase/index.ts` — export the new Supabase repo.
- `src/container.ts` — instantiate/init/wire the new repo + allocation service; pass override repo into import & admin services.
- `src/services/import.service.ts` — sentinel detection + override redirect + stale prune; reuse the accommodation-kind helper.
- `src/services/admin.service.ts` — purge overrides on reset + new-year.
- `src/services/accommodation.service.ts` — exclude sentinel people from occupants.
- `src/api/http/router.ts` — register 4 allocation routes + controller.
- `public/index.html` — two new cards on `RENDER.import` + handlers.
- `public/sw.js` — cache version bump.

---

## Task 1: Pure helpers, constants & entity

**Files:**
- Create: `src/core/entities/allocation-override.ts`
- Create: `src/services/church-allocation.ts`
- Test: `src/services/church-allocation.test.ts`

**Interfaces:**
- Produces:
  - `UNALLOCATED_CHURCH_ID = '__unallocated__'`, `UNALLOCATED_CHURCH_NAME = 'Unallocated'`, `OTHER_CHURCH_LITERAL = 'other - please specify below'`
  - `isUnlistedChurchCell(cell: string): boolean`
  - `overrideNameKey(first: string, last: string): string`
  - `overrideMobileKey(mobile: string | null | undefined): string`
  - `matchOverride(candidates: AllocationOverride[], rowMobileKey: string): AllocationOverride | 'ambiguous' | null`
  - `accommodationKindForChurch(personKind: PersonKind, currentKind: AccommodationKind | null | undefined, churchOverride: AccommodationKind | null | undefined): AccommodationKind | null`
  - `interface AllocationOverride`

- [ ] **Step 1: Create the entity interface**

Create `src/core/entities/allocation-override.ts`:

```typescript
import type { ID, ISODateString } from '../types/common';

/**
 * A persistent record that a person's church was set MANUALLY by an admin/director,
 * overriding whatever the Form CSV says. Re-applied by the Form importer at
 * church-resolution time (keyed by the person's name + mobile identity, since the CSV
 * carries no stable id), so a manual allocation survives re-imports and the delete-absent
 * sweep. Purged by reset / new-year (transient per-season data).
 */
export interface AllocationOverride {
  id: ID;
  /** Current person pointer — stable within a season because the import redirect keeps the row matched to this record. */
  personId: ID;
  /** Normalized identity used to re-apply on re-import (the CSV has no person id). */
  firstNameKey: string;
  lastNameKey: string;
  /** Normalized mobile digits; '' when the person had no mobile. Disambiguates duplicate names. */
  mobileKey: string;
  assignedChurchId: ID;
  assignedChurchName: string;
  /** What the form said — the OTHER literal (unallocated) or the wrong church name (override). Powers the "differs from forms" list + undo. */
  formChurch: string;
  kind: 'unallocated' | 'override';
  /** churchUnlistedNote snapshot for display. */
  note: string | null;
  /** actor.displayName who made the allocation. */
  createdBy: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/church-allocation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AllocationOverride } from '../core/entities/allocation-override';
import {
  UNALLOCATED_CHURCH_ID,
  isUnlistedChurchCell,
  overrideNameKey,
  overrideMobileKey,
  matchOverride,
  accommodationKindForChurch,
} from './church-allocation';

function ov(partial: Partial<AllocationOverride>): AllocationOverride {
  return {
    id: 'o1', personId: 'p1', firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '',
    assignedChurchId: 'c1', assignedChurchName: 'Grace', formChurch: 'OTHER - please specify below',
    kind: 'unallocated', note: null, createdBy: 'admin', createdAt: 'x', updatedAt: 'x', ...partial,
  };
}

describe('church-allocation helpers', () => {
  it('detects the OTHER literal case-insensitively and blank cells', () => {
    expect(isUnlistedChurchCell('OTHER - please specify below')).toBe(true);
    expect(isUnlistedChurchCell('  other - PLEASE specify below ')).toBe(true);
    expect(isUnlistedChurchCell('')).toBe(true);
    expect(isUnlistedChurchCell('Grace Point Church')).toBe(false);
  });

  it('normalizes identity keys', () => {
    expect(overrideNameKey(' John ', 'SMITH')).toBe('john::smith');
    expect(overrideMobileKey('0411 928 301')).toBe('0411928301');
    expect(overrideMobileKey(null)).toBe('');
  });

  it('matches a single candidate by name when mobiles are absent', () => {
    const c = [ov({ mobileKey: '' })];
    expect(matchOverride(c, '')).toBe(c[0]);
    expect(matchOverride([], '0411928301')).toBeNull();
  });

  it('disambiguates same-name candidates by mobile', () => {
    const a = ov({ id: 'a', mobileKey: '0411928301' });
    const b = ov({ id: 'b', mobileKey: '0422000000' });
    expect(matchOverride([a, b], '0411928301')).toBe(a);
    expect(matchOverride([a, b], '0399999999')).toBeNull();
  });

  it('returns "ambiguous" when identical name+mobile candidates collide', () => {
    const a = ov({ id: 'a', mobileKey: '' });
    const b = ov({ id: 'b', mobileKey: '' });
    expect(matchOverride([a, b], '')).toBe('ambiguous');
  });

  it('applies a church accommodation override only to youth', () => {
    expect(accommodationKindForChurch('youth', 'tent', 'classroom')).toBe('classroom');
    expect(accommodationKindForChurch('leader', 'tent', 'classroom')).toBe('tent');
    expect(accommodationKindForChurch('youth', 'tent', null)).toBe('tent');
    expect(accommodationKindForChurch('youth', null, null)).toBeNull();
  });

  it('exposes the sentinel constant', () => {
    expect(UNALLOCATED_CHURCH_ID).toBe('__unallocated__');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/services/church-allocation.test.ts`
Expected: FAIL — `Cannot find module './church-allocation'`.

- [ ] **Step 4: Implement the helpers**

Create `src/services/church-allocation.ts`:

```typescript
import type { AllocationOverride } from '../core/entities/allocation-override';
import type { AccommodationKind, PersonKind } from '../core/types/enums';

/** Reserved sentinel church for registrants with no church yet. NOT a churches-table row. */
export const UNALLOCATED_CHURCH_ID = '__unallocated__';
export const UNALLOCATED_CHURCH_NAME = 'Unallocated';

/** The exact "Attendee's Church" value produced when a registrant picks the OTHER option (lower-cased). */
export const OTHER_CHURCH_LITERAL = 'other - please specify below';

/** True when the church cell means "no listed church" — the OTHER literal or blank. */
export function isUnlistedChurchCell(cell: string): boolean {
  const v = cell.trim().toLowerCase();
  return v === '' || v === OTHER_CHURCH_LITERAL;
}

export function overrideNameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}::${last.trim().toLowerCase()}`;
}

export function overrideMobileKey(mobile: string | null | undefined): string {
  return (mobile ?? '').replace(/\D/g, '');
}

/**
 * Pick the override that applies to a CSV row from the candidates sharing the row's name key.
 * - A candidate with a mobileKey matches only when the row's mobile matches it.
 * - A candidate without a mobileKey matches only a row that also has no mobile.
 * Exactly one match → that override; zero matches → null; >1 → 'ambiguous' (skip, don't guess).
 */
export function matchOverride(
  candidates: AllocationOverride[],
  rowMobileKey: string,
): AllocationOverride | 'ambiguous' | null {
  if (candidates.length === 0) return null;
  const matches = candidates.filter((c) => (c.mobileKey ? c.mobileKey === rowMobileKey : rowMobileKey === ''));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) return null;
  return 'ambiguous';
}

/**
 * The accommodation kind a person should have once placed in a church. Mirrors the Form
 * importer's rule (church accommodation override forces STUDENTS/youth; leaders keep their
 * value). Shared so import-time and allocate-time never diverge.
 */
export function accommodationKindForChurch(
  personKind: PersonKind,
  currentKind: AccommodationKind | null | undefined,
  churchOverride: AccommodationKind | null | undefined,
): AccommodationKind | null {
  if (personKind === 'youth' && churchOverride) return churchOverride;
  return currentKind ?? null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/services/church-allocation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck & commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/core/entities/allocation-override.ts src/services/church-allocation.ts src/services/church-allocation.test.ts
git commit -m "feat: allocation-override entity + pure church-allocation helpers"
```

---

## Task 2: AllocationOverride repository + migration + container wiring

**Files:**
- Modify: `src/repositories/interfaces/entity-repositories.ts`
- Modify: `src/repositories/in-memory/in-memory.repositories.ts`
- Create: `src/repositories/supabase/supabase.allocation-override.ts`
- Modify: `src/repositories/supabase/index.ts`
- Create: `supabase/migrations/020_allocation_overrides.sql`
- Modify: `src/container.ts`
- Test: `src/repositories/in-memory/allocation-override.repository.test.ts`

**Interfaces:**
- Consumes: `AllocationOverride` (Task 1).
- Produces: `IAllocationOverrideRepository` (base CRUD + `findByPersonId`), `InMemoryAllocationOverrideRepository`, `SupabaseAllocationOverrideRepository`; `container.repos.allocationOverrides`.

- [ ] **Step 1: Add the repository interface**

In `src/repositories/interfaces/entity-repositories.ts`, add the import and interface (place the interface after `IChurchRepository`):

```typescript
import type { AllocationOverride } from '../../core/entities/allocation-override';
```

```typescript
export interface IAllocationOverrideRepository extends IRepository<AllocationOverride> {
  findByPersonId(personId: string): Promise<AllocationOverride | null>;
}
```

- [ ] **Step 2: Write the failing in-memory repo test**

Create `src/repositories/in-memory/allocation-override.repository.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { InMemoryAllocationOverrideRepository } from './in-memory.repositories';
import type { AllocationOverride } from '../../core/entities/allocation-override';

function mk(id: string, personId: string): AllocationOverride {
  return {
    id, personId, firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '',
    assignedChurchId: 'c1', assignedChurchName: 'Grace', formChurch: 'OTHER - please specify below',
    kind: 'unallocated', note: null, createdBy: 'admin', createdAt: 'x', updatedAt: 'x',
  };
}

describe('InMemoryAllocationOverrideRepository', () => {
  it('finds an override by person id and deletes all', async () => {
    const repo = new InMemoryAllocationOverrideRepository();
    await repo.init();
    await repo.save(mk('o1', 'p1'));
    await repo.save(mk('o2', 'p2'));
    expect((await repo.findByPersonId('p2'))?.id).toBe('o2');
    expect(await repo.findByPersonId('nope')).toBeNull();
    expect(await repo.deleteAll()).toBe(2);
    expect(await repo.findAll()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/repositories/in-memory/allocation-override.repository.test.ts`
Expected: FAIL — `InMemoryAllocationOverrideRepository` not exported.

- [ ] **Step 4: Implement the in-memory repo**

In `src/repositories/in-memory/in-memory.repositories.ts`: add the type import and interface import, then the class (append at the end of the file, before any trailing content):

```typescript
import type { AllocationOverride } from '../../core/entities/allocation-override';
```
Add `IAllocationOverrideRepository` to the existing `import type { ... } from '../interfaces/entity-repositories'` block.

```typescript
// ---------------------------------------------------------------------------
// Allocation overrides (manual church allocations that survive re-imports)
// ---------------------------------------------------------------------------
export class InMemoryAllocationOverrideRepository
  extends InMemoryBaseRepository<AllocationOverride>
  implements IAllocationOverrideRepository
{
  constructor(persistence?: IPersistenceAdapter<AllocationOverride>) {
    super(persistence);
  }

  async findByPersonId(personId: string): Promise<AllocationOverride | null> {
    for (const o of this.store.values()) {
      if (o.personId === personId) return this.clone(o);
    }
    return null;
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/repositories/in-memory/allocation-override.repository.test.ts`
Expected: PASS.

- [ ] **Step 6: Create the migration**

Create `supabase/migrations/020_allocation_overrides.sql`:

```sql
-- 020: Church allocation overrides.
--
-- Persistent record that a person's church was set MANUALLY (allocating an "OTHER –
-- please specify" registrant, or overriding a wrong church). The Form importer re-applies
-- these by name+mobile identity so a manual allocation wins on every re-import and is not
-- deleted by the delete-absent sweep. Purged by reset / new-year.
create table if not exists allocation_overrides (
  id text primary key,
  person_id text not null,
  first_name_key text not null default '',
  last_name_key text not null default '',
  mobile_key text not null default '',
  assigned_church_id text not null,
  assigned_church_name text not null default '',
  form_church text not null default '',
  kind text not null default 'unallocated',
  note text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 7: Implement the Supabase repo**

Create `src/repositories/supabase/supabase.allocation-override.ts`:

```typescript
import type { SqlClient } from './client';
import type { IAllocationOverrideRepository } from '../interfaces/entity-repositories';
import type { AllocationOverride } from '../../core/entities/allocation-override';

function toRow(r: Record<string, unknown>): AllocationOverride {
  return {
    id: r['id'] as string,
    personId: r['person_id'] as string,
    firstNameKey: (r['first_name_key'] as string) ?? '',
    lastNameKey: (r['last_name_key'] as string) ?? '',
    mobileKey: (r['mobile_key'] as string) ?? '',
    assignedChurchId: r['assigned_church_id'] as string,
    assignedChurchName: (r['assigned_church_name'] as string) ?? '',
    formChurch: (r['form_church'] as string) ?? '',
    kind: (r['kind'] as AllocationOverride['kind']) ?? 'unallocated',
    note: (r['note'] as string | null) ?? null,
    createdBy: (r['created_by'] as string) ?? '',
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

function cols(o: AllocationOverride): Record<string, unknown> {
  return {
    id: o.id, person_id: o.personId, first_name_key: o.firstNameKey, last_name_key: o.lastNameKey,
    mobile_key: o.mobileKey, assigned_church_id: o.assignedChurchId, assigned_church_name: o.assignedChurchName,
    form_church: o.formChurch, kind: o.kind, note: o.note ?? null, created_by: o.createdBy,
    created_at: o.createdAt, updated_at: o.updatedAt,
  };
}

const UPDATE_COLS = [
  'person_id', 'first_name_key', 'last_name_key', 'mobile_key', 'assigned_church_id',
  'assigned_church_name', 'form_church', 'kind', 'note', 'created_by', 'updated_at',
] as const;

export class SupabaseAllocationOverrideRepository implements IAllocationOverrideRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findAll(): Promise<AllocationOverride[]> {
    return (await this.sql`select * from allocation_overrides`).map(toRow);
  }

  async findById(id: string): Promise<AllocationOverride | null> {
    const rows = await this.sql`select * from allocation_overrides where id = ${id}`;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async findByPersonId(personId: string): Promise<AllocationOverride | null> {
    const rows = await this.sql`select * from allocation_overrides where person_id = ${personId} limit 1`;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async save(o: AllocationOverride): Promise<AllocationOverride> {
    const c = cols(o);
    await this.sql`
      insert into allocation_overrides ${this.sql(c)}
      on conflict (id) do update set ${this.sql(c, ...UPDATE_COLS)}
    `;
    return o;
  }

  async saveMany(rows: AllocationOverride[]): Promise<AllocationOverride[]> {
    for (const r of rows) await this.save(r);
    return rows;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from allocation_overrides where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from allocation_overrides returning id`;
    return rows.length;
  }
}
```

Add to `src/repositories/supabase/index.ts`:

```typescript
export { SupabaseAllocationOverrideRepository } from './supabase.allocation-override';
```

- [ ] **Step 8: Wire the repo into the container**

In `src/container.ts`:

1. Add to the in-memory import block: `InMemoryAllocationOverrideRepository`.
2. Add to the supabase import block: `SupabaseAllocationOverrideRepository`.
3. Add to the interfaces import block: `IAllocationOverrideRepository`.
4. Add the entity type import: `import type { AllocationOverride } from './core/entities/allocation-override';`
5. Add to the `Repositories` interface: `allocationOverrides: IAllocationOverrideRepository;`
6. In the **supabase branch**: instantiate `const allocationOverrides: IAllocationOverrideRepository = new SupabaseAllocationOverrideRepository(sql);`, add `allocationOverrides` to the `repos` object, and add `allocationOverrides.init()` to that branch's `Promise.all([...])`.
7. In the **in-memory/json branch**: instantiate
   ```typescript
   const allocationOverrides: IAllocationOverrideRepository = new InMemoryAllocationOverrideRepository(
     useJson ? makeJsonPersistence<AllocationOverride>('allocation-overrides.json') : undefined,
   );
   ```
   add `allocationOverrides` to the `repos` object, and add `allocationOverrides.init()` to that branch's `Promise.all([...])`.

- [ ] **Step 9: Typecheck, run full suite, commit**

Run: `npm run typecheck` — Expected: no errors.
Run: `npm run test` — Expected: all pass (previous count + new tests).

```bash
git add src/repositories supabase/migrations/020_allocation_overrides.sql src/container.ts
git commit -m "feat: AllocationOverride repository, migration 020, container wiring"
```

---

## Task 3: RBAC capability + allocation service + controller + routes

**Files:**
- Modify: `src/services/access-control.ts`
- Create: `src/services/allocation.service.ts`
- Create: `src/api/controllers/allocation.controller.ts`
- Modify: `src/api/http/router.ts`
- Modify: `src/container.ts`
- Test: `src/services/allocation.service.test.ts`

**Interfaces:**
- Consumes: `IPersonRepository`, `IChurchRepository`, `IAllocationOverrideRepository`; `church-allocation` helpers. **The service must NOT import from `src/api/` (layering) — it returns `Person[]`; the controller maps to `RegistrantDto`.**
- Produces:
  - `AllocationService` with `listUnallocated(actor): Promise<Person[]>`, `listOverrides(actor)`, `allocate(actor, input)`, `removeOverride(actor, id)`
  - `makeAllocationService(personRepo, churchRepo, overrideRepo)`
  - `AllocationOverrideDto`
  - Routes: `GET /import/unallocated`, `GET /import/allocations`, `POST /import/allocate`, `DELETE /import/allocations/:id`

- [ ] **Step 1: Add the RBAC capability**

In `src/services/access-control.ts`: add `| 'allocation:manage'` to the `Action` union (next to `'import:run'`), and add `'allocation:manage'` to the `director` and `admin` permission sets (right after their `'import:run'` entry). Do NOT add it to any other role.

- [ ] **Step 2: Write the failing service test**

Create `src/services/allocation.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { makeAllocationService } from './allocation.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import { UNALLOCATED_CHURCH_ID, UNALLOCATED_CHURCH_NAME } from './church-allocation';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';

const admin: Actor = { id: 'u1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' };
const church: Actor = { id: 'u2', role: 'church', churchId: 'c1', churchName: 'Grace', zone: 'Blue', displayName: 'Grace' };

function person(over: Partial<Person>): Person {
  return {
    id: 'p1', firstName: 'John', lastName: 'Smith', gender: 'male', kind: 'youth',
    churchId: UNALLOCATED_CHURCH_ID, churchName: UNALLOCATED_CHURCH_NAME, zone: '',
    medicalConditions: [], dietaryRequirements: [], mobile: '0411928301',
    churchUnlistedNote: 'Hope Church, Ps Josh', consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
    paymentStatus: 'unpaid', needsReview: false, lifecycle: 'registered', atCamp: false,
    checkInHistory: [], signOutHistory: [], createdAt: 't', updatedAt: 't', ...over,
  } as Person;
}

function grace(): Church {
  return {
    id: 'c1', name: 'Grace Point', zone: 'Blue',
    contacts: { male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } }, female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } } },
    createdAt: 't', updatedAt: 't',
  } as Church;
}

async function setup() {
  const people = new InMemoryPersonRepository(); await people.init();
  const churches = new InMemoryChurchRepository(); await churches.init();
  const overrides = new InMemoryAllocationOverrideRepository(); await overrides.init();
  await churches.save(grace());
  const svc = makeAllocationService(people, churches, overrides);
  return { people, churches, overrides, svc };
}

describe('allocation service', () => {
  it('lists unallocated registrants', async () => {
    const { people, svc } = await setup();
    await people.save(person({}));
    await people.save(person({ id: 'p2', churchId: 'c1', churchName: 'Grace Point' }));
    const un = await svc.listUnallocated(admin);
    expect(un.map((r) => r.id)).toEqual(['p1']);
    expect(un[0]!.churchUnlistedNote).toContain('Hope');
  });

  it('allocates an unallocated person and records an override', async () => {
    const { people, overrides, svc } = await setup();
    await people.save(person({}));
    const dto = await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    expect(dto.kind).toBe('unallocated');
    const p = await people.findById('p1');
    expect(p!.churchId).toBe('c1');
    expect(p!.churchName).toBe('Grace Point');
    expect(p!.zone).toBe('Blue');
    expect(await overrides.findByPersonId('p1')).not.toBeNull();
  });

  it('records an override (kind=override) when reassigning a real church, keeping the original formChurch', async () => {
    const { people, svc } = await setup();
    await people.save(person({ churchId: 'cX', churchName: 'Wrong Church', zone: 'Red' }));
    const dto = await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    expect(dto.kind).toBe('override');
    expect(dto.formChurch).toBe('Wrong Church');
  });

  it('undo of an unallocated allocation returns the person to the sentinel', async () => {
    const { people, svc } = await setup();
    await people.save(person({}));
    const dto = await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    await svc.removeOverride(admin, dto.id);
    const p = await people.findById('p1');
    expect(p!.churchId).toBe(UNALLOCATED_CHURCH_ID);
    expect(await svc.listOverrides(admin)).toEqual([]);
  });

  it('forbids church logins', async () => {
    const { svc } = await setup();
    await expect(svc.listUnallocated(church)).rejects.toThrow();
    await expect(svc.allocate(church, { personId: 'p1', churchId: 'c1' })).rejects.toThrow();
  });

  it('rejects allocating to the sentinel church', async () => {
    const { people, svc } = await setup();
    await people.save(person({}));
    await expect(svc.allocate(admin, { personId: 'p1', churchId: UNALLOCATED_CHURCH_ID })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/services/allocation.service.test.ts`
Expected: FAIL — `makeAllocationService` not found.

- [ ] **Step 4: Implement the allocation service**

Create `src/services/allocation.service.ts`:

```typescript
import { z } from 'zod';
import type { IPersonRepository, IChurchRepository, IAllocationOverrideRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { AllocationOverride } from '../core/entities/allocation-override';
import { assertCan } from './access-control';
import { BadRequestError, NotFoundError } from '../core/errors/app-error';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { invalidateDashboardCache } from './dashboard-cache';
import type { Person } from '../core/entities/person';
import {
  UNALLOCATED_CHURCH_ID, UNALLOCATED_CHURCH_NAME, OTHER_CHURCH_LITERAL,
  overrideNameKey, overrideMobileKey, accommodationKindForChurch,
} from './church-allocation';

export interface AllocationOverrideDto {
  id: string;
  personId: string;
  personName: string;
  formChurch: string;
  assignedChurchId: string;
  assignedChurchName: string;
  kind: 'unallocated' | 'override';
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationService {
  listUnallocated(actor: Actor): Promise<Person[]>;
  listOverrides(actor: Actor): Promise<AllocationOverrideDto[]>;
  allocate(actor: Actor, input: unknown): Promise<AllocationOverrideDto>;
  removeOverride(actor: Actor, id: string): Promise<{ ok: true }>;
}

const AllocateSchema = z.object({
  personId: z.string().min(1),
  churchId: z.string().min(1),
});

export function makeAllocationService(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
  overrideRepo: IAllocationOverrideRepository,
): AllocationService {
  function toDto(o: AllocationOverride, personName: string): AllocationOverrideDto {
    return {
      id: o.id, personId: o.personId, personName,
      formChurch: o.formChurch, assignedChurchId: o.assignedChurchId, assignedChurchName: o.assignedChurchName,
      kind: o.kind, note: o.note, createdBy: o.createdBy, createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
  }

  return {
    async listUnallocated(actor): Promise<Person[]> {
      assertCan(actor, 'allocation:manage');
      const people = await personRepo.findByChurch(UNALLOCATED_CHURCH_ID);
      return people.filter((p) => p.lifecycle !== 'cancelled');
    },

    async listOverrides(actor) {
      assertCan(actor, 'allocation:manage');
      const overrides = await overrideRepo.findAll();
      const dtos: AllocationOverrideDto[] = [];
      for (const o of overrides) {
        const p = await personRepo.findById(o.personId);
        const name = p ? `${p.firstName} ${p.lastName}` : `${o.firstNameKey} ${o.lastNameKey}`;
        dtos.push(toDto(o, name));
      }
      return dtos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async allocate(actor, input) {
      assertCan(actor, 'allocation:manage');
      const { personId, churchId } = AllocateSchema.parse(input);
      if (churchId === UNALLOCATED_CHURCH_ID) {
        throw new BadRequestError('Cannot allocate to the unallocated pool — use Undo instead');
      }
      const person = await personRepo.findById(personId);
      if (!person) throw new NotFoundError('Person not found');
      const church = await churchRepo.findById(churchId);
      if (!church) throw new NotFoundError('Church not found');

      const wasUnallocated = person.churchId === UNALLOCATED_CHURCH_ID;
      const now = nowISO();

      // Apply church + zone + (student) accommodation override immediately.
      const accommodationKind = accommodationKindForChurch(person.kind, person.accommodationKind, church.accommodationOverride ?? null);
      const forcedAccom = person.kind === 'youth' && !!church.accommodationOverride;
      await personRepo.save({
        ...person,
        churchId: church.id,
        churchName: church.name,
        zone: church.zone,
        accommodationKind,
        accommodationKindConfidence: forcedAccom ? 'confirmed' : person.accommodationKindConfidence,
        updatedAt: now,
      });

      // Upsert the override (keyed by the person). Preserve the original formChurch/kind/createdAt.
      const existing = await overrideRepo.findByPersonId(personId);
      const formChurch = existing?.formChurch
        ?? (wasUnallocated ? OTHER_CHURCH_LITERAL : person.churchName);
      const saved: AllocationOverride = {
        id: existing?.id ?? newId('override'),
        personId,
        firstNameKey: overrideNameKey(person.firstName, person.lastName).split('::')[0]!,
        lastNameKey: overrideNameKey(person.firstName, person.lastName).split('::')[1]!,
        mobileKey: overrideMobileKey(person.mobile),
        assignedChurchId: church.id,
        assignedChurchName: church.name,
        formChurch,
        kind: existing?.kind ?? (wasUnallocated ? 'unallocated' : 'override'),
        note: person.churchUnlistedNote ?? null,
        createdBy: actor.displayName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await overrideRepo.save(saved);
      invalidateDashboardCache();
      return toDto(saved, `${person.firstName} ${person.lastName}`);
    },

    async removeOverride(actor, id) {
      assertCan(actor, 'allocation:manage');
      const o = await overrideRepo.findById(id);
      if (!o) throw new NotFoundError('Override not found');
      const person = await personRepo.findById(o.personId);
      if (person) {
        if (o.kind === 'override') {
          // Return them to the church their form named, if it still exists; else unallocated.
          const churches = await churchRepo.findAll();
          const target = churches.find((c) => c.name.toLowerCase() === o.formChurch.trim().toLowerCase());
          if (target) {
            await personRepo.save({ ...person, churchId: target.id, churchName: target.name, zone: target.zone, updatedAt: nowISO() });
          } else {
            await personRepo.save({ ...person, churchId: UNALLOCATED_CHURCH_ID, churchName: UNALLOCATED_CHURCH_NAME, zone: '', updatedAt: nowISO() });
          }
        } else {
          await personRepo.save({ ...person, churchId: UNALLOCATED_CHURCH_ID, churchName: UNALLOCATED_CHURCH_NAME, zone: '', updatedAt: nowISO() });
        }
      }
      await overrideRepo.delete(id);
      invalidateDashboardCache();
      return { ok: true };
    },
  };
}
```

- [ ] **Step 5: Run the service test to verify it passes**

Run: `npx vitest run src/services/allocation.service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Create the controller**

Create `src/api/controllers/allocation.controller.ts`:

```typescript
import type { HttpRequest } from '../http/types';
import type { AllocationService } from '../../services/allocation.service';
import { toRegistrantDto } from '../dto/person.dto';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface AllocationControllerServices {
  allocation: AllocationService;
}

export function makeAllocationController(services: AllocationControllerServices) {
  return {
    async listUnallocated(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      // Service returns Person[]; the controller owns the DTO mapping (layering).
      return (await services.allocation.listUnallocated(req.ctx.actor)).map(toRegistrantDto);
    },
    async listOverrides(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.allocation.listOverrides(req.ctx.actor);
    },
    async allocate(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.allocation.allocate(req.ctx.actor, req.body);
    },
    async removeOverride(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing override id');
      return services.allocation.removeOverride(req.ctx.actor, id);
    },
  };
}
```

> This mirrors `registrant.controller.ts` exactly: services return entities, the controller maps with `toRegistrantDto`, and params use bracket access (`req.params['id']`).

- [ ] **Step 7: Wire the service + controller + routes**

In `src/container.ts`:
1. Import: `import { makeAllocationService, type AllocationService } from './services/allocation.service';`
2. Add `allocation: AllocationService;` to the `Services` interface.
3. In **both** branches, after the other service constructors: `const allocation = makeAllocationService(people, churches, allocationOverrides);` and add `allocation` to the `services` object.

In `src/api/http/router.ts`:
1. Import: `import { makeAllocationController } from '../controllers/allocation.controller';`
2. In `buildRoutes`, after the other controllers: `const allocationCtrl = makeAllocationController({ allocation: services.allocation });`
3. Add these routes in the `// ----- Import -----` group:

```typescript
    { method: 'GET', path: '/import/unallocated', auth: true, handler: (r) => allocationCtrl.listUnallocated(r) },
    { method: 'GET', path: '/import/allocations', auth: true, handler: (r) => allocationCtrl.listOverrides(r) },
    { method: 'POST', path: '/import/allocate', auth: true, handler: (r) => allocationCtrl.allocate(r) },
    { method: 'DELETE', path: '/import/allocations/:id', auth: true, handler: (r) => allocationCtrl.removeOverride(r) },
```

- [ ] **Step 8: Typecheck, run full suite, commit**

Run: `npm run typecheck` — Expected: no errors.
Run: `npm run test` — Expected: all pass.

```bash
git add src/services/access-control.ts src/services/allocation.service.ts src/services/allocation.service.test.ts src/api/controllers/allocation.controller.ts src/api/http/router.ts src/container.ts
git commit -m "feat: allocation service, controller, routes + allocation:manage RBAC"
```

---

## Task 4: Form-importer integration (sentinel + override redirect + prune)

**Files:**
- Modify: `src/services/import.service.ts`
- Modify: `src/container.ts`
- Test: `src/services/import.service.test.ts` (extend)

**Interfaces:**
- Consumes: `IAllocationOverrideRepository`; `church-allocation` helpers.
- Produces: `makeImportService(personRepo, churchRepo, overrideRepo)` — **signature gains a third parameter.**

- [ ] **Step 1: Write the failing regression tests**

Append to `src/services/import.service.test.ts` (reuse the file's existing helpers/imports; add these imports at the top if missing: `InMemoryAllocationOverrideRepository` from `../repositories/in-memory`, and `UNALLOCATED_CHURCH_ID` from `./church-allocation`). If the existing tests call `makeImportService(people, churches)`, they must be updated to pass a third `overrides` repo (see Step 3).

```typescript
describe('import: unallocated + overrides', () => {
  const admin = { id: 'u1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' } as const;

  const HEADER = "First Name,Last Name,Gender,School Grade,Mobile Number,Attendee's Church,If from a church not listed, please specify church name & Youth Pastor";

  async function build() {
    const { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } = await import('../repositories/in-memory');
    const people = new InMemoryPersonRepository(); await people.init();
    const churches = new InMemoryChurchRepository(); await churches.init();
    const overrides = new InMemoryAllocationOverrideRepository(); await overrides.init();
    const { makeImportService } = await import('./import.service');
    return { people, churches, overrides, svc: makeImportService(people, churches, overrides) };
  }

  it('routes an OTHER registrant to the unallocated sentinel instead of creating a junk church', async () => {
    const { people, churches, svc } = await build();
    const csv = `${HEADER}\nJohn,Smith,Male,9,0411928301,OTHER - please specify below,Hope Church Ps Josh`;
    await svc.importCsv(admin, { csvData: csv, updateExisting: true });
    const all = await people.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.churchId).toBe(UNALLOCATED_CHURCH_ID);
    expect(all[0]!.zone).toBe('');
    // No church named after the OTHER literal was created.
    expect((await churches.findAll()).some((c) => c.name.toLowerCase().includes('other'))).toBe(false);
  });

  it('re-applies a saved override on re-import: person keeps their church, is not deleted or duplicated', async () => {
    const { people, churches, overrides, svc } = await build();
    const grace = { id: 'c1', name: 'Grace Point', zone: 'Blue', contacts: { male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } }, female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } } }, createdAt: 't', updatedAt: 't' } as import('../core/entities/church').Church;
    await churches.save(grace);

    // First import: John lands unallocated.
    const csv = `${HEADER}\nJohn,Smith,Male,9,0411928301,OTHER - please specify below,Hope`;
    await svc.importCsv(admin, { csvData: csv, updateExisting: true });
    const john = (await people.findAll())[0]!;

    // Admin allocates John to Grace Point (simulate the override store + person move).
    await people.save({ ...john, churchId: 'c1', churchName: 'Grace Point', zone: 'Blue' });
    await overrides.save({
      id: 'o1', personId: john.id, firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '0411928301',
      assignedChurchId: 'c1', assignedChurchName: 'Grace Point', formChurch: 'OTHER - please specify below',
      kind: 'unallocated', note: null, createdBy: 'Admin', createdAt: 't', updatedAt: 't',
    });

    // Re-import the SAME form (John's row still says OTHER).
    await svc.importCsv(admin, { csvData: csv, updateExisting: true });

    const after = await people.findAll();
    expect(after).toHaveLength(1);                 // no duplicate
    expect(after[0]!.id).toBe(john.id);            // same person, updated in place
    expect(after[0]!.churchId).toBe('c1');         // manual church retained
    expect(after[0]!.zone).toBe('Blue');
    expect(await overrides.findAll()).toHaveLength(1); // override not pruned (person still present)
  });

  it('prunes an override when its person withdraws (absent from the re-imported file)', async () => {
    const { people, overrides, svc } = await build();
    const csv1 = `${HEADER}\nJohn,Smith,Male,9,0411928301,OTHER - please specify below,Hope`;
    await svc.importCsv(admin, { csvData: csv1, updateExisting: true });
    const john = (await people.findAll())[0]!;
    await overrides.save({
      id: 'o1', personId: john.id, firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '0411928301',
      assignedChurchId: 'c1', assignedChurchName: 'Grace Point', formChurch: 'OTHER - please specify below',
      kind: 'unallocated', note: null, createdBy: 'Admin', createdAt: 't', updatedAt: 't',
    });
    // Re-import with John absent (empty roster row for someone else).
    const csv2 = `${HEADER}\nMary,Jones,Female,10,0422000000,Grace Point,`;
    await svc.importCsv(admin, { csvData: csv2, updateExisting: true });
    expect(await overrides.findAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/import.service.test.ts`
Expected: FAIL — `makeImportService` expects 2 args / sentinel logic not present.

- [ ] **Step 3: Update the import service signature & imports**

In `src/services/import.service.ts`:
1. Add to imports:
   ```typescript
   import type { IAllocationOverrideRepository } from '../repositories/interfaces/entity-repositories';
   import {
     UNALLOCATED_CHURCH_ID, UNALLOCATED_CHURCH_NAME, isUnlistedChurchCell,
     overrideNameKey, overrideMobileKey, matchOverride,
   } from './church-allocation';
   import type { AllocationOverride } from '../core/entities/allocation-override';
   ```
2. Change the factory signature:
   ```typescript
   export function makeImportService(
     personRepo: IPersonRepository,
     churchRepo: IChurchRepository,
     overrideRepo: IAllocationOverrideRepository,
   ): ImportService {
   ```

- [ ] **Step 4: Build the override index (after `poolByNameChurch` is built, ~line 93)**

Insert:

```typescript
      const overrides = await overrideRepo.findAll();
      const overridesByName = new Map<string, AllocationOverride[]>();
      for (const o of overrides) {
        const k = `${o.firstNameKey}::${o.lastNameKey}`;
        const list = overridesByName.get(k);
        if (list) list.push(o);
        else overridesByName.set(k, [o]);
      }
```

- [ ] **Step 5: Replace church resolution in the row loop**

Find the current block (grep for `const churchName = field(row, "Attendee's Church"`, ~line 172). Keep the `churchName` and `churchUnlistedNote` lines. **Delete** the three lines that compute `explicitChurchId` and `resolvedChurchId` (~174-178). Then, **after** `const mobile = field(row, 'Mobile Number', 'mobile', 'Mobile') || null;` (~line 190), insert:

```typescript
          // ----- Church resolution (override → explicit → unlisted-sentinel → by-name) -----
          const explicitChurchId = field(row, 'churchId', 'church_id') || opts.churchId || '';
          const rowMobileKey = overrideMobileKey(mobile);
          const ovCandidates = overridesByName.get(overrideNameKey(firstName, lastName)) ?? [];
          const ovMatch = matchOverride(ovCandidates, rowMobileKey);
          let resolvedChurchId: string;
          let resolvedChurchName: string;
          if (ovMatch === 'ambiguous') {
            warnings.push({ row: rowNum, message: `Manual allocation for "${firstName} ${lastName}" skipped — duplicate name/mobile can't be disambiguated` });
          }
          if (ovMatch && ovMatch !== 'ambiguous') {
            resolvedChurchId = ovMatch.assignedChurchId;
            resolvedChurchName = ovMatch.assignedChurchName;
            warnings.push({ row: rowNum, message: `Church forced to "${resolvedChurchName}" by manual allocation` });
          } else if (explicitChurchId) {
            resolvedChurchId = explicitChurchId;
            resolvedChurchName = churchName || explicitChurchId;
          } else if (isUnlistedChurchCell(churchName)) {
            resolvedChurchId = UNALLOCATED_CHURCH_ID;
            resolvedChurchName = UNALLOCATED_CHURCH_NAME;
          } else {
            resolvedChurchId = await resolveChurch(churchName, rowNum, now);
            resolvedChurchName = churchName;
          }
```

- [ ] **Step 6: Fix zone + churchName usages downstream**

1. Change the `zone` line (~208) to keep sentinel people out of every zone:
   ```typescript
   const zone = resolvedChurchId === UNALLOCATED_CHURCH_ID ? '' : (churchZoneById.get(resolvedChurchId) ?? 'Yellow');
   ```
2. In the **create** branch, change `churchName: churchName || resolvedChurchId,` to:
   ```typescript
   churchName: resolvedChurchName,
   ```
   (Grep the file for any other bare `churchName` used to *write* the person and replace with `resolvedChurchName`; the raw cell variable `churchName` is still fine as the source for `resolveChurch`/`resolvedChurchName`.)

- [ ] **Step 7: Prune stale overrides after the delete-absent sweep**

Find the persistence block (~line 379). After the `for (const id of absentIds) await personRepo.delete(id);` line, still inside `if (!opts.dryRun) {`, add:

```typescript
        const absentSet = new Set(absentIds);
        for (const o of overrides) {
          if (absentSet.has(o.personId)) await overrideRepo.delete(o.id);
        }
```

- [ ] **Step 8: Update the container call sites**

In `src/container.ts`, change **both** `makeImportService(people, churches)` calls (supabase branch ~183, in-memory branch ~299) to `makeImportService(people, churches, allocationOverrides)`.

- [ ] **Step 9: Run the import tests, then the full suite**

Run: `npx vitest run src/services/import.service.test.ts`
Expected: PASS (existing + 3 new).
Run: `npm run typecheck && npm run test`
Expected: no type errors; all pass.

> If pre-existing import tests fail because they call `makeImportService(people, churches)`, update each call to pass an `InMemoryAllocationOverrideRepository` instance (create + `await init()` in the test setup). This is a required, mechanical fix.

- [ ] **Step 10: Commit**

```bash
git add src/services/import.service.ts src/services/import.service.test.ts src/container.ts
git commit -m "feat: Form importer routes OTHER to unallocated sentinel + re-applies manual allocations"
```

---

## Task 5: Sentinel exclusions — accommodation + reset/new-year purge

**Files:**
- Modify: `src/services/accommodation.service.ts`
- Modify: `src/services/admin.service.ts`
- Modify: `src/container.ts`
- Test: `src/services/admin.service.test.ts` (extend) — or a focused new test if the file is large.

**Interfaces:**
- Consumes: `UNALLOCATED_CHURCH_ID`; `IAllocationOverrideRepository`.
- Produces: `makeAdminService(..., overrideRepo)` — **signature gains a trailing parameter.**

- [ ] **Step 1: Exclude sentinel people from accommodation occupants**

In `src/services/accommodation.service.ts`:
1. Add import: `import { UNALLOCATED_CHURCH_ID } from './church-allocation';`
2. In `occupants()` change `const people = await personRepo.findAll();` to:
   ```typescript
   const people = (await personRepo.findAll()).filter((p) => p.churchId !== UNALLOCATED_CHURCH_ID);
   ```

- [ ] **Step 2: Write the failing purge test**

Append to `src/services/admin.service.test.ts` (match the file's existing setup helpers; it already builds an admin service with in-memory repos — add an `InMemoryAllocationOverrideRepository` to that setup and pass it as the new final arg to `makeAdminService`). Add:

```typescript
it('reset and new-year purge allocation overrides', async () => {
  // Uses the file's existing harness. `overrides` is the InMemoryAllocationOverrideRepository
  // wired into makeAdminService in this test's setup.
  await overrides.save({
    id: 'o1', personId: 'p1', firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '',
    assignedChurchId: 'c1', assignedChurchName: 'Grace', formChurch: 'OTHER - please specify below',
    kind: 'unallocated', note: null, createdBy: 'Admin', createdAt: 't', updatedAt: 't',
  });
  await svc.reset(adminActor, { force: true, confirmWipe: 'I understand this cannot be undone' });
  expect(await overrides.findAll()).toHaveLength(0);
});
```

> If `admin.service.test.ts` doesn't already expose reusable `overrides`/`svc`/`adminActor` bindings, model the new test's setup on the file's existing `reset`/`newYear` tests, adding the override repo to the `makeAdminService(...)` argument list and seeding one override before the wipe.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/services/admin.service.test.ts`
Expected: FAIL — `makeAdminService` arity / overrides not purged.

- [ ] **Step 4: Thread the override repo into the admin service**

In `src/services/admin.service.ts`:
1. Add import: `import type { IAllocationOverrideRepository } from '../repositories/interfaces/entity-repositories';`
2. Add a trailing parameter to `makeAdminService`: `overrideRepo: IAllocationOverrideRepository,` (after `snapshotRepo`).
3. In `reset`, add `overrideRepo.deleteAll(),` to the `Promise.all([...])` deletion list.
4. In `newYear`, add `overrideRepo.deleteAll(),` to its `Promise.all([...])` deletion list (~line 178).

- [ ] **Step 5: Update the container call sites**

In `src/container.ts`, both `makeAdminService(...)` calls (supabase branch ~191, in-memory branch ~311): add `allocationOverrides` as the final argument.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/services/admin.service.test.ts`
Expected: PASS.
Run: `npm run typecheck && npm run test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/accommodation.service.ts src/services/admin.service.ts src/services/admin.service.test.ts src/container.ts
git commit -m "feat: exclude unallocated from accommodation; purge overrides on reset/new-year"
```

---

## Task 6: SPA — unallocated + overrides cards on the Data Import screen

**Files:**
- Modify: `public/index.html`
- Modify: `public/sw.js`

**Interfaces:**
- Consumes: `GET /import/unallocated`, `GET /import/allocations`, `POST /import/allocate`, `DELETE /import/allocations/:id`, `GET /accounts/churches`.
- Uses existing SPA helpers: `api(path,{method,body})`, `paint`, `esc`, `icSm`, `toast`, `modal`, `closeModal`, `dtFmt`, `fmtPhone`, `_invalidate`.

- [ ] **Step 1: Make `RENDER.import` async and mount an allocation container**

Find `RENDER.import=function(){` (~line 3213). Replace the whole function with:

```javascript
RENDER.import=async function(){
  if(!['director','admin'].includes(ACTOR.role)){paint('import','<p class="note-hint">Importing is restricted to directors and admins.</p>','Import','');return;}
  paint('import',_importUploadCardHtml()+'<div id="allocWrap"></div>','Data Import','Form · Ticket · Invoice');
  _loadImportStamps();
  _loadAllocation();
};
```

- [ ] **Step 2: Add the allocation loader + renderers (right after `RENDER.import`)**

Insert this block immediately after the `RENDER.import` function:

```javascript
/* ===== UNALLOCATED REGISTRANTS + CHURCH OVERRIDES (bottom of Data Import) ===== */
const UNALLOCATED_ID='__unallocated__'; // must match backend UNALLOCATED_CHURCH_ID
let _allocState={unallocated:[],regs:[],churches:[],overrides:[]};

async function _loadAllocation(){
  const wrap=document.getElementById('allocWrap'); if(!wrap) return;
  const [unallocated,regs,churches,overrides]=await Promise.all([
    api('/import/unallocated').catch(()=>[]),
    api('/registrants').catch(()=>[]),
    api('/accounts/churches').catch(()=>[]),
    api('/import/allocations').catch(()=>[]),
  ]);
  _allocState={unallocated:unallocated||[],regs:regs||[],churches:churches||[],overrides:overrides||[]};
  _renderAllocCards();
}

function _churchOpts(sel){
  return '<option value="">Select a church…</option>'+_allocState.churches.slice()
    .sort((a,b)=>String(a.name).localeCompare(String(b.name)))
    .map(c=>`<option value="${esc(c.id)}"${c.id===sel?' selected':''}>${esc(c.name)}</option>`).join('');
}

function _renderAllocCards(){
  const wrap=document.getElementById('allocWrap'); if(!wrap) return;
  const un=_allocState.unallocated;
  const gradeLabel=p=>p.grade?('Grade '+esc(p.grade)):(p.kind==='leader'?'Leader':'—');
  const unRows=un.length?un.map(p=>`
    <div class="card" style="padding:10px">
      <div style="font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</div>
      <div class="sub">${esc(p.registrationType||'—')} · ${esc(p.gender||'—')} · ${gradeLabel(p)} · ${p.mobile?esc(fmtPhone(p.mobile)):'no phone'}</div>
      ${p.churchUnlistedNote?`<div class="note-hint" style="text-align:left;margin:4px 0"><b>They wrote:</b> ${esc(p.churchUnlistedNote)}</div>`:''}
      <div class="rowsb" style="gap:6px;margin-top:6px">
        <select class="fld" id="alloc_${esc(p.id)}" style="flex:1">${_churchOpts('')}</select>
        <button class="btn" onclick="allocatePerson('${esc(p.id)}')">Confirm</button>
      </div>
    </div>`).join(''):'<p class="note-hint">No unallocated registrants.</p>';
  const cardA=`<div class="card"><div class="h3" style="margin-top:0">Unallocated registrants (${un.length})</div>
    <p class="note-hint" style="text-align:left">These people chose “OTHER – please specify below” and have no church yet. Allocate each to a church.</p>${unRows}</div>`;

  const ov=_allocState.overrides;
  const ovRows=ov.length?ov.map(o=>`
    <div class="card" style="padding:10px">
      <div class="rowsb">
        <div>
          <div style="font-weight:600">${esc(o.personName)}</div>
          <div class="sub">${esc(o.formChurch||'—')} → <b>${esc(o.assignedChurchName)}</b></div>
          <div class="sub" style="font-size:.7rem;color:var(--muted)">${o.kind==='unallocated'?'Allocated from unlisted':'Overridden'} · ${esc(o.createdBy)} · ${dtFmt(o.updatedAt)}</div>
        </div>
        <button class="btn ghost" onclick="undoOverride('${esc(o.id)}')">Undo</button>
      </div>
    </div>`).join(''):'<p class="note-hint">No forced allocations yet.</p>';
  const cardB=`<div class="card"><div class="h3" style="margin-top:0">Church overrides / forced allocations (${ov.length})</div>
    <p class="note-hint" style="text-align:left">Everyone whose church differs from their form. These persist across re-imports.</p>
    <div class="card" style="padding:10px;background:var(--paper)">
      <div class="lbl" style="margin-top:0">Override a church allocation</div>
      <input class="fld" id="ovSearch" placeholder="Search a registrant by name…" oninput="_renderOvSearch()">
      <div id="ovSearchResults"></div>
    </div>
    ${ovRows}</div>`;

  wrap.innerHTML=cardA+cardB;
}

function _renderOvSearch(){
  const box=document.getElementById('ovSearchResults'); if(!box) return;
  const q=(document.getElementById('ovSearch').value||'').trim().toLowerCase();
  if(q.length<2){box.innerHTML='';return;}
  const hits=_allocState.regs.filter(r=>r.churchId!==UNALLOCATED_ID && `${r.firstName} ${r.lastName}`.toLowerCase().includes(q)).slice(0,8);
  box.innerHTML=hits.length?hits.map(p=>`<div class="rowsb" style="gap:6px;padding:4px 0">
    <div><div style="font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</div><div class="sub">${esc(p.churchName)}</div></div>
    <button class="btn ghost" onclick="overridePrompt('${esc(p.id)}')">Change church</button>
  </div>`).join(''):'<p class="note-hint">No matches.</p>';
}

async function allocatePerson(id){
  const sel=document.getElementById('alloc_'+id); const churchId=sel&&sel.value;
  if(!churchId){toast('Pick a church first');return;}
  try{await api('/import/allocate',{method:'POST',body:{personId:id,churchId}});toast('Allocated');_invalidate('/registrants');await _loadAllocation();}
  catch(e){toast(e.message||'Failed');}
}

function overridePrompt(id){
  const p=_allocState.regs.find(r=>r.id===id); if(!p)return;
  modal(`<div class="h3" style="margin-top:0">Override church</div>
    <p class="note-hint" style="text-align:left"><b>${esc(p.firstName)} ${esc(p.lastName)}</b> is currently in <b>${esc(p.churchName)}</b>. Move them to another church? This persists across re-imports.</p>
    <select class="fld" id="ovSel">${_churchOpts('')}</select>
    <div class="rowsb" style="gap:6px;margin-top:10px">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="confirmOverride('${esc(id)}')">Confirm override</button>
    </div>`);
}

async function confirmOverride(id){
  const sel=document.getElementById('ovSel'); const churchId=sel&&sel.value;
  if(!churchId){toast('Pick a church first');return;}
  try{await api('/import/allocate',{method:'POST',body:{personId:id,churchId}});closeModal();toast('Church overridden');_invalidate('/registrants');await _loadAllocation();}
  catch(e){toast(e.message||'Failed');}
}

async function undoOverride(id){
  try{await api('/import/allocations/'+id,{method:'DELETE'});toast('Reverted');_invalidate('/registrants');await _loadAllocation();}
  catch(e){toast(e.message||'Failed');}
}
```

> The SPA calls these via inline `onclick`, so the functions must be at top-level script scope (not nested). Match the surrounding indentation/quote style of `index.html` (tabs/spaces as the file uses).

- [ ] **Step 3: Bump the service worker cache**

In `public/sw.js`, find the `CACHE` constant (currently `camp-v17` per the latest changelog — grep `camp-v`) and increment it by one (e.g. `camp-v17` → `camp-v18`).

- [ ] **Step 4: Syntax-check the SPA script**

Run (extracts the inline script and checks it parses):

```bash
awk '/<script>/{f=1;next}/<\/script>/{f=0}f' public/index.html > "$TMPDIR/spa.js" 2>/dev/null || awk '/<script>/{f=1;next}/<\/script>/{f=0}f' public/index.html > ./_spa_check.js
node --check ./_spa_check.js && rm -f ./_spa_check.js
```

Expected: no output (parses cleanly). If `node --check` reports an error, fix the braces/quotes before continuing.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "feat: unallocated + church-override cards on Data Import screen"
```

---

## Task 7: Full verification & docs

**Files:**
- Modify: `CLAUDE.md` (append a short deployed-batch note), `debug.md` (add symptom-router rows).

- [ ] **Step 1: Full green gate**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run test`
Expected: all pass (baseline count + church-allocation 6 + repo 1 + allocation service 6 + import 3 + admin purge 1).

- [ ] **Step 2: Grep for leftover junk-church behaviour**

Run: `grep -n "resolveChurch(churchName" src/services/import.service.ts`
Expected: appears only in the final `else` branch (real church names), never for OTHER/blank rows.

- [ ] **Step 3: Document the feature**

Append a dated section to `CLAUDE.md` summarising: the `__unallocated__` sentinel, the `allocation_overrides` table (migration 020), the importer redirect at church-resolution time, `allocation:manage` (admin+director), and the two new Data Import cards. Add these rows to `debug.md`'s symptom router:
- "Unallocated list empty / OTHER person not showing" → `import.service.ts` sentinel branch + `isUnlistedChurchCell`; `GET /import/unallocated` = `people.findByChurch('__unallocated__')`.
- "Manual allocation lost after re-import / duplicate created" → `import.service.ts` override index + redirect (before zone/accommodation); `matchOverride` (ambiguity skip); prune-by-absent.
- "Allocated person didn't get church's accommodation override" → `accommodationKindForChurch` (shared by importer + `allocation.service.allocate`).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md debug.md
git commit -m "docs: unallocated registrants + church-allocation overrides"
```

- [ ] **Step 5: Hand back to the user**

Report: green typecheck/test output; remind the user that **migration `020` must be applied to prod before/with deploy**, and that the two new Data Import cards need an on-device eyeball (per repo convention no browser is driven here). Pushing `master` deploys.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** part 1 (unallocated list + allocate) = Tasks 3+6; part 2 (override via search) = Task 3 `allocate` (kind derived) + Task 6 search card; part 3 (persist across imports) = Tasks 2+4; accommodation composition = `accommodationKindForChurch` (Task 1) reused in Task 3 & 4; RBAC = Task 3; purge = Task 5.
- **Known residual limitation (documented, acceptable):** two same-name registrants who both lack a mobile, where only one is overridden, can't be told apart on re-import — `matchOverride` returns `'ambiguous'` and the redirect is skipped with a warning. Extremely rare; by design.
- **Zone safety:** unallocated (sentinel) people always get `zone=''` so no zoneLeader can see them — verified in Task 4 Step 6 and the sentinel test.
