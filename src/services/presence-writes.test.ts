/**
 * Phase B presence lane (camp arch round 2026-11-07): B-1, B-2, B-3, B-15.
 * In-memory only (ruling Q13 c); the Supabase adapter's half is pinned in
 * repositories/supabase/supabase.people.save.test.ts against a recording fake `sql`.
 */
import { describe, it, expect } from 'vitest';
import { makePersonService } from './person.service';
import { InMemoryPersonRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';

const now = '2026-01-01T00:00:00.000Z';
const P = (over: Partial<Person>): Person => ({
  id: 'p', firstName: 'Ada', lastName: 'L', gender: 'female', kind: 'youth', churchId: 'c1',
  churchName: 'V', zone: 'Yellow', medicalConditions: [], dietaryRequirements: [],
  consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null },
    supervision: { granted: false, timestamp: null } },
  paymentStatus: 'unpaid', needsReview: false, lifecycle: 'registered', atCamp: false,
  checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now, ...over,
} as Person);
const admin: Actor = { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'A' };
const ev = { leaderName: 'L', authorId: 'u', timestamp: now };

async function repoWith(...people: Person[]) {
  const repo = new InMemoryPersonRepository();
  await repo.init();
  for (const p of people) await repo.save(p, { presence: true });
  return repo;
}

describe('B-1 presence column split', () => {
  it('a plain save of an existing person keeps the stored atCamp/lifecycle', async () => {
    const repo = await repoWith(P({ id: 'x', lifecycle: 'checked_out', atCamp: false }));
    await repo.save(P({ id: 'x', lifecycle: 'arrived', atCamp: true, otherMedications: 'Ventolin' }));
    const after = (await repo.findById('x'))!;
    expect(after).toMatchObject({ atCamp: false, lifecycle: 'checked_out', otherMedications: 'Ventolin' });
    await repo.saveMany([P({ id: 'x', lifecycle: 'arrived', atCamp: true })]);
    expect((await repo.findById('x'))!).toMatchObject({ atCamp: false, lifecycle: 'checked_out' });
  });

  it('a presence save moves atCamp/lifecycle; a plain insert writes them too', async () => {
    const repo = await repoWith(P({ id: 'x', lifecycle: 'arrived', atCamp: true }));
    await repo.saveMany([P({ id: 'x', lifecycle: 'checked_out', atCamp: false })], { presence: true });
    expect((await repo.findById('x'))!).toMatchObject({ atCamp: false, lifecycle: 'checked_out' });
    await repo.save(P({ id: 'new', lifecycle: 'cancelled', atCamp: false }));
    expect((await repo.findById('new'))!.lifecycle).toBe('cancelled');
  });

  it('admin PATCH read before a sign-out and saved after it no longer reverts the sign-out', async () => {
    const repo = await repoWith(P({ id: 'x', lifecycle: 'arrived', atCamp: true,
      signOutHistory: [{ id: 'so0', type: 'in', ...ev }] }));
    const svc = makePersonService(repo);
    const realSave = repo.save.bind(repo);
    let gate!: () => void;
    const paused = new Promise<void>((r) => (gate = r));
    repo.save = async (p, o) => { repo.save = realSave; await paused; return realSave(p, o); };
    const patch = svc.update(admin, 'x', { otherMedications: 'Ventolin' } as Partial<Person>);
    await new Promise((r) => setTimeout(r, 0));
    await svc.signEvent(admin, 'x', { type: 'out', ...ev });
    gate();
    await patch;
    const after = (await repo.findById('x'))!;
    expect(after).toMatchObject({ atCamp: false, lifecycle: 'checked_out', otherMedications: 'Ventolin' });
  });

  it('a check-in from a read taken before a sign-out does not put the person back at camp', async () => {
    const repo = await repoWith(P({ id: 'x', lifecycle: 'arrived', atCamp: true }));
    const svc = makePersonService(repo);
    const realFind = repo.findById.bind(repo);
    let gate!: () => void;
    const paused = new Promise<void>((r) => (gate = r));
    repo.findById = async (id) => { repo.findById = realFind; const p = await realFind(id); await paused; return p; };
    const tap = svc.checkIn(admin, 'x', { sessionId: 's1', sessionLabel: 'S1', type: 'in', leaderId: 'u', timestamp: now });
    await new Promise((r) => setTimeout(r, 0));
    await svc.signEvent(admin, 'x', { type: 'out', ...ev });
    gate();
    await tap;
    expect((await repo.findById('x'))!).toMatchObject({ atCamp: false, lifecycle: 'checked_out' });
  });

  it('every presence writer in person.service actually moves atCamp', async () => {
    const repo = await repoWith(P({ id: 'r' }), P({ id: 'a', lifecycle: 'arrived', atCamp: true }));
    const svc = makePersonService(repo);
    await svc.signEvent(admin, 'r', { type: 'in', ...ev });
    expect((await repo.findById('r'))!).toMatchObject({ atCamp: true, lifecycle: 'arrived' });
    await svc.update(admin, 'a', { lifecycle: 'cancelled' } as Partial<Person>);
    expect((await repo.findById('a'))!).toMatchObject({ atCamp: false, lifecycle: 'cancelled' });
    await svc.update(admin, 'a', { lifecycle: 'registered' } as Partial<Person>);
    expect((await repo.findById('a'))!.lifecycle).toBe('registered');
  });
});

