import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMemoryContainer, type Container } from '../../container';
import { buildRoutes } from './router';
import type { Route, BufferRoute, HttpRequest } from './types';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import type { CampSettings } from '../../core/entities/settings';
import { SETTINGS_ID } from '../../core/entities/settings';

/*
 * Camp arch round 2026-11-07, regression lane `access` (route level). Real memory container +
 * the real route table; handlers are called directly with a ctx (auth is pinned by the table's
 * `auth` flag; the Express 401 path is covered by settings-route.test.ts). In memory only (Q13).
 */

const NOW = '2026-09-01T00:00:00.000Z';
const actor = (role: Actor['role'], over: Partial<Actor> = {}): Actor => ({
  id: 'u-' + role, role, churchId: null, churchName: null, zone: null, displayName: role, ...over,
});
const CHURCH = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow' });

const ivy = {
  id: 'p1', firstName: 'Ivy', lastName: 'Thompson', kind: 'youth', churchId: 'c1', churchName: 'Victory',
  zone: 'Yellow', gender: 'female', grade: 10, lifecycle: 'arrived', atCamp: true,
  medicalConditions: [], dietaryRequirements: [], consents: { medical: { granted: true, timestamp: NOW } },
  paymentStatus: 'paid', needsReview: false, parentPhone: '0499111222',
  parentGuardianName: 'Gina Guardian', mobile: '0477333444', email: 'ivy@example.com',
  registrationType: 'SECRETTIER', registrationCost: 111, discountCode: 'SECRETCODE', discountAmount: 222,
  amountPaidOverride: 333, refundAmount: 444, refundedAt: NOW, blueCardNumber: 'BLUE999', blueCardExpiry: '2030-01-01',
  checkInHistory: [], signOutHistory: [], createdAt: NOW, updatedAt: NOW,
} as unknown as Person;

const settingsRow = (over: Partial<CampSettings> = {}): CampSettings => ({
  id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-05',
  timezone: 'Australia/Perth', checkInDays: ['2026-07-01'], accommodationLocked: false,
  churchLoginLocked: false, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false,
  checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'at-camp',
  lastExportedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
});

let c: Container;
let routes: (Route | BufferRoute)[];
beforeEach(async () => {
  c = await buildMemoryContainer();
  await c.repos.settings.saveSingleton(settingsRow());
  await c.repos.people.save(ivy);
  routes = buildRoutes(c.services);
});

const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path);
async function call(method: string, path: string, a: Actor, extra: Partial<HttpRequest> = {}) {
  const r = find(method, path) as Route | undefined;
  if (!r) throw new Error(`no route ${method} ${path}`);
  return r.handler({ ctx: { actor: a, token: 't' }, params: {}, query: {}, body: {}, ...extra });
}

const STRIPPED = ['amountPaidOverride', 'refundAmount', 'refundedAt', 'registrationType', 'registrationCost',
  'discountCode', 'discountAmount', 'blueCardNumber', 'blueCardExpiry'];
const MONEY = /SECRETCODE|SECRETTIER|BLUE999|2030-01-01|:111|:222|:333|:444/;

type Row = Record<string, unknown>;
const READS: Array<[string, (a: Actor) => Promise<Row>]> = [
  ['GET /campers', async (a) => ((await call('GET', '/campers', a)) as Row[])[0]!],
  ['GET /campers?scope=all', async (a) => ((await call('GET', '/campers', a, { query: { scope: 'all' } })) as Row[])[0]!],
  ['GET /campers/:id', async (a) => (await call('GET', '/campers/:id', a, { params: { id: 'p1' } })) as Row],
  ['GET /search', async (a) => ((await call('GET', '/search', a, { query: { q: 'Ivy' } })) as Array<{ camper: Row }>)[0]!.camper],
];

describe('access regression: money strip on /campers and /search (route level)', () => {
  for (const [name, read] of READS) {
    for (const role of ['firstAid', 'prayer'] as const) {
      it(`[A-6][Q4] ${name}: ${role} gets payment/refund/discount/blue-card nulled, keys kept`, async () => {
        const out = await read(actor(role));
        expect(out['firstName']).toBe('Ivy');
        expect(JSON.stringify(out)).not.toMatch(MONEY);
        for (const k of STRIPPED) { expect(k in out, k).toBe(true); expect(out[k], k).toBeNull(); }
      });
    }
    it(`[A-6][Q4] ${name}: firstAid/prayer registrationType is null (IA-OQ-17)`, async () => {
      expect((await read(actor('prayer')))['registrationType']).toBeNull();
      expect((await read(actor('firstAid')))['registrationType']).toBeNull();
    });
    it(`[A-6][Q4][C4] ${name}: church keeps the money fields (standing: church may write money fields)`, async () => {
      const out = await read(CHURCH);
      expect(out).toMatchObject({ discountCode: 'SECRETCODE', registrationType: 'SECRETTIER', registrationCost: 111,
        refundAmount: 444, blueCardNumber: 'BLUE999' });
    });
  }
});

