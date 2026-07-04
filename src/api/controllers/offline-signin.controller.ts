import type { HttpRequest } from '../http/types';
import type { OfflineSignInService } from '../../services/offline-signin.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface OfflineSignInControllerServices {
  offlineSignIn: OfflineSignInService;
}

export function makeOfflineSignInController(services: OfflineSignInControllerServices) {
  return {
    async exportTemplate(req: HttpRequest): Promise<Buffer> {
      if (!req.ctx) throw new UnauthorizedError();
      return services.offlineSignIn.exportTemplate(req.ctx.actor);
    },

    async run(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { csvData?: unknown } | undefined;
      if (!body || typeof body.csvData !== 'string' || !body.csvData.trim()) {
        throw new BadRequestError('csvData is required');
      }
      return services.offlineSignIn.importSignIns(req.ctx.actor, body.csvData);
    },
  };
}
