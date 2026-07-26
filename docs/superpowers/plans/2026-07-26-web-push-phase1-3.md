# Web Push — Phases 1–3 (scheduler, persistence, check-in warnings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a scheduled tick that runs inside the existing Express app, add the persistence
`push_subscriptions` and the two new `notifications` columns need, and ship trigger 3 (check-in
window closing) as an **in-app notice only** — no Web Push, no VAPID, no new personal data.

**Architecture:** A Supabase `pg_cron` job calls `GET /internal/cron/tick` over HTTP via `pg_net`,
authenticated with a bearer secret held in Supabase Vault. The route is an ordinary entry in the
existing route table, guarded by a constant-time secret compare rather than the app's auth layer.
Detection logic for trigger 3 lives in a new **pure** module with no I/O, so it is fully unit
testable; the tick is the only thing that touches repositories.

**Tech Stack:** TypeScript (strict, CommonJS output), Express 4, postgres.js v3, Supabase Postgres,
Vitest.

## Global Constraints

- **Source of truth:** `docs/superpowers/specs/2026-07-26-web-push-design.md`. Read §0 (owner
  decisions D1–D10) before starting. Where this plan and the spec disagree, the spec's §0 wins.
- **`tsconfig` must emit CommonJS** (`module: CommonJS`, `moduleResolution: Node`). Never change it —
  `@vercel/node` crashes on load otherwise. Not caught by `tsc` or `vitest`.
- **`vercel.json` is NOT modified by this plan.** No `crons` key is added (D1).
- **Next migration number is `0013`.** The repo holds `0001`–`0012`.
- **Verification is `npm run typecheck` + `npm run test` + reasoning/grep only.** Do NOT start a
  localhost dev server, do NOT drive a browser, do NOT poll Vercel deployments. Pushing to `master`
  IS the deploy.
- **Baseline before you start:** `npm run test` must be green. Record the pass count; every task
  states the expected new count as a delta.
- **postgres.js has no `$n` placeholders.** Use tagged-template interpolation. For an id list the
  idiom is `` where id in ${this.sql(ids)} `` and it **throws on an empty array** — always guard
  with `if (ids.length === 0) return …` first (precedent: `loadHistories` in `supabase.people.ts`).
- **Field-crypto AAD format** is exactly `` `${table}:${column}:${id}` ``.
- **Commit after every task.** Do not push; the owner controls deploys.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/0013_push_subscriptions.sql` | New table, two `notifications` columns, `pg_cron`/`pg_net` extensions, the schedule |
| `src/core/entities/push-subscription.ts` | `PushSubscription` entity |
| `src/repositories/supabase/supabase.push-subscriptions.ts` | Row⇄entity mappers + Supabase repo |
| `src/repositories/supabase/supabase.push-subscriptions.mapper.test.ts` | Mapper encryption round-trip tests |
| `src/services/notification-visibility.ts` | Pure `canSeeNotification()` — one rule set for feed **and** push audience |
| `src/services/notification-visibility.test.ts` | Its tests |
| `src/services/checkin-warnings.ts` | Pure `churchesBehind()` — trigger 3 detection |
| `src/services/checkin-warnings.test.ts` | Its tests, incl. the Brisbane/UTC boundary case |
| `src/services/cron.service.ts` | Orchestrates the tick's jobs; the only I/O for trigger 3 |
| `src/api/controllers/cron.controller.ts` | Secret guard + delegates to the service |
| `src/api/controllers/cron.controller.test.ts` | Guard tests |

**Modified:**

| Path | Change |
|---|---|
| `src/api/http/types.ts` | `HttpRequest` gains optional `headers?` |
| `src/api/http/express-adapter.ts:114-120` | Populate `headers` |
| `src/api/http/router.ts` | Register `GET /internal/cron/tick` |
| `src/core/entities/notification.ts` | Gains `pushSentAt?`, `dedupeKey?` |
| `src/repositories/supabase/supabase.notifications.ts` | Map + persist the two new columns |
| `src/repositories/interfaces/entity-repositories.ts` | `IPushSubscriptionRepository`; `INotificationRepository` gains `claimForPush` |
| `src/repositories/in-memory/in-memory.repositories.ts` | In-memory push-subscription repo + `claimForPush` |
| `src/repositories/supabase/index.ts` | Explicit named export (this barrel is not `export *`) |
| `src/container.ts` | Wire the new repo in both branches; wire `cron` service |
| `src/services/notification.service.ts` | `getActorFeed` refactored onto `canSeeNotification` |
| `src/config/env.ts` | Document `CRON_SECRET` |

---

## Task 1: `HttpRequest.headers` plumbing

The tick route must read `Authorization`, and `HttpRequest` has no `headers` field today. Verified:
the interface is constructed in exactly **one** production place plus one test helper that already
spreads overrides, so an optional field breaks nothing.

**Files:**
- Modify: `src/api/http/types.ts` (the `HttpRequest` interface)
- Modify: `src/api/http/express-adapter.ts:114-120`

**Interfaces:**
- Produces: `HttpRequest.headers?: Record<string, string | undefined>` — lower-cased header names,
  array-valued headers collapsed to their first element. Consumed by Task 3.

- [ ] **Step 1: Add the optional field**

In `src/api/http/types.ts`, inside `interface HttpRequest`, after `ip?: string;`:

```ts
  /**
   * Lower-cased request headers. Populated by the Express adapter. Optional because
   * controller unit tests construct `HttpRequest` literals directly and must not be
   * forced to supply it. Array-valued headers are collapsed to their first value.
   * Added for the `/internal/cron/tick` bearer-secret guard, which cannot use the
   * app's normal auth layer.
   */
  headers?: Record<string, string | undefined>;
```

- [ ] **Step 2: Populate it in the adapter**

In `src/api/http/express-adapter.ts`, the `httpReq` literal at ~line 114 currently reads:

```ts
        const httpReq: HttpRequest = {
          ctx,
          params: req.params as Record<string, string>,
          query: req.query as Record<string, string | undefined>,
          body: req.body,
          ip: req.ip,
        };
```

Change it to:

```ts
        const httpReq: HttpRequest = {
          ctx,
          params: req.params as Record<string, string>,
          query: req.query as Record<string, string | undefined>,
          body: req.body,
          ip: req.ip,
          headers: normaliseHeaders(req.headers),
        };
```

and add this helper at module scope (above the exported adapter function):

```ts
/**
 * Express's IncomingHttpHeaders values are `string | string[] | undefined`. Collapse
 * arrays to the first element so route handlers get a flat, predictable shape.
 */
function normaliseHeaders(
  h: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}
```

- [ ] **Step 3: Verify nothing broke**

Run: `npm run typecheck`
Expected: clean, no output.

Run: `npm run test`
Expected: the same pass count as your recorded baseline. This task adds no tests — it is a
type-level change whose only proof is that the suite is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/api/http/types.ts src/api/http/express-adapter.ts
git commit -m "feat(http): expose request headers on HttpRequest

Needed by the /internal/cron/tick bearer-secret guard, which sits outside
the app's normal auth layer. Optional field so controller unit tests that
build HttpRequest literals are unaffected."
```

---

## Task 2: `canSeeNotification` extraction

Audience currently lives only as a per-actor forward filter inside `getActorFeed`. Push needs the
inverse. Writing a second copy guarantees drift, so extract one predicate and refactor the feed onto
it. **This task must not change behaviour** — the existing notification tests passing unchanged is
the proof.

**Files:**
- Create: `src/services/notification-visibility.ts`
- Create: `src/services/notification-visibility.test.ts`
- Modify: `src/services/notification.service.ts` (`getActorFeed`)

**Interfaces:**
- Produces: `canSeeNotification(actor, n, nowIso): boolean` where `actor` is
  `Pick<Actor, 'role' | 'zone' | 'churchId'>`. Consumed by the push audience resolver in a later
  phase, and by `getActorFeed` here.

- [ ] **Step 1: Write the failing test**

Create `src/services/notification-visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canSeeNotification } from './notification-visibility';
import type { Notification } from '../core/entities/notification';
import type { Actor } from '../core/entities/user';

const NOW = '2026-09-29T02:00:00.000Z';

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'notif_1',
    scope: 'camp',
    zone: null,
    churchId: null,
    priority: 'normal',
    title: 'T',
    body: 'B',
    senderId: 'usr_admin',
    senderName: 'Admin',
    senderRole: 'admin',
    leadersOnly: false,
    audienceEstimate: 0,
    expiresAt: null,
    scheduledFor: null,
    createdAt: '2026-09-29T01:00:00.000Z',
    ...over,
  };
}

function actor(over: Partial<Actor> = {}): Actor {
  return {
    id: 'usr_1',
    role: 'church',
    churchId: 'ch_victory',
    churchName: 'Victory',
    zone: 'Blue',
    displayName: 'Victory Boys',
    genderScope: 'male',
    ...over,
  };
}

describe('canSeeNotification', () => {
  it('shows a camp-scope notice to everyone', () => {
    expect(canSeeNotification(actor(), notif(), NOW)).toBe(true);
    expect(canSeeNotification(actor({ role: 'firstAid' }), notif(), NOW)).toBe(true);
  });

  it('hides a leadersOnly notice from church and firstAid', () => {
    const n = notif({ leadersOnly: true });
    expect(canSeeNotification(actor({ role: 'church' }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ role: 'firstAid' }), n, NOW)).toBe(false);
  });

  it('shows a leadersOnly notice to zoneLeader, director and admin', () => {
    const n = notif({ leadersOnly: true });
    for (const role of ['zoneLeader', 'director', 'admin'] as const) {
      expect(canSeeNotification(actor({ role }), n, NOW)).toBe(true);
    }
  });

  it('withholds a notice scheduled in the future from everyone', () => {
    const n = notif({ scheduledFor: '2026-09-29T03:00:00.000Z' });
    expect(canSeeNotification(actor({ role: 'admin' }), n, NOW)).toBe(false);
  });

  it('releases a notice once its scheduled time has passed', () => {
    const n = notif({ scheduledFor: '2026-09-29T01:30:00.000Z' });
    expect(canSeeNotification(actor({ role: 'admin' }), n, NOW)).toBe(true);
  });

  it('matches zone scope only for the same zone, but always for oversight', () => {
    const n = notif({ scope: 'zone', zone: 'Blue' });
    expect(canSeeNotification(actor({ role: 'zoneLeader', zone: 'Blue' }), n, NOW)).toBe(true);
    expect(canSeeNotification(actor({ role: 'zoneLeader', zone: 'Red' }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ role: 'director', zone: null }), n, NOW)).toBe(true);
  });

  it('matches church scope only for the same church, but always for oversight', () => {
    const n = notif({ scope: 'church', churchId: 'ch_victory' });
    expect(canSeeNotification(actor({ churchId: 'ch_victory' }), n, NOW)).toBe(true);
    expect(canSeeNotification(actor({ churchId: 'ch_other' }), n, NOW)).toBe(false);
    expect(canSeeNotification(actor({ role: 'admin', churchId: null }), n, NOW)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/notification-visibility.test.ts`
Expected: FAIL — `Failed to resolve import "./notification-visibility"`.

- [ ] **Step 3: Create the module**

Create `src/services/notification-visibility.ts`:

