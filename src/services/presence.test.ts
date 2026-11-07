import { describe, it, expect } from 'vitest';
import { transition, type PresenceIntent, type PresenceCtx } from './presence';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import type { CheckInEntry, SignOutEvent } from '../core/entities/person';

const ACTOR: Actor = { id: 'u1', role: 'church', churchId: 'c1', churchName: 'Victory', zone: 'Yellow', displayName: 'Vic' };
const ctx = (over: Partial<PresenceCtx> = {}): PresenceCtx => ({ actor: ACTOR, now: 'now', ...over });

// P1+I4: the pre-P1 helpers are now intents of `transition`. These shims keep every earlier
// assertion verbatim (characterisation of the old person-lifecycle.ts behaviour).
function withCheckIn(p: Person, entry: CheckInEntry, now: string): Person {
  const o = transition(p, { kind: 'checkIn', entry }, ctx({ now }));
  if (o.result === 'refused') throw new Error(o.reason);
  return o.result === 'applied' ? o.next : p;
}
function withSignEvent(p: Person, event: SignOutEvent, now: string): Person {
  const o = transition(p, { kind: event.type === 'in' ? 'signIn' : 'signOut', event }, ctx({ now }));
  return o.result === 'applied' ? o.next : p;
}
function applyCheckIn(p: Pick<Person, 'lifecycle' | 'atCamp'>, type: 'in' | 'out') {
  const n = withSignEvent(basePerson(p), { id: 'e', type, leaderName: 'L', authorId: 'u1', timestamp: 't' }, 'now');
  return { lifecycle: n.lifecycle, atCamp: n.atCamp };
}
const applySignOut = (p: Pick<Person, 'lifecycle' | 'atCamp'>) => applyCheckIn(p, 'out');
const applySignIn = (p: Pick<Person, 'lifecycle' | 'atCamp'>) => applyCheckIn(p, 'in');

// ---------------------------------------------------------------------------
// Locks the design-D2 promotion rule: Day-1 first check-in promotes a registrant
// to a camper (registered -> arrived). Pure-function tests, fully verifiable.
// ---------------------------------------------------------------------------

describe('applyCheckIn — promotion semantics', () => {
  it('a registered person checking IN is promoted to arrived + atCamp', () => {
    expect(applyCheckIn({ lifecycle: 'registered', atCamp: false }, 'in')).toEqual({
      lifecycle: 'arrived',
      atCamp: true,
    });
  });

  it('an already-arrived person checking IN stays arrived (idempotent)', () => {
    expect(applyCheckIn({ lifecycle: 'arrived', atCamp: true }, 'in')).toEqual({
      lifecycle: 'arrived',
      atCamp: true,
    });
  });

  it('a checked_out person checking IN returns to arrived + atCamp', () => {
    expect(applyCheckIn({ lifecycle: 'checked_out', atCamp: false }, 'in')).toEqual({
      lifecycle: 'arrived',
      atCamp: true,
    });
  });

  it('a cancelled person is NOT auto-promoted by a check-in', () => {
    expect(applyCheckIn({ lifecycle: 'cancelled', atCamp: false }, 'in')).toEqual({
      lifecycle: 'cancelled',
      atCamp: false,
    });
  });

  it('an arrived person checking OUT becomes checked_out + not atCamp', () => {
    expect(applyCheckIn({ lifecycle: 'arrived', atCamp: true }, 'out')).toEqual({
      lifecycle: 'checked_out',
      atCamp: false,
    });
  });

  it('checking OUT a registered person is a no-op (never arrived)', () => {
    expect(applyCheckIn({ lifecycle: 'registered', atCamp: false }, 'out')).toEqual({
      lifecycle: 'registered',
      atCamp: false,
    });
  });

  it('checking OUT a cancelled person is a no-op', () => {
    expect(applyCheckIn({ lifecycle: 'cancelled', atCamp: false }, 'out')).toEqual({
      lifecycle: 'cancelled',
      atCamp: false,
    });
  });
});

