import { describe, it, expect } from 'vitest';
import { churchesBehind } from './checkin-warnings';
import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';

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

/** 2026-09-29 11:05 Brisbane == 01:05 UTC the same day. 55 min before amEnd 12:00. */
const IN_AM_LEAD = new Date('2026-09-29T01:05:00.000Z');

describe('churchesBehind', () => {
  it('reports a church login with an unchecked student inside the AM lead window', () => {
    const out = churchesBehind(settings(), [person()], [user()], IN_AM_LEAD);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      userId: 'usr_bv',
      churchId: 'ch_victory',
      sessionId: '2026-09-29~am',
      remaining: 1,
      windowEnd: '12:00',
    });
  });

  it('returns nothing when every student is already checked in', () => {
    const p = person({
      checkInHistory: [
        { id: 'c1', sessionId: '2026-09-29~am', sessionLabel: 'Tue AM', type: 'in', leaderId: 'X', timestamp: '2026-09-29T00:00:00.000Z' },
      ],
    } as Partial<Person>);
    expect(churchesBehind(settings(), [p], [user()], IN_AM_LEAD)).toEqual([]);
  });

  it('counts a checked-in-then-out student as OUTSTANDING (last entry wins)', () => {
    // Must agree with toRosterEntry, which uses `last?.type === 'in'`.
    const p = person({
      checkInHistory: [
        { id: 'c1', sessionId: '2026-09-29~am', sessionLabel: 'Tue AM', type: 'in', leaderId: 'X', timestamp: '2026-09-29T00:00:00.000Z' },
        { id: 'c2', sessionId: '2026-09-29~am', sessionLabel: 'Tue AM', type: 'out', leaderId: 'X', timestamp: '2026-09-29T00:30:00.000Z' },
      ],
    } as Partial<Person>);
    const out = churchesBehind(settings(), [p], [user()], IN_AM_LEAD);
    expect(out[0]?.remaining).toBe(1);
  });

  it('excludes leaders and anyone not atCamp from the count', () => {
    const people = [
      person({ id: 'p1' }),
      person({ id: 'p2', kind: 'leader' }),
      person({ id: 'p3', atCamp: false }),
    ];
    const out = churchesBehind(settings(), people, [user()], IN_AM_LEAD);
    expect(out[0]?.remaining).toBe(1);
  });

  it('respects gender scoping — a b- login is not told about girls', () => {
    const people = [person({ id: 'p1', gender: 'male' }), person({ id: 'p2', gender: 'female' })];
    const out = churchesBehind(settings(), people, [user()], IN_AM_LEAD);
    expect(out[0]?.remaining).toBe(1);
  });

  it('counts a gender-unset student for BOTH of a church logins', () => {
    const people = [person({ id: 'p1', gender: 'other' })];
    const b = user({ id: 'usr_bv', username: 'b-victory', genderScope: 'male' });
    const g = user({ id: 'usr_gv', username: 'g-victory', genderScope: 'female' });
    const out = churchesBehind(settings(), people, [b, g], IN_AM_LEAD);
    expect(out).toHaveLength(2);
  });

  it('returns nothing when churchCheckinTimeRestricted is off', () => {
    const s = settings({ churchCheckinTimeRestricted: false });
    expect(churchesBehind(s, [person()], [user()], IN_AM_LEAD)).toEqual([]);
  });

  it('returns nothing outside the 60-minute lead window', () => {
    // 09:00 Brisbane = 23:00 UTC the previous day — 3h before amEnd.
    const early = new Date('2026-09-28T23:00:00.000Z');
    expect(churchesBehind(settings(), [person()], [user()], early)).toEqual([]);
  });

  it('TIMEZONE GUARD: resolves the Brisbane date, not the UTC date', () => {
    // 2026-09-29 09:00 Brisbane is 2026-09-28 23:00 UTC. A UTC-derived "today" would look
    // up the 28th. Pin the clock just inside the AM lead window on the 29th, at a UTC
    // instant that still reads as the 28th, and assert we get the 29th's session.
    const s = settings({ checkinWindowAmEnd: '10:00' }); // lead window 09:00-10:00 Brisbane
    const at0905Bne = new Date('2026-09-28T23:05:00.000Z');
    const out = churchesBehind(s, [person()], [user()], at0905Bne);
    expect(out[0]?.sessionId).toBe('2026-09-29~am');
  });

  it('AC-1: never warns for an AM session on the FIRST camp day (PM-only)', () => {
    // 2026-09-28 is day 1 -> PM only. 11:05 Brisbane on the 28th is inside an AM lead
    // window that has no AM session behind it.
    const at1105OnDay1 = new Date('2026-09-28T01:05:00.000Z');
    expect(churchesBehind(settings(), [person()], [user()], at1105OnDay1)).toEqual([]);
  });

  it('AC-1: never warns for a PM session on the LAST camp day (AM-only)', () => {
    // 2026-09-30 is the last day -> AM only. 21:05 Brisbane = 11:05 UTC, inside the PM lead.
    const at2105OnLastDay = new Date('2026-09-30T11:05:00.000Z');
    expect(churchesBehind(settings(), [person()], [user()], at2105OnLastDay)).toEqual([]);
  });

  it('warns in the PM lead window on an interior day', () => {
    // 2026-09-29 21:05 Brisbane = 11:05 UTC. pmEnd 22:00.
    const out = churchesBehind(settings(), [person()], [user()], new Date('2026-09-29T11:05:00.000Z'));
    expect(out[0]).toMatchObject({ sessionId: '2026-09-29~pm', windowEnd: '22:00' });
  });

  it('ignores non-church logins entirely', () => {
    const zl = user({ id: 'usr_zl', role: 'zoneLeader', genderScope: null });
    expect(churchesBehind(settings(), [person()], [zl], IN_AM_LEAD)).toEqual([]);
  });

  it('ignores inactive church logins', () => {
    const inactive = user({ status: 'inactive' });
    expect(churchesBehind(settings(), [person()], [inactive], IN_AM_LEAD)).toEqual([]);
  });

  it('returns nothing on a day outside checkInDays', () => {
    const out = churchesBehind(settings(), [person()], [user()], new Date('2026-10-05T01:05:00.000Z'));
    expect(out).toEqual([]);
  });

  // windowEndAt is what the notice's expiresAt is set from, so an offset error here would
  // either expire every warning instantly or leave it live 10 hours past the window.
  it('windowEndAt is the window close as a UTC instant, in the CAMP zone', () => {
    const am = churchesBehind(settings(), [person()], [user()], IN_AM_LEAD);
    // amEnd 12:00 Brisbane (UTC+10) on the 29th == 02:00 UTC on the 29th.
    expect(am[0]?.windowEndAt).toBe('2026-09-29T02:00:00.000Z');

    const pm = churchesBehind(settings(), [person()], [user()], new Date('2026-09-29T11:05:00.000Z'));
    // pmEnd 22:00 Brisbane == 12:00 UTC the same day.
    expect(pm[0]?.windowEndAt).toBe('2026-09-29T12:00:00.000Z');
  });

  it('windowEndAt is always in the FUTURE at the moment the warning fires', () => {
    // The invariant that actually matters: a notice must never be born already expired.
    for (const at of [IN_AM_LEAD, new Date('2026-09-29T11:05:00.000Z')]) {
      const out = churchesBehind(settings(), [person()], [user()], at);
      expect(new Date(out[0]!.windowEndAt).getTime()).toBeGreaterThan(at.getTime());
    }
  });
});
