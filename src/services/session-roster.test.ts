import { describe, it, expect, vi, afterEach } from 'vitest';
import { lastEntryFor, isCheckedInFor, onSessionRoster } from './session-roster';
import { makeCheckInService } from './checkin.service';
import { makeDashboardService } from './dashboard.service';
import { makeDashboardCache } from './dashboard-cache';
import { churchesBehindFor } from './checkin-warnings';
import { sessionFor } from './checkin-sessions';
import { InMemoryPersonRepository, InMemorySettingsRepository, InMemoryNotificationRepository, InMemoryChurchRepository } from '../repositories/in-memory';
import type { Person, CheckInEntry } from '../core/entities/person';
import type { Actor, User } from '../core/entities/user';
import { SETTINGS_ID, type CampSettings } from '../core/entities/settings';

const now = '2026-01-01T00:00:00.000Z';
const entry = (sessionId: string, type: 'in' | 'out', id = `${sessionId}-${type}`): CheckInEntry =>
  ({ id, sessionId, sessionLabel: 'x', type, leaderId: 'l', timestamp: now });
function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1', firstName: 'Ada', lastName: 'L', gender: 'female', kind: 'youth',
    churchId: 'c1', churchName: 'Victory', zone: 'Yellow', medicalConditions: [], dietaryRequirements: [],
    consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null } },
    paymentStatus: 'unpaid', needsReview: false, lifecycle: 'arrived', atCamp: true,
    checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now, ...over,
  };
}

describe('session-roster rule (P2)', () => {
  it('lastEntryFor: last entry for the session wins; other sessions ignored', () => {
    const p = person({ checkInHistory: [entry('s1', 'in', 'a'), entry('s2', 'out', 'b'), entry('s1', 'out', 'c'), entry('s2', 'in', 'd')] });
    expect(lastEntryFor(p, 's1')?.id).toBe('c');
    expect(lastEntryFor(p, 's2')?.id).toBe('d');
    expect(lastEntryFor(p, 's3')).toBeNull();
  });

  it('isCheckedInFor: in -> out -> in reads in; in -> out reads out; nothing reads out', () => {
    expect(isCheckedInFor(person({ checkInHistory: [entry('s', 'in', '1'), entry('s', 'out', '2'), entry('s', 'in', '3')] }), 's')).toBe(true);
    expect(isCheckedInFor(person({ checkInHistory: [entry('s', 'in', '1'), entry('s', 'out', '2')] }), 's')).toBe(false);
    expect(isCheckedInFor(person({ checkInHistory: [entry('other', 'in')] }), 's')).toBe(false);
    expect(isCheckedInFor(person(), 's')).toBe(false);
  });

  it('onSessionRoster: leaders never; at camp always; signed-out kept on a past session only', () => {
    const gone = person({ atCamp: false, lifecycle: 'checked_out', checkInHistory: [entry('past', 'in'), entry('cur', 'in')] });
    expect(onSessionRoster(person({ kind: 'leader' }), 'cur', 'cur')).toBe(false);
    expect(onSessionRoster(person(), 'cur', 'cur')).toBe(true);
    expect(onSessionRoster(person(), 'past', 'cur')).toBe(true);
    expect(onSessionRoster(gone, 'past', 'cur')).toBe(true);
    expect(onSessionRoster(gone, 'cur', 'cur')).toBe(false);
    expect(onSessionRoster(gone, 'never', 'cur')).toBe(false);
    expect(onSessionRoster(gone, 'past', null)).toBe(true);
  });
});

describe('roster, push warnings and dashboard agree (P2 parity)', () => {
  afterEach(() => vi.useRealTimers());

  it('one fixture: roster remaining == warnings remaining == dashboard checkInsDue', async () => {
    const CUR = '2026-07-01~am';
    const settings: CampSettings = {
      id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-02',
      timezone: 'UTC', checkInDays: ['2026-06-30', '2026-07-01', '2026-07-02'],
      accommodationLocked: false, churchLoginLocked: false, zoneLeaderLoginLocked: false,
      churchCheckinTimeRestricted: false, checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto',
      campMode: 'at-camp', createdAt: now, updatedAt: now,
    };
    const people = new InMemoryPersonRepository();
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.saveSingleton(settings);
    const fixture = [
      person({ id: 'in', checkInHistory: [entry(CUR, 'in')] }),
      person({ id: 'inout', checkInHistory: [entry(CUR, 'in', 'a'), entry(CUR, 'out', 'b')] }),
      person({ id: 'inoutin', checkInHistory: [entry(CUR, 'in', 'a'), entry(CUR, 'out', 'b'), entry(CUR, 'in', 'c')] }),
      person({ id: 'none' }),
      person({ id: 'past-only', checkInHistory: [entry('2026-06-30~pm', 'in')] }),
      person({ id: 'gone', atCamp: false, lifecycle: 'checked_out', checkInHistory: [entry(CUR, 'out')] }),
      person({ id: 'ldr', kind: 'leader' }),
      person({ id: 'cxl', atCamp: false, lifecycle: 'cancelled' }),
      person({ id: 'other', churchId: 'c2', churchName: 'Grace' }),
    ];
    for (const p of fixture) await people.save(p);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T09:00:00Z')); // 2026-07-01 AM is current

    const church: Actor = { id: 'u1', role: 'church', churchId: 'c1', churchName: 'Victory', zone: 'Yellow', displayName: 'V' };
    const st = await makeCheckInService(people, settingsRepo).getSessionStatus(church, CUR);
    const rosterRemaining = st.totalCount - st.checkedInCount;

    const user = { id: 'u1', username: 'v', firstName: 'V', lastName: '', role: 'church', churchId: 'c1',
      churchName: 'Victory', zone: 'Yellow', status: 'active', createdAt: now, updatedAt: now } as unknown as User;
    const behind = churchesBehindFor(await people.findAll(), [user],
      { session: sessionFor('2026-07-01', 'am'), windowEnd: '12:00', windowEndAt: '2026-07-01T12:00:00.000Z' }, { includeZero: true });

    const dash = await makeDashboardService(people, new InMemoryNotificationRepository(), new InMemoryChurchRepository(), makeDashboardCache()).home(church, settings);
    if (dash.mode !== 'at-camp') throw new Error('expected at-camp');

    expect(rosterRemaining).toBe(3); // inout, none, past-only
    expect(behind[0]?.remaining).toBe(rosterRemaining);
    expect(dash.checkInsDue).toBe(rosterRemaining);
    expect(dash.sessionExpected).toBe(st.totalCount);
    expect(st.roster.map((r) => r.camperId).sort()).toEqual(['in', 'inout', 'inoutin', 'none', 'past-only']);
  });
});
