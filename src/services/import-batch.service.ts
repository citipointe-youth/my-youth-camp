import type { Actor } from '../core/entities/user';
import { isAppError } from '../core/errors/app-error';
import { ZodError, z } from 'zod';
import { assertCan } from './access-control';
import { stage, type ImportStore } from './import-store';
import type { ImportService, ImportResult } from './import.service';
import type { TicketImportService, TicketImportResult } from './ticket-import.service';
import type { InvoiceImportService, InvoiceImportResult } from './invoice-import.service';

// ---------------------------------------------------------------------------
// POST /import/batch — PREVIEW ONLY (I2, IA OQ-22). Runs the files in the order given over ONE
// staged overlay, so a Ticket file previews against the people the Form file in the same batch
// would create. Always a dry run: the stage is discarded, nothing is written or stamped.
// Confirm stays the three per-file POSTs (Form first), which reach the same result one flush at a
// time without risking a 30 s serverless timeout mid-commit. The 11.1 console never calls this.
// ---------------------------------------------------------------------------

const BatchSchema = z.object({
  files: z.array(z.object({
    type: z.enum(['form', 'tickets', 'invoices']),
    csvData: z.string(),
  })).min(1).max(3),
  updateExisting: z.boolean().optional(),
});

export type BatchFileResult =
  | { type: 'form'; result: ImportResult }
  | { type: 'tickets'; result: TicketImportResult }
  | { type: 'invoices'; result: InvoiceImportResult }
  | { type: 'form' | 'tickets' | 'invoices'; error: string };

export interface ImportBatchService {
  previewBatch(actor: Actor, input: unknown): Promise<{ dryRun: true; results: BatchFileResult[] }>;
}

export function makeImportBatchService(
  real: ImportStore,
  importers: { form: ImportService; tickets: TicketImportService; invoices: InvoiceImportService },
): ImportBatchService {
  return {
    async previewBatch(actor, input) {
      assertCan(actor, 'import:run');
      const { files, updateExisting } = BatchSchema.parse(input);
      const staged = stage(real);
      const results: BatchFileResult[] = [];
      for (const f of files) {
        const body = { csvData: f.csvData, updateExisting, dryRun: true };
        try {
          if (f.type === 'form') results.push({ type: f.type, result: await importers.form.importCsv(actor, body, staged) });
          else if (f.type === 'tickets') results.push({ type: f.type, result: await importers.tickets.importTicketsCsv(actor, body, staged) });
          else results.push({ type: f.type, result: await importers.invoices.importInvoicesCsv(actor, body, staged) });
        } catch (err) {
          // A file the per-file endpoint would refuse (4xx: consent column missing, no rows,
          // bad body) is reported on that file, as the SPA showed it before; later files still
          // preview. Anything else (a 5xx) fails the whole request.
          if (isAppError(err) && err.statusCode < 500) results.push({ type: f.type, error: err.message });
          else if (err instanceof ZodError) results.push({ type: f.type, error: 'Validation failed' });
          else throw err;
        }
      }
      return { dryRun: true, results };
    },
  };
}
