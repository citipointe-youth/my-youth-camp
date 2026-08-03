/*
 * Accommodation export harness — verifies `_accomExportRows()` in isolation (2026-08-03).
 *
 * WHY THIS EXISTS. The export is client-side by design (see the block comment on
 * `_accomExportRows` in public/index.html), so vitest never touches it and `npm run typecheck`
 * has nothing to say about it. That leaves the arithmetic — cohort splits, per-room capacity,
 * tent counts — completely unverified, which is exactly the shape of bug that reaches a
 * director as a spreadsheet full of confidently wrong numbers.
 *
 * It runs the REAL functions, extracted from public/index.html by name, against fixture
 * registrants. It does not reimplement any of them — a harness with its own copy of the
 * grouping rules would only prove the copy works.
 *
 *   node scripts/accom-export-harness.js
 *
 * Exit code 0 = all checks passed. Any failure prints the expectation and exits 1.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* Pull one top-level `function NAME(` / `const NAME=` declaration out of the SPA by brace
   matching. Extraction by NAME rather than by line number, because line numbers in this file
   drift on every batch — the names are stable. */
function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  // Statement-level declarations (const X=...;) end at the first newline whose braces balance.
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
    else if (ch === ';' && !started) return SRC.slice(i, j + 1);
  }
  throw new Error('unbalanced extraction for ' + decl);
}

const PARTS = [
  'const ACCOM_SPLIT_THRESHOLD=50;',
  'function _bracketOfGrade(g)',
  'function accomChurches(regs)',
  "const _ACCOM_YEARS=",
  'function _spreadLeaders(total,n)',
  'function _accomYearGroups(c,gender,g,bracket,leaders,extraYouth,lbl)',
  'function _accomGenderGroups(c,gender,g)',
  'function accomGroups(regs)',
  'function tentDist(regs)',
  'function _accomExportRows()',
];

