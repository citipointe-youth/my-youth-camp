import type { SqlClient } from './client';
import type { IRevealAuditRepository } from '../interfaces/entity-repositories';
import type { RevealAudit } from '../../core/entities/reveal-audit';

/**
 * ⚠️ NOTHING HERE IS ENCRYPTED, because nothing here is sensitive — see the entity docs.
 * The revealed value is never written. If you ever add a column that could carry one, it needs
 * the `field-crypto` envelope treatment like `notes.body` / `incidents.summary`, and it almost
 * certainly should not exist at all.
 */
export function toRevealAudit(r: Record<string, unknown>): RevealAudit {
  return {
    id: r['id'] as string,
    kind: r['kind'] as RevealAudit['kind'],
    personId: r['person_id'] as string,
    personName: (r['person_name'] as string) ?? '',
    churchName: (r['church_name'] as string) ?? '',
    actorId: r['actor_id'] as string,
    actorUsername: (r['actor_username'] as string) ?? '',
    actorRole: r['actor_role'] as RevealAudit['actorRole'],
    actorInitials: (r['actor_initials'] as string) ?? '',
    contactRole: (r['contact_role'] as string | null) ?? null,
    createdAt:
      r['created_at'] instanceof Date
        ? (r['created_at'] as Date).toISOString()
        : String(r['created_at']),
  };
}

export function revealAuditColumns(a: RevealAudit): Record<string, unknown> {
  return {
    id: a.id,
    kind: a.kind,
    person_id: a.personId,
    person_name: a.personName,
    church_name: a.churchName,
    actor_id: a.actorId,
    actor_username: a.actorUsername,
    actor_role: a.actorRole,
    actor_initials: a.actorInitials,
    contact_role: a.contactRole ?? null,
    created_at: a.createdAt,
  };
}

export class SupabaseRevealAuditRepository implements IRevealAuditRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findAll(): Promise<RevealAudit[]> {
    return (await this.sql`select * from reveal_audit order by created_at desc`).map(toRevealAudit);
  }

  async findById(id: string): Promise<RevealAudit | null> {
    const rows = await this.sql`select * from reveal_audit where id = ${id}`;
    return rows[0] ? toRevealAudit(rows[0]) : null;
  }

  async findRecent(limit?: number): Promise<RevealAudit[]> {
    if (limit != null) {
      return (
        await this.sql`select * from reveal_audit order by created_at desc limit ${limit}`
      ).map(toRevealAudit);
    }
    return this.findAll();
  }

  async save(a: RevealAudit): Promise<RevealAudit> {
    // Append-only: a reveal is a fact that happened at an instant and is never edited. The
    // do-nothing conflict clause exists purely so a retried write is idempotent rather than a 500.
    await this.sql`
      insert into reveal_audit ${this.sql(revealAuditColumns(a))}
      on conflict (id) do nothing
    `;
    return a;
  }

  async saveMany(rows: RevealAudit[]): Promise<RevealAudit[]> {
    for (const r of rows) await this.save(r);
    return rows;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from reveal_audit where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from reveal_audit returning id`;
    return rows.length;
  }
}
