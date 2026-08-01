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
  PUSH_TITLE_MAX,
  isPushable,
  PUSH_TICK_BUDGET_MS,
  PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS,
} from './push.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    // 'urgent' by default because almost every test in this file exercises the SEND path,
    // and since 2026-07-31 only urgent notices enter it (see isPushable). A fixture that
    // defaults to 'normal' would make most of these tests assert on an empty result while
    // still looking like they were testing the fan-out. The normal-priority case is tested
    // explicitly, on purpose, in the isPushable suite below.
    priority: 'urgent',
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

/**
 * A REAL (throwaway) VAPID keypair, never used anywhere but this file.
 *
 * ⚠ Do not shorten these back to `'pub'`/`'priv'`. `readPushConfig` now validates the key
 * SHAPE, and the placeholders this fixture used to carry are exactly the class of value the
 * 2026-07-31 production incident put in the env var — so the old fixture was structurally
 * incapable of catching it, and every test here passed while prod served table text to
 * clients. A fixture that could not represent the bug is worse than no fixture.
 */
const VAPID_ENV = {
  VAPID_PUBLIC_KEY: 'BJ-idCQNM8bZ2axCsNHf4JYvMsj4GGSIcjfENwYKV4tBNOIRFxk0jNeyR2vWk6QLlWLgJj_QaUPCM1xzlNI9Gbk',
  VAPID_PRIVATE_KEY: 'XkGecBFumrALnTadmHDalScbnqMUMfyZ5c8Vxozax80',
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

  /**
   * Regression guard for the 2026-07-31 production incident: `VAPID_PUBLIC_KEY` held pasted
   * TABLE TEXT — including the private key and CRON_SECRET rows. It was served verbatim to
   * every authenticated client by `GET /push/config`, and reached the SPA's `atob()`, whose
   * `InvalidCharacterError` on a leader's phone was the only symptom anyone ever saw.
   *
   * A structurally invalid key must make the feature INERT, never half-working, and must
   * never be handed to a client.
   */
  describe('malformed VAPID values are rejected, not served', () => {
    // Quiet the deliberate console.error these cases emit.
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('rejects the exact shape of the incident — a multi-line table paste', () => {
      const pasted =
        'VAPID_PRIVATE_KEY|3x_AQQLPQkbMUttSI1RQT3R6lusG04pSiuh8kzZuxY4|yes\n' +
        'VAPID_SUBJECT|mailto:youth@example.com|no\n';
      expect(
        readPushConfig({ ...VAPID_ENV, VAPID_PUBLIC_KEY: pasted } as NodeJS.ProcessEnv),
      ).toBeNull();
    });

    it('rejects a public key that is valid base64url but the wrong length', () => {
      expect(
        readPushConfig({ ...VAPID_ENV, VAPID_PUBLIC_KEY: 'QUJD' } as NodeJS.ProcessEnv),
      ).toBeNull();
    });

    it('rejects a 65-byte public key that is not an uncompressed point (no 0x04 tag)', () => {
      const wrongTag = Buffer.alloc(65, 1).toString('base64url');
      expect(
        readPushConfig({ ...VAPID_ENV, VAPID_PUBLIC_KEY: wrongTag } as NodeJS.ProcessEnv),
      ).toBeNull();
    });

    it('rejects a private key that is not a 32-byte scalar', () => {
      expect(
        readPushConfig({ ...VAPID_ENV, VAPID_PRIVATE_KEY: 'QUJD' } as NodeJS.ProcessEnv),
      ).toBeNull();
    });

    it('rejects a subject that is neither mailto: nor https://', () => {
      expect(
        readPushConfig({ ...VAPID_ENV, VAPID_SUBJECT: 'youth@example.com' } as NodeJS.ProcessEnv),
      ).toBeNull();
    });

    /* A trailing newline from `vercel env add` is invisible and is the single most likely
       paste defect. It must be tolerated, not treated as corruption. */
    it('tolerates surrounding whitespace on all three values', () => {
      const cfg = readPushConfig({
        VAPID_PUBLIC_KEY: `  ${VAPID_ENV['VAPID_PUBLIC_KEY']}\n`,
        VAPID_PRIVATE_KEY: `${VAPID_ENV['VAPID_PRIVATE_KEY']}\n`,
        VAPID_SUBJECT: ' mailto:a@b.c ',
      } as NodeJS.ProcessEnv);
      expect(cfg).not.toBeNull();
      expect(cfg?.publicKey).toBe(VAPID_ENV['VAPID_PUBLIC_KEY']);
      expect(cfg?.subject).toBe('mailto:a@b.c');
    });
  });
});

