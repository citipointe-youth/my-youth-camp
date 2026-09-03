import ExcelJS from 'exceljs';
import type { IPersonRepository } from '../repositories/interfaces/entity-repositories';
import type { Person, SignOutEvent } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { parseCsv } from '../utils/csv';
import { withSignEvent } from './person-lifecycle';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { invalidateDashboardCache } from './dashboard-cache';

export interface OfflineSignInResult {
  signedIn: number;
  alreadySignedIn: number;
  /** "First Last (Church)" for rows marked Y that couldn't be matched to a registered student. */
  unmatched: string[];
  /**
   * "First Last (Church)" for rows marked Y that matched a CANCELLED registrant — never signed
   * in. Task 16 fix round 1: once the export template stopped filtering cancelled people out
   * (they now appear, marked "Cancelled"), a leader could tick "Y" against one by mistake. A
   * cancelled person must never be counted into `signedIn` or given a sign-in event: `atCamp`
   * for a cancelled person is `false` (never `true`, see person.service.ts's cancel transition),
   * so the pre-existing `alreadySignedIn` guard never catches them — without this explicit skip
   * they would get a real "in" event appended to `signOutHistory` (person-lifecycle.ts's
   * `withSignEvent` always appends the event even though `applyCheckIn` correctly refuses to
   * change a cancelled person's lifecycle/atCamp), a phantom row in the compliance audit trail
   * for someone who never actually arrived.
   */
  cancelledSkipped: string[];
}

export interface OfflineSignInService {
  exportTemplate(actor: Actor): Promise<Buffer>;
  importSignIns(actor: Actor, csvData: string): Promise<OfflineSignInResult>;
}

// An obviously-fake row demonstrating the expected format — matched by name below so it's
// always ignored on re-import regardless of what a church puts in the Church cell for it.
const SAMPLE_FIRST_NAME = 'Sample';
const SAMPLE_LAST_NAME = 'Student';

function norm(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Item: New Feature 1 — a fallback bulk sign-in path for churches who prefer paper/bulk sign-in
 * over the app. Export a spreadsheet of everyone registered (students only); a church fills in
 * "Y" against names as they arrive; re-importing bulk-signs-in anyone marked Y who isn't already
 * at camp. Matches by First+Last+Church text (no hidden id column — the export is the source of
 * these exact values, so a straight normalized match is expected to work).
 */
export function makeOfflineSignInService(personRepo: IPersonRepository): OfflineSignInService {
  return {
    async exportTemplate(actor) {
      assertCan(actor, 'import:run');
      const people = await personRepo.findAll();
      /* Cancelled people stay IN every export, marked — one consistent rule (they are hidden from
         on-screen ops lists only). An export is the audit trail: someone who withdrew after paying
         is exactly who a reconciliation needs to see. */
      const students = people
        .filter((p) => p.kind !== 'leader')
        .sort((a, b) => a.churchName.localeCompare(b.churchName) || a.lastName.localeCompare(b.lastName));

      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Offline Sign-In');
      sheet.addRow(['First Name', 'Last Name', 'Church', 'Gender', 'Grade', 'Signed In?', 'Cancelled']);
      sheet.getRow(1).font = { bold: true };
      sheet.addRow([SAMPLE_FIRST_NAME, SAMPLE_LAST_NAME, '(example row — leave church/gender/grade blank or edit freely, it is ignored)', '', '', 'Y', '']);
      sheet.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
      for (const p of students) {
        sheet.addRow([p.firstName, p.lastName, p.churchName, p.gender, p.grade ?? '', '', p.lifecycle === 'cancelled' ? 'Yes' : '']);
      }
      sheet.columns = [{ width: 16 }, { width: 16 }, { width: 26 }, { width: 10 }, { width: 8 }, { width: 12 }, { width: 11 }];

      const buffer = await wb.xlsx.writeBuffer();
      return Buffer.from(buffer);
    },

    async importSignIns(actor, csvData) {
      assertCan(actor, 'attendance:write');
      const rows = parseCsv(csvData);
      const people = await personRepo.findAll();
      const students = people.filter((p) => p.kind !== 'leader');

      const index = new Map<string, Person>();
      for (const p of students) {
        index.set(`${norm(p.churchName)}|${norm(p.firstName)}|${norm(p.lastName)}`, p);
      }

      const now = nowISO();
      const toSignIn: Person[] = [];
      let alreadySignedIn = 0;
      const unmatched: string[] = [];
      const cancelledSkipped: string[] = [];

      for (const row of rows) {
        const firstName = (row['First Name'] ?? '').trim();
        const lastName = (row['Last Name'] ?? '').trim();
        const church = (row['Church'] ?? '').trim();
        if (firstName === SAMPLE_FIRST_NAME && lastName === SAMPLE_LAST_NAME) continue; // instructional row
        const signedRaw = (row['Signed In?'] ?? '').trim();
        if (norm(signedRaw) !== 'y') continue; // blank / N / anything but Y is a no-op
        if (!firstName || !lastName || !church) continue;

        const person = index.get(`${norm(church)}|${norm(firstName)}|${norm(lastName)}`);
        if (!person) {
          unmatched.push(`${firstName} ${lastName} (${church})`);
          continue;
        }
        // Task 16 fix round 1 — a cancelled person can now appear on the template (marked
        // "Cancelled"). Never sign them in: no roster breach either way (`applyCheckIn` refuses
        // to change their lifecycle/atCamp), but `withSignEvent` would still append a phantom
        // "in" event to their audit trail and this row would inflate `signedIn`.
        if (person.lifecycle === 'cancelled') {
          cancelledSkipped.push(`${firstName} ${lastName} (${church})`);
          continue;
        }
        if (person.atCamp) {
          alreadySignedIn++;
          continue;
        }
        toSignIn.push(person);
      }

      if (toSignIn.length > 0) {
        const updated = toSignIn.map((p) => {
          const event: SignOutEvent = {
            id: newId('so'),
            type: 'in',
            leaderName: actor.displayName,
            reason: 'Offline sign-in sheet',
            authorId: actor.id,
            timestamp: now,
          };
          return withSignEvent(p, event, now);
        });
        await personRepo.saveMany(updated);
        invalidateDashboardCache();
      }

      return { signedIn: toSignIn.length, alreadySignedIn, unmatched, cancelledSkipped };
    },
  };
}
