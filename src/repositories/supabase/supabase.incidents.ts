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
    zone: (r['zone'] as string | null) ?? undefined,
    createdAt: (r['created_at'] as Date).toISOString(),
  };
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
      on conflict (id) do update set summary = excluded.summary, severity = excluded.severity
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
