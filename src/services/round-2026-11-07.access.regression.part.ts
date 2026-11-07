import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { buildMemoryContainer, type Container } from '../container';
import { makeSettingsService } from './settings.service';
import { makeAuditController } from '../api/controllers/audit.controller';
import { can, assertCan, canAccessPerson, reach, isOversight, type Action } from './access-control';
import { discountTagFor, type BudgetPerson } from './budget';
import { InMemorySettingsRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { HttpRequest } from '../api/http/types';

/*
 * Camp arch round 2026-11-07, regression lane `access` (service level): B-7 settings patches,
 * standing access rulings, A1 policy cells, D4 settings intents, S2 parity pin. In memory only (Q13).
 */

const NOW = '2026-09-01T00:00:00.000Z';
const OLD = '2026-01-01T00:00:00.000Z';
const actor = (role: Actor['role'], over: Partial<Actor> = {}): Actor => ({
  id: 'u-' + role, role, churchId: null, churchName: null, zone: null, displayName: role, ...over,
});
const row = (over: Partial<CampSettings> = {}): CampSettings => ({
  id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-07-01', endDate: '2026-07-05',
  timezone: 'Australia/Brisbane', checkInDays: [], accommodationLocked: false,
  churchLoginLocked: false, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false,
  checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'pre-camp',
  lastExportedAt: OLD, createdAt: OLD, updatedAt: OLD, ...over,
});
const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', firstName: 'Ivy', lastName: 'T', kind: 'youth', churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
  gender: 'female', grade: 10, lifecycle: 'arrived', atCamp: true, medicalConditions: [], dietaryRequirements: [],
  consents: {}, paymentStatus: 'paid', needsReview: false, checkInHistory: [], signOutHistory: [],
  createdAt: NOW, updatedAt: NOW, ...over,
} as unknown as Person);

describe('access regression: B-7 settings writes are field-level patches', () => {
  let repo: InMemorySettingsRepository;
  beforeEach(async () => { repo = new InMemorySettingsRepository(); await repo.saveSingleton(row()); });
  afterEach(() => vi.restoreAllMocks());

  /** The next read returns the current row, then an admin's lock + mode switch lands before the write. */
  function adminRacesNextRead() {
    const real = repo.getSingleton.bind(repo);
    repo.getSingleton = async () => {
      const snap = await real();
      repo.getSingleton = real;
      await repo.patchSingleton({ churchLoginLocked: true, churchSessionsValidFrom: NOW, campMode: 'at-camp' });
      return snap;
    };
  }

  it('[B-7] a concurrent stampImport does not revert campMode or the church lock stamp', async () => {
    adminRacesNextRead();
    await makeSettingsService(repo).stampImport('form', {});
    expect(await repo.getSingleton()).toMatchObject({ campMode: 'at-camp', churchLoginLocked: true, churchSessionsValidFrom: NOW });
    expect((await repo.getSingleton())!.formImportedAt).toBeTruthy();
  });

  it('[B-7] a concurrent audit-workbook export stamp does not revert campMode or the lock', async () => {
    const ctl = makeAuditController({
      auditExport: { exportMasterWorkbook: async () => Buffer.from('x') } as never,
      settings: makeSettingsService(repo),
    });
    adminRacesNextRead();
    await ctl.exportWorkbook({ ctx: { actor: actor('admin') } } as unknown as HttpRequest);
    const s = (await repo.getSingleton())!;
    expect(s).toMatchObject({ campMode: 'at-camp', churchLoginLocked: true, churchSessionsValidFrom: NOW });
    expect(s.lastExportedAt).not.toBe(OLD);
  });

  it('[B-7] a failing stampImport surfaces the error in a warning and does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    repo.patchSingleton = async () => { throw new Error('db down'); };
    await expect(makeSettingsService(repo).stampImport('tickets', {})).resolves.toBeUndefined();
    expect(warn.mock.calls.map(String).join('|')).toContain('db down');
  });
});

describe('access regression: C2 (D4) settings intents go through patchSingleton', () => {
  it('[C2] stampExport / clearTempPasswords each patch only their own column (plus updatedAt)', async () => {
    const repo = new InMemorySettingsRepository();
    await repo.saveSingleton(row({ lastTempPasswords: [{ username: 'a', tempPassword: 'p' }] }));
    const patch = vi.spyOn(repo, 'patchSingleton');
    const svc = makeSettingsService(repo);
    await svc.stampExport();
    await svc.clearTempPasswords();
    expect(patch.mock.calls.map((c) => Object.keys(c[0]).sort())).toEqual([
      ['lastExportedAt', 'updatedAt'], ['lastTempPasswords', 'updatedAt'],
    ]);
  });
});