```ts
import type { Notification } from '../core/entities/notification';
import type { Actor } from '../core/entities/user';

/**
 * Can this actor see this notification right now?
 *
 * SINGLE SOURCE OF TRUTH for notification audience. Used in BOTH directions:
 *   - forward  (`notification.service.getActorFeed`): given an actor, which notices?
 *   - backward (the push audience resolver): given a notice, which users?
 *
 * Do not reimplement these rules anywhere else. A second copy will drift, and the
 * failure mode is a leader being pushed about a notice the app then refuses to show
 * them — or worse, a leadersOnly incident alert reaching a church login.
 *
 * Pure: no I/O, no clock. `nowIso` is passed in.
 */
export function canSeeNotification(
  actor: Pick<Actor, 'role' | 'zone' | 'churchId'>,
  n: Notification,
  nowIso: string,
): boolean {
  // Scheduled notices are withheld from EVERY audience until their publish time passes.
  if (n.scheduledFor && n.scheduledFor > nowIso) return false;

  // Leaders-only notices (e.g. incident alerts) never reach church/firstAid, whatever
  // the scope — their bodies can describe a minor.
  if (n.leadersOnly && actor.role !== 'zoneLeader' && actor.role !== 'director' && actor.role !== 'admin') {
    return false;
  }

  if (n.scope === 'camp') return true;

  if (n.scope === 'zone') {
    if (actor.role === 'admin' || actor.role === 'director') return true;
    return actor.zone != null && n.zone === actor.zone;
  }

  if (n.scope === 'church') {
    if (actor.role === 'admin' || actor.role === 'director') return true;
    return actor.churchId != null && n.churchId === actor.churchId;
  }

  return false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/notification-visibility.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Refactor `getActorFeed` onto it**

In `src/services/notification.service.ts`, add to the imports:

```ts
import { canSeeNotification } from './notification-visibility';
```

Replace the whole body of `getActorFeed` with:

```ts
  async function getActorFeed(actor: Actor): Promise<Notification[]> {
    const active = await notifRepo.findActive();
    const now = nowISO();
    // Audience rules live in notification-visibility.ts so the push audience resolver
    // and this feed can never disagree. Do not inline them back here.
    return active.filter((n) => canSeeNotification(actor, n, now));
  }
```

- [ ] **Step 6: Prove the refactor changed nothing**

Run: `npm run test`
Expected: baseline pass count **+7** (the new file's tests), and **zero** previously-passing tests
now failing. If any existing notification test fails, the extraction was not faithful — revert and
redo it rather than editing the old test to match.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/notification-visibility.ts src/services/notification-visibility.test.ts src/services/notification.service.ts
git commit -m "refactor(notifications): extract canSeeNotification as the single audience rule

getActorFeed is a forward filter (actor -> notices); web push needs the inverse
(notice -> users). One predicate serves both so they cannot drift. Pure, no I/O.
No behaviour change: existing notification tests pass unchanged."
```

---

## Task 3: The tick route and its secret guard

**Files:**
- Create: `src/api/controllers/cron.controller.ts`
- Create: `src/api/controllers/cron.controller.test.ts`
- Modify: `src/api/http/router.ts`
- Modify: `src/config/env.ts` (comment only)

**Interfaces:**
- Consumes: `HttpRequest.headers` from Task 1.
- Produces: `makeCronController({ tick })` exposing `async tick(req: HttpRequest)`. The route is
  `GET /internal/cron/tick`, `auth: false`.

**Note on test depth, stated honestly:** this repo has **no** end-to-end HTTP tests — no supertest,
nothing calls `buildRoutes`/`createApp`. Controller tests call handlers directly with a hand-built
`HttpRequest`. So these tests prove the guard *logic*, not that Express really returns 401. The
`UnauthorizedError` → 401 mapping is exercised by every other route in production and is not
re-proven here. Do not claim otherwise in the commit message.

- [ ] **Step 1: Write the failing test**

Create `src/api/controllers/cron.controller.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCronController } from './cron.controller';
import { UnauthorizedError } from '../../core/errors/app-error';
import type { HttpRequest } from '../http/types';

function reqOf(headers?: Record<string, string | undefined>): HttpRequest {
  return { ctx: null, params: {}, query: {}, body: {}, headers };
}

describe('cron controller secret guard', () => {
  const OLD = process.env['CRON_SECRET'];

  beforeEach(() => { process.env['CRON_SECRET'] = 'super-secret-value'; });
  afterEach(() => {
    if (OLD === undefined) delete process.env['CRON_SECRET'];
    else process.env['CRON_SECRET'] = OLD;
  });

  it('runs the tick when the bearer secret matches', async () => {
    const tick = vi.fn().mockResolvedValue({ ok: true, created: 0, pushed: 0 });
    const ctrl = makeCronController({ tick: { run: tick } });
    const out = await ctrl.tick(reqOf({ authorization: 'Bearer super-secret-value' }));
    expect(tick).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ ok: true });
  });

  it('rejects a wrong secret without running the tick', async () => {
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({ authorization: 'Bearer wrong' }))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(tick).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({}))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(tick).not.toHaveBeenCalled();
  });

  it('rejects when headers are absent entirely', async () => {
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf(undefined))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a secret of a different length without throwing', async () => {
    // timingSafeEqual throws on length mismatch — the guard must handle that itself.
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({ authorization: 'Bearer short' }))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses to run when CRON_SECRET is unset, even with no header', async () => {
    delete process.env['CRON_SECRET'];
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({ authorization: 'Bearer ' }))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(tick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/api/controllers/cron.controller.test.ts`
Expected: FAIL — `Failed to resolve import "./cron.controller"`.

- [ ] **Step 3: Write the controller**

Create `src/api/controllers/cron.controller.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';
import type { HttpRequest } from '../http/types';
import { UnauthorizedError } from '../../core/errors/app-error';

/** Minimal shape the controller needs — keeps the controller testable without the container. */
export interface CronTickRunner {
  run(): Promise<unknown>;
}

export interface CronControllerServices {
  tick: CronTickRunner;
}

/**
 * Constant-time compare that tolerates length mismatch. `timingSafeEqual` THROWS when the
 * two buffers differ in length, so a naive call leaks length via a 500 instead of a 401.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function makeCronController(services: CronControllerServices) {
  return {
    /**
     * GET /internal/cron/tick — called by Supabase pg_cron via pg_net, NOT by the SPA.
     * Sits outside the app's auth layer (auth:false) and is guarded by a shared secret
     * instead. Throws UnauthorizedError so the adapter's sendError maps it to a 401;
     * returning an error object would come back as a 200.
     */
    async tick(req: HttpRequest) {
      const expected = process.env['CRON_SECRET'] ?? '';
      // An unset secret must fail closed. Otherwise a misconfigured deploy would let
      // anyone fire the tick with `Authorization: Bearer `.
      if (expected.length === 0) throw new UnauthorizedError();

      const header = req.headers?.['authorization'] ?? '';
      const prefix = 'Bearer ';
      if (!header.startsWith(prefix)) throw new UnauthorizedError();

      if (!secretMatches(header.slice(prefix.length), expected)) throw new UnauthorizedError();

      return services.tick.run();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/api/controllers/cron.controller.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the route**

In `src/api/http/router.ts`, add to the controller-construction block near the other
`make*Controller` calls:

```ts
  const cronCtrl = makeCronController({ tick: services.cron });
```

and add the import at the top alongside the other controller imports:

```ts
import { makeCronController } from '../controllers/cron.controller';
```

Then add a new group at the **end** of the returned routes array (after the last existing group):

```ts
    // ----- Internal (scheduler) -----
    // Called by Supabase pg_cron via pg_net. auth:false because the app's bearer-token
    // layer does not apply; guarded by CRON_SECRET inside the controller instead.
    { method: 'GET', path: '/internal/cron/tick', auth: false, handler: (r) => cronCtrl.tick(r) },
```

`services.cron` does not exist yet — it is wired in Task 6. **This step will not typecheck until
then.** That is expected and is why Task 6 exists; do not invent a stub service here.

- [ ] **Step 6: Document the env var**

In `src/config/env.ts`, extend the existing comment block that lists env vars read directly by other
modules (the one naming `SESSION_SECRET` and `FIELD_ENCRYPTION_KEY`):

```ts
// - CRON_SECRET — read directly in src/api/controllers/cron.controller.ts. Guards
//   GET /internal/cron/tick. Set in Vercel (Sensitive) AND stored in Supabase Vault as
//   'cron_secret' for the pg_cron job to send. Rotating means updating BOTH places.
```

Follow the existing convention: read it via `process.env` at the use site, like `SESSION_SECRET`,
rather than adding a field to the `env` object.

- [ ] **Step 7: Commit**

```bash
git add src/api/controllers/cron.controller.ts src/api/controllers/cron.controller.test.ts src/api/http/router.ts src/config/env.ts
git commit -m "feat(cron): add /internal/cron/tick with a constant-time secret guard

Fails closed when CRON_SECRET is unset. Length-mismatch is handled before
timingSafeEqual, which throws on unequal buffers. Tests are controller-level;
this repo has no end-to-end HTTP harness, so the 401 mapping itself is not
re-proven here.

Does not typecheck until the cron service is wired (next tasks)."
```

---

## Task 4: Migration `0013`

Additive and safe to apply **before** the code push.

**Files:**
- Create: `supabase/migrations/0013_push_subscriptions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0013_push_subscriptions.sql
-- Web Push phase 1-2. Additive only; safe to apply ahead of the code push.
-- Design: docs/superpowers/specs/2026-07-26-web-push-design.md

-- 1. Device registrations. Bound to a USER (an account holder), never to a Person —
--    no minor ever has a subscription row.
create table if not exists push_subscriptions (
  id                text primary key,
  user_id           text not null references users(id) on delete cascade,
  endpoint          text not null unique,
  p256dh_enc        text not null,
  auth_enc          text not null,
  consent_version   int  not null default 1,
  created_at        timestamptz not null default now(),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  failure_count     int  not null default 0
);

create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

-- RLS on, no policies — matches every other table (0002_rls.sql). The API connects as
-- postgres and bypasses RLS; an anon-key connection is denied all rows.
alter table push_subscriptions enable row level security;

-- 2. Delivery-once bookkeeping on notifications.
alter table notifications add column if not exists push_sent_at timestamptz;
alter table notifications add column if not exists dedupe_key   text;

-- Partial unique index: ordinary notices (dedupe_key null) are unaffected.
create unique index if not exists notifications_dedupe_key_idx
  on notifications(dedupe_key) where dedupe_key is not null;