describe('B-2 signEvent on wrong-state people (IA OQ-8)', () => {
  it('signing in a cancelled person is a 400 and writes nothing', async () => {
    const repo = await repoWith(P({ id: 'c', lifecycle: 'cancelled', atCamp: false }));
    const svc = makePersonService(repo);
    await expect(svc.signEvent(admin, 'c', { type: 'in', ...ev }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Cannot sign in a cancelled person' });
    expect((await repo.findById('c'))!.signOutHistory).toEqual([]);
  });

  it('signing out a never-arrived or cancelled person is a silent no-op (no event)', async () => {
    const repo = await repoWith(P({ id: 'r' }), P({ id: 'c', lifecycle: 'cancelled' }));
    const svc = makePersonService(repo);
    await svc.signEvent(admin, 'r', { type: 'out', ...ev });
    await svc.signEvent(admin, 'c', { type: 'out', ...ev });
    expect((await repo.findById('r'))!).toMatchObject({ signOutHistory: [], lifecycle: 'registered', atCamp: false });
    expect((await repo.findById('c'))!.signOutHistory).toEqual([]);
  });

  it('checkIn keeps its two refusals unchanged', async () => {
    const repo = await repoWith(P({ id: 'c', lifecycle: 'cancelled' }), P({ id: 'r' }));
    const svc = makePersonService(repo);
    const e = { sessionId: 's1', sessionLabel: 'S1', type: 'in' as const, leaderId: 'u', timestamp: now };
    await expect(svc.checkIn(admin, 'c', e)).rejects.toMatchObject({ statusCode: 400, message: 'Cannot check in a cancelled person' });
    await expect(svc.checkIn(admin, 'r', e)).rejects.toMatchObject({ statusCode: 400, message: 'Cannot check in a person who is not currently at camp' });
  });
});

describe('B-3 cancelling someone at camp signs them out first', () => {
  it('writes one out event (actor, "Registration cancelled"), then cancels; undo + sign in balances it', async () => {
    const repo = await repoWith(P({ id: 'a', lifecycle: 'arrived', atCamp: true,
      signOutHistory: [{ id: 'so0', type: 'in', ...ev }] }));
    const svc = makePersonService(repo);
    await svc.update(admin, 'a', { lifecycle: 'cancelled' } as Partial<Person>);
    let after = (await repo.findById('a'))!;
    expect(after).toMatchObject({ lifecycle: 'cancelled', atCamp: false });
    expect(after.signOutHistory.map((e) => e.type)).toEqual(['in', 'out']);
    expect(after.signOutHistory[1]).toMatchObject({ leaderName: 'A', authorId: 'u', reason: 'Registration cancelled' });
    await svc.update(admin, 'a', { lifecycle: 'registered' } as Partial<Person>);
    await svc.signEvent(admin, 'a', { type: 'in', ...ev });
    after = (await repo.findById('a'))!;
    expect(after).toMatchObject({ lifecycle: 'arrived', atCamp: true });
    expect(after.signOutHistory.map((e) => e.type)).toEqual(['in', 'out', 'in']);
  });

  it('cancelling someone not at camp writes no event', async () => {
    const repo = await repoWith(P({ id: 'r' }), P({ id: 'o', lifecycle: 'checked_out' }));
    const svc = makePersonService(repo);
    await svc.update(admin, 'r', { lifecycle: 'cancelled' } as Partial<Person>);
    await svc.update(admin, 'o', { lifecycle: 'cancelled' } as Partial<Person>);
    expect((await repo.findById('r'))!.signOutHistory).toEqual([]);
    expect((await repo.findById('o'))!).toMatchObject({ lifecycle: 'cancelled', signOutHistory: [] });
  });
});
