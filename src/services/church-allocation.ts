import type { AllocationOverride } from '../core/entities/allocation-override';
import type { AccommodationKind, PersonKind } from '../core/types/enums';

/** Reserved sentinel church for registrants with no church yet. NOT a churches-table row. */
export const UNALLOCATED_CHURCH_ID = '__unallocated__';
export const UNALLOCATED_CHURCH_NAME = 'Unallocated';

/** The exact "Attendee's Church" value produced when a registrant picks the OTHER option (lower-cased). */
export const OTHER_CHURCH_LITERAL = 'other - please specify below';

/** True when the church cell means "no listed church" — the OTHER literal or blank. */
export function isUnlistedChurchCell(cell: string): boolean {
  const v = cell.trim().toLowerCase();
  return v === '' || v === OTHER_CHURCH_LITERAL;
}

export function overrideNameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}::${last.trim().toLowerCase()}`;
}

export function overrideMobileKey(mobile: string | null | undefined): string {
  return (mobile ?? '').replace(/\D/g, '');
}

/**
 * Pick the override that applies to a CSV row from the candidates sharing the row's name key.
 * - A candidate with a mobileKey matches only when the row's mobile matches it.
 * - A candidate without a mobileKey matches only a row that also has no mobile.
 * Exactly one match → that override; zero matches → null; >1 → 'ambiguous' (skip, don't guess).
 */
export function matchOverride(
  candidates: AllocationOverride[],
  rowMobileKey: string,
): AllocationOverride | 'ambiguous' | null {
  if (candidates.length === 0) return null;
  const matches = candidates.filter((c) => (c.mobileKey ? c.mobileKey === rowMobileKey : rowMobileKey === ''));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) return null;
  return 'ambiguous';
}

/**
 * The accommodation kind a person should have once placed in a church. Mirrors the Form
 * importer's rule (church accommodation override forces STUDENTS/youth; leaders keep their
 * value). Shared so import-time and allocate-time never diverge.
 */
export function accommodationKindForChurch(
  personKind: PersonKind,
  currentKind: AccommodationKind | null | undefined,
  churchOverride: AccommodationKind | null | undefined,
): AccommodationKind | null {
  if (personKind === 'youth' && churchOverride) return churchOverride;
  return currentKind ?? null;
}
