import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeAccountService } from './account.service';
import { makeCheckInService } from './checkin.service';
import { makePersonService } from './person.service';
import { makeNoteService } from './note.service';
import { makeSettingsService } from './settings.service';
import { transition } from './presence';
import { toRosterEntry } from '../api/dto/person.dto';
import { UpdateChurchContactsSchema, UpdateSettingsSchema, CheckInInputSchema, RegistrantPatchSchema } from '../core/validation';
import {
  InMemoryChurchRepository,
  InMemoryNoteRepository,
  InMemoryPersonRepository,
  InMemorySettingsRepository,
  InMemoryUserRepository,
} from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';

// QA batch 2 (3 Nov 2026): one server check per ruled item. Item numbers are from MERGED.md.
const now = '2026-01-01T00:00:00.000Z';
const actor = (role: Actor['role'], over: Partial<Actor> = {}): Actor =>
  ({ id: 'u', role, churchId: null, churchName: null, zone: null, displayName: 'T', ...over });

function person(over: Partial<Person> = {}): Person {
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
    checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now,
    ...over,
  };
}
function settings(over: Partial<CampSettings> = {}): CampSettings {
  return {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-02',
    timezone: 'UTC', checkInDays: ['2026-06-30', '2026-07-01', '2026-07-02'],
    accommodationLocked: false, churchLoginLocked: false, zoneLeaderLoginLocked: false,
    churchCheckinTimeRestricted: false, checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto',
    campMode: 'at-camp', createdAt: now, updatedAt: now,
    ...over,
  };
}
const contacts = (phone: string) => ({
  contacts: {
    male: { primary: { name: 'A', phone }, backup: { name: '', phone: '' } },
    female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
  },
});

describe('item 6: leader phone numbers', () => {
  it.each(['abc', '12', '0400 abc 123', '1234567890123456'])('refuses %j', (phone) => {
    expect(UpdateChurchContactsSchema.safeParse(contacts(phone)).success).toBe(false);
  });
  it.each(['', '   ', '0411 111 111', '+61 411 111 111', '(07) 3333 4444', '0411-111-111'])('accepts %j', (phone) => {
    expect(UpdateChurchContactsSchema.safeParse(contacts(phone)).success).toBe(true);
  });
});

describe('item 6: numbers pasted from iOS', () => {
  it('strips invisible characters before checking, and stores the clean number', () => {
    const parsed = UpdateChurchContactsSchema.parse(contacts('\u202A0411\u00A0222\u200B333\u202C'));
    expect(parsed.contacts.male.primary.phone).toBe('0411\u00A0222333');
  });
  it.each(['0411 222 333 ext 4', '0411 222 333 or 0422 111 222', '\u202Aabc\u202C'])('still refuses %j', (phone) => {
    expect(UpdateChurchContactsSchema.safeParse(contacts(phone)).success).toBe(false);
  });
});

describe('item 11: deleting a church with people attached', () => {
  async function setup(withPerson: boolean) {
    const users = new InMemoryUserRepository();
    const churches = new InMemoryChurchRepository();
    const people = new InMemoryPersonRepository();
    await churches.save({ id: 'c1', name: 'Victory', zone: 'Yellow' } as Church);
    if (withPerson) await people.save(person());
    return { svc: makeAccountService(users, churches, people), churches };
  }
  it('refuses and names the church and the count', async () => {
    const { svc, churches } = await setup(true);
    await expect(svc.deleteChurch(actor('admin'), 'c1')).rejects.toThrow(/Victory.*1 person/);
    expect(await churches.findById('c1')).not.toBeNull();
  });
  it('still deletes an empty church', async () => {
    const { svc, churches } = await setup(false);
    await svc.deleteChurch(actor('admin'), 'c1');
    expect(await churches.findById('c1')).toBeNull();
  });
});

describe('item 12: camp dates', () => {
  it('schema refuses a date that does not exist or is not YYYY-MM-DD', () => {
    expect(UpdateSettingsSchema.safeParse({ startDate: '2026-13-45' }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ endDate: 'next friday' }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ checkInDays: ['2026-02-30'] }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ startDate: '2026-06-30', endDate: '' }).success).toBe(true);
  });
  it('service refuses an end date before the start date, against the saved dates too', async () => {
    const repo = new InMemorySettingsRepository();
    await repo.saveSingleton(settings());
    const deps = { devotionals: { findAll: async () => [] }, schedule: { findAll: async () => [] } };
    const svc = makeSettingsService(repo, deps as never);
    await expect(svc.update(actor('admin'), { endDate: '2026-06-01' })).rejects.toThrow(/before/);
    expect((await repo.getSingleton())?.endDate).toBe('2026-07-02');
  });
});

