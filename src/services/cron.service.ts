import type {
  INotificationRepository,
  IPersonRepository,
  IUserRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Notification } from '../core/entities/notification';
import { churchesBehind, churchesBehindFor, testWarnWindow, warnWindow } from './checkin-warnings';
import { assertCan } from './access-control';
import { BadRequestError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';
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

    /**
     * Admin "send a test check-in warning" (owner request, 2026-07-31).
     *
     * Job B's four gate conditions — restriction on, a camp day, inside a window, ≤60
     * minutes left — all have to be true at once, which means the check-in warning is
     * unrehearsable outside camp: the first time anyone sees it work is the morning it has
     * to work. This runs the REAL pipeline with only the timing gate replaced.
     *
     * What is genuinely exercised: `churchesBehindFor` (the actual per-login counting rule),
     * notice creation, `canSeeNotification` audience resolution, the claim, and the web-push
     * fan-out. What is NOT: `warnWindow` itself — see `testWarnWindow` for the session it
     * substitutes.
     *
     * Three deliberate differences from a real warning, each of which is a lie-avoidance
     * measure rather than a shortcut:
     *
     *  - the title says "(test)". These land in real church accounts' Notices feeds, and an
     *    alert that looks identical to the real thing, out of camp season, is how a leader
     *    learns to distrust the alert that matters.
     *  - `includeZero` is on, so every active church login is included even at zero
     *    outstanding. Production must never say "0 students still to check in"; a test that
     *    silently sent nothing because everyone is checked in would read as a broken button.
     *  - the dedupe key carries the run's timestamp, so the button is repeatable and can
     *    never collide with — or consume — a REAL warning's `checkin-warn:<session>:<user>`
     *    key. A test that burned the real dedupe key would suppress the genuine warning for
     *    that session.
     *
     * The triggering admin also gets a copy addressed to them. Without it the button is
     * unobservable to the person pressing it: real warnings are `targetUserId`-scoped to
     * church logins, so an admin's own phone would stay silent no matter how well it worked.
     */
    async testCheckinWarnings(actor: Actor): Promise<CheckinWarningTestResult> {
      assertCan(actor, 'admin:manage');

      const settings = await deps.settings.getSingleton();
      if (!settings) throw new BadRequestError('Camp settings are not set up yet');

      const now = new Date();
      const gate = testWarnWindow(settings, now);
      if (!gate) {
        throw new BadRequestError(
          'No check-in days are set for this camp, so there is no session to test against.',
        );
      }

      const [people, users] = await Promise.all([deps.people.findAll(), deps.users.findAll()]);
      const behind = churchesBehindFor(people, users, gate, { includeZero: true });

      const runKey = `test-${now.getTime()}`;
      const made: Notification[] = [];

      for (const b of behind) {
        const n: Notification = {
          id: newId('notif'),
          scope: 'church',
          zone: null,
          churchId: b.churchId,
          priority: 'urgent',
          title: 'Check-in closing soon (test)',
          body: `${b.remaining} student${b.remaining === 1 ? '' : 's'} still to check in — the ${b.sessionLabel} window closes at ${b.windowEnd}. This is a test.`,
          senderId: 'system',
          senderName: 'Camp system',
          senderRole: 'admin',
          leadersOnly: false,
          audienceEstimate: b.remaining,
          expiresAt: b.windowEndAt,
          scheduledFor: null,
          pushSentAt: null,
          // Unique per run — repeatable, and it can never collide with a real warning's key.
          dedupeKey: `checkin-warn:${runKey}:${b.userId}`,
          targetUserId: b.userId,
          createdAt: nowISO(),
        };
        made.push(n);
      }

      // The admin's own copy — the only part of this they can observe on their own device.
      made.push({
        id: newId('notif'),
        scope: 'camp',
        zone: null,
        churchId: null,
        priority: 'urgent',
        title: 'Check-in closing soon (test)',
        body: `Test check-in warning sent to ${behind.length} church login${behind.length === 1 ? '' : 's'} for ${gate.session.label}. This is a test.`,
        senderId: 'system',
        senderName: 'Camp system',
        senderRole: 'admin',
        leadersOnly: false,
        audienceEstimate: behind.length,
        expiresAt: gate.windowEndAt,
        scheduledFor: null,
        pushSentAt: null,
        dedupeKey: `checkin-warn:${runKey}:${actor.id}`,
        targetUserId: actor.id,
        createdAt: nowISO(),
      });

      let createdCount = 0;
      let failedCount = 0;
      for (const n of made) {
        try {
          await deps.notifications.save(n);
          createdCount += 1;
        } catch (err) {
          failedCount += 1;
          console.error('[cron] test checkin-warning save failed', { id: n.id, err });
        }
      }

      // Push inline rather than waiting up to 5 minutes for the next tick — the whole point
      // of a test button is a result you can see now. The tick would pick these up anyway if
      // this fails, because an unpushed notice stays unclaimed.
      let pushAttempted = 0;
      let pushSucceeded = 0;
      let pushConfigured = false;
      if (deps.push && isPushConfigured()) {
        pushConfigured = true;
        try {
          const res = await deps.push.sendForNotifications(made, users, settings);
          pushAttempted = res.attempted;
          pushSucceeded = res.succeeded;
        } catch (err) {
          console.error('[cron] test checkin-warning push failed', { err });
        }
      }

      return {
        ok: true,
        sessionLabel: gate.session.label,
        windowEnd: gate.windowEnd,
        churches: behind.length,
        // Churches genuinely behind, i.e. what a REAL warning would have sent. Reported
        // separately so a test that reached 12 logins but found 0 outstanding students
        // cannot be mistaken for proof that the counting works.
        churchesWithOutstanding: behind.filter((b) => b.remaining > 0).length,
        created: createdCount,
        failed: failedCount,
        pushConfigured,
        pushAttempted,
        pushSucceeded,
      };
    },
  };
}

export interface CheckinWarningTestResult {
  ok: true;
  sessionLabel: string;
  windowEnd: string;
  churches: number;
  churchesWithOutstanding: number;
  created: number;
  failed: number;
  pushConfigured: boolean;
  pushAttempted: number;
  pushSucceeded: number;
}

export type CronService = ReturnType<typeof makeCronService>;
