import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { makeOfflineSignInService, type OfflineSignInService } from './offline-signin.service';
import { InMemoryPersonRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import { toCsvString } from '../utils/csv';
import { ForbiddenError } from '../core/errors/app-error';

// ---------------------------------------------------------------------------
// OfflineSignInService — New Feature 1 fallback bulk sign-in from an offline
// spreadsheet. Matches by First+Last+Church text (no id column); only rows
// marked exactly "Y" and not already atCamp actually sign someone in.
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00.000Z';

function admin(): Actor {
  return { id: 'u1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin User' };
}
function church(): Actor {
  return { id: 'u2', role: 'church', churchId: 'c1', churchName: 'Victory Church', zone: 'Yellow', displayName: 'Victory Church' };
}

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory Church',
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function sheet(rows: string[][]): string {
  return toCsvString(['First Name', 'Last Name', 'Church', 'Gender', 'Grade', 'Signed In?'], rows);
}

function settings(over: Partial<CampSettings> = {}): CampSettings {
  return {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-06-30', endDate: '2026-07-05',
    timezone: 'UTC', checkInDays: ['2026-06-30', '2026-07-01', '2026-07-02'],
    accommodationLocked: false, churchLoginLocked: false, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false, checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'at-camp', createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

describe('OfflineSignInService', () => {
  let people: InMemoryPersonRepository;
  let settingsRepo: InMemorySettingsRepository;
  let svc: OfflineSignInService;

  beforeEach(async () => {
    people = new InMemoryPersonRepository();
    await people.init();
    settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.saveSingleton(settings());
    svc = makeOfflineSignInService(people, settingsRepo);
  });

  describe('exportTemplate', () => {
    it('rejects a role without import:run', async () => {
      await expect(svc.exportTemplate(church())).rejects.toThrow();
    });

    it('returns a non-empty xlsx buffer for admin', async () => {
      await people.save(person());
      const buf = await svc.exportTemplate(admin());
      expect(buf.length).toBeGreaterThan(0);
      // xlsx files are zip archives — PK magic bytes.
      expect(buf.subarray(0, 2).toString('utf-8')).toBe('PK');
    });

    // Task 16 fix round 1 — the template stopped filtering cancelled people out (2026-09-03);
    // this pins that they are still present, and marked, rather than silently vanishing.
    it('keeps a cancelled student on the template, marked Cancelled', async () => {
      await people.save(person({ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', lifecycle: 'registered' }));
      await people.save(person({ id: 'p2', firstName: 'Gone', lastName: 'Away', lifecycle: 'cancelled' }));
      const buf = await svc.exportTemplate(admin());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const sheetRows = wb.worksheets[0]!;
      const header = (sheetRows.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
      expect(header).toContain('Cancelled');
      const cancelledIdx = header.indexOf('Cancelled');
      let found = false;
      sheetRows.eachRow((r, rowNum) => {
        if (rowNum <= 2) return; // header + sample row
        const cells = (r.values as unknown[]).map((v) => String(v ?? ''));
        if (cells.includes('Gone')) {
          found = true;
          expect(cells[cancelledIdx]).toBe('Yes');
        }
      });
      expect(found).toBe(true);
    });
  });

  describe('importSignIns', () => {
    // A-3 (ruling Q6): the sheet needs import:run, so only director/admin reach it. Replaces the
    // old church/zone/firstAid scope cases (attendance:write), which are now refused outright.
    describe('permission and pre-camp rule', () => {
      const csv = sheet([['Ada', 'Lovelace', 'Victory Church', 'female', '9', 'Y']]);

      it('church, zone and firstAid are refused (import:run) and nobody is signed in', async () => {
        await people.save(person({ id: 'p1' }));
        const zone: Actor = { id: 'u3', role: 'zoneLeader', churchId: null, churchName: null, zone: 'Yellow', displayName: 'Yellow' };
        const fa: Actor = { id: 'u4', role: 'firstAid', churchId: null, churchName: null, zone: null, displayName: 'First aid' };
        for (const actor of [church(), zone, fa]) {
          await expect(svc.importSignIns(actor, csv)).rejects.toThrow(ForbiddenError);
        }
        expect((await people.findById('p1'))?.atCamp).toBe(false);
      });

      it('is refused in pre-camp for admin and director, and nobody is signed in', async () => {
        await settingsRepo.saveSingleton(settings({ campMode: 'pre-camp' }));
        await people.save(person({ id: 'p1' }));
        const director: Actor = { ...admin(), role: 'director' };
        for (const actor of [admin(), director]) {
          await expect(svc.importSignIns(actor, csv)).rejects.toThrow('Camp has not started yet, so nobody can be signed in.');
        }
        const after = await people.findById('p1');
        expect(after?.atCamp).toBe(false);
        expect(after?.signOutHistory).toEqual([]);
      });

      it('signs in at camp', async () => {
        await people.save(person({ id: 'p1' }));
        expect((await svc.importSignIns(admin(), csv)).signedIn).toBe(1);
      });
    });

    it('signs in a matched student not already at camp', async () => {
      await people.save(person({ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', churchName: 'Victory Church', atCamp: false, lifecycle: 'registered' }));
      const csv = sheet([['Ada', 'Lovelace', 'Victory Church', 'female', '9', 'Y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(1);
      expect(result.alreadySignedIn).toBe(0);
      expect(result.unmatched).toEqual([]);
      const updated = await people.findById('p1');
      expect(updated?.atCamp).toBe(true);
      expect(updated?.lifecycle).toBe('arrived');
      expect(updated?.signOutHistory).toHaveLength(1);
    });

    it('counts but does not re-process someone already at camp', async () => {
      await people.save(person({ id: 'p1', atCamp: true, lifecycle: 'arrived' }));
      const csv = sheet([['Ada', 'Lovelace', 'Victory Church', 'female', '9', 'Y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(0);
      expect(result.alreadySignedIn).toBe(1);
    });

    it('ignores rows not marked exactly Y', async () => {
      await people.save(person({ id: 'p1', atCamp: false }));
      const csv = sheet([
        ['Ada', 'Lovelace', 'Victory Church', 'female', '9', ''],
        ['Ada', 'Lovelace', 'Victory Church', 'female', '9', 'N'],
      ]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(0);
      const updated = await people.findById('p1');
      expect(updated?.atCamp).toBe(false);
    });

    it('reports an unmatched row without throwing', async () => {
      const csv = sheet([['Nobody', 'Real', 'Made Up Church', 'female', '9', 'Y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(0);
      expect(result.unmatched).toEqual(['Nobody Real (Made Up Church)']);
    });

    it('ignores the instructional Sample Student row', async () => {
      const csv = sheet([['Sample', 'Student', 'Anything', '', '', 'Y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(0);
      expect(result.unmatched).toEqual([]);
    });

    it('matches case-insensitively and ignores surrounding whitespace', async () => {
      await people.save(person({ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', churchName: 'Victory Church', atCamp: false }));
      const csv = sheet([[' ada ', ' LOVELACE ', ' victory church ', 'female', '9', 'y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(1);
    });

    it('never matches a leader (students only)', async () => {
      await people.save(person({ id: 'p1', kind: 'leader', atCamp: false }));
      const csv = sheet([['Ada', 'Lovelace', 'Victory Church', 'female', '', 'Y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(0);
      expect(result.unmatched).toEqual(['Ada Lovelace (Victory Church)']);
    });

    // Task 16 fix round 1 — a cancelled person can now appear on the template (marked
    // "Cancelled"), so a "Y" against one is a real, reachable input. Must never sign them in.
    it('never signs in a cancelled person marked Y, and reports it separately', async () => {
      await people.save(person({
        id: 'p1', firstName: 'Gone', lastName: 'Away', lifecycle: 'cancelled', atCamp: false,
      }));
      const csv = sheet([['Gone', 'Away', 'Victory Church', 'female', '9', 'Y']]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(0);
      expect(result.alreadySignedIn).toBe(0);
      expect(result.cancelledSkipped).toEqual(['Gone Away (Victory Church)']);
      const updated = await people.findById('p1');
      // No roster breach (lifecycle/atCamp untouched) AND no phantom audit event.
      expect(updated?.lifecycle).toBe('cancelled');
      expect(updated?.atCamp).toBe(false);
      expect(updated?.signOutHistory).toHaveLength(0);
    });

    it('does not count a cancelled person into signedIn even alongside real sign-ins', async () => {
      await people.save(person({ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', atCamp: false }));
      await people.save(person({
        id: 'p2', firstName: 'Gone', lastName: 'Away', lifecycle: 'cancelled', atCamp: false,
      }));
      const csv = sheet([
        ['Ada', 'Lovelace', 'Victory Church', 'female', '9', 'Y'],
        ['Gone', 'Away', 'Victory Church', 'female', '9', 'Y'],
      ]);

      const result = await svc.importSignIns(admin(), csv);

      expect(result.signedIn).toBe(1);
      expect(result.cancelledSkipped).toEqual(['Gone Away (Victory Church)']);
    });

    // B-4 (IA-OQ-5): the sheet has no id column, so same-name students can't be told apart.
    describe('same-name students and repeated rows', () => {
      const row = ['Ada', 'Lovelace', 'Victory Church', 'female', '9', 'Y'];

      it('two live students with the same name: neither signs in, row reported as ambiguous', async () => {
        await people.save(person({ id: 'twinA' }));
        await people.save(person({ id: 'twinB' }));
        const result = await svc.importSignIns(admin(), sheet([row]));
        expect(result.signedIn).toBe(0);
        expect(result.unmatched).toHaveLength(1);
        expect(result.unmatched[0]).toContain('Ada Lovelace (Victory Church)');
        expect(result.unmatched[0]).toContain('2 students share this name, sign in on the app');
        expect((await people.findById('twinA'))?.atCamp).toBe(false);
        expect((await people.findById('twinB'))?.atCamp).toBe(false);
      });

      it('one live + one cancelled twin: the live one signs in, cancelledSkipped stays empty', async () => {
        await people.save(person({ id: 'live' }));
        await people.save(person({ id: 'gone', lifecycle: 'cancelled' }));
        const result = await svc.importSignIns(admin(), sheet([row]));
        expect(result.signedIn).toBe(1);
        expect(result.cancelledSkipped).toEqual([]);
        expect(result.unmatched).toEqual([]);
        expect((await people.findById('live'))?.atCamp).toBe(true);
        expect((await people.findById('gone'))?.signOutHistory).toEqual([]);
      });

      it('the same row pasted twice signs the student in once', async () => {
        await people.save(person({ id: 'p1' }));
        const result = await svc.importSignIns(admin(), sheet([row, row]));
        expect(result.signedIn).toBe(1);
        expect(result.alreadySignedIn).toBe(1);
        expect((await people.findById('p1'))?.signOutHistory).toHaveLength(1);
      });
    });
  });
});
