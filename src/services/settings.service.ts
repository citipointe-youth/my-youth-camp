import type {
  ISettingsRepository, IDevotionalRepository, IScheduleRepository,
} from '../repositories/interfaces/entity-repositories';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { CampMode } from '../core/types/enums';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { BadRequestError, NotFoundError } from '../core/errors/app-error';
import { UpdateSettingsSchema } from '../core/validation/content.schema';
import { nowISO } from '../utils/date';
import { invalidateDashboardCache } from './dashboard-cache';
import { createLogger } from '../utils/logger';

const logger = createLogger('settings');

/** Which settings timestamp a real (non-dry-run) import of each source stamps. */
export type ImportSource = 'form' | 'tickets' | 'invoices';
const IMPORT_STAMP_FIELD = {
  form: 'formImportedAt', tickets: 'ticketsImportedAt', invoices: 'invoicesImportedAt',
} as const satisfies Record<ImportSource, keyof CampSettings>;

export interface SettingsService {
  get(): Promise<CampSettings>;
  update(actor: Actor, patch: unknown): Promise<CampSettings>;
  getMode(): Promise<CampMode>;
  setMode(actor: Actor, mode: CampMode): Promise<CampSettings>;
  updateDiscountCodeTags(actor: Actor, tags: Record<string, string>): Promise<CampSettings>;
  /*
   * Named single-purpose writes (D4). Each patches only its own column(s) via patchSingleton
   * (B-7), so none can revert a concurrent lock, revoke, mode change or wipe. A missing settings
   * row (tests / first run) is a no-op for all four. No permission check: callers have already
   * asserted theirs (export, import, wipe).
   */
  /** The full audit workbook was exported (OQ-25: the sign-in/out CSV doesn't count). */
  stampExport(): Promise<void>;
  /** A wipe ran: the next wipe needs a fresh export (A-2). */
  clearExportStamp(): Promise<void>;
  /** A real import of `source` finished. Best-effort: never throws, a failure is logged. */
  stampImport(source: ImportSource, result: { dryRun?: boolean }): Promise<void>;
  /** The temp passwords were handed out in an export. */
  clearTempPasswords(): Promise<void>;
}

/**
 * Item 3 (2026-07-28) — CAMP DATES MOVED: keep day-keyed content with its DAY NUMBER.
 *
 * Devotionals and schedule items are stored against an absolute date (`day: '2026-09-14'`), but
 * an admin authors them as "day 1 … day 4". Shifting the camp start date therefore left every
 * devotional and every schedule row stranded on dates the app no longer looks at: the data was
 * still in the database, but every screen read blank and it looked like the content had been
 * lost. This remaps them by POSITION — old day 1's content becomes new day 1's, and so on.
 *
 * Shortening the camp (4 days → 3) leaves the surplus day's rows untouched at their old date:
 * hidden rather than deleted, so lengthening it again — or fixing a mistyped date — brings the
 * content back rather than destroying it. Lengthening simply leaves the new trailing days empty.
 *
 * Returns the (old → new) date pairs it actually moved, for logging/tests.
 */
export function remapDays(oldDays: readonly string[], newDays: readonly string[]): Map<string, string> {
  const moves = new Map<string, string>();
  const n = Math.min(oldDays.length, newDays.length);
  for (let i = 0; i < n; i++) {
    const from = oldDays[i]!;
    const to = newDays[i]!;
    if (from !== to) moves.set(from, to);
  }
  return moves;
}

export interface SettingsServiceDeps {
  devotionals?: IDevotionalRepository;
  schedule?: IScheduleRepository;
}

