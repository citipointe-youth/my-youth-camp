import type { SqlClient } from './client';
import { MAX_DELIVERY_HISTORY, type PushSubscription, type PushDeviceLabel } from '../../core/entities/push-subscription';
import type { IPushSubscriptionRepository } from '../interfaces/entity-repositories';
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';

export function toPushSub(r: Record<string, unknown>): PushSubscription {
  const id = r['id'] as string;
  return {
    id,
    userId: r['user_id'] as string,
    endpoint: r['endpoint'] as string,
    p256dh: maybeDecrypt(r['p256dh_enc'] as string, `push_subscriptions:p256dh:${id}`) ?? '',
    auth: maybeDecrypt(r['auth_enc'] as string, `push_subscriptions:auth:${id}`) ?? '',
    consentVersion: Number(r['consent_version'] ?? 1),
    createdAt: new Date(r['created_at'] as string | Date).toISOString(),
    lastSuccessAt: r['last_success_at'] ? new Date(r['last_success_at'] as string | Date).toISOString() : null,
    lastFailureAt: r['last_failure_at'] ? new Date(r['last_failure_at'] as string | Date).toISOString() : null,
    failureCount: Number(r['failure_count'] ?? 0),
    deviceLabel: (r['device_label'] as PushDeviceLabel | null) ?? null,
    deliveryHistory: (r['delivery_history'] as string[] | null) ?? [],
    leaderInitials: (r['leader_initials'] as string | null) ?? null,
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
    device_label: s.deviceLabel ?? null,
    // Passed as an object, NOT JSON.stringify + ::jsonb — that double-encodes (the 2026-08-04
    // new-year wipe). postgres.js serialises a plain array into jsonb itself.
    delivery_history: s.deliveryHistory ?? [],
    leader_initials: s.leaderInitials ?? null,
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
        failure_count = excluded.failure_count,
        device_label = excluded.device_label,
        -- Latest wins: a different leader taking the device re-sends their own initials.
        leader_initials = excluded.leader_initials,
        -- History is owned by recordSuccess(); an ordinary save carries a possibly-stale
        -- snapshot and must not clobber a concurrent append. The one exception: the phone
        -- was re-subscribed under a DIFFERENT account, so take the incoming (cleared) value.
        delivery_history = case
          when push_subscriptions.user_id is distinct from excluded.user_id then excluded.delivery_history
          else push_subscriptions.delivery_history
        end
    `;
    return s;
  }

  async recordSuccess(endpoint: string, at: string): Promise<void> {
    // One statement, so two concurrent successes on the same phone both land (row lock
    // serialises them; each re-reads the committed history). Newest first, capped.
    await this.sql`
      update push_subscriptions set
        last_success_at = ${at},
        failure_count = 0,
        delivery_history = (
          select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
          from jsonb_array_elements(jsonb_build_array(${at}::text) || delivery_history)
            with ordinality as t(v, ord)
          where ord <= ${MAX_DELIVERY_HISTORY}
        )
      where endpoint = ${endpoint}
    `;
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
