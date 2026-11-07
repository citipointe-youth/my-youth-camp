import ExcelJS from 'exceljs';
import type { IPersonRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Person, SignOutEvent } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { canAccessPerson } from './person.service';
import { parseCsv } from '../utils/csv';
import { transition, writeOf } from './presence';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { BadRequestError } from '../core/errors/app-error';
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
   * they would get a real "in" event appended to `signOutHistory` (the pre-P1 sign-event helper always appended the event even though it refused to
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
export function makeOfflineSignInService(personRepo: IPersonRepository, settings: ISettingsRepository): OfflineSignInService {
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
      assertCan(actor, 'import:run');
      // A-3 (Q6 + IA OQ-3): a bulk Y-sheet before camp is always a false record, so unlike the
      // single-tap signEvent this refuses every role, director and admin included.
      const campMode = (await settings.getSingleton())?.campMode ?? null;
      if (campMode === 'pre-camp') {
        throw new BadRequestError('Camp has not started yet, so nobody can be signed in. Switch the app to At-Camp mode first, then import again.');
      }
      const rows = parseCsv(csvData);
      const people = await personRepo.findAll();
      const students = people.filter((p) => p.kind !== 'leader');

      // B-4: a name key can hold several people (same-name twins), so keep them all.
      const index = new Map<string, Person[]>();
      for (const p of students) {
        const key = `${norm(p.churchName)}|${norm(p.firstName)}|${norm(p.lastName)}`;
        index.set(key, [...(index.get(key) ?? []), p]);
      }

      const now = nowISO();
      const toSignIn: string[] = [];
      const queued = new Set<string>(); // B-4: a repeated row must not log a second 'in' event
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

        // Out of scope reads exactly like no match, so the sheet can't confirm who exists elsewhere.
        // canAccessPerson keeps first aid camp-wide, as designed (QA item 10, 2026-11-03).
        const matches = (index.get(`${norm(church)}|${norm(firstName)}|${norm(lastName)}`) ?? []).filter((m) => canAccessPerson(actor, m));
        if (matches.length === 0) {
          unmatched.push(`${firstName} ${lastName} (${church})`);
          continue;
        }
        // B-4 (IA OQ-5): cancelled people never sign in, so they can't make a live match ambiguous.
        // Two or more live matches can't be told apart (the sheet has no id), so sign in neither.
        const live = matches.filter((m) => m.lifecycle !== 'cancelled');
        if (live.length > 1) {
          unmatched.push(`${firstName} ${lastName} (${church}) — ${live.length} students share this name, sign in on the app`);
          continue;
        }
        const person = live[0] ?? matches[0]!;
        const event: SignOutEvent = {
          id: newId('so'), type: 'in', leaderName: actor.displayName,
          reason: 'Offline sign-in sheet', authorId: actor.id, timestamp: now,
        };
        const o = transition(person, { kind: 'signIn', event }, { actor, campMode, now });
        // Task 16 fix round 1 — a cancelled person can appear on the template (marked "Cancelled").
        // The module refuses them, so no phantom 'in' row and no inflated `signedIn`.
        if (o.result === 'refused') {
          cancelledSkipped.push(`${firstName} ${lastName} (${church})`);
          continue;
        }
        if (person.atCamp || queued.has(person.id) || o.result === 'noop') {
          alreadySignedIn++;
          continue;
        }
        queued.add(person.id);
        toSignIn.push(person.id);
      }

      // P3: one transaction, rows locked in id order, each decision re-made on the stored row, so
      // a leader's tap that lands between the read above and this write is counted, not doubled.
      let signedIn = 0;
      if (toSignIn.length > 0) {
        await personRepo.transitionMany(toSignIn, (current) => {
          const event: SignOutEvent = { id: newId('so'), type: 'in', leaderName: actor.displayName,
            reason: 'Offline sign-in sheet', authorId: actor.id, timestamp: now };
          const w = writeOf(current, transition(current, { kind: 'signIn', event }, { actor, campMode, now }));
          if (w) signedIn++; else alreadySignedIn++;
          return w;
        });
        invalidateDashboardCache();
      }

      return { signedIn, alreadySignedIn, unmatched, cancelledSkipped };
    },
  };
}
