/*
 * Session teardown harness (camp arch round 2026-11-07, A-5 + B-11). Runs the REAL
 * `leave` (was `sessionExpired`), `doLogin` and `_tryRestoreSession` from public/index.html against stubs.
 *
 *   node scripts/session-teardown-harness.js
 *
 * A-5: preview state must not survive an expiry, a fresh login, or a cold open whose stash is
 * the signed-in user's own (otherwise Exit hands back a stale admin token).
 * B-11: the previous login's "who" name must not pre-fill the next login's forms.
 * Both: the saved offline check-in queue (ycp_ciq_<login>) is never touched.
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

const QUEUE_KEY = 'ycp_ciq_sam';
const QUEUE = JSON.stringify([{ camperId: 'c1', sessionId: 's1', type: 'in', ts: 1 }]);
const ADMIN_STASH = JSON.stringify({ token: 'admin-token', actor: { id: 'admin1' } });

function sandbox(store, extra) {
  const ls = new Map(Object.entries(store));
  const els = {};
  const el = (id) => els[id] || (els[id] = (() => {
    const cls = new Set(id === 'previewBanner' ? ['show'] : []);
    return { style: {}, textContent: '', value: '', classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  })());
  const noop = () => {};
  const ctx = {
    JSON, Error, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    document: { getElementById: el },
    Cache: { clear: noop }, _rosterClear: noop, _queueStop: noop, _queueStep: noop, _hideUndoToast: noop, _netStrip: noop, closeModal: noop, toast: noop,
    _undoTimer: null, _undoCamperId: 'c9', _bootOffline: false, MUST_CHANGE_PASSWORD_ENFORCED: false,
    TOKEN: 'preview-token', ACTOR: { id: 'u1' }, SESSIONS: [1], SEL_SESSION: 's1', SETTINGS: {}, STACK: ['x'],
    PREVIEW_MODE: true, ACCOUNT_PREVIEW: true, _previewStash: JSON.parse(ADMIN_STASH), _previewLocalFlips: { c1: true },
    LAST_LEADER: 'Sarah',
    ...extra,
  };
  vm.createContext(ctx);
  for (const decl of ['function leave(', 'async function doLogin(', 'async function _tryRestoreSession(']) vm.runInContext(extract(decl), ctx);
  return { ctx, ls, el };
}

(async () => {
  // sessionExpired tears down preview state (A-5) and the last "who" name (B-11).
  {
    const { ctx, ls, el } = sandbox({ ycp_preview_stash: ADMIN_STASH, [QUEUE_KEY]: QUEUE });
    ctx.leave('expired');
    assert.strictEqual(ctx.PREVIEW_MODE, false, 'sessionExpired: PREVIEW_MODE');
    assert.strictEqual(ctx.ACCOUNT_PREVIEW, false, 'sessionExpired: ACCOUNT_PREVIEW');
    assert.strictEqual(ctx._previewStash, null, 'sessionExpired: _previewStash');
    assert.deepStrictEqual(Object.keys(ctx._previewLocalFlips), [], 'sessionExpired: _previewLocalFlips');
    assert.strictEqual(ls.has('ycp_preview_stash'), false, 'sessionExpired: stored stash');
    assert.strictEqual(el('previewBanner').classList.contains('show'), false, 'sessionExpired: banner');
    assert.strictEqual(ctx.LAST_LEADER, '', 'sessionExpired: LAST_LEADER (B-11)');
    assert.strictEqual(ls.get(QUEUE_KEY), QUEUE, 'sessionExpired: saved check-in queue untouched');
  }

  // doLogin: a password login is never a preview. The stash and flags are gone before the
  // login POST (else the write guard refuses it) and the queue is left alone.
  {
    let seen = null;
    const api = (p) => {
      seen = { p, PREVIEW_MODE: ctx.PREVIEW_MODE, ACCOUNT_PREVIEW: ctx.ACCOUNT_PREVIEW, stash: ls.get('ycp_preview_stash'), mem: ctx._previewStash };
      return Promise.reject(new Error('stop'));
    };
    const { ctx, ls } = sandbox({ ycp_preview_stash: ADMIN_STASH, [QUEUE_KEY]: QUEUE }, { api });
    await ctx.doLogin();
    assert.strictEqual(seen.p, '/auth/login');
    assert.strictEqual(seen.PREVIEW_MODE, false, 'doLogin: PREVIEW_MODE before POST');
    assert.strictEqual(seen.ACCOUNT_PREVIEW, false, 'doLogin: ACCOUNT_PREVIEW before POST');
    assert.strictEqual(seen.stash, undefined, 'doLogin: stored stash removed before POST');
    assert.strictEqual(seen.mem, null, 'doLogin: _previewStash before POST');
    assert.strictEqual(ls.get(QUEUE_KEY), QUEUE, 'doLogin: saved check-in queue untouched');
  }

  // _tryRestoreSession: a stash whose actor is the signed-in actor is stale and is dropped.
  const restore = async (stashActor) => {
    const stash = JSON.stringify({ token: 'admin-token', actor: { id: stashActor } });
    const api = () => Promise.reject(Object.assign(new Error('stop'), { transient: false }));
    const s = sandbox({ ycp_token: 't', ycp_actor: JSON.stringify({ id: 'u1' }), ycp_preview_stash: stash, [QUEUE_KEY]: QUEUE },
      { api, TOKEN: null, ACTOR: null, PREVIEW_MODE: false, ACCOUNT_PREVIEW: false, _previewStash: null });
    s.el('previewBanner').classList.remove('show');
    let flagAtMe = null, stashAtMe = null;
    s.ctx.api = (p) => { if (p === '/auth/me') { flagAtMe = s.ctx.ACCOUNT_PREVIEW; stashAtMe = s.ls.has('ycp_preview_stash'); } return api(); };
    await s.ctx._tryRestoreSession();
    return { ...s, flagAtMe, stashAtMe };
  };
  {
    const { ls, flagAtMe } = await restore('u1');
    assert.strictEqual(flagAtMe, false, 'restore stale-self: not re-entered as preview');
    assert.strictEqual(ls.has('ycp_preview_stash'), false, 'restore stale-self: stash dropped');
    assert.strictEqual(ls.get(QUEUE_KEY), QUEUE, 'restore stale-self: saved check-in queue untouched');
  }
  {
    // A live account preview (stash is the admin, actor is the previewed login) still resumes.
    const { flagAtMe, stashAtMe } = await restore('admin1');
    assert.strictEqual(flagAtMe, true, 'restore live preview: resumes as preview');
    assert.strictEqual(stashAtMe, true, 'restore live preview: stash kept');
  }
  {
    // Gate A queue review L2: a non-401 refusal of /auth/me (no sessionExpired) must not leave
    // a live preview over the login screen, where Exit would write the stashed admin token.
    const { ctx, ls, el } = await restore('admin1');
    assert.strictEqual(ctx.ACCOUNT_PREVIEW, false, 'restore refused: ACCOUNT_PREVIEW');
    assert.strictEqual(ctx.PREVIEW_MODE, false, 'restore refused: PREVIEW_MODE');
    assert.strictEqual(ctx._previewStash, null, 'restore refused: _previewStash');
    assert.strictEqual(ls.has('ycp_preview_stash'), false, 'restore refused: stored stash');
    assert.strictEqual(el('previewBanner').classList.contains('show'), false, 'restore refused: banner');
    assert.strictEqual(ls.get(QUEUE_KEY), QUEUE, 'restore refused: saved check-in queue untouched');
  }
  {
    // Gate A code review M3: a staff account with no first/last name signs as its username, never
    // blank (the server 400s a blank leaderName). A church still signs with its initials.
    const ctx = { ACTOR: { displayName: '', username: 'fa2' }, LEADER_INITIALS: '', _isChurchAccount: () => false };
    vm.createContext(ctx);
    vm.runInContext(extract('function _actingName('), ctx);
    assert.strictEqual(ctx._actingName(), 'fa2', 'acting name: blank display name falls back to username');
    ctx.ACTOR.displayName = 'Sam Lee';
    assert.strictEqual(ctx._actingName(), 'Sam Lee', 'acting name: display name wins');
    ctx._isChurchAccount = () => true; ctx.LEADER_INITIALS = 'AB';
    assert.strictEqual(ctx._actingName(), 'AB', 'acting name: church uses initials');
    assert.ok(/const leaderName=_actingName\(\);/.test(extract('async function fdConfirmAll(')), 'first-day arrival uses _actingName');
  }
  // S1 (2026-11-07): one way into the shell. Login, change of password and reopen run the same order;
  // only the queue step differs (login/change-password: load all + drain before the first await;
  // reopen: _resumeQueue). IA-OQ-11: change of password now loads the queue and offers the note draft.
  const shell = async (fn, extra = {}) => {
    const calls = [];
    const rec = (name, ret) => (...a) => { calls.push(a.length ? name + '(' + a.map(String).join(',') + ')' : name); return ret; };
    const ls = new Map(Object.entries({ ycp_token: 't', ycp_actor: JSON.stringify({ id: 'u1', role: 'church', mustChangePassword: true }) }));
    const els = {};
    const el = (id) => els[id] || (els[id] = { style: {}, value: id === 'mcp-cur' ? 'old' : id.startsWith('mcp-new') ? 'newpass1' : 'x', textContent: '',
      classList: { add() {}, remove() {}, contains: () => false } });
    const ctx = {
      JSON, Error, Promise, setTimeout, clearTimeout, location: { reload() {} }, navigator: {}, window: { addEventListener() {} },
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      document: { getElementById: el },
      Cache: { clear() {} }, toast() {}, MUST_CHANGE_PASSWORD_ENFORCED: false, _bootOffline: false,
      api: async (p) => (p === '/auth/login' ? { token: 't2', user: { id: 'u1', role: 'church' } } : p === '/settings' ? { campMode: 'at-camp' } : {}),
      TOKEN: 't', ACTOR: { id: 'u1', role: 'church', mustChangePassword: true }, PREVIEW_MODE: false, ACCOUNT_PREVIEW: false, _previewStash: null,
      CHECKIN_QUEUE: [], _draining: false, STACK: [],
      _restoreFilters: rec('_restoreFilters'), updateModeUI: rec('updateModeUI'), buildTabs: rec('buildTabs'), _prefetch: rec('_prefetch'),
      drainQueue: rec('drainQueue'), _resumeQueue: rec('_resumeQueue'), gotoTab: async (t) => { calls.push('gotoTab(' + t + ')'); },
      _loadLeaderInitials: rec('_loadLeaderInitials'), enforceInitials: rec('enforceInitials'), _offerNoteDraft: rec('_offerNoteDraft'),
      _offerAlertsAfterLogin: rec('_offerAlertsAfterLogin'), _consumePushNav: rec('_consumePushNav', null), _renderWideNav: rec('_renderWideNav'),
      _netStrip: rec('_netStrip'), _savedSettings: () => ({ campMode: 'at-camp' }), _mcpErr: (m) => { throw new Error('mcpErr ' + m); },
      ...extra,
    };
    ctx._queueLoad = (...a) => { calls.push('_queueLoad(' + a.map(String).join(',') + ')'); ctx.CHECKIN_QUEUE.push({}); };
    vm.createContext(ctx);
    for (const d of ['async function doLogin(', 'async function submitChangePassword(', 'async function _tryRestoreSession(', 'async function enterShell(', 'function _queueStep(']) {
      try { vm.runInContext(extract(d), ctx); } catch (e) { if (!/not found/.test(e.message)) throw e; } // enterShell/_queueStep: S1 only
    }
    await ctx[fn]();
    return calls;
  };
  const SIGN_IN = ['_restoreFilters', 'updateModeUI', 'buildTabs', '_prefetch', '_queueLoad(true)', 'drainQueue', 'gotoTab(home)',
    '_loadLeaderInitials', 'enforceInitials', '_offerNoteDraft', '_offerAlertsAfterLogin'];
  assert.deepStrictEqual(await shell('doLogin'), SIGN_IN, 'login order');
  assert.deepStrictEqual(await shell('submitChangePassword'), SIGN_IN, 'change of password = login order, queue + note draft (IA-OQ-11)');
  assert.deepStrictEqual(await shell('_tryRestoreSession'), ['_restoreFilters', 'updateModeUI', 'buildTabs', '_prefetch', '_resumeQueue(false)',
    'gotoTab(home)', '_loadLeaderInitials', 'enforceInitials', '_offerNoteDraft', '_offerAlertsAfterLogin', '_consumePushNav'], 'reopen order');
  const offlineApi = async (p) => { if (p === '/auth/me') throw Object.assign(new Error('x'), { transient: true }); return {}; };
  assert.deepStrictEqual(await shell('_tryRestoreSession', { api: offlineApi }), ['_restoreFilters', 'updateModeUI', 'buildTabs', '_prefetch',
    '_resumeQueue(true)', 'gotoTab(home)', '_loadLeaderInitials', 'enforceInitials', '_offerNoteDraft', '_renderWideNav(home)', '_netStrip'], 'offline reopen order');

  // Gate B2 queue review L-1: enforceInitials itself refuses in a preview (a reload mid account-preview
  // of a church must not show the church initials sheet on the admin's phone).
  {
    let sheets = 0;
    const ctx = { _isChurchAccount: () => true, LEADER_INITIALS: '', modal: () => { sheets++; }, setTimeout() {}, document: { getElementById: () => null }, PREVIEW_MODE: false, ACCOUNT_PREVIEW: true };
    vm.createContext(ctx);
    vm.runInContext(extract('function enforceInitials('), ctx);
    ctx.enforceInitials();
    assert.strictEqual(sheets, 0, 'account preview: no initials sheet');
    ctx.ACCOUNT_PREVIEW = false; ctx.PREVIEW_MODE = true; ctx.enforceInitials();
    assert.strictEqual(sheets, 0, 'at-camp preview: no initials sheet');
    ctx.PREVIEW_MODE = false; ctx.enforceInitials();
    assert.strictEqual(sheets, 1, 'a real church login still gets the sheet');
  }
  // S1 interface: _queueStep is the only event -> queue map.
  {
    const ctx = { CHECKIN_QUEUE: [], _draining: false, _bootOffline: true, calls: [] };
    vm.createContext(ctx);
    vm.runInContext(extract('function _queueStep(') + ';var _queueLoad=(k)=>{calls.push("load"+k);CHECKIN_QUEUE.push(1);},drainQueue=()=>calls.push("drain"),'
      + '_resumeQueue=(k)=>calls.push("resume"+k),_queueStop=()=>calls.push("stop");', ctx);
    const step = (k) => { ctx.calls.length = 0; ctx.CHECKIN_QUEUE.length = 0; ctx._queueStep(k); return ctx.calls.join(' '); };
    for (const k of ['login', 'changePassword', 'exitPreview']) assert.strictEqual(step(k), 'loadtrue drain', k);
    assert.strictEqual(step('restore'), 'resumetrue', 'restore: _resumeQueue(_bootOffline)');
    for (const k of ['enterPreview', 'leave']) assert.strictEqual(step(k), 'stop', k);
    assert.strictEqual(step('nonsense'), '', 'an unknown kind touches nothing');
  }
  // S1 interface: leave('logout') tells the server, drops this login's saved data and reloads.
  {
    const posts = [];
    const { ctx, ls } = sandbox({ ycp_token: 't', ycp_actor: '{}', ycp_settings: '{}', ycp_preview_stash: ADMIN_STASH, [QUEUE_KEY]: QUEUE }, {
      api: (p, o) => { posts.push([p, o.method, ctx.PREVIEW_MODE, ctx.ACCOUNT_PREVIEW]); return Promise.resolve(); },
      sessionStorage: { removeItem() {} }, _ndKey: () => 'nd', _drainRetry: 1, _ciqKey: () => QUEUE_KEY, location: { reload: () => { posts.push('reload'); } },
    });
    ctx.leave('logout');
    assert.deepStrictEqual(posts, [['/auth/logout', 'POST', false, false], 'reload'], 'logout POST outside the preview guard, then reload');
    for (const k of ['ycp_token', 'ycp_actor', 'ycp_settings', 'ycp_preview_stash', QUEUE_KEY]) assert.strictEqual(ls.has(k), false, 'logout clears ' + k);
    assert.strictEqual(ctx.TOKEN, null);
  }
  // S3: the two transport events are wired at load (before boot) to the session module.
  {
    const i = SRC.indexOf("window.addEventListener('ycp:session-ended',()=>leave('expired'));");
    const j = SRC.indexOf("window.addEventListener('ycp:must-change-password',");
    const boot = SRC.indexOf('/* ===== BOOT ===== */');
    assert.ok(i > 0 && j > 0 && i < boot && j < boot, 'listeners registered before boot');
    const mcp = SRC.slice(j, SRC.indexOf('});', j) + 3);
    let gate = 0; const ls = new Map();
    const target = new EventTarget();
    const ctx = { window: target, JSON, ACTOR: { id: 'u1', mustChangePassword: false }, localStorage: { setItem: (k, v) => ls.set(k, v) }, _showChangePasswordGate: () => { gate++; } };
    vm.createContext(ctx);
    vm.runInContext(mcp, ctx);
    target.dispatchEvent(new CustomEvent('ycp:must-change-password'));
    assert.strictEqual(gate, 1, 'gate shown');
    assert.strictEqual(ctx.ACTOR.mustChangePassword, true, 'stale ACTOR flag corrected');
    assert.strictEqual(JSON.parse(ls.get('ycp_actor')).mustChangePassword, true, 'and stored');
  }
  console.log('All checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