describe('applySignOut / applySignIn convenience wrappers', () => {
  it('applySignOut mirrors checkIn(out)', () => {
    expect(applySignOut({ lifecycle: 'arrived', atCamp: true })).toEqual({ lifecycle: 'checked_out', atCamp: false });
  });
  it('applySignIn mirrors checkIn(in) and promotes', () => {
    expect(applySignIn({ lifecycle: 'registered', atCamp: false })).toEqual({ lifecycle: 'arrived', atCamp: true });
  });
});

function basePerson(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    medicalConditions: [],
    dietaryRequirements: [],
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid',
    needsReview: false,
    lifecycle: 'registered',
    atCamp: false,
    checkInHistory: [],
    signOutHistory: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('checkIn intent (was withCheckIn) — immutable append only (never touches lifecycle or atCamp)', () => {
  const entry: CheckInEntry = {
    id: 'ci1',
    sessionId: 's1',
    sessionLabel: 'Wed AM',
    type: 'in',
    leaderId: 'u1',
    timestamp: '2026-07-01T08:00:00.000Z',
  };
  const outEntry: CheckInEntry = {
    id: 'ci2',
    sessionId: 's1',
    sessionLabel: 'Wed AM',
    type: 'out',
    leaderId: 'u1',
    timestamp: '2026-07-01T20:00:00.000Z',
  };

  it('appends the entry and stamps updatedAt, does NOT change lifecycle or atCamp', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const next = withCheckIn(p, entry, '2026-07-01T08:00:01.000Z');
    expect(next.checkInHistory).toHaveLength(1);
    expect(next.checkInHistory[0]).toBe(entry);
    expect(next.lifecycle).toBe('arrived');
    expect(next.atCamp).toBe(true);
    expect(next.updatedAt).toBe('2026-07-01T08:00:01.000Z');
  });

  it('a session check-OUT does NOT set atCamp=false (only attendance sign-out does)', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const next = withCheckIn(p, outEntry, '2026-07-01T20:00:01.000Z');
    expect(next.atCamp).toBe(true);
    expect(next.lifecycle).toBe('arrived');
    expect(next.checkInHistory).toHaveLength(1);
  });

  it('does not mutate the input person', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    withCheckIn(p, entry, '2026-07-01T08:00:01.000Z');
    expect(p.checkInHistory).toHaveLength(0);
    expect(p.lifecycle).toBe('arrived');
    expect(p.atCamp).toBe(true);
  });

  it('accumulates multiple entries across sessions', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const p2 = withCheckIn(p, entry, 't1');
    const entry2: CheckInEntry = { ...entry, id: 'ci3', sessionId: 's2', sessionLabel: 'Thu AM' };
    const p3 = withCheckIn(p2, entry2, 't2');
    expect(p3.checkInHistory).toHaveLength(2);
    expect(p3.atCamp).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N5 — server-side check-in dedup. The SPA's persisted queue can replay an entry
// after a crash; a repeat of the SAME type as the last entry for that session is
// a no-op. A genuine in -> out -> in sequence must still be three entries
// ("checked in" is last-entry-wins for a session).
// ---------------------------------------------------------------------------
describe('checkIn intent (was withCheckIn) — (sessionId, person, type) dedup', () => {
  const inEntry: CheckInEntry = {
    id: 'ci1',
    sessionId: 's1',
    sessionLabel: 'Wed AM',
    type: 'in',
    leaderId: 'u1',
    timestamp: '2026-07-01T08:00:00.000Z',
  };
  const outEntry: CheckInEntry = { ...inEntry, id: 'ci2', type: 'out', timestamp: '2026-07-01T09:00:00.000Z' };

  it('(a) a duplicate identical replay is collapsed to one entry, person returned unchanged', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const once = withCheckIn(p, inEntry, 't1');
    // The replayed entry has a fresh id (person.service mints one per call) but the same
    // session + type — exactly what a queue replay produces.
    const replay: CheckInEntry = { ...inEntry, id: 'ci1-replay', timestamp: '2026-07-01T08:00:02.000Z' };
    const twice = withCheckIn(once, replay, 't2');
    expect(twice.checkInHistory).toHaveLength(1);
    expect(twice).toBe(once);
    expect(twice.updatedAt).toBe('t1');
    // The P0 presence invariant is untouched either way.
    expect(twice.atCamp).toBe(true);
    expect(twice.lifecycle).toBe('arrived');
  });

  it('(b) a genuine in -> out -> in sequence still produces three entries', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const p1 = withCheckIn(p, inEntry, 't1');
    const p2 = withCheckIn(p1, outEntry, 't2');
    const p3 = withCheckIn(p2, { ...inEntry, id: 'ci3', timestamp: '2026-07-01T10:00:00.000Z' }, 't3');
    expect(p3.checkInHistory).toHaveLength(3);
    expect(p3.checkInHistory.map((e) => e.type)).toEqual(['in', 'out', 'in']);
    // Last-entry-wins: they read as checked in.
    expect(p3.checkInHistory[p3.checkInHistory.length - 1]?.type).toBe('in');
    expect(p3.atCamp).toBe(true);
    expect(p3.lifecycle).toBe('arrived');
  });

  it('(c) two different people in the same session are unaffected by each other', () => {
    const a = withCheckIn(basePerson({ id: 'pA', lifecycle: 'arrived', atCamp: true }), inEntry, 't1');
    const b = withCheckIn(basePerson({ id: 'pB', lifecycle: 'arrived', atCamp: true }), { ...inEntry, id: 'ci9' }, 't1');
    expect(a.checkInHistory).toHaveLength(1);
    expect(b.checkInHistory).toHaveLength(1);
  });

  it('(d) the same person in two DIFFERENT sessions is unaffected', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const p1 = withCheckIn(p, inEntry, 't1');
    const p2 = withCheckIn(p1, { ...inEntry, id: 'ci4', sessionId: 's2', sessionLabel: 'Wed PM' }, 't2');
    expect(p2.checkInHistory).toHaveLength(2);
    expect(p2.checkInHistory.map((e) => e.sessionId)).toEqual(['s1', 's2']);
  });

  it('only the LAST entry for the session is compared — an interleaved other session is skipped', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const p1 = withCheckIn(p, inEntry, 't1');
    const p2 = withCheckIn(p1, { ...inEntry, id: 'ci5', sessionId: 's2', sessionLabel: 'Wed PM' }, 't2');
    // s1's last entry is still the 'in' — this replay must collapse despite s2 sitting after it.
    const p3 = withCheckIn(p2, { ...inEntry, id: 'ci6' }, 't3');
    expect(p3.checkInHistory).toHaveLength(2);
    // ...while a genuine s1 check-OUT still appends.
    const p4 = withCheckIn(p3, outEntry, 't4');
    expect(p4.checkInHistory).toHaveLength(3);
  });
});

