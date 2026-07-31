import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeCronService } from './cron.service';
import type { CronServiceDeps } from './cron.service';
import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';
import type { Notification } from '../core/entities/notification';
import { InMemoryNotificationRepository } from '../repositories/in-memory';

const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];

function settings(over: Partial<CampSettings> = {}): CampSettings {
  return {
    id: 'settings',
    campName: 'Camp',
    year: 2026,
    startDate: '2026-09-28',
    endDate: '2026-09-30',
    timezone: 'Australia/Brisbane',
    checkInDays: DAYS,
    accommodationLocked: false,
    churchLoginLocked: false,
    zoneLeaderLoginLocked: false,
    churchCheckinTimeRestricted: true,
    checkinSwitchoverTime: '12:00',
    checkinPhaseOverride: 'auto',
    checkinWindowAmStart: '06:00',
    checkinWindowAmEnd: '12:00',
    checkinWindowPmStart: '12:00',
    checkinWindowPmEnd: '22:00',
    campMode: 'at-camp',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as CampSettings;
}

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    firstName: 'A',
    lastName: 'B',
    kind: 'youth',
    gender: 'male',
    churchId: 'ch_victory',
    churchName: 'Victory',
    zone: 'Blue',
    lifecycle: 'arrived',
    atCamp: true,
    checkInHistory: [],
    signOutHistory: [],
    medicalConditions: [],
    ...over,
  } as unknown as Person;
}

