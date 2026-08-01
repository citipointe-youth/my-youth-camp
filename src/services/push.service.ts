import webpush from 'web-push';
import type {
  IPushSubscriptionRepository,
  INotificationRepository,
} from '../repositories/interfaces/entity-repositories';
import type { PushSubscription } from '../core/entities/push-subscription';
import type { Notification } from '../core/entities/notification';
import type { User, Actor } from '../core/entities/user';
import type { CampSettings } from '../core/entities/settings';
import { canSeeNotification } from './notification-visibility';
import { nowISO } from '../utils/date';

/**
 * Web Push fan-out (design §4.3, §4.9, §5, §9.1).
 *
 * Everything in this module is INERT until the three VAPID env vars are set. That is a
 * deliberate deploy property, not a convenience: the code ships to production before the
 * keys exist, and an unconfigured deployment must do nothing at all rather than throw on
 * every tick. See `isPushConfigured`.
 */

/**
 * Wall-clock ceiling this whole module's arithmetic is built against.
 *
 * Mirrors `vercel.json`'s `maxDuration: 30` for the serverless function
 * `sendForNotifications` runs inside, invoked every 5 minutes by a pg_cron tick. Every
 * constant below (`MAX_PUSH_SENDS_PER_TICK`, `PUSH_JITTER_MS`, `PUSH_SEND_CONCURRENCY`,
 * `PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS`) exists to keep a worst-case tick comfortably under
 * THIS number, with real headroom for cold start — not flush against it. The reason this
 * matters more than an ordinary timeout: `claimForPush` sets `push_sent_at` on every claimed
 * notice BEFORE the send loop, and that claim is PERMANENT. A notice claimed but not actually
 * sent before the function is killed is never pushed and never retried — a timeout here does
 * not degrade gracefully, it silently and permanently drops real alerts.
 */
export const PUSH_TICK_BUDGET_MS = 30_000;

/**
 * Maximum push sends attempted in a single tick under the NORMAL per-tick cap.
 *
 * All 26 church logins hit their check-in window boundary at the SAME instant, so one tick
 * can generate up to 26 notices at once. The fan-out unit is the DEVICE, not the account
 * (`push_subscriptions` is keyed on `endpoint`, because several leaders share one `b-`/`g-`
 * church login and each installs it on their own phone), so ~4 leaders per church means
 * ~104 sends from those 26 notices; at 6 devices/church it is ~156.
 *
 * ⚠ HISTORICAL BUG, FIXED 2026-08-01 — this comment used to describe arithmetic the code
 * never implemented. It claimed "concurrency 10 and ~325ms/send" while the send loop was
 * actually a strictly sequential `for` loop that additionally `await`ed a random jitter sleep
 * (mean 2000ms, up to 4000ms) BEFORE EVERY SEND. A full 40-send cap under that loop cost
 * ~40 × 2325ms ≈ 93 SECONDS against the 30s ceiling — the function died around send 13 and
 * every remaining claimed-but-unsent notice in that tick was permanently swallowed (see
 * `PUSH_TICK_BUDGET_MS` above for why that failure mode is silent and unrecoverable).
 *
 * The send loop is now ACTUALLY concurrent (`PUSH_SEND_CONCURRENCY` below) and the jitter is
 * ACTUALLY a shared window rather than a per-send sequential delay (`PUSH_JITTER_MS` below),
 * so the real worst-case wall clock for a capped tick is:
 *   PUSH_JITTER_MS + ceil(MAX_PUSH_SENDS_PER_TICK / PUSH_SEND_CONCURRENCY) × ~325ms/send
 *   = 4000 + ceil(40/10) × 325 = 4000 + 1300 = ~5.3s
 * — comfortably inside `PUSH_TICK_BUDGET_MS`, with room for cold start and the DB round trips
 * around the send loop (claim, audience resolution).
 *
 * The remainder past the cap is not lost — it is simply not claimed, so the next tick picks
 * it up. The warning has a 60-minute lead window and the tick runs every 5 minutes, giving 12
 * ticks ≈ 480 sends of capacity for a ~104-send burst. See `PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS`
 * for the case a single notice's own audience exceeds this cap.
 */
