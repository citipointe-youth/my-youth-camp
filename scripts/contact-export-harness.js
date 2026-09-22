/*
 * My Youth "Export student contact" harness (2026-09-22).
 *
 * The row builder is browser-only code (public/index.html has no build step), so vitest cannot
 * reach it. Runs the REAL functions extracted from index.html by name, then round-trips the rows
 * through the vendored SheetJS to prove phone numbers land as TEXT cells (a numeric cell drops
 * the leading 0 — the whole reason fmtPhone exists).
 *
 *   node scripts/contact-export-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Name-prefix match (not full signature) — see data-search-harness.js for why.
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

const ctx = { console, JSON, Object, String, Math, Array, Number };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(['function fmtPhone(', 'function _contactExportRows('].map(extract).join('\n'), ctx);
const { _contactExportRows } = ctx;
if (typeof _contactExportRows !== 'function') throw new Error('sandbox guard: _contactExportRows missing');

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}

const P = (o) => Object.assign({ kind: 'camper', status: 'registered', grade: 9, email: null, mobile: null, churchName: 'Alpha' }, o);
const REGS = [
  P({ firstName: 'Zoe', lastName: 'Adams', churchName: 'Bravo', mobile: '0411928301', email: 'zoe@x.com', grade: 8 }),
  P({ firstName: 'Liam', lastName: 'Brown', kind: 'leader', grade: null, mobile: '412345678', email: 'liam@x.com' }),
  P({ firstName: 'Ava', lastName: 'Clark', mobile: '+61 400 111 222', email: 'ava@x.com', grade: 10 }),
  P({ firstName: 'Ben', lastName: 'Clark', grade: 7 }),
  P({ firstName: 'Gone', lastName: 'Away', status: 'cancelled', mobile: '0400000000' }),
];

console.log('\n1. Header');
check('header without church', _contactExportRows([], false)[0], ['Type', 'First name', 'Last name', 'Grade', 'Email', 'Phone']);
check('header with church', _contactExportRows([], true)[0], ['Church', 'Type', 'First name', 'Last name', 'Grade', 'Email', 'Phone']);
check('empty input -> header only', _contactExportRows([], false).length, 1);
check('null input -> header only', _contactExportRows(null, false).length, 1);

console.log('\n2. Rows without church (church login)');
const plain = _contactExportRows(REGS, false);
check('cancelled excluded', plain.length - 1, 4);
check('students first, then by last/first name', plain.slice(1).map(r => r[1]), ['Zoe', 'Ava', 'Ben', 'Liam']);
check('student row', plain[1], ['Student', 'Zoe', 'Adams', 8, 'zoe@x.com', '0411 928 301']);
check('+61 mobile normalised', plain[2][5], '0400 111 222');
check('blank email + phone are empty strings', plain[3], ['Student', 'Ben', 'Clark', 7, '', '']);
check('leader row: blank grade, 9-digit mobile regains its 0', plain[4], ['Leader', 'Liam', 'Brown', '', 'liam@x.com', '0412 345 678']);

console.log('\n3. Rows with church (wide roles)');
const wide = _contactExportRows(REGS, true);
check('sorted by church first', wide.slice(1).map(r => r[0] + ':' + r[2]), ['Alpha:Ava', 'Alpha:Ben', 'Alpha:Liam', 'Bravo:Zoe']);
check('church row shape', wide[4], ['Bravo', 'Student', 'Zoe', 'Adams', 8, 'zoe@x.com', '0411 928 301']);

console.log('\n4. SheetJS round-trip keeps phones as text');
const sj = { console, Date, Math, JSON, Uint8Array, ArrayBuffer, Buffer, TextDecoder, TextEncoder, setTimeout };
sj.window = sj; sj.self = sj; sj.global = sj;
vm.createContext(sj);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'xlsx.full.min.js'), 'utf8'), sj);
const XLSX = sj.XLSX;
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plain), 'Contacts');
const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' });
const ws = back.Sheets['Contacts'];
check('sheet name', back.SheetNames, ['Contacts']);
check('phone cell is text with leading 0', [ws['F2'].t, ws['F2'].v], ['s', '0411 928 301']);
check('grade cell is a number', [ws['D2'].t, ws['D2'].v], ['n', 8]);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
