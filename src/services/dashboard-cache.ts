import { ResponseCache } from '../utils/response-cache';
import type { Actor } from '../core/entities/user';
import type { DashboardResult } from './dashboard.service';

// Kept in its own module (not inside dashboard.service.ts) so writer services
// (person.service, import services, admin.service, etc.) can invalidate it
// without creating a circular import with dashboard.service.ts, which itself
// imports from person.service.ts (canAccessPerson). `DashboardResult` is a
// type-only import, so it's erased and doesn't introduce a runtime cycle.
const _cache = new ResponseCache<DashboardResult>(30_000);

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
 */
function _actorKey(actor: Actor): string {
  return `${actor.role}:${actor.churchId ?? '_'}:${actor.zone ?? '_'}:${actor.genderScope ?? '_'}`;
}

export function getCachedDashboard(actor: Actor): DashboardResult | null {
  return _cache.get(_actorKey(actor));
}

export function setCachedDashboard(actor: Actor, value: DashboardResult): void {
  _cache.set(_actorKey(actor), value);
}

/** Invalidate on every write that can change a dashboard DTO field (people,
 * churches, notifications, settings/mode). When in doubt, call this —
 * correctness over hit rate; the TTL is short (30s) so hit rate is a minor win. */
export function invalidateDashboardCache(): void {
  _cache.invalidateAll();
}
