import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { makeAuditExportService } from './audit-export.service';
import { makeNoteService } from './note.service';
import {
  InMemoryNoteRepository,
  InMemoryPersonRepository,
  InMemoryIncidentRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';

// ---------------------------------------------------------------------------
// audit-export.service — regression coverage.
//   * Bug 7 (2026-07-02): the 'Sign-in/Sign-out Log' worksheet name contained a
//     '/', which ExcelJS forbids → addWorksheet threw and the whole download 500'd
//     on EVERY call. This proves the workbook now builds end-to-end.
//   * Bug 9 (2026-07-02): first-aid records must land in their own 'First-Aid
//     Records' sheet with the 4-line body parsed into columns, and must NOT also
//     appear in 'Notes & Testimonies'.
// ---------------------------------------------------------------------------

function person(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'cam1', firstName: 'Ada', lastName: 'Lovelace', gender: 'female', kind: 'youth',
    churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
    medicalConditions: [], dietaryRequirements: [],
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid', needsReview: false, lifecycle: 'arrived', atCamp: true,
    checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now, ...over,
  };
}

const actor: Actor = { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' };

let people: InMemoryPersonRepository;
let notes: InMemoryNoteRepository;
let incidents: InMemoryIncidentRepository;
let settings: InMemorySettingsRepository;
let svc: ReturnType<typeof makeAuditExportService>;

beforeEach(async () => {
  people = new InMemoryPersonRepository();
  notes = new InMemoryNoteRepository();
  incidents = new InMemoryIncidentRepository();
  settings = new InMemorySettingsRepository();
  await people.init(); await notes.init(); await incidents.init(); await settings.init();
  await people.save(person());
  const noteSvc = makeNoteService(notes, people);
  await noteSvc.add(actor, {
    camperId: 'cam1', category: 'firstaid',
    body: 'Problem: Sprained ankle\nTreatment: Ice + rest\nFirst-aider: Jo\nBrought by: Sam',
  });
  await noteSvc.add(actor, { camperId: 'cam1', category: 'testimony', body: 'Great week' });
  svc = makeAuditExportService(people, notes, incidents, settings);
});

async function load(): Promise<ExcelJS.Workbook> {
  const buf = await svc.exportMasterWorkbook(actor);
  const wb = new ExcelJS.Workbook();
  // ExcelJS's load() Buffer generic is stricter than Node's Buffer type here; the bytes are fine.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('audit-export: master workbook', () => {
  it('builds without throwing and no sheet name contains an illegal character (bug 7)', async () => {
    const wb = await load();
    const illegal = /[*?:\\/[\]]/;
    for (const ws of wb.worksheets) expect(ws.name).not.toMatch(illegal);
    expect(wb.getWorksheet('Sign-in & Sign-out Log')).toBeTruthy();
  });

  it('has a dedicated First-Aid Records sheet with the body parsed into columns (bug 9)', async () => {
    const wb = await load();
    const fa = wb.getWorksheet('First-Aid Records');
    expect(fa).toBeTruthy();
    const header = (fa!.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    expect(header).toContain('Problem');
    expect(header).toContain('First-aider');
    const row = fa!.getRow(2).values as unknown[];
    const cells = row.map((v) => String(v ?? ''));
    expect(cells).toContain('Sprained ankle');
    expect(cells).toContain('Ice + rest');
    expect(cells).toContain('Jo');
    expect(cells).toContain('Sam');
  });

  it('does NOT duplicate first-aid records into Notes & Testimonies (bug 9)', async () => {
    const wb = await load();
    const ns = wb.getWorksheet('Notes & Testimonies')!;
    const bodies: string[] = [];
    ns.eachRow((r) => bodies.push((r.values as unknown[]).map((v) => String(v ?? '')).join('|')));
    expect(bodies.some((b) => b.includes('Sprained ankle'))).toBe(false); // first-aid excluded
    expect(bodies.some((b) => b.includes('Great week'))).toBe(true); // testimony still present
  });

  it('Attendees carries Grade/Gender/Accommodation; Notes & Testimonies and First-Aid Records carry Grade/Gender', async () => {
    await people.save(person({
      id: 'cam1', grade: 9, gender: 'female', accommodationKind: 'classroom', kind: 'youth',
    }));
    const wb = await load();

    const attendees = wb.getWorksheet('Attendees')!;
    const attHeader = (attendees.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    expect(attHeader).toEqual(
      expect.arrayContaining(['Grade', 'Gender', 'Accommodation']),
    );
    const attRow = (attendees.getRow(2).values as unknown[]).map((v) => String(v ?? ''));
    expect(attRow).toEqual(expect.arrayContaining(['9', 'female', 'Classroom']));

    const notesSheet = wb.getWorksheet('Notes & Testimonies')!;
    const notesHeader = (notesSheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    expect(notesHeader).toEqual(expect.arrayContaining(['Grade', 'Gender']));
    const notesRow = (notesSheet.getRow(2).values as unknown[]).map((v) => String(v ?? ''));
    expect(notesRow).toEqual(expect.arrayContaining(['9', 'female']));

    const fa = wb.getWorksheet('First-Aid Records')!;
    const faHeader = (fa.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    expect(faHeader).toEqual(expect.arrayContaining(['Grade', 'Gender']));
    const faRow = (fa.getRow(2).values as unknown[]).map((v) => String(v ?? ''));
    expect(faRow).toEqual(expect.arrayContaining(['9', 'female']));
  });
});

describe('audit-export: sign-in/out log running totals (chronological across students AND leaders)', () => {
  beforeEach(async () => {
    // Inserted out of chronological order on purpose — the log must re-sort by timestamp,
    // not trust person/array order. T1 < T2 < T3 < T4.
    await people.save(person({
      id: 'youth1', firstName: 'Yolanda', lastName: 'Youth', kind: 'youth', lifecycle: 'arrived', atCamp: false,
      signOutHistory: [
        { id: 'e2', type: 'in', leaderName: 'L', authorId: 'a', timestamp: '2026-07-01T10:00:00.000Z' },
        { id: 'e4', type: 'out', leaderName: 'L', authorId: 'a', timestamp: '2026-07-01T13:00:00.000Z' },
      ],
    }));
    await people.save(person({
      id: 'leader1', firstName: 'Leo', lastName: 'LeaderOne', kind: 'leader', lifecycle: 'arrived', atCamp: true,
      signOutHistory: [
        { id: 'e1', type: 'in', leaderName: 'Admin', authorId: 'a', timestamp: '2026-07-01T09:00:00.000Z' },
      ],
    }));
    await people.save(person({
      id: 'leader2', firstName: 'Lena', lastName: 'LeaderTwo', kind: 'leader', lifecycle: 'arrived', atCamp: true,
      signOutHistory: [
        { id: 'e3', type: 'in', leaderName: 'Admin', authorId: 'a', timestamp: '2026-07-01T11:00:00.000Z' },
      ],
    }));
  });

  it('exportSignInOutCsv: events are one chronological timeline with running per-kind totals', async () => {
    const csv = await svc.exportSignInOutCsv(actor);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'First Name,Last Name,Church,Zone,Gender,Grade,Event Type,Timestamp (local),Reason,Authorised By,Leader Initials,Total Students Signed In,Total Leaders Signed In',
    );
    // 4 real events (cam1 has none — it was only ever noted, not signed).
    // Item 24 (2026-07-28): rows are presented NEWEST FIRST, so the most recent event is row 0
    // and the running totals read downward from the current state. The totals themselves are
    // still computed chronologically, so each row carries the counts as at the moment it
    // happened — only the row ORDER is reversed.
    const dataRows = lines.slice(1);
    expect(dataRows).toHaveLength(4);
    expect(dataRows[0]).toContain('Yolanda'); // T4: youth1 out -> students 0, leaders 2
    expect(dataRows[0]!.endsWith('0,2')).toBe(true);
    expect(dataRows[1]).toContain('Lena'); // T3: leader2 in -> students 1, leaders 2
    expect(dataRows[1]!.endsWith('1,2')).toBe(true);
    expect(dataRows[2]).toContain('Yolanda'); // T2: youth1 in -> students 1, leaders 1
    expect(dataRows[2]!.endsWith('1,1')).toBe(true);
    expect(dataRows[3]).toContain('Leo'); // T1: leader1 in -> students 0, leaders 1
    expect(dataRows[3]!.endsWith('0,1')).toBe(true);
  });

  it('exportMasterWorkbook: Sign-in & Sign-out Log sheet carries the same running totals', async () => {
    const wb = await load();
    const sheet = wb.getWorksheet('Sign-in & Sign-out Log')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    expect(header).toContain('Total Students Signed In');
    expect(header).toContain('Total Leaders Signed In');
    // cam1 (from the outer beforeEach — lifecycle 'arrived', no sign history) contributes
    // no row at all (it's neither a no-show nor an event); the sheet is just the 4 events.
    // Item 24: newest first, so the LAST row is now the OLDEST event (leader1 in -> 0 students,
    // 1 leader) and the FIRST data row carries the live totals.
    const firstData = (sheet.getRow(2).values as unknown[]).map((v) => (v == null ? '' : v));
    expect(firstData.slice(-2)).toEqual([0, 2]); // most recent event (youth1 out)
    const lastRow = sheet.getRow(sheet.rowCount).values as unknown[];
    const lastCells = lastRow.map((v) => (v == null ? '' : v));
    expect(lastCells.slice(-2)).toEqual([0, 1]); // oldest event (leader1 in)
  });
});

describe('audit-export: Feature 4 — leader initials captured in the audit trail', () => {
  it('Sign-in & Sign-out Log surfaces the leader initials (SignOutEvent.leaderName) in a Leader Initials column', async () => {
    await people.save(person({
      id: 'y2', firstName: 'Ivy', lastName: 'Ng', kind: 'youth', lifecycle: 'checked_out', atCamp: false,
      signOutHistory: [
        { id: 's1', type: 'out', leaderName: 'SD', reason: 'picked up', authorId: 'acct-1', timestamp: '2026-07-02T09:00:00.000Z' },
      ],
    }));
    const wb = await load();
    const sheet = wb.getWorksheet('Sign-in & Sign-out Log')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const initialsCol = header.indexOf('Leader Initials');
    expect(initialsCol).toBeGreaterThan(-1);
    // Find Ivy's row and assert the initials cell carries 'SD' (not the account id 'acct-1').
    let found = '';
    sheet.eachRow((r) => {
      const cells = (r.values as unknown[]).map((v) => String(v ?? ''));
      if (cells.includes('Ivy Ng')) found = cells[initialsCol] ?? '';
    });
    expect(found).toBe('SD');
  });

  it('Daily Check-in Log Leader (Initials) column carries CheckInEntry.leaderId (initials)', async () => {
    await people.save(person({
      id: 'y3', firstName: 'Max', lastName: 'Roe', kind: 'youth', lifecycle: 'arrived', atCamp: true,
      checkInHistory: [
        { id: 'ci1', sessionId: '2026-07-02~am', sessionLabel: 'Wed AM', type: 'in', leaderId: 'MR', timestamp: '2026-07-02T08:00:00.000Z' },
      ],
    }));
    const wb = await load();
    const sheet = wb.getWorksheet('Daily Check-in Log')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const leaderCol = header.indexOf('Leader (Initials)');
    expect(leaderCol).toBeGreaterThan(-1);
    let found = '';
    sheet.eachRow((r) => {
      const cells = (r.values as unknown[]).map((v) => String(v ?? ''));
      if (cells.includes('Max Roe')) found = cells[leaderCol] ?? '';
    });
    expect(found).toBe('MR');
  });
});

// Item 24 (2026-07-28) flipped these sheets to NEWEST-FIRST. The property being pinned is
// unchanged — rows are sorted by real timestamp, never by person/array iteration order — only
// the direction differs, so each expectation below is the exact reverse of the 2026-07-23 one.
describe('audit-export: Daily Check-in Log & Notes are sorted by timestamp, newest first (items 6 + 24)', () => {
  beforeEach(async () => {
    // Two people whose check-in entries are deliberately out of order both within a person's
    // own history and interleaved across people — the log must re-sort by timestamp, not trust
    // person/array iteration order.
    await people.save(person({
      id: 'ck1', firstName: 'Zack', lastName: 'Zeta', kind: 'youth', lifecycle: 'arrived', atCamp: true,
      checkInHistory: [
        { id: 'c3', sessionId: '2026-07-02~am', sessionLabel: 'Wed AM', type: 'in', leaderId: 'ZZ', timestamp: '2026-07-02T08:00:00.000Z' },
        { id: 'c1', sessionId: '2026-07-01~pm', sessionLabel: 'Tue PM', type: 'in', leaderId: 'ZZ', timestamp: '2026-07-01T13:00:00.000Z' },
      ],
    }));
    await people.save(person({
      id: 'ck2', firstName: 'Amy', lastName: 'Alpha', kind: 'youth', lifecycle: 'arrived', atCamp: true,
      checkInHistory: [
        { id: 'c4', sessionId: '2026-07-02~pm', sessionLabel: 'Wed PM', type: 'in', leaderId: 'AA', timestamp: '2026-07-02T13:00:00.000Z' },
        { id: 'c2', sessionId: '2026-07-01~pm', sessionLabel: 'Tue PM', type: 'in', leaderId: 'AA', timestamp: '2026-07-01T13:30:00.000Z' },
      ],
    }));
  });

  it('exportMasterWorkbook: Daily Check-in Log rows come out strictly newest-first', async () => {
    const wb = await load();
    const sheet = wb.getWorksheet('Daily Check-in Log')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const studentCol = header.indexOf('Student');
    const students: string[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const cells = (sheet.getRow(r).values as unknown[]).map((v) => String(v ?? ''));
      students.push(cells[studentCol] ?? '');
    }
    // Newest first by raw ISO timestamp:
    // c4 (Amy, 07-02 13:00) > c3 (Zack, 07-02 08:00) > c2 (Amy, 07-01 13:30) > c1 (Zack, 07-01 13:00)
    expect(students).toEqual(['Amy Alpha', 'Zack Zeta', 'Amy Alpha', 'Zack Zeta']);
  });

  it('exportCheckInLogCsv: rows come out strictly newest-first', async () => {
    const csv = await svc.exportCheckInLogCsv(actor);
    const lines = csv.trim().split('\n');
    const dataRows = lines.slice(1);
    const firstNames = dataRows.map((l) => l.split(',')[0]);
    expect(firstNames).toEqual(['Amy', 'Zack', 'Amy', 'Zack']);
  });

  it('Notes & Testimonies sheet rows come out newest-createdAt first', async () => {
    // The outer beforeEach already added a firstaid note then a testimony (in that call order,
    // so createdAt is non-decreasing) for cam1 — add an earlier-dated testimony for ck1 to force
    // a real reorder relative to insertion order.
    const noteSvc = makeNoteService(notes, people);
    await noteSvc.add(actor, { camperId: 'ck1', category: 'testimony', body: 'Recent testimony' });
    const all = await notes.findAll();
    const recent = all.find((n) => n.body === 'Recent testimony')!;
    const earlier = all.find((n) => n.body === 'Great week')!;
    // Force 'Recent testimony' to have an earlier createdAt than 'Great week' despite being
    // added later, so a correct sort (not insertion order) is the only way to pass.
    await notes.save({ ...recent, createdAt: '2020-01-01T00:00:00.000Z' });
    await notes.save({ ...earlier, createdAt: '2025-01-01T00:00:00.000Z' });

    const wb = await load();
    const ns = wb.getWorksheet('Notes & Testimonies')!;
    const bodies: string[] = [];
    for (let r = 2; r <= ns.rowCount; r++) {
      bodies.push((ns.getRow(r).values as unknown[]).map((v) => String(v ?? '')).join('|'));
    }
    const recentIdx = bodies.findIndex((b) => b.includes('Recent testimony'));
    const greatIdx = bodies.findIndex((b) => b.includes('Great week'));
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(greatIdx).toBeGreaterThanOrEqual(0);
    // 'Recent testimony' was forced to 2020 and 'Great week' to 2025, so newest-first puts
    // 'Great week' ABOVE it — the sort is by createdAt, never by insertion order.
    expect(greatIdx).toBeLessThan(recentIdx);
  });
});

describe('audit-export.service — compliance-export RBAC (review Finding A)', () => {
  function roleActor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
    return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
  }

  it('church and zoneLeader CANNOT export the camp-wide compliance data', async () => {
    for (const role of ['church', 'zoneLeader'] as const) {
      const a = roleActor(role, role === 'church' ? { churchId: 'c1' } : { zone: 'Yellow' });
      await expect(svc.exportMasterWorkbook(a)).rejects.toThrow();
      await expect(svc.exportSignInOutCsv(a)).rejects.toThrow();
      await expect(svc.exportCheckInLogCsv(a)).rejects.toThrow();
    }
  });

  it('director and admin CAN export', async () => {
    for (const role of ['director', 'admin'] as const) {
      const a = roleActor(role);
      await expect(svc.exportMasterWorkbook(a)).resolves.toBeInstanceOf(Buffer);
      await expect(svc.exportSignInOutCsv(a)).resolves.toBeTypeOf('string');
      await expect(svc.exportCheckInLogCsv(a)).resolves.toBeTypeOf('string');
    }
  });
});

describe('audit-export: Incidents sheet carries Occurred at (2026-07-30)', () => {
  it('has an Occurred at column beside Logged at, blank when it was never recorded', async () => {
    await incidents.save({
      id: 'inc1', summary: 'with a time', severity: 'high',
      createdById: 'u', createdByName: 'Admin', createdByRole: 'admin', zone: 'Yellow',
      createdAt: '2026-07-30T02:00:00.000Z', occurredAt: '2026-07-29T22:15:00.000Z',
    });
    await incidents.save({
      id: 'inc2', summary: 'without a time', severity: 'low',
      createdById: 'u', createdByName: 'Admin', createdByRole: 'admin', zone: 'Blue',
      createdAt: '2026-07-29T02:00:00.000Z', occurredAt: null,
    });

    const wb = await load();
    const sheet = wb.getWorksheet('Incidents')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    expect(header).toContain('Occurred at');
    // It sits immediately after 'Logged at'.
    expect(header.indexOf('Occurred at')).toBe(header.indexOf('Logged at') + 1);

    const rows: string[][] = [];
    sheet.eachRow((r, i) => { if (i > 1) rows.push((r.values as unknown[]).map((v) => String(v ?? ''))); });
    const withTime = rows.find((r) => r.includes('with a time'))!;
    const withoutTime = rows.find((r) => r.includes('without a time'))!;
    const col = header.indexOf('Occurred at');
    expect(withTime[col]).toBeTruthy();
    expect(withTime[col]).not.toBe(withTime[header.indexOf('Logged at')]); // a distinct time
    expect(withoutTime[col] ?? '').toBe(''); // optional — blank, never a placeholder
  });
});
