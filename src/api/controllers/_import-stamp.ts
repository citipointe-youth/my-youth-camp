import type { ISettingsRepository } from '../../repositories/interfaces/entity-repositories';
import { nowISO } from '../../utils/date';
import { createLogger } from '../../utils/logger';

const logger = createLogger('import-stamp');

/** Which settings timestamp a given import source stamps on a successful real import. */
type ImportStampField = 'formImportedAt' | 'ticketsImportedAt' | 'invoicesImportedAt';

/**
 * Record "source X was imported just now" on the settings singleton, so the upload screen
 * can show a per-source "last uploaded" line. Only call this after a real (non-dry-run)
 * import. Best-effort: a missing settings row (tests / first run) is a silent no-op, and a
 * stamp failure must never fail the import the user already committed (it is logged).
 * Patches only this one column (B-7), so it can't revert a concurrent lock, mode change or
 * a wipe's cleared lastExportedAt.
 */
export async function stampImport(
  settingsRepo: ISettingsRepository,
  field: ImportStampField,
  result: { dryRun?: boolean },
): Promise<void> {
  if (result.dryRun) return;
  try {
    if (!(await settingsRepo.getSingleton())) return;
    await settingsRepo.patchSingleton({ [field]: nowISO(), updatedAt: nowISO() });
  } catch (err) {
    // Non-fatal: the import itself succeeded; the timestamp is cosmetic.
    logger.warn(`could not stamp ${field}`, err instanceof Error ? err.message : err);
  }
}
