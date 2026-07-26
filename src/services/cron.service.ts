import type {
  INotificationRepository,
  IPersonRepository,
  IUserRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import { churchesBehind, warnWindow } from './checkin-warnings';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';

export interface TickResult {
  ok: true;
  checkinWarningsCreated: number;
  failed: number;
}

/** postgres.js SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

export interface CronServiceDeps {
  notifications: INotificationRepository;
  people: IPersonRepository;
  users: IUserRepository;
  settings: ISettingsRepository;
}

export function makeCronService(deps: CronServiceDeps) {
  return {
    /**
     * One scheduled tick. Called by Supabase pg_cron via pg_net every 5 minutes.
     *
     * Phase 1-3 scope: job B only (create check-in-closing notices). Jobs C and D
     * (claim + web-push fan-out) arrive with the push phases; `claimForPush` already
     * exists so they can be added without touching this shape.
     *
     * Must be CHEAP when there is nothing to do — it runs 288 times a day. churchesBehind
     * short-circuits off a camp day / outside the lead window before any real work.
     */
    async run(): Promise<TickResult> {
      const settings = await deps.settings.getSingleton();
      if (!settings) return { ok: true, checkinWarningsCreated: 0, failed: 0 };

      if (!settings.timezone) {
        // zonedNow silently falls back to the HOST's zone, which on Vercel is UTC — that
        // would resolve yesterday's camp day for 10 hours of every day. Warn loudly.
        console.warn('[cron] settings.timezone is empty; check-in warnings may target the wrong day');
      }

      // Capture the clock ONCE. warnWindow is a cheap settings-only check — an idle tick
      // (off a camp day, outside the lead window, restriction off) returns here without
      // ever touching the people table (~10 AES field decrypts per person, ~288 ticks/day).
      const now = new Date();
      if (!warnWindow(settings, now)) return { ok: true, checkinWarningsCreated: 0, failed: 0 };

      const [people, users] = await Promise.all([deps.people.findAll(), deps.users.findAll()]);
      const behind = churchesBehind(settings, people, users, now);
      if (behind.length === 0) return { ok: true, checkinWarningsCreated: 0, failed: 0 };

      let created = 0;
      let failed = 0;
      for (const b of behind) {
        // Deterministic key -> repeated ticks inside the 60-minute lead window produce
        // exactly ONE notice per church login per session. Keyed on the LOGIN id because
        // b-/g- accounts are two audiences with two different counts.
        const dedupeKey = `checkin-warn:${b.sessionId}:${b.userId}`;
        const notif: Notification = {
          id: newId('notif'),
          scope: 'church',
          zone: null,
          churchId: b.churchId,
          priority: 'urgent',
          title: 'Check-in closing soon',
          body: `${b.remaining} student${b.remaining === 1 ? '' : 's'} still to check in — the ${b.sessionLabel} window closes at ${b.windowEnd}.`,
          // System-raised, like incident.service.log: written straight to the repo because
          // no cron actor holds notification:send:camp.
          senderId: 'system',
          senderName: 'Camp system',
          senderRole: 'admin',
          leadersOnly: false,
          audienceEstimate: b.remaining,
          expiresAt: null,
          scheduledFor: null,
          pushSentAt: null,
          dedupeKey,
          createdAt: nowISO(),
        };
        try {
          await deps.notifications.save(notif);
          created += 1;
        } catch (err) {
          // The partial unique index on dedupe_key rejects the duplicate — that IS the
          // dedupe working, not a failure. Detect it by the real SQLSTATE (postgres.js
          // surfaces this on err.code), not by sniffing the error message: a message merely
          // MENTIONING the column (e.g. "column dedupe_key does not exist" if migration 0013
          // hasn't been applied) would otherwise be silently swallowed and misreported as a
          // successful dedupe.
          const code = (err as { code?: string })?.code;
          if (code === UNIQUE_VIOLATION) continue;
          // Any other failure must not abandon the remaining churches — this loop is the
          // only chance today's tick gets to warn them, and the caller (pg_net) is
          // fire-and-forget so nothing else observes a thrown 500.
          failed += 1;
          console.error('[cron] checkin-warning save failed', {
            userId: b.userId,
            sessionId: b.sessionId,
            err,
          });
        }
      }

      return { ok: true, checkinWarningsCreated: created, failed };
    },
  };
}

export type CronService = ReturnType<typeof makeCronService>;
