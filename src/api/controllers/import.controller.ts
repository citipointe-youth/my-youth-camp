import type { HttpRequest } from '../http/types';
import type { ImportService } from '../../services/import.service';
import type { ImportBatchService } from '../../services/import-batch.service';
import type { SettingsService } from '../../services/settings.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export interface ImportControllerServices {
  importService: ImportService;
  importBatch: ImportBatchService;
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
    /** Preview only (IA OQ-22): never stamps, never writes. */
    async previewBatch(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.importBatch.previewBatch(req.ctx.actor, req.body);
    },
  };
}
