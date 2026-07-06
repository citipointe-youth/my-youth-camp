import type { HttpRequest } from '../http/types';
import type { AuthService } from '../../services/auth.service';
import type { IUserRepository, IPersonRepository, IChurchRepository, ISettingsRepository } from '../../repositories/interfaces/entity-repositories';
import { UnauthorizedError } from '../../core/errors/app-error';
import { toSafeUser } from '../../services/auth.service';
import { ensureFirstAidSample } from '../../services/sample-data';

export interface AuthControllerServices {
  auth: AuthService;
  users: IUserRepository;
  people: IPersonRepository;
  churches: IChurchRepository;
  settingsRepo: ISettingsRepository;
}

export function makeAuthController(services: AuthControllerServices) {
  return {
    async login(req: HttpRequest) {
      const result = await services.auth.login(req.body);
      if (result.user.role === 'firstAid') {
        // Give a first-aid login something real to search/log against before the real
        // roster is imported. Never let a seeding failure break a genuine login.
        try {
          const settings = await services.settingsRepo.getSingleton();
          if (settings?.campMode === 'pre-camp') {
            await ensureFirstAidSample(services.people, services.churches);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[sample-data] ensureFirstAidSample failed:', err);
        }
      }
      return result;
    },

    async me(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const user = await services.users.findById(req.ctx.actor.id);
      if (!user) throw new UnauthorizedError();
      return { user: toSafeUser(user), actor: req.ctx.actor };
    },

    async logout(req: HttpRequest) {
      if (req.ctx) {
        await services.auth.logout(req.ctx.token);
      }
      return { ok: true };
    },
  };
}
