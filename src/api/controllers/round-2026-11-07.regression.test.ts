/**
 * Camp arch round 2026-11-07, regression lane `presence`: controller-side pins (A-Q8 leaderName,
 * OQ-7 /checkin initials, Q9 server time, A-2 OQ-25 partial export). Controllers run over a real
 * in-memory container (Q13 c: Supabase not run).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeAttendanceController } from './attendance.controller';
import { makeCheckInController } from './checkin.controller';
import { makeAuditController } from './audit.controller';
import { buildMemoryContainer, type Container } from '../../container';
import type { CheckInService } from '../../services/checkin.service';
import type { HttpRequest } from '../http/types';
import { SETTINGS_ID, type CampSettings } from '../../core/entities/settings';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';

const NOW = '2026-01-01T00:00:00.000Z';
const admin: Actor = { id: 'a1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Alice Admin' };
const req = (body: unknown, actor: Actor = admin): HttpRequest => ({ ctx: { actor, token: 't' }, params: {}, query: {}, body });

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

async function setup(people: Person[] = []): Promise<Container> {
  const c = await buildMemoryContainer();
  await c.repos.settings.saveSingleton(settings());
  for (const p of people) await c.repos.people.save(p);
  return c;
}
const get = async (c: Container, id: string) => (await c.repos.people.findById(id))!;

afterEach(() => vi.useRealTimers());

describe('A-Q8 leaderName on /attendance (ORCH override of OQ-18)', () => {
  for (const [name, v] of [['missing', undefined], ['blank', ''], ['whitespace', '  '], ['non-string', 42], ['61 chars', 'x'.repeat(61)]] as const) {
    it(`[A-Q8][OQ-18][Q8] ${name} leaderName: sign-in and sign-out are 400, nothing written, no displayName fallback`, async () => {
      const c = await setup([person('r'), person('a', { lifecycle: 'arrived', atCamp: true })]);
      const ctrl = makeAttendanceController({ person: c.services.person });
      const body = (id: string) => (v === undefined ? { camperId: id } : { camperId: id, leaderName: v });
      await expect(ctrl.signIn(req(body('r')))).rejects.toMatchObject({ statusCode: 400 });
      await expect(ctrl.signOut(req(body('a')))).rejects.toMatchObject({ statusCode: 400 });
      expect(await get(c, 'r')).toMatchObject({ atCamp: false, signOutHistory: [] });
      expect(await get(c, 'a')).toMatchObject({ atCamp: true, signOutHistory: [] });
    });
  }

  it('[A-Q8][OQ-18][Q8] blank message is "Leader name is required"; a valid name is stored trimmed as given', async () => {
    const c = await setup([person('r')]);
    const ctrl = makeAttendanceController({ person: c.services.person });
    await expect(ctrl.signIn(req({ camperId: 'r', leaderName: ' ' }))).rejects.toMatchObject({ message: 'Leader name is required' });
    await ctrl.signIn(req({ camperId: 'r', leaderName: `  ${'J'.repeat(60)}  ` }));
    expect((await get(c, 'r')).signOutHistory).toEqual([expect.objectContaining({ type: 'in', leaderName: 'J'.repeat(60), authorId: 'a1' })]);
  });
});

describe('OQ-7 /checkin initials and Q9 server time', () => {
  function checkInCtrl(c: Container) {
    const checkIn = {
      assertSessionAllowed: async () => {},
      getSessions: async () => [{ id: 's1', label: 'Wed AM', day: '2026-07-01', startTime: '08:00', location: null }],
    } as unknown as CheckInService;
    return makeCheckInController({ checkIn, person: c.services.person });
  }

  it('[OQ-7][A-Q8] over-long initials are truncated to 60 and never a 4xx', async () => {
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true })]);
    await expect(checkInCtrl(c).checkIn(req({ camperId: 'a', sessionId: 's1', type: 'in', initials: ` ${'x'.repeat(5000)} ` })))
      .resolves.toEqual({ ok: true });
    expect((await get(c, 'a')).checkInHistory[0]!.leaderId).toBe('x'.repeat(60));
  });

  it('[OQ-7] non-string or blank initials fall back to the account id silently', async () => {
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true })]);
    await checkInCtrl(c).checkIn(req({ camperId: 'a', sessionId: 's1', type: 'in', initials: 7 }));
    await checkInCtrl(c).checkIn(req({ camperId: 'a', sessionId: 's1', type: 'out', initials: '   ' }));
    expect((await get(c, 'a')).checkInHistory.map((e) => e.leaderId)).toEqual(['a1', 'a1']);
  });

  it('[Q9] a (queued) check-in is stamped with server time; a client timestamp in the body is ignored', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T09:30:00.000Z'));
    const c = await setup([person('a', { lifecycle: 'arrived', atCamp: true })]);
    await checkInCtrl(c).checkIn(req({ camperId: 'a', sessionId: 's1', type: 'in', timestamp: '2026-07-01T08:00:00.000Z' }));
    expect((await get(c, 'a')).checkInHistory[0]!.timestamp).toBe('2026-07-01T09:30:00.000Z');
  });
});

describe('A-2 which export counts (IA-OQ-25)', () => {
  it('[A-2][Q7] the sign-in/out CSV does not count as an export after a wipe; the workbook does', async () => {
    const c = await setup();
    const audit = makeAuditController({ auditExport: c.services.auditExport, settings: c.services.settings });
    const FORCE = { force: true, confirmWipe: 'I understand this cannot be undone' };
    await c.services.admin.resetLogs(admin, FORCE);
    await audit.exportSignInOutCsv(req({}));
    expect((await c.repos.settings.getSingleton())!.lastExportedAt).toBeNull();
    await expect(c.services.admin.resetLogs(admin, FORCE)).rejects.toMatchObject({ statusCode: 409 });
    await audit.exportWorkbook(req({}));
    expect((await c.repos.settings.getSingleton())!.lastExportedAt).toBeTruthy();
    await expect(c.services.admin.resetLogs(admin, FORCE)).resolves.toBeTruthy();
  });
});
