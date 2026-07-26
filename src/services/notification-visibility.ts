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