export const MAX_PUSH_SENDS_PER_TICK = 40;

/**
 * How many `sendOne()` calls may be in flight at once.
 *
 * This is the piece the old block comment (see the HISTORICAL BUG note above) described but
 * the code never had — the send loop was fully sequential. A small in-module counting
 * semaphore (see `sendForNotifications`) caps concurrent outbound HTTPS calls to the push
 * services at this number; no dependency needed for a limit this small. 10 was the number the
 * original (aspirational) design comment picked, and there's no evidence it needs to be
 * higher — see `MAX_PUSH_SENDS_PER_TICK`'s worst-case arithmetic above.
 */
export const PUSH_SEND_CONCURRENCY = 10;

/**
 * Milliseconds of random delay spread across a batch (§4.8).
 *
 * Without this, 100+ devices receive their notification within the same few milliseconds and
 * every leader opens the app at once — a self-inflicted thundering herd against `/home` at
 * exactly the moment the check-in rush is starting.
 *
 * ⚠ Each send draws an INDEPENDENT random offset from this window, and — this is the part
 * that was broken before 2026-08-01 — every offset is awaited BEFORE that send competes for a
 * concurrency slot, not chained sequentially after the send ahead of it. So the wall-clock
 * cost of jitter is bounded by the WINDOW itself (`PUSH_JITTER_MS`, i.e. ≤4s), not by
 * (window × number of sends). That's what makes "spread 150 devices over 4 seconds" and
 * "finish comfortably inside 30 seconds" both true at once — see `MAX_PUSH_SENDS_PER_TICK`'s
 * worst-case arithmetic above.
 */
export const PUSH_JITTER_MS = 4000;

/**
 * Absolute ceiling on how large a SINGLE oversized notice may be pushed to when it is let
 * through the per-tick cap alone (see the forward-progress guarantee in
 * `sendForNotifications`). A backstop against a pathological audience size, NOT a normal
 * operating limit — a notice above it is deferred forever, which is the very bug the
 * forward-progress guarantee exists to fix, so it must sit well above any real camp.
 *
 * ⚠ SIZE THIS AGAINST THE REAL ACCOUNT COUNT, NOT THE CHURCH COUNT. It was first set to 200
 * on the basis of "~156 = 26 churches × 6 devices", which undercounts twice over: prod has 28
 * churches, and every church has TWO gender-scoped logins (`b-`/`g-`), so a camp-wide urgent
 * notice reaches ~56 church accounts plus zone leaders/directors/admins. At 4 devices each
 * that is ~224 sends — over the old ceiling, so the single most important notice the system
 * can send would have been silently dropped on every tick until it expired.
 *
 * 400 is set from the time budget rather than from a headcount, so it survives the camp
 * growing again: at `PUSH_SEND_CONCURRENCY` it costs
 * `PUSH_JITTER_MS + ceil(400/10) × 325ms ≈ 4000 + 13_000 = ~17s`, inside
 * `PUSH_TICK_BUDGET_MS` with headroom for cold start and the DB round trips. Anything past
 * this is a bug in audience resolution, and `sendForNotifications` logs it rather than
 * dropping it silently.
 */
export const PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS = 400;

/** Delete a subscription after this many consecutive non-fatal failures (design §4.4). */
export const PUSH_FAILURE_LIMIT = 10;

/** Prune subscriptions with no successful send in this many days (design §4.4). */
export const PUSH_STALE_DAYS = 90;

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Decoded byte length of a raw VAPID key. The public key is an uncompressed P-256 point
 * (0x04 || X || Y = 1 + 32 + 32); the private key is the 32-byte scalar.
 */
const VAPID_PUBLIC_KEY_BYTES = 65;
const VAPID_PRIVATE_KEY_BYTES = 32;
const UNCOMPRESSED_POINT_TAG = 0x04;

/** Decodes base64url, returning null for anything that isn't valid base64url. */
function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9\-_]+=*$/.test(value)) return null;
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
}

