import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import webpush from 'web-push';
import {
  makePushService,
  buildPushPayload,
  isPushSuppressed,
  resolvePushAudience,
  readPushConfig,
  isPushConfigured,
  MAX_PUSH_SENDS_PER_TICK,
} from './push.service';
import {
  InMemoryNotificationRepository,
  InMemoryPushSubscriptionRepository,
} from '../repositories/in-memory';
import type { Notification } from '../core/entities/notification';
import type { User } from '../core/entities/user';
import type { CampSettings } from '../core/entities/settings';

const NOW = '2026-09-29T02:00:00.000Z';

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    scope: 'camp',
    zone: null,
    churchId: null,
    priority: 'normal',
    title: 'Title',
    body: 'BODY-SECRET-TEXT',
    senderId: 'u-admin',
    senderName: 'Admin',
    senderRole: 'admin',
    leadersOnly: false,
    audienceEstimate: 0,
    expiresAt: null,
    scheduledFor: null,
    pushSentAt: null,
    dedupeKey: null,
    targetUserId: null,
    createdAt: NOW,
    ...over,
  };
}

function user(over: Partial<User> = {}): User {
  return {
    id: 'u1',
    firstName: 'A',
    lastName: 'B',
    username: 'ab',
    role: 'zoneLeader',
    churchId: null,
    churchName: null,
    zone: 'Blue',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function settings(over: Partial<CampSettings> = {}): CampSettings {
  return {
    churchLoginLocked: false,
    zoneLeaderLoginLocked: false,
    ...over,
  } as CampSettings;
}

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: 'pub',
  VAPID_PRIVATE_KEY: 'priv',
  VAPID_SUBJECT: 'mailto:a@b.c',
} as NodeJS.ProcessEnv;

/**
 * The transport is stubbed for the whole file. Without this the send tests make REAL
 * outbound HTTPS requests to the fake `push.example` endpoints — slow, flaky, and
 * dependent on the machine having network. Individual tests override it per-call to
 * simulate a 410.
 */
beforeEach(() => {
  vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201 } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('push config gating', () => {
  it('is unconfigured unless ALL THREE VAPID vars are set', () => {
    expect(readPushConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(readPushConfig({ VAPID_PUBLIC_KEY: 'p' } as NodeJS.ProcessEnv)).toBeNull();
    expect(readPushConfig({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' } as NodeJS.ProcessEnv)).toBeNull();
    expect(isPushConfigured(VAPID_ENV)).toBe(true);
  });
});

describe('buildPushPayload — the lock-screen rule', () => {
  // This is the whole privacy posture of the feature in one assertion. A push payload is
  // decrypted by the service worker and rendered by the OS on a possibly-locked screen,
  // legible to whoever is holding the phone.
  it('NEVER puts a stored notice body in an incident payload', () => {
    const p = buildPushPayload(notif({ leadersOnly: true, body: 'Student X disclosed …' }));
    expect(JSON.stringify(p)).not.toContain('Student X');
    expect(JSON.stringify(p)).not.toContain('disclosed');
    expect(p.title).toBe('Camp: urgent alert');
    expect(p.body).toBe('Open the app to view details.');
    expect(p.screen).toBe('incidents');
  });

  it('NEVER puts a stored notice body in an ordinary notice payload', () => {
    const p = buildPushPayload(notif({ body: 'BODY-SECRET-TEXT' }));
    expect(JSON.stringify(p)).not.toContain('BODY-SECRET-TEXT');
    expect(p.title).toBe('Camp notice');
  });

  it('carries the aggregate count for a check-in warning — the one deliberate exception', () => {
    const p = buildPushPayload(
      notif({ dedupeKey: 'checkin-warn:2026-09-29~am:usr_a', body: '3 students still to check in — the morning window closes at 12:00.' }),
    );
    expect(p.body).toContain('3 students');
    expect(p.screen).toBe('checkin');
    // No name, no church, no grade — a count is not personal data about a minor.
    expect(p.tag).toBe('camp-checkin');
  });

  it('uses generic tags only — never a person or session id', () => {
    const p = buildPushPayload(notif({ dedupeKey: 'checkin-warn:2026-09-29~am:usr_abc' }));
    expect(p.tag).not.toContain('usr_abc');
    expect(p.tag).not.toContain('2026-09-29');
  });
});

describe('isPushSuppressed (D8)', () => {
  it('suppresses an inactive account', () => {
    expect(isPushSuppressed(user({ status: 'inactive' }), settings())).toBe(true);
  });

  it('suppresses a church login when churchLoginLocked — the post-camp control', () => {
    const u = user({ role: 'church', churchId: 'c1', zone: null });
    expect(isPushSuppressed(u, settings())).toBe(false);
    expect(isPushSuppressed(u, settings({ churchLoginLocked: true }))).toBe(true);
  });

  it('suppresses a zoneLeader when zoneLeaderLoginLocked', () => {
    expect(isPushSuppressed(user(), settings({ zoneLeaderLoginLocked: true }))).toBe(true);
  });

  it('does NOT suppress mustChangePassword — that blocks app use, not alerting', () => {
    expect(isPushSuppressed(user({ mustChangePassword: true }), settings())).toBe(false);
  });

  it('a lock on one role does not suppress the other', () => {
    const church = user({ role: 'church', churchId: 'c1', zone: null });
    expect(isPushSuppressed(church, settings({ zoneLeaderLoginLocked: true }))).toBe(false);
  });
});

describe('resolvePushAudience — inverse of the feed filter', () => {
  it('never resolves a leadersOnly notice to a church login', () => {
    const church = user({ id: 'u-church', role: 'church', churchId: 'c1', zone: null });
    const zl = user({ id: 'u-zl', role: 'zoneLeader', zone: 'Blue' });
    const out = resolvePushAudience(notif({ leadersOnly: true }), [church, zl], settings(), NOW);
    expect(out.map((u) => u.id)).toEqual(['u-zl']);
  });

  it('a TARGETED notice resolves to exactly that one login, not admin or director', () => {
    const target = user({ id: 'u-bvic', role: 'church', churchId: 'c1', zone: null });
    const other = user({ id: 'u-gvic', role: 'church', churchId: 'c1', zone: null });
    const admin = user({ id: 'u-admin', role: 'admin', zone: null });
    const n = notif({ scope: 'church', churchId: 'c1', targetUserId: 'u-bvic' });
    const out = resolvePushAudience(n, [target, other, admin], settings(), NOW);
    expect(out.map((u) => u.id)).toEqual(['u-bvic']);
  });

  it('withholds a scheduled notice until its publish time', () => {
    const zl = user();
    const future = notif({ scheduledFor: '2026-09-30T00:00:00.000Z' });
    expect(resolvePushAudience(future, [zl], settings(), NOW)).toEqual([]);
  });

  it('excludes suppressed accounts even when the notice matches their scope', () => {
    const zl = user();
    expect(resolvePushAudience(notif(), [zl], settings(), NOW)).toHaveLength(1);
    expect(resolvePushAudience(notif(), [zl], settings({ zoneLeaderLoginLocked: true }), NOW)).toEqual([]);
  });
});

describe('makePushService.sendForNotifications', () => {
  let subs: InMemoryPushSubscriptionRepository;
  let notifs: InMemoryNotificationRepository;

  beforeEach(async () => {
    subs = new InMemoryPushSubscriptionRepository();
    notifs = new InMemoryNotificationRepository();
    await subs.init();
    await notifs.init();
  });

  async function addDevices(userId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await subs.save({
        id: `${userId}-d${i}`,
        userId,
        endpoint: `https://push.example/${userId}/${i}`,
        p256dh: 'p',
        auth: 'a',
        consentVersion: 1,
        createdAt: NOW,
        lastSuccessAt: null,
        lastFailureAt: null,
        failureCount: 0,
      });
    }
  }

  it('does NOTHING and claims NOTHING when VAPID is unconfigured', async () => {
    // Load-bearing: claiming here would set push_sent_at on notices that were never sent,
    // and the claim is permanent — every notice created before the keys are configured
    // would be silently swallowed and could never push.
    const svc = makePushService({ subscriptions: subs, notifications: notifs, env: {} as NodeJS.ProcessEnv });
    const u = user();
    await addDevices(u.id, 2);
    const n = notif();
    await notifs.save(n);

    const res = await svc.sendForNotifications([n], [u], settings());
    expect(res).toEqual({ attempted: 0, succeeded: 0, failed: 0, pruned: 0, deferred: 0 });

    const stored = await notifs.findById('n1');
    expect(stored?.pushSentAt ?? null).toBeNull();
  });

  it('caps sends at MAX_PUSH_SENDS_PER_TICK and defers the rest, leaving them unclaimed', async () => {
    const svc = makePushService({
      subscriptions: subs,
      notifications: notifs,
      env: VAPID_ENV,
      sleep: async () => {},
      random: () => 0,
    });

    // 26 church logins × 4 devices = 104 sends — the real camp shape.
    const users: User[] = [];
    const ns: Notification[] = [];
    for (let i = 0; i < 26; i++) {
      const uid = `u${i}`;
      users.push(user({ id: uid, role: 'church', churchId: `c${i}`, zone: null }));
      await addDevices(uid, 4);
      const n = notif({ id: `n${i}`, scope: 'church', churchId: `c${i}`, targetUserId: uid, dedupeKey: `checkin-warn:s:${uid}` });
      ns.push(n);
      await notifs.save(n);
    }

    const res = await svc.sendForNotifications(ns, users, settings());

    expect(res.attempted).toBeLessThanOrEqual(MAX_PUSH_SENDS_PER_TICK);
    expect(res.attempted + res.deferred).toBe(104);
    expect(res.deferred).toBeGreaterThan(0);

    // The deferred notices must remain UNCLAIMED so the next tick can pick them up —
    // this is what makes capping safe rather than lossy.
    const all = await notifs.findAll();
    const claimed = all.filter((n) => n.pushSentAt != null).length;
    expect(claimed).toBe(res.attempted / 4);
    expect(claimed).toBeLessThan(26);
  });

  it('a second tick sends what the first deferred', async () => {
    const mk = () => makePushService({
      subscriptions: subs, notifications: notifs, env: VAPID_ENV,
      sleep: async () => {}, random: () => 0,
    });
    const users: User[] = [];
    const ns: Notification[] = [];
    for (let i = 0; i < 26; i++) {
      const uid = `u${i}`;
      users.push(user({ id: uid, role: 'church', churchId: `c${i}`, zone: null }));
      await addDevices(uid, 4);
      const n = notif({ id: `n${i}`, scope: 'church', churchId: `c${i}`, targetUserId: uid });
      ns.push(n);
      await notifs.save(n);
    }

    const first = await mk().sendForNotifications(ns, users, settings());
    const remaining = (await notifs.findAll()).filter((n) => n.pushSentAt == null);
    const second = await mk().sendForNotifications(remaining, users, settings());

    expect(first.attempted).toBeGreaterThan(0);
    expect(second.attempted).toBeGreaterThan(0);
    // No device is ever sent the same notice twice — the claim guarantees disjoint sets.
    expect(first.attempted + second.attempted).toBeLessThanOrEqual(104);
  });

  it('never pushes the same notice twice across two overlapping runs', async () => {
    const mk = () => makePushService({
      subscriptions: subs, notifications: notifs, env: VAPID_ENV,
      sleep: async () => {}, random: () => 0,
    });
    const u = user();
    await addDevices(u.id, 2);
    const n = notif();
    await notifs.save(n);

    const a = await mk().sendForNotifications([n], [u], settings());
    const b = await mk().sendForNotifications([n], [u], settings());

    expect(a.attempted).toBe(2);
    expect(b.attempted).toBe(0); // already claimed
  });

  it('applies jitter within the configured window', async () => {
    const delays: number[] = [];
    const svc = makePushService({
      subscriptions: subs, notifications: notifs, env: VAPID_ENV,
      sleep: async (ms) => { delays.push(ms); },
      random: () => 0.5,
    });
    const u = user();
    await addDevices(u.id, 3);
    const n = notif();
    await notifs.save(n);

    await svc.sendForNotifications([n], [u], settings());
    expect(delays).toHaveLength(3);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(4000);
    }
  });

  it('prunes a subscription the push service reports as gone (404/410)', async () => {
    const svc = makePushService({
      subscriptions: subs, notifications: notifs, env: VAPID_ENV,
      sleep: async () => {}, random: () => 0,
    });
    const u = user();
    await addDevices(u.id, 1);
    const n = notif();
    await notifs.save(n);

    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    );

    const res = await svc.sendForNotifications([n], [u], settings());
    expect(res.pruned).toBe(1);
    expect(await subs.findByUser(u.id)).toHaveLength(0);
  });

  it('records a successful send and clears the failure count', async () => {
    const svc = makePushService({
      subscriptions: subs, notifications: notifs, env: VAPID_ENV,
      sleep: async () => {}, random: () => 0,
    });
    const u = user();
    await addDevices(u.id, 2);
    const n = notif();
    await notifs.save(n);

    const res = await svc.sendForNotifications([n], [u], settings());
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.pruned).toBe(0);
    const after = await subs.findByUser(u.id);
    expect(after.every((s) => s.lastSuccessAt != null && s.failureCount === 0)).toBe(true);
  });
});
