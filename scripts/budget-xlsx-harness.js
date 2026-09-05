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
  // Match on everything up to the '(' — the NAME is stable, the parameter list is not.
  // A full-signature match silently rotted for a month when `tag` was appended to
  // _personValue and _sponsorAmountFor on 2026-08-05, and the harness threw on startup
  // rather than reporting a failure, so nobody noticed it had stopped running.
  const paren = decl.indexOf('(');
  const stem = paren < 0 ? decl : decl.slice(0, paren + 1);
  const i = SRC.indexOf(stem);
  if (i < 0) throw new Error('not found in index.html: ' + stem);
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

let savedBlob = null, savedName = null, lastToast = null;
const ctx = {
  console, JSON, Object, String, Number, Math, Array, Date, RegExp, Map, Set, isFinite, Promise,
  Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, TextEncoder, Response, Error,
  CompressionStream: typeof CompressionStream === 'function' ? CompressionStream : undefined,
  sel: () => 'all',
  toast: (msg) => { lastToast = msg; },
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
  'const _BUD_CLASSES=', 'function _budAccom(cls)', 'function _budPayment(cls)', 'function _budCodeType(row,tags)',
  // The sponsorship path runs for real — it is the only way to prove the differential survives
  // into the spreadsheet, so every function it touches is extracted rather than stubbed.
  'function _normTicketType(t)', 'function _budTicketPrices(regs)', 'function _priceForTicket(table,t)',
  'function _resolveTicketPrice(p,table)', 'function _discountTagFor(p,tags)',
  'function _isUnclassifiedDiscount(p,tags)',
  'function _personValue(p,cls,prices,ticketPrice,tag)', 'function _personValueBase(p,cls,prices,ticketPrice,tag)',
  'function _classifyTicket(p,tags)', 'function _budPrices()', 'function _budTags()',
  'function _budRowLabel(cls,amount)', 'function _budValueBreakdown(b)', 'function _budScopeRows(people,tags,prices,ptable)',
  'function _budExportRows(people,tags,prices,ptable)',
  'function _sponsorAmountFor(p,cls,prices,ticketPrice,tag)', 'const _SPONSOR_TAGS=',
  'const _SPONSOR_TAG_LABEL=', 'function _sponsorBands(entries)',
  'function computeSponsorSummaryClient(regs,filterId)', 'function _sponsorByTotal(a,b)',
  // Only ever reached through the UNCLASSIFIED branch — dead in every fixture until Task 5 added
  // one. Its absence here made the second exportBudget() call throw internally, get swallowed by
  // its own try/catch, and leave every downstream check reading a stale, untagged workbook.
  'function _avgDiscountPct(pairs)',
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
/* exportBudget's own catch swallows every internal error into a toast — found the hard way while
   building this: a missing extraction (`_avgDiscountPct`) made the SECOND export throw silently,
   and `_rlSaveBlob` never ran, so every check below kept reading the FIRST (untagged) run's blob
   and failed with confusing, unrelated-looking diffs instead of the real ReferenceError. Call this
   after every `await ctx.exportBudget()` so a broken build fails loudly, at the point it broke. */
function assertExportOk() {
  checkTrue('exportBudget did not fail internally', !lastToast || !/Could not build/.test(lastToast), lastToast);
}

/* The extractor matches on a name prefix, so a renamed FUNCTION still throws (good) while a
   changed parameter list does not (also good). This asserts the sandbox actually got a callable
   for each name we depend on — a typo'd name would otherwise surface as a confusing TypeError
   several hundred lines below.
   ⚠️ `_budExportRows` was added in Task 4 — it did not exist when this list was first written. */
['_budScopeRows', '_budExportRows', '_budCodeType', '_personValue', '_sponsorAmountFor',
 'computeSponsorSummaryClient', 'exportBudget', '_xlsxBlob'].forEach((n) => {
  checkTrue('sandbox exposes ' + n, typeof ctx[n] === 'function');
});

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

/* `computeBudgetClient` is stubbed (never extracted) — exportBudget's church loop no longer reads
   `c.campers`/`c.leaders` (2026-09-05: it re-groups from `c._people` via `_budExportRows`), so
   the stub now carries RAW PEOPLE, exactly what Task 5's `_people:[...c.campers,...c.leaders]`
   addition to the real `computeBudgetClient` would hand it. `camperCount`/`leaderCount`/`total`
   stay hand-supplied (computeBudgetClient itself is not extracted, so nothing recomputes them). */
const budPerson = (o) => Object.assign({
  churchId: 'c1', churchName: 'Citipointe, Carindale', kind: 'camper', status: 'registered',
  registrationCost: null, amountPaid: null, amountPaidOverride: null, refundAmount: null,
  discountCode: null, discountAmount: null, accommodationKind: 'classroom', registrationType: null,
}, o);
const CARINDALE_PEOPLE = [
  ...Array.from({ length: 10 }, () => budPerson({ registrationCost: 190, amountPaid: 190 })),
  ...Array.from({ length: 3 }, () => budPerson({
    accommodationKind: 'tent', registrationCost: 150, amountPaid: 0, discountCode: 'YC26CASH' })),
  ...Array.from({ length: 2 }, () => budPerson({
    kind: 'leader', registrationCost: 190, amountPaid: 0, discountCode: 'YC26LDR' })),
];
const GRACE_PEOPLE = Array.from({ length: 4 }, () => budPerson({
  churchId: 'c2', churchName: 'Grace Point', accommodationKind: null }));
ctx.computeBudgetClient = () => ({
  churches: [
    {
      churchName: 'Citipointe, Carindale', churchId: 'c1',
      camperCount: 13, leaderCount: 2, total: 2350, _people: CARINDALE_PEOPLE,
    },
    {
      churchName: 'Grace Point', churchId: 'c2',
      camperCount: 4, leaderCount: 0, total: 0, _people: GRACE_PEOPLE,
    },
  ],
  camperCount: 17, leaderCount: 2, churchCount: 2, grandTotal: 2350,
});

/* The owner's exact sponsorship case, needed before the first export so the whole workbook is
   built once. YC26SPON is a FULL sponsorship spanning two tent prices; YC26HALF is a part
   sponsorship. One place is deliberately unpriceable, to prove it is counted and flagged rather
   than silently totalled as $0 (which would read as "already covered"). MYSTERY is a code the
   admin has never tagged — the report-never-infer case Task 5 exists for. */
const EARLY = 'EARLY BIRD | Tent Accomodation', STD = 'Tent Accomodation';
const person = (o) => Object.assign({
  churchId: 'c1', churchName: 'Victory', kind: 'camper', status: 'active',
  registrationCost: null, amountPaid: null, discountCode: null, discountAmount: null,
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
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26SPON', amountPaid: 0,
    churchId: 'c2', churchName: 'Grace Point' }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26SPON', amountPaid: 0,
    churchId: 'c2', churchName: 'Grace Point' }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26HALF', amountPaid: 60 }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26HALF', amountPaid: 60 }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26HALF', amountPaid: 60 }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26HALF', amountPaid: 60 }),
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26HALF', amountPaid: 60 }),
  // No cost, no ticket type, no accommodation kind → no source can price it.
  person({ discountCode: 'YC26SPON', accommodationKind: null, amountPaid: 0 }),
  // In-person money DID arrive; it must never appear as an ask.
  person({ registrationType: STD, registrationCost: 190, discountCode: 'YC26CASH', amountPaid: 0 }),
  // Untagged. `discountAmount` is what proves the flag survives 2026-09-05's fix — without it
  // this would still be caught by the weaker amountPaid<registrationCost fallback, which is
  // exactly the false confidence the fix exists to remove.
  person({ registrationCost: 190, amountPaid: 50, discountCode: 'MYSTERY', discountAmount: 140 }),
  person({ registrationCost: 190, amountPaid: 50, discountCode: 'MYSTERY', discountAmount: 140 }),
];

