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
      };
      const saved = await incidentRepo.save(incident);

      // High severity: raise a camp-wide notification so every leader/director/admin sees it in
      // their feed immediately. Built directly on the notification repo (not notification.send)
      // because a zoneLeader logging an incident does NOT hold notification:send:camp — this is a
      // SYSTEM-generated alert, not a user broadcast. The summary is included per spec.
      if (incident.severity === 'high') {
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
          expiresAt: null,
          createdAt: nowISO(),
        };
        await notifRepo.save(notif);
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
