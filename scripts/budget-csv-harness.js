/*
 * Budget CSV harness (2026-08-04).
 *
 * The owner reported "weird symbols in the category column and it isn't very reader-friendly".
 * Root causes were a missing UTF-8 BOM (Excel on Windows then renders the em dash in
 * `Tent — paid in person` as `â€"`) and one Category column carrying three different facts.
 *
 * Extended the same day with SPONSORSHIP (section 5). The owner's case: one sponsor code used
 * across an early-bird tent ticket AND a full-price tent ticket, where the early-bird places are
 * a smaller ask. The failure mode to guard against is an AVERAGE — $170 for a code covering $150
 * and $190 places is a figure describing nobody, and no sponsor can be invoiced for it.
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
  console, JSON, Object, String, Number, Math, Array, Date, RegExp, Map, Set, isFinite,
  sel: () => 'all',
  toast: () => {},
  _exportName: (base, ext) => base + '.' + ext,
  _saveTextFile: (text) => { saved = text; },
  computeBudgetClient: null,   // stubbed per-case below
  SETTINGS: { discountCodeTags: {}, tentPrice: null, classroomPrice: null },
  window: { _budgetRegs: [] },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext([
  'const _BUD_CLASSES=', 'function _budAccom(cls)', 'function _budPayment(cls)',
  // The sponsorship path runs for real — it is the only way to prove the differential survives
  // into the spreadsheet, so every function it touches is extracted rather than stubbed.
  'function _normTicketType(t)', 'function _budTicketPrices(regs)', 'function _priceForTicket(table,t)',
  'function _resolveTicketPrice(p,table)', 'function _personValue(p,cls,prices,ticketPrice)',
  'function _classifyTicket(p,tags)', 'function _budPrices()', 'function _budTags()',
  'function _sponsorAmountFor(p,cls,prices,ticketPrice)', 'const _SPONSOR_TAGS=',
  'const _SPONSOR_TAG_LABEL=', 'function _sponsorBands(entries)',
  'function computeSponsorSummaryClient(regs,filterId)', 'function _sponsorByTotal(a,b)',
  'function exportBudget()',
].map(extract).join('\n')
  // `const` is a lexical declaration and does NOT become a property of the vm context the way
  // a function declaration does — without this the harness sees `undefined`.
  + '\nglobalThis._BUD_CLASSES=_BUD_CLASSES;globalThis._SPONSOR_TAG_LABEL=_SPONSOR_TAG_LABEL;', ctx);

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
check('a full-price classroom student row', lines[1],
  '"Citipointe, Carindale",Detail,Student,Classroom,Full price,,10,190,1900');
check('an in-person tent row carries its code', lines[2],
  '"Citipointe, Carindale",Detail,Student,Tent,Paid in person,YC26CASH,3,150,450');
check('a sponsored leader row', lines[3],
  '"Citipointe, Carindale",Detail,Leader,Classroom,Full sponsor,YC26LDR,2,0,0');
check('church subtotal is labelled, not disguised as a detail row', lines[4],
  '"Citipointe, Carindale",Church total,,,,,15,,2350');
/* "Accommodation not recorded" has no payment class to report, so BOTH Payment type and
   Discount code are empty — hence the run of commas. Unit price is empty too, never 0. */
check('unrecorded accommodation, blank unit price (NOT 0)', lines[5],
  'Grace Point,Detail,Student,Not recorded,,,4,,0');
/* "Camper" was the only user-facing use of that word left in an export (2026-08-04) — the app
   says "student" everywhere else, and a spreadsheet column that disagrees with the screen is a
   small tax on every reader. */
checkTrue('the word "Camper" appears nowhere', saved.indexOf('Camper') < 0);

console.log('\n3. Totals are distinguishable from detail rows');
check('camp total row', lines[7], 'ALL CHURCHES,Camp total,,,,,19,,2350');
checkTrue('with no sponsor codes, the camp total is the last row', lines[lines.length - 1] === lines[7]);
const detail = lines.slice(1).filter((l) => /,Detail,/.test(l));
/* The whole reason "Row type" exists: before it, Audience held Student/Leader/Total/Grand Total
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

console.log('\n5. Sponsorship — the early-bird / full-price differential');
/* The owner's exact case. YC26SPON is a FULL sponsorship spanning two tent prices; YC26HALF is a
   part sponsorship. One place is deliberately left unpriceable, to prove it is counted and
   flagged rather than silently totalled as $0 (which would read as "already covered"). */
