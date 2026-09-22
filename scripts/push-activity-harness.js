/*
 * Notification delivery screen harness (2026-09-22).
 *
 * `_pushReached` / `_pushLastSuccess` / `_deviceLabel` are browser-only (public/index.html has
 * no build step), so vitest cannot reach them. Runs the REAL functions extracted by name.
 * `_deviceLabel` must only ever return a value in the server's PUSH_DEVICE_LABELS list, or
 * /push/subscribe rejects the whole subscribe with a validation error — the last check pins it.
 *
 *   node scripts/push-activity-harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ENTITY = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'entities', 'push-subscription.ts'), 'utf8');

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

const ctx = { console, String };
vm.createContext(ctx);
for (const f of ['_pushReached', '_pushLastSuccess', '_deviceLabel']) {
  vm.runInContext(extract('function ' + f + '('), ctx);
  if (typeof ctx[f] !== 'function') throw new Error('sandbox guard: ' + f + ' missing');
}
const { _pushReached, _pushLastSuccess, _deviceLabel } = ctx;

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}

const d = (lastSuccessAt) => ({ device: null, addedAt: '2026-09-01T00:00:00.000Z', lastSuccessAt, failureCount: 0 });
check('no phones = not reached', _pushReached([]), false);
check('undefined = not reached', _pushReached(undefined), false);
check('phones but none delivered = not reached', _pushReached([d(null), d(null)]), false);
check('any delivered phone = reached', _pushReached([d(null), d('2026-09-10T00:00:00.000Z')]), true);
check('last success is the newest across phones',
  _pushLastSuccess([d('2026-09-10T00:00:00.000Z'), d(null), d('2026-09-12T03:00:00.000Z')]), '2026-09-12T03:00:00.000Z');
check('last success null when never delivered', _pushLastSuccess([d(null)]), null);

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
};
check('iPhone', _deviceLabel(UA.iphone, 5), 'iPhone');
check('iPad (old UA)', _deviceLabel(UA.ipadOld, 5), 'iPad');
check('iPadOS desktop UA + touch = iPad', _deviceLabel(UA.ipadOS, 5), 'iPad');
check('Mac (no touch)', _deviceLabel(UA.ipadOS, 0), 'Mac');
check('Android', _deviceLabel(UA.android, 5), 'Android');
check('Windows', _deviceLabel(UA.win, 0), 'Windows');
check('empty UA = Other', _deviceLabel('', undefined), 'Other');

const allowed = (ENTITY.match(/PUSH_DEVICE_LABELS = \[([^\]]*)\]/) || [])[1];
if (!allowed) throw new Error('could not read PUSH_DEVICE_LABELS from push-subscription.ts');
const serverList = allowed.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
const produced = [...new Set([UA.iphone, UA.ipadOld, UA.android, UA.win, ''].map((u) => _deviceLabel(u, 0)).concat(_deviceLabel(UA.ipadOS, 5), _deviceLabel(UA.ipadOS, 0)))];
check('every label the SPA can send is accepted by the server',
  produced.filter((l) => !serverList.includes(l)), []);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
