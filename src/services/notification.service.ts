import type { INotificationRepository } from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import type { Actor } from '../core/entities/user';
import { assertCanSendNotification } from './access-control';
import { CreateNotificationSchema, UpdateNotificationSchema } from '../core/validation/notification.schema';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { ForbiddenError, NotFoundError } from '../core/errors/app-error';
import { invalidateDashboardCache } from './dashboard-cache';
import { canSeeNotification, byPublishedDesc } from './notification-visibility';

export interface NotificationService {
  send(actor: Actor, input: unknown): Promise<Notification>;
  feed(actor: Actor): Promise<Notification[]>;
  latest(actor: Actor): Promise<Notification | null>;
  scheduled(actor: Actor): Promise<Notification[]>;
  update(actor: Actor, id: string, input: unknown): Promise<Notification>;
  remove(actor: Actor, id: string): Promise<{ ok: true }>;
  clearAll(actor: Actor): Promise<{ deleted: number }>;
}

/**
 * ⚠ `estimateAudience` was DELETED here on 2026-07-30, along with the `personRepo` and
 * `churchRepo` constructor params it was the only user of.
 *
 * It ran a full people scan on every send and every audience-changing edit — on Supabase
 * that is the whole `people` table plus ~10 AES field decrypts per person (~700 people at
 * camp) — purely to populate `Notification.audienceEstimate`. **Nothing read that field.**
 * It is exposed by no DTO and referenced zero times in `public/index.html`; the only other
 * writer, `incident.service`, had already been writing a hard-coded `0` to it.
 *
 * The FIELD and its `audience_estimate` column are deliberately kept, not dropped:
 * `cron.service` writes a genuinely meaningful number into it (the count of students still
 * to check in), so it is live data for scheduler-raised notices. Leaving the column also
 * avoids a migration and matches the precedent set by `discount_code_overrides` — retained,
 * unused, so a rollback stays possible.
 *
 * If a real "who will see this?" figure is ever wanted on the compose screen, compute it
 * from `resolvePushAudience`/`canSeeNotification` over the USERS table (tens of rows), not
 * by scanning and decrypting every person.
 */
/**
 * How long a human-authored notice stays visible (2026-07-31, owner request).
 *
 * A camp notice is almost always about the next few hours — "dinner has moved to 6", "bring a
 * jacket to the oval". Before this they lived forever, so the Notices screen silted up with
 * instructions that had already happened and leaders stopped reading it, which makes the one
 * notice that matters less likely to be seen.
 */
export const NOTICE_TTL_HOURS = 6;

/**
 * Expiry measured from PUBLISH, not composition. A notice written on Monday to publish on
 * Thursday must live for six hours after it appears, not expire two days before anyone can
 * see it — the same `scheduledFor ?? createdAt` rule the feeds already order by.
 *
 * An explicitly supplied `expiresAt` wins, so a caller can still shorten or lengthen a
 * particular notice; only the DEFAULT changed. System notices (the check-in warning and the
 * incident alert) set their own `expiresAt` and never come through here.
 */
