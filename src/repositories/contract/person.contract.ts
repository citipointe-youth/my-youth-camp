/**
 * Repository contract for IPersonRepository and the users "keeps admins" rule (P3+D2).
 *
 * Ruling Q13 c: this runs against the in-memory adapter only. The Supabase adapter is checked by
 * reading its SQL against these cases (the hand-read checklist is in the round's
 * build/c-P3-D2.md), plus the recording-fake statement tests in
 * supabase/supabase.people.save.test.ts. Each `it` here names one behaviour BOTH adapters owe.
 */
import { describe, it, expect } from 'vitest';
import type { IPersonRepository, IUserRepository, PresenceWrite } from '../interfaces/entity-repositories';
import type { Person, CheckInEntry, SignOutEvent } from '../../core/entities/person';
import type { User } from '../../core/entities/user';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
export const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'female', kind: 'youth', churchId: 'c1',
  churchName: 'Victory', zone: 'Yellow', medicalConditions: [], dietaryRequirements: [],
  consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null },
    supervision: { granted: false, timestamp: null } },
  paymentStatus: 'unpaid', needsReview: false, lifecycle: 'registered', atCamp: false, cancelledAt: null,
  checkInHistory: [], signOutHistory: [], createdAt: T0, updatedAt: T0, ...over,
});
const ci = (id: string, type: 'in' | 'out' = 'in', sessionId = 's1'): CheckInEntry =>
  ({ id, sessionId, sessionLabel: 'S', type, leaderId: 'AB', timestamp: T0 });
const so = (id: string, type: 'in' | 'out'): SignOutEvent =>
  ({ id, type, leaderName: 'L', authorId: 'u', timestamp: T0 });
const signIn = (id: string): PresenceWrite =>
  ({ atCamp: true, lifecycle: 'arrived', appendSignEvent: so(id, 'in'), updatedAt: T1 });

