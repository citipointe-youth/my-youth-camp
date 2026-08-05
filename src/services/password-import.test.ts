import { describe, it, expect } from 'vitest';
import {
  parsePasswordRows,
  planPasswordImport,
  missingPasswordColumns,
  PASSWORD_IMPORT_COLUMNS,
  MIN_IMPORT_PASSWORD_LENGTH,
} from './password-import';
import { parseCsv } from '../utils/csv';
import type { User } from '../core/entities/user';

function user(over: Partial<User> & { id: string; username: string }): User {
  return {
    firstName: 'A',
    lastName: 'B',
    role: 'church',
    status: 'active',
    passwordHash: 'x',
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as User;
}

const users = [
  user({ id: 'u1', username: 'b-victory' }),
  user({ id: 'u2', username: 'g-victory' }),
  user({ id: 'u3', username: 'director', role: 'director' }),
  user({ id: 'u4', username: 'oldchurch', status: 'inactive' }),
  user({ id: 'admin1', username: 'admin', role: 'admin' }),
];

describe('parsePasswordRows', () => {
  it('reads Username and Password, keeping the original row number', () => {
    const out = parsePasswordRows([
      { Username: 'b-victory', Password: 'Donkey.683' },
      { Username: 'g-victory', Password: 'Kettle.221' },
    ]);
    expect(out).toEqual([
      { username: 'b-victory', password: 'Donkey.683', rowNum: 2 },
      { username: 'g-victory', password: 'Kettle.221', rowNum: 3 },
    ]);
  });

  it('lowercases the username and trims both fields', () => {
    const out = parsePasswordRows([{ Username: '  B-Victory ', Password: ' Donkey.683 ' }]);
    expect(out[0]).toMatchObject({ username: 'b-victory', password: 'Donkey.683' });
  });

  it('resolves headers whose case and spacing drifted', () => {
    const out = parsePasswordRows([{ 'user name': 'b-victory', PASSWORD: 'Donkey.683' }]);
    expect(out[0]).toMatchObject({ username: 'b-victory', password: 'Donkey.683' });
  });

  it('ignores the extra export columns and entirely blank rows', () => {
    const out = parsePasswordRows([
      { Username: 'b-victory', 'Church / Role': 'Victory', Gender: 'Boys', Role: 'Church', Password: 'Donkey.683' },
      { Username: '', 'Church / Role': '', Gender: '', Role: '', Password: '' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ username: 'b-victory', password: 'Donkey.683' });
  });

  it('keeps a row whose password is blank but whose username is not', () => {
    // Load-bearing: the planner must SEE this row to count it as skipped-blank.
    const out = parsePasswordRows([{ Username: 'b-victory', Password: '' }]);
    expect(out).toEqual([{ username: 'b-victory', password: '', rowNum: 2 }]);
  });
});

describe('planPasswordImport', () => {
  it('plans a password for each matched username', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'Donkey.683' },
        { Username: 'director', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply).toEqual([
      { userId: 'u1', username: 'b-victory', password: 'Donkey.683', inactive: false },
      { userId: 'u3', username: 'director', password: 'Kettle.221', inactive: false },
    ]);
    expect(plan.blank).toBe(0);
    expect(plan.unmatched).toEqual([]);
  });

  it('leaves every account absent from the file completely alone', () => {
    // "only a subset of churches" — the whole point.
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'b-victory', Password: 'Donkey.683' }]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['b-victory']);
  });

  it('SKIPS a blank password and never clears the existing one', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: '' },
        { Username: 'g-victory', Password: '   ' },
        { Username: 'director', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['director']);
    expect(plan.blank).toBe(2);
    expect(plan.unmatched).toEqual([]);
  });

  it('reports an unknown username instead of guessing', () => {
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'b-nowhere', Password: 'Donkey.683' }]),
      users,
      'admin1',
    );
    expect(plan.apply).toEqual([]);
    expect(plan.unmatched).toEqual(['b-nowhere']);
  });

  it('refuses the original admin and names it', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'admin', Password: 'Donkey.683' },
        { Username: 'b-victory', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['b-victory']);
    expect(plan.protectedSkipped).toEqual(['admin']);
  });

  it('APPLIES to an inactive account but flags it', () => {
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'oldchurch', Password: 'Donkey.683' }]),
      users,
      'admin1',
    );
    expect(plan.apply).toEqual([
      { userId: 'u4', username: 'oldchurch', password: 'Donkey.683', inactive: true },
    ]);
    expect(plan.inactive).toEqual(['oldchurch']);
  });

  it('rejects a too-short password and still applies every other row', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'ab1' },
        { Username: 'g-victory', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['g-victory']);
    expect(plan.invalid).toEqual([
      { username: 'b-victory', reason: `shorter than ${MIN_IMPORT_PASSWORD_LENGTH} characters` },
    ]);
  });

  it('rejects BOTH halves of a username listed twice with different passwords', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'Donkey.683' },
        { Username: 'B-Victory', Password: 'Kettle.221' },
        { Username: 'g-victory', Password: 'Saucer.404' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['g-victory']);
    expect(plan.duplicates).toEqual(['b-victory']);
  });

  it('accepts a username listed twice with the SAME password, applying it once', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'Donkey.683' },
        { Username: 'b-victory', Password: 'Donkey.683' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['b-victory']);
    expect(plan.duplicates).toEqual([]);
  });

  it('tolerates a null original admin id (no admin resolvable)', () => {
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'admin', Password: 'Donkey.683' }]),
      users,
      null,
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['admin']);
    expect(plan.protectedSkipped).toEqual([]);
  });

  it('exports the columns the importer requires', () => {
    expect(PASSWORD_IMPORT_COLUMNS).toEqual(['Username', 'Password']);
  });
});