/**
 * Reads VAPID config from the environment, or null when it is not fully set OR not
 * structurally valid.
 *
 * Read at CALL time, not at module load: `api/index.ts` is a serverless entrypoint and
 * reading `process.env` into a module constant makes the value impossible to change without
 * a redeploy, and impossible to vary in tests.
 *
 * All three must be present. A partially-configured deployment is treated as unconfigured
 * rather than half-working — signing with a missing subject fails at the push service with an
 * opaque 400, which is far harder to diagnose than the feature simply being off.
 *
 * ⚠ THE SHAPE CHECKS ARE NOT DEFENSIVE PARANOIA — THEY ARE A POST-INCIDENT CONTROL.
 * On 2026-07-31 `VAPID_PUBLIC_KEY` in production held 180 characters of pasted TABLE TEXT
 * (pipes, `mailto:`, literal `\n`) rather than a key. Two things followed, both of which
 * these checks now prevent:
 *   1. `GET /push/config` served that string to every authenticated client, and it contained
 *      the VAPID PRIVATE KEY and CRON_SECRET rows. An unvalidated env var became a secret
 *      leak over the wire.
 *   2. The SPA fed it to `atob()`, so the only symptom any leader ever saw was
 *      `InvalidCharacterError` on their phone — a full deploy/retest cycle away from the
 *      actual cause.
 * A malformed value must make the feature cleanly INERT (`configured:false`, no card, no
 * sends, nothing served) and say so in the server log. It must never reach a client.
 *
 * `trim()` is applied first: a trailing newline from `vercel env add` is the single most
 * likely paste defect and is otherwise invisible.
 */
export function readPushConfig(envSource: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = (envSource['VAPID_PUBLIC_KEY'] ?? '').trim();
  const privateKey = (envSource['VAPID_PRIVATE_KEY'] ?? '').trim();
  const subject = (envSource['VAPID_SUBJECT'] ?? '').trim();
  if (!publicKey || !privateKey || !subject) return null;

  const pub = decodeBase64Url(publicKey);
  if (!pub || pub.length !== VAPID_PUBLIC_KEY_BYTES || pub[0] !== UNCOMPRESSED_POINT_TAG) {
    // Length only — NEVER log the value itself, which is exactly how the leak spread.
    console.error(
      `[push] VAPID_PUBLIC_KEY is not a valid uncompressed P-256 point (got ${publicKey.length} chars, ` +
        `${pub ? pub.length : 'un-decodable'} bytes). Push is DISABLED. Re-set the env var — a multi-line ` +
        `or table paste is the known cause.`,
    );
    return null;
  }

  const priv = decodeBase64Url(privateKey);
  if (!priv || priv.length !== VAPID_PRIVATE_KEY_BYTES) {
    console.error(
      `[push] VAPID_PRIVATE_KEY is not a valid 32-byte P-256 scalar (got ${privateKey.length} chars). ` +
        `Push is DISABLED.`,
    );
    return null;
  }

  // web-push requires a `mailto:` or `https:` subject and fails at the push service with an
  // opaque 400 otherwise — the exact "half-working" state this function exists to prevent.
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    console.error(`[push] VAPID_SUBJECT must start with "mailto:" or "https://". Push is DISABLED.`);
    return null;
  }

  return { publicKey, privateKey, subject };
}

export function isPushConfigured(envSource: NodeJS.ProcessEnv = process.env): boolean {
  return readPushConfig(envSource) !== null;
}

