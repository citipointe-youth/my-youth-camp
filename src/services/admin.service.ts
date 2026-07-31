import type {
  IUserRepository,
  IChurchRepository,
  IPersonRepository,
  IClassroomRepository,
  IAllocationRepository,
  IFaqRepository,
  IScheduleRepository,
  INotificationRepository,
  INoteRepository,
  IDevotionalRepository,
  ISettingsRepository,
  ISnapshotRepository,
  IAllocationOverrideRepository,
  IIncidentRepository,
  IRevealAuditRepository,
  IPushSubscriptionRepository,
} from '../repositories/interfaces/entity-repositories';
import type { CampSettings } from '../core/entities/settings';
import type { Church } from '../core/entities/church';
import type { User } from '../core/entities/user';
import type { Classroom } from '../core/entities/accommodation';
import type { FaqItem } from '../core/entities/content';
import type { ScheduleItem } from '../core/entities/schedule';
import type { Devotional } from '../core/entities/devotional';
import type { CampMode } from '../core/types/enums';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import { assertCan } from './access-control';
import { ForbiddenError, NotFoundError, BadRequestError, WipeGuardError } from '../core/errors/app-error';
import { nowISO } from '../utils/date';
import { newId } from '../utils/id';
import { makeSettingsService } from './settings.service';
import { generateTempPassword } from '../utils/temp-password';
import { hashPassword } from '../utils/crypto';
import { invalidateDashboardCache } from './dashboard-cache';

export interface TempPasswordEntry {
  username: string;
  tempPassword: string;
}

export interface NewYearResult extends CampSettings {
  tempPasswords: TempPasswordEntry[];
}

export interface WipeOpts {
  force?: boolean;
  confirmWipe?: string;
}

const CONFIRM_WIPE_STRING = 'I understand this cannot be undone';

/** What `resetLogs` cleared, for the confirmation toast. */
export interface ResetLogsResult {
  people: number;      // people whose attendance history was cleared
  notes: number;       // notes + testimonies + first-aid records deleted
  incidents: number;
}

export interface AdminService {
  reset(actor: Actor, opts?: WipeOpts): Promise<{ ok: true }>;
  resetLogs(actor: Actor, opts?: WipeOpts): Promise<ResetLogsResult>;
  saveDefaults(actor: Actor): Promise<{ ok: true }>;
  newYear(actor: Actor, year: number, opts?: WipeOpts): Promise<NewYearResult>;
  clearNotifications(actor: Actor): Promise<{ deleted: number }>;
  setMode(actor: Actor, mode: CampMode): Promise<CampSettings>;
}

