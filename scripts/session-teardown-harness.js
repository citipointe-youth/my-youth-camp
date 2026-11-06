/*
 * Session teardown harness (camp arch round 2026-11-07, A-5 + B-11). Runs the REAL
 * `sessionExpired`, `doLogin` and `_tryRestoreSession` from public/index.html against stubs.
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
    Cache: { clear: noop }, _rosterClear: noop, _queueStop: noop, _hideUndoToast: noop, _netStrip: noop, closeModal: noop, toast: noop,
    _undoTimer: null, _undoCamperId: 'c9', _bootOffline: false, MUST_CHANGE_PASSWORD_ENFORCED: false,
    TOKEN: 'preview-token', ACTOR: { id: 'u1' }, SESSIONS: [1], SEL_SESSION: 's1', SETTINGS: {}, STACK: ['x'],
    PREVIEW_MODE: true, ACCOUNT_PREVIEW: true, _previewStash: JSON.parse(ADMIN_STASH), _previewLocalFlips: { c1: true },
    LAST_LEADER: 'Sarah',
    ...extra,
  };
  vm.createContext(ctx);
  for (const decl of ['function sessionExpired(', 'async function doLogin(', 'async function _tryRestoreSession(']) vm.runInContext(extract(decl), ctx);
  return { ctx, ls, el };
}

(async () => {
  // sessionExpired tears down preview state (A-5) and the last "who" name (B-11).
  {
    const { ctx, ls, el } = sandbox({ ycp_preview_stash: ADMIN_STASH, [QUEUE_KEY]: QUEUE });
    ctx.sessionExpired();
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
  console.log('All checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
