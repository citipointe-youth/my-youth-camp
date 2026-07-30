import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCheckInService } from './checkin.service';
import { InMemoryPersonRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';

// Check-in sessions are derived from settings.checkInDays (two per day, AM/PM) — the
// schedule is no longer involved. A valid session id is `${day}#am` / `${day}#pm`.
const SESSION_ID = '2026-07-01~am';

function actor(role: Actor['role'] = 'director'): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: 'Test' };
}

function person(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'p1', firstName: 'Ada', lastName: 'L', gender: 'female', kind: 'youth',
    churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
    medicalConditions: [], dietaryRequirements: [],
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid', needsReview: false, lifecycle: 'arrived', atCamp: true,
    checkInHistory: [], signOutHistory: [],
    createdAt: now, updatedAt: now,
    ...over,
  };
}

function settings(over: Partial<CampSettings> = {}): CampSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-05',
    timezone: 'UTC', checkInDays: ['2026-06-30', '2026-07-01', '2026-07-02'],
    accommodationLocked: false, churchLoginLocked: false, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false, checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'at-camp', createdAt: now, updatedAt: now,
    ...over,
  };
}

describe('getSessions — derived from check-in days', () => {
  it('first day is PM-only, interior days AM+PM, last day AM-only (AC-1)', async () => {
    const personRepo = new InMemoryPersonRepository();
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.saveSingleton(settings());
    const svc = makeCheckInService(personRepo, settingsRepo);
    const sessions = await svc.getSessions();
    expect(sessions.map((s) => s.id)).toEqual([
      '2026-06-30~pm', '2026-07-01~am', '2026-07-01~pm', '2026-07-02~am',
    ]);
  });
});

