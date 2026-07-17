import ExcelJS from 'exceljs';
import type { IPersonRepository, INoteRepository, IIncidentRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { toCsvString } from '../utils/csv';
import { isCamper } from '../core/entities/person';
import { nowISO } from '../utils/date';

export interface AuditExportService {
  exportMasterWorkbook(actor: Actor): Promise<Buffer>;
  exportSignInOutCsv(actor: Actor): Promise<string>;
  exportCheckInLogCsv(actor: Actor): Promise<string>;
}

/** "Tent"/"Classroom"/blank — mirrors the SPA's accommodation display convention. */
function accommodationDisplay(kind: Person['accommodationKind'] | null | undefined): string {
  if (kind === 'classroom') return 'Classroom';
  if (kind === 'tent') return 'Tent';
  return '';
}

/** Parse a first-aid note's 4-line body into columns (mirrors the SPA's _faParse). */
function parseFirstAidBody(body: string): {
  problem: string; treatment: string; firstAider: string; broughtBy: string;
} {
  const out = { problem: '', treatment: '', firstAider: '', broughtBy: '' };
  for (const line of (body || '').split('\n')) {
    const m = /^(Problem|Treatment|First-aider|Brought by):\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2] ?? '';
    if (k === 'problem') out.problem = v;
    else if (k === 'treatment') out.treatment = v;
    else if (k === 'first-aider') out.firstAider = v;
    else if (k === 'brought by') out.broughtBy = v;
  }
  return out;
}

interface SignLogEvent {
  person: Person;
  type: 'in' | 'out';
  timestamp: string;
  reason: string;
  parentsMet: boolean;
  authorId: string;
  /** Feature 4: the acting leader's initials/name captured at sign-in/out time (SignOutEvent.leaderName). */
  leaderInitials: string;
}

interface SignLogEventWithTotals extends SignLogEvent {
  /** Running count of students (kind:'youth') currently signed in, immediately after this event. */
  studentsSignedIn: number;
  /** Running count of leaders currently signed in, immediately after this event. */
  leadersSignedIn: number;
}

/**
 * The sign-in/out log as ONE chronological timeline across every person (not grouped
 * per-person) — needed so a running "students/leaders currently signed in" total means
 * something as a point-in-time figure. Zero-history registrants ("Registered — Did Not
 * Attend") have no real event/timestamp and are returned separately.
 */
function buildSignInOutTimeline(people: Person[]): { noShows: Person[]; events: SignLogEventWithTotals[] } {
  const noShows = people.filter((p) => p.lifecycle === 'registered' && p.signOutHistory.length === 0);
  const raw: SignLogEvent[] = [];
  for (const p of people) {
    for (const ev of p.signOutHistory) {
      raw.push({
        person: p,
        type: ev.type === 'in' ? 'in' : 'out',
        timestamp: ev.timestamp,
        reason: ev.reason || '',
        parentsMet: !!ev.parentsMet,
        authorId: ev.authorId,
        leaderInitials: ev.leaderName || '',
      });
    }
  }
  raw.sort((a, b) => a.timestamp.localeCompare(b.timestamp)); // ISO 8601 — lexical order === chronological
  let studentsSignedIn = 0;
  let leadersSignedIn = 0;
  const events: SignLogEventWithTotals[] = raw.map((e) => {
    const delta = e.type === 'in' ? 1 : -1;
    if (e.person.kind === 'leader') leadersSignedIn += delta;
    else studentsSignedIn += delta;
    return { ...e, studentsSignedIn, leadersSignedIn };
  });
  return { noShows, events };
}

function toLocalTs(isoTs: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date(isoTs));
  } catch {
    return isoTs;
  }
}

