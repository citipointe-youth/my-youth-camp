import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeDashboardCache, invalidateOnWrite } from './dashboard-cache';
import { buildMemoryContainer, type Container } from '../container';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { SETTINGS_ID, type CampSettings } from '../core/entities/settings';

// D3: the dashboard cache is per container and flushed at the repo seam, never by a tap.
const NOW = '2026-01-01T00:00:00.000Z';
const admin: Actor = { id: 'a1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Ad' };
const settings = (over: Partial<CampSettings> = {}): CampSettings => ({
  id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-05', timezone: 'UTC',
  checkInDays: ['2026-06-30', '2026-07-01', '2026-07-02'], accommodationLocked: false, churchLoginLocked: false,
  zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false, checkinSwitchoverTime: '14:00',
  checkinPhaseOverride: 'auto', campMode: 'at-camp', lastExportedAt: NOW, createdAt: NOW, updatedAt: NOW, ...over,
} as CampSettings);
const person = (id: string, over: Partial<Person> = {}): Person => ({
  id, firstName: 'A', lastName: id, gender: 'male', kind: 'youth', churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
  medicalConditions: [], dietaryRequirements: [],
  consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
  paymentStatus: 'unpaid', needsReview: false, lifecycle: 'arrived', atCamp: true,
  checkInHistory: [], signOutHistory: [], createdAt: NOW, updatedAt: NOW, ...over,
});

afterEach(() => vi.useRealTimers());

/** Cache the dashboard, run `act`, and report whether the next /home was rebuilt (a new object)
 *  rather than served from the cache (the same object) — i.e. whether `act` flushed it. */
async function flushes(act: (c: Container) => Promise<unknown>): Promise<boolean> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
  const c = await buildMemoryContainer();
  await c.repos.settings.saveSingleton(settings());
  await c.repos.people.saveMany([person('x'), person('r', { lifecycle: 'registered', atCamp: false })]);
  const home = async () => c.services.dashboard.home(admin, (await c.repos.settings.getSingleton())!);
  const before = await home();
  expect(await home()).toBe(before); // served from the cache
  await act(c);
  return (await home()) !== before;
}

const ev = { leaderName: 'L', authorId: 'a1', timestamp: NOW };
const tap = { sessionId: '2026-07-01~pm', sessionLabel: 'Wed PM', leaderId: 'AB', timestamp: NOW };

describe('dashboard cache seam (D3)', () => {
  it('check-in and sign-in/out taps never flush it (IMPACT-SUMMARY conflict (c))', async () => {
    expect(await flushes((c) => c.services.person.checkIn(admin, 'x', { ...tap, type: 'in' }))).toBe(false);
    expect(await flushes((c) => c.services.person.signEvent(admin, 'x', { type: 'out', ...ev }))).toBe(false);
    expect(await flushes((c) => c.services.person.signEvent(admin, 'r', { type: 'in', ...ev }))).toBe(false);
  });

  it('every other write path flushes it through the wrapped repos', async () => {
    expect(await flushes((c) => c.services.person.update(admin, 'x', { school: 'Hill' } as Partial<Person>))).toBe(true);
    expect(await flushes((c) => c.services.person.update(admin, 'x', { lifecycle: 'cancelled' } as Partial<Person>))).toBe(true);
    expect(await flushes((c) => c.services.person.create(admin, {
      firstName: 'N', lastName: 'K', gender: 'male', churchId: 'c1', churchName: 'Victory', zone: 'Yellow' } as never))).toBe(true);
    expect(await flushes((c) => c.services.person.remove(admin, 'x'))).toBe(true);
    expect(await flushes((c) => c.services.settings.setMode(admin, 'at-camp'))).toBe(true);
    expect(await flushes((c) => c.services.admin.resetLogs(admin, { force: true, confirmWipe: 'I understand this cannot be undone' } as never))).toBe(true);
    expect(await flushes((c) => c.services.notification.send(admin, { scope: 'camp', title: 'T', body: 'B', priority: 'normal' } as never))).toBe(true);
  });

  it('the offline sheet (transitionMany) flushes', async () => {
    const csv = 'First Name,Last Name,Church,Gender,Grade,Signed In?\nA,r,Victory,male,9,Y';
    expect(await flushes((c) => c.services.offlineSignIn.importSignIns(admin, csv))).toBe(true);
  });

  it('two containers in one process never share cached results', async () => {
    const a = await buildMemoryContainer();
    const b = await buildMemoryContainer();
    for (const c of [a, b]) await c.repos.settings.saveSingleton(settings({ campMode: 'pre-camp' }));
    await a.repos.people.save(person('only-in-a', { lifecycle: 'registered', atCamp: false }));
    const da = await a.services.dashboard.home(admin, settings({ campMode: 'pre-camp' }));
    const db = await b.services.dashboard.home(admin, settings({ campMode: 'pre-camp' }));
    if (da.mode !== 'pre-camp' || db.mode !== 'pre-camp') throw new Error('expected pre-camp');
    expect(da.totalRegistrants).toBe(1);
    expect(db.totalRegistrants).toBe(0);
  });
});

describe('invalidateOnWrite', () => {
  class Repo {
    n = 0;
    async read() { return this.n; }
    async write(v: number) { this.n = v; return v; }
    async fail() { throw new Error('boom'); }
  }

  it('flushes after listed methods only, also when they fail; reads pass through bound', async () => {
    const flush = vi.fn();
    const r = invalidateOnWrite(new Repo(), ['write', 'fail'], flush);
    expect(await r.read()).toBe(0);
    expect(flush).not.toHaveBeenCalled();
    expect(await r.write(5)).toBe(5);
    expect(await r.read()).toBe(5);
    expect(flush).toHaveBeenCalledTimes(1);
    await expect(r.fail()).rejects.toThrow('boom');
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe('makeDashboardCache', () => {
  it('keys by actor (A-8) and invalidate() clears every slot', () => {
    const cache = makeDashboardCache();
    const v = { mode: 'pre-camp' } as never;
    cache.set(admin, v);
    expect(cache.get(admin)).toBe(v);
    expect(cache.get({ ...admin, id: 'a2' })).toBeNull();
    cache.invalidate();
    expect(cache.get(admin)).toBeNull();
  });
});
