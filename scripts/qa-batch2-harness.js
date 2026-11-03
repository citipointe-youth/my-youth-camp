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
for (const fn of ['_phoneOk', '_faParse', '_faIsAmend', '_noteBodyHtml', '_paymentMissing', '_missingItems', '_medAlertRows', '_schedEnd', '_isAppAnswer']) {
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
assert.strictEqual(ctx._missingItems({ ...youth, consentMedical: false, medicationConsent: null, parentPhone: null, paymentStatus: 'unpaid', ticketNumber: 'T1' }).length, 4);
// Payment: the 'unpaid' default alone is not a finding.
const pay = (o) => ctx._paymentMissing({ paymentStatus: 'unpaid', ticketNumber: null, invoiceNumber: null, amountPaid: null, refundAmount: null, ...o });
assert.strictEqual(pay({}), false, 'default unpaid, nothing matched');
assert.strictEqual(pay({ invoiceNumber: 'I1', amountPaid: 250 }), false, 'invoice import: Paid $X');
assert.strictEqual(pay({ invoiceNumber: 'I1', amountPaid: 0 }), false, 'free or refunded invoice');
assert.strictEqual(pay({ ticketNumber: 'T1', refundAmount: 50 }), false, 'refund recorded');
assert.strictEqual(pay({ ticketNumber: 'T1', paymentStatus: 'paid' }), false, 'paid');
assert.strictEqual(pay({ ticketNumber: 'T1' }), true, 'ticket says unpaid, no invoice figure');
assert.strictEqual(pay({ ticketNumber: 'T1', paymentStatus: 'deposit', amountPaid: 50 }), true, 'deposit only');
// Batch 3.
assert.strictEqual(pay({ ticketNumber: 'T1', paymentStatus: 'free' }), false, 'ticket Free, no invoice');
assert.strictEqual(pay({ ticketNumber: 'T1', paymentStatus: 'refunded' }), false, 'ticket Refunded, no invoice');
assert.strictEqual(pay({ ticketNumber: 'T1', invoiceNumber: 'I1', amountPaid: 0, registrationCost: 180 }), true, 'Paid $0 of $180');
assert.strictEqual(pay({ amountPaidOverride: 180 }), false, 'hand-entered amount, no invoice');
assert.strictEqual(pay({ ticketNumber: 'T1', amountPaidOverride: 180 }), false, 'hand-entered amount beats ticket Unpaid');

// Review of batch 3: a fully discounted place owes nothing; part-paid does.
assert.strictEqual(pay({ ticketNumber: 'T1', registrationCost: 180, discountAmount: 180, amountPaid: 0 }), false, 'free place, $0 paid');
assert.strictEqual(pay({ ticketNumber: 'T1', registrationCost: 180, discountAmount: 180 }), false, 'free place, no invoice figure');
assert.strictEqual(pay({ ticketNumber: 'T1', registrationCost: 180, discountAmount: 30, amountPaid: 0 }), true, 'part discount, nothing paid');
assert.strictEqual(pay({ ticketNumber: 'T1', registrationCost: 180, amountPaid: 100 }), true, 'part paid');
assert.strictEqual(pay({ ticketNumber: 'T1', registrationCost: 180, amountPaid: 180 }), false, 'paid in full, status never set');

// Batch 3: only the app's own answer counts.
const answer = (status, type) => ({ ok: status < 400, status, headers: { get: () => type } });
assert.strictEqual(ctx._isAppAnswer(null, answer(403, 'text/html')), false, 'wifi page 403');
assert.strictEqual(ctx._isAppAnswer({ error: { code: 'x' } }, answer(429, 'application/json')), false, 'edge 429');
assert.strictEqual(ctx._isAppAnswer({ code: 'FORBIDDEN', message: 'no' }, answer(403, 'application/json')), true, 'app refusal');
assert.strictEqual(ctx._isAppAnswer({ code: 'UNAUTHORIZED', message: 'no' }, answer(401, 'application/json')), true, 'app 401');
assert.strictEqual(ctx._isAppAnswer(null, answer(200, 'text/html; charset=utf-8')), false, 'portal page answering 200');
assert.strictEqual(ctx._isAppAnswer([], answer(200, 'application/json')), true, 'normal answer');

// Batch 3: schedule end times.
assert.strictEqual(ctx._schedEnd('14:00', 300), '19:00');
assert.strictEqual(ctx._schedEnd('23:30', 60), '00:30');
assert.deepStrictEqual(Array.from(ctx._missingItems({ kind: 'leader', blueCardCollected: false })), ['Blue card']);

// Item 7: an allergen filed under dietary still raises the alert; a preference doesn't.
assert.strictEqual(ctx._medAlertRows({ dietaryRequirements: ['Nut allergy'] }).length, 1);
assert.strictEqual(ctx._medAlertRows({ dietaryRequirements: ['Vegetarian'] }).length, 0);

// Item 22: the push must come before the paint, or the stale-render guard drops the first tap.
const person = extract('function _paintPerson(');
assert.ok(person.indexOf("STACK.push('student')") < person.indexOf("paint('student'"), 'push before paint');

// Small item 3: on recovery a refusal must reach the login screen, and no signal must keep the session.
async function recover(err) {
  const calls = { expired: 0, removed: 0 };
  const c = {
    localStorage: { removeItem: () => { calls.removed++; } },
    api: async (p) => { if (err) throw err; return {}; },
    sessionExpired: () => { calls.expired++; }, _netStrip() {}, updateModeUI() {}, buildTabs() {}, _prefetch() {},
    gotoTab: async () => {}, _navTo: async () => {}, _savedQueueCount: () => 0, CHECKIN_QUEUE: [], _draining: false,
  };
  vm.createContext(c);
  vm.runInContext('var _bootOffline=true,ACTOR={},TOKEN="t",SETTINGS={},CAMP_MODE="at-camp",STACK=["home"];' + extract('async function _offlineBootRecover('), c);
  await c._offlineBootRecover();
  return { ...calls, token: vm.runInContext('TOKEN', c), actor: vm.runInContext('ACTOR', c) };
}
// Small item 4: undo drops the entry of the type being undone, and leaves the earlier one queued.
function undo(queue, type) {
  const c = { CHECKIN_QUEUE: queue, clearTimeout() {}, _hideUndoToast() {}, _persistQueue() {}, _rCheckin() {}, _queueEntry() { c.reversed = true; } };
  vm.createContext(c);
  vm.runInContext(`var _undoTimer=null,_undoCamperId="a",_undoType="${type}",_undoSession="s",_draining=false;` + extract('function undoCheck('), c);
  c.undoCheck();
  return c.CHECKIN_QUEUE.map((e) => e.type);
}
// Review of batch 3: the saved list must follow the session running now, not the one it was saved in.
function view({ date, time, restricted, cache }) {
  const store = { ycp_roster_v: JSON.stringify(cache) };
  const c = {
    ACTOR: { role: 'church', username: 'v' }, Date, JSON, Array, Object, String,
    SETTINGS: { churchCheckinTimeRestricted: !!restricted, checkinWindowAmStart: '06:00', checkinWindowAmEnd: '12:00', checkinWindowPmStart: '13:00', checkinWindowPmEnd: '22:00' },
    localStorage: { getItem: (k) => store[k] ?? null, removeItem: (k) => { delete store[k]; }, setItem: (k, v) => { store[k] = v; } },
    localDateISO: () => date, brisbaneNowTime: () => time, _ciLabel: (s) => s.label,
  };
  vm.createContext(c);
  for (const fn of ['_rosterKey', '_rosterClear', '_rosterLoad', '_sessionNow', '_windowClosed', '_rosterView', '_rosterSynced']) vm.runInContext(extract('function ' + fn + '('), c);
  return { v: c._rosterView(), c };
}
const sess = (day, sfx, label) => ({ id: day + '~' + sfx, day, startTime: sfx === 'am' ? '08:00' : '13:00', label });
const MON_AM = sess('2026-07-06', 'am', 'Mon AM'), MON_PM = sess('2026-07-06', 'pm', 'Mon PM');
const saved = (over = {}) => ({ savedAt: new Date().toISOString(), session: MON_AM, sessions: [MON_AM, MON_PM],
  roster: [{ id: 'a', name: 'Ann', grade: 7, checkedIn: true }, { id: 'b', name: 'Bo', grade: 8, checkedIn: false }], ...over });
{
  const same = view({ date: '2026-07-06', time: '09:00', cache: saved() }).v;
  assert.strictEqual(same.session.id, MON_AM.id);
  assert.strictEqual(same.roster[0].checkedIn, true, 'same session keeps its saved state');
  assert.strictEqual(same.readOnly, null);
  const next = view({ date: '2026-07-06', time: '14:00', cache: saved() }).v;
  assert.strictEqual(next.session.id, MON_PM.id, 'Mon AM save, Mon PM reopen shows Mon PM');
  assert.ok(next.roster.every((r) => r.checkedIn === false), 'nobody assumed done in the new session');
  assert.strictEqual(next.readOnly, null, 'taps are allowed, and queue to Mon PM');
  assert.ok(next.savedFrom, 'it says the names came from the earlier session');
  const after = view({ date: '2026-07-20', time: '14:00', cache: saved() }).v;
  assert.ok(after.readOnly, 'no session today: read-only');
  const noList = view({ date: '2026-07-06', time: '14:00', cache: saved({ sessions: undefined }) }).v;
  assert.ok(noList.readOnly, 'no saved session list: read-only');
  const closed = view({ date: '2026-07-06', time: '12:30', restricted: true, cache: saved() }).v;
  assert.ok(closed.readOnly, 'restricted and between windows: read-only');
  // A tap sent successfully while on the saved list stays checked in.
  const { c } = view({ date: '2026-07-06', time: '14:00', cache: saved() });
  c._rosterSynced({ camperId: 'b', sessionId: MON_PM.id, type: 'in' });
  const v2 = c._rosterView();
  assert.strictEqual(v2.roster.find((r) => r.id === 'b').checkedIn, true, 'sent tap stays in');
  assert.strictEqual(v2.roster.find((r) => r.id === 'a').checkedIn, false);
}
// Review of batch 3: saved taps survive anything but the app's own refusal.
async function drain(err, entry) {
  const c = { CHECKIN_QUEUE: [{ camperId: 'a', sessionId: 's', type: 'in', ...entry }], navigator: { onLine: true }, _draining: false, _rosterInUse: false,
    api: async () => { throw err; }, _persistQueue() {}, _markSynced() {}, _rCheckin: async () => {}, _hideUndoToast() {}, clearTimeout() {}, setTimeout() {},
    _undoCamperId: null, _lastRoster: [], _checkinFailNames: [], _checkinFailed: 0, _checkinFailReason: '', _queueWaiting: false, _drainRetry: null, _bootOffline: false, LEADER_INITIALS: 'QA' };
  vm.createContext(c);
  vm.runInContext(extract('async function drainQueue('), c);
  await c.drainQueue();
  return c.CHECKIN_QUEUE.length;
}
(async () => {
  const nonApp = Object.assign(new Error('x'), { transient: true, nonApp: true });
  const net = Object.assign(new Error('x'), { transient: true });
  const appNo = Object.assign(new Error('x'), { code: 'FORBIDDEN' });
  assert.strictEqual(await drain(nonApp, { offline: true }), 1, 'wifi page: saved tap kept');
  assert.strictEqual(await drain(nonApp, {}), 1, 'wifi page: live tap kept');
  assert.strictEqual(await drain(net, { offline: true }), 1, 'flaky: saved tap kept');
  assert.strictEqual(await drain(net, {}), 0, 'flaky: live tap is the ruled banner-only drop');
  assert.strictEqual(await drain(appNo, { offline: true }), 0, 'the app refused it: dropped with the banner');
  const offline = await recover(Object.assign(new Error('x'), { transient: true }));
  assert.strictEqual(offline.expired + offline.removed, 0, 'no signal keeps the session');
  assert.strictEqual(offline.token, 't');
  const refused = await recover(Object.assign(new Error('x'), { code: 'FORBIDDEN' }));
  assert.strictEqual(refused.expired, 1, 'a non-401 refusal shows the login screen');
  assert.strictEqual(refused.removed, 2, 'and clears the stored session');
  const ok = await recover(null);
  assert.strictEqual(ok.expired + ok.removed, 0, 'a good answer changes nothing');
  const q = () => [{ camperId: 'a', sessionId: 's', type: 'in' }, { camperId: 'a', sessionId: 's', type: 'out' }];
  assert.deepStrictEqual(undo(q(), 'out'), ['in'], 'in, out, undo leaves the child in');
  console.log('All checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