export function makeAuditExportService(
  personRepo: IPersonRepository,
  noteRepo: INoteRepository,
  incidentRepo: IIncidentRepository,
  settingsRepo: ISettingsRepository,
): AuditExportService {
  async function getAllData() {
    const settings = await settingsRepo.getSingleton();
    const tz = settings?.timezone || 'Australia/Brisbane';
    const people = await personRepo.findAll();
    const notes = await noteRepo.findAll();
    return { settings, tz, people, notes };
  }

  return {
    async exportMasterWorkbook(actor) {
      assertCan(actor, 'camper:read:sensitive');

      const { settings, tz, people, notes } = await getAllData();
      const wb = new ExcelJS.Workbook();

      // ----- Summary -----
      const summary = wb.addWorksheet('Summary');
      summary.addRow(['Youth Camp Audit Export']);
      summary.getRow(1).font = { bold: true, size: 14 };
      summary.addRow(['Camp', settings?.campName || '']);
      summary.addRow(['Year', settings?.year || '']);
      summary.addRow(['Exported at', toLocalTs(nowISO(), tz)]);
      summary.addRow(['Exported by', actor.displayName]);
      summary.columns = [{ width: 20 }, { width: 40 }];

      // ----- Attendees -----
      const attendees = wb.addWorksheet('Attendees');
      attendees.addRow(['First Name', 'Last Name', 'Kind', 'Church', 'Zone', 'Grade', 'Gender', 'Accommodation', 'Lifecycle', 'At Camp']);
      attendees.getRow(1).font = { bold: true };
      for (const p of people) {
        if (!isCamper(p)) continue;
        attendees.addRow([
          p.firstName, p.lastName,
          p.kind === 'leader' ? 'Leader' : 'Student',
          p.churchName, p.zone,
          p.grade ?? '',
          p.gender,
          accommodationDisplay(p.accommodationKind),
          p.lifecycle,
          p.atCamp ? 'Yes' : 'No',
        ]);
      }

      // ----- Sign-in/Sign-out Log (compliance centrepiece) -----
      // NB: worksheet names cannot contain any of * ? : \ / [ ] — a '/' here made
      // ExcelJS throw on addWorksheet, so the whole download 500'd. Use ' & ' instead.
      const signLog = wb.addWorksheet('Sign-in & Sign-out Log');
      signLog.addRow([
        'Student', 'Church', 'Zone', 'Gender', 'Grade',
        'Event Type', 'Timestamp (local)', 'Reason', 'Parents Met', 'Authorised By',
        'Leader Initials', 'Total Students Signed In', 'Total Leaders Signed In',
      ]);
      signLog.getRow(1).font = { bold: true };

      // Zero-history registrants first ("Registered — Did Not Attend") — no real event, so
      // no running-total figure. Then one true chronological timeline of every sign-in/out
      // event across every person (students AND leaders), each row carrying the running
      // "currently signed in" totals immediately after that event — the figures update as
      // soon as an event is logged, including leader events (bulk-signed-in at mode switch).
      const { noShows, events } = buildSignInOutTimeline(people);
      for (const p of noShows) {
        signLog.addRow([
          `${p.firstName} ${p.lastName}`, p.churchName, p.zone, p.gender, p.grade ?? '',
          'Registered — Did Not Attend', '', '', '', '', '', '',
        ]);
      }
      for (const e of events) {
        signLog.addRow([
          `${e.person.firstName} ${e.person.lastName}`, e.person.churchName, e.person.zone, e.person.gender, e.person.grade ?? '',
          e.type === 'in' ? 'Sign-in (returned)' : 'Sign-out',
          toLocalTs(e.timestamp, tz),
          e.reason,
          e.parentsMet ? 'Yes' : '',
          e.authorId,
          e.leaderInitials,
          e.studentsSignedIn,
          e.leadersSignedIn,
        ]);
      }

      // ----- Daily Check-in Log -----
      // The 'Leader (Initials)' column carries CheckInEntry.leaderId, which Feature 4 populates
      // with the acting leader's initials (church-account session), falling back to the account id.
      const checkinLog = wb.addWorksheet('Daily Check-in Log');
      checkinLog.addRow(['Student', 'Church', 'Zone', 'Session', 'Type', 'Timestamp (local)', 'Leader (Initials)']);
      checkinLog.getRow(1).font = { bold: true };
      for (const p of people) {
        for (const ci of p.checkInHistory) {
          checkinLog.addRow([
            `${p.firstName} ${p.lastName}`, p.churchName, p.zone,
            ci.sessionLabel, ci.type === 'in' ? 'Check-in' : 'Check-out',
            toLocalTs(ci.timestamp, tz),
            ci.leaderId,
          ]);
        }
      }

      const personMap = new Map(people.map((p) => [p.id, p]));

      // ----- Notes & Testimonies (first-aid records get their own sheet below) -----
      const notesSheet = wb.addWorksheet('Notes & Testimonies');
      notesSheet.addRow(['Student', 'Church', 'Zone', 'Grade', 'Gender', 'Category', 'Note', 'Session', 'Created At']);
      notesSheet.getRow(1).font = { bold: true };
      for (const note of notes) {
        if (note.category === 'firstaid') continue; // → dedicated First-Aid Records sheet
        const p = note.camperId ? personMap.get(note.camperId) : undefined;
        notesSheet.addRow([
          p ? `${p.firstName} ${p.lastName}` : 'No specific student',
          p?.churchName || '',
          p?.zone || '',
          p?.grade ?? '',
          p?.gender || '',
          note.category || 'note',
          note.body,
          note.sessionId || '',
          toLocalTs(note.createdAt, tz),
        ]);
      }

      // ----- First-Aid Records (parsed 4-line body: Problem / Treatment / First-aider / Brought by) -----
      const faSheet = wb.addWorksheet('First-Aid Records');
      faSheet.addRow(['Student', 'Church', 'Zone', 'Grade', 'Gender', 'Problem', 'Treatment', 'First-aider', 'Brought by', 'Logged At']);
      faSheet.getRow(1).font = { bold: true };
      faSheet.columns = [
        { width: 22 }, { width: 20 }, { width: 10 }, { width: 8 }, { width: 10 }, { width: 30 },
        { width: 30 }, { width: 18 }, { width: 18 }, { width: 20 },
      ];
      for (const note of notes) {
        if (note.category !== 'firstaid') continue;
        const p = note.camperId ? personMap.get(note.camperId) : undefined;
        const fa = parseFirstAidBody(note.body);
        faSheet.addRow([
          p ? `${p.firstName} ${p.lastName}` : 'No specific student',
          p?.churchName || '',
          p?.zone || '',
          p?.grade ?? '',
          p?.gender || '',
          fa.problem, fa.treatment, fa.firstAider, fa.broughtBy,
          toLocalTs(note.createdAt, tz),
        ]);
      }

      // ----- Incidents (Feature 3) — summary is decrypted by the repo mapper on read -----
      const incidents = await incidentRepo.findRecent();
      const incidentsSheet = wb.addWorksheet('Incidents');
      incidentsSheet.addRow(['Summary', 'Severity', 'Logged by', 'Logged at', 'Zone']);
      incidentsSheet.getRow(1).font = { bold: true };
      incidentsSheet.columns = [
        { width: 50 }, { width: 12 }, { width: 24 }, { width: 20 }, { width: 12 },
      ];
      for (const inc of incidents) {
        incidentsSheet.addRow([
          inc.summary,
          inc.severity === 'high' ? 'High' : 'Low',
          `${inc.createdByName} (${inc.createdByRole})`,
          toLocalTs(inc.createdAt, tz),
          inc.zone ?? '',
        ]);
      }

      // ----- Passwords tab (if lastTempPasswords is set) -----
      const temps = settings?.lastTempPasswords;
      if (temps && temps.length > 0) {
        const pwSheet = wb.addWorksheet('Temp Passwords');
        pwSheet.addRow(['Username', 'Temp Password']);
        pwSheet.getRow(1).font = { bold: true };
        for (const t of temps) {
          pwSheet.addRow([t.username, t.tempPassword]);
        }
        // Clear lastTempPasswords after including in export
        await settingsRepo.saveSingleton({
          ...settings!,
          lastTempPasswords: null,
          updatedAt: nowISO(),
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      return Buffer.from(buffer);
    },

    async exportSignInOutCsv(actor) {
      assertCan(actor, 'camper:read');
      const { tz, people } = await getAllData();
      const rows: string[][] = [];
      const { noShows, events } = buildSignInOutTimeline(people);
      for (const p of noShows) {
        rows.push([
          p.firstName, p.lastName, p.churchName, p.zone, p.gender, String(p.grade ?? ''),
          'Registered — Did Not Attend', '', '', '', '', '', '', '',
        ]);
      }
      for (const e of events) {
        rows.push([
          e.person.firstName, e.person.lastName, e.person.churchName, e.person.zone, e.person.gender, String(e.person.grade ?? ''),
          e.type === 'in' ? 'Sign-in (returned)' : 'Sign-out',
          toLocalTs(e.timestamp, tz),
          e.reason,
          e.parentsMet ? 'Yes' : '',
          e.authorId,
          e.leaderInitials,
          String(e.studentsSignedIn),
          String(e.leadersSignedIn),
        ]);
      }
      return toCsvString(
        ['First Name', 'Last Name', 'Church', 'Zone', 'Gender', 'Grade',
          'Event Type', 'Timestamp (local)', 'Reason', 'Parents Met', 'Authorised By',
          'Leader Initials', 'Total Students Signed In', 'Total Leaders Signed In'],
        rows,
      );
    },

    async exportCheckInLogCsv(actor) {
      assertCan(actor, 'camper:read');
      const { tz, people } = await getAllData();
      const rows: string[][] = [];
      for (const p of people) {
        for (const ci of p.checkInHistory) {
          rows.push([
            p.firstName, p.lastName, p.churchName, p.zone,
            ci.sessionLabel, ci.type === 'in' ? 'Check-in' : 'Check-out',
            toLocalTs(ci.timestamp, tz), ci.leaderId,
          ]);
        }
      }
      return toCsvString(
        ['First Name', 'Last Name', 'Church', 'Zone', 'Session', 'Type', 'Timestamp (local)', 'Leader (Initials)'],
        rows,
      );
    },
  };
}
