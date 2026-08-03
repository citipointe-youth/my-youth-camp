/*
 * Budget CSV harness (2026-08-04).
 *
 * The owner reported "weird symbols in the category column and it isn't very reader-friendly".
 * Root causes were a missing UTF-8 BOM (Excel on Windows then renders the em dash in
 * `Tent — paid in person` as `â€"`) and one Category column carrying three different facts.
 *
 * This is browser-only code, so vitest cannot reach it. The BOM in particular is an INVISIBLE
 * character — the way it regresses is somebody tidying a string concatenation and never seeing
 * a difference on screen. That needs a test.
 *
 *   node scripts/budget-csv-harness.js
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

let saved = null;
const ctx = {
  console, JSON, Object, String, Number, Math, Array, Date, RegExp,
  sel: () => 'all',
  toast: () => {},
  _exportName: (base, ext) => base + '.' + ext,
  _saveTextFile: (text) => { saved = text; },
  computeBudgetClient: null,   // stubbed per-case below
  window: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext([
  'const _BUD_CLASSES=', 'function _budAccom(cls)', 'function _budPayment(cls)',
  'function exportBudget()',
].map(extract).join('\n')
  // `const` is a lexical declaration and does NOT become a property of the vm context the way
  // a function declaration does — without this the harness sees `undefined`.
  + '\nglobalThis._BUD_CLASSES=_BUD_CLASSES;', ctx);

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

const row = (key, count, amount, lineTotal, codeHint) =>
  ({ key, count, amount, lineTotal, codeHint: codeHint || null, label: 'ignored' });

ctx.computeBudgetClient = () => ({
  churches: [
    {
      churchName: 'Citipointe, Carindale',          // a comma — must be quoted
      campers: [row('classroom', 10, 190, 1900), row('tent-inperson', 3, 150, 450, 'YC26CASH')],
      leaders: [row('classroom-sponsor', 2, 0, 0, 'YC26LDR')],
      camperCount: 13, leaderCount: 2, total: 2350,
    },
    {
      churchName: 'Grace Point',
      campers: [row('unknown', 4, null, 0)],
      leaders: [],
      camperCount: 4, leaderCount: 0, total: 0,
    },
  ],
  camperCount: 17, leaderCount: 2, grandTotal: 2350,
});

console.log('\n1. Encoding — the reported "weird symbols"');
ctx.exportBudget();
checkTrue('starts with a UTF-8 BOM', saved.charCodeAt(0) === 0xfeff,
  'first char code was ' + saved.charCodeAt(0));
checkTrue('the BOM survives as EF BB BF in UTF-8 bytes',
  Buffer.from(saved, 'utf8').slice(0, 3).toString('hex') === 'efbbbf');
checkTrue('no em dash anywhere in the payload', saved.indexOf('—') < 0,
  'em dash found — the label leaked into a cell again');
checkTrue('uses CRLF line endings', saved.indexOf('\r\n') > 0);

console.log('\n2. Columns — one fact per column');
const lines = saved.replace(/^﻿/, '').split('\r\n');
check('header', lines[0],
  'Church,Row type,Audience,Accommodation,Payment type,Discount code,People,Unit price,Line total');
check('a full-price classroom camper row', lines[1],
  '"Citipointe, Carindale",Detail,Camper,Classroom,Full price,,10,190,1900');
check('an in-person tent row carries its code', lines[2],
  '"Citipointe, Carindale",Detail,Camper,Tent,Paid in person,YC26CASH,3,150,450');
check('a sponsored leader row', lines[3],
  '"Citipointe, Carindale",Detail,Leader,Classroom,Full sponsor,YC26LDR,2,0,0');
check('church subtotal is labelled, not disguised as a detail row', lines[4],
  '"Citipointe, Carindale",Church total,,,,,15,,2350');
/* "Accommodation not recorded" has no payment class to report, so BOTH Payment type and
   Discount code are empty — hence the run of commas. Unit price is empty too, never 0. */
check('unrecorded accommodation, blank unit price (NOT 0)', lines[5],
  'Grace Point,Detail,Camper,Not recorded,,,4,,0');

console.log('\n3. Totals are distinguishable from detail rows');
check('camp total row', lines[lines.length - 1], 'ALL CHURCHES,Camp total,,,,,19,,2350');
const detail = lines.slice(1).filter((l) => l.split(',').indexOf('Detail') >= 0 || /,Detail,/.test(l));
/* The whole reason "Row type" exists: before it, Audience held Camper/Leader/Total/Grand Total
   together, so summing the Line total column double-counted every subtotal. */
const sumOf = (ls) => ls.reduce((s, l) => {
  const m = l.match(/,(-?\d+(?:\.\d+)?)$/); return s + (m ? Number(m[1]) : 0);
}, 0);
check('detail rows alone sum to the camp total', sumOf(detail), 2350);
checkTrue('summing EVERY row would have double-counted (this is the trap)',
  sumOf(lines.slice(1)) !== 2350, 'got ' + sumOf(lines.slice(1)));

console.log('\n4. Class-key splitting covers every class in the table');
const seen = [];
ctx._BUD_CLASSES.forEach(([cls]) => {
  const a = ctx._budAccom(cls), p = ctx._budPayment(cls);
  seen.push(cls + ' -> ' + a + ' / ' + (p || '(none)'));
  checkTrue(cls + ' maps to a known accommodation',
    a === 'Tent' || a === 'Classroom' || a === 'Not recorded', a);
  checkTrue(cls + ' maps to a known payment type',
    ['Full price', 'Paid in person', 'Full sponsor', 'Discounted', ''].indexOf(p) >= 0, p);
});
console.log('       ' + seen.join('\n       '));

console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'All checks passed.'));
process.exit(failures ? 1 : 0);
