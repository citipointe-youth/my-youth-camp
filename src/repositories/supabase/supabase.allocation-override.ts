import type { SqlClient } from './client';
import type { IAllocationOverrideRepository } from '../interfaces/entity-repositories';
import type { AllocationOverride } from '../../core/entities/allocation-override';

/**
 * ⚠️ `timestamptz` comes back from postgres.js as a **Date**, never a string. This mapper used to
 * cast `created_at`/`updated_at` `as string` — a TYPE-LEVEL LIE that compiles clean and then hands
 * the service a Date. `listOverrides` sorts on `b.updatedAt.localeCompare(...)`, so
 * `GET /import/allocations` threw `localeCompare is not a function` on EVERY call, 500ing since the
 * feature shipped (2026-07-03). The SPA's `.catch(()=>[])` swallowed it, so the screen just showed
 * "Church overrides (0)" and never rendered the Designated-from-OTHER card at all.
 * Every other repo in this folder already does `(r['x'] as Date).toISOString()`; this was the one
 * that didn't. **A timestamp column must be converted here, not cast.**
 */
function toISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'string' ? v : '';
}

export function toAllocationOverride(r: Record<string, unknown>): AllocationOverride {
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
    createdAt: toISO(r['created_at']),
    updatedAt: toISO(r['updated_at']),
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
    return (await this.sql`select * from allocation_overrides`).map(toAllocationOverride);
  }

  async findById(id: string): Promise<AllocationOverride | null> {
    const rows = await this.sql`select * from allocation_overrides where id = ${id}`;
    return rows[0] ? toAllocationOverride(rows[0]) : null;
  }

  async findByPersonId(personId: string): Promise<AllocationOverride | null> {
    const rows = await this.sql`select * from allocation_overrides where person_id = ${personId} limit 1`;
    return rows[0] ? toAllocationOverride(rows[0]) : null;
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
