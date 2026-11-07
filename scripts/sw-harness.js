/*
 * Service worker harness (camp arch round 2026-11-07, B-12). Runs the REAL public/sw.js fetch
 * handler in a vm with an in-memory Cache API (exact-URL keys, like the browser default) and a
 * fake fetch, plus the SPA's controllerchange handler from public/index.html.
 *
 *   node scripts/sw-harness.js
 *
 * B-12a: a 5xx on the shell serves the cached shell, and a 5xx is never cached.
 * B-12b: /?nav=<screen> offline (a tapped notification) finds the shell cached under /.
 * B-12c: the first-install claim does not reload the page (a half-typed login survives); later
 *        deploy reloads still happen.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SW = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ORIGIN = 'https://camp.test';
const SHELL = '<html>SHELL</html>';

// net: 'offline' throws like fetch does with no signal; otherwise a status to answer with.
async function shell(net, url, cached = true) {
  const store = new Map();
  if (cached) store.set(ORIGIN + '/', new Response(SHELL, { status: 200 }));
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN);
  const caches = {
    open: async () => ({ put: async (r, res) => { store.set(key(r).href, res); }, addAll: async () => {} }),
    match: async (r, o) => { const u = key(r); if (o && o.ignoreSearch) u.search = ''; const hit = store.get(u.href); return hit && hit.clone(); },
    keys: async () => [], delete: async () => true,
  };
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
  const fetch = async () => {
    if (net === 'offline') throw new TypeError('Failed to fetch');
    return new Response(net === 200 ? '<html>NEW</html>' : 'Vercel ' + net, { status: net });
  };
  vm.runInNewContext(SW, { self, caches, fetch, URL, Response, Request, Promise, encodeURIComponent });
  let p;
  listeners.fetch({ request: new Request(ORIGIN + url), respondWith: (x) => { p = x; } });
  assert.ok(p, 'the shell branch must answer ' + url);
  const res = await p;
  await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget cache.put land
  const body = res ? await res.text() : undefined;
  const keep = store.get(ORIGIN + '/');
  return { status: res && res.status, body, cachedShell: keep ? await keep.clone().text() : null, keys: [...store.keys()] };
}

function controllerChange(controlledAtBoot) {
  const i = SRC.indexOf("if('serviceWorker'in navigator){", SRC.indexOf('/* PWA: register the service worker'));
  let depth = 0, j = i;
  for (; j < SRC.length; j++) { if (SRC[j] === '{') depth++; else if (SRC[j] === '}' && --depth === 0) break; }
  const handlers = {};
  const out = { reloads: 0 };
  const navigator = { serviceWorker: {
    controller: controlledAtBoot ? {} : null,
    addEventListener: (t, f) => { handlers[t] = f; },
    register: () => ({ then() { return { catch() {} }; } }),
  } };
  vm.runInNewContext(SRC.slice(i, j + 1), {
    navigator, window: { addEventListener() {} }, document: { addEventListener() {} },
    location: { reload: () => { out.reloads++; } },
  });
  out.fire = () => { navigator.serviceWorker.controller = {}; handlers.controllerchange(); };
  return out;
}

(async () => {
  // B-12a
  for (const status of [500, 502, 503, 504]) {
    const r = await shell(status, '/');
    assert.strictEqual(r.status, 200, status + ' on / serves the cached shell');
    assert.strictEqual(r.body, SHELL);
    assert.strictEqual(r.cachedShell, SHELL, 'the ' + status + ' is never cached');
  }
  const empty = await shell(504, '/', false);
  assert.strictEqual(empty.status, 504, 'nothing cached: the 5xx passes through');
  assert.deepStrictEqual(empty.keys, [], 'and is not cached');
  const navErr = await shell(503, '/?nav=notifs');
  assert.strictEqual(navErr.body, SHELL, 'a 5xx on /?nav= also gets the shell');
  const notFound = await shell(404, '/');
  assert.strictEqual(notFound.status, 404, 'a 4xx is not a server outage: passed through');
  assert.strictEqual(notFound.cachedShell, SHELL, 'and not cached');
  const fresh = await shell(200, '/');
  assert.strictEqual(fresh.body, '<html>NEW</html>', 'online: network first');
  assert.strictEqual(fresh.cachedShell, '<html>NEW</html>', 'and the new shell is cached');

  // Queue review L1: an online /?nav= load refreshes the one shell copy under '/', and makes no
  // second copy that ignoreSearch could later pick (the browser returns the oldest match).
  const navOnline = await shell(200, '/?nav=notifs');
  assert.deepStrictEqual(navOnline.keys, [ORIGIN + '/'], 'only one shell copy, under /');
  assert.strictEqual(navOnline.cachedShell, '<html>NEW</html>', 'and it is the new one');

  // B-12b
  const nav = await shell('offline', '/?nav=notifs');
  assert.strictEqual(nav.status, 200, 'offline /?nav= finds the shell cached under /');
  assert.strictEqual(nav.body, SHELL);
  const root = await shell('offline', '/');
  assert.strictEqual(root.body, SHELL, 'control: offline / serves the shell');

  // B-12c
  const first = controllerChange(false);
  first.fire();
  assert.strictEqual(first.reloads, 0, 'first install: the claim does not reload (typed login survives)');
  first.fire();
  assert.strictEqual(first.reloads, 1, 'a later deploy in the same page still reloads');
  first.fire();
  assert.strictEqual(first.reloads, 1, 'reload once');
  const deploy = controllerChange(true);
  deploy.fire();
  assert.strictEqual(deploy.reloads, 1, 'a page that had a controller reloads on a new deploy');

  console.log('All checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
