import type { SqlClient } from './client';
import type { INotificationRepository } from '../interfaces/entity-repositories';
import type { Notification } from '../../core/entities/notification';
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';

export function toNotif(r: Record<string, unknown>): Notification {
  const id = r['id'] as string;
  return {
    id,
    scope: r['scope'] as Notification['scope'],
    zone: (r['zone'] as string | null) ?? undefined,
    churchId: (r['church_id'] as string | null) ?? undefined,
    priority: r['priority'] as Notification['priority'],
    title: r['title'] as string,
    // Leaders-only (incident) alerts carry a summary that can describe a minor, so their body is
    // encrypted at rest. maybeDecrypt passes ordinary plaintext broadcast bodies through unchanged.
    body: maybeDecrypt(r['body'] as string, `notifications:body:${id}`) ?? '',
    senderId: r['sender_id'] as string,
    senderName: r['sender_name'] as string,
    senderRole: r['sender_role'] as Notification['senderRole'],
    leadersOnly: (r['leaders_only'] as boolean | null) ?? false,
    audienceEstimate: r['audience_estimate'] as number,
    expiresAt: r['expires_at'] ? (r['expires_at'] as Date).toISOString() : undefined,
    scheduledFor: r['scheduled_for'] ? (r['scheduled_for'] as Date).toISOString() : null,
    createdAt: (r['created_at'] as Date).toISOString(),
  };
}

export function notifColumns(n: Notification): Record<string, unknown> {
  return {
    id: n.id,
    scope: n.scope,
    zone: n.zone ?? null,
    church_id: n.churchId ?? null,
    priority: n.priority,
    title: n.title,
    // Encrypt at rest only for leaders-only (incident) alerts, whose body carries a summary
    // that can describe a minor. Ordinary broadcast bodies stay plaintext (readable by all).
    body: n.leadersOnly && n.body ? encryptField(n.body, `notifications:body:${n.id}`) : n.body,
    sender_id: n.senderId,
    sender_name: n.senderName,
    sender_role: n.senderRole,
    leaders_only: n.leadersOnly ?? false,
    audience_estimate: n.audienceEstimate,
    expires_at: n.expiresAt ?? null,
    scheduled_for: n.scheduledFor ?? null,
    created_at: n.createdAt,
  };
}

export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findAll(): Promise<Notification[]> {
    return (await this.sql`select * from notifications order by created_at desc`).map(toNotif);
  }

  async findById(id: string): Promise<Notification | null> {
    const rows = await this.sql`select * from notifications where id = ${id}`;
    return rows[0] ? toNotif(rows[0]) : null;
  }

  async findByScope(scope: string): Promise<Notification[]> {
    return (await this.sql`select * from notifications where scope = ${scope} order by created_at desc`).map(toNotif);
  }

  async findByZone(zone: string): Promise<Notification[]> {
    return (await this.sql`select * from notifications where zone = ${zone} order by created_at desc`).map(toNotif);
  }

  async findByChurch(churchId: string): Promise<Notification[]> {
    return (await this.sql`select * from notifications where church_id = ${churchId} order by created_at desc`).map(toNotif);
  }

  async findActive(): Promise<Notification[]> {
    return (await this.sql`
      select * from notifications
      where expires_at is null or expires_at > now()
      order by created_at desc
    `).map(toNotif);
  }

  async save(n: Notification): Promise<Notification> {
    await this.sql`
      insert into notifications ${this.sql(notifColumns(n))}
      on conflict (id) do update set
        title = excluded.title,
        body = excluded.body,
        scope = excluded.scope,
        zone = excluded.zone,
        church_id = excluded.church_id,
        priority = excluded.priority,
        expires_at = excluded.expires_at,
        scheduled_for = excluded.scheduled_for,
        audience_estimate = excluded.audience_estimate
    `;
    return n;
  }

  async saveMany(ns: Notification[]): Promise<Notification[]> {
    for (const n of ns) await this.save(n);
    return ns;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from notifications where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from notifications returning id`;
    return rows.length;
  }
}