/**
 * ⚠️ THE ROUND TRIP — the one test that proves this feature does what it claims.
 *
 * Every test above hand-builds its rows, so they check the RULES but not the FORMAT. The real
 * input is whatever `randomizeChurchPasswords`' CSV writer emits, and that writer emits three
 * things a naive parser trips on: a **leading UTF-8 BOM** (added deliberately in 2026-08-04 so
 * Excel stops rendering em dashes as `â€"`), **CRLF** line endings, and **quoted fields** for
 * any church name containing a comma. Get any of those wrong and the first header parses as
 * `﻿Username`, `field()` finds nothing, and every row reads as blank — which this
 * importer would report as a clean, successful, entirely-empty run.
 *
 * So this rebuilds the exporter's output byte-for-byte and feeds it back in. If someone changes
 * either side's column names or quoting, this fails instead of the feature silently no-opping.
 */
describe('round trip from the real credentials export', () => {
  const q = (v: string) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  /** Byte-identical to the SPA's `randomizeChurchPasswords` writer: BOM + CRLF + same headers. */
  const exportCsv = (rows: string[][]) =>
    '﻿' +
    [['Username', 'Church / Role', 'Gender', 'Role', 'Password'], ...rows]
      .map((r) => r.map(q).join(','))
      .join('\r\n');

  it('parses the exporter’s own output and sets every listed password', () => {
    const csv = exportCsv([
      ['b-victory', 'Victory Church', 'Boys', 'Church', 'Donkey.683'],
      // A church name containing a comma — quoted by the exporter, and the reason the parser
      // cannot be a naive split(',').
      ['g-victory', 'Victory Church, Southside', 'Girls', 'Church', 'Kettle.221'],
      ['director', 'Director', '', 'Director', 'Saucer.404'],
    ]);
    const plan = planPasswordImport(parsePasswordRows(parseCsv(csv)), users, 'admin1');

    expect(plan.apply).toEqual([
      { userId: 'u1', username: 'b-victory', password: 'Donkey.683', inactive: false },
      { userId: 'u2', username: 'g-victory', password: 'Kettle.221', inactive: false },
      { userId: 'u3', username: 'director', password: 'Saucer.404', inactive: false },
    ]);
    expect(plan.unmatched).toEqual([]);
    expect(plan.blank).toBe(0);
  });

  it('finds both required columns in the exporter’s header despite the BOM', () => {
    const csv = exportCsv([['b-victory', 'Victory Church', 'Boys', 'Church', 'Donkey.683']]);
    expect(missingPasswordColumns(parseCsv(csv))).toEqual([]);
  });

  it('treats a straight re-upload of an UNEDITED export as a no-op', () => {
    // The export ships real passwords in the Password column, so re-uploading it untouched
    // re-sets what is already set — harmless. But an admin who cleared the column expects
    // NOTHING to happen, and that is the case worth pinning.
    const csv = exportCsv([
      ['b-victory', 'Victory Church', 'Boys', 'Church', ''],
      ['g-victory', 'Victory Church', 'Girls', 'Church', ''],
    ]);
    const plan = planPasswordImport(parsePasswordRows(parseCsv(csv)), users, 'admin1');
    expect(plan.apply).toEqual([]);
    expect(plan.blank).toBe(2);
    expect(plan.unmatched).toEqual([]);
  });
});
