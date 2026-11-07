import type { HttpRequest } from '../http/types';
import type { ImportService } from '../../services/import.service';
import type { ImportBatchService } from '../../services/import-batch.service';
import type { ISettingsRepository } from '../../repositories/interfaces/entity-repositories';
import { UnauthorizedError } from '../../core/errors/app-error';
import { stampImport } from './_import-stamp';

export interface ImportControllerServices {
  importService: ImportService;
  importBatch: ImportBatchService;
  settingsRepo: ISettingsRepository;
}

export function makeImportController(services: ImportControllerServices) {
  return {
    async run(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const result = await services.importService.importCsv(req.ctx.actor, req.body);
      await stampImport(services.settingsRepo, 'formImportedAt', result);
      return result;
    },
    /** Preview only (IA OQ-22): never stamps, never writes. */
    async previewBatch(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.importBatch.previewBatch(req.ctx.actor, req.body);
    },
  };
}
