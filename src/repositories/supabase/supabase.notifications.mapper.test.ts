import { describe, it, expect, beforeAll } from 'vitest';
import { toNotif, notifColumns } from './supabase.notifications';
import type { Notification } from '../../core/entities/notification';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'notif_1', scope: 'camp', zone: null, churchId: null, priority: 'urgent',
    title: 'Incident logged', body: 'sensitive summary describing a minor',
    senderId: 'z1', senderName: 'Zone Yellow', senderRole: 'zoneLeader',
    leadersOnly: true, audienceEstimate: 0, expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

describe('notifications mapper encryption (review Finding B)', () => {
  it('encrypts the body of a leaders-only (incident) alert on write', () => {
    const cols = notifColumns(notif());
    expect(String(cols['body']).startsWith('v1.')).toBe(true);
    expect(cols['leaders_only']).toBe(true);
  });

  it('leaves an ordinary broadcast body plaintext', () => {
    const cols = notifColumns(notif({ id: 'notif_2', leadersOnly: false, body: 'Weather update: bring a coat' }));
    expect(cols['body']).toBe('Weather update: bring a coat');
    expect(String(cols['body']).startsWith('v1.')).toBe(false);
  });

  it('round-trips an encrypted body through toNotif', () => {
    const cols = notifColumns(notif());
    const row = { ...cols, created_at: new Date(cols['created_at'] as string) };
    const n = toNotif(row);
    expect(n.body).toBe('sensitive summary describing a minor');
    expect(n.leadersOnly).toBe(true);
  });

  it('reads a legacy plaintext body (rollout tolerance)', () => {
    const row: Record<string, unknown> = {
      id: 'notif_legacy', scope: 'camp', zone: null, church_id: null, priority: 'normal',
      title: 'Old', body: 'legacy plaintext notice', sender_id: 'u', sender_name: 'A',
      sender_role: 'admin', leaders_only: false, audience_estimate: 0, expires_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toNotif(row).body).toBe('legacy plaintext notice');
  });
});
