import { describe, it, expect } from 'vitest';
import { toAllocationOverride } from './supabase.allocation-override';

/**
 * These pin the bug that 500'd `GET /import/allocations` from the day the feature shipped
 * (2026-07-03) until 2026-08-01: `timestamptz` arrives from postgres.js as a **Date**, the mapper
 * cast it `as string`, and `listOverrides`' `b.updatedAt.localeCompare(a.updatedAt)` then threw
 * `localeCompare is not a function`. The SPA swallowed the 500 with `.catch(() => [])`, so the
 * only visible symptom was an allocation screen that always read "Church overrides (0)".
 *
 * ⚠ The row fixture MUST use real `Date` objects. A fixture with ISO strings passes against the
 * broken mapper and proves nothing — that is exactly why this went unnoticed for a month.
 */
function sqlRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'override_1',
    person_id: 'person_1',
    first_name_key: 'ada',
    last_name_key: 'lovelace',
    mobile_key: '0400000000',
    assigned_church_id: 'church_1',
    assigned_church_name: 'Citipointe Brisbane (Carindale)',
    form_church: 'other - please specify below',
    kind: 'unallocated',
    note: null,
    created_by: 'Admin',
    created_at: new Date('2026-07-31T03:04:04.607Z'),
    updated_at: new Date('2026-08-01T09:23:47.847Z'),
    ...overrides,
  };
}

describe('toAllocationOverride', () => {
  it('converts Date timestamps to ISO strings', () => {
    const o = toAllocationOverride(sqlRow());
    expect(o.createdAt).toBe('2026-07-31T03:04:04.607Z');
    expect(o.updatedAt).toBe('2026-08-01T09:23:47.847Z');
  });

  it('produces timestamps that localeCompare can sort — the exact call that 500d', () => {
    const rows = [
      toAllocationOverride(sqlRow({ id: 'a', updated_at: new Date('2026-07-31T03:04:04.607Z') })),
      toAllocationOverride(sqlRow({ id: 'b', updated_at: new Date('2026-08-01T09:23:47.847Z') })),
    ];
    // Mirrors allocation.service.listOverrides' sort.
    expect(() => rows.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))).not.toThrow();
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('passes through timestamps that are already strings', () => {
    const o = toAllocationOverride(sqlRow({ updated_at: '2026-08-01T09:23:47.847Z' }));
    expect(o.updatedAt).toBe('2026-08-01T09:23:47.847Z');
  });

  it('keeps kind, so the Designated-from-OTHER split still works', () => {
    expect(toAllocationOverride(sqlRow()).kind).toBe('unallocated');
    expect(toAllocationOverride(sqlRow({ kind: 'override' })).kind).toBe('override');
  });
});
