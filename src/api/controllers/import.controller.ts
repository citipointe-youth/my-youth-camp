import type { HttpRequest } from '../http/types';
import type { ImportService } from '../../services/import.service';
import type { SettingsService } from '../../services/settings.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export interface ImportControllerServices {
  importService: ImportService;
  settings: Pick<SettingsService, 'stampImport'>;
}

export function makeImportController(services: ImportControllerServices) {
  return {
    async run(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const result = await services.importService.importCsv(req.ctx.actor, req.body);
      await services.settings.stampImport('form', result);
      return result;
    },
  };
}