console.log('\n0. _budExportRows — grouping and totality');
{
  const tags = { SPON: 'sponsor', EFT: 'inperson' };
  const prices = { tent: null, classroom: null };
  const P = (o) => Object.assign({
    churchId: 'c1', churchName: 'Carindale', kind: 'camper',
    registrationCost: 190, amountPaid: 190, accommodationKind: 'classroom',
    discountCode: null, discountAmount: null, status: 'registered',
  }, o);
  const people = [
    P({}), P({}),                                                  // plain, no code
    P({ discountCode: 'SPON', amountPaid: 0, discountAmount: 190 }),// tagged sponsor
    P({ discountCode: 'EFT', amountPaid: 0, discountAmount: 190 }), // tagged in person
    P({ discountCode: 'MYSTERY', amountPaid: 0, discountAmount: 190 }), // untagged
    P({ accommodationKind: null }),                                // unknown accommodation
    P({ status: 'cancelled' }),                                    // cancelled, still counted
    P({ amountPaid: null, registrationCost: null }),               // nothing recorded
    P({ amountPaid: 150 }),                                        // same key as the plain pair —
                                                                     // a GENUINE differing value,
                                                                     // proving "mixed" means null,
                                                                     // never 0 (review finding B)
    P({ discountCode: 'DUPTEST', discountAmount: 0 }),              // shares DUPTEST with the next
                                                                     // person but carries NO evidence
                                                                     // itself (amountPaid===cost)
    P({ discountCode: 'DUPTEST', discountAmount: 190, amountPaid: 0 }), // same code, but THIS one
                                                                     // is genuinely unclassified —
                                                                     // the shared row must still flag
  ];
  const rows = ctx._budExportRows(people, tags, prices, new Map());

  checkTrue('every person lands on exactly one row',
    rows.reduce((s, r) => s + r.count, 0) === people.length,
    'Σ count=' + rows.reduce((s, r) => s + r.count, 0) + ' people=' + people.length);
  checkTrue('rows are split by code', rows.some((r) => r.code === 'SPON') && rows.some((r) => r.code === 'MYSTERY'));
  checkTrue('an untagged discount row is flagged',
    rows.find((r) => r.code === 'MYSTERY').unclassified === true);
  checkTrue('a tagged row is not flagged',
    rows.find((r) => r.code === 'SPON').unclassified === false);
  check('cancelled is counted within its row',
    rows.reduce((s, r) => s + r.cancelled, 0), 1);
  // Review finding A (2026-09-06): two people can share one untagged code and disagree on whether
  // EITHER of them individually looks like a discount — the row must flag if ANY member does.
  // The first DUPTEST person alone would create the bucket with unclassified:false; only the
  // SECOND person supplies the evidence. If the accumulation were a plain overwrite (or, worse, a
  // single assignment at bucket-creation time) this would silently read false.
  checkTrue('a code shared by an evidenced and an unevidenced person is still flagged',
    rows.find((r) => r.code === 'DUPTEST').unclassified === true);
  // Review finding B (2026-09-06): the old assertion here (`=== null || typeof === 'number'`)
  // could never fail — `typeof 0 === 'number'` — so a row that wrongly reported 0 instead of null
  // would have passed silently. Target two SPECIFIC rows instead: the one with genuinely differing
  // effective values (some 190, one 150, one missing) must report null, never 0; a row where every
  // member agrees must report its real number, not null.
  const mixedRow = rows.find((r) => r.key === 'classroom' && r.code === '');
  checkTrue('a genuinely mixed row reports a null unit price, never 0',
    !!mixedRow && mixedRow.effAmount === null,
    'effAmount=' + JSON.stringify(mixedRow && mixedRow.effAmount));
  const uniformRow = rows.find((r) => r.code === 'EFT');
  checkTrue('a uniform row reports its real number, not null',
    !!uniformRow && uniformRow.effAmount === 190,
    'effAmount=' + JSON.stringify(uniformRow && uniformRow.effAmount));
  // NOTE (Task 4 adjustment): the brief's arithmetic assumed the EFT (in-person) person values at
  // their overridden amountPaid (0). The real, unchanged `_personValue`/`_personValueBase` cascade
  // deliberately does NOT read amountPaid for an in-person-tagged code — "the money was collected
  // by hand, so no invoice records it" — it substitutes the resolved TICKET PRICE instead. Here
  // that person's `registrationCost` is the P() default (190, never overridden), so
  // `_resolveTicketPrice` returns 190 and their effective value is 190, not 0.
  // Per-person effective values, in fixture order: 190,190,0(sponsor),190(in-person, priced off
  // registrationCost),0(untagged),190(unknown accommodation, falls through to amountPaid),
  // 190(cancelled, same fallback),null(missing),150(the new differing-value person),
  // 190(DUPTEST #1, amountPaid default),0(DUPTEST #2, amountPaid:0).
  checkTrue('effTotal is the exact sum of member values',
    Math.abs(rows.reduce((s, r) => s + r.effTotal, 0)
      - (190 + 190 + 0 + 190 + 0 + 190 + 190 + 0 + 150 + 190 + 0)) < 0.001);
}

