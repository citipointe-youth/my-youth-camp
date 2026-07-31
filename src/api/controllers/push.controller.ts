import { z } from 'zod';
import type { HttpRequest } from '../http/types';
import type { IPushSubscriptionRepository } from '../../repositories/interfaces/entity-repositories';
import { readPushConfig, type PushService } from '../../services/push.service';
import { UnauthorizedError } from '../../core/errors/app-error';
import { newId } from '../../utils/id';
import { nowISO } from '../../utils/date';

/**
 * Consent version. Bump ONLY when the consent copy or the set of triggers changes
 * materially — it is stored per subscription so a future release can identify devices that
 * consented under older wording and re-prompt them.
 */
export const PUSH_CONSENT_VERSION = 1;

/**
 * `.nullish()` rather than `.optional()` throughout, per the standing repo rule: the SPA
 * sends explicit nulls and Zod's `.optional()` REJECTS an explicit null, surfacing as a
 * "Validation failed" toast (this has already bitten the repo once — item 19, 2026-07-28).
 */
const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  keyId: z.string().max(100).nullish(),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

const TestSchema = z.object({
  kind: z.enum(['checkin', 'notice']).nullish(),
});

export interface PushControllerServices {
  subscriptions: IPushSubscriptionRepository;
  /**
   * Optional so every existing wiring (and the controller tests) still constructs without
   * a push service; POST /push/test then reports `configured: false` instead of throwing.
   */
  push?: Pick<PushService, 'sendTestToUser'>;
}

export function makePushController(services: PushControllerServices) {
  return {
    /**
     * GET /push/config — the VAPID public key the client subscribes with.
     *
     * Served rather than baked into `index.html` so rotating the keypair does not require
     * an SPA rebuild and an `sw.js` bump. `keyId` lets the client notice it subscribed
     * under a superseded key and re-subscribe (a subscription is bound to the
     * `applicationServerKey` it was created with; pushes signed by a different key are
     * rejected).
     *
     * Returns `configured: false` rather than erroring when VAPID is unset. That is the
     * production state until the keys are added, and the SPA uses it to hide the opt-in
     * card entirely — a 500 here would surface as a scary toast on every home render.
     */
    async config(_req: HttpRequest) {
      const cfg = readPushConfig();
      if (!cfg) return { configured: false, publicKey: null, keyId: null };
      return {
        configured: true,
        publicKey: cfg.publicKey,
        // Short stable fingerprint of the active key — NOT the key itself.
        keyId: cfg.publicKey.slice(0, 8),
        consentVersion: PUSH_CONSENT_VERSION,
      };
    },

    /**
     * POST /push/subscribe — register this device for the CALLING account.
     *
     * The account is taken from the session, never from the body: letting a client name the
     * user id would let any authenticated leader register a device against the director's
     * account and receive leadersOnly safeguarding alerts.
     *
     * Upserts on `endpoint` (the unique key), because re-subscribing on the same device
     * produces the same endpoint. Several leaders sharing one `b-`/`g-` church login each
     * get their OWN row — the fan-out unit is the device, not the account.
     */
    async subscribe(req: HttpRequest) {
      const actor = req.ctx?.actor;
      if (!actor) throw new UnauthorizedError();
      const data = SubscribeSchema.parse(req.body);

      const existing = await services.subscriptions.findByEndpoint(data.endpoint);
      const row = {
        id: existing?.id ?? newId('push'),
        userId: actor.id,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        consentVersion: PUSH_CONSENT_VERSION,
        createdAt: existing?.createdAt ?? nowISO(),
        lastSuccessAt: existing?.lastSuccessAt ?? null,
        lastFailureAt: existing?.lastFailureAt ?? null,
        // Re-subscribing is a fresh start — a device that failed 9 times and has just
        // re-registered must not be pruned on its next hiccup.
        failureCount: 0,
      };
      await services.subscriptions.save(row);
      return { ok: true as const };
    },

    /**
     * DELETE /push/subscribe — turn alerts off for this device.
     *
     * Deliberately keyed on the endpoint alone and not scoped to the calling account. An
     * endpoint is an unguessable opaque URL held only by the device that owns it, and the
     * failure this protects against (a leader unable to turn off alerts because the row is
     * attached to an account they have since been moved off) is worse than the non-threat
     * of someone who already has your endpoint unsubscribing you. This is also what makes
     * "delete my device registration" a one-row operation for data-subject requests.
     */
    /**
     * POST /push/test — send a test alert to the CALLING account's own devices.
     *
     * The user id comes from the session and is never accepted from the body, for the same
     * reason as `subscribe`: a body-supplied id would turn this into "send an arbitrary
     * push to any account", which is a spoofing primitive (the payload renders as a genuine
     * camp alert on a locked phone). With the session id it can only ever reach devices the
     * caller has already opted in on, which is why it needs no extra permission beyond a
     * valid login — a leader testing their own phone is not a privileged action.
     *
     * Not rate-limited at the app layer: the reachable blast radius is the caller's own
     * handful of devices, and the push services throttle abusive senders themselves.
     */
    async test(req: HttpRequest) {
      const actor = req.ctx?.actor;
      if (!actor) throw new UnauthorizedError();
      const data = TestSchema.parse(req.body ?? {});
      if (!services.push) return { ok: true as const, configured: false, sent: 0, failed: 0 };
      const res = await services.push.sendTestToUser(actor.id, data.kind ?? 'checkin');
      // `sent: 0, configured: true` is the interesting case and the SPA words it plainly:
      // the account holds no subscription on any device (alerts were never turned on, or
      // were turned on somewhere else).
      return { ok: true as const, ...res };
    },

    async unsubscribe(req: HttpRequest) {
      const actor = req.ctx?.actor;
      if (!actor) throw new UnauthorizedError();
      const data = UnsubscribeSchema.parse(req.body);
      const removed = await services.subscriptions.deleteByEndpoint(data.endpoint);
      return { ok: true as const, removed };
    },
  };
}