-- 3. The scheduler (D1). Vercel Hobby cron is daily-only, so the database drives the
--    tick instead. Keeping the schedule here means it lives in git, not just in prod.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret is read from Vault at run time and is NEVER written into this migration.
-- One-time out-of-band setup, before this runs:
--   select vault.create_secret('<the-cron-secret>', 'cron_secret');
select cron.schedule('camp-push-tick', '*/5 * * * *', $$
  select net.http_get(
    url     := 'https://my-youth-camp.vercel.app/internal/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 25000
  );
$$);
```

- [ ] **Step 2: Commit (do not apply yet)**

```bash
git add supabase/migrations/0013_push_subscriptions.sql
git commit -m "feat(db): migration 0013 — push_subscriptions, notification claim columns, pg_cron tick"
```

Applying to prod is a deliberate owner action, covered in the Deployment Runbook at the end of this
plan. Do not run it as part of implementation.

---

## Task 5: `PushSubscription` entity and repositories

**Files:**
- Create: `src/core/entities/push-subscription.ts`
- Create: `src/repositories/supabase/supabase.push-subscriptions.ts`
- Create: `src/repositories/supabase/supabase.push-subscriptions.mapper.test.ts`
- Modify: `src/repositories/interfaces/entity-repositories.ts`
- Modify: `src/repositories/in-memory/in-memory.repositories.ts`
- Modify: `src/repositories/supabase/index.ts`
- Modify: `src/core/entities/notification.ts`
- Modify: `src/repositories/supabase/supabase.notifications.ts`

**Interfaces:**
- Produces: `PushSubscription` entity; `IPushSubscriptionRepository`;
  `InMemoryPushSubscriptionRepository`; `SupabasePushSubscriptionRepository`;
  `Notification.pushSentAt?` / `Notification.dedupeKey?`.

- [ ] **Step 1: Create the entity**

`src/core/entities/push-subscription.ts`:

```ts
import type { ID, ISODateString } from '../types/common';

/**
 * A single browser install's Web Push registration.
 *
 * Bound to `users.id` — the subscriber is always an ACCOUNT HOLDER (a leader, a church
 * login), never a camper. No minor ever has a row here.
 *
 * Multiple rows per user is expected: a church login such as `b-victory` is shared by
 * several leaders who each install it on their OWN phone. The unique key is `endpoint`,
 * not `userId`, so re-subscribing on the same device upserts rather than duplicating.
 */
export interface PushSubscription {
  id: ID;
  userId: ID;
  /** Opaque URL at the browser vendor's push service. Stored PLAINTEXT so it can carry a unique index. */
  endpoint: string;
  /** Client public key. Encrypted at rest. */
  p256dh: string;
  /** Client auth secret. Encrypted at rest. */
  auth: string;
  /** Bumped when the consent copy or trigger set changes materially, to force a re-prompt. */
  consentVersion: number;
  createdAt: ISODateString;
  lastSuccessAt?: ISODateString | null;
  lastFailureAt?: ISODateString | null;
  failureCount: number;
}
```

- [ ] **Step 2: Extend the `Notification` entity**

In `src/core/entities/notification.ts`, add before `createdAt`:

```ts
  /**
   * Set the instant this notice was claimed for push delivery. The claim is an atomic
   * conditional update (`where push_sent_at is null`), which is what makes the inline
   * incident send and the scheduled sweeper safe to race. Null = not yet pushed.
   */
  pushSentAt?: ISODateString | null;
  /**
   * Deterministic key for notices the scheduler CREATES (currently only the check-in
   * window warning: `checkin-warn:<sessionId>:<churchUserId>`). Unique where non-null,
   * so repeated ticks inside the lead window produce exactly one notice. Null for every
   * human-authored notice.
   */
  dedupeKey?: string | null;
