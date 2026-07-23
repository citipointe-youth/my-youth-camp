import type { INotificationRepository, IPersonRepository, IChurchRepository } from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import type { Actor } from '../core/entities/user';
import { assertCanSendNotification } from './access-control';
import { isCamper } from '../core/entities/person';
import { CreateNotificationSchema, UpdateNotificationSchema } from '../core/validation/notification.schema';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { ForbiddenError, NotFoundError } from '../core/errors/app-error';
import { invalidateDashboardCache } from './dashboard-cache';

export interface NotificationService {
  send(actor: Actor, input: unknown): Promise<Notification>;
  feed(actor: Actor): Promise<Notification[]>;
  latest(actor: Actor): Promise<Notification | null>;
  scheduled(actor: Actor): Promise<Notification[]>;
  update(actor: Actor, id: string, input: unknown): Promise<Notification>;
  remove(actor: Actor, id: string): Promise<{ ok: true }>;
  clearAll(actor: Actor): Promise<{ deleted: number }>;
}

export function makeNotificationService(
  notifRepo: INotificationRepository,
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
): NotificationService {
  // D4 FIX: estimate the audience as a count of non-cancelled CAMPERS for every
  // scope, on a consistent basis. The church branch previously returned the church's
  // manually-set `expectedCount` (a planning number, default 0), so a church-scoped
  // notice reported a different kind of figure than camp/zone — and often 0 even with
  // campers present.
  async function estimateAudience(scope: string, zone?: string | null, churchId?: string | null): Promise<number> {
    if (scope === 'camp') {
      const all = await personRepo.findCampers();
      return all.length; // findCampers() already excludes cancelled (lifecycle ∈ {arrived,checked_out,departed})
    }
    if (scope === 'zone' && zone) {
      const zoned = await personRepo.findByZone(zone);
      return zoned.filter((p) => isCamper(p)).length;
    }
    if (scope === 'church' && churchId) {
      const churchPersons = await personRepo.findByChurch(churchId);
      return churchPersons.filter((p) => isCamper(p)).length;
    }
    return 0;
  }

  async function getActorFeed(actor: Actor): Promise<Notification[]> {
    const active = await notifRepo.findActive();
    const now = nowISO();
    return active.filter((n) => {
      // Scheduled notices are withheld from EVERY audience feed until their publish time
      // passes (lazy-fire: they surface on the next feed fetch after `scheduledFor`). The
      // creator manages pending ones via the separate `scheduled()` list, not the feed.
      if (n.scheduledFor && n.scheduledFor > now) return false;
      // Leaders-only notices (e.g. incident alerts) are never shown to church/firstAid,
      // regardless of scope — their bodies can describe a minor.
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
    });
  }

  return {
    async send(actor, input) {
      const data = CreateNotificationSchema.parse(input);
      assertCanSendNotification(actor, data.scope, data.zone);
      const audience = await estimateAudience(data.scope, data.zone, data.churchId);
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
        audienceEstimate: audience,
        expiresAt: data.expiresAt ?? null,
        scheduledFor: data.scheduledFor ?? null,
        createdAt: nowISO(),
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
      const audienceChanged =
        data.scope !== undefined || data.zone !== undefined || data.churchId !== undefined;
      const audience = audienceChanged
        ? await estimateAudience(scope, zone, churchId)
        : existing.audienceEstimate;
      const updated: Notification = {
        ...existing,
        scope,
        zone: zone ?? null,
        churchId: churchId ?? null,
        priority: data.priority ?? existing.priority,
        title: data.title ?? existing.title,
        body: data.body ?? existing.body,
        expiresAt: data.expiresAt !== undefined ? data.expiresAt : existing.expiresAt,
        scheduledFor: data.scheduledFor !== undefined ? data.scheduledFor : existing.scheduledFor,
        audienceEstimate: audience,
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
        throw new Error('Only admin can clear all notifications');
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
