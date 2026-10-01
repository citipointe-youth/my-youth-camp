/*
 * Pulse / first-aid filter / student-edit save-plan harness (2026-10-01, camp-v142).
 *
 * All three are browser-only decisions with SILENT failure modes: a zone-less student renders as a
 * blank " Zone 0/1" bar, a day filter that compares the wrong date shows an empty list, and a
 * student save that sends `churchId` on the plain PATCH bypasses the allocation_overrides record
 * (the next import quietly reverts it). Runs the REAL functions extracted from public/index.html.
 *
 *   node scripts/pulse-fa-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Name-prefix extraction, same as data-search-harness.js — a throw here means a genuine RENAME.
function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced extraction for ' + decl);
}

const NAMES = ['_pulseGroups', '_faKeep', '_stuSavePlan'];
const ctx = { console, JSON, Object, String, Array, Number };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(NAMES.map((n) => extract('function ' + n + '(')).join('\n'), ctx);
for (const n of NAMES) if (typeof ctx[n] !== 'function') throw new Error('sandbox guard: ' + n + ' missing');
const { _pulseGroups, _faKeep, _stuSavePlan } = ctx;

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n     expected ' + e + '\n     actual   ' + a);
}

/* ---- _pulseGroups ---- */
const roster = [
  { zone: '', church: 'Unallocated', checkedIn: false },
  { zone: 'Black', church: 'A', checkedIn: true },
  { zone: 'Blue', church: 'B', checkedIn: false },
  { zone: 'Black', church: 'A', checkedIn: false },
  { zone: null, church: '', checkedIn: true },
  { church: 'C', checkedIn: true }, // zone undefined
];
const byZone = _pulseGroups(roster, false);
check('zones keep insertion order, unallocated last', byZone.map((g) => g.label), ['Black Zone', 'Blue Zone', 'Unallocated']);
check('every zone-less row lands in ONE unallocated group', byZone[2], { key: '__unallocated__', label: 'Unallocated', raw: '', unalloc: true, total: 3, done: 2 });
check('zone totals', byZone.map((g) => [g.total, g.done]), [[2, 1], [1, 0], [3, 2]]);
const byChurch = _pulseGroups([
  { church: '', checkedIn: false },
  { church: 'A', checkedIn: true },
  { church: 'B', checkedIn: false },
], true);
check('byChurch labels are the church name; blank church is Unallocated, last', byChurch.map((g) => g.label), ['A', 'B', 'Unallocated']);
check('empty roster', _pulseGroups([], false), []);
check('undefined roster', _pulseGroups(undefined, false), []);

/* ---- _faKeep ---- */
const dayOf = (iso) => iso.slice(0, 10); // test stand-in for localDateISO
const g = (d, amendDays = []) => ({ n: { createdAt: d }, amends: amendDays.map((a) => ({ createdAt: a })) });
check('all keeps everything', _faKeep(g('2026-09-28T01:00Z'), 'all', '2026-10-01', dayOf), true);
check('today matches today', _faKeep(g('2026-10-01T01:00Z'), 'today', '2026-10-01', dayOf), true);
check('today rejects another day', _faKeep(g('2026-09-30T01:00Z'), 'today', '2026-10-01', dayOf), false);
check('a day matches the record', _faKeep(g('2026-09-29T01:00Z'), '2026-09-29', '2026-10-01', dayOf), true);
check('a day matches via an amendment', _faKeep(g('2026-09-28T01:00Z', ['2026-09-30T02:00Z']), '2026-09-30', '2026-10-01', dayOf), true);
check('a day rejects when neither matches', _faKeep(g('2026-09-28T01:00Z', ['2026-09-29T02:00Z']), '2026-09-30', '2026-10-01', dayOf), false);
check('no createdAt is never kept by a day filter', _faKeep({ n: {}, amends: [] }, '2026-09-30', '2026-10-01', dayOf), false);
check('missing amends array tolerated', _faKeep({ n: { createdAt: '2026-09-30T01:00Z' } }, '2026-09-30', '2026-10-01', dayOf), true);

/* ---- _stuSavePlan ---- */
const s = { churchId: 'ch_a', accommodationOverride: null };
const b = { firstName: 'A', lastName: 'B', gender: 'female', grade: 9, medical: '', dietary: '', churchId: 'ch_a', churchName: 'A', zone: 'Black', accommodationKind: 'tent', accOv: '' };
const p1 = _stuSavePlan(s, b);
check('unchanged church → no allocate', p1.allocateTo, null);
check('unchanged override → accOv undefined', p1.accOv, undefined);
check('patch never carries church/zone/accommodation', Object.keys(p1.patch).filter((k) => /church|zone|accommodation/i.test(k)), []);
check('changed church → allocate to it', _stuSavePlan(s, { ...b, churchId: 'ch_b' }).allocateTo, 'ch_b');
check('blank church never allocates', _stuSavePlan(s, { ...b, churchId: '' }).allocateTo, null);
check('set an override', _stuSavePlan(s, { ...b, accOv: 'classroom' }).accOv, 'classroom');
check('clear an override → null', _stuSavePlan({ ...s, accommodationOverride: 'tent' }, { ...b, accOv: '' }).accOv, null);
check('same override → undefined', _stuSavePlan({ ...s, accommodationOverride: 'tent' }, { ...b, accOv: 'tent' }).accOv, undefined);

if (failures) { console.log('\n' + failures + ' FAILED'); process.exit(1); }
console.log('\nall checks passed');
