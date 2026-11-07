import type { HttpRequest } from '../http/types';
import type { AuthService } from '../../services/auth.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export interface AuthControllerServices {
  auth: AuthService;
}

export function makeAuthController(services: AuthControllerServices) {
  return {
    async login(req: HttpRequest) {
      const result = await services.auth.login(req.body);
      return result;
    },

    async me(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return { user: await services.auth.me(req.ctx.actor.id), actor: req.ctx.actor };
    },

    async setup(req: HttpRequest) {
      return services.auth.setupFirstAdmin(req.body);
    },

    async logout(req: HttpRequest) {
      if (req.ctx) {
        await services.auth.logout(req.ctx.token);
      }
      return { ok: true };
    },
  };
}
