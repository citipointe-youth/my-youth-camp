import type { HttpRequest } from '../http/types';
import type { PersonService } from '../../services/person.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { nowISO } from '../../utils/date';

export interface AttendanceControllerServices {
  person: PersonService;
}

/** Cap on the stored author text; production's longest is 18 characters (A-Q8). */
const LEADER_NAME_MAX = 60;

/**
 * `leaderName` stays client-supplied (shared church login, ruling Q8) but the server requires a
 * non-empty string of at most 60 characters after trim. No displayName fallback (ORCH override of
 * IA OQ-18). /attendance is a live call, not the offline queue, so the leader sees the 400.
 */
function requireLeaderName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) throw new BadRequestError('Leader name is required');
  if (name.length > LEADER_NAME_MAX) throw new BadRequestError(`Leader name must be ${LEADER_NAME_MAX} characters or fewer`);
  return name;
}

export function makeAttendanceController(services: AttendanceControllerServices) {
  const { person } = services;

  return {
    async signOut(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const b = req.body as { camperId?: string; reason?: string; leaderName?: string };
      if (!b.camperId) throw new BadRequestError('Missing camperId');
      const leaderName = requireLeaderName(b.leaderName);
      await person.signEvent(req.ctx.actor, b.camperId, {
        type: 'out',
        leaderName,
        reason: b.reason,
        authorId: req.ctx.actor.id,
        timestamp: nowISO(),
      });
      return { ok: true };
    },

    async signIn(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const b = req.body as { camperId?: string; leaderName?: unknown };
      if (!b.camperId) throw new BadRequestError('Missing camperId');
      const leaderName = requireLeaderName(b.leaderName);
      await person.signEvent(req.ctx.actor, b.camperId, {
        type: 'in',
        leaderName,
        authorId: req.ctx.actor.id,
        timestamp: nowISO(),
      });
      return { ok: true };
    },
  };
}