export function defaultNoticeExpiry(
  publishAt: string,
  explicit?: string | null | undefined,
): string {
  if (explicit) return explicit;
  return new Date(new Date(publishAt).getTime() + NOTICE_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export function makeNotificationService(
  notifRepo: INotificationRepository,
): NotificationService {
  async function getActorFeed(actor: Actor): Promise<Notification[]> {
    const active = await notifRepo.findActive();
    const now = nowISO();
    // Audience rules live in notification-visibility.ts so the push audience resolver
    // and this feed can never disagree. Do not inline them back here.
    //
    // The re-sort is load-bearing, not cosmetic: the repo orders by `created_at`, which for a
    // SCHEDULED notice is when it was composed, not when it publishes. See `publishedAt`.
    return active.filter((n) => canSeeNotification(actor, n, now)).sort(byPublishedDesc);
  }

  return {
    async send(actor, input) {
      const data = CreateNotificationSchema.parse(input);
      assertCanSendNotification(actor, data.scope, data.zone);
      const createdAt = nowISO();
      const notif: Notification = {
        id: newId('notif'),
        scope: data.scope,
        zone: data.zone ?? null,
        churchId: data.churchId ?? null,
        priority: data.priority ?? 'normal',
        title: data.title,
        body: data.body,
        senderId: actor.id,
        senderName: actor.displayName,
        senderRole: actor.role,
        leadersOnly: false,
        // Not computed — see the estimateAudience note above. Nothing reads this for a
        // human-authored notice; only cron-raised warnings carry a meaningful number.
        audienceEstimate: 0,
        // Six hours from when it PUBLISHES (see defaultNoticeExpiry). `findActive()` already
        // filters on expiresAt, so this alone drops the notice off Home and Notices together.
        expiresAt: defaultNoticeExpiry(data.scheduledFor ?? createdAt, data.expiresAt),
        scheduledFor: data.scheduledFor ?? null,
        createdAt,
      };
      const saved = await notifRepo.save(notif);
      invalidateDashboardCache(); // affects AtCampDashboard.latestNotification
      return saved;
    },

    async feed(actor) {
      return getActorFeed(actor);
    },

    async latest(actor) {
      const feed = await getActorFeed(actor);
      return feed[0] ?? null;
    },

    // Pending scheduled notices (publish time still in the future). The creator sees their
    // own; director/admin see everyone's. Sorted soonest-first for the management list.
    async scheduled(actor) {
      const now = nowISO();
      const all = await notifRepo.findAll();
      const isOversight = actor.role === 'director' || actor.role === 'admin';
      return all
        .filter((n) => n.scheduledFor != null && n.scheduledFor > now)
        .filter((n) => isOversight || n.senderId === actor.id)
        .sort((a, b) => (a.scheduledFor as string).localeCompare(b.scheduledFor as string));
    },

    // Edit a notice (typically a still-pending scheduled one). Creator or director/admin only.
    async update(actor, id, input) {
      const data = UpdateNotificationSchema.parse(input);
      const existing = await notifRepo.findById(id);
      if (!existing) throw new NotFoundError('Notification not found');
      const isOversight = actor.role === 'director' || actor.role === 'admin';
      if (!isOversight && existing.senderId !== actor.id) {
        throw new ForbiddenError('You can only edit notices you created');
      }
      const scope = data.scope ?? existing.scope;
      const zone = data.zone !== undefined ? data.zone : existing.zone;
      // Re-authorise if the audience (scope/zone) changed.
      if (data.scope !== undefined || data.zone !== undefined) {
        assertCanSendNotification(actor, scope, zone);
      }
      const churchId = data.churchId !== undefined ? data.churchId : existing.churchId;
      const updated: Notification = {
        ...existing,
        scope,
        zone: zone ?? null,
        churchId: churchId ?? null,
        priority: data.priority ?? existing.priority,
        title: data.title ?? existing.title,
        body: data.body ?? existing.body,
        // Rescheduling a pending notice moves its expiry with it — otherwise pushing a notice
        // two days later would leave it expiring six hours after the ORIGINAL time, i.e. dead
        // on arrival. An explicit expiresAt on the edit still wins.
        expiresAt:
          data.expiresAt !== undefined
            ? data.expiresAt
            : data.scheduledFor !== undefined && data.scheduledFor !== null
              ? defaultNoticeExpiry(data.scheduledFor)
              : existing.expiresAt,
        scheduledFor: data.scheduledFor !== undefined ? data.scheduledFor : existing.scheduledFor,
        // Preserved as-is. An edit no longer recomputes it (nothing reads it), and a
        // cron-raised notice's real count must survive an admin editing the wording.
        audienceEstimate: existing.audienceEstimate,
      };
      const saved = await notifRepo.save(updated);
      invalidateDashboardCache();
      return saved;
    },

    async remove(actor, id) {
      const existing = await notifRepo.findById(id);
      if (!existing) throw new NotFoundError('Notification not found');
      const isOversight = actor.role === 'director' || actor.role === 'admin';
      const isCreator = existing.senderId === actor.id;
      // A creator may always delete their own notice (needed for a zoneLeader's own scheduled
      // ones); otherwise only director/admin, plus the legacy zoneLeader-own-zone allowance.
      if (!isOversight && !isCreator) {
        if (actor.role !== 'zoneLeader') {
          throw new ForbiddenError('Not allowed to delete notifications');
        }
        if (!(existing.scope === 'zone' && existing.zone === actor.zone)) {
          throw new ForbiddenError('Zone leaders can only delete notices for their own zone');
        }
      }
      await notifRepo.delete(id);
      invalidateDashboardCache();
      return { ok: true };
    },

    async clearAll(actor) {
      if (actor.role !== 'admin') {
        // ForbiddenError, not a bare Error — the latter maps to a 500 and reads to the caller
        // as "the app is broken" rather than "you are not allowed to do that".
        throw new ForbiddenError('Only admin can clear all notifications');
      }
      const all = await notifRepo.findAll();
      for (const n of all) {
        await notifRepo.delete(n.id);
      }
      invalidateDashboardCache();
      return { deleted: all.length };
    },
  };
}