describe('signIn/signOut intents (was withSignEvent) — immutable append + lifecycle/atCamp transition', () => {
  it('a sign-OUT event moves arrived -> checked_out, sets atCamp=false, appends history', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const ev: SignOutEvent = { id: 'so1', type: 'out', leaderName: 'Leader', authorId: 'u1', timestamp: 't' };
    const next = withSignEvent(p, ev, 'now');
    expect(next.signOutHistory).toHaveLength(1);
    expect(next.lifecycle).toBe('checked_out');
    expect(next.atCamp).toBe(false);
    expect(p.signOutHistory).toHaveLength(0);
  });

  it('a sign-IN event (return to camp) promotes checked_out -> arrived, sets atCamp=true', () => {
    const p = basePerson({ lifecycle: 'checked_out', atCamp: false });
    const ev: SignOutEvent = { id: 'si1', type: 'in', leaderName: 'Leader', authorId: 'u1', timestamp: 't' };
    const next = withSignEvent(p, ev, 'now');
    expect(next.lifecycle).toBe('arrived');
    expect(next.atCamp).toBe(true);
    expect(next.signOutHistory).toHaveLength(1);
  });

  it('sign-OUT on a checked_out person is idempotent (stays checked_out)', () => {
    const p = basePerson({ lifecycle: 'checked_out', atCamp: false });
    const ev: SignOutEvent = { id: 'so2', type: 'out', leaderName: 'Leader', authorId: 'u1', timestamp: 't' };
    const next = withSignEvent(p, ev, 'now');
    expect(next.lifecycle).toBe('checked_out');
    expect(next.atCamp).toBe(false);
    expect(next.signOutHistory).toHaveLength(0); // B-2: a state no-op writes no event
    expect(next).toBe(p);
  });

  // B-2 (IA OQ-8): an event is written exactly when atCamp/lifecycle actually move.
  it.each([
    ['registered', false, 'in', 1],
    ['registered', false, 'out', 0],
    ['arrived', true, 'in', 0],
    ['arrived', true, 'out', 1],
    ['checked_out', false, 'in', 1],
    ['checked_out', false, 'out', 0],
    ['checked_out', true, 'out', 1], // at-camp mode switch: atCamp set with no event
    ['cancelled', false, 'in', 0],
    ['cancelled', false, 'out', 0],
  ] as const)('%s (atCamp %s) + sign-%s appends %i event(s)', (lifecycle, atCamp, type, n) => {
    const p = basePerson({ lifecycle, atCamp });
    const next = withSignEvent(p, { id: 'e', type, leaderName: 'L', authorId: 'u1', timestamp: 't' }, 'now');
    expect(next.signOutHistory).toHaveLength(n);
    if (n === 0) expect(next).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// P1+I4 interface tests for `transition`.
// ---------------------------------------------------------------------------
describe('transition — interface (P1+I4)', () => {
  const ev = (type: 'in' | 'out', over: Partial<SignOutEvent> = {}): SignOutEvent =>
    ({ id: 'e1', type, leaderName: 'L', authorId: 'someone-else', timestamp: 't', ...over });
  const entry: CheckInEntry = { id: 'ci1', sessionId: 's1', sessionLabel: 'Wed AM', type: 'in', leaderId: 'AB', timestamp: 't' };
  const director: Actor = { ...ACTOR, id: 'd1', role: 'director', churchId: null, churchName: null, zone: null, displayName: 'Dee' };
  const admin: Actor = { ...director, id: 'a1', role: 'admin', displayName: 'Ad' };

  it('checkIn keeps exactly the two frozen refusal messages (queue contract)', () => {
    expect(transition(basePerson({ lifecycle: 'cancelled' }), { kind: 'checkIn', entry }, ctx()))
      .toEqual({ result: 'refused', reason: 'Cannot check in a cancelled person' });
    expect(transition(basePerson({ lifecycle: 'checked_out', atCamp: false }), { kind: 'checkIn', entry }, ctx()))
      .toEqual({ result: 'refused', reason: 'Cannot check in a person who is not currently at camp' });
  });

  it('checkIn never refuses an at-camp, non-cancelled person in any camp mode', () => {
    for (const campMode of ['pre-camp', 'at-camp', undefined] as const) {
      for (const lifecycle of ['registered', 'arrived', 'checked_out'] as const) {
        const o = transition(basePerson({ lifecycle, atCamp: true }), { kind: 'checkIn', entry }, ctx({ campMode }));
        expect(o.result).toBe('applied');
      }
    }
  });

  it('checkIn applied reports the appended row and never moves presence', () => {
    const o = transition(basePerson({ lifecycle: 'arrived', atCamp: true }), { kind: 'checkIn', entry }, ctx());
    if (o.result !== 'applied') throw new Error('expected applied');
    expect(o.appended).toEqual({ checkIn: entry });
    expect(o.next.atCamp).toBe(true);
    expect(o.next.lifecycle).toBe('arrived');
    expect(o.next.signOutHistory).toHaveLength(0);
  });

  it('sign events are authored by ctx.actor, whatever the event says', () => {
    const o = transition(basePerson(), { kind: 'signIn', event: ev('in') }, ctx());
    if (o.result !== 'applied') throw new Error('expected applied');
    expect(o.next.signOutHistory[0]!.authorId).toBe('u1');
    expect(o.appended.signEvent!.authorId).toBe('u1');
  });

  it('the intent kind decides the event type', () => {
    const o = transition(basePerson(), { kind: 'signIn', event: ev('out') }, ctx());
    if (o.result !== 'applied') throw new Error('expected applied');
    expect(o.next.signOutHistory[0]!.type).toBe('in');
  });

  it('pre-camp signIn is refused for church/zone/firstAid, allowed for director/admin', () => {
    const msg = 'Camp has not started yet, so nobody can be signed in.';
    for (const role of ['church', 'zoneLeader', 'firstAid'] as const) {
      expect(transition(basePerson(), { kind: 'signIn', event: ev('in') }, ctx({ actor: { ...ACTOR, role }, campMode: 'pre-camp' })))
        .toEqual({ result: 'refused', reason: msg });
    }
    for (const actor of [director, admin]) {
      expect(transition(basePerson(), { kind: 'signIn', event: ev('in') }, ctx({ actor, campMode: 'pre-camp' })).result).toBe('applied');
    }
    // pre-camp never refuses a sign-OUT
    expect(transition(basePerson({ lifecycle: 'arrived', atCamp: true }), { kind: 'signOut', event: ev('out') }, ctx({ campMode: 'pre-camp' })).result).toBe('applied');
  });

  it('signIn of a cancelled person is refused (B-2); signOut is a no-op', () => {
    const p = basePerson({ lifecycle: 'cancelled' });
    expect(transition(p, { kind: 'signIn', event: ev('in') }, ctx())).toEqual({ result: 'refused', reason: 'Cannot sign in a cancelled person' });
    expect(transition(p, { kind: 'signOut', event: ev('out') }, ctx())).toEqual({ result: 'noop' });
  });

  it('cancel at camp writes exactly one out event then cancels (B-3)', () => {
    const o = transition(basePerson({ lifecycle: 'arrived', atCamp: true }), { kind: 'cancel' }, ctx({ now: 'T' }));
    if (o.result !== 'applied') throw new Error('expected applied');
    expect(o.next).toMatchObject({ lifecycle: 'cancelled', atCamp: false, cancelledAt: 'T', updatedAt: 'T' });
    expect(o.next.signOutHistory).toHaveLength(1);
    expect(o.next.signOutHistory[0]).toMatchObject({ type: 'out', reason: 'Registration cancelled', leaderName: 'Vic', authorId: 'u1', timestamp: 'T' });
    expect(o.appended.signEvent).toBe(o.next.signOutHistory[0]);
  });

  it('cancel away from camp writes no event; displayName blank falls back to Staff', () => {
    const away = transition(basePerson({ lifecycle: 'checked_out' }), { kind: 'cancel' }, ctx());
    if (away.result !== 'applied') throw new Error('expected applied');
    expect(away.next.signOutHistory).toHaveLength(0);
    expect(away.appended).toEqual({});
    const blank = transition(basePerson({ lifecycle: 'arrived', atCamp: true }), { kind: 'cancel' }, ctx({ actor: { ...ACTOR, displayName: '' } }));
    if (blank.result !== 'applied') throw new Error('expected applied');
    expect(blank.next.signOutHistory[0]!.leaderName).toBe('Staff');
  });

  it('cancel on cancelled / uncancel on not-cancelled are no-ops; uncancel restores registered', () => {
    expect(transition(basePerson({ lifecycle: 'cancelled' }), { kind: 'cancel' }, ctx())).toEqual({ result: 'noop' });
    expect(transition(basePerson(), { kind: 'uncancel' }, ctx())).toEqual({ result: 'noop' });
    const o = transition(basePerson({ lifecycle: 'cancelled', cancelledAt: 'x' }), { kind: 'uncancel' }, ctx({ now: 'T' }));
    if (o.result !== 'applied') throw new Error('expected applied');
    expect(o.next).toMatchObject({ lifecycle: 'registered', atCamp: false, cancelledAt: null, updatedAt: 'T' });
    expect(o.next.signOutHistory).toHaveLength(0);
  });

  it('modeRevert: atCamp -> registered with one out; checked_out and cancelled untouched (B-X3)', () => {
    const revert = (p: Person) => transition(p, { kind: 'modeRevert', event: ev('out', { reason: 'Camp mode reverted to pre-camp' }) }, ctx({ now: 'T' }));
    const o = revert(basePerson({ lifecycle: 'arrived', atCamp: true }));
    if (o.result !== 'applied') throw new Error('expected applied');
    expect(o.next).toMatchObject({ lifecycle: 'registered', atCamp: false, updatedAt: 'T' });
    expect(o.next.signOutHistory).toEqual([{ ...ev('out', { reason: 'Camp mode reverted to pre-camp' }), authorId: 'u1' }]);
    expect(revert(basePerson({ lifecycle: 'checked_out', atCamp: false }))).toEqual({ result: 'noop' });
    expect(revert(basePerson({ lifecycle: 'cancelled', atCamp: false }))).toEqual({ result: 'noop' });
    expect(revert(basePerson({ lifecycle: 'registered', atCamp: false }))).toEqual({ result: 'noop' });
  });

  it('every applied outcome that changes atCamp appends exactly one sign event; a noop changes nothing', () => {
    const states = [
      // registered+atCamp is left out: unreachable (only a sign-in sets atCamp, and it sets arrived).
      // A cancel on it would clear atCamp with no event, unchanged from before P1.
      ['registered', false], ['arrived', true], ['arrived', false],
      ['checked_out', false], ['checked_out', true], ['cancelled', false],
    ] as const;
    const intents: PresenceIntent[] = [
      { kind: 'checkIn', entry }, { kind: 'signIn', event: ev('in') }, { kind: 'signOut', event: ev('out') },
      { kind: 'cancel' }, { kind: 'uncancel' }, { kind: 'modeRevert', event: ev('out') },
    ];
    for (const [lifecycle, atCamp] of states) {
      for (const intent of intents) {
        for (const campMode of ['pre-camp', 'at-camp'] as const) {
          const p = basePerson({ lifecycle, atCamp });
          const o = transition(p, intent, ctx({ campMode }));
          const label = `${lifecycle}/${atCamp}/${intent.kind}/${campMode}`;
          if (o.result !== 'applied') continue;
          const added = o.next.signOutHistory.length - p.signOutHistory.length;
          if (o.next.atCamp !== p.atCamp) expect(added, label).toBe(1);
          expect(added, label).toBe(o.appended.signEvent ? 1 : 0);
          expect(o.next.checkInHistory.length - p.checkInHistory.length, label).toBe(o.appended.checkIn ? 1 : 0);
          if (intent.kind === 'checkIn') expect([o.next.atCamp, o.next.lifecycle], label).toEqual([p.atCamp, p.lifecycle]);
        }
      }
    }
  });

  it('never mutates the input person', () => {
    const p = basePerson({ lifecycle: 'arrived', atCamp: true });
    const snapshot = JSON.stringify(p);
    for (const intent of [{ kind: 'checkIn', entry }, { kind: 'signOut', event: ev('out') }, { kind: 'cancel' }, { kind: 'modeRevert', event: ev('out') }] as PresenceIntent[]) {
      transition(p, intent, ctx());
    }
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
