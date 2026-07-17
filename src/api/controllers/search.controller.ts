import type { HttpRequest } from '../http/types';
import type { SearchService } from '../../services/search.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface SearchControllerServices {
  search: SearchService;
}

export function makeSearchController(services: SearchControllerServices) {
  return {
    async search(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const q = req.query['q'];
      if (!q) throw new BadRequestError('Missing search query');
      return services.search.search(req.ctx.actor, q);
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
      const contact = await services.search.revealContact(req.ctx.actor, camperId, role);
      // Feature 4: attribute this masked-contact reveal to the acting leader's initials
      // (church-account session prefill, passed as a query param). No reveal-audit table
      // exists — the authenticated request is the audit trail; `revealedBy` records who.
      const initials = typeof req.query['initials'] === 'string' ? req.query['initials'].trim() : '';
      return { ...contact, revealedBy: initials || req.ctx.actor.displayName };
    },
  };
}