export function makeSettingsService(repo: ISettingsRepository, deps: SettingsServiceDeps = {}): SettingsService {
  async function get(): Promise<CampSettings> {
    const s = await repo.getSingleton();
    if (!s) throw new NotFoundError('Camp settings not initialised');
    return s;
  }

  /**
   * Re-key devotionals and schedule items onto their new dates (item 3). Both are read fully,
   * re-keyed in memory and written back, because the moves can overlap (shifting a camp forward
   * by one day means day 2's old date IS day 1's new date) — a naive per-row update would
   * overwrite content mid-pass. Repos are optional so unit tests and `admin.service`'s internal
   * settings service can construct this without them; the remap is then a no-op.
   */
  async function applyDayMoves(moves: Map<string, string>): Promise<void> {
    if (deps.devotionals) {
      const all = await deps.devotionals.findAll();
      const affected = all.filter((d) => moves.has(d.day));
      if (affected.length) {
        // Delete first, then re-save under the new day — otherwise a row that moves onto a date
        // another row is vacating would collide with the row still sitting there.
        for (const d of affected) await deps.devotionals.delete(d.id);
        for (const d of affected) {
          await deps.devotionals.save({ ...d, day: moves.get(d.day)!, updatedAt: nowISO() });
        }
      }
    }
    if (deps.schedule) {
      const all = await deps.schedule.findAll();
      const affected = all.filter((s) => moves.has(s.day));
      if (affected.length) {
        for (const s of affected) await deps.schedule.delete(s.id);
        for (const s of affected) {
          await deps.schedule.save({ ...s, day: moves.get(s.day)! });
        }
      }
    }
  }

  /** patchSingleton only when the row exists, so a missing row stays missing. */
  async function patchIfPresent(fields: Partial<CampSettings>): Promise<void> {
    if (!(await repo.getSingleton())) return;
    await repo.patchSingleton({ ...fields, updatedAt: nowISO() });
  }

  return {
    get,

    stampExport: () => patchIfPresent({ lastExportedAt: nowISO() }),
    clearExportStamp: () => patchIfPresent({ lastExportedAt: null }),
    clearTempPasswords: () => patchIfPresent({ lastTempPasswords: null }),

    async stampImport(source, result) {
      if (result.dryRun) return;
      const field = IMPORT_STAMP_FIELD[source];
      try {
        await patchIfPresent({ [field]: nowISO() });
      } catch (err) {
        // Non-fatal: the import itself is committed; the timestamp is cosmetic.
        logger.warn(`could not stamp ${field}`, err instanceof Error ? err.message : err);
      }
    },

    async update(actor, patch) {
      assertCan(actor, 'admin:manage');
      const parsed = UpdateSettingsSchema.parse(patch);
      const current = await get();
      const now = nowISO();
      const updated: CampSettings = {
        ...current,
        ...parsed,
        id: SETTINGS_ID,
        updatedAt: now,
      };
      if (updated.startDate && updated.endDate && updated.endDate < updated.startDate) {
        throw new BadRequestError('The end date is before the start date');
      }
      // Session revocation epoch (2026-08-05): flipping a login lock false->true also stamps
      // that role's epoch, so tokens already handed out to it are killed within 60s (the cache
      // TTL `resolveToken` reads through), not just new logins from here on. This is the ONLY
      // way these two fields are ever set — there is deliberately no separate admin control.
      // Flipping the lock back OFF must NOT clear the stamp: a fresh login mints a newer
      // `issuedAt` and works fine, while any still-live old token stays dead. Only the FALSE ->
      // TRUE transition on THIS call stamps it — re-saving `true` on top of an already-true lock
      // (e.g. an unrelated settings edit) must not keep pushing the epoch forward, or a
      // perfectly valid session minted seconds ago would be killed by an admin renaming the camp.
      // B-7 (OQ-50): only the parsed keys and these stamps are written, never the whole row.
      const fields: Partial<CampSettings> = { ...parsed, updatedAt: now };
      if (parsed.churchLoginLocked === true && current.churchLoginLocked !== true) {
        fields.churchSessionsValidFrom = now;
      }
      if (parsed.zoneLeaderLoginLocked === true && current.zoneLeaderLoginLocked !== true) {
        fields.zoneLeaderSessionsValidFrom = now;
      }
      // Item 3: move day-keyed content with the camp days before persisting the new dates, so a
      // date change never silently orphans the devotionals/schedule an admin already wrote.
      const moves = remapDays(current.checkInDays ?? [], updated.checkInDays ?? []);
      if (moves.size > 0) await applyDayMoves(moves);

      // A stamp or lastExportedAt written during applyDayMoves is not reverted.
      const saved = await repo.patchSingleton(fields);
      invalidateDashboardCache();
      return saved;
    },

    async getMode() {
      const s = await get();
      return s.campMode;
    },

    async setMode(actor, mode) {
      assertCan(actor, 'admin:manage');
      await get(); // 404 if the row is missing
      const saved = await repo.patchSingleton({ campMode: mode, updatedAt: nowISO() });
      invalidateDashboardCache();
      return saved;
    },

    /**
     * Discount-code CLASSIFICATION (2026-07-29, replaces the old amount overrides). Editable by
     * director as well as admin, so it keeps its own narrowly-scoped `budget:manage` capability
     * rather than widening general settings editing (which is admin:manage and must stay that way).
     *
     * Unknown tag values are dropped rather than rejected: the dropdown's "plain" option submits
     * an empty string, and clearing a tag is a normal, expected edit — not an error worth a 400.
     */
    async updateDiscountCodeTags(actor, tags) {
      assertCan(actor, 'budget:manage');
      const clean: NonNullable<CampSettings['discountCodeTags']> = {};
      for (const [code, tag] of Object.entries(tags ?? {})) {
        const key = code.trim();
        if (!key) continue;
        /* ⚠️ THIS LIST IS A WHITELIST AND `clean` REPLACES THE WHOLE MAP, so a tag value
           missing here is not merely rejected on its own edit — it is ERASED FROM EVERY CODE
           the next time anyone changes any tag on the Budget screen, silently. Adding a value
           to DiscountTag REQUIRES adding it here. 'upgrade' was added 2026-09-09 and this line
           was missed; the tags survived only because nothing had been re-tagged yet. */
        if (tag === 'inperson' || tag === 'sponsor' || tag === 'discount' || tag === 'upgrade') clean[key] = tag;
      }
      await get(); // 404 if the row is missing
      const saved = await repo.patchSingleton({ discountCodeTags: clean, updatedAt: nowISO() });
      invalidateDashboardCache();
      return saved;
    },
  };
}
