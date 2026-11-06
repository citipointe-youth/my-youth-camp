import type { HttpRequest } from '../http/types';
import type { SettingsService } from '../../services/settings.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export interface SettingsControllerServices {
  settings: SettingsService;
}

export function makeSettingsController(services: SettingsControllerServices) {
  return {
    async get(_req: HttpRequest) {
      // GET /settings needs a login (auth:true, A-Q11 2026-11-07): the SPA reads no settings field
      // before login, and the row holds the site map, discount tags and prices. It was public until
      // then, so a dead token now gets a 401 rather than a 200 the SPA would cache.
      // SECURITY: never return lastTempPasswords (plaintext rollover passwords) even to a logged-in
      // caller. Strip the array and expose only a safe count so the admin Data screen can
      // still flag "N temp passwords pending" (the passwords themselves are reachable only via
      // the admin-authenticated audit export). (Found while resolving R9, 2026-06-30.)
      const s = await services.settings.get();
      const { lastTempPasswords, ...safe } = s;
      return { ...safe, pendingTempPasswordCount: lastTempPasswords?.length ?? 0 };
    },

    async update(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.settings.update(req.ctx.actor, req.body);
    },

    async updateDiscountTags(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { tags?: Record<string, string> };
      return services.settings.updateDiscountCodeTags(req.ctx.actor, body?.tags ?? {});
    },
  };
}
