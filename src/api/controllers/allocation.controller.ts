import type { HttpRequest } from '../http/types';
import type { AllocationService } from '../../services/allocation.service';
import { toRegistrantDto } from '../dto/person.dto';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface AllocationControllerServices {
  allocation: AllocationService;
}

export function makeAllocationController(services: AllocationControllerServices) {
  return {
    async listUnallocated(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      // Service returns Person[]; the controller owns the DTO mapping (layering).
      return (await services.allocation.listUnallocated(req.ctx.actor)).map(toRegistrantDto);
    },
    async listOverrides(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.allocation.listOverrides(req.ctx.actor);
    },
    async allocate(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.allocation.allocate(req.ctx.actor, req.body);
    },
    async removeOverride(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing override id');
      return services.allocation.removeOverride(req.ctx.actor, id);
    },
  };
}
