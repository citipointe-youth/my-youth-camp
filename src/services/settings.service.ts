import type {
  ISettingsRepository, IDevotionalRepository, IScheduleRepository,
} from '../repositories/interfaces/entity-repositories';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { CampMode } from '../core/types/enums';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { NotFoundError } from '../core/errors/app-error';
import { UpdateSettingsSchema } from '../core/validation/content.schema';
import { nowISO } from '../utils/date';
import { invalidateDashboardCache } from './dashboard-cache';

export interface SettingsService {
  get(): Promise<CampSettings>;
  update(actor: Actor, patch: unknown): Promise<CampSettings>;
  getMode(): Promise<CampMode>;
  setMode(actor: Actor, mode: CampMode): Promise<CampSettings>;
  updateDiscountCodeOverrides(actor: Actor, overrides: Record<string, number>): Promise<CampSettings>;
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

  return {
    get,

    async update(actor, patch) {
      assertCan(actor, 'admin:manage');
      const parsed = UpdateSettingsSchema.parse(patch);
      const current = await get();
      const updated: CampSettings = {
        ...current,
        ...parsed,
        id: SETTINGS_ID,
        updatedAt: nowISO(),
      };
      // Item 3: move day-keyed content with the camp days before persisting the new dates, so a
      // date change never silently orphans the devotionals/schedule an admin already wrote.
      const moves = remapDays(current.checkInDays ?? [], updated.checkInDays ?? []);
      if (moves.size > 0) await applyDayMoves(moves);

      const saved = await repo.saveSingleton(updated);
      invalidateDashboardCache();
      return saved;
    },

    async getMode() {
      const s = await get();
      return s.campMode;
    },

    async setMode(actor, mode) {
      assertCan(actor, 'admin:manage');
      const current = await get();
      const saved = await repo.saveSingleton({ ...current, campMode: mode, updatedAt: nowISO() });
      invalidateDashboardCache();
      return saved;
    },

    /**
     * Discount-code overrides are editable by director as well as admin, so they get their own
     * narrowly-scoped capability rather than widening general settings editing (which is
     * admin:manage and must stay that way).
     */
    async updateDiscountCodeOverrides(actor, overrides) {
      assertCan(actor, 'budget:manage');
      const clean: Record<string, number> = {};
      for (const [code, amount] of Object.entries(overrides ?? {})) {
        const key = code.trim();
        const n = Number(amount);
        // Clearing the field removes the override; reject anything not a positive finite number.
        if (!key || !Number.isFinite(n) || n <= 0) continue;
        clean[key] = Math.round(n * 100) / 100;
      }
      const current = await get();
      const saved = await repo.saveSingleton({ ...current, discountCodeOverrides: clean, updatedAt: nowISO() });
      invalidateDashboardCache();
      return saved;
    },
  };
}
