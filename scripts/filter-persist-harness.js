/*
 * Roster filter persistence harness (2026-08-03).
 *
 * The check-in and My-students filters are now remembered per account on the device. This is
 * browser-only code, so vitest cannot reach it — and the failure modes are all SILENT
 * (a filter that leaks between the b-/g- logins on a shared phone, or a corrupt blob leaving a
 * filter `undefined`, which compares false against everything and empties the roster with no
 * error). Those need a test more than most things in this file do.
 *
 * Runs the REAL functions extracted from public/index.html against a stub localStorage.
 *
 *   node scripts/filter-persist-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
    else if (ch === ';' && !started) return SRC.slice(i, j + 1);
  }
  throw new Error('unbalanced extraction for ' + decl);
}

const store = {};
const ctx = {
  console, JSON, Object, String, Math, Array,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  ACTOR: null,
  FILTER: null,
  MY_FILTER: null,
  esc: (x) => String(x),
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext([
  'function _filtKey()' , 'function _saveFilters()', 'function _restoreFilters()',
  'function _filterActive(f)', 'function _filterBanner(which,hidden)',
].map(extract).join('\n'), ctx);

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
const login = (username) => { ctx.ACTOR = { username, id: 'id-' + username }; ctx._restoreFilters(); };

// ── 1. A filter survives a logout / login round trip ───────────────────────────────────────
console.log('\n1. Filters survive a logout and login');
login('b-victory');
ctx.FILTER.grade = '8'; ctx.MY_FILTER.gender = 'male';
ctx._saveFilters();
ctx.ACTOR = null; ctx.FILTER = null; ctx.MY_FILTER = null;   // logout
login('b-victory');
check('check-in grade restored', ctx.FILTER.grade, '8');
check('my-students gender restored', ctx.MY_FILTER.gender, 'male');
check('untouched keys stay default', ctx.FILTER.zone, 'all');

// ── 2. ⚠ THE ONE THAT MATTERS ON A SHARED PHONE: no leak between the b-/g- pair ────────────
console.log('\n2. The b-/g- logins of one church do NOT share a filter');
login('g-victory');
check('girls login starts clean', [ctx.FILTER.grade, ctx.MY_FILTER.gender], ['all', 'all']);
ctx.FILTER.grade = '11'; ctx._saveFilters();
login('b-victory');
check('boys login still has its own filter', ctx.FILTER.grade, '8');
login('g-victory');
check('girls login still has its own filter', ctx.FILTER.grade, '11');

// ── 3. A corrupt or partial blob can never leave a filter undefined ────────────────────────
console.log('\n3. Corrupt / partial stored values fall back to defaults');
const DEFAULT_CHECKIN = { gender: 'all', grade: 'all', church: 'all', zone: 'all' };
const DEFAULT_MY = { zone: 'all', gender: 'all', grade: 'all' };
for (const [label, raw] of [
  ['not JSON', '{{{'],
  ['null', 'null'],
  ['an array', '[1,2,3]'],
  ['wrong inner types', JSON.stringify({ checkin: { grade: 8 }, my: 'nope' })],
  ['partial', JSON.stringify({ checkin: { grade: '9' } })],
]) {
  store['ycp_filters_id-corrupt'] = raw;
  ctx.ACTOR = { username: null, id: 'id-corrupt' };
  ctx._restoreFilters();
  const okCheckin = Object.keys(DEFAULT_CHECKIN).every((k) => typeof ctx.FILTER[k] === 'string');
  const okMy = Object.keys(DEFAULT_MY).every((k) => typeof ctx.MY_FILTER[k] === 'string');
  checkTrue('no undefined key after ' + label, okCheckin && okMy,
    JSON.stringify(ctx.FILTER) + ' / ' + JSON.stringify(ctx.MY_FILTER));
}
// The one well-formed partial should still apply its good value.
check('a well-formed partial still restores what it had', ctx.FILTER.grade, '9');
// ...and a numeric grade must be REJECTED, not coerced — filters compare as strings.
store['ycp_filters_id-corrupt'] = JSON.stringify({ checkin: { grade: 8 } });
ctx._restoreFilters();
check('a numeric grade is rejected rather than coerced', ctx.FILTER.grade, 'all');

// ── 4. localStorage throwing (privacy mode) must not throw out of these ────────────────────
console.log('\n4. A throwing localStorage never propagates');
const good = ctx.localStorage;
ctx.localStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
};
let threw = null;
try { ctx.ACTOR = { username: 'x' }; ctx._restoreFilters(); ctx._saveFilters(); }
catch (e) { threw = e; }
checkTrue('restore + save both swallowed the failure', threw === null, threw && threw.message);
check('and left usable defaults', ctx.FILTER, DEFAULT_CHECKIN);
ctx.localStorage = good;

// ── 5. The banner only appears when something is actually filtered ─────────────────────────
console.log('\n5. Banner visibility and content');
login('b-victory2');
check('no banner when nothing is filtered', ctx._filterBanner('checkin', 0), '');
ctx.FILTER.grade = '8'; ctx.FILTER.gender = 'male';
const b = ctx._filterBanner('checkin', 12);
checkTrue('banner appears', b.indexOf('filtban') >= 0);
checkTrue('names the active filters', b.indexOf('Guys') >= 0 && b.indexOf('Yr 8') >= 0, b);
checkTrue('states how many are hidden', b.indexOf('>12<') >= 0 && b.indexOf('people hidden') >= 0, b);
ctx.MY_FILTER.grade = 'leaders';
checkTrue('the leaders option reads as "Leaders", not "Yr leaders"',
  ctx._filterBanner('my', 3).indexOf('Leaders') >= 0
  && ctx._filterBanner('my', 3).indexOf('Yr leaders') < 0);
checkTrue('singular for one hidden person', ctx._filterBanner('my', 1).indexOf('person hidden') >= 0);

console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'All checks passed.'));
process.exit(failures ? 1 : 0);
