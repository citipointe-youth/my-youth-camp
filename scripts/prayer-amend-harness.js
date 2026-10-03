/*
 * Prayer-record amendment harness (2026-10-03, camp-v145).
 *
 * `_prParse`/`_prIsAmend` are browser-only code (public/index.html has no build step), so vitest
 * cannot reach them. Also exercises `_faGroup`/`_faKeep` (shared with first-aid amendments) against
 * PRAYER bodies, to prove the owner's claim that they work unchanged on the prayer body shape
 * ("Amends: <id>" / "Recorded by: <name>" / free text) — they only ever read the `Amends:` line via
 * `_faParse`. Runs the REAL functions extracted from public/index.html by name.
 *
 *   node scripts/prayer-amend-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Name-prefix extraction, same as pulse-fa-harness.js — a throw here means a genuine RENAME.
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

// _faParse depends on the module-level _FA_KEYS lookup table — pull that in too (single statement,
// terminated by its own ';', same convention as the const extraction in data-search-harness.js).
function extractConst(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  const end = SRC.indexOf(';', i);
  if (end < 0) throw new Error('unterminated const for ' + decl);
  return SRC.slice(i, end + 1);
}

const NAMES = ['_prParse', '_prIsAmend', '_faParse', '_faIsAmend', '_faGroup', '_faKeep'];
const ctx = { console, JSON, Object, String, Array, Number, window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(extractConst('const _FA_KEYS='), ctx);
vm.runInContext(NAMES.map((n) => extract('function ' + n + '(')).join('\n'), ctx);
for (const n of NAMES) if (typeof ctx[n] !== 'function') throw new Error('sandbox guard: ' + n + ' missing');
const { _prParse, _prIsAmend, _faGroup, _faKeep } = ctx;

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n     expected ' + e + '\n     actual   ' + a);
}

/* ---- _prParse ---- */
check('(a) original body: Recorded by + text',
  _prParse('Recorded by: Alice Smith\nPrayer text line one\nline two'),
  { amends: '', by: 'Alice Smith', text: 'Prayer text line one\nline two' });

check('(b) amendment body: Amends + Recorded by + text',
  _prParse('Amends: note_o1\nRecorded by: Carol\nAmendment detail here'),
  { amends: 'note_o1', by: 'Carol', text: 'Amendment detail here' });

check('(c) multi-line free text preserved (only trailing ws trimmed)',
  _prParse('Amends: note_o1\nRecorded by: Dave\nLine1\n\nLine3   '),
  { amends: 'note_o1', by: 'Dave', text: 'Line1\n\nLine3' });

check('(d) legacy unlabelled body (no Amends/Recorded-by lines) kept as-is',
  _prParse('Just some old free text with no labels at all'),
  { amends: '', by: '', text: 'Just some old free text with no labels at all' });

check('(e) empty body never throws', _prParse(''), { amends: '', by: '', text: '' });
check('(e) undefined body never throws', _prParse(undefined), { amends: '', by: '', text: '' });

/* ---- _prIsAmend ---- */
check('a prayer amendment is true', _prIsAmend({ category: 'prayer', body: 'Amends: x\nRecorded by: A\ntext' }), true);
check('a prayer original (no Amends line) is false', _prIsAmend({ category: 'prayer', body: 'Recorded by: A\ntext' }), false);
check('a first-aid amendment is false (wrong category)', _prIsAmend({ category: 'firstaid', body: 'Amends: x\nAmendment: y\nFirst-aider: A' }), false);
check('a note with blank body is false', _prIsAmend({ category: 'prayer', body: '' }), false);

/* ---- _faGroup on prayer bodies (2 originals + 3 amendments, one orphan) ---- */
const o1 = { id: 'o1', camperId: 'c1', category: 'prayer', authorName: 'Alice', createdAt: '2026-09-28T01:00:00Z', body: 'Recorded by: Alice\nPrayer text 1' };
const o2 = { id: 'o2', camperId: 'c2', category: 'prayer', authorName: 'Bob', createdAt: '2026-09-29T01:00:00Z', body: 'Recorded by: Bob\nPrayer text 2' };
// a2 is the OLDER amendment to o1 (09-28 05:00) and must sort before a1 (09-29 02:00) — oldest first.
const a1 = { id: 'a1', camperId: 'c1', category: 'prayer', authorName: 'Carol', createdAt: '2026-09-29T02:00:00Z', body: 'Amends: o1\nRecorded by: Carol\nAmend text 1' };
const a2 = { id: 'a2', camperId: 'c1', category: 'prayer', authorName: 'Dave', createdAt: '2026-09-28T05:00:00Z', body: 'Amends: o1\nRecorded by: Dave\nAmend text 2' };
const a3 = { id: 'a3', camperId: 'c3', category: 'prayer', authorName: 'Eve', createdAt: '2026-09-30T01:00:00Z', body: 'Amends: o-missing\nRecorded by: Eve\nOrphan text' };

const groups = _faGroup([o1, o2, a1, a2, a3]);
check('3 groups: orphan (newest) + o2 + o1 (originals sorted newest-first)',
  groups.map((g) => g.n.id), ['a3', 'o2', 'o1']);
check('the a3 group is flagged orphan', groups.find((g) => g.n.id === 'a3').orphan, true);
check('o2 has no amendments', groups.find((g) => g.n.id === 'o2').amends, []);
check('o1 amendments nested oldest-first (a2 then a1)',
  groups.find((g) => g.n.id === 'o1').amends.map((a) => a.id), ['a2', 'a1']);

/* ---- _faKeep keeps a group whose only same-day item is an amendment ---- */
const dayOf = (iso) => iso.slice(0, 10); // test stand-in for localDateISO
const prGroup = (origDay, amendDays = []) => ({ n: { createdAt: origDay }, amends: amendDays.map((d) => ({ createdAt: d })) });
check('kept when the amendment (not the original) lands on the filtered day',
  _faKeep(prGroup('2026-09-28T01:00Z', ['2026-09-30T02:00Z']), '2026-09-30', '2026-10-01', dayOf), true);
check('rejected when neither the original nor any amendment lands on the filtered day',
  _faKeep(prGroup('2026-09-28T01:00Z', ['2026-09-29T02:00Z']), '2026-09-30', '2026-10-01', dayOf), false);

/* ---- a free-text line that happens to start "Amends:" must not turn a record into an amendment ---- */
const tricky = { id: 't1', category: 'prayer', createdAt: '2026-09-30T03:00Z', body: 'Recorded by: Sam\nShared about home.\nAmends: wants a follow-up call' };
check('_faIsAmend only looks at the first line', ctx._faIsAmend(tricky), false);
check('a record with an "Amends:" line mid-text stays an original (not an orphan)',
  _faGroup([tricky]).map((g) => ({ id: g.n.id, orphan: !!g.orphan })), [{ id: 't1', orphan: false }]);
check('a real first-aid amendment is still detected', ctx._faIsAmend({ body: 'Amends: n1\nAmendment: x\nFirst-aider: A' }), true);

console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
