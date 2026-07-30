import type { SqlClient } from './client';
import type { IIncidentRepository } from '../interfaces/entity-repositories';
import type { Incident } from '../../core/entities/incident';
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';

// `summary` is child-safety free text — encrypted at rest exactly like notes.body. The AAD
// binds the ciphertext to this row's id so a copied envelope can't be replayed onto another row.
export function toIncident(r: Record<string, unknown>): Incident {
  return {
    id: r['id'] as string,
    summary: maybeDecrypt(r['summary'] as string, `incidents:summary:${r['id'] as string}`) ?? '',
    severity: r['severity'] as Incident['severity'],
    createdById: r['created_by_id'] as string,
    createdByName: r['created_by_name'] as string,
    createdByRole: r['created_by_role'] as Incident['createdByRole'],
    zone: (r['zone'] as Incident['zone']) ?? undefined,
    createdAt: (r['created_at'] as Date).toISOString(),
    // Nullable since migration 0019 — every row written before then has none. `pg` hands back a
    // Date; tolerate a string too so a hand-built row (and the mapper round-trip test) works.
    occurredAt: toISO(r['occurred_at']),
  };
}

function toISO(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export function incidentColumns(inc: Incident): Record<string, unknown> {
  return {
    id: inc.id,
    // summary is `not null`; encrypt when present, keep '' as '' (never null).
    summary: inc.summary ? encryptField(inc.summary, `incidents:summary:${inc.id}`) : inc.summary,
    severity: inc.severity,
    created_by_id: inc.createdById,
    created_by_name: inc.createdByName,
    created_by_role: inc.createdByRole,
    zone: inc.zone ?? null,
    created_at: inc.createdAt,
    occurred_at: inc.occurredAt ?? null,
  };
}

export class SupabaseIncidentRepository implements IIncidentRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findAll(): Promise<Incident[]> {
    return (await this.sql`select * from incidents order by created_at desc`).map(toIncident);
  }

  async findById(id: string): Promise<Incident | null> {
    const rows = await this.sql`select * from incidents where id = ${id}`;
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async findRecent(limit?: number): Promise<Incident[]> {
    if (limit != null) {
      return (await this.sql`select * from incidents order by created_at desc limit ${limit}`).map(toIncident);
    }
    return (await this.sql`select * from incidents order by created_at desc`).map(toIncident);
  }

  async save(inc: Incident): Promise<Incident> {
    await this.sql`
      insert into incidents ${this.sql(incidentColumns(inc))}
      on conflict (id) do update set
        summary = excluded.summary,
        severity = excluded.severity,
        -- A new column MUST be listed here as well as in incidentColumns/toIncident, or the
        -- value silently never persists on an update (the repo's recurring bug class).
        occurred_at = excluded.occurred_at
    `;
    return inc;
  }

  async saveMany(incs: Incident[]): Promise<Incident[]> {
    for (const i of incs) await this.save(i);
    return incs;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from incidents where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from incidents returning id`;
    return rows.length;
  }
}
