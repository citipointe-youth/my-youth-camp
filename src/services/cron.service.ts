import type {
  INotificationRepository,
  IPersonRepository,
  IUserRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import { churchesBehind, warnWindow } from './checkin-warnings';
import { isPushConfigured, isPushable, type PushService } from './push.service';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';

export interface TickResult {
  ok: true;
  checkinWarningsCreated: number;
  failed: number;
  /** Push sends attempted this tick. 0 whenever VAPID is unconfigured (the feature is off). */
  pushAttempted: number;
  pushSucceeded: number;
  /** Sends left for the next tick by MAX_PUSH_SENDS_PER_TICK. */
  pushDeferred: number;
}

/** postgres.js SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

export interface CronServiceDeps {
  notifications: INotificationRepository;
  people: IPersonRepository;
  users: IUserRepository;
  settings: ISettingsRepository;
  /**
   * Job C — the web-push fan-out. Optional so the tick still runs (and still creates the
   * in-app notices, which are the guaranteed channel) in any wiring that has no push
   * service. When present but VAPID is unconfigured, the service itself no-ops WITHOUT
   * claiming, so nothing is burned before the keys are set.
   */
  push?: PushService;
}

/** An idle tick's result — no warnings, no pushes. */
const IDLE: TickResult = {
  ok: true,
  checkinWarningsCreated: 0,
  failed: 0,
  pushAttempted: 0,
  pushSucceeded: 0,
  pushDeferred: 0,
};

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
      if (!settings) return IDLE;

      if (!settings.timezone) {
        // zonedNow silently falls back to the HOST's zone, which on Vercel is UTC — that
        // would resolve yesterday's camp day for 10 hours of every day. Warn loudly.
        console.warn('[cron] settings.timezone is empty; check-in warnings may target the wrong day');
      }

      // Capture the clock ONCE. warnWindow is a cheap settings-only check — an idle tick
      // (off a camp day, outside the lead window, restriction off) skips job B without
      // ever touching the people table (~10 AES field decrypts per person, ~288 ticks/day).
      const now = new Date();
      const inWarnWindow = warnWindow(settings, now);

      // ── Job B — create the in-app check-in-closing notices ──────────────────────────
      let created = 0;
      let failed = 0;
      let users: Awaited<ReturnType<typeof deps.users.findAll>> = [];

      if (inWarnWindow) {
        const [people, allUsers] = await Promise.all([deps.people.findAll(), deps.users.findAll()]);
        users = allUsers;
        const behind = churchesBehind(settings, people, users, now);
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
          // Expires the moment the window it is warning about closes. Two reasons this is not
          // optional: (1) once the window shuts the notice is unactionable, and a stale URGENT
          // notice is worse than none; (2) nothing ever cleans these up otherwise — over a camp
          // this is hundreds of permanent rows, the Notices screen deletes one at a time, and
          // the bulk "Clear all notifications" button was removed on 2026-07-29. `findActive()`
          // already filters on expiresAt, so this is the whole of the cleanup.
          // The dedupe_key row survives expiry, so an expired notice is never re-created.
          expiresAt: b.windowEndAt,
          scheduledFor: null,
          pushSentAt: null,
          dedupeKey,
          // Addressed to the ONE login whose count this is — see the entity comment and
          // canSeeNotification. Church scope alone would show a gender-scoped b-/g- pair each
          // other's numbers, and would flood every admin and director with all of them.
          targetUserId: b.userId,
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
      }

      // ── Job C — web-push fan-out ────────────────────────────────────────────────────
      //
      // Runs on EVERY tick, not only ticks that created a warning. Three things need
      // picking up that job B knows nothing about: an incident alert raised inline between
      // ticks, a scheduled notice that has just reached its publish time, and — the reason
      // this must not be gated on `created > 0` — sends DEFERRED by the per-tick cap, which
      // by definition happen on a tick that created nothing new.
      //
      // Cheap when off: with no push service wired, or VAPID unconfigured, this costs one
      // env read and touches no table. That matters at 288 ticks/day, and it is the state
      // production is in until the VAPID keys are set.
      let pushAttempted = 0;
      let pushSucceeded = 0;
      let pushDeferred = 0;

      if (deps.push && isPushConfigured()) {
        try {
          // Only notices that are live AND not yet claimed. `findActive()` already applies
          // the expiry filter, so an expired warning is never pushed late — which is the
          // whole point of giving them an expiry.
          const active = await deps.notifications.findActive();
          // `isPushable` is the normal-vs-urgent gate (owner's rule, 2026-07-31): normal
          // notices are in-app only and never buzz a phone. Applied HERE, before any
          // per-user subscription lookup — see the note on isPushable about why the
          // ordering matters. A filtered-out notice is never claimed, so flipping the rule
          // back later would deliver it, not swallow it.
          const unpushed = active.filter((n) => n.pushSentAt == null && isPushable(n));
          if (unpushed.length > 0) {
            // Job B only loads users inside the warn window; job C needs them regardless.
            if (users.length === 0) users = await deps.users.findAll();
            const res = await deps.push.sendForNotifications(unpushed, users, settings);
            pushAttempted = res.attempted;
            pushSucceeded = res.succeeded;
            pushDeferred = res.deferred;
          }
        } catch (err) {
          // A push failure must never fail the tick — the in-app notice is the guaranteed
          // channel and job B has already committed it. pg_net is fire-and-forget, so a
          // thrown error here would be invisible anyway.
          console.error('[cron] push fan-out failed', { err });
        }
      }

      return {
        ok: true,
        checkinWarningsCreated: created,
        failed,
        pushAttempted,
        pushSucceeded,
        pushDeferred,
      };
    },
  };
}

export type CronService = ReturnType<typeof makeCronService>;
