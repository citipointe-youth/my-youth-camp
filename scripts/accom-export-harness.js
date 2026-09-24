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
  'const ACCOM_ELIGIBLE_RATIO=0.75;',
  'function _accomEligible(c)',
  'function _accomUnderBar(c)',
  "const _ACCOM_YEARS=",
  'function _spreadLeaders(total,n)',
  'function _accomYearGroups(c,gender,g,bracket,leaders,extraYouth,lbl)',
  'function _accomNaturalShape(g)',
  'function _accomGenderGroups(c,gender,g,shape)',
  'function accomGroups(regs)',
  'function _accomRoomUsed(map,roomId)',
  'function _accomHeld(map,key)',
  'function _accomShrink(map,key,count,rooms)',
  'function _accomGrow(map,key,count,rooms)',
  'function _accomEffective(stored,groups,rooms,baselines)',
  'function _accomEff()',
  'function _accomReqBase(key,eff,groups)',
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
    check('room row', d.roomRows[1], ['Room A', 30, 20, 10, 'Guys', 'Victory — Guys (20)', 0]);
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
    // Task 16 (2026-09-03) — cancelled people stay IN the export, marked, but must never move
    // any of the counts above (proven by the three checks unchanged from before this feature).
    check('the 8 cancelled people are LISTED, marked, in the summary sheet',
      d.sumRows.find((r) => r[0] === 'CANCELLED (excluded from every count above)')[1], 8);
    check('every listed cancelled row is marked "Cancelled"',
      d.sumRows.filter((r) => r[1] === 'Cancelled').length, 8);
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