export function makeAdminService(
  userRepo: IUserRepository,
  churchRepo: IChurchRepository,
  personRepo: IPersonRepository,
  classroomRepo: IClassroomRepository,
  allocationRepo: IAllocationRepository,
  faqRepo: IFaqRepository,
  scheduleRepo: IScheduleRepository,
  notifRepo: INotificationRepository,
  noteRepo: INoteRepository,
  devotionalRepo: IDevotionalRepository,
  settingsRepo: ISettingsRepository,
  snapshotRepo: ISnapshotRepository,
  overrideRepo: IAllocationOverrideRepository,
  // Bug 16 (2026-07-28): incidents (and push subscriptions) survived a "full reset" because the
  // service was never given those repos — the wipe list was silently incomplete. Added here so
  // reset() clears them; also backs the new resetLogs().
  incidentRepo: IIncidentRepository,
  pushSubRepo: IPushSubscriptionRepository,
  // 2026-07-31: the reveal audit is a log of THIS year's people, so it is purged by all three
  // destructive paths (reset, resetLogs, newYear) — same standing rule as the two above.
  revealAuditRepo: IRevealAuditRepository,
): AdminService {
  const settingsService = makeSettingsService(settingsRepo);

  async function assertExportedOrForce(opts?: WipeOpts): Promise<void> {
    if (opts?.force && opts.confirmWipe === CONFIRM_WIPE_STRING) return;
    if (opts?.force && opts.confirmWipe !== CONFIRM_WIPE_STRING) {
      throw new BadRequestError(`force requires confirmWipe: "${CONFIRM_WIPE_STRING}"`);
    }
    const settings = await settingsRepo.getSingleton();
    if (!settings?.lastExportedAt) {
      throw new WipeGuardError();
    }
  }

  /** Replace a repository's whole contents with the given records (clear then save). */
  async function replaceAll<T extends { id: string }>(
    repo: { deleteAll(): Promise<number>; save(e: T): Promise<T> },
    records: T[],
  ): Promise<void> {
    await repo.deleteAll();
    for (const r of records) await repo.save(r);
  }

  return {
    // FULL RESET (decision 2026-06-18): wipe ALL data back to bare — people,
    // scaffold (churches/accommodation/FAQ/schedule/devotionals), notifications and
    // notes. Keeps ONLY the admin account + camp settings. Does NOT restore from the
    // defaults snapshot (that is newYear's job) — this fixes defect A4, which used to
    // load the snapshot purely as a guard and then never restore from it. Non-admin
    // accounts are deleted; the single admin is preserved.
    async reset(actor, opts) {
      if (actor.role !== 'admin') throw new ForbiddenError('Only admin can reset data');
      await assertExportedOrForce(opts);

      await Promise.all([
        personRepo.deleteAll(),
        churchRepo.deleteAll(),
        classroomRepo.deleteAll(),
        allocationRepo.deleteAll(),
        faqRepo.deleteAll(),
        scheduleRepo.deleteAll(),
        notifRepo.deleteAll(),
        noteRepo.deleteAll(),
        devotionalRepo.deleteAll(),
        overrideRepo.deleteAll(),
        // Bug 16: these two were missing — incidents survived a "full reset" (reported), and
        // orphaned push subscriptions would have kept pushing to deleted accounts' devices.
        incidentRepo.deleteAll(),
        pushSubRepo.deleteAll(),
        revealAuditRepo.deleteAll(),
      ]);

      // Delete every non-admin account. ALL admins survive, not just the original
      // (2026-07-31, when secondary admins became creatable): reset() requires an admin
      // actor, so deleting secondary admins would let a secondary admin destroy their own
      // account mid-operation and lock themselves out of the wipe they just started.
      const users = await userRepo.findAll();
      await Promise.all(users.filter((u) => u.role !== 'admin').map((u) => userRepo.delete(u.id)));

      invalidateDashboardCache();
      return { ok: true };
    },

    /**
     * RESET LOGS (item 9, 2026-07-28) — clears everything a compliance workbook export
     * contains, and nothing else. Registrations, churches, accounts, accommodation, schedule,
     * devotionals, FAQ and settings are all kept, so the camp stays fully configured.
     *
     * Cleared: every person's check-in and sign-in/sign-out history (and their presence is
     * returned to "not signed in", so the roster is genuinely back to a pre-activity state
     * rather than showing people at camp with no arrival record), all notes/testimonies/
     * first-aid records, and all incidents. Notifications are DELIBERATELY not touched — they
     * are their own button on the same screen.
     *
     * Guarded by the same export-or-force gate as a full reset: destroying the audit trail
     * without a saved export is exactly what that guard exists to prevent.
     */
    async resetLogs(actor, opts) {
      if (actor.role !== 'admin') throw new ForbiddenError('Only admin can reset logs');
      await assertExportedOrForce(opts);

      const people = await personRepo.findAll();
      const touched = people.filter(
        (p) => p.checkInHistory.length > 0 || p.signOutHistory.length > 0 || p.atCamp,
      );
      if (touched.length) {
        const now = nowISO();
        await personRepo.saveMany(
          touched.map((p) => ({
            ...p,
            checkInHistory: [],
            signOutHistory: [],
            atCamp: false,
            // Anyone who had arrived/departed goes back to 'registered'; a cancelled or
            // already-registered person keeps their lifecycle untouched.
            lifecycle: p.lifecycle === 'cancelled' || p.lifecycle === 'registered' ? p.lifecycle : 'registered',
            updatedAt: now,
          })),
        );
      }

      const [notes, incidents] = await Promise.all([noteRepo.findAll(), incidentRepo.findAll()]);
      // The reveal audit is exactly the class of thing resetLogs() exists to clear — it is a
      // sheet in the same compliance workbook as the notes and incidents beside it.
      await Promise.all([noteRepo.deleteAll(), incidentRepo.deleteAll(), revealAuditRepo.deleteAll()]);

      invalidateDashboardCache();
      return { people: touched.length, notes: notes.length, incidents: incidents.length };
    },

    async saveDefaults(actor) {
      if (actor.role !== 'admin') throw new ForbiddenError('Only admin can save defaults');
      const [churches, users, classrooms, faqs, schedule, devotionals] = await Promise.all([
        churchRepo.findAll(),
        userRepo.findAll(),
        classroomRepo.findAll(),
        faqRepo.findAll(),
        scheduleRepo.findAll(),
        devotionalRepo.findAll(),
      ]);

      await snapshotRepo.saveDefaults({
        id: 'defaults',
        churches,
        users: users.map((u) => {
          const { passwordHash: _pw, ...rest } = u;
          return rest;
        }),
        classrooms,
        faqs,
        schedule,
        devotionals,
        createdAt: nowISO(),
      });

      // Stamp when defaults were last saved so the Data screen + close-out checklist can
      // show it (bugs 6 & 10). Tolerate a missing settings row (first-run/tests).
      const settings = await settingsRepo.getSingleton();
      if (settings) {
        await settingsRepo.saveSingleton({ ...settings, defaultsSavedAt: nowISO(), updatedAt: nowISO() });
      }

      return { ok: true };
    },

    // NEW YEAR (decision 2026-06-18): the routine annual rollover. Purges this
    // year's people + transient data (registrants, campers, notes, notifications)
    // and RESTORES the scaffold (churches, accounts, accommodation, FAQ, schedule,
    // devotionals) from the saved defaults snapshot. Keeps the admin account and the
    // camp settings (bumps year, forces pre-camp). Requires a saved snapshot.
    async newYear(actor, year, opts) {
      if (actor.role !== 'admin') throw new ForbiddenError('Only admin can advance the year');
      await assertExportedOrForce(opts);
      const settings = await settingsService.get();
      const defaults = await snapshotRepo.getDefaults();
      if (!defaults) {
        throw new NotFoundError('No defaults snapshot saved — run Save Defaults before New Year');
      }

      // Purge this year's people + transient data. Allocations are people-dependent
      // and never restored from the scaffold snapshot — wipe them here too.
      await Promise.all([
        personRepo.deleteAll(),
        noteRepo.deleteAll(),
        notifRepo.deleteAll(),
        allocationRepo.deleteAll(),
        overrideRepo.deleteAll(),
        // Last year's leaders must not carry alerts into a new camp with a partly different
        // team. `reset()` already did this (bug 16); newYear did not, and was relying by
        // accident on the users FK cascade below — which does clean up on Supabase but not
        // in-memory, and would stop working the moment an account survived the rollover.
        // Same standing rule as reset(): a new repository must be added here in the same commit.
        pushSubRepo.deleteAll(),
        // The audit's rows name people who are about to be deleted; carrying them into a new
        // camp would leave an export full of names that no longer resolve to anyone.
        revealAuditRepo.deleteAll(),
      ]);

      // Restore the scaffold from the baseline. Accounts: replace all EXCEPT the
      // admin (the snapshot strips passwordHash, so seeded users would be passwordless
      // — restore them with a temp password; an operator shares these at rollover).
      const admins = (await userRepo.findAll()).filter((u) => u.role === 'admin');
      await replaceAll<Church>(churchRepo, defaults.churches as Church[]);
      await replaceAll<Classroom>(classroomRepo, defaults.classrooms as Classroom[]);
      await replaceAll<FaqItem>(faqRepo, defaults.faqs as FaqItem[]);
      await replaceAll<ScheduleItem>(scheduleRepo, defaults.schedule as ScheduleItem[]);
      await replaceAll<Devotional>(devotionalRepo, defaults.devotionals as Devotional[]);

      const snapshotUsers = (defaults.users as Array<Omit<User, 'passwordHash'>>).map(
        (u) => ({ ...u, passwordHash: undefined }) as User,
      );
      await userRepo.deleteAll();
      for (const a of admins) await userRepo.save(a);

      const tempPasswords: TempPasswordEntry[] = [];
      for (const u of snapshotUsers) {
        if (u.role === 'admin') continue;
        const tempPassword = generateTempPassword();
        const passwordHash = await hashPassword(tempPassword);
        // Generated, not self-chosen — force the holder to set their own before anything
        // else is reachable (was previously advisory-only: "should set their own password").
        await userRepo.save({ ...u, passwordHash, mustChangePassword: true });
        if (u.username) tempPasswords.push({ username: u.username, tempPassword });
      }

      const updated = await settingsRepo.saveSingleton({
        ...settings,
        year,
        campMode: 'pre-camp',
        lastTempPasswords: tempPasswords,
        updatedAt: nowISO(),
      });
      invalidateDashboardCache();
      return { ...updated, tempPasswords };
    },

    async clearNotifications(actor) {
      assertCan(actor, 'admin:manage');
      const deleted = await notifRepo.deleteAll();
      invalidateDashboardCache();
      return { deleted };
    },

    // Leaders are NOT auto-signed-in on the pre-camp -> at-camp transition (reverted
    // 2026-07-23 — see docs/superpowers/specs/2026-07-23-overnight-batch-design.md item 5).
    // They start atCamp:false at go-live like everyone else and are signed in manually via
    // the My-group "Late arrivals" -> "Sign in to camp" path (filterMyYouth already includes
    // leaders), the same as a real physical arrival. This keeps dashboard totalAtCamp from
    // counting un-arrived leaders. checkin.service/dashboard.service already exclude leaders
    // from the twice-daily roster regardless of this.
    async setMode(actor, mode) {
      const before = await settingsService.get();
      const saved = await settingsService.setMode(actor, mode);
      if (before.campMode !== 'at-camp' && mode === 'at-camp') {
        // First-aid records logged during pre-camp are necessarily test/practice ones —
        // nobody is physically at camp yet for a real first-aid incident to happen (see
        // note.service.ts's firstAidEligible, which lets a first-aider log/read a record
        // against a not-yet-arrived registrant specifically so this can be tested before
        // going live). Wipe them all now that the real camp is starting.
        const allNotes = await noteRepo.findAll();
        const testFirstAidNotes = allNotes.filter((n) => (n.category ?? 'note') === 'firstaid');
        for (const n of testFirstAidNotes) await noteRepo.delete(n.id);
      } else if (before.campMode === 'at-camp' && mode === 'pre-camp') {
        // Reverting from at-camp back to pre-camp (e.g. an admin toggling modes during
        // setup/testing rather than a real end-of-camp rollover) must undo the presence
        // state or every person still marked atCamp becomes permanently invisible to every
        // pre-camp screen (Home, Budget, Data, accommodation) — those all read the
        // registrants view (`lifecycle==='registered'`), and the presence model has no
        // normal transition back to 'registered' (arrived/checked_out only cycle between
        // each other — see person-lifecycle.ts). This bypasses withSignEvent and sets the
        // fields directly for exactly that reason, while still appending an audit sign-out
        // event so the history reflects what happened.
        const people = await personRepo.findAll();
        const now = nowISO();
        const toRevert = people.filter((p) => p.atCamp && p.lifecycle !== 'cancelled');
        if (toRevert.length > 0) {
          const updated: Person[] = toRevert.map((p) => ({
            ...p,
            lifecycle: 'registered',
            atCamp: false,
            signOutHistory: [
              ...p.signOutHistory,
              {
                id: newId('so'),
                type: 'out',
                leaderName: actor.displayName,
                reason: 'Camp mode reverted to pre-camp',
                authorId: actor.id,
                timestamp: now,
              },
            ],
            updatedAt: now,
          }));
          await personRepo.saveMany(updated);
          invalidateDashboardCache();
        }
      }
      return saved;
    },
  };
}
