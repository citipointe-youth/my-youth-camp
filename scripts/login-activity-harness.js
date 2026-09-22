/*
 * Login activity ordering harness (2026-09-22).
 *
 * `_loginActivityOrder` is browser-only code (public/index.html has no build step), so vitest
 * cannot reach it. Runs the REAL function extracted from index.html by name.
 *
 *   node scripts/login-activity-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Name-prefix match (not full signature) — see data-search-harness.js for why.
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

const ctx = { console, JSON, Object, String, Array };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(extract('function _loginActivityOrder('), ctx);
const { _loginActivityOrder } = ctx;
if (typeof _loginActivityOrder !== 'function') throw new Error('sandbox guard: _loginActivityOrder missing');

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}

const U = (role, username, churchName, extra) =>
  Object.assign({ role, username, churchName: churchName || null, status: 'active', loginHistory: [] }, extra);
const users = [
  U('church', 'g-victory', 'Victory Church'),
  U('firstAid', 'firstaid'),
  U('church', 'b-grace', 'Grace Point'),
  U('admin', 'admin'),
  U('church', 'b-victory', 'Victory Church'),
  U('zoneLeader', 'yellowzone'),
  U('director', 'director'),
  U('church', 'g-grace', 'Grace Point', { status: 'inactive' }),
  U('church', 'all-grace', 'Grace Point'),
];

const out = _loginActivityOrder(users);
check('leadership first (role order), then churches by church name + username',
  out.map((r) => r.u.username),
  ['admin', 'director', 'yellowzone', 'firstaid', 'all-grace', 'b-grace', 'g-grace', 'b-victory', 'g-victory']);
check('labels: role prefix for leadership, bare username for churches',
  out.map((r) => r.label),
  ['Admin: admin', 'Director: director', 'Zone leader: yellowzone', 'First aid: firstaid',
    'all-grace', 'b-grace', 'g-grace · inactive', 'b-victory', 'g-victory']);
check('leader flag', out.map((r) => r.leader), [true, true, true, true, false, false, false, false, false]);
check('does not mutate input order', users[0].username, 'g-victory');
check('empty input', _loginActivityOrder([]).length, 0);
check('null input', _loginActivityOrder(null).length, 0);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