// ── 11. RENDER.accom actually REQUESTS cancelled people from the server ────────────────────
// Critical fix, review round 1 (2026-09-03): every scenario above proves _accomExportRows()
// does the right thing with whatever is in window._accomRegs — but that proves nothing about
// production, where window._accomRegs is populated by RENDER.accom's own network fetch. The
// server strips cancelled registrants from /registrants by default (person.service.ts's
// `includeCancelled` gate), so without `?includeCancelled=1` on THAT fetch, _accomRegs never
// contains a cancelled person at all and the Summary-sheet appendix is silently always empty
// in the real app — exactly the class of gap scenario 7 above cannot catch, because it injects
// cancelled people directly rather than going through the fetch. This is a STATIC source check
// (RENDER.accom is async and depends on api()/DOM, not worth mocking a whole fetch stack for),
// but it is exactly the "exercises the real fetch path" check the review asked for: it fails if
// this call is ever reverted to a bare `/registrants`.
console.log('\n11. RENDER.accom requests cancelled registrants (or the export appendix is always empty)');
const renderAccomSrc = extract('RENDER.accom=async function(){');
checkTrue('the /registrants fetch inside RENDER.accom includes includeCancelled=1',
  /_scoped\(['"]\/registrants\?includeCancelled=1['"]\)/.test(renderAccomSrc),
  'RENDER.accom must fetch /registrants?includeCancelled=1 (mirroring RENDER.budget and ' +
  '_loadAllocation) or window._accomRegs never contains cancelled people in production');

// ── 12. "Left to per-registration" (2026-09-24): a flagged under-75% ministry keeps its
//        classroom people in classroom cohorts and ONLY its tent people in tents ───────────
ctx.window._accomPerReg = { c1: true };
run('12. Per-registration ministry under 75% — juniors to classrooms, seniors to tents',
  [...many(4, { accommodationKind: 'classroom', grade: 8 }),
   ...many(16, { accommodationKind: 'tent', grade: 11 })],
  [], {},
  (d) => {
    check('one classroom cohort of the 4 juniors', d.cohortRows.length, 2);
    check('cohort size', d.cohortRows[1][5], 4);
    check('only the 16 tent-kind in tents', d.tentRows[1][2], 16);
    check('not listed as moved to tents',
      d.sumRows.find((r) => r[0] === 'Ministries under the 75% classroom threshold')[1], 0);
    check('listed as per-registration',
      d.sumRows.find((r) => r[0] === 'Ministries left to per-registration')[1], 1);
  });
ctx.window._accomPerReg = {};

// ── 13. No hardcoded 0.75 left in the SPA's accommodation code ─────────────────────────
console.log('\n13. The 75% ratio lives only in ACCOM_ELIGIBLE_RATIO');
['function accomGroups(regs)', 'function tentDist(regs)', 'function _accomExportRows()', 'function drawAccom()']
  .forEach((n) => checkTrue(n + ' has no literal 0.75', !extract(n).includes('0.75')));


// ── 14–20. Soft freeze + effective placements (2026-09-24). These drive the REAL mirrored
//    functions (_accomEligible / accomGroups with frozen shapes, _accomEffective) and the export.
function freezeNow(regs) {
  // Build the freeze snapshot exactly as the server would: eligibility + natural shape per pool,
  // baselines = live group sizes. Uses the SPA's own grouping (unfrozen) to do it.
  ctx.window._accomFreeze = null;
  const by = ctx.accomChurches(regs), eligible = [], shapes = {};
  Object.values(by).forEach((c) => {
    if (!ctx._accomEligible(c)) return;
    eligible.push(c.id);
    if (c.male.cls) shapes[c.id + '|male'] = ctx._accomNaturalShape(c.male);
    if (c.female.cls) shapes[c.id + '|female'] = ctx._accomNaturalShape(c.female);
  });
  const baselines = Object.fromEntries(ctx.accomGroups(regs).map((g) => [g.key, g.n]));
  return { frozenAt: '2026-09-25T00:00:00.000Z', eligibleChurchIds: eligible, shapes, baselines };
}
function runFrozen(label, freeze, regs, rooms, alloc, fn) {
  ctx.window._accomFreeze = freeze;
  run(label, regs, rooms, alloc, fn);
  ctx.window._accomFreeze = null;
}
const pick = (d, k) => (d.sumRows.find((r) => r[0] === k) || [])[1];

{
  const at = many(25, {});
  const fz = freezeNow(at);
  runFrozen('14. Freeze, then +4 registrants into a single-room group → 29/25, loud in the export',
    fz, [...at, ...many(4, {})], [{ id: 'r1', name: 'Room A', capacity: 25 }], { r1: [{ key: 'c1|male', n: 25 }] },
    (d) => {
      check('room row shows 29 allocated, -4 remaining, 4 over', [d.roomRows[1][2], d.roomRows[1][3], d.roomRows[1][6]], [29, -4, 4]);
      check('summary rooms over capacity', pick(d, 'Rooms over capacity'), 1);
      check('summary total over capacity', pick(d, 'Total over capacity'), 4);
      check('summary late registrations absorbed', pick(d, 'Late registrations absorbed'), 4);
      checkTrue('summary names the freeze', /^On since/.test(pick(d, 'Soft freeze')));
      check('cohort placed = 29, nothing unplaced', [d.cohortRows[1][6], d.cohortRows[1][7]], [29, 0]);
    });
}
{
  const at = many(30, {});
  const fz = freezeNow(at);
  ctx.window._accomFreeze = fz; ctx.window._accomRegs = [...at, ...many(6, {})]; ctx.window._accomRooms = [{ id: 'A', name: 'A', capacity: 20 }, { id: 'B', name: 'B', capacity: 20 }];
  ctx.window._accomAlloc = { A: [{ key: 'c1|male', n: 18 }], B: [{ key: 'c1|male', n: 12 }] };
  console.log('\n15. A group split across rooms grows into the room with the most free space');
  const e = ctx._accomEff();
  check('A 18, B 18', [e.A[0].n, e.B[0].n], [18, 18]);
  ctx.window._accomRegs = [...many(40, {}), ...many(3, {})];
  ctx.window._accomFreeze = freezeNow(many(40, {}));
  ctx.window._accomAlloc = { B: [{ key: 'c1|male', n: 20 }], A: [{ key: 'c1|male', n: 20 }] };
  console.log('\n16. All rooms full: least-overfull takes the next; ties → first-placed room (B)');
  const e2 = ctx._accomEff();
  check('B 22, A 21', [e2.B[0].n, e2.A[0].n], [22, 21]);
  ctx.window._accomRegs = many(27, {});
  ctx.window._accomFreeze = freezeNow(many(30, {}));
  ctx.window._accomRooms = [{ id: 'A', name: 'A', capacity: 10 }, { id: 'B', name: 'B', capacity: 30 }];
  ctx.window._accomAlloc = { A: [{ key: 'c1|male', n: 12 }], B: [{ key: 'c1|male', n: 18 }] };
  console.log('\n17. Cancellation while frozen: over-capacity room first, then the smallest placement');
  const e3 = ctx._accomEff();
  check('A 9, B 18', [e3.A[0].n, e3.B[0].n], [9, 18]);
  ctx.window._accomFreeze = null;
}
{
  const at = many(50, {});
  const fz = freezeNow(at);
  ctx.window._accomFreeze = fz;
  console.log('\n18. A 51st registrant while frozen does NOT re-split');
  check('still one group', ctx.accomGroups([...at, person({})]).map((g) => g.key), ['c1|male']);
  ctx.window._accomFreeze = null;
  checkTrue('(the live rule would have split it)', ctx.accomGroups([...at, person({})])[0].key !== 'c1|male');
}
{
  const at = [...many(2, { churchId: 'n', churchName: 'New' }), ...many(6, { churchId: 'n', churchName: 'New', accommodationKind: 'tent' })];
  const fz = freezeNow(at);
  runFrozen('19. A ministry that becomes eligible while frozen stays as at freeze time (tents)',
    fz, [...many(20, { churchId: 'n', churchName: 'New' }), ...many(6, { churchId: 'n', churchName: 'New', accommodationKind: 'tent' })], [], {},
    (d) => {
      check('no classroom cohort', d.cohortRows.length, 1);
      check('all 26 counted in tents', d.tentRows[1][2], 26);
    });
}
{
  // 20. After unfreeze the over-capacity room stays over, not frozen → effective = stored (clamp only)
  runFrozen('20. Not frozen: effective is a plain clamp, and an over-capacity stored room is reported',
    null, many(29, {}), [{ id: 'r1', name: 'Room A', capacity: 25 }], { r1: [{ key: 'c1|male', n: 29 }] },
    (d) => {
      check('over capacity 4', d.roomRows[1][6], 4);
      check('no late registrations when not frozen', pick(d, 'Late registrations absorbed'), 0);
      check('soft freeze off', pick(d, 'Soft freeze'), 'Off');
    });
}

{
  // 21. The request a change sends: the touched group's EFFECTIVE placements, everyone else as
  //     stored, and never an entry for a group that no longer exists.
  const at = [...many(25, {}), ...many(5, { churchId: 'c2', churchName: 'Grace' })];
  ctx.window._accomFreeze = freezeNow(at);
  ctx.window._accomRegs = [...at, ...many(4, {}), ...many(2, { churchId: 'c2', churchName: 'Grace' })];
  ctx.window._accomRooms = [{ id: 'A', name: 'A', capacity: 25 }, { id: 'B', name: 'B', capacity: 25 }];
  ctx.window._accomAlloc = { A: [{ key: 'c1|male', n: 25 }, { key: 'GONE|male', n: 3 }], B: [{ key: 'c2|male', n: 5 }] };
  console.log('\n21. addAlloc/removeAlloc request base');
  const groups = ctx.accomGroups(ctx.window._accomRegs);
  const base = ctx._accomReqBase('c1|male', ctx._accomEff(), groups);
  check('touched group sent as effective (29), other group as stored (5), stale entry dropped',
    base, { A: [{ key: 'c1|male', n: 29 }], B: [{ key: 'c2|male', n: 5 }] });
  ctx.window._accomFreeze = null;
}

console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'All checks passed.'));
process.exit(failures ? 1 : 0);