describe('item 13: a signed-out child leaves the current session', () => {
  afterEach(() => vi.useRealTimers());
  const entry = (sessionId: string) =>
    ({ id: 'e', sessionId, sessionLabel: 'x', type: 'in' as const, leaderId: 'l', timestamp: now });
  async function setup() {
    const people = new InMemoryPersonRepository();
    const repo = new InMemorySettingsRepository();
    await repo.saveSingleton(settings());
    await people.save(person({ id: 'here' }));
    await people.save(person({
      id: 'gone', atCamp: false, lifecycle: 'checked_out',
      checkInHistory: [entry('2026-07-01~am'), entry('2026-06-30~pm')],
    }));
    await people.save(person({ id: 'notyet', atCamp: false, lifecycle: 'registered' }));
    await people.save(person({ id: 'cancelled', atCamp: false, lifecycle: 'cancelled' }));
    await people.save(person({ id: 'ldr', kind: 'leader', atCamp: false, lifecycle: 'registered' }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T09:00:00Z')); // 2026-07-01 AM is current
    return makeCheckInService(people, repo);
  }
  it('current session: off the list and the counts, and counted as not on site', async () => {
    const st = await (await setup()).getSessionStatus(actor('director'), '2026-07-01~am');
    expect(st.roster.map((r) => r.camperId)).toEqual(['here']);
    expect(st.totalCount).toBe(1);
    expect(st.notOnSiteCount).toBe(2); // gone + notyet; never the cancelled person or the leader
  });
  it('a past session keeps the people who were checked in for it', async () => {
    const st = await (await setup()).getSessionStatus(actor('director'), '2026-06-30~pm');
    expect(st.roster.map((r) => r.camperId).sort()).toEqual(['gone', 'here']);
  });
});

// P1+I4: the old withSignEvent helper is now the presence module's signIn/signOut intents.
function withSignEvent(p: Person, event: { id: string; type: 'in' | 'out'; leaderName: string; authorId: string; timestamp: string }, at: string): Person {
  const o = transition(p, { kind: event.type === 'in' ? 'signIn' : 'signOut', event }, { actor: actor('director', { id: 'a' }), campMode: null, now: at });
  return o.result === 'applied' ? o.next : p;
}

describe('item 16: a repeat sign event writes no second row', () => {
  const ev = (type: 'in' | 'out') =>
    ({ id: 's', type, leaderName: 'L', authorId: 'a', timestamp: now });
  it('ignores a second sign-out', () => {
    const once = withSignEvent(person(), ev('out'), now);
    const twice = withSignEvent(once, ev('out'), now);
    expect(twice.signOutHistory).toHaveLength(1);
  });
  it('still records a real out, in, out', () => {
    const p = withSignEvent(withSignEvent(withSignEvent(person(), ev('out'), now), ev('in'), now), ev('out'), now);
    expect(p.signOutHistory.map((e) => e.type)).toEqual(['out', 'in', 'out']);
    expect(p.atCamp).toBe(false);
  });
  it('a sign-out after the bulk mode switch is not mistaken for a repeat', () => {
    // Last event 'out', but the mode switch set atCamp true with no event: a real sign-out must record.
    const p = person({ atCamp: true, signOutHistory: [ev('out')] });
    expect(withSignEvent(p, ev('out'), now).signOutHistory).toHaveLength(2);
  });
});

describe('item 7: allergies listed under dietary raise the row flag', () => {
  it('flags an allergy but not a plain preference', () => {
    expect(toRosterEntry(person({ dietaryRequirements: ['Nut allergy'] }), 's').medicalFlag).toBe(true);
    expect(toRosterEntry(person({ dietaryRequirements: ['Vegetarian'] }), 's').medicalFlag).toBe(false);
  });
});

describe('item 21: no sign-in before camp from a leader login', () => {
  async function svc(mode: CampSettings['campMode']) {
    const people = new InMemoryPersonRepository();
    const repo = new InMemorySettingsRepository();
    await repo.saveSingleton(settings({ campMode: mode }));
    await people.save(person({ atCamp: false, lifecycle: 'registered' }));
    return makePersonService(people, repo);
  }
  const ev = { type: 'in' as const, leaderName: 'L', authorId: 'a', timestamp: now };
  const church = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow' });
  it('refuses a church login pre-camp', async () => {
    await expect((await svc('pre-camp')).signEvent(church, 'p1', ev)).rejects.toThrow(/not started/);
  });
  it('allows a church login at camp, and an admin pre-camp', async () => {
    expect((await (await svc('at-camp')).signEvent(church, 'p1', ev)).atCamp).toBe(true);
    expect((await (await svc('pre-camp')).signEvent(actor('admin'), 'p1', ev)).atCamp).toBe(true);
  });
});

describe('item 28: junk values', () => {
  it('check-in type must be in or out', () => {
    expect(CheckInInputSchema.safeParse({ camperId: 'a', sessionId: 'b', type: 'maybe' }).success).toBe(false);
    expect(CheckInInputSchema.safeParse({ camperId: 'a', sessionId: 'b', type: 'in' }).success).toBe(true);
  });
  it('registrant patch checks names and grade, and leaves other fields alone', () => {
    expect(RegistrantPatchSchema.safeParse({ firstName: '' }).success).toBe(false);
    expect(RegistrantPatchSchema.safeParse({ firstName: 'x'.repeat(101) }).success).toBe(false);
    expect(RegistrantPatchSchema.safeParse({ grade: 999 }).success).toBe(false);
    expect(RegistrantPatchSchema.safeParse({ gender: 'alien' }).success).toBe(false);
    expect(RegistrantPatchSchema.safeParse({ firstName: 'Ada', grade: 7, gender: 'female' }).success).toBe(true);
    expect(RegistrantPatchSchema.safeParse({ grade: null, needsReview: false, status: 'cancelled' }).success).toBe(true);
  });
  it('notes refuse blank, NUL, unknown category and over-long text', async () => {
    const people = new InMemoryPersonRepository();
    await people.save(person());
    const svc = makeNoteService(new InMemoryNoteRepository(), people);
    const a = actor('admin');
    await expect(svc.add(a, { camperId: 'p1', body: '   ' })).rejects.toThrow();
    await expect(svc.add(a, { camperId: 'p1', body: 'a\u0000b' })).rejects.toThrow();
    await expect(svc.add(a, { camperId: 'p1', body: 'ok', category: '<b>x</b>' })).rejects.toThrow();
    await expect(svc.add(a, { camperId: 'p1', body: 'x'.repeat(2001) })).rejects.toThrow(/2,000/);
    const saved = await svc.add(a, { camperId: 'p1', body: 'fine', category: 'testimony' });
    expect(saved.category).toBe('testimony');
  });
});
