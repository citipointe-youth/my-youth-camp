import type { ID, ISODateString } from '../types/common';

/**
 * A single browser install's Web Push registration.
 *
 * Bound to `users.id` — the subscriber is always an ACCOUNT HOLDER (a leader, a church
 * login), never a camper. No minor ever has a row here.
 *
 * Multiple rows per user is expected: a church login such as `b-victory` is shared by
 * several leaders who each install it on their OWN phone. The unique key is `endpoint`,
 * not `userId`, so re-subscribing on the same device upserts rather than duplicating.
 */
export interface PushSubscription {
  id: ID;
  userId: ID;
  /** Opaque URL at the browser vendor's push service. Stored PLAINTEXT so it can carry a unique index. */
  endpoint: string;
  /** Client public key. Encrypted at rest. */
  p256dh: string;
  /** Client auth secret. Encrypted at rest. */
  auth: string;
  /** Bumped when the consent copy or trigger set changes materially, to force a re-prompt. */
  consentVersion: number;
  createdAt: ISODateString;
  lastSuccessAt?: ISODateString | null;
  lastFailureAt?: ISODateString | null;
  failureCount: number;
}
