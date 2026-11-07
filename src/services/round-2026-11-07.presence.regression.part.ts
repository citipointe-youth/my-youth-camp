/**
 * Camp arch round 2026-11-07, regression lane `presence` (server side: presence, admin wipes,
 * repo seam, dashboard). Pins the fixed behaviour at 937738b. In-memory only (ruling Q13 c):
 * the Supabase adapter is checked by reading code, never run here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildMemoryContainer, buildServices, memoryRepos, initRepos, type Container } from '../container';
import { transition, writeOf } from './presence';
import { lastEntryFor, isCheckedInFor, onSessionRoster } from './session-roster';
import { canAccessPerson } from './person.service';
import { InMemoryPersonRepository } from '../repositories/in-memory';
import { SETTINGS_ID, type CampSettings } from '../core/entities/settings';
import type { Person, CheckInEntry, SignOutEvent } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import type { Notification } from '../core/entities/notification';

const NOW = '2026-01-01T00:00:00.000Z';
const PHRASE = 'I understand this cannot be undone';
const FORCE = { force: true, confirmWipe: PHRASE };

const actor = (role: Actor['role'], over: Partial<Actor> = {}): Actor =>
  ({ id: `u-${role}`, role, churchId: null, churchName: null, zone: null, displayName: `${role} User`, ...over });
const admin = actor('admin', { id: 'a1', displayName: 'Alice Admin' });

const settings = (over: Partial<CampSettings> = {}): CampSettings => ({
  id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-05', timezone: 'UTC',
  checkInDays: ['2026-06-30', '2026-07-01', '2026-07-02'], accommodationLocked: false, churchLoginLocked: false,
  zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false, checkinSwitchoverTime: '14:00',
  checkinPhaseOverride: 'auto', campMode: 'at-camp', lastExportedAt: NOW, createdAt: NOW, updatedAt: NOW, ...over,
} as CampSettings);

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id, firstName: 'Ada', lastName: id, gender: 'female', kind: 'youth', churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
  medicalConditions: [], dietaryRequirements: [],
  consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
  paymentStatus: 'unpaid', needsReview: false, lifecycle: 'registered', atCamp: false,
  checkInHistory: [], signOutHistory: [], createdAt: NOW, updatedAt: NOW, ...over,
} as Person);

const ev = (over: Partial<SignOutEvent> = {}): SignOutEvent =>
  ({ id: 'so-x', type: 'in', leaderName: 'L', authorId: 'a1', timestamp: NOW, ...over });
const ci = (over: Partial<CheckInEntry> = {}): CheckInEntry =>
  ({ id: 'ci-x', sessionId: 's1', sessionLabel: 'S1', type: 'in', leaderId: 'AB', timestamp: NOW, ...over });
const tap = { sessionId: 's1', sessionLabel: 'S1', type: 'in' as const, leaderId: 'AB', timestamp: NOW };
const sign = (type: 'in' | 'out') => ({ type, leaderName: 'L', authorId: 'a1', timestamp: NOW });

async function setup(people: Person[] = [], s: Partial<CampSettings> = {}): Promise<Container> {
  const c = await buildMemoryContainer();
  await c.repos.settings.saveSingleton(settings(s));
  for (const p of people) await c.repos.people.save(p); // insert writes presence too
  return c;
}
const get = async (c: Container, id: string) => (await c.repos.people.findById(id))!;
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

// ─── Phase A ──────────────────────────────────────────────────────────────────────────────

describe('A-2 admin wipes', () => {
  it('[A-2][Q7] resetLogs really deletes check-in and sign-out history and clears presence', async () => {
    const c = await setup([
      person('a', { lifecycle: 'arrived', atCamp: true, checkInHistory: [ci()], signOutHistory: [ev()] }),
      person('x', { lifecycle: 'cancelled', signOutHistory: [ev({ id: 'so-2' })] }),
    ]);
    const r = await c.services.admin.resetLogs(admin, FORCE);
    expect(r.people).toBe(2);
    expect(await get(c, 'a')).toMatchObject({ checkInHistory: [], signOutHistory: [], atCamp: false, lifecycle: 'registered' });
    expect(await get(c, 'x')).toMatchObject({ signOutHistory: [], lifecycle: 'cancelled' });
  });

  it('[A-2][Q7] a stale full-row save after resetLogs cannot bring the history back', async () => {
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true, checkInHistory: [ci()], signOutHistory: [ev()] })]);
    const stale = await get(c, 'a');
    await c.services.admin.resetLogs(admin, FORCE);
    await c.repos.people.save({ ...stale, school: 'Hill' });
    expect(await get(c, 'a')).toMatchObject({ checkInHistory: [], signOutHistory: [], atCamp: false, school: 'Hill' });
  });

  for (const [name, run] of [
    ['reset', (c: Container, o?: object) => c.services.admin.reset(admin, o)],
    ['resetLogs', (c: Container, o?: object) => c.services.admin.resetLogs(admin, o)],
    ['newYear', async (c: Container, o?: object) => { await c.services.admin.saveDefaults(admin); return c.services.admin.newYear(admin, 2027, o); }],
  ] as const) {
    it(`[A-2][Q7] ${name}: nulls lastExportedAt, so a second ${name} (even forced) needs a fresh export (IA-OQ-23/24)`, async () => {
      const c = await setup();
      await run(c, FORCE);
      expect((await c.repos.settings.getSingleton())!.lastExportedAt).toBeNull();
      await expect(run(c, FORCE)).rejects.toMatchObject({ statusCode: 409, code: 'WIPE_GUARD' });
      await expect(run(c)).rejects.toMatchObject({ statusCode: 409 });
    });
  }

  it('[A-2][Q7] force with the wrong phrase is a 400, and force never skips a missing export (IA-OQ-24)', async () => {
    const c = await setup([], { lastExportedAt: null });
    await expect(c.services.admin.resetLogs(admin, { force: true, confirmWipe: 'yes' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(c.services.admin.resetLogs(admin, FORCE)).rejects.toMatchObject({ statusCode: 409, code: 'WIPE_GUARD' });
    await expect(c.services.admin.reset(admin, FORCE)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('[A-2][Q7] a fresh workbook stamp after the wipe re-enables the next wipe', async () => {
    const c = await setup();
    await c.services.admin.resetLogs(admin, FORCE);
    await c.services.settings.stampExport();
    await expect(c.services.admin.resetLogs(admin, FORCE)).resolves.toMatchObject({ people: 0 });
  });
});

describe('A-3 offline sheet needs import:run and refuses pre-camp for every role', () => {
  const csv = 'First Name,Last Name,Church,Gender,Grade,Signed In?\nAda,r,Victory,female,9,Y';

  it('[A-3][Q6] church, zoneLeader, firstAid and prayer are refused with 403 (import:run)', async () => {
    const c = await setup([person('r')]);
    for (const role of ['church', 'zoneLeader', 'firstAid', 'prayer'] as const) {
      const a = actor(role, { churchId: 'c1', churchName: 'Victory', zone: 'Yellow' });
      await expect(c.services.offlineSignIn.importSignIns(a, csv)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await get(c, 'r')).atCamp).toBe(false);
  });

  it('[A-3][Q6] in pre-camp admin and director are refused too (IA-OQ-3), nothing signed in', async () => {
    const c = await setup([person('r')], { campMode: 'pre-camp' });
    for (const a of [admin, actor('director')]) {
      await expect(c.services.offlineSignIn.importSignIns(a, csv))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Camp has not started yet') });
    }
    expect(await get(c, 'r')).toMatchObject({ atCamp: false, signOutHistory: [] });
  });

  it('[A-3][Q6] at camp an admin sheet signs the student in', async () => {
    const c = await setup([person('r')]);
    await expect(c.services.offlineSignIn.importSignIns(admin, csv)).resolves.toMatchObject({ signedIn: 1 });
    expect((await get(c, 'r')).atCamp).toBe(true);
  });
});

describe('A-8 dashboard cache key includes the actor', () => {
  it('[A-8] two same-role admins never share a cached greetingName', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
    const c = await setup([person('x', { lifecycle: 'arrived', atCamp: true })]);
    const s = settings();
    const alice = await c.services.dashboard.home(admin, s);
    const bob = await c.services.dashboard.home({ ...admin, id: 'a2', displayName: 'Bob Admin' }, s);
    if (alice.mode !== 'at-camp' || bob.mode !== 'at-camp') throw new Error('expected at-camp');
    expect(alice.greetingName).toBe('Alice');
    expect(bob.greetingName).toBe('Bob');
  });
});

// ─── Phase B ──────────────────────────────────────────────────────────────────────────────

describe('B-1 stale full-row saves cannot undo presence', () => {
  it('[B-1] a PATCH read before a sign-out and saved after it keeps the sign-out', async () => {
    const c = await setup([person('x', { lifecycle: 'arrived', atCamp: true, signOutHistory: [ev()] })]);
    const raw = c.repos.people;
    const realSave = raw.save.bind(raw);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    raw.save = async (p) => { raw.save = realSave; await gate; return realSave(p); };
    const patch = c.services.person.update(admin, 'x', { school: 'Hill' } as Partial<Person>);
    await tick();
    await c.services.person.signEvent(admin, 'x', sign('out'));
    open();
    await patch;
    const after = await get(c, 'x');
    expect(after).toMatchObject({ atCamp: false, lifecycle: 'checked_out', school: 'Hill' });
    expect(after.signOutHistory.map((e) => e.type)).toEqual(['in', 'out']);
  });

  it('[B-1] a stale plain save/saveMany (e.g. an import) cannot undo a sign-in', async () => {
    const c = await setup([person('r')]);
    const stale = await get(c, 'r');
    await c.services.person.signEvent(admin, 'r', sign('in'));
    await c.repos.people.save({ ...stale, school: 'A' });
    await c.repos.people.saveMany([{ ...stale, school: 'B' }]);
    const after = await get(c, 'r');
    expect(after).toMatchObject({ atCamp: true, lifecycle: 'arrived', school: 'B' });
    expect(after.signOutHistory).toHaveLength(1);
  });
});

describe('B-2 signEvent on wrong-state people (IA-OQ-8)', () => {
  it('[B-2] signing in a cancelled person is a 400 and writes nothing', async () => {
    const c = await setup([person('c', { lifecycle: 'cancelled' })]);
    await expect(c.services.person.signEvent(admin, 'c', sign('in')))
      .rejects.toMatchObject({ statusCode: 400, message: 'Cannot sign in a cancelled person' });
    expect((await get(c, 'c')).signOutHistory).toEqual([]);
  });

  it('[B-2] signing out someone not at camp resolves and writes no event; a double sign-out writes one', async () => {
    const c = await setup([person('r'), person('a', { lifecycle: 'arrived', atCamp: true })]);
    await c.services.person.signEvent(admin, 'r', sign('out')); // resolves (200), no throw
    expect(await get(c, 'r')).toMatchObject({ signOutHistory: [], lifecycle: 'registered', atCamp: false });
    await c.services.person.signEvent(admin, 'a', sign('out'));
    await c.services.person.signEvent(admin, 'a', sign('out'));
    expect((await get(c, 'a')).signOutHistory).toHaveLength(1);
  });
});

describe('B-3 cancelling someone at camp', () => {
  it('[B-3] writes one out event "Registration cancelled" authored by the actor, then cancels', async () => {
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true, signOutHistory: [ev()] })]);
    await c.services.person.update(admin, 'a', { lifecycle: 'cancelled' } as Partial<Person>);
    const after = await get(c, 'a');
    expect(after).toMatchObject({ lifecycle: 'cancelled', atCamp: false });
    expect(after.signOutHistory.map((e) => e.type)).toEqual(['in', 'out']);
    expect(after.signOutHistory[1]).toMatchObject({ reason: 'Registration cancelled', authorId: 'a1', leaderName: 'Alice Admin' });
  });

  it('[B-3] cancelling someone not at camp writes no event', async () => {
    const c = await setup([person('r')]);
    await c.services.person.update(admin, 'r', { lifecycle: 'cancelled' } as Partial<Person>);
    expect(await get(c, 'r')).toMatchObject({ lifecycle: 'cancelled', signOutHistory: [] });
  });
});

describe('B-4 offline sheet twins and repeated rows (IA-OQ-5)', () => {
  const head = 'First Name,Last Name,Church,Gender,Grade,Signed In?\n';

  it('[B-4] two live same-name students in one church: neither signed in, row reported', async () => {
    const c = await setup([person('t1', { lastName: 'Twin' }), person('t2', { lastName: 'Twin' })]);
    const r = await c.services.offlineSignIn.importSignIns(admin, `${head}Ada,Twin,Victory,female,9,Y`);
    expect(r.signedIn).toBe(0);
    expect(r.unmatched).toEqual(['Ada Twin (Victory) — 2 students share this name, sign in on the app']);
    expect((await get(c, 't1')).atCamp).toBe(false);
    expect((await get(c, 't2')).atCamp).toBe(false);
  });

  it('[B-4] one live + one cancelled twin: the live one is signed in, the cancelled one ignored', async () => {
    const c = await setup([person('t1', { lastName: 'Twin' }), person('t2', { lastName: 'Twin', lifecycle: 'cancelled' })]);
    const r = await c.services.offlineSignIn.importSignIns(admin, `${head}Ada,Twin,Victory,female,9,Y`);
    expect(r).toMatchObject({ signedIn: 1, unmatched: [], cancelledSkipped: [] });
    expect((await get(c, 't1')).atCamp).toBe(true);
    expect((await get(c, 't2')).signOutHistory).toEqual([]);
  });

  it('[B-4] the same row pasted twice signs in once with one in event', async () => {
    const c = await setup([person('r')]);
    const row = 'Ada,r,Victory,female,9,Y\n';
    const r = await c.services.offlineSignIn.importSignIns(admin, `${head}${row}${row}`);
    expect(r).toMatchObject({ signedIn: 1, alreadySignedIn: 1 });
    expect((await get(c, 'r')).signOutHistory).toHaveLength(1);
  });

  it('[CR-M1] a person cancelled between the sheet read and the write is reported as cancelled, not already signed in', async () => {
    const c = await setup([person('r')]);
    const repo = c.repos.people;
    const real = repo.transitionMany.bind(repo);
    vi.spyOn(repo, 'transitionMany').mockImplementation(async (ids, decide) => {
      await repo.transition('r', () => ({ atCamp: false, lifecycle: 'cancelled', cancelledAt: NOW, updatedAt: NOW })); // the race
      return real(ids, decide);
    });
    const r = await c.services.offlineSignIn.importSignIns(admin, `${head}Ada,r,Victory,female,9,Y`);
    expect(r).toMatchObject({ signedIn: 0, alreadySignedIn: 0, cancelledSkipped: ['Ada r (Victory)'] });
    expect((await get(c, 'r')).atCamp).toBe(false);
  });
});

describe('B-5 concurrent check-ins', () => {
  it('[B-5][Q9] two check-ins tapped at once write one history row', async () => {
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true })]);
    await Promise.all([c.services.person.checkIn(admin, 'a', tap), c.services.person.checkIn(admin, 'a', tap)]);
    expect((await get(c, 'a')).checkInHistory).toHaveLength(1);
  });

  it('[B-5] a real in, out, in in one session is still three rows', async () => {
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true })]);
    // Distinct server timestamps (Q9): history hydrates in (timestamp, id) order.
    const taps = [['in', '2026-07-01T08:00:00.000Z'], ['out', '2026-07-01T08:01:00.000Z'], ['in', '2026-07-01T08:02:00.000Z']] as const;
    for (const [type, timestamp] of taps) await c.services.person.checkIn(admin, 'a', { ...tap, type, timestamp });
    expect((await get(c, 'a')).checkInHistory.map((e) => e.type)).toEqual(['in', 'out', 'in']);
  });
});

describe('B-6 notice edit vs push claim', () => {
  it('[B-6] an edit that read the notice before the push claim does not re-arm the push', async () => {
    const c = await setup();
    const n: Notification = {
      id: 'n1', scope: 'camp', zone: null, churchId: null, priority: 'urgent', title: 'T', body: 'B',
      senderId: 'a1', senderName: 'A', senderRole: 'admin', leadersOnly: false, audienceEstimate: 0,
      expiresAt: null, createdAt: NOW,
    } as Notification;
    const raw = c.repos.notifications;
    await raw.save(n);
    const realFind = raw.findById.bind(raw);
    raw.findById = async (id: string) => { const snap = await realFind(id); await raw.claimForPush([id]); return snap; };
    await c.services.notification.update(admin, 'n1', { title: 'Edited' });
    raw.findById = realFind;
    const after = (await raw.findById('n1'))!;
    expect(after.title).toBe('Edited');
    expect(after.pushSentAt).toBeTruthy();
    expect(await raw.claimForPush(['n1'])).toEqual([]);
  });
});

describe('B-15 church zone edit (IA-OQ-19)', () => {
  it('[B-15] a zone change re-stamps person.zone so the new zone leader can access them', async () => {
    const c = await setup([person('p1'), person('p2', { churchId: 'c2', churchName: 'Other' })]);
    await c.repos.churches.save({ id: 'c1', name: 'Victory', zone: 'Yellow', createdAt: NOW, updatedAt: NOW } as never);
    await c.services.account.updateChurch(admin, 'c1', { zone: 'Blue' } as never);
    expect((await get(c, 'p1')).zone).toBe('Blue');
    expect((await get(c, 'p2')).zone).toBe('Yellow');
    const blue = actor('zoneLeader', { zone: 'Blue' });
    expect(canAccessPerson(blue, await get(c, 'p1'))).toBe(true);
  });
});

// ─── Rulings ──────────────────────────────────────────────────────────────────────────────

describe('Q10 setMode revert sweep', () => {
  it('[Q10] at-camp -> pre-camp sends arrived people to registered with one out; checked_out and cancelled untouched', async () => {
    // Real clock (Nov 2026) is outside the June/July camp days, so the revert is not locked.
    const c = await setup([
      person('a', { lifecycle: 'arrived', atCamp: true, signOutHistory: [ev()] }),
      person('o', { lifecycle: 'checked_out', atCamp: false, signOutHistory: [ev(), ev({ id: 'so-o', type: 'out' })] }),
      person('x', { lifecycle: 'cancelled' }),
    ]);
    await c.services.admin.setMode(admin, 'pre-camp');
    const a = await get(c, 'a');
    expect(a).toMatchObject({ lifecycle: 'registered', atCamp: false });
    expect(a.signOutHistory.at(-1)).toMatchObject({ type: 'out', reason: 'Camp mode reverted to pre-camp' });
    expect(await get(c, 'o')).toMatchObject({ lifecycle: 'checked_out', atCamp: false });
    expect((await get(c, 'o')).signOutHistory).toHaveLength(2);
    expect(await get(c, 'x')).toMatchObject({ lifecycle: 'cancelled', signOutHistory: [] });
  });
});

// ─── Phase C interfaces ───────────────────────────────────────────────────────────────────

describe('C6 D1 buildServices(repos)', () => {
  it('[C6][D1] wires services over the given repos synchronously; writes through one show in the repos', async () => {
    const repos = memoryRepos();
    await initRepos(repos);
    await repos.settings.saveSingleton(settings());
    await repos.people.save(person('r'));
    const s = buildServices(repos);
    await s.person.signEvent(admin, 'r', sign('in'));
    expect((await repos.people.findById('r'))!.atCamp).toBe(true);
  });
});

describe('C7 P1+I4 presence transition module', () => {
  const ctx = { actor: admin, campMode: 'at-camp' as const, now: NOW };

  it('[C7][P1] transition returns applied / noop / refused(reason)', () => {
    const arrived = person('a', { lifecycle: 'arrived', atCamp: true });
    expect(transition(arrived, { kind: 'checkIn', entry: ci() }, ctx)).toMatchObject({ result: 'applied', appended: { checkIn: ci() } });
    expect(transition(person('r'), { kind: 'signOut', event: ev({ type: 'out' }) }, ctx)).toEqual({ result: 'noop' });
    expect(transition(person('r'), { kind: 'checkIn', entry: ci() }, ctx))
      .toEqual({ result: 'refused', reason: 'Cannot check in a person who is not currently at camp' });
    expect(transition(person('c', { lifecycle: 'cancelled' }), { kind: 'signIn', event: ev() }, ctx))
      .toEqual({ result: 'refused', reason: 'Cannot sign in a cancelled person' });
    expect(transition(person('r'), { kind: 'signIn', event: ev() }, { ...ctx, actor: actor('church'), campMode: 'pre-camp' }))
      .toMatchObject({ result: 'refused' });
  });

  it('[C7][P1] every applied outcome that changes atCamp appends exactly one sign event, authored by the actor', () => {
    const states: Person[] = [
      person('r'), person('a', { lifecycle: 'arrived', atCamp: true }), person('o', { lifecycle: 'checked_out' }),
      person('c', { lifecycle: 'cancelled' }),
    ];
    const intents = [
      { kind: 'signIn', event: ev({ authorId: 'someone-else' }) }, { kind: 'signOut', event: ev({ type: 'out' }) },
      { kind: 'cancel' }, { kind: 'uncancel' }, { kind: 'modeRevert', event: ev({ type: 'out' }) },
    ] as const;
    for (const p of states) for (const i of intents) {
      const o = transition(p, i, ctx);
      if (o.result !== 'applied' || o.next.atCamp === p.atCamp) continue;
      expect(o.next.signOutHistory.length - p.signOutHistory.length).toBe(1);
      expect(o.appended.signEvent?.authorId).toBe('a1');
    }
  });

  it('[C7][I4] the offline sheet is a bulk sign-in: one "Offline sign-in sheet" in event per person, by the actor', async () => {
    const c = await setup([person('r'), person('o', { lifecycle: 'checked_out' })]);
    const csv = 'First Name,Last Name,Church,Gender,Grade,Signed In?\nAda,r,Victory,female,9,Y\nAda,o,Victory,female,9,Y';
    expect(await c.services.offlineSignIn.importSignIns(admin, csv)).toMatchObject({ signedIn: 2 });
    for (const id of ['r', 'o']) {
      const p = await get(c, id);
      expect(p).toMatchObject({ atCamp: true, lifecycle: 'arrived' });
      expect(p.signOutHistory).toEqual([expect.objectContaining({ type: 'in', reason: 'Offline sign-in sheet', authorId: 'a1' })]);
    }
  });
});

describe('C8 P2 one session-roster rule', () => {
  it('[C8][P2] lastEntryFor / isCheckedInFor are last-entry-wins per session', () => {
    const p = person('a', { checkInHistory: [ci({ id: '1' }), ci({ id: '2', type: 'out' }), ci({ id: '3', sessionId: 's2' })] });
    expect(lastEntryFor(p, 's1')?.id).toBe('2');
    expect(isCheckedInFor(p, 's1')).toBe(false);
    expect(isCheckedInFor(p, 's2')).toBe(true);
    expect(lastEntryFor(p, 's9')).toBeNull();
  });

  it('[C8][P2] onSessionRoster: no leaders; at camp, or a past session they have an entry for', () => {
    const atCamp = person('a', { atCamp: true, lifecycle: 'arrived' });
    const leftWithEntry = person('o', { lifecycle: 'checked_out', checkInHistory: [ci()] });
    expect(onSessionRoster(atCamp, 's1', 's1')).toBe(true);
    expect(onSessionRoster({ ...atCamp, kind: 'leader' } as Person, 's1', 's1')).toBe(false);
    expect(onSessionRoster(leftWithEntry, 's1', 's2')).toBe(true);   // past session kept
    expect(onSessionRoster(leftWithEntry, 's1', 's1')).toBe(false);  // current session dropped
    expect(onSessionRoster(person('r'), 's1', null)).toBe(false);
  });
});

describe('C9 P3+D2 presence seam ops (in-memory contract)', () => {
  async function repoWith(...ps: Person[]) {
    const r = new InMemoryPersonRepository();
    await r.init();
    for (const p of ps) await r.save(p);
    return r;
  }

  it('[C9][P3] transition decides on the stored row; null writes nothing; a throw writes nothing; missing is 404', async () => {
    const r = await repoWith(person('a', { lifecycle: 'arrived', atCamp: true }));
    const seen: Person[] = [];
    const out = await r.transition('a', (cur) => { seen.push(cur); return { atCamp: false, lifecycle: 'checked_out', appendSignEvent: ev({ type: 'out' }), updatedAt: 'T1' }; });
    expect(seen[0]).toMatchObject({ atCamp: true });
    expect(out).toMatchObject({ atCamp: false, lifecycle: 'checked_out', updatedAt: 'T1' });
    await r.transition('a', () => null);
    await expect(r.transition('a', () => { throw new Error('refused'); })).rejects.toThrow('refused');
    expect(await r.findById('a')).toMatchObject({ updatedAt: 'T1', signOutHistory: [expect.objectContaining({ type: 'out' })] });
    await expect(r.transition('nope', () => null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('[C9][P3] two concurrent transitions serialise: the second decides on the first one\'s write', async () => {
    const r = await repoWith(person('a', { lifecycle: 'arrived', atCamp: true }));
    const decide = (cur: Person) => writeOf(cur, transition(cur, { kind: 'checkIn', entry: ci() }, { actor: admin, campMode: null, now: NOW }));
    await Promise.all([r.transition('a', decide), r.transition('a', decide)]);
    expect((await r.findById('a'))!.checkInHistory).toHaveLength(1);
  });

  it('[C9][D2] transitionMany dedups ids and skips missing ones; clearPresence returns the people touched', async () => {
    const r = await repoWith(person('a', { lifecycle: 'arrived', atCamp: true, checkInHistory: [ci()] }), person('r'), person('c', { lifecycle: 'cancelled', signOutHistory: [ev()] }));
    let calls = 0;
    const out = await r.transitionMany(['r', 'r', 'ghost'], () => { calls++; return { atCamp: true, lifecycle: 'arrived', updatedAt: NOW }; });
    expect(out.map((p) => p.id)).toEqual(['r']);
    expect(calls).toBe(1);
    expect(await r.clearPresence('T2')).toBe(3);
    for (const id of ['a', 'r', 'c']) expect(await r.findById(id)).toMatchObject({ atCamp: false, checkInHistory: [], signOutHistory: [] });
    expect((await r.findById('c'))!.lifecycle).toBe('cancelled');
    expect((await r.findById('a'))!.lifecycle).toBe('registered');
  });
});

describe('C10 D3 dashboard cache per container, flushed at the repo seam', () => {
  async function cachedHome() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
    const c = await setup([person('x', { lifecycle: 'arrived', atCamp: true }), person('r')]);
    const home = () => c.services.dashboard.home(admin, settings());
    const first = await home();
    expect(await home()).toBe(first);
    return { c, home, first };
  }

  it('[C10][D3] single-person transition (check-in, sign-in/out tap) does not flush', async () => {
    const { c, home, first } = await cachedHome();
    await c.services.person.checkIn(admin, 'x', tap);
    await c.services.person.signEvent(admin, 'r', sign('in'));
    expect(await home()).toBe(first);
  });

  it('[C10][D3] bulk presence (transitionMany via the offline sheet) and a plain save do flush', async () => {
    const a = await cachedHome();
    await a.c.services.offlineSignIn.importSignIns(admin, 'First Name,Last Name,Church,Gender,Grade,Signed In?\nAda,r,Victory,female,9,Y');
    expect(await a.home()).not.toBe(a.first);
    const b = await cachedHome();
    await b.c.services.person.update(admin, 'x', { school: 'Hill' } as Partial<Person>);
    expect(await b.home()).not.toBe(b.first);
  });

  it('[C10][D3] two containers never share a cache', async () => {
    const a = await setup([person('only-a')], { campMode: 'pre-camp' });
    const b = await setup([], { campMode: 'pre-camp' });
    const s = settings({ campMode: 'pre-camp' });
    const da = await a.services.dashboard.home(admin, s);
    const db = await b.services.dashboard.home(admin, s);
    if (da.mode !== 'pre-camp' || db.mode !== 'pre-camp') throw new Error('expected pre-camp');
    expect(da.totalRegistrants).toBe(1);
    expect(db.totalRegistrants).toBe(0);
  });
});
