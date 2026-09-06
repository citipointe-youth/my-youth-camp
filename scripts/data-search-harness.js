/*
 * Data-screen search harness (2026-09-06).
 *
 * The Data table's free-text search is browser-only code, so vitest cannot reach it. Its failure
 * modes are all SILENT: a query that matches nothing empties a 600-row table with no error, and a
 * phone search that compares formatted text against typed digits simply never matches. Runs the
 * REAL functions extracted from public/index.html.
 *
 *   node scripts/data-search-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* Matches on a NAME PREFIX, not a full signature — a parameter added to one of these must not
 * silently kill this script the way it killed budget-xlsx-harness.js for a month (CLAUDE.md,
 * 2026-09-06). A throw here means a genuine RENAME. */
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

const NEEDED = ['function _dataNorm(', 'function _dataDigits(', 'function _dataMatchQuery('];
const ctx = { console, JSON, Object, String, Math, Array, Number };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(NEEDED.map(extract).join('\n'), ctx);
for (const sym of ['_dataNorm', '_dataDigits', '_dataMatchQuery']) {
  if (typeof ctx[sym] !== 'function') throw new Error('sandbox guard: ' + sym + ' missing after extraction');
}
/* The extracted functions live on the sandbox, NOT in this module's scope — lift them out so the
 * checks below read naturally. (filter-persist-harness.js prefixes every call with `ctx.`; same
 * thing, fewer characters.) */
const { _dataNorm, _dataDigits, _dataMatchQuery } = ctx;

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}

const ROW = {
  kind: 'camper', firstName: 'Amelia', lastName: "O'Brien", churchName: 'Victory Brisbane',
  gender: 'female', grade: 9, registrationType: 'Early Bird Tent', registrationCost: 190,
  discountCode: 'YC26BNESPONSOR', mobile: '0412345678',
  medicalConditions: ['Asthma', 'Peanut allergy'], dietaryRequirements: ['Gluten free'],
  otherMedications: 'Ventolin', blueCardNumber: 'BC-99231',
  accommodationKind: 'tent', needsReview: true, needsReviewReason: 'Ticket List name did not match',
};

check('empty query matches everything', _dataMatchQuery(ROW, ''), true);
check('whitespace-only query matches everything', _dataMatchQuery(ROW, '   '), true);
check('first name, wrong case', _dataMatchQuery(ROW, 'aMeLiA'), true);
check('last name with an apostrophe', _dataMatchQuery(ROW, "o'brien"), true);
check('full name in natural order', _dataMatchQuery(ROW, 'amelia o'), true);
check('full name in table order', _dataMatchQuery(ROW, "o'brien, amelia"), true);
check('church name', _dataMatchQuery(ROW, 'victory'), true);
check('medical condition', _dataMatchQuery(ROW, 'asthma'), true);
check('second medical condition', _dataMatchQuery(ROW, 'peanut'), true);
check('dietary requirement', _dataMatchQuery(ROW, 'gluten'), true);
check('other medications', _dataMatchQuery(ROW, 'ventolin'), true);
check('discount code', _dataMatchQuery(ROW, 'bnesponsor'), true);
check('blue card', _dataMatchQuery(ROW, 'bc-99'), true);
check('needs-review reason', _dataMatchQuery(ROW, 'did not match'), true);
check('grade', _dataMatchQuery(ROW, '9'), true);
check('mobile typed as stored', _dataMatchQuery(ROW, '0412345678'), true);
check('mobile typed as DISPLAYED (spaces)', _dataMatchQuery(ROW, '0412 345 678'), true);
check('mobile partial run of digits', _dataMatchQuery(ROW, '412345'), true);
check('no match returns false', _dataMatchQuery(ROW, 'zzzznotpresent'), false);
check('a field from another row does not match', _dataMatchQuery(ROW, 'Elevation'), false);

/* ⚠️ Null-safety is the whole point of _dataNorm/_dataDigits: a leader row has no grade, an
 * unimported person has no mobile, and `undefined` reaching String() would read as "undefined"
 * and match a search for "define". */
const SPARSE = { kind: 'leader', firstName: 'Sam', lastName: 'Lee' };
check('sparse row: name still matches', _dataMatchQuery(SPARSE, 'lee'), true);
check('sparse row: no phantom "undefined" match', _dataMatchQuery(SPARSE, 'undefined'), false);
check('sparse row: no phantom "null" match', _dataMatchQuery(SPARSE, 'null'), false);
check('sparse row: unrelated query is false', _dataMatchQuery(SPARSE, 'asthma'), false);

check('_dataDigits strips formatting', _dataDigits('0412 345 678'), '0412345678');
check('_dataDigits on null', _dataDigits(null), '');
check('_dataNorm on undefined', _dataNorm(undefined), '');
check('_dataNorm trims and lowercases', _dataNorm('  Amelia  '), 'amelia');

console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