(async function run() {
  console.log('\n0. With nothing to ask for, there is no sponsorship block at all');
  /* A heading over an empty block invites the reader to go looking for a number that does not
     exist. The card on the Budget screen hides itself the same way. */
  await ctx.exportBudget();
  assertExportOk();
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

  // YC26LDR classifies the Carindale sponsor-leader fixture; MYSTERY is deliberately absent —
  // that is the whole point of it.
  ctx.SETTINGS.discountCodeTags = { YC26SPON: 'sponsor', YC26HALF: 'discount', YC26CASH: 'inperson', YC26LDR: 'sponsor' };
  ctx.window._budgetRegs = SPONSOR_REGS;
  // `window._budgetFetch` is a LATER task's field (Task 6); exportBudget's read of it degrades to
  // null when absent. Simulated here, deliberately mismatched against `printed` (19), so this run
  // proves the reconciliation can actually FIRE rather than always reading "0 OK".
  ctx.window._budgetFetch = { count: 20 };
  await ctx.exportBudget();
  assertExportOk();
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
  const HEAD_EXPECT = ['Church', 'Row type', 'Audience', 'Accommodation', 'Code used', 'Code type',
    'Number', 'Raw invoice value', 'Effective $ to budget per ticket', 'Effective $ to budget total', 'Cancelled'];
  check('header text', g[0].map((c) => c.text), HEAD_EXPECT);
  checkTrue('every header cell uses the header style', g[0].every((c) => c.s === ctx.XS.HEAD));
  checkTrue('the header row is frozen', /<pane ySplit="1"/.test(s2));
  // The sheet is 11 columns wide since the Code-used/Code-type/raw-vs-effective rewrite
  // (2026-09-05, was 10/J). The filter range moved J → K.
  checkTrue('the data range is filterable', /<autoFilter ref="A1:K8"\/>/.test(s2), s2.slice(-200));

  /* ⚠ THE CHURCH TOTAL LEADS ITS BLOCK (owner, 2026-08-04 5th-b) — scrolling the sheet reads as
     a list of ministry totals with the working underneath, rather than a total that has to be
     hunted for at the bottom of a block whose length varies. The row indices below ARE the
     layout, deliberately: if someone flips the order back, these fail rather than drift.
     ⚠ Detail rows are now sorted by _BUD_CLASSES order (2026-09-05), and `tent-inperson` (index 1)
     sorts BEFORE `classroom` (index 4) — so the in-person tent row comes FIRST within Carindale's
     block, not the classroom row. That is a real behaviour change from the old export, not a typo
     here. */
  // Trailing 0 below is the Cancelled column — a per-row/per-block count of cancelled people, 0
  // here since none of the fixture's people are cancelled.
  check('the church total comes FIRST in the block',
    g[1].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Church total', null, null, null, null, 15, null, null, 2350, 0]);
  // `null` below means an EMPTY cell — a styled blank carries neither text nor a <v>.
  check('then its detail, an in-person tent row carrying its code',
    g[2].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Detail', 'Student', 'Tent', 'YC26CASH', 'Paid in person', 3, 0, 150, 450, 0]);
  check('a full-price classroom student row', g[3].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Detail', 'Student', 'Classroom', null, 'Full price', 10, 190, 190, 1900, 0]);
  check('a sponsored leader row', g[4].map((c) => c.text != null ? c.text : c.num),
    ['Citipointe, Carindale', 'Detail', 'Leader', 'Classroom', 'YC26LDR', 'Full sponsor', 2, 0, 0, 0, 0]);
  check('the next ministry starts with its own total',
    g[5].map((c) => c.text != null ? c.text : c.num),
    ['Grace Point', 'Church total', null, null, null, null, 4, null, null, 0, 0]);
  /* The owner's actual complaint: the repeated church label competing with the numbers. It is
     still THERE (the sheet has to stay filterable) but it recedes to the muted style. */
  checkTrue('the repeated church name is muted, not deleted',
    cellAt(g[2], 'A').text === 'Citipointe, Carindale' && cellAt(g[2], 'A').s === ctx.XS.MUTED);
  checkTrue('detail figures use the plain number/money styles',
    cellAt(g[2], 'G').s === ctx.XS.NUM && cellAt(g[2], 'J').s === ctx.XS.MONEY);

  const churchTot = g[1];
  check('church subtotal is labelled, not disguised as a detail row',
    [cellAt(churchTot, 'B').text, cellAt(churchTot, 'G').num, cellAt(churchTot, 'J').num],
    ['Church total', 15, 2350]);
  checkTrue('the subtotal row is bold-on-lavender across every column',
    churchTot.length === 11 && churchTot.every((c) => [ctx.XS.TOT_T, ctx.XS.TOT_N, ctx.XS.TOT_M].indexOf(c.s) >= 0),
    JSON.stringify(churchTot.map((c) => c.s)));
  /* A styled BLANK still has to be emitted or the fill stops halfway across the row — which is
     exactly the visual cue this change exists to add. */
  checkTrue('blank cells in a total row are still emitted (so the fill runs the full width)',
    cellAt(churchTot, 'C') != null && cellAt(churchTot, 'C').text == null);

  /* "Accommodation not recorded" has no code, and BOTH money columns are UNKNOWN — a 0 there
     would read as "free" while the effective total said otherwise. */
  check('unrecorded accommodation, blank raw AND effective values (NOT 0)',
    g[6].map((c) => c.text != null ? c.text : c.num),
    ['Grace Point', 'Detail', 'Student', 'Not recorded', null, 'Full price', 4, null, null, 0, 0]);
  checkTrue('the blank raw-invoice-value cell carries no <v> element at all',
    !/<c r="H7"[^>]*>/.test(s2) || /<c r="H7" s="\d+"\/>/.test(s2));

  const campTot = g[7];
  check('camp total row', [cellAt(campTot, 'B').text, cellAt(campTot, 'G').num, cellAt(campTot, 'J').num],
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
  const lineTotals = g.slice(1).map((r) => (cellAt(r, 'J') || {}).num).map((n) => n || 0);
  const detailSum = g.slice(1)
    .filter((r) => (cellAt(r, 'B') || {}).text === 'Detail')
    .reduce((s, r) => s + ((cellAt(r, 'J') || {}).num || 0), 0);
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
    [[190, 4, 760], [150, 3, 450]]);
  checkTrue('$170 — the average of the two bands — appears nowhere',
    !s.codes.some((c) => c.bands.some((b) => b.amount === 170)));
  check('full vs part sponsorship are totalled separately',
    [s.fullTotal, s.partialTotal, s.total], [1210, 650, 1860]);
  check('an in-person code is not an ask', s.codes.map((c) => c.code).indexOf('YC26CASH'), -1);
  check('the unpriceable place is counted and flagged, never totalled as $0',
    [s.count, s.unpricedCount], [13, 1]);
  /* ⚠️ REPORTED, NEVER INFERRED (2026-09-05). MYSTERY is untagged and must never leak into any
     sponsor total — it can only ever surface in `unclassified`. */
  checkTrue('an unclassified code never joins the sponsor totals',
    s.codes.map((c) => c.code).indexOf('MYSTERY') < 0);
  check('the unclassified code is named with its people and dollar gap',
    s.unclassified.map((u) => [u.code, u.count, u.total]), [['MYSTERY', 2, 280]]);
  check('unclassified people and dollars are excluded from the ask',
    [s.unclassifiedCount, s.unclassifiedTotal], [2, 280]);

  /* ⚠ The bands are NOT printed any more (owner, 2026-08-04 5th-b) — the export carries the
     per-ministry, per-code breakdown only. The differential still EXISTS, as the checks above
     prove; it is visible on the Budget screen's Sponsorship card. This assertion is what stops
     someone concluding from the export that `bands` is dead and deleting it. */
  const val = (r) => r.map((c) => c.text != null ? c.text : c.num);
  const kind = (r) => (cellAt(r, 'B') || {}).text;
  checkTrue('no band row is printed', g.filter((r) => kind(r) === 'Sponsor band').length === 0);
  /* Biggest ask first, not alphabetical — Victory's 1100 outranks Grace Point's 760. This is the
     order a director works down when deciding who to chase. Within a church, its own codes are
     also biggest-first — YC26HALF's 650 outranks Victory's own YC26SPON share (450). */
  // Trailing null below is the Cancelled column — a sponsor row carries no cancelled-count value
  // at all (styled blank, no <v>), unlike a Detail/total row's 0.
  check('per-ministry rows, biggest ask first, on the By ministry sheet',
    g.filter((r) => kind(r) === 'Sponsor by ministry').map(val), [
      ['Victory', 'Sponsor by ministry', null, null, 'YC26HALF', 'Part sponsored', 5, null, null, 650, null],
      ['Victory', 'Sponsor by ministry', null, null, 'YC26SPON', 'Full sponsorship', 4, null, null, 450, null],
      ['Grace Point', 'Sponsor by ministry', null, null, 'YC26SPON', 'Full sponsorship', 4, null, null, 760, null],
    ]);
  const spTot = g.find((r) => kind(r) === 'Sponsor total');
  check('camp sponsor total', [cellAt(spTot, 'G').num, cellAt(spTot, 'J').num], [13, 1860]);

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
    new RegExp('<autoFilter ref="A1:K' + (campTotIdx + 1) + '"').test(s2),
    'filter must not span the sponsorship block');
  check('detail rows still sum to the camp total, sponsorship excluded',
    g.slice(1).filter((r) => kind(r) === 'Detail')
      .reduce((t, r) => t + ((cellAt(r, 'J') || {}).num || 0), 0), 2350);


  /* EMITTED WIDTH, not source width (2026-09-06). A row padded with bare `null` entries looks
     11 wide in the JS array literal and emits ONE cell: _xlSheetXml skips a bare null, while
     _xc('',style)/_xn(null,style) emit a real styled <c/>. That mismatch shipped once and was
     caught only by counting cells in the unzipped workbook, never by reading the source. These
     assertions count what actually reaches the file, so the source can no longer lie about it. */
  console.log('');
  console.log('7a. Non-detail rows are genuinely 11 cells wide in the emitted XML');
  const widthOf = (r) => (r || []).length;
  check('the sponsorship section heading emits 11 cells', widthOf(g[campTotIdx + 2]), 11);
  check('the camp total row emits 11 cells', widthOf(g[campTotIdx]), 11);
  check('the header row emits 11 cells', widthOf(g[0]), 11);
  console.log('\n7b. Summary — the rows the owner asked to be removed stay removed');
  const sm = parseSheet(parts['xl/worksheets/sheet1.xml']);
  const smText = sm.map((r) => (cellAt(r, 'A') || {}).text || '');
  checkTrue('no "Ministries" row', smText.every((t) => t !== 'Ministries'));
  // ⚠ "no Reconciliation section" was correct on 2026-08-04 and is DELIBERATELY REVERSED here —
  // 2026-09-05's owner ruling puts a reconciliation block back (see section 8), this time reading
  // people fetched vs. people printed, not "value of every place". Removed, not just weakened,
  // so a future reader cannot find a stale assertion arguing the two decisions still agree.
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

  console.log('\n8. New column set and reconciliation (2026-09-05)');
  {
    const HEAD = ['Church','Row type','Audience','Accommodation','Code used','Code type','Number',
      'Raw invoice value','Effective $ to budget per ticket','Effective $ to budget total','Cancelled'];
    const head = parseSheet(parts['xl/worksheets/sheet2.xml'])[0];
    check('By ministry header', head.map((c) => c.text), HEAD);
    checkTrue('autofilter spans 11 columns and stops at the received table',
      /A1:K\d+/.test(parts['xl/worksheets/sheet2.xml']));

    const sum = parseSheet(parts['xl/worksheets/sheet1.xml']);
    const texts = sum.map((r) => (r || []).map((c) => c.text).join(' '));
    checkTrue('Summary carries a reconciliation block',
      texts.some((t) => /Reconciliation/.test(t)));
    checkTrue('Summary reports people fetched and people printed',
      texts.some((t) => /People fetched/.test(t)) && texts.some((t) => /People on/.test(t)));
    checkTrue('a mismatch is stated loudly, not as a quiet number',
      texts.some((t) => /Do not rely on the totals/.test(t)));
    checkTrue('unclassified codes are named with their people and dollars',
      texts.some((t) => /not been classified/.test(t)) && texts.some((t) => /MYSTERY/.test(t)));
    checkTrue('unclassified money is NOT in the sponsorship total',
      Number(cellAt(sum.find((r) => (r||[]).some((c) => c.text === 'Total still needed')), 'C').num) === 1860);
    /* Pinned to EXACT numbers, on top of the brief's presence-only checks above. `printed` is
       accumulated by detail() and nothing here hardcodes it independently — this is what turns
       "a reconciliation block exists" into "the reconciliation block reflects reality", and it is
       what a detail()-undercounts-people regression actually breaks (see the revert-proof in the
       task report: this exact check is the one that fails). */
    // Match by PREFIX, not equality — the label's apostrophes round-trip through the XML as
    // `&apos;` and parseSheet deliberately does not decode entities (see section 7b's own
    // &quot;-laden check above), so an exact-equality lookup against the literal text would
    // silently match nothing.
    const recCell = (prefix) => cellAt(sum.find((r) => ((cellAt(r, 'A') || {}).text || '').indexOf(prefix) === 0), 'B');
    check('People fetched from the app is exact', recCell('People fetched from the app').num, 20);
    check("People on 'By ministry' matches printed", recCell('People on').num, 19);
    check('Difference is exact', recCell('Difference').num, 1);
  }

  console.log('\n9. An independent parser can read it back');
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
  check('SheetJS reads the leading church total', ws['J2'].v, 2350);
  check('SheetJS reads a detail line total as a NUMBER', [ws['J3'].v, ws['J3'].t], [450, 'n']);
  check('SheetJS reads the camp total', ws['J8'].v, 2350);
  check('SheetJS reads the comma-containing church name intact', ws['A2'].v, 'Citipointe, Carindale');
  check('SheetJS reads the appended sponsorship total', ws['J14'].v, 1860);

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
