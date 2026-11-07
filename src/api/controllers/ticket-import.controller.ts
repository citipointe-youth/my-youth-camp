import type { HttpRequest } from '../http/types';
import type { TicketImportService } from '../../services/ticket-import.service';
import type { SettingsService } from '../../services/settings.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export interface TicketImportControllerServices {
  ticketImport: TicketImportService;
  settings: Pick<SettingsService, 'stampImport'>;
}

export function makeTicketImportController(services: TicketImportControllerServices) {
  return {
    async run(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const result = await services.ticketImport.importTicketsCsv(req.ctx.actor, req.body);
      await services.settings.stampImport('tickets', result);
      return result;
    },
  };
}
