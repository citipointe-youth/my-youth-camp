import type { HttpRequest } from '../http/types';
import type { SearchService } from '../../services/search.service';
import { toCamperDto } from '../dto/person.dto';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { createLogger } from '../../utils/logger';

const logger = createLogger('audit');

export interface SearchControllerServices {
  search: SearchService;
}

export function makeSearchController(services: SearchControllerServices) {
  return {
    async search(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const q = req.query['q'];
      if (!q) throw new BadRequestError('Missing search query');
      // Audit 2026-07-19: the service returns the full Person entity internally; never
      // serialize it in a bulk response — strip to the list CamperDto (no medicareNumber,
      // no dateOfBirth; hasMedicare boolean instead, same as GET /campers).
      const results = await services.search.search(req.ctx.actor, q);
      return results.map((r) => ({ ...r, camper: toCamperDto(r.camper) }));
    },

    async resolveContacts(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const camperId = req.params['camperId'];
      if (!camperId) throw new BadRequestError('Missing camperId');
      return services.search.resolveContacts(req.ctx.actor, camperId);
    },

    async revealContact(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const camperId = req.params['camperId'];
      const role = req.params['role'];
      if (!camperId) throw new BadRequestError('Missing camperId');
      if (!role) throw new BadRequestError('Missing role');
      // Feature 4: attribute this masked-contact reveal to the acting leader's initials
      // (church-account session prefill, passed as a query param). Since 2026-07-31 the reveal
      // is ALSO persisted to `reveal_audit` inside the service (which has the person in hand)
      // and surfaces as the "Sensitive Reveals" sheet in the compliance workbook. The log line
      // below is kept as the fallback trail for when that write fails.
      const initials = typeof req.query['initials'] === 'string' ? req.query['initials'].trim() : '';
      const contact = await services.search.revealContact(req.ctx.actor, camperId, role, { initials });
      const revealedBy = initials || req.ctx.actor.displayName;
      logger.info(
        `[audit] contact '${role}' revealed for person ${camperId} by ${req.ctx.actor.role} ${req.ctx.actor.id}` +
          ` (initials: ${initials || '—'}) from ${req.ip ?? 'unknown'}`,
      );
      return { ...contact, revealedBy };
    },
  };
}