const ctx = {
  window: {},
  SETTINGS: { campName: 'Test Camp' },
  console,
  Date,
  Math,
  Object,
  Array,
  JSON,
  String,
  Number,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(PARTS.map(extract).join('\n'), ctx);

// ---------------------------------------------------------------------------------------
let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ok   ' + label); return; }
  console.log('  FAIL ' + label + '\n         expected ' + e + '\n         actual   ' + a);
  failures++;
}
function checkTrue(label, cond, detail) {
  if (cond) { console.log('  ok   ' + label); return; }
  console.log('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
  failures++;
}

let seq = 0;
function person(over) {
  seq++;
  return Object.assign({
    id: 'p' + seq, churchId: 'c1', churchName: 'Victory', kind: 'student',
    gender: 'male', grade: 8, accommodationKind: 'classroom', status: 'active',
  }, over);
}
function many(n, over) { return Array.from({ length: n }, () => person(over)); }

function run(label, regs, rooms, alloc, fn) {
  console.log('\n' + label);
  ctx.window._accomRegs = regs;
  ctx.window._accomRooms = rooms;
  ctx.window._accomAlloc = alloc;
  fn(ctx._accomExportRows());
}

// ── 1. Small church, under the split threshold, fully placed ───────────────────────────────
run('1. Small eligible church, one room, fully placed',
  [...many(18, { kind: 'student' }), ...many(2, { kind: 'leader', grade: null })],
  [{ id: 'r1', name: 'Room A', capacity: 30 }],
  { r1: [{ key: 'c1|male', n: 20 }] },
  (d) => {
    check('cohort row', d.cohortRows[1],
      ['Victory', 'Guys', 'Guys', 18, 2, 20, 20, 0, 'Room A', 30]);
    check('room row', d.roomRows[1], ['Room A', 30, 20, 10, 'Guys', 'Victory — Guys (20)']);
    check('no tent rows beyond TOTAL', d.tentRows.length, 2);
  });

// ── 2. n === stu + ld across a SPLIT church (the arithmetic most likely to drift) ───────────
run('2. Church over the threshold splits, and every cohort still reconciles',
  [...many(30, { kind: 'student', grade: 8 }), ...many(28, { kind: 'student', grade: 11 }),
   ...many(6, { kind: 'leader', grade: null })],
  [], {},
  (d) => {
    const rows = d.cohortRows.slice(1);
    checkTrue('split into more than one cohort', rows.length > 1, 'got ' + rows.length);
    let stu = 0, ld = 0, tot = 0;
    rows.forEach((r) => {
      checkTrue('n === students + leaders for ' + r[2], r[5] === r[3] + r[4],
        r[3] + ' + ' + r[4] + ' !== ' + r[5]);
      stu += r[3]; ld += r[4]; tot += r[5];
    });
    check('students reconcile to the roster', stu, 58);
    check('leaders reconcile to the roster', ld, 6);
    check('total reconciles', tot, 64);
  });

// ── 3. A room shared by two cohorts ────────────────────────────────────────────────────────
run('3. One room shared by two ministries',
  [...many(10, { churchId: 'c1', churchName: 'Victory' }),
   ...many(10, { churchId: 'c2', churchName: 'Grace' })],
  [{ id: 'r1', name: 'Room A', capacity: 25 }],
  { r1: [{ key: 'c1|male', n: 10 }, { key: 'c2|male', n: 10 }] },
  (d) => {
    /* Cohorts within a room stay in ALLOCATION order, deliberately — that is the order the
       chips appear in on the allocations screen, and the export is meant to read as the same
       document. Only the rows themselves are sorted (by room name / by ministry). */
    check('both cohorts listed on the room row, in allocation order', d.roomRows[1][5],
      'Victory — Guys (10); Grace — Guys (10)');
    check('room allocated/remaining', [d.roomRows[1][2], d.roomRows[1][3]], [20, 5]);
    // Documented behaviour: a shared room contributes its FULL capacity to each occupant.
    check('shared capacity is reported in full to each cohort',
      [d.cohortRows[1][9], d.cohortRows[2][9]], [25, 25]);
  });

// ── 4. Partially placed cohort ─────────────────────────────────────────────────────────────
run('4. Cohort larger than the room it is in',
  many(20, {}),
  [{ id: 'r1', name: 'Small Room', capacity: 8 }],
  { r1: [{ key: 'c1|male', n: 8 }] },
  (d) => {
    check('placed / unplaced', [d.cohortRows[1][6], d.cohortRows[1][7]], [8, 12]);
    check('summary still to place', d.sumRows.find((r) => r[0] === 'Still to place')[1], 12);
    check('summary spare capacity', d.sumRows.find((r) => r[0] === 'Spare capacity')[1], 0);
  });

// ── 5. Tents: ceil-to-7, students and leaders counted SEPARATELY ────────────────────────────
run('5. Tent maths — students and leaders never share a tent',
  [...many(15, { accommodationKind: 'tent', kind: 'student' }),
   ...many(8, { accommodationKind: 'tent', kind: 'leader', grade: null })],
  [], {},
  (d) => {
    // 15 students -> ceil(15/7) = 3 tents. 8 leaders -> ceil(8/7) = 2. Pooling would give 4.
    check('tent row', d.tentRows[1], ['Victory', 'Guys', 15, 8, 3, 2, 5]);
    check('totals row', d.tentRows[d.tentRows.length - 1], ['TOTAL', '', 15, 8, 3, 2, 5]);
  });

// ── 6. Under-75% church folds into tents, and is NOT double counted as a classroom cohort ───
run('6. Under the 75% threshold — classroom people are counted in tents instead',
  [...many(4, { accommodationKind: 'classroom' }), ...many(16, { accommodationKind: 'tent' })],
  [], {},
  (d) => {
    check('no classroom cohorts at all', d.cohortRows.length, 1);
    // All 20 land in tents: the 16 tent-kind plus the 4 classroom-kind with nowhere to go.
    check('all 20 counted in tents', d.tentRows[1][2], 20);
    check('summary classroom total is zero',
      d.sumRows.find((r) => r[0] === 'In a classroom cohort')[1], 0);
    check('summary tent total', d.sumRows.find((r) => r[0] === 'In tents')[1], 20);
    check('threshold note counts the ministry',
      d.sumRows.find((r) => r[0] === 'Ministries under the 75% classroom threshold')[1], 1);
  });

// ── 7. Cancelled registrations are excluded everywhere ─────────────────────────────────────
run('7. Cancelled registrations are excluded',
  [...many(10, {}), ...many(5, { status: 'cancelled' }),
   ...many(3, { accommodationKind: 'tent', status: 'cancelled' })],
  [], {},
  (d) => {
    check('cohort ignores cancelled', d.cohortRows[1][5], 10);
    check('tents ignore cancelled', d.tentRows.length, 2);
    check('summary headcount ignores cancelled',
      d.sumRows.find((r) => r[0] === 'Registrations (excluding cancelled)')[1], 10);
  });

// ── 8. No accommodation type recorded is surfaced, never silently dropped ──────────────────
run('8. People with no accommodation type recorded are reported',
  [...many(10, {}), ...many(4, { accommodationKind: null })],
  [], {},
  (d) => {
    check('summary no-preference count',
      d.sumRows.find((r) => r[0] === 'No accommodation type recorded')[1], 4);
  });

// ── 9. An empty camp exports nothing rather than an empty workbook ─────────────────────────
run('9. Empty state', [], [], {}, (d) => {
  checkTrue('flagged empty', d.empty === true, 'empty was ' + d.empty);
});

// ── 10. A stale allocation entry for a group that no longer exists is ignored ───────────────
run('10. Stale allocation entry (group gone after a re-import) is ignored',
  many(10, {}),
  [{ id: 'r1', name: 'Room A', capacity: 20 }],
  { r1: [{ key: 'c1|male', n: 10 }, { key: 'GONE|male', n: 99 }] },
  (d) => {
    check('room allocated excludes the ghost', d.roomRows[1][2], 10);
    check('summary placed excludes the ghost',
      d.sumRows.find((r) => r[0] === 'Placed in a classroom')[1], 10);
  });

console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'All checks passed.'));
process.exit(failures ? 1 : 0);