```

- [ ] **Step 3: Add the repository interfaces**

In `src/repositories/interfaces/entity-repositories.ts`, extend `INotificationRepository`:

```ts
export interface INotificationRepository extends IRepository<Notification> {
  findByScope(scope: string): Promise<Notification[]>;
  findByZone(zone: string): Promise<Notification[]>;
  findByChurch(churchId: string): Promise<Notification[]>;
  findActive(): Promise<Notification[]>;
  /**
   * Atomically claim notices for push. Sets `push_sent_at = now()` for the given ids that
   * are still unclaimed and returns ONLY the ids actually claimed. Two concurrent callers
   * get disjoint sets, so nothing is ever pushed twice. Claim BEFORE sending: a crash
   * between claim and send loses a push, which is the correct trade here (the in-app feed
   * is the guaranteed channel; a duplicate safeguarding alert is worse than a missed one).
   */
  claimForPush(ids: string[]): Promise<string[]>;
}
```

and add the new interface near it:

```ts
export interface IPushSubscriptionRepository extends IRepository<PushSubscription> {
  findByUser(userId: string): Promise<PushSubscription[]>;
  findByEndpoint(endpoint: string): Promise<PushSubscription | null>;
  deleteByEndpoint(endpoint: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<number>;
}
```

Add `import type { PushSubscription } from '../../core/entities/push-subscription';` to the file's
type imports.

- [ ] **Step 4: Implement the in-memory repos**

In `src/repositories/in-memory/in-memory.repositories.ts`, add `claimForPush` to
`InMemoryNotificationRepository`:

```ts
  async claimForPush(ids: string[]): Promise<string[]> {
    const claimed: string[] = [];
    const now = new Date().toISOString();
    for (const id of ids) {
      const n = this.store.get(id);
      if (n && n.pushSentAt == null) {
        n.pushSentAt = now;
        claimed.push(id);
      }
    }
    return claimed;
  }
```

and add a new section at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------
export class InMemoryPushSubscriptionRepository
  extends InMemoryBaseRepository<PushSubscription>
  implements IPushSubscriptionRepository
{
  constructor(persistence?: IPersistenceAdapter<PushSubscription>) {
    super(persistence);
  }

  async findByUser(userId: string): Promise<PushSubscription[]> {
    return Array.from(this.store.values())
      .filter((s) => s.userId === userId)
      .map((s) => this.clone(s));
  }

  async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    const hit = Array.from(this.store.values()).find((s) => s.endpoint === endpoint);
    return hit ? this.clone(hit) : null;
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const hit = Array.from(this.store.values()).find((s) => s.endpoint === endpoint);
    if (!hit) return false;
    return this.delete(hit.id);
  }

  async deleteByUser(userId: string): Promise<number> {
    const hits = Array.from(this.store.values()).filter((s) => s.userId === userId);
    for (const h of hits) await this.delete(h.id);
    return hits.length;
  }
}
```

Add the entity + interface to the file's existing import lists.

- [ ] **Step 5: Write the failing mapper test**

Create `src/repositories/supabase/supabase.push-subscriptions.mapper.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toPushSub, pushSubColumns } from './supabase.push-subscriptions';
import type { PushSubscription } from '../../core/entities/push-subscription';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function sub(over: Partial<PushSubscription> = {}): PushSubscription {
  return {
    id: 'push_1',
    userId: 'usr_1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: 'BPublicKeyMaterialHere',
    auth: 'AuthSecretHere',
    consentVersion: 1,
    createdAt: '2026-09-29T01:00:00.000Z',
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    ...over,
  };
}

describe('push_subscriptions mapper encryption', () => {
  it('encrypts both key columns on write', () => {
    const cols = pushSubColumns(sub());
    expect(cols['p256dh_enc'] as string).toMatch(/^v1\./);
    expect(cols['auth_enc'] as string).toMatch(/^v1\./);
  });

  it('leaves the endpoint plaintext so it can carry a unique index', () => {
    const cols = pushSubColumns(sub());
    expect(cols['endpoint']).toBe('https://fcm.googleapis.com/fcm/send/abc123');
  });

  it('round-trips through toPushSub', () => {
    const cols = pushSubColumns(sub());
    const row = { ...cols, created_at: new Date('2026-09-29T01:00:00.000Z') };
    const back = toPushSub(row as Record<string, unknown>);
    expect(back.p256dh).toBe('BPublicKeyMaterialHere');
    expect(back.auth).toBe('AuthSecretHere');
    expect(back.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc123');
    expect(back.failureCount).toBe(0);
  });

  it('binds ciphertext to its own column via AAD', () => {
    // Swapping the two ciphertexts must fail to decrypt, proving the AAD is per-column.
    const cols = pushSubColumns(sub());
    const swapped = {
      ...cols,
      p256dh_enc: cols['auth_enc'],
      auth_enc: cols['p256dh_enc'],
      created_at: new Date('2026-09-29T01:00:00.000Z'),
    };
    const back = toPushSub(swapped as Record<string, unknown>);
    expect(back.p256dh).not.toBe('AuthSecretHere');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/repositories/supabase/supabase.push-subscriptions.mapper.test.ts`
Expected: FAIL — cannot resolve `./supabase.push-subscriptions`.

- [ ] **Step 7: Write the Supabase repo**

Create `src/repositories/supabase/supabase.push-subscriptions.ts`:

```ts
import type { SqlClient } from './client';
import type { PushSubscription } from '../../core/entities/push-subscription';
import type { IPushSubscriptionRepository } from '../interfaces/entity-repositories';
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';

export function toPushSub(r: Record<string, unknown>): PushSubscription {
  const id = r['id'] as string;
  return {
    id,
    userId: r['user_id'] as string,
    endpoint: r['endpoint'] as string,
    p256dh: maybeDecrypt(r['p256dh_enc'] as string, `push_subscriptions:p256dh:${id}`) ?? '',
    auth: maybeDecrypt(r['auth_enc'] as string, `push_subscriptions:auth:${id}`) ?? '',
    consentVersion: Number(r['consent_version'] ?? 1),
    createdAt: new Date(r['created_at'] as string | Date).toISOString(),
    lastSuccessAt: r['last_success_at'] ? new Date(r['last_success_at'] as string | Date).toISOString() : null,
    lastFailureAt: r['last_failure_at'] ? new Date(r['last_failure_at'] as string | Date).toISOString() : null,
    failureCount: Number(r['failure_count'] ?? 0),
  };
}

export function pushSubColumns(s: PushSubscription): Record<string, unknown> {
  return {
    id: s.id,
    user_id: s.userId,
    // Plaintext on purpose: AES-GCM is randomised and cannot carry the unique index this
    // column needs for upsert-on-resubscribe and pruning. See design §4.4.
    endpoint: s.endpoint,
    p256dh_enc: encryptField(s.p256dh, `push_subscriptions:p256dh:${s.id}`),
    auth_enc: encryptField(s.auth, `push_subscriptions:auth:${s.id}`),
    consent_version: s.consentVersion,
    created_at: s.createdAt,
    last_success_at: s.lastSuccessAt ?? null,
    last_failure_at: s.lastFailureAt ?? null,
    failure_count: s.failureCount,
  };
}

export class SupabasePushSubscriptionRepository implements IPushSubscriptionRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> { /* table created by migration 0013 */ }

  async findById(id: string): Promise<PushSubscription | null> {
    const rows = await this.sql`select * from push_subscriptions where id = ${id}`;
    return rows[0] ? toPushSub(rows[0]) : null;
  }

  async findAll(): Promise<PushSubscription[]> {
    const rows = await this.sql`select * from push_subscriptions order by created_at`;
    return rows.map((r) => toPushSub(r));
  }

  async findByUser(userId: string): Promise<PushSubscription[]> {
    const rows = await this.sql`select * from push_subscriptions where user_id = ${userId}`;
    return rows.map((r) => toPushSub(r));
  }

  async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    const rows = await this.sql`select * from push_subscriptions where endpoint = ${endpoint}`;
    return rows[0] ? toPushSub(rows[0]) : null;
  }

  async save(s: PushSubscription): Promise<PushSubscription> {
    // Conflict on ENDPOINT, not id: the same device re-subscribing must refresh its keys
    // in place rather than accumulate rows.
    await this.sql`
      insert into push_subscriptions ${this.sql(pushSubColumns(s))}
      on conflict (endpoint) do update set
        user_id = excluded.user_id,
        p256dh_enc = excluded.p256dh_enc,
        auth_enc = excluded.auth_enc,
        consent_version = excluded.consent_version,
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        failure_count = excluded.failure_count
    `;
    return s;
  }

  async saveMany(subs: PushSubscription[]): Promise<PushSubscription[]> {
    for (const s of subs) await this.save(s);
    return subs;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from push_subscriptions where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const rows = await this.sql`delete from push_subscriptions where endpoint = ${endpoint} returning id`;
    return rows.length > 0;
  }

  async deleteByUser(userId: string): Promise<number> {
    const rows = await this.sql`delete from push_subscriptions where user_id = ${userId} returning id`;
    return rows.length;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from push_subscriptions returning id`;
    return rows.length;
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/repositories/supabase/supabase.push-subscriptions.mapper.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Persist the two new notification columns**

In `src/repositories/supabase/supabase.notifications.ts`:

In `toNotif`, add before `createdAt`:

```ts
    pushSentAt: r['push_sent_at'] ? new Date(r['push_sent_at'] as string | Date).toISOString() : null,
    dedupeKey: (r['dedupe_key'] as string | null) ?? null,
```

In `notifColumns`, add:

```ts
    push_sent_at: n.pushSentAt ?? null,
    dedupe_key: n.dedupeKey ?? null,
```

**Critically**, widen the explicit `on conflict (id) do update set` list in `save()` — this repo has
been bitten twice by a column missing from an update list (`PERSON_UPDATE_COLS`, and the
`scheduled_for` widening). Add these two lines to it:

```sql
  push_sent_at = excluded.push_sent_at,
  dedupe_key = excluded.dedupe_key
```

Add `claimForPush` to the class:

```ts
  async claimForPush(ids: string[]): Promise<string[]> {
    // postgres.js `in ${sql(arr)}` THROWS on an empty array — guard first.
    if (ids.length === 0) return [];
    const rows = await this.sql`
      update notifications set push_sent_at = now()
       where id in ${this.sql(ids)} and push_sent_at is null
      returning id
    `;
    return rows.map((r) => r['id'] as string);
  }
```

- [ ] **Step 10: Export from the barrel**

`src/repositories/supabase/index.ts` uses explicit named exports, not `export *`. Add:

```ts
export { SupabasePushSubscriptionRepository } from './supabase.push-subscriptions';
```

The `interfaces/` and `in-memory/` barrels are `export *` and need no change.

- [ ] **Step 11: Verify and commit**

Run: `npm run typecheck` — expect failures only about `services.cron` (Task 3's route), nothing else.
Run: `npm run test` — expect baseline +7 (Task 2) +6 (Task 3) +4 = **baseline +17**.

```bash
git add src/core/entities/push-subscription.ts src/core/entities/notification.ts src/repositories/
git commit -m "feat(db): PushSubscription entity + repo trio; notification push claim columns

Keys encrypted at rest with per-column AAD; endpoint plaintext so it can carry the
unique index that makes re-subscribe an upsert. claimForPush is the atomic
delivery-once guarantee and guards the empty-array case postgres.js throws on."
```

---

## Task 6: `churchesBehind` — pure detection logic

The heart of trigger 3. Pure, no I/O, no clock reads.

**Files:**
- Create: `src/services/checkin-warnings.ts`
- Create: `src/services/checkin-warnings.test.ts`

**Interfaces:**
- Consumes: `allowedWindowSession`, `buildSessions` from `./checkin-sessions`; `zonedNow` from
  `../utils/date`; `canAccessPerson` from `./person.service`; `toActor` from `./auth.service`.
- Produces: `churchesBehind(settings, people, users, now): ChurchBehind[]` where
  `ChurchBehind = { userId, churchId, sessionId, sessionLabel, remaining, windowEnd }`.

**Three correctness traps this task must handle** (all found by reading the code, all silent if got
wrong):

1. **`checkedIn` is last-entry-wins, not "any entry".** `toRosterEntry` (`person.dto.ts:229`)
   computes `checkedIn: last?.type === 'in'` from the last `checkInHistory` entry for that session.
   Using `.some(e => e.type === 'in')` would count a checked-in-then-out student as done, disagreeing
   with the roster the leader is looking at.
2. **AC-1 makes the first camp day PM-only and the last day AM-only.** There is no AM session on
   day 1 and no PM session on the final day. Never invent one.
3. **Timezone.** All date/time reasoning goes through `zonedNow(tz, now)`. Using UTC would, between
   00:00 and 10:00 Brisbane, resolve *yesterday* — silently killing the AM reminder every day of camp.

- [ ] **Step 1: Write the failing test**

Create `src/services/checkin-warnings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { churchesBehind } from './checkin-warnings';
import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';

const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];

function settings(over: Partial<CampSettings> = {}): CampSettings {
  return {
    id: 'settings',
    campName: 'Camp',
    year: 2026,
    startDate: '2026-09-28',
    endDate: '2026-09-30',
    timezone: 'Australia/Brisbane',
    checkInDays: DAYS,
    accommodationLocked: false,
    churchLoginLocked: false,
    zoneLeaderLoginLocked: false,
    churchCheckinTimeRestricted: true,
    checkinSwitchoverTime: '12:00',
    checkinPhaseOverride: 'auto',
    checkinWindowAmStart: '06:00',
    checkinWindowAmEnd: '12:00',
    checkinWindowPmStart: '12:00',
    checkinWindowPmEnd: '22:00',
    campMode: 'at-camp',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as CampSettings;
}

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    firstName: 'A',
    lastName: 'B',
    kind: 'youth',
    gender: 'male',
    churchId: 'ch_victory',
    churchName: 'Victory',
    zone: 'Blue',
    lifecycle: 'arrived',
    atCamp: true,
    checkInHistory: [],
    signOutHistory: [],
    medicalConditions: [],
    ...over,
  } as unknown as Person;
}

function user(over: Partial<User> = {}): User {
  return {
    id: 'usr_bv',
    firstName: 'Victory',
    lastName: 'Boys',
    username: 'b-victory',
    role: 'church',
    churchId: 'ch_victory',
    churchName: 'Victory',
    zone: 'Blue',
    genderScope: 'male',
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as User;
}

/** 2026-09-29 11:05 Brisbane == 01:05 UTC the same day. 55 min before amEnd 12:00. */
const IN_AM_LEAD = new Date('2026-09-29T01:05:00.000Z');

describe('churchesBehind', () => {
  it('reports a church login with an unchecked student inside the AM lead window', () => {
    const out = churchesBehind(settings(), [person()], [user()], IN_AM_LEAD);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      userId: 'usr_bv',
      churchId: 'ch_victory',
      sessionId: '2026-09-29~am',
      remaining: 1,
      windowEnd: '12:00',
    });
  });

  it('returns nothing when every student is already checked in', () => {
    const p = person({
      checkInHistory: [
        { id: 'c1', sessionId: '2026-09-29~am', sessionLabel: 'Tue AM', type: 'in', leaderId: 'X', timestamp: '2026-09-29T00:00:00.000Z' },
      ],
    } as Partial<Person>);
    expect(churchesBehind(settings(), [p], [user()], IN_AM_LEAD)).toEqual([]);
  });

  it('counts a checked-in-then-out student as OUTSTANDING (last entry wins)', () => {
    // Must agree with toRosterEntry, which uses `last?.type === 'in'`.
    const p = person({
      checkInHistory: [
        { id: 'c1', sessionId: '2026-09-29~am', sessionLabel: 'Tue AM', type: 'in', leaderId: 'X', timestamp: '2026-09-29T00:00:00.000Z' },
        { id: 'c2', sessionId: '2026-09-29~am', sessionLabel: 'Tue AM', type: 'out', leaderId: 'X', timestamp: '2026-09-29T00:30:00.000Z' },
      ],
    } as Partial<Person>);
    const out = churchesBehind(settings(), [p], [user()], IN_AM_LEAD);
    expect(out[0]?.remaining).toBe(1);
  });

  it('excludes leaders and anyone not atCamp from the count', () => {
    const people = [
      person({ id: 'p1' }),
      person({ id: 'p2', kind: 'leader' }),
      person({ id: 'p3', atCamp: false }),
    ];
    const out = churchesBehind(settings(), people, [user()], IN_AM_LEAD);
    expect(out[0]?.remaining).toBe(1);
  });

  it('respects gender scoping — a b- login is not told about girls', () => {
    const people = [person({ id: 'p1', gender: 'male' }), person({ id: 'p2', gender: 'female' })];
    const out = churchesBehind(settings(), people, [user()], IN_AM_LEAD);
    expect(out[0]?.remaining).toBe(1);
  });

  it('counts a gender-unset student for BOTH of a church logins', () => {
    const people = [person({ id: 'p1', gender: 'other' })];
    const b = user({ id: 'usr_bv', username: 'b-victory', genderScope: 'male' });
    const g = user({ id: 'usr_gv', username: 'g-victory', genderScope: 'female' });
    const out = churchesBehind(settings(), people, [b, g], IN_AM_LEAD);
    expect(out).toHaveLength(2);
  });

  it('returns nothing when churchCheckinTimeRestricted is off', () => {
    const s = settings({ churchCheckinTimeRestricted: false });
    expect(churchesBehind(s, [person()], [user()], IN_AM_LEAD)).toEqual([]);
  });

  it('returns nothing outside the 60-minute lead window', () => {
    // 09:00 Brisbane = 23:00 UTC the previous day — 3h before amEnd.
    const early = new Date('2026-09-28T23:00:00.000Z');
    expect(churchesBehind(settings(), [person()], [user()], early)).toEqual([]);
  });

  it('TIMEZONE GUARD: resolves the Brisbane date, not the UTC date', () => {
    // 2026-09-29 09:00 Brisbane is 2026-09-28 23:00 UTC. A UTC-derived "today" would look
    // up the 28th. Pin the clock just inside the AM lead window on the 29th, at a UTC
    // instant that still reads as the 28th, and assert we get the 29th's session.
    const s = settings({ checkinWindowAmEnd: '10:00' }); // lead window 09:00-10:00 Brisbane
    const at0905Bne = new Date('2026-09-28T23:05:00.000Z');
    const out = churchesBehind(s, [person()], [user()], at0905Bne);
    expect(out[0]?.sessionId).toBe('2026-09-29~am');
  });

  it('AC-1: never warns for an AM session on the FIRST camp day (PM-only)', () => {
    // 2026-09-28 is day 1 -> PM only. 11:05 Brisbane on the 28th is inside an AM lead
    // window that has no AM session behind it.
    const at1105OnDay1 = new Date('2026-09-28T01:05:00.000Z');
    expect(churchesBehind(settings(), [person()], [user()], at1105OnDay1)).toEqual([]);
  });

  it('AC-1: never warns for a PM session on the LAST camp day (AM-only)', () => {
    // 2026-09-30 is the last day -> AM only. 21:05 Brisbane = 11:05 UTC, inside the PM lead.
    const at2105OnLastDay = new Date('2026-09-30T11:05:00.000Z');
    expect(churchesBehind(settings(), [person()], [user()], at2105OnLastDay)).toEqual([]);
  });

  it('warns in the PM lead window on an interior day', () => {
    // 2026-09-29 21:05 Brisbane = 11:05 UTC. pmEnd 22:00.
    const out = churchesBehind(settings(), [person()], [user()], new Date('2026-09-29T11:05:00.000Z'));
    expect(out[0]).toMatchObject({ sessionId: '2026-09-29~pm', windowEnd: '22:00' });
  });

  it('ignores non-church logins entirely', () => {
    const zl = user({ id: 'usr_zl', role: 'zoneLeader', genderScope: null });
    expect(churchesBehind(settings(), [person()], [zl], IN_AM_LEAD)).toEqual([]);
  });

  it('ignores inactive church logins', () => {
    const inactive = user({ status: 'inactive' });
    expect(churchesBehind(settings(), [person()], [inactive], IN_AM_LEAD)).toEqual([]);
  });

  it('returns nothing on a day outside checkInDays', () => {
    const out = churchesBehind(settings(), [person()], [user()], new Date('2026-10-05T01:05:00.000Z'));
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/checkin-warnings.test.ts`
Expected: FAIL — cannot resolve `./checkin-warnings`.

- [ ] **Step 3: Write the implementation**

Create `src/services/checkin-warnings.ts`:

```ts
import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';
import { allowedWindowSession } from './checkin-sessions';
import { canAccessPerson } from './person.service';
import { toActor } from './auth.service';
import { zonedNow } from '../utils/date';

/** Mirrors checkin.service.ts — must stay byte-identical or reminder and enforcement disagree. */
const DEFAULT_TZ = 'Australia/Brisbane';
/** How long before a window closes to warn. Design D4. */
export const WARN_LEAD_MINUTES = 60;

export interface ChurchBehind {
  userId: string;
  churchId: string;
  sessionId: string;
  sessionLabel: string;
  remaining: number;
  /** 'HH:MM' — the closing time, for the notice copy. */
  windowEnd: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Checked-in for a session, matching `toRosterEntry` in src/api/dto/person.dto.ts EXACTLY:
 * the LAST entry for that session wins. A student checked in and then out is NOT checked in.
 * Diverging from this makes the push count disagree with the roster the leader is reading.
 */
function isCheckedIn(p: Person, sessionId: string): boolean {
  const entries = p.checkInHistory.filter((e) => e.sessionId === sessionId);
  const last = entries[entries.length - 1];
  return last?.type === 'in';
}

/**
 * Which church LOGINS still have students unchecked for a session whose window closes within
 * WARN_LEAD_MINUTES?
 *
 * Per LOGIN, not per church: church accounts are gender-scoped (`b-`/`g-`), so `b-victory`
 * must only ever be told about students it can actually see and act on.
 *
 * Pure — no repositories, no `new Date()`. `now` is injected so the timezone boundary is
 * testable, which matters: this codebase has been bitten by UTC-vs-Brisbane twice.
 */
export function churchesBehind(
  settings: CampSettings,
  people: Person[],
  users: User[],
  now: Date,
): ChurchBehind[] {
  // D4 condition 1: with the restriction off, the window times exist but are not a real
  // deadline, so "closing soon" would be misleading.
  if (!settings.churchCheckinTimeRestricted) return [];

  const tz = settings.timezone || DEFAULT_TZ;
  const days = settings.checkInDays ?? [];
  const { date, time } = zonedNow(tz, now);

  // Resolve windows IDENTICALLY to checkin.service.assertSessionAllowed.
  const windows = {
    amStart: settings.checkinWindowAmStart ?? '06:00',
    amEnd: settings.checkinWindowAmEnd ?? '12:00',
    pmStart: settings.checkinWindowPmStart ?? '12:00',
    pmEnd: settings.checkinWindowPmEnd ?? '22:00',
  };

  // The one session currently open. Returns null off a camp day, outside both windows, or —
  // via buildSessions/AC-1 — when the day simply has no session of that half (first camp day
  // is PM-only, last day is AM-only). That null is what stops us inventing a phantom session.
  const session = allowedWindowSession(days, date, time, windows);
  if (!session) return [];

  const windowEnd = session.id.endsWith('~am') ? windows.amEnd : windows.pmEnd;
  const minutesLeft = toMinutes(windowEnd) - toMinutes(time);
  if (minutesLeft <= 0 || minutesLeft > WARN_LEAD_MINUTES) return [];

  // Same roster population as checkin.service.getSessionStatus: present, non-leader.
  const roster = people.filter((p) => p.atCamp && p.kind !== 'leader');

  const out: ChurchBehind[] = [];
  for (const u of users) {
    if (u.role !== 'church') continue;
    if (u.status !== 'active') continue;
    if (!u.churchId) continue;

    const actor = toActor(u);
    const remaining = roster.filter(
      (p) => canAccessPerson(actor, p) && !isCheckedIn(p, session.id),
    ).length;

    // D4 condition 4: never send "0 students still to check in".
    if (remaining === 0) continue;

    out.push({
      userId: u.id,
      churchId: u.churchId,
      sessionId: session.id,
      sessionLabel: session.label,
      remaining,
      windowEnd,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/checkin-warnings.test.ts`
Expected: PASS, 15 tests.

If the timezone-guard test fails, the bug is real — do not adjust the test to match the code.

- [ ] **Step 5: Commit**

```bash
git add src/services/checkin-warnings.ts src/services/checkin-warnings.test.ts
git commit -m "feat(checkin): pure churchesBehind() detection for the window-closing warning

Per church LOGIN (gender-scoped), not per church. Matches toRosterEntry's
last-entry-wins checked-in predicate so counts agree with the roster UI, and
resolves windows identically to assertSessionAllowed so reminder and enforcement
cannot disagree. Clock injected; tests pin the Brisbane/UTC boundary and both
AC-1 single-session days."
```

---

## Task 7: The tick service, container wiring, and the in-app notice

Turns detection into a real `Notification` row. **No push is sent in this phase.**

**Files:**
- Create: `src/services/cron.service.ts`
- Modify: `src/container.ts`

**Interfaces:**
- Consumes: `churchesBehind` (Task 6), `IPushSubscriptionRepository` (Task 5),
  `INotificationRepository.claimForPush` (Task 5).
- Produces: `makeCronService(deps)` with `run(): Promise<TickResult>` where
  `TickResult = { ok: true; checkinWarningsCreated: number }`. Satisfies Task 3's `CronTickRunner`.

- [ ] **Step 1: Write the service**

Create `src/services/cron.service.ts`:

```ts
import type {
  INotificationRepository,
  IPersonRepository,
  IUserRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import { churchesBehind } from './checkin-warnings';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';

export interface TickResult {
  ok: true;
  checkinWarningsCreated: number;
}

export interface CronServiceDeps {
  notifications: INotificationRepository;
  people: IPersonRepository;
  users: IUserRepository;
  settings: ISettingsRepository;
}

export function makeCronService(deps: CronServiceDeps) {
  return {
    /**
     * One scheduled tick. Called by Supabase pg_cron via pg_net every 5 minutes.
     *
     * Phase 1-3 scope: job B only (create check-in-closing notices). Jobs C and D
     * (claim + web-push fan-out) arrive with the push phases; `claimForPush` already
     * exists so they can be added without touching this shape.
     *
     * Must be CHEAP when there is nothing to do — it runs 288 times a day. churchesBehind
     * short-circuits off a camp day / outside the lead window before any real work.
     */
    async run(): Promise<TickResult> {
      const settings = await deps.settings.getSingleton();
      if (!settings) return { ok: true, checkinWarningsCreated: 0 };

      if (!settings.timezone) {
        // zonedNow silently falls back to the HOST's zone, which on Vercel is UTC — that
        // would resolve yesterday's camp day for 10 hours of every day. Warn loudly.
        console.warn('[cron] settings.timezone is empty; check-in warnings may target the wrong day');
      }

      const [people, users] = await Promise.all([deps.people.findAll(), deps.users.findAll()]);
      const behind = churchesBehind(settings, people, users, new Date());
      if (behind.length === 0) return { ok: true, checkinWarningsCreated: 0 };

      let created = 0;
      for (const b of behind) {
        // Deterministic key -> repeated ticks inside the 60-minute lead window produce
        // exactly ONE notice per church login per session. Keyed on the LOGIN id because
        // b-/g- accounts are two audiences with two different counts.
        const dedupeKey = `checkin-warn:${b.sessionId}:${b.userId}`;
        const notif: Notification = {
          id: newId('notif'),
          scope: 'church',
          zone: null,
          churchId: b.churchId,
          priority: 'urgent',
          title: 'Check-in closing soon',
          body: `${b.remaining} student${b.remaining === 1 ? '' : 's'} still to check in — the ${b.sessionLabel} window closes at ${b.windowEnd}.`,
          // System-raised, like incident.service.log: written straight to the repo because
          // no cron actor holds notification:send:camp.
          senderId: 'system',
          senderName: 'Camp system',
          senderRole: 'admin',
          leadersOnly: false,
          audienceEstimate: b.remaining,
          expiresAt: null,
          scheduledFor: null,
          pushSentAt: null,
          dedupeKey,
          createdAt: nowISO(),
        };
        try {
          await deps.notifications.save(notif);
          created += 1;
        } catch (err) {
          // The partial unique index on dedupe_key rejects the duplicate — that IS the
          // dedupe working, not a failure. Swallow and continue.
          const msg = err instanceof Error ? err.message : String(err);
          if (!/dedupe_key/i.test(msg)) throw err;
        }
      }

      return { ok: true, checkinWarningsCreated: created };
    },
  };
}

export type CronService = ReturnType<typeof makeCronService>;
```

- [ ] **Step 2: Wire the container**

In `src/container.ts`:

Add imports alongside the existing ones:

```ts
import { InMemoryPushSubscriptionRepository } from './repositories/in-memory';
import { SupabasePushSubscriptionRepository } from './repositories/supabase';
import type { IPushSubscriptionRepository } from './repositories/interfaces';
import type { PushSubscription } from './core/entities/push-subscription';
import { makeCronService, type CronService } from './services/cron.service';
```

Add to the `Repositories` interface: `pushSubscriptions: IPushSubscriptionRepository;`
Add to the `Services` interface: `cron: CronService;`

**Supabase branch** — after the `notifications` line:

```ts
  const pushSubscriptions: IPushSubscriptionRepository = new SupabasePushSubscriptionRepository(sql);
```

**Memory/JSON branch** — after the `notifications` line:

```ts
  const pushSubscriptions: IPushSubscriptionRepository = new InMemoryPushSubscriptionRepository(
    useJson ? makeJsonPersistence<PushSubscription>('push-subscriptions.json') : undefined,
  );
```

In **both** branches add `pushSubscriptions,` to the `repos` object literal, add
`pushSubscriptions.init(),` to the `Promise.all([...])` init list, add

```ts
  const cron = makeCronService({ notifications, people, users, settings: settingsRepo });
```

next to the other service constructions, and add `cron,` to the `services` object literal.

- [ ] **Step 3: Verify the whole thing compiles and passes**

Run: `npm run typecheck`
Expected: **clean**. Task 3's `services.cron` reference now resolves; this is the first point in the
plan where the tree typechecks end to end.

Run: `npm run test`
Expected: **baseline + 32** (7 + 6 + 4 + 15). Zero previously-passing tests failing.

- [ ] **Step 4: Commit**

```bash
git add src/services/cron.service.ts src/container.ts
git commit -m "feat(cron): tick service creates in-app check-in-closing notices

Phase 3: real value with zero push infrastructure and zero new personal data.
Notice is written straight to the repo (no cron actor holds notification:send:camp),
deduped by a deterministic key so repeated ticks inside the lead window create one
notice per church login per session."
```

---

## Deployment Runbook (owner action — NOT part of implementation)

Run in this order. Steps 1–3 are one-time.

1. **Generate the secret** and set it in Vercel as `CRON_SECRET`, marked **Sensitive**, for
   Production and Preview.
2. **Store the same value in Supabase Vault** (SQL editor, project `nwfafrgojqkxylbppywo`):
   `select vault.create_secret('<the-same-value>', 'cron_secret');`
   Skipping this makes every tick 401 **silently** — `pg_net` is fire-and-forget and surfaces
   nothing.
3. **Push the code to `master`** (auto-deploys), then **apply migration `0013`**, then reconcile the
   version row — the MCP `apply_migration` tool records a generated timestamp, not `0013`:
   ```sql
   update supabase_migrations.schema_migrations
      set version = '0013'
    where version = '<generated timestamp>';
   ```
4. **Verify the tick actually fires** — this is the gate the rest of the feature depends on:
   ```sql
   select jobid, status, return_message, start_time
     from cron.job_run_details
    order by start_time desc limit 5;
   select status_code, created from net._http_response order by created desc limit 5;
   ```
   Expect `status_code = 200`. A `401` means the Vault secret is missing or mismatched. Cross-check
   the Vercel function log for the route being hit.
5. **Kill switch**, if anything misbehaves: `select cron.unschedule('camp-push-tick');` — instant,
   no deploy needed.

**Gate:** do not start phases 4–7 (VAPID, service worker, sender) until step 4 shows a 200.

---

---

# Part B — Bundled changes shipping in the same update

Three items the owner folded into this update on 2026-07-26. Independent of Part A and of each
other, but they share one service-worker bump (Task 11), so **Task 11 must be last**.

**B7 is NOT here — it is already done.** `dashboard-cache.ts:24` already carries `genderScope` in
`_actorKey` (commit `463a519`, regression test `dashboard.service.test.ts:281`). The
launch-readiness doc is stale on it. No work required.

**Deferred by owner decision:** S3 (error tracking / Sentry) and S4 (uptime monitor on `/health`) —
a future change.

## Task 8: S2 — persist the check-in queue

Today `CHECKIN_QUEUE` is a plain in-memory array (`public/index.html:2130`). A reload, tab
eviction, or iOS reclaiming a backgrounded PWA silently discards every queued tap **and** the
banner that would have reported it. Attendance is the compliance record.

**Files:**
- Modify: `public/index.html` (~2130–2175, the queue block; plus one call in `_tryRestoreSession`)

**Scope boundaries — read before writing code:**

- **Preserve the drop-on-4xx behaviour.** When `navigator.onLine` is true and the POST fails, the
  entry is dropped and `_checkinFailed++`. That is a deliberate owner decision documented at line
  2135 ("owner chose banner only"). This task fixes *reload and offline* loss only. Do not
  "improve" it.
- **Owner decision (2026-07-26): stale entries are DROPPED on rehydrate**, not attempted. An entry
  whose `sessionId` is not the session now selected is discarded. The drop is **surfaced** with a
  one-time toast so it can be reconciled against the paper sign-in sheet — dropping silently is
  what S2 exists to prevent.
- **Attribution must be captured at queue time.** Line 2150 currently sends
  `initials: LEADER_INITIALS`, read at *drain* time. In memory that is harmless because the queue
  drains in seconds. Persisted across a reload or a re-login it stamps the attendance row with
  whoever is logged in *now*. Store `initials` on the entry.

- [ ] **Step 1: Add the storage helpers**

In `public/index.html`, replace line 2130 (`const CHECKIN_QUEUE=[];let _draining=false,_onlineHandlerAdded=false;`)
with:

```js
const CHECKIN_QUEUE=[];let _draining=false,_onlineHandlerAdded=false;
// S2 (2026-07-26): the queue is persisted per account so a reload, tab eviction, or iOS
// reclaiming a backgrounded PWA no longer discards queued attendance taps. Key mirrors
// _initialsKey()'s convention. Entries carry the initials captured AT QUEUE TIME — draining
// under LEADER_INITIALS would misattribute a rehydrated entry to whoever is logged in now.
function _ciqKey(){return 'ycp_ciq_'+((ACTOR&&(ACTOR.username||ACTOR.id))||'');}
function _persistQueue(){
  try{
    if(CHECKIN_QUEUE.length)localStorage.setItem(_ciqKey(),JSON.stringify(CHECKIN_QUEUE));
    else localStorage.removeItem(_ciqKey());
  }catch(_){/* quota/private mode — in-memory queue still works */}
}
// Rehydrate on boot. Entries for any session other than the one now selected are DROPPED
// (owner decision) — their window has closed and the POST would 403. The drop is reported
// so it can be reconciled against the paper sheet rather than vanishing.
function _restoreQueue(){
  let saved=[];
  try{saved=JSON.parse(localStorage.getItem(_ciqKey())||'[]');}catch(_){saved=[];}
  if(!Array.isArray(saved)||!saved.length)return;
  const fresh=saved.filter(e=>e&&e.camperId&&e.sessionId===SEL_SESSION);
  const dropped=saved.length-fresh.length;
  CHECKIN_QUEUE.push(...fresh);
  _persistQueue();
  if(dropped>0)toast(dropped+' queued check-in'+(dropped===1?'':'s')+' from an earlier session were discarded — check the paper sheet');
  if(CHECKIN_QUEUE.length&&!_draining)drainQueue();
}
```

- [ ] **Step 2: Capture initials at queue time and persist**

Replace `_queueEntry` (line ~2139):

```js
function _queueEntry(camperId,type){
  // initials captured NOW, not at drain time — a rehydrated entry must keep its original author.
  CHECKIN_QUEUE.push({camperId,type,sessionId:SEL_SESSION,initials:LEADER_INITIALS});
  _persistQueue();
  _updateSyncDots(camperId,'pending');
  if(!_draining)drainQueue();
  if(!_onlineHandlerAdded){window.addEventListener('online',drainQueue);_onlineHandlerAdded=true;}
}
```

- [ ] **Step 3: Drain using the stored initials, persisting after every shift**

Replace `drainQueue` (line ~2145):

```js
async function drainQueue(){
  if(_draining)return;_draining=true;
  while(CHECKIN_QUEUE.length>0){
    const entry=CHECKIN_QUEUE[0];
    try{
      // entry.initials falls back for any entry queued before this change shipped.
      await api('/checkin',{method:'POST',body:{camperId:entry.camperId,sessionId:entry.sessionId,type:entry.type,initials:entry.initials||LEADER_INITIALS}});
      CHECKIN_QUEUE.shift();_persistQueue();_markSynced(entry.camperId);
    }catch(e){
      if(!navigator.onLine)break; // wait for online event; queue stays persisted
      // Deliberate: an ONLINE failure is a hard drop + banner (owner chose banner only).
      CHECKIN_QUEUE.shift();_persistQueue();_markSynced(entry.camperId,'error');_checkinFailed++;
    }
  }
  _draining=false;
  await _rCheckin();
}
```

- [ ] **Step 4: Rehydrate once the session is known**

`_restoreQueue()` depends on `SEL_SESSION`, which is null until the check-in screen has loaded its
sessions. Call it at the **end of `_renderDailyCheckin`**, immediately after `SEL_SESSION` is
assigned and before the first render returns, guarded so it only runs once per session selection:

```js
  if(!window._ciqRestored){window._ciqRestored=true;_restoreQueue();}
```

Do **not** call it from `_tryRestoreSession` — `SEL_SESSION` is null there and every entry would be
dropped as stale.

- [ ] **Step 5: Clear the queue on logout**

In `logout()` (line ~1182), before `location.reload()`, add:

```js
  try{localStorage.removeItem(_ciqKey());}catch(_){}
```

Place it **before** `TOKEN=null;ACTOR=null;` — `_ciqKey()` reads `ACTOR`, so clearing after would
compute the wrong key and orphan the entry.

- [ ] **Step 6: Verify**

Run: `node --check <(sed -n '/<script>/,/<\/script>/p' public/index.html | sed '1d;$d')`

If that pipe is awkward on Windows, extract the script block to a temp file and run `node --check`
on it. The repo's convention is that `public/index.html` must pass a syntax check after every edit.

Run: `npm run typecheck` and `npm run test`
Expected: unchanged from Part A's final count — this task touches no TypeScript.

**This change cannot be proven by the test suite.** It needs a real-device pass: queue a check-in
in airplane mode, force-quit the PWA, reopen, confirm the tap survives and drains. Add it to the
S9 device-test list.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "fix(checkin): persist the check-in queue across reloads (S2)

An in-memory queue lost every queued tap on reload, tab eviction, or iOS
reclaiming a backgrounded PWA - silent loss of the compliance record.
Queue is now persisted per account and rehydrated when the check-in screen
knows its session. Entries carry the initials captured at queue time so a
rehydrated entry is not misattributed to whoever logged in since.

Stale entries (a different session) are dropped per owner decision, with a
toast so they can be reconciled against the paper sheet. The deliberate
drop-on-online-error + banner behaviour is unchanged."
```

---

## Task 9: Discount-code overrides — backend

Implements the approved design in `docs/PLANNED-IMPROVEMENTS.md:10-65`. Confirmed unbuilt: zero
references to `applyDiscountOverrides`, `discountCodeOverrides`, or `discount_code_overrides`
anywhere in `src/`, `public/`, or `supabase/`.

**Problem being solved:** registrants whose ticket shows `registrationCost: 0` because a discount
code represented a manual EFTPOS/cash payment are bucketed as "Sponsored $0", so the grand total
undercounts money actually collected.

**Files:**
- Create: `supabase/migrations/0015_discount_code_overrides.sql`
  *(was `0014` — that number was taken on 2026-07-26 when `0013` was split into `0013` schema +
  `0014_push_cron_schedule.sql`, so the scheduler could be held back until the tick route exists.)*
- Modify: `src/core/entities/settings.ts`
- Modify: `src/repositories/supabase/supabase.settings.ts`
- Modify: `src/services/budget.ts`
- Modify: `src/services/budget.test.ts`
- Modify: `src/services/access-control.ts`
- Modify: `src/services/settings.service.ts`
- Modify: `src/api/controllers/settings.controller.ts`, `src/api/http/router.ts`

**Interfaces:**
- Produces: `applyDiscountOverrides(people, overrides): BudgetPerson[]`;
  `CampSettings.discountCodeOverrides: Record<string, number>`;
  `SettingsService.updateDiscountCodeOverrides(actor, overrides)`; capability `budget:manage`.

**Note:** `computeBudget` already computes and returns `fullAmount` (`budget.ts:63,145-149`) — "the
highest distinct positive cost". The UI's one-click pre-fill reuses it; nothing new to compute.

- [ ] **Step 1: Migration**

Create `supabase/migrations/0015_discount_code_overrides.sql`:

```sql
-- 0015_discount_code_overrides.sql
-- Per-discount-code "paid in full" override amounts. Design: docs/PLANNED-IMPROVEMENTS.md.
-- Mirrors the existing last_temp_passwords JSONB pattern on settings; no new table.
alter table settings add column if not exists discount_code_overrides jsonb not null default '{}'::jsonb;
```

Numbered `0015` because `0013` (push schema) and `0014` (the deferred cron schedule) are taken by
Part A. `0013` is **already applied to prod** as of 2026-07-26; `0014` is deliberately unapplied.

- [ ] **Step 2: Write the failing tests**

Add to `src/services/budget.test.ts`:

```ts
describe('applyDiscountOverrides', () => {
  it('fills a null cost for a person whose code has an override', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: null, discountCode: 'EFTPOS' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(180);
  });

  it('fills a zero cost the same way', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: 'EFTPOS' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(180);
  });

  it('NEVER overwrites a genuinely recorded nonzero cost', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 90, discountCode: 'EFTPOS' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(90);
  });

