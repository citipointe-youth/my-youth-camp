import type postgres from 'postgres';
import type { SqlClient } from './client';
import type { IClassroomFreezeRepository } from '../interfaces/entity-repositories';
import type { ClassroomFreeze } from '../../core/entities/accommodation';

/**
 * Classroom soft-freeze snapshot (migration 0030). One row at most (`id = 'freeze'`); absence
 * means not frozen. The snapshot is written with `sql.json()` — NEVER `JSON.stringify` +
 * `::jsonb`, which double-encodes (the 2026-08-04 defaults wipe) — and read back defensively:
 * a malformed snapshot throws rather than silently reading as "nothing frozen".
 */
export function toClassroomFreeze(r: Record<string, unknown>): ClassroomFreeze {
  const raw = r['snapshot'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Classroom freeze snapshot is malformed (expected an object, got ${Array.isArray(raw) ? 'array' : typeof raw})`);
  }
  const snap = raw as Record<string, unknown>;
  return {
    id: r['id'] as string,
    frozenAt: (r['frozen_at'] as Date).toISOString(),
    frozenBy: (r['frozen_by'] as string | null) ?? '',
    eligibleChurchIds: (snap['eligibleChurchIds'] as string[] | undefined) ?? [],
    shapes: (snap['shapes'] as ClassroomFreeze['shapes'] | undefined) ?? {},
    baselines: (snap['baselines'] as Record<string, number> | undefined) ?? {},
  };
}

export class SupabaseClassroomFreezeRepository implements IClassroomFreezeRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findAll(): Promise<ClassroomFreeze[]> {
    return (await this.sql`select * from classroom_freeze`).map(toClassroomFreeze);
  }

  async findById(id: string): Promise<ClassroomFreeze | null> {
    const rows = await this.sql`select * from classroom_freeze where id = ${id}`;
    return rows[0] ? toClassroomFreeze(rows[0]) : null;
  }

  async save(f: ClassroomFreeze): Promise<ClassroomFreeze> {
    const snapshot = { eligibleChurchIds: f.eligibleChurchIds, shapes: f.shapes, baselines: f.baselines };
    await this.sql`
      insert into classroom_freeze (id, frozen_at, frozen_by, snapshot)
      values (${f.id}, ${f.frozenAt}, ${f.frozenBy}, ${this.sql.json(snapshot as unknown as postgres.JSONValue)})
      on conflict (id) do update set frozen_at = excluded.frozen_at, frozen_by = excluded.frozen_by, snapshot = excluded.snapshot
    `;
    return f;
  }

  async saveMany(rows: ClassroomFreeze[]): Promise<ClassroomFreeze[]> {
    for (const r of rows) await this.save(r);
    return rows;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from classroom_freeze where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from classroom_freeze returning id`;
    return rows.length;
  }
}