/**
 * Push payload templates (design §9.1, option C).
 *
 * ⚠ STRUCTURAL RULE — A SERVER-STORED `body` IS NEVER PLACED IN A PUSH PAYLOAD.
 *
 * This function does not read `notification.body`, `incident.summary`, or any person field,
 * and it must never be "improved" to do so. The reason is not the transport — a Web Push
 * payload is genuinely end-to-end encrypted under RFC 8291 and Apple/Google/Mozilla cannot
 * read it. The reason is the LOCK SCREEN: the service worker decrypts the payload and hands
 * it to the OS, which renders it on a locked phone with "Show Previews: Always" (the iOS
 * default) — legible to anyone holding the device, with no passcode and no app login.
 *
 * That would take a field this codebase deliberately encrypts at rest and deliberately hides
 * from church/first-aid accounts, and print it in plaintext on the most public surface the
 * device has. It also inverts `leadersOnly`: the ACCOUNT is a leader, but the PERSON READING
 * THE SCREEN is whoever picked the phone up.
 *
 * The check-in warning is the one deliberate exception and carries an aggregate COUNT, a
 * session label and a clock time — no name, grade, gender, or any church but the recipient's
 * own. A count is not personal data about any identifiable minor, and it is the entire
 * operational value of the alert: a bare "check-in closing" sends leaders into the app to
 * find there was nothing to do, and the alert is ignored within a day.
 *
 * There is a test asserting the payload never contains a notice's body. Keep it.
 *
 * ── 2026-07-31: the TITLE is now sent; the body rule above is unchanged ──
 *
 * The owner asked for the notice's own title on the lock screen with the detail only
 * visible after opening the app, and that is the split this file now implements: `title`
 * travels, `body` does not. The reasoning above still holds for the body — it is the field
 * that carries incident summaries and free text about named minors.
 *
 * The titles this exposes are: `Check-in closing soon` and `Incident logged · <Zone> Zone`
 * (both system-generated and fixed), plus the one-line subject a director/zone leader types
 * in the compose screen. That last one is author-controlled, so it is the one place where a
 * leader could put a camper's name on every recipient's lock screen. It is a deliberate,
 * owner-accepted trade — a notification you cannot identify is one people stop reading —
 * and it is mitigated in two places: `pushTitle()` below caps and single-lines it, and the
 * compose screen tells the author their title will be visible on locked phones.
 */
export function buildPushPayload(n: Notification): { title: string; body: string; tag: string; screen: string } {
  // Keyed on the trigger, identified structurally — a check-in warning is the only notice
  // that carries a `checkin-warn:` dedupe key, and incident alerts are the only leadersOnly
  // system notices. Never keyed on the notice's own text.
  if (n.dedupeKey && n.dedupeKey.startsWith('checkin-warn:')) {
    return {
      title: pushTitle(n.title, 'Check-in closing soon'),
      // The ONLY place a stored body is used, and only because it is an aggregate count
      // with no identifying content. See the block comment above.
      body: n.body,
      tag: 'camp-checkin',
      screen: 'checkin',
    };
  }
  if (n.leadersOnly) {
    return {
      // System-generated and deliberately coarse: `Incident logged · <Zone> Zone`
      // (incident.service.ts). The SUMMARY, which can describe a minor, stays in `body`
      // and is never sent.
      title: pushTitle(n.title, 'Camp: urgent alert'),
      body: 'Open the app to view details.',
      tag: 'camp-alert',
      screen: 'incidents',
    };
  }
  return {
    title: pushTitle(n.title, 'Camp notice'),
    body: 'Open the app to read it.',
    tag: 'camp-notice',
    // MUST be a real screen id from index.html (`<section class="screen" id="…">`).
    // This said 'notices' until 2026-07-31; there is no such screen — the SPA's Notices
    // screen is `notifs` — so _showScreen() deactivated every screen, matched nothing, and
    // tapping a notice notification opened the app on a BLANK page. There is a test
    // asserting every screen in this function is one the SPA actually has. Keep it.
    screen: 'notifs',
  };
}

/**
 * The notice's own title, safe for a lock screen.
 *
 * Trimmed, collapsed to one line (a newline in a notification title renders as a space on
 * some platforms and truncates the rest on others) and capped — iOS shows roughly the first
 * 40 characters of a title, so anything longer is decoration, and an unbounded
 * author-controlled string in an OS-rendered surface is not something to hand over on trust.
 * Falls back to the generic string when a notice somehow has no usable title.
 */
export const PUSH_TITLE_MAX = 80;

