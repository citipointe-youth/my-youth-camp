import type { HttpRequest } from '../http/types';
import type { CheckInService } from '../../services/checkin.service';
import type { PersonService } from '../../services/person.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { nowISO } from '../../utils/date';

export interface CheckInControllerServices {
  checkIn: CheckInService;
  person: PersonService;
}

export function makeCheckInController(services: CheckInControllerServices) {
  return {
    async sessions(_req: HttpRequest) {
      return services.checkIn.getSessions();
    },

    async currentSession(_req: HttpRequest) {
      return services.checkIn.getCurrentSession();
    },

    // Lets the SPA grey out a roster it isn't allowed to write to, instead of discovering the
    // rule one 403 at a time. Actor-scoped: the answer differs per role.
    async allowedSession(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.checkIn.getAllowedSession(req.ctx.actor);
    },

    async status(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const sessionId = req.params['sessionId'];
      if (!sessionId) throw new BadRequestError('Missing sessionId');
      return services.checkIn.getSessionStatus(req.ctx.actor, sessionId);
    },

    async checkIn(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const b = req.body as { camperId?: string; sessionId?: string; type?: 'in' | 'out'; initials?: string };
      if (!b.camperId) throw new BadRequestError('Missing camperId');
      if (!b.sessionId) throw new BadRequestError('Missing sessionId');
      if (!b.type) throw new BadRequestError('Missing type');

      await services.checkIn.assertSessionAllowed(req.ctx.actor, b.sessionId);

      // Look up session label from the schedule so the check-in history is readable.
      const sessions = await services.checkIn.getSessions();
      const session = sessions.find((s) => s.id === b.sessionId);
      const sessionLabel = session?.label ?? b.sessionId;

      // Feature 4: capture the acting leader's initials (church-account session prefill) in
      // the daily check-in audit entry. Reuses the existing free-text `leaderId` field — no
      // new column. Falls back to the account id when no initials were supplied (e.g. a
      // non-church role, which never gets the initials prompt).
      const actorInitials = typeof b.initials === 'string' ? b.initials.trim() : '';
      await services.person.checkIn(req.ctx.actor, b.camperId, {
        sessionId: b.sessionId,
        sessionLabel,
        type: b.type,
        leaderId: actorInitials || req.ctx.actor.id,
        timestamp: nowISO(),
      });
      return { ok: true };
    },
  };
}
