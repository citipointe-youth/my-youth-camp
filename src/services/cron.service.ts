import type {
  INotificationRepository,
  IPersonRepository,
  IUserRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import { churchesBehind } from './checkin-warnings';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';

export interface TickResult {
  ok: true;
  checkinWarningsCreated: number;
}

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
      if (!settings) return { ok: true, checkinWarningsCreated: 0 };

      if (!settings.timezone) {
        // zonedNow silently falls back to the HOST's zone, which on Vercel is UTC — that
        // would resolve yesterday's camp day for 10 hours of every day. Warn loudly.
        console.warn('[cron] settings.timezone is empty; check-in warnings may target the wrong day');
      }

      const [people, users] = await Promise.all([deps.people.findAll(), deps.users.findAll()]);
      const behind = churchesBehind(settings, people, users, new Date());
      if (behind.length === 0) return { ok: true, checkinWarningsCreated: 0 };

      let created = 0;
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
          // dedupe working, not a failure. Swallow and continue.
          const msg = err instanceof Error ? err.message : String(err);
          if (!/dedupe_key/i.test(msg)) throw err;
        }
      }

      return { ok: true, checkinWarningsCreated: created };
    },
  };
}

export type CronService = ReturnType<typeof makeCronService>;