  it('leaves people whose code has no override untouched', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: 'SPONSOR' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(0);
  });

  it('leaves people with no discount code untouched', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: null })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(0);
  });

  it('matches the code after trimming, consistent with computeDiscountCodeSummary', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: '  EFTPOS  ' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(180);
  });

  it('does not mutate its input', () => {
    const people = [p({ id: '1', registrationCost: 0, discountCode: 'EFTPOS' })];
    applyDiscountOverrides(people, { EFTPOS: 180 });
    expect(people[0]?.registrationCost).toBe(0);
  });

  it('feeds computeBudget so the overridden amount reaches the grand total', () => {
    const people = [
      p({ id: '1', registrationCost: 180, discountCode: null }),
      p({ id: '2', registrationCost: 0, discountCode: 'EFTPOS' }),
    ];
    const before = computeBudget(people);
    const after = computeBudget(applyDiscountOverrides(people, { EFTPOS: 180 }));
    expect(before.grandTotal).toBe(180);
    expect(after.grandTotal).toBe(360);
  });

  it('re-buckets the overridden person into the normal Full category', () => {
    const people = [
      p({ id: '1', registrationCost: 180, discountCode: null }),
      p({ id: '2', registrationCost: 0, discountCode: 'EFTPOS' }),
    ];
    const after = computeBudget(applyDiscountOverrides(people, { EFTPOS: 180 }));
    const labels = after.churches.flatMap((c) => c.campers.map((r) => r.label));
    expect(labels.some((l) => l.startsWith('Full'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Sponsored'))).toBe(false);
  });

  it('is a no-op for an empty override map', () => {
    const people = [p({ id: '1', registrationCost: 0, discountCode: 'EFTPOS' })];
    expect(computeBudget(applyDiscountOverrides(people, {})).grandTotal).toBe(
      computeBudget(people).grandTotal,
    );
  });
});
```

Add `applyDiscountOverrides` to the file's existing import from `./budget`.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/services/budget.test.ts`
Expected: FAIL — `applyDiscountOverrides is not a function`.

- [ ] **Step 4: Implement it**

Add to `src/services/budget.ts`, directly above `computeBudget`:

```ts
/**
 * Apply per-discount-code "paid in full" overrides before budgeting.
 *
 * Some registrants carry `registrationCost: 0` because a discount code was used to record a
 * manual EFTPOS/cash payment taken at registration — the money WAS collected, but the ticket
 * reads $0, so the budget buckets them as "Sponsored" and undercounts the total.
 *
 * Only a null/0 cost is filled. A genuinely recorded nonzero cost is never overwritten — an
 * override is a statement about missing data, not a repricing.
 *
 * Pure; returns a new array and does not mutate its input. Output flows through computeBudget
 * unchanged, so category bucketing, per-church totals, the grand total and the CSV export all
 * pick it up for free.
 */
export function applyDiscountOverrides(
  people: BudgetPerson[],
  overrides: Record<string, number>,
): BudgetPerson[] {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return people.slice();
  return people.map((p) => {
    const code = (p.discountCode ?? '').trim();
    if (!code) return p;
    const amount = overrides[code];
    if (amount == null) return p;
    // Only fill missing/zero — never reprice a recorded cost.
    if (p.registrationCost != null && p.registrationCost !== 0) return p;
    return { ...p, registrationCost: amount };
  });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/services/budget.test.ts`
Expected: PASS, +10 tests.

- [ ] **Step 6: Add the capability**

In `src/services/access-control.ts`, add to the `Action` union (near `'export:compliance'`, line ~30):

```ts
  | 'budget:manage'
```

Grant it to **admin** and **director** only — the two roles that already see Budget & Costings. Add
`'budget:manage',` to both role arrays (director's list at ~line 78, admin's at ~line 98). Do **not**
grant it to any other role, and do **not** widen `admin:manage`.

- [ ] **Step 7: Settings entity, mapper, and service method**

`src/core/entities/settings.ts` — add to `CampSettings`:

```ts
  /**
   * Per-discount-code override amounts, code -> dollars. A registrant using that code whose
   * registrationCost is null/0 is budgeted at this amount instead. Empty object = no overrides.
   */
  discountCodeOverrides: Record<string, number>;
```

`src/repositories/supabase/supabase.settings.ts` — map both directions:

```ts
// row -> entity
discountCodeOverrides: (r['discount_code_overrides'] as Record<string, number>) ?? {},
// entity -> row
discount_code_overrides: s.discountCodeOverrides ?? {},
```

**`supabase.settings` writes ALL settings columns on every save** (documented standing rule), so no
on-conflict list needs widening here — but confirm the new key is in the columns object or the
value will be dropped on every save.

`src/services/settings.service.ts` — a dedicated method, NOT a widening of `update`:

```ts
    /**
     * Discount-code overrides are editable by director as well as admin, so they get their own
     * narrowly-scoped capability rather than widening general settings editing (which is
     * admin:manage and must stay that way).
     */
    async updateDiscountCodeOverrides(actor: Actor, overrides: Record<string, number>) {
      assertCan(actor, 'budget:manage');
      const clean: Record<string, number> = {};
      for (const [code, amount] of Object.entries(overrides ?? {})) {
        const key = code.trim();
        const n = Number(amount);
        // Clearing the field removes the override; reject anything not a positive finite number.
        if (!key || !Number.isFinite(n) || n <= 0) continue;
        clean[key] = Math.round(n * 100) / 100;
      }
      const current = await settingsRepo.getSingleton();
      if (!current) throw new NotFoundError('Settings not found');
      return settingsRepo.save({ ...current, discountCodeOverrides: clean, updatedAt: nowISO() });
    },
```

Add it to the `SettingsService` interface, then wire a route in `src/api/http/router.ts`:

```ts
    { method: 'PATCH', path: '/settings/discount-overrides', auth: true, handler: (r) => settingsCtrl.updateDiscountOverrides(r) },
```

and the matching controller method in `src/api/controllers/settings.controller.ts`:

```ts
    async updateDiscountOverrides(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { overrides?: Record<string, number> };
      return services.settings.updateDiscountCodeOverrides(req.ctx.actor, body?.overrides ?? {});
    },
```

- [ ] **Step 8: Add the permission-gate test**

Add to `src/services/settings.service.test.ts` (or create it following the house pattern if absent):

```ts
it('lets director update discount overrides but not general settings', async () => {
  const dir = actor('director');
  await expect(svc.updateDiscountCodeOverrides(dir, { EFTPOS: 180 })).resolves.toBeTruthy();
  await expect(svc.update(dir, { campName: 'X' })).rejects.toThrow();
});

it('refuses discount overrides for church and zoneLeader', async () => {
  for (const role of ['church', 'zoneLeader'] as const) {
    await expect(svc.updateDiscountCodeOverrides(actor(role), { EFTPOS: 180 })).rejects.toThrow();
  }
});

it('drops zero, negative and blank-code entries', async () => {
  const saved = await svc.updateDiscountCodeOverrides(actor('admin'), {
    EFTPOS: 180, ZERO: 0, NEG: -5, '   ': 90,
  } as Record<string, number>);
  expect(saved.discountCodeOverrides).toEqual({ EFTPOS: 180 });
});
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck` — clean.
Run: `npm run test` — Part A final count **+13**.

```bash
git add supabase/migrations/0015_discount_code_overrides.sql src/services/budget.ts src/services/budget.test.ts src/services/access-control.ts src/services/settings.service.ts src/core/entities/settings.ts src/repositories/supabase/supabase.settings.ts src/api/
git commit -m "feat(budget): per-discount-code paid-in-full overrides (backend)

Registrants whose ticket reads \$0 because a discount code recorded a manual
EFTPOS/cash payment were bucketed as Sponsored, undercounting the grand total.
applyDiscountOverrides fills only null/0 costs, never repricing a recorded one,
and flows through computeBudget so bucketing, totals and CSV pick it up free.

New narrowly-scoped budget:manage capability (admin + director) rather than
widening admin:manage. Implements the approved design in PLANNED-IMPROVEMENTS.md."
```

---

## Task 10: Discount-code overrides — SPA

**Files:**
- Modify: `public/index.html` (`computeDiscountSummaryClient`, `drawBudget` / the "Discount codes" card)

- [ ] **Step 1: Port the pure function**

Add beside `computeDiscountSummaryClient`:

```js
// Mirror of applyDiscountOverrides in src/services/budget.ts. Keep the two in step —
// the SPA computes the budget client-side and would otherwise disagree with the server.
function _applyDiscountOverrides(people,overrides){
  const keys=Object.keys(overrides||{});
  if(!keys.length)return people.slice();
  return people.map(p=>{
    const code=(p.discountCode||'').trim();
    if(!code)return p;
    const amt=overrides[code];
    if(amt==null)return p;
    if(p.registrationCost!=null&&p.registrationCost!==0)return p;
    return Object.assign({},p,{registrationCost:amt});
  });
}
```

Call it on the people array **before** `computeBudgetClient(...)` in `drawBudget`, passing
`SETTINGS.discountCodeOverrides||{}`.

- [ ] **Step 2: Add the inline field to each discount row**

In the "Discount codes" card row builder, append an amount input plus a one-click pre-fill button,
shown only for admin/director:

```js
const _canBudget=ACTOR&&(ACTOR.role==='admin'||ACTOR.role==='director');
// ...inside the row template, after the existing code + purpose pill:
_canBudget?`<div class="dc-ovr">
  <input type="number" inputmode="decimal" min="0" step="0.01" placeholder="—"
         value="${(SETTINGS.discountCodeOverrides||{})[r.code]??''}"
         onchange="_saveDiscountOverride('${r.code.replace(/'/g,"\\'")}',this.value)">
  ${fullAmount!=null?`<button class="btn ghost sm" onclick="_prefillDiscountOverride('${r.code.replace(/'/g,"\\'")}',${fullAmount})">Mark paid in full</button>`:''}