describe('getSessionStatus — roster filter', () => {
  let personRepo: InMemoryPersonRepository;
  let settingsRepo: InMemorySettingsRepository;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.saveSingleton(settings());
  });

  it('includes persons with atCamp=true', async () => {
    await personRepo.save(person({ id: 'p1', atCamp: true, lifecycle: 'arrived' }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0]!.camperId).toBe('p1');
  });

  it('excludes persons with atCamp=false even if isCamper() returns true (checked_out lifecycle)', async () => {
    await personRepo.save(person({ id: 'p2', atCamp: false, lifecycle: 'checked_out' }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);
    expect(result.roster).toHaveLength(0);
  });

  it('excludes persons with atCamp=false and departed lifecycle', async () => {
    await personRepo.save(person({ id: 'p3', atCamp: false, lifecycle: 'departed' }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);
    expect(result.roster).toHaveLength(0);
  });

  it('excludes persons with atCamp=false and registered lifecycle (pre-camp)', async () => {
    await personRepo.save(person({ id: 'p4', atCamp: false, lifecycle: 'registered' }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);
    expect(result.roster).toHaveLength(0);
  });

  it('totalCount reflects only atCamp persons', async () => {
    await personRepo.save(person({ id: 'p1', atCamp: true }));
    await personRepo.save(person({ id: 'p5', atCamp: false, lifecycle: 'checked_out' }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);
    expect(result.totalCount).toBe(1);
  });

  it('rejects a session id for a day outside the camp', async () => {
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.getSessionStatus(actor(), '2030-01-01~am')).rejects.toThrow();
  });

  it('excludes leaders even when atCamp=true — leaders are never on the twice-daily check-in roster', async () => {
    await personRepo.save(person({ id: 'lead1', kind: 'leader', atCamp: true, lifecycle: 'arrived' }));
    await personRepo.save(person({ id: 'p1', kind: 'youth', atCamp: true, lifecycle: 'arrived' }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);
    expect(result.roster.map((r) => r.camperId)).toEqual(['p1']);
    expect(result.totalCount).toBe(1);
  });
});

describe('assertSessionAllowed — item 11 hard AM/PM windows (church only)', () => {
  let personRepo: InMemoryPersonRepository;
  let settingsRepo: InMemorySettingsRepository;

  beforeEach(() => {
    personRepo = new InMemoryPersonRepository();
    settingsRepo = new InMemorySettingsRepository();
  });

  afterEach(() => vi.useRealTimers());

  function pinClock(iso: string): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it('church, restricted, inside the AM window on an interior day: allowed session passes', async () => {
    pinClock('2026-07-01T08:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.assertSessionAllowed(actor('church'), '2026-07-01~am')).resolves.toBeUndefined();
  });

  it('church, restricted, inside the AM window but wrong session id: throws naming the allowed session', async () => {
    pinClock('2026-07-01T08:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.assertSessionAllowed(actor('church'), '2026-07-01~pm')).rejects.toThrow(/limited to the/);
  });

  it('church, restricted, outside both windows: throws "closed right now"', async () => {
    pinClock('2026-07-01T23:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.assertSessionAllowed(actor('church'), '2026-07-01~pm')).rejects.toThrow(/closed right now/);
  });

  it('church, restricted, on a non-camp day: throws "closed right now"', async () => {
    pinClock('2026-08-01T08:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.assertSessionAllowed(actor('church'), '2026-07-01~am')).rejects.toThrow(/closed right now/);
  });

  it('church, restriction OFF: any session at any time passes (no-op)', async () => {
    pinClock('2026-07-01T23:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: false }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.assertSessionAllowed(actor('church'), '2026-07-01~pm')).resolves.toBeUndefined();
  });

  it('non-church roles bypass entirely, even when restricted and outside all windows', async () => {
    pinClock('2026-07-01T23:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    for (const role of ['director', 'admin', 'zoneLeader', 'firstAid'] as const) {
      await expect(svc.assertSessionAllowed(actor(role), '2026-07-01~pm')).resolves.toBeUndefined();
    }
  });

  it('respects custom admin-edited windows', async () => {
    pinClock('2026-07-01T09:30:00Z');
    await settingsRepo.saveSingleton(
      settings({
        churchCheckinTimeRestricted: true,
        checkinWindowAmStart: '09:00',
        checkinWindowAmEnd: '10:00',
      }),
    );
    const svc = makeCheckInService(personRepo, settingsRepo);
    await expect(svc.assertSessionAllowed(actor('church'), '2026-07-01~am')).resolves.toBeUndefined();
  });
});

// The SPA needs to know, BEFORE a leader taps a row, which session it may write to — otherwise
// it unlocks the roster and every tap 403s. It used to derive that from getCurrentSession(),
// which is a different rule (see the regression test at the bottom of this block).
describe('getAllowedSession — the write rule, exposed for the UI', () => {
  let personRepo: InMemoryPersonRepository;
  let settingsRepo: InMemorySettingsRepository;

  beforeEach(() => {
    personRepo = new InMemoryPersonRepository();
    settingsRepo = new InMemorySettingsRepository();
  });

  afterEach(() => vi.useRealTimers());

  function pinClock(iso: string): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it('church, restricted, inside the AM window: returns that session and no reason', async () => {
    pinClock('2026-07-01T08:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const res = await svc.getAllowedSession(actor('church'));
    expect(res.restricted).toBe(true);
    expect(res.session?.id).toBe('2026-07-01~am');
    expect(res.reason).toBeNull();
  });

  it('church, restricted, on a NON-camp day: no session, and a reason the UI can show', async () => {
    pinClock('2026-08-01T08:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const res = await svc.getAllowedSession(actor('church'));
    expect(res.restricted).toBe(true);
    expect(res.session).toBeNull();
    expect(res.reason).toMatch(/closed right now/);
  });

  it('church, restricted, between the windows: no session, with a reason', async () => {
    pinClock('2026-07-01T23:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const res = await svc.getAllowedSession(actor('church'));
    expect(res.session).toBeNull();
    expect(res.reason).toMatch(/closed right now/);
  });

  it('church with the restriction OFF reports restricted:false — the UI must not lock anything', async () => {
    pinClock('2026-08-01T23:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: false }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    const res = await svc.getAllowedSession(actor('church'));
    expect(res.restricted).toBe(false);
    expect(res.reason).toBeNull();
  });

  it('non-church roles report restricted:false even when the setting is on', async () => {
    pinClock('2026-08-01T23:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    for (const role of ['director', 'admin', 'zoneLeader', 'firstAid'] as const) {
      expect((await svc.getAllowedSession(actor(role))).restricted).toBe(false);
    }
  });

  it('agrees with assertSessionAllowed in every case — one rule, not two copies', async () => {
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    // an in-window instant, an out-of-window instant, and a non-camp day
    for (const iso of ['2026-07-01T08:00:00Z', '2026-07-01T23:00:00Z', '2026-08-01T08:00:00Z']) {
      pinClock(iso);
      const { session } = await svc.getAllowedSession(actor('church'));
      for (const id of ['2026-07-01~am', '2026-07-01~pm']) {
        const assertion = svc.assertSessionAllowed(actor('church'), id);
        if (session && session.id === id) await expect(assertion).resolves.toBeUndefined();
        else await expect(assertion).rejects.toThrow();
      }
      vi.useRealTimers();
    }
  });

  // THE BUG (reported 2026-07-31): a church login's daily check-in failed with the SPA's generic
  // "1 check-in didn't save" banner while admin worked fine. The SPA locked its roster on
  // getCurrentSession(), but that helper NEVER returns null once camp dates exist — it falls back
  // to the nearest past/upcoming session — so before camp the roster unlocked and every tap 403'd.
  it('is null on a non-camp day even though getCurrentSession() still returns a session', async () => {
    pinClock('2026-08-01T08:00:00Z');
    await settingsRepo.saveSingleton(settings({ churchCheckinTimeRestricted: true }));
    const svc = makeCheckInService(personRepo, settingsRepo);
    expect(await svc.getCurrentSession()).not.toBeNull();
    expect((await svc.getAllowedSession(actor('church'))).session).toBeNull();
  });
});

describe('getSessionStatus — RosterEntry enriched fields', () => {
  it('RosterEntry includes gender, grade, and medicalFlag', async () => {
    const personRepo = new InMemoryPersonRepository();
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.saveSingleton(settings());

    await personRepo.save(person({
      id: 'p1', atCamp: true, gender: 'female', grade: 10, medicalConditions: ['Asthma'],
    }));

    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);

    expect(result.roster).toHaveLength(1);
    const entry = result.roster[0]!;
    expect(entry.gender).toBe('female');
    expect(entry.grade).toBe(10);
    expect(entry.medicalFlag).toBe(true);
  });

  it('medicalFlag is false when no medical conditions or medications', async () => {
    const personRepo = new InMemoryPersonRepository();
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.saveSingleton(settings());

    await personRepo.save(person({ id: 'p1', atCamp: true, medicalConditions: [], otherMedications: null }));

    const svc = makeCheckInService(personRepo, settingsRepo);
    const result = await svc.getSessionStatus(actor(), SESSION_ID);

    expect(result.roster[0]!.medicalFlag).toBe(false);
  });
});