const EARLY = 'EARLY BIRD | Tent Accomodation', STD = 'Tent Accomodation';
const person = (o) => Object.assign({
  churchId: 'c1', churchName: 'Victory', kind: 'camper', status: 'active',
  registrationCost: null, amountPaid: null, discountCode: null,
  accommodationKind: 'tent', registrationType: null,
}, o);
ctx.SETTINGS.discountCodeTags = { YC26SPON: 'sponsor', YC26HALF: 'discount', YC26CASH: 'inperson' };
ctx.window._budgetRegs = [
  person({ registrationType: EARLY, registrationCost: 150, discountCode: 'YC26SPON', amountPaid: 0 }),
  person({ registrationType: EARLY, registrationCost: 150, discountCode: 'YC26SPON', amountPaid: 0 }),
  person({ registrationType: EARLY, registrationCost: 150, discountCode: 'YC26SPON', amountPaid: 0 }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26SPON', amountPaid: 0,
    churchId: 'c2', churchName: 'Grace Point' }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26SPON', amountPaid: 0,
    churchId: 'c2', churchName: 'Grace Point' }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26HALF', amountPaid: 95 }),
  // No cost, no ticket type, no accommodation kind → no source can price it.
  person({ discountCode: 'YC26SPON', accommodationKind: null, amountPaid: 0 }),
  // In-person money DID arrive; it must never appear as an ask.
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26CASH', amountPaid: 0 }),
];
const s = ctx.computeSponsorSummaryClient(ctx.window._budgetRegs, 'all');
check('the two sponsor values stay apart (no average)',
  s.codes.find((c) => c.code === 'YC26SPON').bands.map((b) => [b.amount, b.count, b.total]),
  [[190, 2, 380], [150, 3, 450]]);
checkTrue('$170 — the average of the two bands — appears nowhere',
  !s.codes.some((c) => c.bands.some((b) => b.amount === 170)));
check('full vs part sponsorship are totalled separately',
  [s.fullTotal, s.partialTotal, s.total], [830, 95, 925]);
check('an in-person code is not an ask', s.codes.map((c) => c.code).indexOf('YC26CASH'), -1);
check('the unpriceable place is counted and flagged, never totalled as $0',
  [s.count, s.unpricedCount], [7, 1]);
check('per-ministry and per-code are two views of one figure',
  [s.churches.reduce((t, c) => t + c.total, 0), s.codes.reduce((t, c) => t + c.total, 0)],
  [925, 925]);

ctx.exportBudget();
const sl = saved.replace(/^﻿/, '').split('\r\n');
const bandRows = sl.filter((l) => /,Sponsor band,/.test(l));
check('each band is its own CSV row, priced per place', bandRows, [
  'ALL CHURCHES,Sponsor band,,Tent Accomodation,Full sponsorship,YC26SPON,2,190,380',
  'ALL CHURCHES,Sponsor band,,EARLY BIRD | Tent Accomodation,Full sponsorship,YC26SPON,3,150,450',
  'ALL CHURCHES,Sponsor band,,Tent Accomodation,Part sponsored,YC26HALF,1,95,95',
]);
check('the unpriced places get their own row rather than a $0 line',
  sl.filter((l) => /,Sponsor unpriced,/.test(l)),
  ['ALL CHURCHES,Sponsor unpriced,,,Full sponsorship,YC26SPON,1,,']);
/* Biggest ask first, not alphabetical — Victory's 545 outranks Grace Point's 380. This is the
   order a director works down when deciding who to chase. */
check('per-ministry rows, biggest ask first', sl.filter((l) => /,Sponsor by ministry,/.test(l)), [
  'Victory,Sponsor by ministry,,,Full sponsorship,YC26SPON,4,,450',
  'Victory,Sponsor by ministry,,,Part sponsored,YC26HALF,1,,95',
  'Grace Point,Sponsor by ministry,,,Full sponsorship,YC26SPON,2,,380',
]);
check('camp sponsor total', sl[sl.length - 1], 'ALL CHURCHES,Sponsor total,,,,,7,,925');
/* Load-bearing: sponsorship is money that has NOT arrived. If any of it were typed as `Detail`
   it would be summed into the received column, which is exactly the double-count the `Row type`
   column was added to prevent. */
check('no sponsor row is typed as Detail',
  sl.filter((l) => /Sponsor/.test(l) && /,Detail,/.test(l)), []);
check('detail rows still sum to the camp total, sponsorship excluded',
  sumOf(sl.filter((l) => /,Detail,/.test(l))), 2350);

console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'All checks passed.'));
process.exit(failures ? 1 : 0);
