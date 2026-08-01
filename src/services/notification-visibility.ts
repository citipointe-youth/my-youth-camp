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
 *
 * Belt-and-braces on expiry: every real caller reads from the repository's `findActive()`,
 * which already filters `expires_at is null or expires_at > now()` before this function ever
 * runs — so the check below is normally redundant in practice. It stays here anyway because
 * this function claims to be the SINGLE SOURCE OF TRUTH for audience, and a claim like that
 * has to hold for a caller that passes `findAll()` results too, not just the two that
 * currently happen to pre-filter. Without it, an unfiltered caller would push an EXPIRED
 * notice to phones. A null `expiresAt` means "never expires" and is unaffected.
 */
export function canSeeNotification(
  actor: Pick<Actor, 'id' | 'role' | 'zone' | 'churchId'>,
  n: Notification,
  nowIso: string,
): boolean {
  // An expired notice is visible to nobody — not even admin/director, who are otherwise
  // exempt from scope checks below. Expiry is a lifecycle boundary, not an audience rule.
  if (n.expiresAt && n.expiresAt <= nowIso) return false;

  // Scheduled notices are withheld from EVERY audience until their publish time passes.
  if (n.scheduledFor && n.scheduledFor > nowIso) return false;

  // A TARGETED notice goes to exactly one login and nobody else — deliberately including
  // admin and director, who are otherwise exempt from every scope check below.
  //
  // This exists because the scheduler's check-in warnings are counted PER LOGIN, not per
  // church: church accounts are gender-scoped (`b-`/`g-`), so `b-victory` and `g-victory`
  // hold two different counts for the same session. Without this clause both notices match
  // on `churchId` alone and each login sees BOTH — two contradictory numbers, with no way to
  // tell which one is theirs. Oversight roles are NOT exempted on purpose: an admin has no
  // use for 40 per-church operational warnings a day, and letting them through buries every
  // real notice under them (Home renders only the newest three).
  if (n.targetUserId != null && n.targetUserId !== actor.id) return false;

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

/**
 * When a notice actually became (or becomes) visible to its audience.
 *
 * For an ordinary notice that is `createdAt`. For a SCHEDULED notice it is `scheduledFor` —
 * which is the whole point: a notice composed on Monday for delivery on Thursday has a
 * Monday `createdAt`, so ordering a feed by `createdAt` drops it BELOW everything sent
 * Tuesday and Wednesday. It then publishes already buried, and because Home renders only
 * `feed.slice(0,3)` it can publish without appearing on Home at all.
 */
export function publishedAt(n: Notification): string {
  return n.scheduledFor ?? n.createdAt;
}

/** Newest-published first. The one ordering every notification feed must use. */
export function byPublishedDesc(a: Notification, b: Notification): number {
  return publishedAt(b).localeCompare(publishedAt(a));
}
