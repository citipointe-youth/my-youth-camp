import type { SqlClient } from './client';
import type { PushSubscription } from '../../core/entities/push-subscription';
import type { IPushSubscriptionRepository } from '../interfaces/entity-repositories';
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';

/**
 * `maybeDecrypt` throws (GCM auth-tag failure) when a ciphertext is decrypted under the
 * wrong AAD — e.g. a value that was swapped between the p256dh/auth columns. Reading a
 * subscription row must not crash on a single tampered/corrupted field, so decrypt
 * failures here fail soft to `''` rather than propagate.
 */
function safeDecrypt(value: string | null | undefined, aad: string): string {
  try {
    return maybeDecrypt(value, aad) ?? '';
  } catch {
    return '';
  }
}

export function toPushSub(r: Record<string, unknown>): PushSubscription {
  const id = r['id'] as string;
  return {
    id,
    userId: r['user_id'] as string,
    endpoint: r['endpoint'] as string,
    p256dh: safeDecrypt(r['p256dh_enc'] as string, `push_subscriptions:p256dh:${id}`),
    auth: safeDecrypt(r['auth_enc'] as string, `push_subscriptions:auth:${id}`),
    consentVersion: Number(r['consent_version'] ?? 1),
    createdAt: new Date(r['created_at'] as string | Date).toISOString(),
    lastSuccessAt: r['last_success_at'] ? new Date(r['last_success_at'] as string | Date).toISOString() : null,
    lastFailureAt: r['last_failure_at'] ? new Date(r['last_failure_at'] as string | Date).toISOString() : null,
    failureCount: Number(r['failure_count'] ?? 0),
  };
}

export function pushSubColumns(s: PushSubscription): Record<string, unknown> {
  return {
    id: s.id,
    user_id: s.userId,
    // Plaintext on purpose: AES-GCM is randomised and cannot carry the unique index this
    // column needs for upsert-on-resubscribe and pruning. See design §4.4.
    endpoint: s.endpoint,
    p256dh_enc: encryptField(s.p256dh, `push_subscriptions:p256dh:${s.id}`),
    auth_enc: encryptField(s.auth, `push_subscriptions:auth:${s.id}`),
    consent_version: s.consentVersion,
    created_at: s.createdAt,
    last_success_at: s.lastSuccessAt ?? null,
    last_failure_at: s.lastFailureAt ?? null,
    failure_count: s.failureCount,
  };
}

export class SupabasePushSubscriptionRepository implements IPushSubscriptionRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> { /* table created by migration 0013 */ }

  async findById(id: string): Promise<PushSubscription | null> {
    const rows = await this.sql`select * from push_subscriptions where id = ${id}`;
    return rows[0] ? toPushSub(rows[0]) : null;
  }

  async findAll(): Promise<PushSubscription[]> {
    const rows = await this.sql`select * from push_subscriptions order by created_at`;
    return rows.map((r) => toPushSub(r));
  }

  async findByUser(userId: string): Promise<PushSubscription[]> {
    const rows = await this.sql`select * from push_subscriptions where user_id = ${userId}`;
    return rows.map((r) => toPushSub(r));
  }

  async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    const rows = await this.sql`select * from push_subscriptions where endpoint = ${endpoint}`;
    return rows[0] ? toPushSub(rows[0]) : null;
  }

  async save(s: PushSubscription): Promise<PushSubscription> {
    // Conflict on ENDPOINT, not id: the same device re-subscribing must refresh its keys
    // in place rather than accumulate rows.
    await this.sql`
      insert into push_subscriptions ${this.sql(pushSubColumns(s))}
      on conflict (endpoint) do update set
        user_id = excluded.user_id,
        p256dh_enc = excluded.p256dh_enc,
        auth_enc = excluded.auth_enc,
        consent_version = excluded.consent_version,
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        failure_count = excluded.failure_count
    `;
    return s;
  }

  async saveMany(subs: PushSubscription[]): Promise<PushSubscription[]> {
    for (const s of subs) await this.save(s);
    return subs;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from push_subscriptions where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const rows = await this.sql`delete from push_subscriptions where endpoint = ${endpoint} returning id`;
    return rows.length > 0;
  }

  async deleteByUser(userId: string): Promise<number> {
    const rows = await this.sql`delete from push_subscriptions where user_id = ${userId} returning id`;
    return rows.length;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from push_subscriptions returning id`;
    return rows.length;
  }
}
