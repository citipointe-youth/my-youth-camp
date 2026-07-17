import type { HttpRequest } from '../http/types';
import type { IncidentService } from '../../services/incident.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface IncidentControllerServices {
  incident: IncidentService;
}

export function makeIncidentController(services: IncidentControllerServices) {
  return {
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const limit = req.query['limit'] ? parseInt(req.query['limit'], 10) : undefined;
      return services.incident.list(req.ctx.actor, limit);
    },

    async log(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.incident.log(req.ctx.actor, req.body);
    },

    async remove(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing incident id');
      return services.incident.remove(req.ctx.actor, id);
    },
  };
}
