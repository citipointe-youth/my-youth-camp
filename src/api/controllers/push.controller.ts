import { z } from 'zod';
import type { HttpRequest } from '../http/types';
import { readPushConfig, type PushService } from '../../services/push.service';
import { PUSH_CONSENT_VERSION, type PushSubscriptionService } from '../../services/push-subscription.service';
import { UnauthorizedError } from '../../core/errors/app-error';

const TestSchema = z.object({
  kind: z.enum(['checkin', 'notice']).nullish(),
});

export interface PushControllerServices {
  subscriptions: PushSubscriptionService;
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

    async subscribe(req: HttpRequest) {
      const actor = req.ctx?.actor;
      if (!actor) throw new UnauthorizedError();
      return services.subscriptions.subscribe(actor, req.body);
    },

    async label(req: HttpRequest) {
      if (!req.ctx?.actor) throw new UnauthorizedError();
      return services.subscriptions.label(req.body);
    },

    async devices(req: HttpRequest) {
      const actor = req.ctx?.actor;
      if (!actor) throw new UnauthorizedError();
      return services.subscriptions.devices(actor);
    },

    async unsubscribe(req: HttpRequest) {
      if (!req.ctx?.actor) throw new UnauthorizedError();
      return services.subscriptions.unsubscribe(req.body);
    },

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
  };
}
