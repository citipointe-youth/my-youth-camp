/*
 * Preview / offline queue harness (camp arch round 2026-11-07, B-14). Runs the REAL api(), the
 * check-in queue block and the four preview entry/exit functions from public/index.html.
 *
 *   node scripts/preview-queue-harness.js
 *
 * A drain during a preview used to hit api()'s read-only guard, which looks like an app refusal,
 * so the admin's saved tap was hard-dropped and the disk copy was later overwritten. Entering a
 * preview must park the queue (_queueStop) before the login swap, and exiting must reload and
 * drain it (_queueLoad). No tap may be dropped by the guard.
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
function between(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('markers not found: ' + from + ' / ' + to);
  return SRC.slice(i, j);
}

const ADMIN_KEY = 'ycp_ciq_admin';
const TAP = { camperId: 'c1', type: 'in', sessionId: 's1', initials: 'AD', offline: true, at: Date.now(), name: 'Kid One' };

// checkin(token): what the server does with a POST /checkin. Returns a value, or throws.
function sandbox(campMode, checkin) {
  const store = { [ADMIN_KEY]: JSON.stringify([TAP]) };
  const el = () => ({ classList: { add() {}, remove() {} }, style: {} });
  const out = { posts: [], toasts: [] };
  const c = {
    console, Date, JSON, Set, Promise, Math, Object, Array, String, Error,
    setTimeout: () => ({ timer: true }), clearTimeout() {},
    navigator: { onLine: true }, window: {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { querySelectorAll: () => [], getElementById: el },
    toast: (m) => out.toasts.push(m),
    _doFetch: async (p, o) => {
      if (p.endsWith('/preview')) return { token: 'prevtok', user: { id: 'u2', username: 'church1', firstName: 'Grace', lastName: 'Point', role: 'church' } };
      if (p === '/checkin') { out.posts.push({ token: vm.runInContext('TOKEN', c), body: o.body }); return checkin(); }
      throw new Error('unexpected ' + p);
    },
  };
  vm.createContext(c);
  vm.runInContext(`var Cache={get:()=>null,set(){},clear(){}},_inflight=new Map(),_invalidate=()=>{};
var PREVIEW_MODE=false,ACCOUNT_PREVIEW=false,TOKEN='admintok',ACTOR={id:'u1',username:'admin',role:'admin'};
var SETTINGS={campMode:'${campMode}'},CAMP_MODE='${campMode}',STACK=['home'],SESSIONS=[],SEL_SESSION=null;
var LEADER_INITIALS='AD',_bootOffline=false,_rosterInUse=false,_previewStash=null,_previewLocalFlips={};
var _rCheckin=async()=>{},_hideUndoToast=()=>{},_offlineBootRecover=()=>{},_rosterSynced=()=>{};
var updateModeUI=()=>{},buildTabs=()=>{},gotoTab=()=>{},_restoreFilters=()=>{},_showUndoToast=()=>{};
var _sheets=0,enforceInitials=()=>{_sheets++;},_isChurchAccount=()=>!!(ACTOR&&ACTOR.role==='church');`, c);
  vm.runInContext(between('async function api(', '/* After login, warm'), c); // `opt={}` defeats extract()
  vm.runInContext(between('const CHECKIN_QUEUE=[]', 'function _dismissFailedCheckins(')
    .replace("window.addEventListener('online'", "void 0&&window.addEventListener('online'"), c);
  for (const fn of ['function _ensureInitials(', 'function _previewSimActive(', 'function undoCheck(', 'function _performCheck(', 'function enterPreview(', 'function _previewShell(', 'function exitPreview(', 'async function enterAccountPreview(', 'function exitAccountPreview(']) vm.runInContext(extract(fn), c);
  const state = () => JSON.parse(vm.runInContext('JSON.stringify({q:CHECKIN_QUEUE.length,failed:_checkinFailed,names:_checkinFailNames,retry:!!_drainRetry})', c));
  return { c, out, store, state, run: (code) => vm.runInContext(code, c) };
}
const settle = () => new Promise((r) => setImmediate(r)); // _restoreQueue starts its own drain
const fail503 = () => { const e = new Error('Server error'); e.transient = true; e.status = 503; throw e; };
const ok = () => ({ ok: true });

async function accountPreview() {
  let server = fail503;
  const s = sandbox('at-camp', () => server());
  // Signed in: the saved tap loads, the server answers 503, the tap is kept and a retry is armed.
  s.run('_queueLoad(true)');
  await settle();
  assert.deepStrictEqual(s.state(), { q: 1, failed: 0, names: [], retry: true }, 'setup: 503 keeps the saved tap');
  server = ok;
  await s.run("enterAccountPreview('u2')");
  assert.strictEqual(s.run('ACCOUNT_PREVIEW&&TOKEN'), 'prevtok', 'in preview');
  assert.strictEqual(s.state().q, 0, 'the queue is parked: nothing of the admin in memory');
  assert.strictEqual(s.state().retry, false, 'the armed retry is cancelled');
  assert.ok(s.store[ADMIN_KEY], "the admin's tap is on disk under the admin's key");
  assert.ok(!s.store.ycp_ciq_church1, "nothing written under the previewed login's key");
  // What the armed retry, the 'online' event or a dismissed banner would call.
  await s.run('drainQueue()');
  const during = s.state();
  assert.strictEqual(during.failed, 0, 'no tap dropped by the read-only guard');
  assert.deepStrictEqual(during.names, []);
  assert.strictEqual(s.out.posts.length, 1, 'nothing was sent during the preview');
  assert.deepStrictEqual(JSON.parse(s.store[ADMIN_KEY]).map((e) => e.camperId), ['c1'], 'disk copy intact');
  // Exit: the admin's queue reloads and drains as the admin.
  s.run('exitAccountPreview()');
  await settle();
  assert.strictEqual(s.run('TOKEN'), 'admintok');
  const sent = s.out.posts[s.out.posts.length - 1];
  assert.deepStrictEqual([sent.token, sent.body.camperId, sent.body.sessionId], ['admintok', 'c1', 's1'], 'sent as the admin, own session (Q9)');
  assert.strictEqual(s.state().q, 0);
  assert.strictEqual(s.state().failed, 0);
  assert.ok(!s.store[ADMIN_KEY], 'sent, so the saved copy is cleared');
}

async function inFlightAtEntry() {
  // A drain is waiting on the server when the admin starts a preview; the answer lands after the swap.
  let release;
  const s = sandbox('at-camp', () => new Promise((_, rej) => { release = rej; }));
  s.run('_queueLoad(true)'); // its drain is now waiting on the server
  await s.run("enterAccountPreview('u2')");
  release(Object.assign(new Error('Server error'), { transient: true, status: 503 }));
  await settle();
  assert.strictEqual(s.state().failed, 0, 'the old pass touches nothing');
  assert.deepStrictEqual(JSON.parse(s.store[ADMIN_KEY]).map((e) => e.camperId), ['c1'], 'the tap stays saved for the admin');
}

async function samePreview() {
  // Pre-camp admin with a tap saved just before the switch, opens the at-camp preview.
  let server = fail503;
  const s = sandbox('pre-camp', () => server());
  s.run('_queueLoad(true)');
  await settle();
  server = ok;
  s.run('enterPreview()');
  assert.strictEqual(s.state().q, 0, 'parked on entry');
  await s.run('drainQueue()');
  assert.strictEqual(s.state().failed, 0, 'no tap dropped by the read-only guard');
  assert.ok(s.store[ADMIN_KEY], 'disk copy intact');
  s.run('exitPreview()');
  await settle();
  assert.strictEqual(s.out.posts.length, 2, 'drained on exit');
  assert.ok(!s.store[ADMIN_KEY], 'sent and cleared');
  assert.strictEqual(s.state().failed, 0);
}

async function tapDuringAccountPreview() {
  // Real mode at-camp, admin previews a church and taps a row: the tap is refused up front
  // (never queued, never dropped by api()'s guard), so no "Not saved" banner is left after Exit.
  const s = sandbox('at-camp', ok);
  s.store[ADMIN_KEY] = '[]';
  await s.run("enterAccountPreview('u2')");
  s.run("_performCheck('c9','in','Kid Nine')");
  await settle();
  await s.run('drainQueue()');
  assert.deepStrictEqual(s.state(), { q: 0, failed: 0, names: [], retry: false }, 'preview tap is not queued and not counted as failed');
  assert.strictEqual(s.out.posts.length, 0, 'nothing sent');
  assert.ok(s.out.toasts.includes('Preview — this is read-only'), 'the read-only toast is shown');
  s.run('exitAccountPreview()');
  await settle();
  assert.strictEqual(s.state().failed, 0, 'no stale banner after Exit');
  assert.strictEqual(s.out.posts.length, 0, 'the preview tap is not sent as the admin on Exit');
}

async function churchPreviewNoInitialsGate() {
  // Gate B UX 2: an admin previewing a church login that has no initials on this device taps a
  // row. The read-only refusal must come first: no initials sheet, nothing stored under the church.
  const s = sandbox('at-camp', ok);
  s.store[ADMIN_KEY] = '[]';
  await s.run("enterAccountPreview('u2')");
  s.run("LEADER_INITIALS=''");
  s.run("_performCheck('c9','in','Kid Nine')");
  assert.strictEqual(s.run('_sheets'), 0, 'no initials sheet during a preview');
  assert.ok(s.out.toasts.includes('Preview — this is read-only'), 'the read-only toast is the first thing shown');
  assert.ok(!Object.keys(s.store).some((k) => k.startsWith('ycp_initials_')), 'nothing written to the initials keys');
  assert.strictEqual(s.out.posts.length, 0);
}

async function undoClearedOnPreview() {
  // Queue review L3: tap, then enter a preview inside the 4 s Undo window. The Undo must be gone,
  // not turned into a reverse tap that api()'s guard drops while the original drains on Exit.
  const s = sandbox('at-camp', () => new Promise(() => {})); // the first tap stays in flight
  s.store[ADMIN_KEY] = '[]';
  s.run('_queueLoad(true)');
  s.run("_performCheck('c9','in','Kid Nine')");
  assert.strictEqual(s.run('_undoCamperId'), 'c9', 'setup: the Undo window is open');
  await s.run("enterAccountPreview('u2')");
  assert.strictEqual(s.run('_undoCamperId'), null, 'entering a preview closes the Undo window');
  s.run('undoCheck()');
  assert.strictEqual(s.state().q, 0, 'Undo during the preview queues nothing');
  assert.strictEqual(s.state().failed, 0, 'and leaves no "Not saved" count');
}

(async () => {
  await churchPreviewNoInitialsGate();
  await undoClearedOnPreview();
  await tapDuringAccountPreview();
  await accountPreview();
  await inFlightAtEntry();
  await samePreview();
  console.log('All checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
