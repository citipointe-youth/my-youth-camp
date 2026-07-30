import { describe, it, expect } from 'vitest';
import { canSeeNotification, publishedAt, byPublishedDesc } from './notification-visibility';
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

  // ---- targetUserId (per-login addressing) --------------------------------------------
  // Regression: the gender-scoped b-/g- pair share a churchId, so a church-scoped warning
  // carrying ONE login's count was visible to BOTH logins (two contradictory numbers), and
  // to every admin and director as well.

  it('sends a targeted notice to that login only', () => {
    const n = notif({ scope: 'church', churchId: 'ch_victory', targetUserId: 'usr_boys' });
    expect(canSeeNotification(actor({ id: 'usr_boys' }), n, NOW)).toBe(true);
    expect(canSeeNotification(actor({ id: 'usr_girls' }), n, NOW)).toBe(false);
  });

  it('does NOT exempt admin or director from targeting', () => {
    // The point of the exception: an oversight role has no use for every church's
    // per-login operational warning, and letting them through buries real notices.
    const n = notif({ scope: 'church', churchId: 'ch_victory', targetUserId: 'usr_boys' });
    expect(canSeeNotification(actor({ id: 'usr_a', role: 'admin', churchId: null }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ id: 'usr_d', role: 'director', churchId: null }), n, NOW)).toBe(false);
  });

  it('leaves an untargeted notice addressed by scope as before', () => {
    const n = notif({ scope: 'church', churchId: 'ch_victory', targetUserId: null });
    expect(canSeeNotification(actor({ id: 'usr_boys' }), n, NOW)).toBe(true);
    expect(canSeeNotification(actor({ id: 'usr_girls' }), n, NOW)).toBe(true);
  });
});

describe('publishedAt / byPublishedDesc', () => {
  it('uses scheduledFor as the publish time when present', () => {
    expect(publishedAt(notif({ createdAt: 'A', scheduledFor: 'B' }))).toBe('B');
    expect(publishedAt(notif({ createdAt: 'A', scheduledFor: null }))).toBe('A');
  });

  it('orders a late-publishing scheduled notice ABOVE notices composed after it', () => {
    // The shipped bug: composed Monday, delivers Thursday, but sorted by createdAt it landed
    // below everything sent Tuesday/Wednesday — and Home only renders the newest three.
    const scheduled = notif({
      id: 'sched',
      createdAt: '2026-09-01T00:00:00.000Z',
      scheduledFor: '2026-09-04T00:00:00.000Z',
    });
    const adhoc = ['02', '03'].map((d) =>
      notif({ id: `adhoc_${d}`, createdAt: `2026-09-${d}T00:00:00.000Z` }),
    );
    const ordered = [scheduled, ...adhoc].sort(byPublishedDesc).map((n) => n.id);
    expect(ordered[0]).toBe('sched');
  });
});