</div>`:''
```

- [ ] **Step 3: Add the handlers**

```js
// Clearing the field removes the override (the code reverts to normal behaviour).
async function _saveDiscountOverride(code,value){
  const o=Object.assign({},SETTINGS.discountCodeOverrides||{});
  const n=parseFloat(value);
  if(!value||!isFinite(n)||n<=0)delete o[code];else o[code]=n;
  try{
    const s=await api('/settings/discount-overrides',{method:'PATCH',body:{overrides:o}});
    SETTINGS.discountCodeOverrides=s.discountCodeOverrides||{};
    _invalidate('/settings');
    toast('Saved');
    RENDER.budget();
  }catch(e){toast(e.message||'Could not save');}
}
function _prefillDiscountOverride(code,amount){_saveDiscountOverride(code,String(amount));}
```

- [ ] **Step 4: Verify and commit**

Syntax-check the script block (`node --check`), then:

```bash
git add public/index.html
git commit -m "feat(budget): inline discount-code override field on the Budget screen"
```

---

## Task 12: S5 — fail fast on a missing field-encryption key

Today a missing or malformed `FIELD_ENCRYPTION_KEY` **boots green** and then 500s on every person
read with a generic message — indistinguishable from "the app is broken", and undiagnosable from a
campsite. `assertSessionSecret()` already establishes the pattern one line above.