function pushTitle(raw: string | null | undefined, fallback: string): string {
  const one = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!one) return fallback;
  return one.length <= PUSH_TITLE_MAX ? one : `${one.slice(0, PUSH_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Does this notice earn a phone alert? (owner's rule, 2026-07-31)
 *
 * Normal-priority notices are IN-APP ONLY. Before this, every active notice was pushed, so
 * a routine "dinner is at 6" buzzed every leader's phone — which is the fastest way to get
 * a whole camp's leaders to turn alerts off, taking the urgent ones with them. Urgency is
 * taken from the notice's own `priority`, the same field the Notices feed styles red, so
 * what the author picks in the compose screen is exactly what happens.
 *
 * Both system triggers already set `priority: 'urgent'` (incident.service.ts,
 * cron.service.ts job B), so they are unaffected — but they are matched structurally here
 * as well, so neither can be silently demoted by a later edit to how they are created.
 *
 * ⚠ Called BEFORE `resolvePushAudience` in the cron filter, and that ordering is
 * load-bearing: a filtered-out notice is never claimed, so it stays `pushSentAt: null` and
 * is re-examined on all 288 ticks a day until it expires. That is fine for a pure predicate
 * over a field already in memory; it would not be fine after a per-user subscription lookup.
 */
export function isPushable(n: Notification): boolean {
  if (n.dedupeKey && n.dedupeKey.startsWith('checkin-warn:')) return true;
  if (n.leadersOnly) return true;
  return n.priority === 'urgent';
}

/**
 * Accounts that must never be pushed, even though they hold a valid subscription (design §4.9, D8).
 *
 * `churchLoginLocked` / `zoneLeaderLoginLocked` are the owner's post-camp control, and they
 * are read in exactly ONE place — `auth.service.login`, after the password check. They block
 * LOGIN. A push subscription is independent of any session, so without this check a
 * locked-out leader's phone keeps buzzing with camp alerts indefinitely, and the owner's
 * post-camp lock would create a false sense of closure.
 *
 * Suppressing at send time rather than deleting the row is deliberate and reversible:
 * unlocking for next camp restores alerts with no device re-subscribe and no re-consent.
 *
 * `mustChangePassword` is deliberately NOT suppressed — it blocks app use but says nothing
 * about whether the human should be alerted, and suppressing it would silently mute a leader
 * who simply has not got round to changing a temp password.
 */
export function isPushSuppressed(u: User, s: CampSettings): boolean {
  if (u.status !== 'active') return true;
  if (u.role === 'church' && s.churchLoginLocked) return true;
  if (u.role === 'zoneLeader' && s.zoneLeaderLoginLocked) return true;
  return false;
}

/**
 * The Actor shape `canSeeNotification` needs, derived from a stored User.
 *
 * `id` is load-bearing, not incidental: the targeted-notice clause matches `targetUserId`
 * against it, and that is what keeps a check-in warning going to the ONE gender-scoped
 * church login whose count it reports.
 */
function actorFromUser(u: User): Pick<Actor, 'id' | 'role' | 'zone' | 'churchId'> {
  return { id: u.id, role: u.role, zone: u.zone ?? null, churchId: u.churchId ?? null };
}

/**
 * Resolve which users should receive a notice — the INVERSE of the feed filter.
 *
 * Uses the same `canSeeNotification` predicate the in-app feed uses, deliberately. Writing a
 * second implementation of the audience rules is how you end up pushing a leader a notice
 * they cannot open, or (worse) pushing a `leadersOnly` incident to a church login whose feed
 * correctly hides it. There is ONE copy of these rules; see notification-visibility.ts.
 */
export function resolvePushAudience(
  n: Notification,
  users: User[],
  settings: CampSettings,
  nowIso: string,
): User[] {
  return users.filter(
    (u) => !isPushSuppressed(u, settings) && canSeeNotification(actorFromUser(u), n, nowIso),
  );
}

export interface PushSendResult {
  attempted: number;
  succeeded: number;
  failed: number;
  pruned: number;
  /** Sends deferred to a later tick because MAX_PUSH_SENDS_PER_TICK was reached. */
  deferred: number;
}

export interface PushServiceDeps {
  subscriptions: IPushSubscriptionRepository;
  notifications: INotificationRepository;
  /** Injected for tests; defaults to the real jittered delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Math.random. */
  random?: () => number;
  env?: NodeJS.ProcessEnv;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function makePushService(deps: PushServiceDeps) {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const envSource = deps.env ?? process.env;

  /**
   * Send one notice to one device.
   * Returns 'ok' | 'gone' (prune it) | 'fail' (count it).
   */
  async function sendOne(
    sub: PushSubscription,
    payload: ReturnType<typeof buildPushPayload>,
    cfg: PushConfig,
  ): Promise<'ok' | 'gone' | 'fail'> {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: cfg.subject,
            publicKey: cfg.publicKey,
            privateKey: cfg.privateKey,
          },
          TTL: 3600,
        },
      );
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      // 404/410 is the push service telling us this endpoint is dead. This is the STANDARD
      // self-cleaning contract and the only thing that reliably keeps the table small —
      // treat it as a normal outcome, not an error.
      if (status === 404 || status === 410) return 'gone';
      return 'fail';
    }
  }

  return {
    /**
     * Claim and push a batch of notices. Safe to call when push is unconfigured — it
     * returns a zeroed result without claiming anything, so notices are NOT burned and will
     * push normally once the VAPID keys are set.
     */
    async sendForNotifications(
      notifs: Notification[],
      users: User[],
      settings: CampSettings,
    ): Promise<PushSendResult> {
      const empty: PushSendResult = { attempted: 0, succeeded: 0, failed: 0, pruned: 0, deferred: 0 };
      const cfg = readPushConfig(envSource);
      // ⚠ Return BEFORE claiming. Claiming here would set push_sent_at on notices that were
      // never sent, and because the claim is permanent they could never be pushed later —
      // every notice created before the keys are configured would be silently swallowed.
      if (!cfg) return empty;
      if (notifs.length === 0) return empty;

      const nowIso = nowISO();

      // Build the full (notice, subscription) work list BEFORE claiming, so the cap is
      // applied to real sends and we only claim notices we are actually going to attempt.
      const perNotif: { n: Notification; subs: PushSubscription[] }[] = [];
      for (const n of notifs) {
        // Second gate, intentionally duplicating the cron filter. The caller decides WHEN to
        // push; this service decides WHAT may be pushed at all, and "a normal-priority
        // notice never buzzes a phone" is a property of the feature, not of one caller. A
        // future second caller (an admin re-send, a backfill) gets the rule for free.
        if (!isPushable(n)) continue;
        const audience = resolvePushAudience(n, users, settings, nowIso);
        if (audience.length === 0) continue;
        const subs: PushSubscription[] = [];
        for (const u of audience) {
          subs.push(...(await deps.subscriptions.findByUser(u.id)));
        }
        if (subs.length > 0) perNotif.push({ n, subs });
      }
      if (perNotif.length === 0) return empty;

      // Apply the per-tick cap at NOTICE granularity, not device granularity: a notice is
      // either fully sent this tick or fully deferred to the next. Splitting a notice's
      // devices across ticks is not possible — the claim is per-notice, so the second half
      // would be dropped, not deferred.
      const claimable: typeof perNotif = [];
      let budget = MAX_PUSH_SENDS_PER_TICK;
      let deferred = 0;
      for (const item of perNotif) {
        if (item.subs.length <= budget) {
          claimable.push(item);
          budget -= item.subs.length;
        } else {
          deferred += item.subs.length;
        }
      }

      // ⚠ FORWARD-PROGRESS GUARANTEE (defect fixed 2026-08-01). Before this, a notice whose
      // own audience exceeded MAX_PUSH_SENDS_PER_TICK failed the `<=` check above on EVERY
      // tick, forever — an urgent camp-wide notice (~26 churches × ~4 devices ≈ 104
      // subscriptions, well over the 40 cap) would be deferred 288 times a day until it
      // expired and was NEVER pushed. `claimable.length === 0` here means every notice this
      // tick individually exceeded the budget (the loop above never got to push anything) —
      // in that situation, let the single LARGEST notice through ALONE, ignoring the per-tick
      // cap. It gets a whole tick to itself. This is safe specifically because the send loop
      // below has real bounded concurrency now (`PUSH_SEND_CONCURRENCY`) — see
      // `PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS` for why even this has a ceiling, and why a
      // notice past THAT ceiling stays deferred rather than risk the 30s budget.
      if (claimable.length === 0 && perNotif.length > 0) {
        const largest = perNotif.reduce((a, b) => (b.subs.length > a.subs.length ? b : a));
        if (largest.subs.length <= PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS) {
          claimable.push(largest);
          // `deferred` above already summed every item in perNotif (nothing was claimable),
          // so un-defer exactly the one we are now claiming — keeps the count truthful.
          deferred -= largest.subs.length;
        } else {
          // Past the backstop, so it stays deferred — i.e. it will never be sent. That is the
          // original starvation bug surviving at a higher threshold, and the thing that made
          // the original so hard to find was that it was SILENT: `deferred` is counted but
          // nothing surfaces it. Say so in the runtime log, naming the notice and the size,
          // so this shows up as a line to read rather than as an alert that never arrived.
          // No `body`/`title` in the log line — see the lock-screen rule above.
          console.error(
            `[push] notice ${largest.n.id} has ${largest.subs.length} subscriptions, over the ` +
              `PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS ceiling of ` +
              `${PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS} — NOT SENT. Audience resolution is ` +
              `probably wrong, or the camp has outgrown the ceiling.`,
          );
        }
      }
      if (claimable.length === 0) return { ...empty, deferred };

      // Atomic claim — only the ids actually returned get pushed, so two overlapping ticks
      // get disjoint sets and nothing is ever pushed twice (design §5, layer 1).
      const claimedIds = new Set(await deps.notifications.claimForPush(claimable.map((c) => c.n.id)));

      let attempted = 0;
      let succeeded = 0;
      let failed = 0;
      let pruned = 0;

      // Flatten to one send task per (notice, device) pair up front. This is what lets the
      // jitter window and the concurrency limit act on the whole batch at once instead of
      // notice-by-notice — see the timing arithmetic on MAX_PUSH_SENDS_PER_TICK above.
      interface SendTask {
        sub: PushSubscription;
        payload: ReturnType<typeof buildPushPayload>;
      }
      const tasks: SendTask[] = [];
      for (const item of claimable) {
        if (!claimedIds.has(item.n.id)) continue; // another tick got it
        const payload = buildPushPayload(item.n);
        for (const sub of item.subs) tasks.push({ sub, payload });
      }

      // A tiny counting semaphore — bounds concurrent `sendOne()` calls to
      // PUSH_SEND_CONCURRENCY without pulling in a dependency for a limit this small.
      let activeSends = 0;
      const waiters: Array<() => void> = [];
      async function acquireSendSlot(): Promise<void> {
        if (activeSends < PUSH_SEND_CONCURRENCY) {
          activeSends += 1;
          return;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
        activeSends += 1;
      }
      function releaseSendSlot(): void {
        activeSends -= 1;
        const next = waiters.shift();
        if (next) next();
      }

      await Promise.all(
        tasks.map(async (task) => {
          // §4.8 jitter — see PUSH_JITTER_MS. Awaited BEFORE queueing for a concurrency slot,
          // deliberately: every task's random wait runs in PARALLEL with every other task's,
          // so the total jitter cost is bounded by the window itself, not by task count × window.
          await sleep(Math.floor(random() * PUSH_JITTER_MS));
          await acquireSendSlot();
          try {
            attempted += 1;
            const outcome = await sendOne(task.sub, task.payload, cfg);
            if (outcome === 'ok') {
              succeeded += 1;
              await deps.subscriptions.save({
                ...task.sub,
                lastSuccessAt: nowISO(),
                failureCount: 0,
              });
            } else if (outcome === 'gone') {
              pruned += 1;
              await deps.subscriptions.deleteByEndpoint(task.sub.endpoint);
            } else {
              failed += 1;
              const nextCount = task.sub.failureCount + 1;
              if (nextCount >= PUSH_FAILURE_LIMIT) {
                pruned += 1;
                await deps.subscriptions.deleteByEndpoint(task.sub.endpoint);
              } else {
                await deps.subscriptions.save({
                  ...task.sub,
                  lastFailureAt: nowISO(),
                  failureCount: nextCount,
                });
              }
            }
          } finally {
            releaseSendSlot();
          }
        }),
      );

      return { attempted, succeeded, failed, pruned, deferred };
    },

    /**
     * Send a self-test alert to the CALLING account's own devices (no notice, no claim).
     *
     * Exists because the two real triggers are both hard to exercise on purpose: an incident
     * alert means logging a fake incident against real people, and the check-in warning only
     * fires inside a lead window, on a camp day, with a church genuinely behind on check-ins
     * — you cannot reproduce that in July to prove a leader's phone is wired up correctly.
     *
     * `kind: 'checkin'` deliberately reuses the check-in warning's exact shape — same title
     * wording, same `screen: 'checkin'` deep link, same `tag` — so it verifies the whole
     * chain the real alert uses (VAPID signature → APNs/FCM → sw.js push handler →
     * notificationclick → the SPA landing on the right screen). What it does NOT verify is
     * `churchesBehind` deciding WHO is behind; it proves delivery, not the arithmetic.
     *
     * Only ever sends to `userId`'s own rows, so it is not a channel for messaging anyone
     * else, and it writes nothing to the notifications table.
     */
    async sendTestToUser(
      userId: string,
      kind: 'checkin' | 'notice' = 'checkin',
    ): Promise<{ sent: number; failed: number; pruned: number; configured: boolean }> {
      const cfg = readPushConfig(envSource);
      if (!cfg) return { sent: 0, failed: 0, pruned: 0, configured: false };

      const payload =
        kind === 'checkin'
          ? {
              title: 'Check-in closing soon',
              body: 'Test alert — 3 students still to check in.',
              tag: 'camp-checkin',
              screen: 'checkin',
            }
          : {
              title: 'Test alert',
              body: 'Open the app to read it.',
              tag: 'camp-notice',
              screen: 'notifs',
            };

      const subs = await deps.subscriptions.findByUser(userId);
      let sent = 0;
      let failed = 0;
      let pruned = 0;
      for (const sub of subs) {
        const outcome = await sendOne(sub, payload, cfg);
        if (outcome === 'ok') {
          sent += 1;
          await deps.subscriptions.save({ ...sub, lastSuccessAt: nowISO(), failureCount: 0 });
        } else if (outcome === 'gone') {
          pruned += 1;
          await deps.subscriptions.deleteByEndpoint(sub.endpoint);
        } else {
          // A failed TEST must not count towards the pruning limit — the whole point of the
          // button is that a leader taps it repeatedly while debugging their own phone, and
          // ten taps would otherwise delete a subscription that is merely temporarily
          // unreachable. Real sends still count; see sendForNotifications.
          failed += 1;
        }
      }
      return { sent, failed, pruned, configured: true };
    },

    /**
     * Delete subscriptions with no successful send in PUSH_STALE_DAYS — bounded retention
     * for endpoints that are dead but never return 404/410. Returns the number deleted.
     */
    async pruneStale(): Promise<number> {
      const all = await deps.subscriptions.findAll();
      const cutoff = Date.now() - PUSH_STALE_DAYS * 24 * 60 * 60 * 1000;
      let removed = 0;
      for (const s of all) {
        // Never successful → judge by createdAt, so a subscription that never worked is
        // still eventually reclaimed.
        const marker = s.lastSuccessAt ?? s.createdAt;
        if (new Date(marker).getTime() < cutoff) {
          await deps.subscriptions.deleteByEndpoint(s.endpoint);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export type PushService = ReturnType<typeof makePushService>;
