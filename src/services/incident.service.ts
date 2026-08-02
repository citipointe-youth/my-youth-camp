import type { IIncidentRepository, INotificationRepository } from '../repositories/interfaces/entity-repositories';
import type { Incident } from '../core/entities/incident';
import type { Notification } from '../core/entities/notification';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { CreateIncidentSchema } from '../core/validation/incident.schema';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { ForbiddenError, NotFoundError } from '../core/errors/app-error';
import { invalidateDashboardCache } from './dashboard-cache';
import type { PushService } from './push.service';

/**
 * How long a high-severity incident's `leadersOnly` alert stays in the feed (2026-07-30).
 * It used to be created with `expiresAt: null` and nothing ever cleaned it up, so prod
 * accumulated permanent urgent rows (2 were sitting there). `notifRepo.findActive()` already
 * filters on `expiresAt`, so setting the field is the whole fix — no extra filtering.
 */
export const INCIDENT_ALERT_TTL_HOURS = 12;

export interface IncidentService {
  /** Log an incident (zoneLeader/director/admin). A 'high' severity also raises a camp-wide notice. */
  log(actor: Actor, input: unknown): Promise<Incident>;
  /** All incidents, newest-first (zoneLeader/director/admin). */
  list(actor: Actor, limit?: number): Promise<Incident[]>;
  /** Delete an incident — admin/director only (append-only otherwise). */
  remove(actor: Actor, id: string): Promise<{ ok: true }>;
}

export function makeIncidentService(
  incidentRepo: IIncidentRepository,
  notifRepo: INotificationRepository,
  /**
   * Optional (2026-08-03) so every existing test constructs this service unchanged. Absent
   * = the old behaviour exactly: the alert row is written and the 5-minute cron tick pushes
   * it. Present = the same alert also goes out immediately.
   */
  push?: Pick<PushService, 'sendNow'>,
): IncidentService {
  return {
    async log(actor, input) {
      assertCan(actor, 'incident:manage');
      const data = CreateIncidentSchema.parse(input);
      const zone = data.zone ?? actor.zone ?? null;
      const incident: Incident = {
        id: newId('inc'),
        summary: data.summary,
        severity: data.severity,
        createdById: actor.id,
        createdByName: actor.displayName,
        createdByRole: actor.role,
        zone,
        createdAt: nowISO(),
        // Optional: absent/explicit-null both mean "not recorded" and are perfectly valid.
        occurredAt: data.occurredAt ?? null,
      };
      const saved = await incidentRepo.save(incident);

      // High severity: raise a camp-wide notification so every leader/director/admin sees it in
      // their feed immediately. Built directly on the notification repo (not notification.send)
      // because a zoneLeader logging an incident does NOT hold notification:send:camp — this is a
      // SYSTEM-generated alert, not a user broadcast. The summary is included per spec.
      if (incident.severity === 'high') {
        const createdAt = nowISO();
        const notif: Notification = {
          id: newId('notif'),
          scope: 'camp',
          zone: null,
          churchId: null,
          priority: 'urgent',
          title: `Incident logged${zone ? ` · ${zone} Zone` : ''}`,
          body: incident.summary,
          senderId: actor.id,
          senderName: actor.displayName,
          senderRole: actor.role,
          // Incident summaries can describe a minor — keep them off church/firstAid feeds.
          leadersOnly: true,
          audienceEstimate: 0,
          // Self-destructs INCIDENT_ALERT_TTL_HOURS after it is raised — see the constant.
          expiresAt: new Date(
            new Date(createdAt).getTime() + INCIDENT_ALERT_TTL_HOURS * 60 * 60 * 1000,
          ).toISOString(),
          createdAt,
        };
        await notifRepo.save(notif);
        /* Push it NOW rather than waiting up to 5 minutes for the cron tick (2026-08-03).
           This is the single most time-critical notification the system sends — a
           high-severity incident is a safeguarding event and the leaders who need to act on
           it were, before this, waiting an average of 2.5 minutes on a polling interval.
           `sendNow` claims atomically, so the tick cannot then send it a second time, and it
           NEVER throws: the notice row above is already committed and is the guaranteed
           channel, with the tick still there as the safety net. Awaited, not fired and
           forgotten — see the contract on `sendNow` for why that matters on serverless. */
        if (push) await push.sendNow(notif);
      }
      invalidateDashboardCache(); // a 'high' incident changes AtCampDashboard.latestNotification
      return saved;
    },

    async list(actor, limit) {
      assertCan(actor, 'incident:manage');
      return incidentRepo.findRecent(limit);
    },

    async remove(actor, id) {
      // Append-only: only admin/director may delete an incident.
      if (actor.role !== 'admin' && actor.role !== 'director') {
        throw new ForbiddenError('Only admin or director can delete an incident');
      }
      const existing = await incidentRepo.findById(id);
      if (!existing) throw new NotFoundError('Incident not found');
      await incidentRepo.delete(id);
      invalidateDashboardCache();
      return { ok: true };
    },
  };
}