describe('access regression: standing rulings A1 must keep (C4)', () => {
  let c: Container;
  beforeEach(async () => {
    c = await buildMemoryContainer();
    await c.repos.people.save(person());
  });

  it('[C4] zone leaders see incidents camp-wide (a Yellow leader lists a Blue incident)', async () => {
    await c.services.incident.log(actor('zoneLeader', { zone: 'Blue' }), { summary: 'Blue thing', severity: 'low', zone: 'Blue' });
    const list = await c.services.incident.list(actor('zoneLeader', { zone: 'Yellow' }));
    expect(list.map((i) => i.summary)).toContain('Blue thing');
  });

  it("[C4] church can't read first-aid text (filtered from profile notes; Records feed is 403)", async () => {
    await c.services.note.add(actor('firstAid'), { camperId: 'p1', body: 'FA-SECRET', category: 'firstaid' });
    await c.services.note.add(actor('admin'), { camperId: 'p1', body: 'plain note' });
    const church = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow' });
    const bodies = (await c.services.note.forCamper(church, 'p1')).map((n) => n.body);
    expect(bodies).toContain('plain note');
    expect(bodies).not.toContain('FA-SECRET');
    await expect(c.services.note.recentFirstAid(church)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('[C4][Q4] church may write money fields (refundAmount via PersonService.update)', async () => {
    const church = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow' });
    await c.services.person.update(church, 'p1', { refundAmount: 25 } as Partial<Person>);
    expect((await c.repos.people.findById('p1'))!.refundAmount).toBe(25);
  });
});

describe('access regression: C4 (A1) access-policy key cells', () => {
  const p = person();
  it('[C4] allow: own church and same-zone leader; deny: other zone, other gender half', () => {
    expect(canAccessPerson(actor('church', { churchId: 'c1' }), p)).toBe(true);
    expect(canAccessPerson(actor('zoneLeader', { zone: 'Yellow' }), p)).toBe(true);
    expect(canAccessPerson(actor('zoneLeader', { zone: 'Blue' }), p)).toBe(false);
    expect(canAccessPerson(actor('church', { churchId: 'c1', genderScope: 'male' }), p)).toBe(false);
    expect(canAccessPerson(actor('firstAid'), p)).toBe(true);
  });
  it('[C4] redact: a cross-scope leader gets locate, not full; a registrant is none for church', () => {
    expect(reach(actor('church', { churchId: 'c2' }), p)).toBe('locate');
    expect(reach(actor('church', { churchId: 'c1' }), person({ lifecycle: 'registered' }))).toBe('none');
    expect(reach(actor('prayer'), p)).toBe('full');
  });
  it('[C4] deny is a 403: prayer lacks camper:read:sensitive; isOversight is admin|director only', () => {
    expect(() => assertCan(actor('prayer'), 'camper:read:sensitive')).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(isOversight(actor('director'))).toBe(true);
    expect(isOversight(actor('zoneLeader'))).toBe(false);
  });
});

describe('access regression: C5 (A3) write policy', () => {
  it('[C5] camper:write is gone from every role (IA-OQ-20)', () => {
    for (const role of ['church', 'zoneLeader', 'director', 'admin', 'firstAid', 'prayer'] as const) {
      expect(can(actor(role), 'camper:write' as Action), role).toBe(false);
    }
  });
  it('[C5] PersonService.patch: 403 before 400 for firstAid/prayer; admin gets the 400', async () => {
    const c = await buildMemoryContainer();
    await c.repos.people.save(person({ lifecycle: 'registered', atCamp: false }));
    for (const role of ['firstAid', 'prayer'] as const) {
      await expect(c.services.person.patch(actor(role), 'p1', { refundAmount: -1 })).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(c.services.person.patch(actor('admin'), 'p1', { refundAmount: -1 })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('[C5] PersonService.patch maps the status alias and drops unknown keys', async () => {
    const c = await buildMemoryContainer();
    await c.repos.people.save(person({ lifecycle: 'registered', atCamp: false }));
    await c.services.person.patch(actor('admin'), 'p1', { status: 'cancelled', groupId: 'g' });
    const stored = (await c.repos.people.findById('p1'))! as Person & { groupId?: string };
    expect(stored.lifecycle).toBe('cancelled');
    expect(stored.groupId).toBeUndefined();
  });
});

describe('access regression: C1 (S2) budget parity pin', () => {
  // One parity cell; the full seam is budget.parity.test.ts (42 tests).
  it('[C1][S2] SPA _discountTagFor equals budget.ts discountTagFor', () => {
    const src = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');
    const i = src.indexOf('function _discountTagFor(');
    const ctx: Record<string, unknown> = {};
    vm.createContext(ctx);
    const end = src.slice(i).search(/\r?\n\}\r?\n/); // index.html is CRLF
    vm.runInContext(src.slice(i, i + end) + '\n}', ctx);
    const spa = ctx['_discountTagFor'] as (p: unknown, t: unknown) => unknown;
    const tags = { EFT: 'inperson', SP: 'sponsor', JUNK: 'nope' } as never;
    for (const code of [' EFT ', 'SP', 'JUNK', '', 'NONE']) {
      const p = { discountCode: code } as BudgetPerson;
      expect(spa(p, tags), code).toBe(discountTagFor(p, tags));
    }
  });
});