describe('buildPushPayload — the lock-screen rule', () => {
  // This is the whole privacy posture of the feature in one assertion. A push payload is
  // decrypted by the service worker and rendered by the OS on a possibly-locked screen,
  // legible to whoever is holding the phone.
  it('NEVER puts a stored notice body in an incident payload', () => {
    const p = buildPushPayload(
      notif({ leadersOnly: true, title: 'Incident logged · Blue Zone', body: 'Student X disclosed …' }),
    );
    expect(JSON.stringify(p)).not.toContain('Student X');
    expect(JSON.stringify(p)).not.toContain('disclosed');
    expect(p.title).toBe('Incident logged · Blue Zone');
    expect(p.body).toBe('Open the app to view details.');
    expect(p.screen).toBe('incidents');
  });

  it('NEVER puts a stored notice body in an ordinary notice payload', () => {
    const p = buildPushPayload(notif({ title: 'Dinner moved to 6pm', body: 'BODY-SECRET-TEXT' }));
    expect(JSON.stringify(p)).not.toContain('BODY-SECRET-TEXT');
    // The TITLE travels (owner's rule, 2026-07-31); the body never does.
    expect(p.title).toBe('Dinner moved to 6pm');
    expect(p.body).toBe('Open the app to read it.');
  });

  it('single-lines and caps an author-written title, and falls back when it is empty', () => {
    const multi = buildPushPayload(notif({ title: '  Bus   leaving\n  early  ' }));
    expect(multi.title).toBe('Bus leaving early');

    const long = buildPushPayload(notif({ title: 'x'.repeat(200) }));
    expect(long.title.length).toBe(PUSH_TITLE_MAX);
    expect(long.title.endsWith('…')).toBe(true);

    // A title of only whitespace must not produce a blank OS notification.
    expect(buildPushPayload(notif({ title: '   ' })).title).toBe('Camp notice');
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

  // Regression, 2026-07-31: this returned screen 'notices', and the SPA's Notices screen is
  // 'notifs'. _showScreen() deactivates every screen then matches nothing, so a tapped
  // notification opened the app on a BLANK page — no error, nothing in any log. Every screen
  // named here must be an id that actually exists in public/index.html.
  it('only ever names a screen the SPA actually has', () => {
    // cwd, not __dirname: vitest transforms these files to ESM, where __dirname is undefined.
    const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
    const ids = new Set(
      [...html.matchAll(/<section class="screen" id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]!),
    );
    expect(ids.size).toBeGreaterThan(10); // the scrape itself still works

    const screens = [
      buildPushPayload(notif({ dedupeKey: 'checkin-warn:s:u' })).screen,
      buildPushPayload(notif({ leadersOnly: true })).screen,
      buildPushPayload(notif()).screen,
    ];
    for (const s of screens) expect(ids.has(s)).toBe(true);
  });

  it('uses generic tags only — never a person or session id', () => {
    const p = buildPushPayload(notif({ dedupeKey: 'checkin-warn:2026-09-29~am:usr_abc' }));
    expect(p.tag).not.toContain('usr_abc');
    expect(p.tag).not.toContain('2026-09-29');
  });
});

describe('isPushable — normal notices stay in the app (owner rule, 2026-07-31)', () => {
  it('does not push an ordinary normal-priority notice', () => {
    expect(isPushable(notif({ priority: 'normal' }))).toBe(false);
  });

  it('pushes an urgent notice', () => {
    expect(isPushable(notif({ priority: 'urgent' }))).toBe(true);
  });

  // Both system triggers set priority 'urgent' themselves; these assert they would still
  // be pushed if that ever changed, so a safeguarding alert can't be silently demoted.
  it('pushes an incident alert regardless of priority', () => {
    expect(isPushable(notif({ priority: 'normal', leadersOnly: true }))).toBe(true);
  });

  it('pushes a check-in warning regardless of priority', () => {
    expect(isPushable(notif({ priority: 'normal', dedupeKey: 'checkin-warn:s:u' }))).toBe(true);
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

  it('skips a normal-priority notice entirely — and does NOT claim it', async () => {
    const svc = makePushService({
      subscriptions: subs, notifications: notifs, env: VAPID_ENV,
      sleep: async () => {}, random: () => 0,
    });
    const u = user();
    await addDevices(u.id, 2);
    const n = notif({ priority: 'normal' });
    await notifs.save(n);

    const res = await svc.sendForNotifications([n], [u], settings());
    expect(res.attempted).toBe(0);
    // Unclaimed matters: if the owner ever reverts to pushing normal notices, the pending
    // ones deliver rather than having been silently burned.
    expect((await notifs.findById('n1'))?.pushSentAt ?? null).toBeNull();
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

  /**
   * Defect 3 (2026-08-01): every test above injects `sleep: async () => {}`, which never
   * models wall-clock cost at all — the fan-out could take 93 real seconds against a 30s
   * ceiling and every one of those tests would still pass. These tests model TIME instead:
   * vitest's fake timers virtualize the REAL (non-stubbed) `setTimeout`-based `sleep` plus a
   * stubbed `sendOne` latency, so `Promise.all`/concurrency/`await` ordering all run for
   * real — only the clock is fake. That is what lets the assertion below distinguish "the
   * send loop is actually concurrent" from "the send loop is sequential but fast in test
   * because nothing really waits" (a hand-rolled elapsed-ms counter can't see concurrency;
   * fake timers can, because chained `setTimeout`s from parallel tasks interleave exactly as
   * they would on a real clock).
   *
   * ⚠ Verified these FAIL against the pre-2026-08-01 implementation: that loop was strictly
   * sequential and slept `Math.floor(random()*PUSH_JITTER_MS)` BEFORE EVERY send. With
   * `random` pinned to 1 (full 4000ms jitter every time) a 40-send tick needs
   * 40 × (4000 + 325) ≈ 173 SECONDS of virtual time — `advanceTimersByTimeAsync` is only
   * given `PUSH_TICK_BUDGET_MS` (30s) below, so `settled` would still be `false` and the
   * assertion fails. Confirmed by reasoning against the old sequential-loop source (see the
   * HISTORICAL BUG comment on `MAX_PUSH_SENDS_PER_TICK` in push.service.ts) rather than by
   * re-reverting the file, since the fix is already in place.
   */
  describe('worst-case timing — defects 1 and 2 (fan-out cannot finish in 30s; oversized notice never sent)', () => {
    const SEND_LATENCY_MS = 325;

    function mockDelayedSend(): void {
      vi.spyOn(webpush, 'sendNotification').mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ statusCode: 201 } as never), SEND_LATENCY_MS);
          }),
      );
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('a full-cap tick (40 sends, worst-case jitter) completes within PUSH_TICK_BUDGET_MS', async () => {
      vi.useFakeTimers();
      mockDelayedSend();

      const svc = makePushService({
        subscriptions: subs,
        notifications: notifs,
        env: VAPID_ENV,
        // Real (setTimeout-based) default sleep — fake timers virtualize it.
        // random pinned to the maximum so every send draws the FULL jitter window: the true
        // worst case, not an average-case guess.
        random: () => 1,
      });

      // 10 church notices x 4 devices = 40 sends, exactly MAX_PUSH_SENDS_PER_TICK.
      const users: User[] = [];
      const ns: Notification[] = [];
      for (let i = 0; i < 10; i++) {
        const uid = `u${i}`;
        users.push(user({ id: uid, role: 'church', churchId: `c${i}`, zone: null }));
        await addDevices(uid, 4);
        const n = notif({ id: `n${i}`, scope: 'church', churchId: `c${i}`, targetUserId: uid });
        ns.push(n);
        await notifs.save(n);
      }

      const resultPromise = svc.sendForNotifications(ns, users, settings());
      let settled = false;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      resultPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(PUSH_TICK_BUDGET_MS);
      expect(settled).toBe(true);

      const res = await resultPromise;
      expect(res.attempted).toBe(40);
      expect(res.deferred).toBe(0);
    });

    it('an oversized single notice (104 devices, over the cap) is still sent whole within PUSH_TICK_BUDGET_MS', async () => {
      vi.useFakeTimers();
      mockDelayedSend();

      const svc = makePushService({
        subscriptions: subs,
        notifications: notifs,
        env: VAPID_ENV,
        random: () => 1,
      });

      // Stands in for the real camp-wide shape (~26 churches x ~4 devices) as one oversized
      // notice — the case that used to be deferred on every one of the 288 ticks a day,
      // forever, because it alone always exceeded MAX_PUSH_SENDS_PER_TICK.
      const uid = 'u-camp-wide';
      const u = user({ id: uid, role: 'admin', zone: null });
      await addDevices(uid, 104);
      const n = notif({ id: 'n-big', scope: 'camp', targetUserId: null });
      await notifs.save(n);

      const resultPromise = svc.sendForNotifications([n], [u], settings());
      let settled = false;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      resultPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(PUSH_TICK_BUDGET_MS);
      expect(settled).toBe(true);

      const res = await resultPromise;
      // Forward-progress guarantee (defect 2): an oversized notice must eventually be sent
      // whole, not deferred forever.
      expect(res.attempted).toBe(104);
      expect(res.deferred).toBe(0);
    });

    it('a notice past PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS is not sent, but says so in the log', async () => {
      // The ceiling is the one place the starvation bug survives by design: past it, a notice
      // is deferred forever. That is tolerable ONLY because it is observable — the original
      // bug was so hard to find precisely because `deferred` was counted and never surfaced.
      // This test pins the observability, not the dropping.
      const svc = makePushService({
        subscriptions: subs,
        notifications: notifs,
        env: VAPID_ENV,
        sleep: async () => {},
        random: () => 0,
      });

      const uid = 'u-pathological';
      const u = user({ id: uid, role: 'admin', zone: null });
      const size = PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS + 1;
      await addDevices(uid, size);
      const n = notif({ id: 'n-huge', scope: 'camp', targetUserId: null });
      await notifs.save(n);

      const errs: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((m) => {
        errs.push(String(m));
      });

      const res = await svc.sendForNotifications([n], [u], settings());
      spy.mockRestore();

      expect(res.attempted).toBe(0);
      expect(res.deferred).toBe(size);
      // Never claimed, so a later fix (or a raised ceiling) can still deliver it.
      const after = await notifs.findById('n-huge');
      expect(after?.pushSentAt).toBeNull();
      expect(errs.some((e) => e.includes('n-huge') && e.includes('NOT SENT'))).toBe(true);
    });
  });

  describe('sendTestToUser', () => {
    it('sends only to the calling user’s own devices', async () => {
      const svc = makePushService({ subscriptions: subs, notifications: notifs, env: VAPID_ENV });
      await addDevices('u-me', 2);
      await addDevices('u-someone-else', 3);

      const sent = vi.spyOn(webpush, 'sendNotification');
      const res = await svc.sendTestToUser('u-me');

      expect(res).toEqual({ sent: 2, failed: 0, pruned: 0, configured: true });
      // The endpoints touched must all belong to u-me — this is the whole security property.
      for (const call of sent.mock.calls) {
        expect((call[0] as { endpoint: string }).endpoint).toContain('/u-me/');
      }
    });

    it('writes no notification row', async () => {
      const svc = makePushService({ subscriptions: subs, notifications: notifs, env: VAPID_ENV });
      await addDevices('u-me', 1);
      await svc.sendTestToUser('u-me');
      expect(await notifs.findAll()).toHaveLength(0);
    });

    it('uses the real check-in warning shape, so it exercises the same deep link', async () => {
      const svc = makePushService({ subscriptions: subs, notifications: notifs, env: VAPID_ENV });
      await addDevices('u-me', 1);
      const sent = vi.spyOn(webpush, 'sendNotification');
      await svc.sendTestToUser('u-me', 'checkin');

      const payload = JSON.parse(sent.mock.calls[0]![1] as string);
      expect(payload.screen).toBe(buildPushPayload(notif({ dedupeKey: 'checkin-warn:s:u' })).screen);
      expect(payload.tag).toBe('camp-checkin');
    });

    it('does not count a failed test towards the pruning limit', async () => {
      const svc = makePushService({ subscriptions: subs, notifications: notifs, env: VAPID_ENV });
      await addDevices('u-me', 1);
      // A leader debugging their own phone taps this repeatedly; PUSH_FAILURE_LIMIT taps
      // must not delete the subscription they are trying to test.
      vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
        Object.assign(new Error('boom'), { statusCode: 500 }),
      );
      for (let i = 0; i < 12; i++) await svc.sendTestToUser('u-me');
      expect(await subs.findByUser('u-me')).toHaveLength(1);
    });

    it('still prunes a dead endpoint (410) and reports it', async () => {
      const svc = makePushService({ subscriptions: subs, notifications: notifs, env: VAPID_ENV });
      await addDevices('u-me', 1);
      vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(
        Object.assign(new Error('gone'), { statusCode: 410 }),
      );
      const res = await svc.sendTestToUser('u-me');
      expect(res).toEqual({ sent: 0, failed: 0, pruned: 1, configured: true });
      expect(await subs.findByUser('u-me')).toHaveLength(0);
    });

    it('reports configured:false rather than throwing when VAPID is unset', async () => {
      const svc = makePushService({ subscriptions: subs, notifications: notifs, env: {} as NodeJS.ProcessEnv });
      await addDevices('u-me', 1);
      expect(await svc.sendTestToUser('u-me')).toEqual({ sent: 0, failed: 0, pruned: 0, configured: false });
    });
  });
});
