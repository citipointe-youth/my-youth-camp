/*
 * Budget WORKBOOK harness (2026-08-04). Replaces budget-csv-harness.js.
 *
 * The budget export became a styled three-sheet .xlsx after the owner reported it was "hard to
 * read when there is several rows labelled for each church" and asked for Excel formatting to
 * separate a total from the lower-level detail.
 *
 * Two reasons this needs a harness rather than trust:
 *
 *  1. **The workbook is written BY HAND** (`_xlsxBlob` / `_xlSheetXml` / `_XL_STYLES` in
 *     public/index.html), because the vendored SheetJS is the Community build and silently
 *     discards bold and fills on write. Hand-built OOXML fails in the worst possible way — Excel
 *     says "we found a problem with some content" and names nothing. Two rules in particular
 *     corrupt the file and are asserted below: fills[0]/fills[1] are RESERVED (`none`, `gray125`),
 *     and the children of <worksheet> have a schema-fixed order.
 *
 *  2. **The CSV's hard-won arithmetic properties had to survive the format change.** The
 *     `Row type` column exists because summing every row double-counts every subtotal; that trap
 *     has to stay visible, and sponsorship — money that has NOT arrived — must stay out of the
 *     received column.
 *
 * This is browser-only code, so vitest cannot reach it.
 *
 *   node scripts/budget-xlsx-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* Pulls one top-level declaration out of the SPA by its opening text.
 *
 * More careful than the extractor the CSV harness used, and it has to be: the writers below
 * contain string literals holding `;` (`&quot;` inside the styles XML), an IIFE whose closing
 * brace is NOT the end of the statement (`const _CRC_T=(function(){…})();`), and regex literals
 * containing a quote character (`/[&<>"']/g`). The naive version truncated all three — silently,
 * in the middle of a string, producing a syntax error 100 lines later that pointed at the wrong
 * function. So: skip comments, skip string/template literals, skip regex literals, and balance
 * (), [] and {} together, ending on the first `;` at depth 0.
 */
function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false, prev = '';
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === '/' && SRC[j + 1] === '/') { j = SRC.indexOf('\n', j); if (j < 0) break; continue; }
    if (ch === '/' && SRC[j + 1] === '*') { j = SRC.indexOf('*/', j) + 1; continue; }
    // Regex literal, by the usual heuristic: a `/` in a position where a value may begin.
    if (ch === '/' && '(,=:[!&|?{};+'.indexOf(prev) >= 0) {
      j++;
      while (j < SRC.length && SRC[j] !== '/') { if (SRC[j] === '\\') j++; j++; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; j++;
      while (j < SRC.length && SRC[j] !== q) { if (SRC[j] === '\\') j++; j++; }
      prev = q;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; if (ch === '{') started = true; }
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (started && depth === 0 && ch === '}') return SRC.slice(i, j + 1);
    } else if (ch === ';' && depth === 0) return SRC.slice(i, j + 1);
    if (!/\s/.test(ch)) prev = ch;
  }
  throw new Error('unbalanced extraction for ' + decl);
}

let savedBlob = null, savedName = null;
const ctx = {
  console, JSON, Object, String, Number, Math, Array, Date, RegExp, Map, Set, isFinite, Promise,
  Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, TextEncoder, Response, Error,
  CompressionStream: typeof CompressionStream === 'function' ? CompressionStream : undefined,
  sel: () => 'all',
  toast: () => {},
  document: { getElementById: () => null },
  _exportName: (base, ext) => base + '.' + ext,
  _rlSaveBlob: (blob, name) => { savedBlob = blob; savedName = name; },
  computeBudgetClient: null,   // stubbed below
  SETTINGS: { year: 2026, discountCodeTags: {}, tentPrice: null, classroomPrice: null },
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
  // The zip + xlsx writers, real. Nothing here is reimplemented for the test.
  'const _CRC_T=', 'function _crc32(u8)', 'async function _deflateRaw(u8)',
  'function _dosDateTime(d)', 'async function _zipBlob(entries)',
  'function _xmlEsc(s)', 'function _xlCol(i)', 'const XS=', 'const _XL_STYLES=',
  'function _xc(v,s)', 'function _xn(v,s)', 'function _xlSheetXml(sheet)',
  'function _xlSheetName(n)', 'async function _xlsxBlob(sheets)',
  'async function exportBudget()',
].map(extract).join('\n')
  // `const` is a lexical declaration and does NOT become a property of the vm context the way a
  // function declaration does — without this the harness sees `undefined`.
  + '\nglobalThis._BUD_CLASSES=_BUD_CLASSES;globalThis._SPONSOR_TAG_LABEL=_SPONSOR_TAG_LABEL;'
  + 'globalThis.XS=XS;globalThis._XL_STYLES=_XL_STYLES;', ctx);

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

