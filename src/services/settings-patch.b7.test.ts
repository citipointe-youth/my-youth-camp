import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { makeSettingsService } from './settings.service';
import { makeAuditExportService } from './audit-export.service';
import { makeAuditController } from '../api/controllers/audit.controller';
import {
  InMemorySettingsRepository, InMemoryPersonRepository, InMemoryNoteRepository, InMemoryIncidentRepository,
} from '../repositories/in-memory';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';
import type { HttpRequest } from '../api/http/types';

// ---------------------------------------------------------------------------
// B-7: every settings writer patches only the columns it owns, so a write that lands between
// another writer's read and its save survives. In memory only (Q13 c); the Supabase
// `update … set <given cols>` is checked by reading supabase.settings.ts.
// ---------------------------------------------------------------------------

const admin: Actor = { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' };
const OLD = '2026-01-01T00:00:00.000Z';

function settings(over: Partial<CampSettings> = {}): CampSettings {
  return {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-07-01', endDate: '2026-07-05',
    timezone: 'Australia/Brisbane', checkInDays: [], accommodationLocked: false,
    churchLoginLocked: false, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false,
    checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'pre-camp',
    lastExportedAt: OLD, createdAt: OLD, updatedAt: OLD,
    ...over,
  };
}

let repo: InMemorySettingsRepository;

/** The next getSingleton returns the row as it is now, then `race` lands before the caller saves. */
function raceAfterNextRead(race: () => Promise<unknown>) {
  const real = repo.getSingleton.bind(repo);
  repo.getSingleton = async () => {
    const snap = await real();
    repo.getSingleton = real;
    await race();
    return snap;
  };
}

/** A concurrent admin lock (what settings.update writes for a false->true church lock). */
const lockRace = () => repo.patchSingleton({ churchLoginLocked: true, churchSessionsValidFrom: '2026-11-07T01:00:00.000Z' });

beforeEach(async () => {
  repo = new InMemorySettingsRepository();
  await repo.saveSingleton(settings());
});
afterEach(() => vi.restoreAllMocks());

describe('B-7: settings writers never revert a concurrent change', () => {
  it('M2: an import stamp racing a wipe does not bring back the cleared lastExportedAt', async () => {
    raceAfterNextRead(() => repo.patchSingleton({ lastExportedAt: null })); // a wipe's clearExportStamp
    await makeSettingsService(repo).stampImport('form', {});
    const s = await repo.getSingleton();
    expect(s?.lastExportedAt).toBeNull();
    expect(s?.formImportedAt).toBeTruthy();
  });

  it('an import stamp racing a lock and mode change keeps both', async () => {
    raceAfterNextRead(async () => { await lockRace(); await repo.patchSingleton({ campMode: 'at-camp' }); });
    await makeSettingsService(repo).stampImport('tickets', {});
    const s = await repo.getSingleton();
    expect(s).toMatchObject({ churchLoginLocked: true, churchSessionsValidFrom: '2026-11-07T01:00:00.000Z', campMode: 'at-camp' });
    expect(s?.ticketsImportedAt).toBeTruthy();
  });

  it('a failed import stamp is logged, not thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    repo.patchSingleton = async () => { throw new Error('db down'); };
    await expect(makeSettingsService(repo).stampImport('invoices', {})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0])).toContain('db down');
  });

  it('a lock, revoke or mode change made during a workbook export survives the temp-password clear', async () => {
    await repo.patchSingleton({ lastTempPasswords: [{ username: 'a', tempPassword: 'p' }] });
    const people = new InMemoryPersonRepository(); const notes = new InMemoryNoteRepository();
    const incidents = new InMemoryIncidentRepository();
    await people.init(); await notes.init(); await incidents.init();
    const svc = makeAuditExportService(people, notes, incidents, repo);
    raceAfterNextRead(async () => { await lockRace(); await repo.patchSingleton({ campMode: 'at-camp' }); });
    await svc.exportMasterWorkbook(admin);
    const s = await repo.getSingleton();
    expect(s).toMatchObject({ churchLoginLocked: true, churchSessionsValidFrom: '2026-11-07T01:00:00.000Z', campMode: 'at-camp' });
    expect(s?.lastTempPasswords).toBeNull();
  });

  it('the workbook export stamp racing a lock keeps the lock', async () => {
    const ctl = makeAuditController({
      auditExport: { exportMasterWorkbook: async () => Buffer.from('x') } as never,
      settings: makeSettingsService(repo),
    });
    raceAfterNextRead(lockRace);
    await ctl.exportWorkbook({ ctx: { actor: admin } } as unknown as HttpRequest);
    const s = await repo.getSingleton();
    expect(s?.churchLoginLocked).toBe(true);
    expect(s?.lastExportedAt).not.toBe(OLD);
  });

  it('settings.update does not wipe a stamp written after its read', async () => {
    const svc = makeSettingsService(repo);
    raceAfterNextRead(() => repo.patchSingleton({ formImportedAt: '2026-11-07T02:00:00.000Z', lastExportedAt: null }));
    await svc.update(admin, { campName: 'Renamed' });
    const s = await repo.getSingleton();
    expect(s).toMatchObject({ campName: 'Renamed', formImportedAt: '2026-11-07T02:00:00.000Z', lastExportedAt: null });
  });

  it('setMode and discount tags racing a lock keep the lock', async () => {
    const svc = makeSettingsService(repo);
    raceAfterNextRead(lockRace);
    await svc.setMode(admin, 'at-camp');
    expect(await repo.getSingleton()).toMatchObject({ churchLoginLocked: true, campMode: 'at-camp' });
    await repo.patchSingleton({ churchLoginLocked: false });
    raceAfterNextRead(lockRace);
    await svc.updateDiscountCodeTags(admin, { EFTPOS: 'inperson' });
    expect(await repo.getSingleton()).toMatchObject({ churchLoginLocked: true, discountCodeTags: { EFTPOS: 'inperson' } });
  });
});

describe('in-memory patchSingleton honours its contract', () => {
  it('skips undefined values and never writes id or createdAt', async () => {
    await repo.patchSingleton({ campName: undefined, id: 'other', createdAt: 'x' } as unknown as Partial<CampSettings>);
    const s = await repo.getSingleton();
    expect(s).toMatchObject({ id: SETTINGS_ID, campName: 'Camp', createdAt: OLD });
  });
});
