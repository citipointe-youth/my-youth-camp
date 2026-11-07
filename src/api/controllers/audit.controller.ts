import type { HttpRequest } from '../http/types';
import type { AuditExportService } from '../../services/audit-export.service';
import type { ISettingsRepository } from '../../repositories/interfaces/entity-repositories';
import { UnauthorizedError } from '../../core/errors/app-error';
import { nowISO } from '../../utils/date';
import { createLogger } from '../../utils/logger';

const logger = createLogger('audit');

export interface AuditControllerServices {
  auditExport: AuditExportService;
  settingsRepo: ISettingsRepository;
}

export function makeAuditController(services: AuditControllerServices) {
  const { auditExport, settingsRepo } = services;

  return {
    async exportWorkbook(req: HttpRequest): Promise<Buffer> {
      if (!req.ctx) throw new UnauthorizedError();
      const buffer = await auditExport.exportMasterWorkbook(req.ctx.actor);

      // Patch only lastExportedAt (B-7), so a lock, mode change or wipe that lands meanwhile
      // is never written back over.
      if (await settingsRepo.getSingleton()) {
        await settingsRepo.patchSingleton({ lastExportedAt: nowISO(), updatedAt: nowISO() });
      }
      logger.info(`[audit] workbook exported by ${req.ctx.actor.displayName} (${req.ctx.actor.role}) from ${req.ip ?? 'unknown'}`);

      return buffer;
    },

    async exportSignInOutCsv(req: HttpRequest): Promise<Buffer> {
      if (!req.ctx) throw new UnauthorizedError();
      const csv = await auditExport.exportSignInOutCsv(req.ctx.actor);
      // A-2 (OQ-25): this partial CSV (sign events only) does not stamp lastExportedAt; only
      // the full workbook can back a wipe.
      logger.info(`[audit] sign-in/out CSV exported by ${req.ctx.actor.displayName} from ${req.ip ?? 'unknown'}`);

      return Buffer.from(csv, 'utf-8');
    },
  };
}