function user(over: Partial<User> = {}): User {
  return {
    id: 'usr_bv',
    firstName: 'Victory',
    lastName: 'Boys',
    username: 'b-victory',
    role: 'church',
    churchId: 'ch_victory',
    churchName: 'Victory',
    zone: 'Blue',
    genderScope: 'male',
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as User;
}

/**
 * A REAL (throwaway) VAPID keypair — the same one push.service.test.ts uses, and it exists
 * for the same reason: `isPushConfigured()` validates key SHAPE, so a placeholder string
 * would make job C silently no-op and the gate test below would pass without testing it.
 */
const VALID_PUB = 'BJ-idCQNM8bZ2axCsNHf4JYvMsj4GGSIcjfENwYKV4tBNOIRFxk0jNeyR2vWk6QLlWLgJj_QaUPCM1xzlNI9Gbk';
const VALID_PRIV = 'XkGecBFumrALnTadmHDalScbnqMUMfyZ5c8Vxozax80';

/** 2026-09-29 11:05 Brisbane == 01:05 UTC the same day. 55 min before amEnd 12:00. */
const IN_AM_LEAD = new Date('2026-09-29T01:05:00.000Z');

interface Stubs {
  deps: CronServiceDeps;
  peopleFindAll: ReturnType<typeof vi.fn>;
  usersFindAll: ReturnType<typeof vi.fn>;
  notificationsSave: ReturnType<typeof vi.fn>;
}

function makeStubs(opts: {
  settingsSingleton: CampSettings | null;
  people?: Person[];
  users?: User[];
  saveImpl?: (n: Notification) => Promise<Notification>;
}): Stubs {
  const peopleFindAll = vi.fn(async () => opts.people ?? []);
  const usersFindAll = vi.fn(async () => opts.users ?? []);
  const notificationsSave =
    opts.saveImpl != null
      ? vi.fn(opts.saveImpl)
      : vi.fn(async (n: Notification) => n);

  const deps = {
    notifications: {
      save: notificationsSave,
    } as unknown as CronServiceDeps['notifications'],
    people: {
      findAll: peopleFindAll,
    } as unknown as CronServiceDeps['people'],
    users: {
      findAll: usersFindAll,
    } as unknown as CronServiceDeps['users'],
    settings: {
      getSingleton: vi.fn(async () => opts.settingsSingleton),
    } as unknown as CronServiceDeps['settings'],
  } as CronServiceDeps;

  return { deps, peopleFindAll, usersFindAll, notificationsSave };
}

describe('makeCronService().run', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an idle tick (restriction off) returns zeros and never touches the people table', async () => {
    const { deps, peopleFindAll } = makeStubs({
      settingsSingleton: settings({ churchCheckinTimeRestricted: false }),
      people: [person()],
      users: [user()],
    });
    const cron = makeCronService(deps);
    const result = await cron.run();
    expect(result).toEqual({ ok: true, checkinWarningsCreated: 0, failed: 0, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });
    expect(peopleFindAll).not.toHaveBeenCalled();
  });

  it('saves exactly one notification for a church behind inside the lead window', async () => {
    const { deps, notificationsSave } = makeStubs({
      settingsSingleton: settings(),
      people: [person()],
      users: [user()],
    });
    vi.useFakeTimers();
    vi.setSystemTime(IN_AM_LEAD);
    const cron = makeCronService(deps);
    const result = await cron.run();
    expect(result).toEqual({ ok: true, checkinWarningsCreated: 1, failed: 0, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });
    expect(notificationsSave).toHaveBeenCalledTimes(1);
    const saved = notificationsSave.mock.calls[0]?.[0] as Notification;
    expect(saved.dedupeKey).toBe('checkin-warn:2026-09-29~am:usr_bv');
    expect(saved.scope).toBe('church');
    expect(saved.priority).toBe('urgent');
    expect(saved.leadersOnly).toBe(false);
    // Addressed to the one login whose count it carries — NOT the whole church.
    expect(saved.targetUserId).toBe('usr_bv');
    // Expires when the AM window closes: 12:00 Brisbane == 02:00 UTC.
    expect(saved.expiresAt).toBe('2026-09-29T02:00:00.000Z');
  });

  it('the gendered login pair get one notice each, addressed separately', async () => {
    // Regression: both notices were church-scoped, so each login saw both counts, and every
    // admin/director saw all of them. 2 boys + 1 girl outstanding at the same church.
    const { deps, notificationsSave } = makeStubs({
      settingsSingleton: settings(),
      people: [
        person({ id: 'b1', gender: 'male' }),
        person({ id: 'b2', gender: 'male' }),
        person({ id: 'g1', gender: 'female' }),
      ],
      users: [
        user({ id: 'usr_bv', username: 'b-victory', genderScope: 'male' }),
        user({ id: 'usr_gv', username: 'g-victory', genderScope: 'female' }),
      ],
    });
    vi.useFakeTimers();
    vi.setSystemTime(IN_AM_LEAD);
    const result = await makeCronService(deps).run();
    expect(result.checkinWarningsCreated).toBe(2);

    const saved = notificationsSave.mock.calls.map((c) => c[0] as Notification);
    expect(saved.map((n) => [n.targetUserId, n.audienceEstimate])).toEqual([
      ['usr_bv', 2],
      ['usr_gv', 1],
    ]);
    // Both still carry the shared churchId — targeting is what separates them.
    expect(new Set(saved.map((n) => n.churchId))).toEqual(new Set(['ch_victory']));
    expect(new Set(saved.map((n) => n.dedupeKey)).size).toBe(2);
  });

  it('a 23505 duplicate save is treated as expected: no throw, not counted created, failed stays 0', async () => {
    const { deps } = makeStubs({
      settingsSingleton: settings(),
      people: [person()],
      users: [user()],
      saveImpl: async () => {
        const err = new Error('duplicate key value violates unique constraint') as Error & { code: string };
        err.code = '23505';
        throw err;
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(IN_AM_LEAD);
    const cron = makeCronService(deps);
    const result = await cron.run();
    expect(result).toEqual({ ok: true, checkinWarningsCreated: 0, failed: 0, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });
  });

  it('a non-duplicate save error does not abort the run — the other church still gets its notice', async () => {
    // Two churches behind: usr_bv (fails) and usr_gv (succeeds).
    const bv = user({ id: 'usr_bv', username: 'b-victory', genderScope: 'male' });
    const gv = user({ id: 'usr_gv', username: 'g-victory', genderScope: 'female' });
    const people = [
      person({ id: 'p1', gender: 'male' }),
      person({ id: 'p2', gender: 'female' }),
    ];
    let call = 0;
    const { deps, notificationsSave } = makeStubs({
      settingsSingleton: settings(),
      people,
      users: [bv, gv],
      saveImpl: async (n: Notification) => {
        call += 1;
        if (call === 1) {
          const err = new Error('column "dedupe_key" does not exist') as Error & { code: string };
          err.code = '42703';
          throw err;
        }
        return n;
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(IN_AM_LEAD);
    const cron = makeCronService(deps);
    const result = await cron.run();
    expect(result).toEqual({ ok: true, checkinWarningsCreated: 1, failed: 1, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });
    expect(notificationsSave).toHaveBeenCalledTimes(2);
  });

  it('a missing settings singleton returns zeros without throwing', async () => {
    const { deps, peopleFindAll } = makeStubs({ settingsSingleton: null });
    const cron = makeCronService(deps);
    const result = await cron.run();
    expect(result).toEqual({ ok: true, checkinWarningsCreated: 0, failed: 0, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });
    expect(peopleFindAll).not.toHaveBeenCalled();
  });

  // Every test above stubs `save`, so none of them exercises the dedupe for real. This one runs
  // the tick twice against the REAL in-memory repository — which now enforces the same partial
  // unique index on dedupe_key that migration 0013 puts on Postgres, and raises the same 23505.
  it('twelve ticks inside the lead window leave exactly ONE notice (real repository)', async () => {
    const notifications = new InMemoryNotificationRepository();
    await notifications.init();
    const deps = {
      notifications,
      people: { findAll: async () => [person()] } as unknown as CronServiceDeps['people'],
      users: { findAll: async () => [user()] } as unknown as CronServiceDeps['users'],
      settings: { getSingleton: async () => settings() } as unknown as CronServiceDeps['settings'],
    } as CronServiceDeps;

    vi.useFakeTimers();
    vi.setSystemTime(IN_AM_LEAD);
    const cron = makeCronService(deps);

    const first = await cron.run();
    expect(first).toEqual({ ok: true, checkinWarningsCreated: 1, failed: 0, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });

    // 11 more ticks, 5 minutes apart, all still inside the 60-minute lead window.
    for (let i = 1; i < 12; i++) {
      vi.setSystemTime(new Date(IN_AM_LEAD.getTime() + i * 5 * 60 * 1000));
      const again = await cron.run();
      // A duplicate is the dedupe working: not created, and NOT counted as a failure.
      expect(again).toEqual({ ok: true, checkinWarningsCreated: 0, failed: 0, pushAttempted: 0, pushSucceeded: 0, pushDeferred: 0 });
    }

    expect(await notifications.findAll()).toHaveLength(1);
  });

  // Job C's gate. The service applies the same rule again (push.service.test.ts), but this
  // asserts the CHEAP half: a normal notice is dropped before any subscription lookup, so
  // 288 ticks a day do not fan out over every routine notice for the life of the camp.
  it('job C hands the push service only pushable notices', async () => {
    const notifications = new InMemoryNotificationRepository();
    await notifications.init();

    const base = {
      scope: 'camp' as const, zone: null, churchId: null, senderId: 'u1', senderName: 'Dir',
      senderRole: 'director' as const, audienceEstimate: 0, expiresAt: null, scheduledFor: null,
      pushSentAt: null, dedupeKey: null, targetUserId: null, createdAt: '2026-09-29T00:00:00.000Z',
    };
    await notifications.save({ ...base, id: 'n-normal', priority: 'normal', title: 'Dinner at 6', body: 'b', leadersOnly: false });
    await notifications.save({ ...base, id: 'n-urgent', priority: 'urgent', title: 'Bus leaving', body: 'b', leadersOnly: false });
    await notifications.save({ ...base, id: 'n-incident', priority: 'urgent', title: 'Incident logged', body: 'b', leadersOnly: true });

    const seen: string[][] = [];
    const deps = {
      notifications,
      people: { findAll: vi.fn(async () => []) } as unknown as CronServiceDeps['people'],
      users: { findAll: vi.fn(async () => [user()]) } as unknown as CronServiceDeps['users'],
      settings: { getSingleton: vi.fn(async () => settings({ churchCheckinTimeRestricted: false })) } as unknown as CronServiceDeps['settings'],
      push: {
        sendForNotifications: vi.fn(async (ns: Notification[]) => {
          seen.push(ns.map((n) => n.id));
          return { attempted: 0, succeeded: 0, failed: 0, pruned: 0, deferred: 0 };
        }),
      } as unknown as CronServiceDeps['push'],
    } as CronServiceDeps;

    const env = process.env['VAPID_PUBLIC_KEY'];
    process.env['VAPID_PUBLIC_KEY'] = VALID_PUB;
    process.env['VAPID_PRIVATE_KEY'] = VALID_PRIV;
    process.env['VAPID_SUBJECT'] = 'mailto:camp@example.org';
    try {
      await makeCronService(deps).run();
    } finally {
      if (env == null) { delete process.env['VAPID_PUBLIC_KEY']; } else { process.env['VAPID_PUBLIC_KEY'] = env; }
      delete process.env['VAPID_PRIVATE_KEY'];
      delete process.env['VAPID_SUBJECT'];
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]!.sort()).toEqual(['n-incident', 'n-urgent']);
  });
});
