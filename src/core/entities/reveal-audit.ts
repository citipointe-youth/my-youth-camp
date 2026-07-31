import type { ID, ISODateString } from '../types/common';
import type { UserRole } from '../types/enums';

/**
 * What kind of masked value was revealed. Both go through an authenticated, access-checked
 * endpoint; both are sensitive enough that the owner wants a durable record of WHO looked.
 */
export type RevealKind = 'medicare' | 'parent-contact' | 'leader-contact';

/**
 * A record that someone revealed a masked sensitive value for a person (2026-07-31).
 *
 * ⚠️ **THE REVEALED VALUE IS NEVER STORED.** Not the Medicare number, not the phone number,
 * not a fragment of either. The whole point of masking those fields — and of encrypting them
 * at rest — is defeated the moment an audit table keeps a plaintext copy of every one that was
 * ever looked at. This entity records only that a reveal HAPPENED: who did it, whose record it
 * was, what kind of value, and when.
 *
 * The student's name IS denormalised onto the row on purpose. The audit has to stay readable
 * after a new-year rollover deletes the person, and re-joining to `people` would make the export
 * depend on data the rollover is designed to destroy.
 *
 * Append-only. There is no update path and no delete path other than the full reset/new-year
 * wipe, which clears it along with every other log.
 */
export interface RevealAudit {
  id: ID;
  kind: RevealKind;
  /** The person whose record was revealed. Kept even after that person is deleted. */
  personId: ID;
  personName: string;
  /** Denormalised so the export reads correctly after a rollover. */
  churchName: string;
  /** The LOGIN that performed the reveal. */
  actorId: ID;
  actorUsername: string;
  actorRole: UserRole;
  /**
   * The acting leader's initials, when the session has them (church accounts prompt for these
   * at login). Empty for roles that never set initials — the account is still identified by
   * `actorUsername`, this narrows it to a person when several leaders share one login.
   */
  actorInitials: string;
  /** For a contact reveal, which contact slot (e.g. `male-primary`). Null for medicare. */
  contactRole: string | null;
  createdAt: ISODateString;
}