**Files:**
- Modify: `src/utils/field-crypto.ts` (add the assertion)
- Modify: `src/app.ts:15`
- Modify: `src/utils/field-crypto.test.ts` (or create, following house style)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { assertFieldEncryptionKey } from './field-crypto';

const OLD = process.env['FIELD_ENCRYPTION_KEY'];
afterEach(() => {
  if (OLD === undefined) delete process.env['FIELD_ENCRYPTION_KEY'];
  else process.env['FIELD_ENCRYPTION_KEY'] = OLD;
});

describe('assertFieldEncryptionKey', () => {
  it('throws when the key is absent', () => {
    delete process.env['FIELD_ENCRYPTION_KEY'];
    expect(() => assertFieldEncryptionKey()).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('throws when the key is not 32 bytes of base64', () => {
    process.env['FIELD_ENCRYPTION_KEY'] = 'too-short';
    expect(() => assertFieldEncryptionKey()).toThrow(/32/);
  });

  it('passes for a valid 32-byte base64 key', () => {
    process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertFieldEncryptionKey()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/field-crypto.test.ts`
Expected: FAIL — `assertFieldEncryptionKey is not exported`.

- [ ] **Step 3: Implement**

Add to `src/utils/field-crypto.ts`:

```ts
/**
 * Boot assertion, mirroring assertSessionSecret(). A missing or malformed key otherwise
 * boots green and then 500s on EVERY person read — the encrypted columns are unreadable —
 * which looks identical to a total outage and cannot be diagnosed from a camp site.
 * Called from createAppInstance() only when PERSISTENCE === 'supabase'; in-memory runs
 * never touch encrypted columns.
 */
export function assertFieldEncryptionKey(): void {
  const raw = process.env['FIELD_ENCRYPTION_KEY'];
  if (!raw) {
    throw new Error(
      '[SECURITY] Refusing to start: FIELD_ENCRYPTION_KEY is not set. Every encrypted ' +
      'field (medical, dietary, medications, medicare, blue card, parent contacts, consents, ' +
      'notes, incidents) would be unreadable. Set it and redeploy.',
    );
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('[SECURITY] Refusing to start: FIELD_ENCRYPTION_KEY is not valid base64.');
  }
  if (bytes.length !== 32) {
    throw new Error(
      `[SECURITY] Refusing to start: FIELD_ENCRYPTION_KEY must decode to 32 bytes (got ${bytes.length}).`,
    );
  }
}
```

- [ ] **Step 4: Wire it into boot**

`src/app.ts`, immediately after `assertSessionSecret();`:

```ts
  // S5: a missing/malformed key boots green then 500s every person read. Fail loudly instead.
  // Supabase only — in-memory/JSON runs never read encrypted columns.
  if (env.PERSISTENCE === 'supabase') assertFieldEncryptionKey();
```

plus the import: `import { assertFieldEncryptionKey } from './utils/field-crypto';`

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck` and `npm run test` — expect +3.

```bash
git add src/utils/field-crypto.ts src/utils/field-crypto.test.ts src/app.ts
git commit -m "feat(boot): refuse to start without a valid FIELD_ENCRYPTION_KEY (S5)

Missing/malformed key previously booted green and 500'd every person read,
indistinguishable from a total outage. Supabase-only; mirrors assertSessionSecret."
```

---

## Task 13: S6 — send `?churchId` from the SPA (RISKIEST — do it last, review closely)

The backend half **already exists and predates the launch-readiness doc**:
`person.service.ts:138-153` (`scopedAll`) branches on `opts.churchId` → `repo.findByChurch`, and
both `listRegistrants` (:170) and `listCampers` (:189) use it. The SPA never sends the param, so
every church leader's every screen does `select * from people` plus both history tables plus ~10 AES
decrypts per person. This is the fast path already built and unused.

**Why this is the riskiest task in the batch, stated plainly:** it touches ~31 call sites in a
5,300-line file with **no automated test coverage**, and it interacts with the client cache. Its
benefit is performance, not correctness. If anything in this task looks uncertain during execution,
stop and report rather than guessing — it is the one item here that is safe to drop from the update.

**The cache trap — read before writing code:**

- `Cache.del`'s matcher is `sk===k || sk.startsWith(k+'/') || sk.startsWith(k+'?')`, so
  `_invalidate` already clears `/registrants?churchId=…`. **Invalidation is safe.**
- But `Cache.get` is an **exact** key lookup, and `_allCached('/registrants')` and `_prefetch`
  use bare literal paths. If `api()` fetches `/registrants?churchId=x` while `_allCached` checks
  `/registrants`, the prefetch and stale-while-revalidate paths silently stop hitting — the app
  still works, just slower, with no error. **Every site must use the same string.**

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add one helper, used everywhere**

Beside `_isChurchAccount()` (line ~885):

```js
// S6: church logins fetch only their own church's people. The backend fast path
// (person.service scopedAll -> findByChurch) already exists; this is the SPA half.
// MUST be used for BOTH the api() call and any _allCached()/_prefetch() key for the
// same resource — Cache.get is an exact-key lookup, so a mismatch silently disables
// the prefetch/stale-while-revalidate hit (no error, just slower).
function _scoped(path){
  if(!_isChurchAccount()||!ACTOR.churchId)return path;
  return path+(path.includes('?')?'&':'?')+'churchId='+encodeURIComponent(ACTOR.churchId);
}
```

- [ ] **Step 2: Apply it**

Replace every `api('/registrants…')` and `api('/campers…')` with `api(_scoped('/registrants…'))`,
and every corresponding `_allCached('/registrants')` / `Cache.get('/registrants')` /
`_prefetch` entry with `_scoped('/registrants')`.

Find them all: `grep -n "'/registrants\|'/campers" public/index.html`

**Do not** scope `/campers/:id` or any other single-record path — the param is a list filter only.
**Do not** scope calls made while `ACCOUNT_PREVIEW` is active without checking `ACTOR` is the
previewed actor (it is — `ACTOR` is swapped during preview, so `_scoped` is correct there).

- [ ] **Step 3: Verify**

Syntax-check `public/index.html`.

Then confirm by inspection that no `/registrants` or `/campers` string remains unscoped except
single-record paths:

```bash
grep -n "'/registrants\|'/campers" public/index.html | grep -v "_scoped"
```

Expected: only `/campers/'+id` style single-record reads.

**Cannot be proven by the suite.** Needs a device/browser pass as a church login: confirm My Group,
the check-in roster and the Data tab all still populate, and that a sign-in still updates the list
immediately (that last one proves invalidation still matches).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "perf(spa): send ?churchId on list reads for church logins (S6)

The backend fast path (scopedAll -> findByChurch) already existed and was unused.
One _scoped() helper is applied to both the api() call and the matching cache key,
because Cache.get is an exact-key lookup and a mismatch would silently disable the
prefetch hit."
```

---

## Task 11: Service-worker bump and documentation (MUST BE LAST)

Tasks 8 and 10 both change `public/index.html`. The SPA is cached by the service worker, so
**`CACHE` must be bumped exactly once, after both land** — bumping twice mid-sequence just forces an
extra reload on every installed device.

**Files:**
- Modify: `public/sw.js` (line 1)
- Modify: `CLAUDE.md`, `debug.md`, `docs/PLANNED-IMPROVEMENTS.md`

- [ ] **Step 1: Bump the cache**

`public/sw.js` line 1: `const CACHE = 'camp-v45';` → `const CACHE = 'camp-v46';`

Do **not** add `push` to `API_RE` yet — that belongs with the service-worker push handlers in the
later phase. Nothing in Parts A or B calls a `/push` endpoint from the SPA.

**Note for the later push phase:** it will need `camp-v46` → `camp-v47`, not `v45` → `v46`.

- [ ] **Step 2: Update the docs**

- `docs/PLANNED-IMPROVEMENTS.md`: change the discount section's **Status** line from "design
  approved, not yet planned/implemented" to delivered, with the date and this plan's path. Move it
  under the "Delivered" heading if that matches the file's convention.
- `CLAUDE.md`: add a batch section for this update — the tick route + migration `0013`/`0014`, S2,
  and the discount overrides — following the existing dated-section style, and note `sw.js`
  `camp-v45`→`camp-v46`.
- `debug.md`: add the new symbols to the map — `_ciqKey`/`_persistQueue`/`_restoreQueue`
  ("queued check-in lost on reload" → these), `_saveDiscountOverride`/`_applyDiscountOverrides`
  ("budget total ignores an override" → these), and `churchesBehind`/`makeCronService`.

- [ ] **Step 3: Final verification**

Run: `npm run typecheck` — clean.
Run: `npm run test` — Part A + 13.
Syntax-check `public/index.html`.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js CLAUDE.md debug.md docs/PLANNED-IMPROVEMENTS.md
git commit -m "chore: bump sw to camp-v46 and document the 2026-07-26 batch"
```

---

## Self-Review

**Spec coverage.** §4.1 scheduler → Tasks 3, 4. §4.4/§4.5 tables → Tasks 4, 5. §4.6 version
reconciliation → runbook step 3. §4.9 `canSeeNotification` → Task 2; `isPushSuppressed` is deferred
to the push phase and noted below. §5 claim → Task 5 (`claimForPush`) and §5 `dedupe_key` → Task 7.
§6 timezone → Task 6, with the required 09:00-Brisbane test. §3 conditions 1–5 → Task 6.
§10 phases 1–3 → all tasks. Deliberately **not** covered, because they belong to phases 4–7:
§4.3 VAPID, §4.7 service worker, §4.8 SPA card, §9.1 payload templates, §9.3 retention hooks, and
`isPushSuppressed` (it only has meaning once something is being sent).

**Known gaps, stated rather than hidden.** (a) Task 3's tests are controller-level; this repo has no
end-to-end HTTP harness, so a real 401 over the wire is not proven by the suite. (b) The
`dedupe_key` collision path in Task 7 is caught by matching the error message, which is
driver-dependent; it is exercised in prod by the second tick inside a lead window, not by a unit
test. (c) `SupabasePushSubscriptionRepository` has no integration test — the mapper is tested, the
SQL is not, matching how every other Supabase repo in this codebase is covered.

**Type consistency.** `churchesBehind` returns `ChurchBehind` with `sessionLabel`, consumed by
`cron.service` for the notice body. `CronTickRunner.run()` (Task 3) matches
`makeCronService(...).run()` (Task 7). `claimForPush(ids: string[]): Promise<string[]>` is declared
in Task 5's interface and implemented in both repos there; nothing in phases 1–3 calls it, which is
intentional — it ships now so the push phase adds no repo surface.
