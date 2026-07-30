import type { ID, ISODateString } from '../types/common';
import type { IncidentSeverity, UserRole, ZoneName } from '../types/enums';

/**
 * A safeguarding / operational incident logged during camp (Feature 3, 2026-07-17).
 * `summary` is free text that can describe a minor, so it is CHILD-SAFETY DATA and is
 * ENCRYPTED AT REST in the Supabase mapper (`supabase.incidents.ts`), exactly like
 * `notes.body`. Append-only — only admin/director may delete. A 'high' severity incident
 * additionally raises a camp-wide notification to all leaders/directors/admins.
 */
export interface Incident {
  id: ID;
  /** Free-text description of what happened. Encrypted at rest (see rule 7). */
  summary: string;
  severity: IncidentSeverity;
  /** Actor who logged the incident, captured at write time. */
  createdById: ID;
  createdByName: string;
  createdByRole: UserRole;
  /**
   * Optional zone the incident relates to (defaults to the logging leader's zone). Constrained
   * to the four real zone names since 2026-07-30 — a free-text typo mis-filed the record.
   */
  zone?: ZoneName | null;
  /** Server timestamp — when the incident was LOGGED. */
  createdAt: ISODateString;
  /**
   * OPTIONAL: when the incident actually happened, if the logger recorded it. Null/absent is a
   * completely valid incident — the field was added 2026-07-30 (migration 0019) and every row
   * written before then has none.
   */
  occurredAt?: ISODateString | null;
}