/* ---- a minimal unzip, so the assertions are made against the REAL bytes the browser saves ---- */
function unzip(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length - 4 && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18), usize = buf.readUInt32LE(i + 22);
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString();
    const data = buf.slice(i + 30 + nlen + elen, i + 30 + nlen + elen + csize);
    const raw = method === 8 ? zlib.inflateRawSync(data) : data;
    if (raw.length !== usize) throw new Error('size mismatch in ' + name);
    out[name] = raw.toString('utf8');
    i += 30 + nlen + elen + csize;
  }
  return out;
}
/* Parse a sheet into a grid of {v,s,text} keyed by cell ref, plus rows in order. */
function parseSheet(xml) {
  const rows = [];
  const rowRe = /<row r="(\d+)">([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    const r = Number(m[1]), cells = [];
    const cellRe = /<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?(?: t="inlineStr")?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cellRe.exec(m[2]))) {
      const inner = c[4] || '';
      const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      const v = /<v>([^<]*)<\/v>/.exec(inner);
      cells.push({
        col: c[1], s: c[3] == null ? 0 : Number(c[3]),
        text: t ? t[1] : null, num: v ? Number(v[1]) : null,
      });
    }
    rows[r - 1] = cells;
  }
  return rows;
}
const cellAt = (row, col) => (row || []).find((c) => c.col === col) || null;
const parts0 = (p) => [...p['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((x) => x[1]);

const row = (key, count, amount, lineTotal, codeHint) =>
  ({ key, count, amount, lineTotal, codeHint: codeHint || null, label: 'ignored' });

ctx.computeBudgetClient = () => ({
  churches: [
    {
      churchName: 'Citipointe, Carindale',
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
  camperCount: 17, leaderCount: 2, churchCount: 2, grandTotal: 2350,
});

/* The owner's exact sponsorship case, needed before the first export so the whole workbook is
   built once. YC26SPON is a FULL sponsorship spanning two tent prices; YC26HALF is a part
   sponsorship. One place is deliberately unpriceable, to prove it is counted and flagged rather
   than silently totalled as $0 (which would read as "already covered"). */
const EARLY = 'EARLY BIRD | Tent Accomodation', STD = 'Tent Accomodation';
const person = (o) => Object.assign({
  churchId: 'c1', churchName: 'Victory', kind: 'camper', status: 'active',
  registrationCost: null, amountPaid: null, discountCode: null,
  accommodationKind: 'tent', registrationType: null,
}, o);
const SPONSOR_REGS = [
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

(async function run() {
  console.log('\n0. With nothing to ask for, there is no sponsorship block at all');
  /* A heading over an empty block invites the reader to go looking for a number that does not
     exist. The card on the Budget screen hides itself the same way. */
  await ctx.exportBudget();
  checkTrue('the export produced a file', !!savedBlob, 'nothing reached _rlSaveBlob');
  check('filename extension', savedName, 'budget-by-church.xlsx');
  check('blob mime type', savedBlob.type,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bare = unzip(Buffer.from(await savedBlob.arrayBuffer()));
  const bareRows = parseSheet(bare['xl/worksheets/sheet2.xml']);
  checkTrue('the sheet ends at the camp total',
    (cellAt(bareRows[bareRows.length - 1], 'B') || {}).text === 'Camp total');
  checkTrue('the word "Sponsor" appears nowhere',
    bare['xl/worksheets/sheet2.xml'].indexOf('Sponsor') < 0);
  /* The heading specifically — the closing explanatory note always mentions sponsorship, and
     should, since "money received" is only meaningful against the gap it leaves. */
  checkTrue('and the summary carries no sponsorship SECTION',
    parseSheet(bare['xl/worksheets/sheet1.xml'])
      .every((r) => ((cellAt(r, 'A') || {}).text || '') !== 'Sponsorship still needed'));

  ctx.SETTINGS.discountCodeTags = { YC26SPON: 'sponsor', YC26HALF: 'discount', YC26CASH: 'inperson' };
  ctx.window._budgetRegs = SPONSOR_REGS;
  await ctx.exportBudget();
  const buf = Buffer.from(await savedBlob.arrayBuffer());
  const parts = unzip(buf);

  console.log('\n1. It is a structurally valid xlsx package');
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml'].forEach((p) => checkTrue('contains ' + p, !!parts[p]));
  const wbNames = parts0(parts);
  check('two sheets, summary first', wbNames, ['Summary', 'By ministry']);
  checkTrue('no stray third worksheet', !parts['xl/worksheets/sheet3.xml']);
  // Every sheet the workbook declares must have a relationship AND a content-type override, or
  // Excel repairs the file by silently dropping the sheet.
  wbNames.forEach((n, i) => {
    checkTrue('sheet' + (i + 1) + ' has a relationship',
      parts['xl/_rels/workbook.xml.rels'].indexOf('worksheets/sheet' + (i + 1) + '.xml') > 0);
    checkTrue('sheet' + (i + 1) + ' has a content-type override',
      parts['[Content_Types].xml'].indexOf('/xl/worksheets/sheet' + (i + 1) + '.xml') > 0);
  });
  // Styles take the relationship id AFTER the sheets — off by one and the workbook opens with
  // every style silently reset to default.
  checkTrue('styles.xml is related from the workbook, after the sheets',
    new RegExp('Id="rId' + (wbNames.length + 1) + '"[^>]+styles\\.xml')
      .test(parts['xl/_rels/workbook.xml.rels']), parts['xl/_rels/workbook.xml.rels']);

  console.log('\n2. The two rules that corrupt the file with no error message');
  const fills = [...parts['xl/styles.xml'].matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((x) => x[1]);
  checkTrue('fills[0] is the reserved "none"', /patternType="none"/.test(fills[0]), fills[0]);
  checkTrue('fills[1] is the reserved "gray125"', /patternType="gray125"/.test(fills[1]), fills[1]);
  checkTrue('real colours start at fills[2]', /solid/.test(fills[2]));
  const s2 = parts['xl/worksheets/sheet2.xml'];
  const order = ['<sheetViews', '<cols', '<sheetData', '<autoFilter'].map((t) => s2.indexOf(t));
  checkTrue('worksheet children are in schema order (views, cols, data, filter)',
    order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  const declaredXfs = Number(/<cellXfs count="(\d+)"/.exec(parts['xl/styles.xml'])[1]);
  const actualXfs = (parts['xl/styles.xml'].match(/<xf [^>]*xfId="0"/g) || []).length;
  check('cellXfs count matches the number of xf entries', declaredXfs, actualXfs);
  const maxStyle = Math.max(...Object.values(ctx.XS));
  checkTrue('every named style index exists in cellXfs', maxStyle < declaredXfs,
    'XS max ' + maxStyle + ' vs count ' + declaredXfs);
  checkTrue('a bold font is actually declared (the whole point of not using SheetJS)',
    /<font><b\/>/.test(parts['xl/styles.xml']));

  console.log('\n3. "By ministry" — the hierarchy the owner asked to be able to see');
  const g = parseSheet(s2);
  check('header text', g[0].map((c) => c.text),
    ['Church', 'Row type', 'Audience', 'Accommodation', 'Payment type', 'Discount code',
      'People', 'Unit price', 'Line total']);
  checkTrue('every header cell uses the header style', g[0].every((c) => c.s === ctx.XS.HEAD));
  checkTrue('the header row is frozen', /<pane ySplit="1"/.test(s2));
  checkTrue('the data range is filterable', /<autoFilter ref="A1:I8"\/>/.test(s2), s2.slice(-200));

  /* ⚠ THE CHURCH TOTAL LEADS ITS BLOCK (owner, 2026-08-04 5th-b) — scrolling the sheet reads as
     a list of ministry totals with the working underneath, rather than a total that has to be
     hunted for at the bottom of a block whose length varies. The row indices below ARE the
     layout, deliberately: if someone flips the order back, these fail rather than drift. */
  check('the church total comes FIRST in the block',
    g[1].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Church total', null, null, null, null, 15, null, 2350]);
  // `null` below means an EMPTY cell — a styled blank carries neither text nor a <v>.
  check('then its detail, a full-price classroom student row',
    g[2].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Detail', 'Student', 'Classroom', 'Full price', null, 10, 190, 1900]);
  check('an in-person tent row carries its code', g[3].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Detail', 'Student', 'Tent', 'Paid in person', 'YC26CASH', 3, 150, 450]);
  check('a sponsored leader row', g[4].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Detail', 'Leader', 'Classroom', 'Full sponsor', 'YC26LDR', 2, 0, 0]);
  check('the next ministry starts with its own total',
    g[5].map((c) => c.text != null ? c.text : c.num),
    ['Grace Point', 'Church total', null, null, null, null, 4, null, 0]);
  /* The owner's actual complaint: the repeated church label competing with the numbers. It is
     still THERE (the sheet has to stay filterable) but it recedes to the muted style. */
  checkTrue('the repeated church name is muted, not deleted',
    cellAt(g[2], 'A').text === 'Citipointe, Carindale' && cellAt(g[2], 'A').s === ctx.XS.MUTED);
  checkTrue('detail figures use the plain number/money styles',
    cellAt(g[2], 'G').s === ctx.XS.NUM && cellAt(g[2], 'I').s === ctx.XS.MONEY);

  const churchTot = g[1];
  check('church subtotal is labelled, not disguised as a detail row',
    [cellAt(churchTot, 'B').text, cellAt(churchTot, 'G').num, cellAt(churchTot, 'I').num],
    ['Church total', 15, 2350]);
  checkTrue('the subtotal row is bold-on-lavender across every column',
    churchTot.length === 9 && churchTot.every((c) => [ctx.XS.TOT_T, ctx.XS.TOT_N, ctx.XS.TOT_M].indexOf(c.s) >= 0),
    JSON.stringify(churchTot.map((c) => c.s)));
  /* A styled BLANK still has to be emitted or the fill stops halfway across the row — which is
     exactly the visual cue this change exists to add. */
  checkTrue('blank cells in a total row are still emitted (so the fill runs the full width)',
    cellAt(churchTot, 'C') != null && cellAt(churchTot, 'C').text == null);

  /* "Accommodation not recorded" has no payment class, and its unit price is UNKNOWN — a 0 there
     would read as "free" while the line total said otherwise. */
  check('unrecorded accommodation, blank unit price (NOT 0)',
    g[6].map((c) => c.text != null ? c.text : c.num),
    ['Grace Point', 'Detail', 'Student', 'Not recorded', null, null, 4, null, 0]);
  checkTrue('the blank unit price carries no <v> element at all',
    !/<c r="H7"[^>]*>/.test(s2) || /<c r="H7" s="\d+"\/>/.test(s2));

  const campTot = g[7];
  check('camp total row', [cellAt(campTot, 'B').text, cellAt(campTot, 'G').num, cellAt(campTot, 'I').num],
    ['Camp total', 19, 2350]);
  checkTrue('the camp total is visually distinct from a church total',
    cellAt(campTot, 'A').s === ctx.XS.GRAND_T && cellAt(campTot, 'A').s !== ctx.XS.TOT_T);
  /* "Camper" was the last user-facing use of that word in an export — the app says "student". */
  checkTrue('the word "Camper" appears nowhere in the workbook',
    Object.values(parts).every((p) => p.indexOf('Camper') < 0));
  /* The em dash is what broke the CSV (no BOM → `â€"` in Windows-1252). An xlsx is UTF-8 XML, so
     the fix is structural — but assert it, because it is the entire reported symptom. */
  checkTrue('an em dash round-trips as real UTF-8',
    parts['xl/worksheets/sheet1.xml'].indexOf('—') > 0);

  console.log('\n4. The arithmetic trap the Row type column exists to keep visible');
  const lineTotals = g.slice(1).map((r) => (cellAt(r, 'I') || {}).num).map((n) => n || 0);
  const detailSum = g.slice(1)
    .filter((r) => (cellAt(r, 'B') || {}).text === 'Detail')
    .reduce((s, r) => s + ((cellAt(r, 'I') || {}).num || 0), 0);
  check('detail rows alone sum to the camp total', detailSum, 2350);
  checkTrue('summing EVERY row would have double-counted (this is the trap)',
    lineTotals.reduce((a, b) => a + b, 0) !== 2350,
    'got ' + lineTotals.reduce((a, b) => a + b, 0));

  console.log('\n5. Class-key splitting covers every class in the table');
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

  console.log('\n6. Sponsorship — the early-bird / full-price differential');
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

  /* ⚠ The bands are NOT printed any more (owner, 2026-08-04 5th-b) — the export carries the
     per-ministry, per-code breakdown only. The differential still EXISTS, as the checks above
     prove; it is visible on the Budget screen's Sponsorship card. This assertion is what stops
     someone concluding from the export that `bands` is dead and deleting it. */
  const val = (r) => r.map((c) => c.text != null ? c.text : c.num);
  const kind = (r) => (cellAt(r, 'B') || {}).text;
  checkTrue('no band row is printed', g.filter((r) => kind(r) === 'Sponsor band').length === 0);
  /* Biggest ask first, not alphabetical — Victory's 545 outranks Grace Point's 380. This is the
     order a director works down when deciding who to chase. */
  check('per-ministry rows, biggest ask first, on the By ministry sheet',
    g.filter((r) => kind(r) === 'Sponsor by ministry').map(val), [
      ['Victory', 'Sponsor by ministry', null, null, 'Full sponsorship', 'YC26SPON', 4, null, 450],
      ['Victory', 'Sponsor by ministry', null, null, 'Part sponsored', 'YC26HALF', 1, null, 95],
      ['Grace Point', 'Sponsor by ministry', null, null, 'Full sponsorship', 'YC26SPON', 2, null, 380],
    ]);
  const spTot = g.find((r) => kind(r) === 'Sponsor total');
  check('camp sponsor total', [cellAt(spTot, 'G').num, cellAt(spTot, 'I').num], [7, 925]);

  /* 🔴 THE LOAD-BEARING ONE. Sponsorship shared a sheet with the received money again from
     2026-08-04 (5th-b), so the separation is no longer structural — it now rests on the three
     things checked here. If any one of them goes, a reader summing the Line total column adds
     money that has not arrived to money that has. */
  console.log('\n7. Sponsorship cannot leak into "money received"');
  check('1/3 — no sponsor row is typed as Detail',
    g.filter((r) => kind(r) === 'Detail' && /Sponsor/.test(JSON.stringify(val(r)))).length, 0);
  const campTotIdx = g.findIndex((r) => kind(r) === 'Camp total');
  const firstSponIdx = g.findIndex((r) => /Sponsor/.test(((cellAt(r, 'A') || {}).text || '') + ((cellAt(r, 'B') || {}).text || '')));
  checkTrue('2/3 — a blank spacer row separates the two tables',
    (g[campTotIdx + 1] || []).length === 0 && firstSponIdx > campTotIdx + 1,
    'campTotal@' + campTotIdx + ' firstSponsor@' + firstSponIdx);
  checkTrue('    …and the block is introduced by a heading, not left to be inferred',
    /Sponsorship still needed/.test((cellAt(g[campTotIdx + 2], 'A') || {}).text || ''));
  checkTrue('3/3 — the autofilter stops at the received table',
    new RegExp('<autoFilter ref="A1:I' + (campTotIdx + 1) + '"').test(s2),
    'filter must not span the sponsorship block');
  check('detail rows still sum to the camp total, sponsorship excluded',
    g.slice(1).filter((r) => kind(r) === 'Detail')
      .reduce((t, r) => t + ((cellAt(r, 'I') || {}).num || 0), 0), 2350);

  console.log('\n7b. Summary — the rows the owner asked to be removed stay removed');
  const sm = parseSheet(parts['xl/worksheets/sheet1.xml']);
  const smText = sm.map((r) => (cellAt(r, 'A') || {}).text || '');
  checkTrue('no "Ministries" row', smText.every((t) => t !== 'Ministries'));
  checkTrue('no Reconciliation section', smText.every((t) => !/Reconciliation/.test(t)));
  checkTrue('no "Value of every place" row', smText.every((t) => !/Value of every place/.test(t)));
  /* A headcount beside an ask invites "$830 ÷ 6 places" — the per-place average the band split
     exists to avoid. The count still drives the unpriced warning; it is just not a figure. */
  const sponHead = sm[smText.findIndex((t) => t === 'Sponsorship still needed') + 1];
  check('the sponsorship table has no Places column', val(sponHead), ['Item', null, 'Amount']);
  sm.forEach((r, i) => {
    if (!/sponsorship|sponsored|still needed/i.test(smText[i] || '')) return;
    checkTrue('"' + smText[i] + '" carries no headcount', (cellAt(r, 'B') || {}).num == null);
  });
  check('the received table still reports both audiences',
    smText.filter((t) => t === 'Students' || t === 'Leaders'), ['Students', 'Leaders']);

  console.log('\n8. An independent parser can read it back');
  /* The vendored SheetJS cannot WRITE the styles, but it is a completely separate implementation
     of the READ side — so if it can open the workbook and land the values in the right cells, the
     package is not merely well-formed XML, it is a real xlsx. */
  const sjCtx = { console, Date, Math, JSON, Uint8Array, ArrayBuffer, Buffer, TextDecoder, TextEncoder, setTimeout };
  sjCtx.window = sjCtx; sjCtx.self = sjCtx; sjCtx.global = sjCtx;
  vm.createContext(sjCtx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'xlsx.full.min.js'), 'utf8'), sjCtx);
  const wb = sjCtx.XLSX.read(Buffer.from(await savedBlob.arrayBuffer()), { type: 'buffer' });
  check('SheetJS sees the same two sheets', wb.SheetNames, ['Summary', 'By ministry']);
  const ws = wb.Sheets['By ministry'];
  check('SheetJS reads the header', ws['A1'].v, 'Church');
  check('SheetJS reads the leading church total', ws['I2'].v, 2350);
  check('SheetJS reads a detail line total as a NUMBER', [ws['I3'].v, ws['I3'].t], [1900, 'n']);
  check('SheetJS reads the camp total', ws['I8'].v, 2350);
  check('SheetJS reads the comma-containing church name intact', ws['A2'].v, 'Citipointe, Carindale');
  check('SheetJS reads the appended sponsorship total', ws['I14'].v, 925);

  /* Everything above proves the bytes are what we intended. Only Excel itself proves Excel is
     happy with them, and that cannot run in CI — so it is an opt-in dump rather than a check:
       BUDGET_XLSX_OUT=C:/tmp/budget.xlsx node scripts/budget-xlsx-harness.js
     then open it, or drive it over COM (see the 2026-08-04 section of CLAUDE.md for the script
     that reads Font.Bold / Interior.Color / NumberFormat back out). */
  if (process.env.BUDGET_XLSX_OUT) {
    fs.writeFileSync(process.env.BUDGET_XLSX_OUT, buf);
    console.log('\nwrote ' + process.env.BUDGET_XLSX_OUT + ' (' + buf.length + ' bytes)');
  }

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'All checks passed.'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
