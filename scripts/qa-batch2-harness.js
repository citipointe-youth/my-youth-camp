/*
 * QA batch 2 harness (2026-11-03, camp-v147). Browser-only helpers, run from the real source by
 * name because public/index.html has no build step and vitest cannot reach it.
 *
 *   node scripts/qa-batch2-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function extract(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { depth++; started = true; }
    else if (SRC[j] === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced extraction for ' + decl);
}
const stmt = (decl) => { const i = SRC.indexOf(decl); if (i < 0) throw new Error(decl); return SRC.slice(i, SRC.indexOf(';', i) + 1); };

const ctx = { String, Array, Object };
vm.createContext(ctx);
const escLine = SRC.slice(SRC.indexOf('const esc='), SRC.indexOf('\n', SRC.indexOf('const esc='))); // its body contains ';'
vm.runInContext(escLine + stmt('const _FA_KEYS=') + stmt('const _ALLERGY_RE='), ctx);
for (const fn of ['_phoneOk', '_faParse', '_faIsAmend', '_noteBodyHtml', '_missingItems', '_medAlertRows']) {
  vm.runInContext(extract('function ' + fn + '('), ctx);
}

// Item 6: the same answers as isPhoneLike on the server.
for (const good of ['', '  ', '0411 222 333', '+61 411 222 333', '(07) 3333 4444']) assert.strictEqual(ctx._phoneOk(good), true, good);
for (const bad of ['abc', '12', '0400 abc 123', '1234567890123456']) assert.strictEqual(ctx._phoneOk(bad), false, bad);

// Item 20: no amendment id on screen, and free text stays as written.
const amend = ctx._noteBodyHtml({ category: 'firstaid', body: 'Amends: note_abc\nAmendment: Ice pack 20 min\nFirst-aider: Sam' });
assert.ok(!amend.includes('note_abc'), amend);
assert.ok(amend.includes('Amendment: Ice pack 20 min'), amend);
const prayer = ctx._noteBodyHtml({ category: 'prayer', body: 'Amends: note_abc\nRecorded by: Jo\nText' });
assert.ok(!prayer.includes('note_abc') && prayer.startsWith('Amendment:'), prayer);
assert.strictEqual(ctx._noteBodyHtml({ category: 'note', body: 'Amends: the plan <b>' }), 'Amends: the plan &lt;b&gt;');
assert.strictEqual(ctx._noteBodyHtml({ category: 'firstaid', body: 'just text' }), 'just text');

// Item 25: what's outstanding, and a leader is only asked for a blue card.
const youth = { kind: 'student', consentMedical: true, medicationConsent: 'no', parentPhone: '0400****05', paymentStatus: 'paid' };
assert.strictEqual(ctx._missingItems(youth).length, 0);
assert.strictEqual(ctx._missingItems({ ...youth, consentMedical: false, medicationConsent: null, parentPhone: null, paymentStatus: 'unpaid' }).length, 4);
assert.deepStrictEqual(Array.from(ctx._missingItems({ kind: 'leader', blueCardCollected: false })), ['Blue card']);

// Item 7: an allergen filed under dietary still raises the alert; a preference doesn't.
assert.strictEqual(ctx._medAlertRows({ dietaryRequirements: ['Nut allergy'] }).length, 1);
assert.strictEqual(ctx._medAlertRows({ dietaryRequirements: ['Vegetarian'] }).length, 0);

// Item 22: the push must come before the paint, or the stale-render guard drops the first tap.
const person = extract('function _paintPerson(');
assert.ok(person.indexOf("STACK.push('student')") < person.indexOf("paint('student'"), 'push before paint');

console.log('All checks passed.');
