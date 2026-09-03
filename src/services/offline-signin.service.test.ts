import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { makeOfflineSignInService, type OfflineSignInService } from './offline-signin.service';
import { InMemoryPersonRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import { toCsvString } from '../utils/csv';

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

describe('OfflineSignInService', () => {
  let people: InMemoryPersonRepository;
  let svc: OfflineSignInService;

  beforeEach(async () => {
    people = new InMemoryPersonRepository();
    await people.init();
    svc = makeOfflineSignInService(people);
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
  });
});
