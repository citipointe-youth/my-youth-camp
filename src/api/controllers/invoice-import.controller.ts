import type { HttpRequest } from '../http/types';
import type { InvoiceImportService } from '../../services/invoice-import.service';
import type { SettingsService } from '../../services/settings.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export interface InvoiceImportControllerServices {
  invoiceImport: InvoiceImportService;
  settings: Pick<SettingsService, 'stampImport'>;
}

export function makeInvoiceImportController(services: InvoiceImportControllerServices) {
  return {
    async run(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const result = await services.invoiceImport.importInvoicesCsv(req.ctx.actor, req.body);
      await services.settings.stampImport('invoices', result);
      return result;
    },
  };
}
