import type { ID, ISODateString } from '../types/common';

/**
 * A persistent record that a person's church was set MANUALLY by an admin/director,
 * overriding whatever the Form CSV says. Re-applied by the Form importer at
 * church-resolution time (keyed by the person's name + mobile identity, since the CSV
 * carries no stable id), so a manual allocation survives re-imports and the delete-absent
 * sweep. Purged by reset / new-year (transient per-season data).
 */
export interface AllocationOverride {
  id: ID;
  /** Current person pointer — stable within a season because the import redirect keeps the row matched to this record. */
  personId: ID;
  /** Normalized identity used to re-apply on re-import (the CSV has no person id). */
  firstNameKey: string;
  lastNameKey: string;
  /** Normalized mobile digits; '' when the person had no mobile. Disambiguates duplicate names. */
  mobileKey: string;
  assignedChurchId: ID;
  assignedChurchName: string;
  /** What the form said — the OTHER literal (unallocated) or the wrong church name (override). Powers the "differs from forms" list + undo. */
  formChurch: string;
  kind: 'unallocated' | 'override';
  /** churchUnlistedNote snapshot for display. */
  note: string | null;
  /** actor.displayName who made the allocation. */
  createdBy: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
