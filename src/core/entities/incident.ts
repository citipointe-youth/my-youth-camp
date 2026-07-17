import type { ID, ISODateString } from '../types/common';
import type { IncidentSeverity, UserRole } from '../types/enums';

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
  /** Optional zone the incident relates to (defaults to the logging leader's zone). */
  zone?: string | null;
  /** Server timestamp. */
  createdAt: ISODateString;
}