export function personRepositoryContract(name: string, make: () => Promise<IPersonRepository>): void {
  describe(`IPersonRepository contract: ${name}`, () => {
    it('an insert writes every field, presence and histories included', async () => {
      const r = await make();
      await r.save(person({ lifecycle: 'arrived', atCamp: true, checkInHistory: [ci('c1')], signOutHistory: [so('s1', 'in')] }));
      expect(await r.findById('p1')).toMatchObject({ lifecycle: 'arrived', atCamp: true });
      expect((await r.findById('p1'))!.checkInHistory.map((e) => e.id)).toEqual(['c1']);
      expect((await r.findById('p1'))!.signOutHistory.map((e) => e.id)).toEqual(['s1']);
    });

    it('save/saveMany on an existing id write fields but never presence or history (B-1, P3)', async () => {
      const r = await make();
      await r.save(person({ lifecycle: 'cancelled', cancelledAt: T0, checkInHistory: [ci('c1')], signOutHistory: [so('s1', 'out')] }));
      const stale = person({ school: 'Hill', lifecycle: 'arrived', atCamp: true, cancelledAt: null,
        checkInHistory: [ci('c1'), ci('c2', 'out')], signOutHistory: [] });
      for (const write of [() => r.save(stale), () => r.saveMany([stale])]) {
        await write();
        const p = (await r.findById('p1'))!;
        expect(p).toMatchObject({ school: 'Hill', lifecycle: 'cancelled', atCamp: false, cancelledAt: T0 });
        expect(p.checkInHistory.map((e) => e.id)).toEqual(['c1']);
        expect(p.signOutHistory.map((e) => e.id)).toEqual(['s1']);
      }
    });

    it('transition decides on the stored row, writes presence + one history row, returns the written row', async () => {
      const r = await make();
      await r.save(person());
      let seen: Person | null = null;
      const out = await r.transition('p1', (cur) => { seen = cur; return { ...signIn('e1'), appendCheckIn: ci('c9') }; });
      expect(seen!.lifecycle).toBe('registered');
      expect(out).toMatchObject({ atCamp: true, lifecycle: 'arrived', updatedAt: T1 });
      const p = (await r.findById('p1'))!;
      expect(p).toMatchObject({ atCamp: true, lifecycle: 'arrived', updatedAt: T1, cancelledAt: null });
      expect(p.signOutHistory.map((e) => e.id)).toEqual(['e1']);
      expect(p.checkInHistory.map((e) => e.id)).toEqual(['c9']);
    });

    it('transition: cancelledAt is written only when the write carries it', async () => {
      const r = await make();
      await r.save(person({ lifecycle: 'cancelled', cancelledAt: T0 }));
      await r.transition('p1', () => ({ atCamp: false, lifecycle: 'cancelled', updatedAt: T1 }));
      expect((await r.findById('p1'))!.cancelledAt).toBe(T0);
      await r.transition('p1', () => ({ atCamp: false, lifecycle: 'registered', cancelledAt: null, updatedAt: T1 }));
      expect(await r.findById('p1')).toMatchObject({ lifecycle: 'registered', cancelledAt: null });
    });

    it('transition: a null decision writes nothing; a throw writes nothing and propagates', async () => {
      const r = await make();
      await r.save(person());
      expect(await r.transition('p1', () => null)).toMatchObject({ id: 'p1', updatedAt: T0 });
      await expect(r.transition('p1', () => { throw new Error('refused'); })).rejects.toThrow('refused');
      expect(await r.findById('p1')).toMatchObject({ updatedAt: T0, atCamp: false, signOutHistory: [] });
    });

    it('transition on a missing id is a NotFoundError', async () => {
      const r = await make();
      await expect(r.transition('nope', () => null)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('two concurrent transitions on one person serialise: the second sees the first (B-5)', async () => {
      const r = await make();
      await r.save(person({ lifecycle: 'arrived', atCamp: true }));
      const once = (cur: Person): PresenceWrite | null =>
        cur.checkInHistory.some((e) => e.sessionId === 's1')
          ? null
          : { atCamp: cur.atCamp, lifecycle: cur.lifecycle, appendCheckIn: ci(`c${Math.random()}`), updatedAt: T1 };
      await Promise.all([r.transition('p1', once), r.transition('p1', once)]);
      expect((await r.findById('p1'))!.checkInHistory).toHaveLength(1);
    });

    it('a stale save after a transition does not revert it', async () => {
      const r = await make();
      await r.save(person());
      const stale = (await r.findById('p1'))!;
      await r.transition('p1', () => signIn('e1'));
      await r.save({ ...stale, school: 'X' });
      expect(await r.findById('p1')).toMatchObject({ atCamp: true, lifecycle: 'arrived', school: 'X' });
      expect((await r.findById('p1'))!.signOutHistory).toHaveLength(1);
    });

    it('transitionMany: id order, missing ids skipped, duplicates once, one write each', async () => {
      const r = await make();
      await r.saveMany([person({ id: 'b' }), person({ id: 'a' })]);
      const order: string[] = [];
      const out = await r.transitionMany(['b', 'missing', 'a', 'b'], (cur) => { order.push(cur.id); return signIn(`e-${cur.id}`); });
      expect(order).toEqual(['a', 'b']);
      expect(out.map((p) => p.id)).toEqual(['a', 'b']);
      for (const id of ['a', 'b']) expect((await r.findById(id))!.signOutHistory.map((e) => e.id)).toEqual([`e-${id}`]);
      expect(await r.transitionMany([], () => null)).toEqual([]);
    });

    it('transitionMany is all-or-nothing when a decision throws', async () => {
      const r = await make();
      await r.saveMany([person({ id: 'a' }), person({ id: 'b' })]);
      await expect(r.transitionMany(['a', 'b'], (cur) => { if (cur.id === 'b') throw new Error('boom'); return signIn('e'); }))
        .rejects.toThrow('boom');
      expect((await r.findById('a'))!).toMatchObject({ atCamp: false, signOutHistory: [] });
    });

    it('clearPresence deletes all history, resets presence by rule, counts and stamps only people touched', async () => {
      const r = await make();
      await r.saveMany([
        person({ id: 'arr', lifecycle: 'arrived', atCamp: true, checkInHistory: [ci('c1')], signOutHistory: [so('s1', 'in')] }),
        person({ id: 'out', lifecycle: 'checked_out', signOutHistory: [so('s2', 'out')] }),
        person({ id: 'dep', lifecycle: 'departed', checkInHistory: [ci('c2')] }),
        person({ id: 'cxl', lifecycle: 'cancelled', signOutHistory: [so('s3', 'out')] }),
        person({ id: 'reg', lifecycle: 'registered', atCamp: true }),
        person({ id: 'quiet', lifecycle: 'arrived' }), // no history, not at camp: untouched
        person({ id: 'none' }),
      ]);
      expect(await r.clearPresence(T1)).toBe(5);
      const by = new Map((await r.findAll()).map((p) => [p.id, p]));
      for (const p of by.values()) { expect(p.checkInHistory).toEqual([]); expect(p.signOutHistory).toEqual([]); }
      expect(by.get('arr')).toMatchObject({ lifecycle: 'registered', atCamp: false, updatedAt: T1 });
      expect(by.get('out')).toMatchObject({ lifecycle: 'registered', updatedAt: T1 });
      expect(by.get('dep')).toMatchObject({ lifecycle: 'registered' });
      expect(by.get('cxl')).toMatchObject({ lifecycle: 'cancelled', updatedAt: T1 });
      expect(by.get('reg')).toMatchObject({ lifecycle: 'registered', atCamp: false });
      expect(by.get('quiet')).toMatchObject({ lifecycle: 'arrived', updatedAt: T0 });
      expect(by.get('none')).toMatchObject({ updatedAt: T0 });
    });

    it('a stale save after clearPresence does not bring history back (gate B N1)', async () => {
      const r = await make();
      await r.save(person({ lifecycle: 'arrived', atCamp: true, checkInHistory: [ci('c1')], signOutHistory: [so('s1', 'in')] }));
      const stale = (await r.findById('p1'))!;
      await r.clearPresence(T1);
      await r.save(stale);
      expect(await r.findById('p1')).toMatchObject({ checkInHistory: [], signOutHistory: [], atCamp: false, lifecycle: 'registered' });
    });

    it('search: every term must appear in "first last", any order, case-insensitive; blank finds nobody', async () => {
      const r = await make();
      await r.saveMany([person({ id: 'a', firstName: 'John', lastName: 'Smith' }), person({ id: 'b', firstName: 'Jo', lastName: 'Smithers' })]);
      expect((await r.search('smith john')).map((p) => p.id)).toEqual(['a']);
      expect((await r.search('  SMITH ')).map((p) => p.id).sort()).toEqual(['a', 'b']);
      expect(await r.search('   ')).toEqual([]);
    });

    it('findByChurch / findByZone filter; deleteAll returns the count', async () => {
      const r = await make();
      await r.saveMany([person({ id: 'a', churchId: 'c1', zone: 'Blue' }), person({ id: 'b', churchId: 'c2', zone: 'Yellow' })]);
      expect((await r.findByChurch('c1')).map((p) => p.id)).toEqual(['a']);
      expect((await r.findByZone('Yellow')).map((p) => p.id)).toEqual(['b']);
      expect(await r.deleteAll()).toBe(2);
      expect(await r.findAll()).toEqual([]);
    });

    it('reads are copies: mutating a result does not change the store', async () => {
      const r = await make();
      await r.save(person());
      (await r.findById('p1'))!.firstName = 'MUTATED';
      expect((await r.findById('p1'))!.firstName).toBe('Ada');
    });
  });
}

const user = (id: string, role: User['role']): User =>
  ({ id, username: id, firstName: id, lastName: '', role, status: 'active', createdAt: T0, updatedAt: T0 } as unknown as User);

export function userRepositoryContract(name: string, make: () => Promise<IUserRepository>): void {
  describe(`IUserRepository contract: ${name}`, () => {
    it('deleteAll keeps every admin and returns the number removed (OQ-44)', async () => {
      const r = await make();
      await r.saveMany([user('a1', 'admin'), user('a2', 'admin'), user('c1', 'church'), user('d1', 'director')]);
      expect(await r.deleteAll()).toBe(2);
      expect((await r.findAll()).map((u) => u.id).sort()).toEqual(['a1', 'a2']);
    });
  });
}
