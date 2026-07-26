import { describe, it, expect } from 'vitest';
import { canSeeNotification } from './notification-visibility';
import type { Notification } from '../core/entities/notification';
import type { Actor } from '../core/entities/user';

const NOW = '2026-09-29T02:00:00.000Z';

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'notif_1',
    scope: 'camp',
    zone: null,
    churchId: null,
    priority: 'normal',
    title: 'T',
    body: 'B',
    senderId: 'usr_admin',
    senderName: 'Admin',
    senderRole: 'admin',
    leadersOnly: false,
    audienceEstimate: 0,
    expiresAt: null,
    scheduledFor: null,
    createdAt: '2026-09-29T01:00:00.000Z',
    ...over,
  };
}

function actor(over: Partial<Actor> = {}): Actor {
  return {
    id: 'usr_1',
    role: 'church',
    churchId: 'ch_victory',
    churchName: 'Victory',
    zone: 'Blue',
    displayName: 'Victory Boys',
    genderScope: 'male',
    ...over,
  };
}

describe('canSeeNotification', () => {
  it('shows a camp-scope notice to everyone', () => {
    expect(canSeeNotification(actor(), notif(), NOW)).toBe(true);
    expect(canSeeNotification(actor({ role: 'firstAid' }), notif(), NOW)).toBe(true);
  });

  it('hides a leadersOnly notice from church and firstAid', () => {
    const n = notif({ leadersOnly: true });
    expect(canSeeNotification(actor({ role: 'church' }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ role: 'firstAid' }), n, NOW)).toBe(false);
  });

  it('shows a leadersOnly notice to zoneLeader, director and admin', () => {
    const n = notif({ leadersOnly: true });
    for (const role of ['zoneLeader', 'director', 'admin'] as const) {
      expect(canSeeNotification(actor({ role }), n, NOW)).toBe(true);
    }
  });

  it('withholds a notice scheduled in the future from everyone', () => {
    const n = notif({ scheduledFor: '2026-09-29T03:00:00.000Z' });
    expect(canSeeNotification(actor({ role: 'admin' }), n, NOW)).toBe(false);
  });

  it('releases a notice once its scheduled time has passed', () => {
    const n = notif({ scheduledFor: '2026-09-29T01:30:00.000Z' });
    expect(canSeeNotification(actor({ role: 'admin' }), n, NOW)).toBe(true);
  });

  it('matches zone scope only for the same zone, but always for oversight', () => {
    const n = notif({ scope: 'zone', zone: 'Blue' });
    expect(canSeeNotification(actor({ role: 'zoneLeader', zone: 'Blue' }), n, NOW)).toBe(true);
    expect(canSeeNotification(actor({ role: 'zoneLeader', zone: 'Red' }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ role: 'director', zone: null }), n, NOW)).toBe(true);
  });

  it('matches church scope only for the same church, but always for oversight', () => {
    const n = notif({ scope: 'church', churchId: 'ch_victory' });
    expect(canSeeNotification(actor({ churchId: 'ch_victory' }), n, NOW)).toBe(true);
    expect(canSeeNotification(actor({ churchId: 'ch_other' }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ role: 'admin', churchId: null }), n, NOW)).toBe(true);
  });
});
