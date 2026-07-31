const CACHE = 'camp-v69';
const APP_SHELL = ['/'];

// API paths that must NEVER be served from cache. GOTCHA (from connection-made-simple):
// EVERY top-level API prefix the SPA calls must be listed here. A missing one falls
// through to the cache-first asset path below and can get the SPA's HTML cached under
// that URL — which then breaks JSON parsing ("unexpected token <"). When you add a new
// top-level API route to the backend, add it here AND bump CACHE above.
// (export ADDED — the SPA downloads /export/audit, /export/registrants, /export/signin-out;
//  without it these fell through to cache-first and could serve stale HTML — the documented
//  API_RE gotcha. Verified against src/api/http/router.ts route prefixes.)
// `push` ADDED 2026-07-30 — the SPA now calls GET /push/config and POST/DELETE
// /push/subscribe. `internal` is still deliberately absent: /internal/cron/tick is
// server-to-server (Supabase pg_cron → pg_net) and never passes through a service worker.
const API_RE = /^\/(auth|home|settings|admin|registrants|accommodation|campers|checkin|attendance|notes|search|notifications|schedule|faq|devotional|import|export|accounts|health|setup|incidents|push)(\/|$|\?)/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Network-only for API routes (never serve stale data).
  if (API_RE.test(url.pathname)) return;

  // Network-first for the HTML shell — always pick up the latest deploy when online,
  // fall back to cache when offline.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for other static assets (manifest, icons, fonts).
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

// ─── Web push ────────────────────────────────────────────────────────────────────────
//
// `userVisibleOnly: true` is mandatory on every browser that matters, which means this
// handler MUST call showNotification() for every push it receives. A push that shows
// nothing gets the origin penalised or the subscription revoked — there is no "silent
// push, decide later" option. That is exactly why the payload is deliberately vague:
// whatever arrives here is rendered on a possibly-locked screen, so the server never puts
// a notice body, an incident summary or any person field in it. See push.service.ts.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Youth Camp', {
    body: d.body || 'Open the app for details.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Collapses repeats of the same kind of alert rather than stacking them. Generic
    // strings only — never a person or session id.
    tag: d.tag || 'camp',
    data: { screen: d.screen || 'home' },
  }));
});

// Deep-link gotcha: this SPA has NO URL router — navigation is go(screenId) against a
// fixed set of <section class="screen"> elements. So we cannot navigate by URL. Instead
// we postMessage the target screen to an already-open client, and fall back to
// openWindow('/?nav=…') for a cold start, which index.html reads once at boot.
//
// ⚠ The screen name here is whatever the SERVER put in the payload, and a name with no
// matching <section> takes the app to a blank page (2026-07-31 bug: the server sent
// 'notices'; the screen is 'notifs'). The SPA validates it in _pushNavTo() before
// navigating — do not "simplify" that back to a bare go(). Notifications already sitting
// on a phone still carry the old payload, so this path must stay survivable.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const screen = (e.notification.data && e.notification.data.screen) || 'home';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { c.postMessage({ type: 'push-nav', screen: screen }); return c.focus(); }
      }
      return self.clients.openWindow('/?nav=' + encodeURIComponent(screen));
    })
  );
});
