import type { ID, ISODateString } from '../types/common';

/**
 * Coarse phone type, reported by the SPA at subscribe time (2026-09-22, migration 0027).
 * Deliberately a short fixed list, never the raw User-Agent — the UA is a fingerprint and the
 * admin's delivery screen only needs to say "iPhone". Rows created before 0027 carry null
 * until that phone next opens the app (POST /push/label back-fills it).
 */
export const PUSH_DEVICE_LABELS = ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Other'] as const;
export type PushDeviceLabel = (typeof PUSH_DEVICE_LABELS)[number];

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
  /** See PUSH_DEVICE_LABELS. Optional so every pre-existing construction site still compiles. */
  deviceLabel?: PushDeviceLabel | null;
}
