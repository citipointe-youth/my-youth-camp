import { describe, it, expect, beforeAll } from 'vitest';
import { toPushSub, pushSubColumns } from './supabase.push-subscriptions';
import type { PushSubscription } from '../../core/entities/push-subscription';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function sub(over: Partial<PushSubscription> = {}): PushSubscription {
  return {
    id: 'push_1',
    userId: 'usr_1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: 'BPublicKeyMaterialHere',
    auth: 'AuthSecretHere',
    consentVersion: 1,
    createdAt: '2026-09-29T01:00:00.000Z',
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    ...over,
  };
}

describe('push_subscriptions mapper encryption', () => {
  it('encrypts both key columns on write', () => {
    const cols = pushSubColumns(sub());
    expect(cols['p256dh_enc'] as string).toMatch(/^v1\./);
    expect(cols['auth_enc'] as string).toMatch(/^v1\./);
  });

  it('leaves the endpoint plaintext so it can carry a unique index', () => {
    const cols = pushSubColumns(sub());
    expect(cols['endpoint']).toBe('https://fcm.googleapis.com/fcm/send/abc123');
  });

  it('round-trips through toPushSub', () => {
    const cols = pushSubColumns(sub());
    const row = { ...cols, created_at: new Date('2026-09-29T01:00:00.000Z') };
    const back = toPushSub(row as Record<string, unknown>);
    expect(back.p256dh).toBe('BPublicKeyMaterialHere');
    expect(back.auth).toBe('AuthSecretHere');
    expect(back.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc123');
    expect(back.failureCount).toBe(0);
  });

  it('rejects ciphertext decrypted under the wrong AAD (bound to column)', () => {
    // Swapping the two ciphertexts must fail to decrypt, proving the AAD is per-column.
    // A value encrypted under p256dh AAD cannot decrypt under auth AAD.
    const cols = pushSubColumns(sub());
    const swapped = {
      ...cols,
      p256dh_enc: cols['auth_enc'],
      auth_enc: cols['p256dh_enc'],
      created_at: new Date('2026-09-29T01:00:00.000Z'),
    };
    expect(() => toPushSub(swapped as Record<string, unknown>)).toThrow();
  });
});
