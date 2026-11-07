import { ResponseCache } from '../utils/response-cache';
import type { Actor } from '../core/entities/user';
import type { DashboardResult } from './dashboard.service';

/**
 * The dashboard response cache (D3). One per container, built in `buildServices` and injected
 * into `makeDashboardService` only. Writer services don't know it exists: the container wraps the
 * repos the DTO reads (`invalidateOnWrite`), so a write through them flushes it.
 */
export interface DashboardCache {
  get(actor: Actor): DashboardResult | null;
  set(actor: Actor, value: DashboardResult): void;
  invalidate(): void;
}

/**
 * The key MUST carry every dimension the dashboard DTO is scoped by, or two actors with
 * different visibility share a cached response.
 *
 * `genderScope` was missing until 2026-07-26: it arrived with the `b-`/`g-` gender-scoped church
 * logins (Feature 2, migration `0006`) and `canAccessPerson` narrows every dashboard figure by it,
 * but this key was never updated. `b-victory` and `g-victory` are both `role:church` with the same
 * `churchId` and `zone`, so they collided — whichever fetched first seeded the other's numbers for
 * the 30s TTL. Counts only (no names/PII crossed), but it's still one gender's roster reported to
 * the other custodian. Any future scoping dimension must be added here too.
 *
 * `actor.id` was added 2026-11-07 (A-8): the body also carries per-account data (`greetingName`,
 * and `latestNotification` when it is targeted at one account), so accounts sharing role + church
 * + zone + genderScope (directors, admins, firstAid) must not share a slot either.
 */
function actorKey(actor: Actor): string {
  return `${actor.id}:${actor.role}:${actor.churchId ?? '_'}:${actor.zone ?? '_'}:${actor.genderScope ?? '_'}`;
}

export function makeDashboardCache(): DashboardCache {
  const cache = new ResponseCache<DashboardResult>(30_000);
  return {
    get: (actor) => cache.get(actorKey(actor)),
    set: (actor, value) => cache.set(actorKey(actor), value),
    invalidate: () => cache.invalidateAll(),
  };
}

/**
 * Wrap a repository so the named write methods call `invalidate()` after they run (also on
 * failure: a flush is always safe). Reads and every other method pass straight through.
 *
 * ⚠ Never list `IPersonRepository.transition` (IMPACT-SUMMARY conflict (c)): it carries the only
 * BURSTY writes — check-in and sign-in/out taps, ~100 devices at once in a check-in window — and
 * a flush per tap drops the hit rate to ~0 exactly while every device loads `/home`. The cost of
 * not flushing is bounded by the 30 s TTL. Cancel/uncancel also use `transition`, but their PATCH
 * ends in a plain `save`, which flushes.
 */
export function invalidateOnWrite<T extends object>(repo: T, methods: readonly (keyof T & string)[], invalidate: () => void): T {
  const writes = new Set<string>(methods);
  return new Proxy(repo, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof prop !== 'string' || !writes.has(prop)) return fn.bind(target);
      return async (...args: unknown[]) => {
        try {
          return await fn.apply(target, args);
        } finally {
          invalidate();
        }
      };
    },
  });
}