describe('[T-1] prayer gets the parent number masked on the server (Tom, Step 3 ruling T-1)', () => {
  for (const [name, read] of READS) {
    it(`[T-1] ${name}: prayer gets no parent phone, guardian name, mobile or email; consents stay`, async () => {
      const out = await read(actor('prayer'));
      for (const k of ['parentPhone', 'parentGuardianName', 'mobile', 'email']) expect(out[k] ?? null, k).toBeNull();
      expect(JSON.stringify(out)).not.toMatch(/0499|Gina|0477|ivy@example/);
      expect(out['consentMedical']).toBe(true);
    });
    it(`[T-1] ${name}: firstAid, church and director are unchanged`, async () => {
      expect(await read(actor('firstAid'))).toMatchObject({ parentPhone: '0499****22', parentGuardianName: 'Gina Guardian', mobile: '0477333444' });
      expect(await read(CHURCH)).toMatchObject({ parentPhone: '0499****22', parentGuardianName: 'Gina Guardian', mobile: '0477333444' });
      expect(await read(actor('director'))).toMatchObject({ parentPhone: '0499111222', parentGuardianName: 'Gina Guardian' });
    });
  }
});

describe('[T-1] GET /search/contacts/:camperId', () => {
  const contacts = async (a: Actor) => (await call('GET', '/search/contacts/:camperId', a, { params: { camperId: 'p1' } })) as Row[];
  it('[T-1] prayer gets no parent contact (no guardian name, no phone)', async () => {
    const out = await contacts(actor('prayer'));
    expect(out.find((x) => x['role'] === 'parent')).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/Gina|0499/);
  });
  it('[T-1] firstAid and church keep the masked parent contact', async () => {
    for (const a of [actor('firstAid'), CHURCH]) {
      expect((await contacts(a)).find((x) => x['role'] === 'parent'), a.role).toMatchObject({ name: 'Gina Guardian', phone: '0499****22' });
    }
  });
});

describe('access regression: GET /settings needs a login', () => {
  it('[A-Q11][B-8][Q11] GET /settings is auth:true in the route table (IA-OQ-14, empty pre-login allow-list)', () => {
    expect(find('GET', '/settings')?.auth).toBe(true);
  });
  it('[A-Q11][B-8][Q11] with a token the row still comes back, minus lastTempPasswords', async () => {
    await c.repos.settings.patchSingleton({ lastTempPasswords: [{ username: 'a', tempPassword: 'p' }] });
    const s = (await call('GET', '/settings', actor('admin'))) as Row;
    expect(s['campMode']).toBe('at-camp');
    expect(s['lastTempPasswords']).toBeUndefined();
  });
  it('[DIR-M1] PATCH /settings cannot switch campMode; POST /admin/mode (setMode) is the only writer', async () => {
    await call('PATCH', '/settings', actor('admin'), { body: { campMode: 'pre-camp', campName: 'Renamed' } });
    expect(await c.repos.settings.getSingleton()).toMatchObject({ campMode: 'at-camp', campName: 'Renamed' });
  });
});

describe('access regression: C5 (A3) write policy at the route level', () => {
  it('[C5] PATCH /campers/:id is gone from the route table (IA-OQ-20)', () => {
    expect(find('PATCH', '/campers/:id')).toBeUndefined();
    expect(find('PATCH', '/registrants/:id')).toBeDefined();
  });
  it('[C5] PATCH /registrants/:id: firstAid and prayer get 403 before the 400 for a bad body', async () => {
    for (const role of ['firstAid', 'prayer'] as const) {
      await expect(call('PATCH', '/registrants/:id', actor(role), { params: { id: 'p1' }, body: { accommodationOverride: 'bogus' } }))
        .rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(call('PATCH', '/registrants/:id', actor('admin'), { params: { id: 'p1' }, body: { accommodationOverride: 'bogus' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  it('[C5][C4] PATCH /registrants/:id: church may write its own money field (standing ruling)', async () => {
    await call('PATCH', '/registrants/:id', CHURCH, { params: { id: 'p1' }, body: { refundAmount: 50 } });
    expect((await c.repos.people.findById('p1'))!.refundAmount).toBe(50);
  });
});

describe('access regression: C2 (D4) controllers hold no raw repos', () => {
  it('[C2] Services exposes no raw repo (users, settingsRepo, pushSubscriptionRepo gone)', () => {
    const keys = Object.keys(c.services);
    for (const k of ['users', 'settingsRepo', 'pushSubscriptionRepo']) expect(keys).not.toContain(k);
    expect(keys).toContain('pushSubscriptions');
  });
  it('[C2] no controller source imports a repository module', () => {
    const dir = resolve(__dirname, '../controllers');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.includes('.test.'))) {
      expect(readFileSync(resolve(dir, f), 'utf8'), f).not.toMatch(/from '[^']*repositories[^']*'/);
    }
  });
});

describe('access regression: C1 server half (P4) status carries the clock', () => {
  it('[C1][P4] GET /checkin/sessions/:sessionId/status has a top-level clock with the settings tz', async () => {
    const st = (await call('GET', '/checkin/sessions/:sessionId/status', actor('director'),
      { params: { sessionId: '2026-07-01~am' } })) as { clock: Row; roster: unknown[] };
    expect(st.clock).toMatchObject({ tz: 'Australia/Perth', restricted: false });
    expect(Object.keys(st.clock).sort()).toEqual(['pmFrom', 'restricted', 'tz', 'windows']);
    expect(Array.isArray(st.roster)).toBe(true);
  });
});
