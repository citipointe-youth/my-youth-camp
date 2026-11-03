import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import { isCamper } from '../../core/entities/person';
import { maskPhone } from '../../utils/mask';

/**
 * The JSON shape /registrants returns — the SPA's pre-camp My Youth screen reads
 * these fields bare. Keep these names stable.
 *
 * PRIVACY RULE (audit 2026-07-19): the LIST/BULK DTOs (`RegistrantDto`/`CamperDto`)
 * must NEVER carry `medicareNumber` or `dateOfBirth` — they are mapped over entire
 * rosters and would ship every minor's medicare number + DOB to every login.
 * `hasMedicare` is a boolean so the UI can show a "tap to reveal" affordance; the
 * cleartext number is returned ONLY by the audited POST /campers/:id/reveal-medicare.
 * The access-checked single-person DETAIL DTOs below may add `dateOfBirth` back.
 */
export interface RegistrantDto {
  id: string;
  firstName: string;
  lastName: string;
  kind: 'camper' | 'leader';
  paymentStatus: Person['paymentStatus'];
  blueCardCollected: boolean;
  churchId: string;
  churchName: string;
  zone: string;
  status: 'registered' | 'cancelled';
  grade: Person['grade'];
  accommodationKind: Person['accommodationKind'];
  accommodationLabel: string | null;
  /** Raw individual override, so the Data Import panels can show raw vs effective. */
  accommodationOverride: Person['accommodationOverride'];
  amountPaidOverride: number | null;
  refundAmount: number | null;
  refundedAt: string | null;
  cancelledAt: string | null;
  mobile: string | null;
  parentGuardianName: string | null;
  parentPhone: string | null;
  gender: Person['gender'];
  medicalConditions: string[];
  dietaryRequirements: string[];
  blueCardNumber: string | null;
  blueCardExpiry: string | null;
  email: string | null;
  suburb: string | null;
  postcode: string | null;
  state: string | null;
  otherMedications: string | null;
  /** Panadol/ibuprofen/antihistamine consent — 'yes'|'no'|null ('not specified', incl. every pre-existing registrant). */
  medicationConsent: 'yes' | 'no' | null;
  /** Whether a medicare number is on file — the value itself is only available via the audited reveal endpoint. */
  hasMedicare: boolean;
  churchUnlistedNote: string | null;
  parentRelation: string | null;
  consentMedical: boolean;
  consentMedia: boolean;
  consentSupervision: boolean;
  registrationType: string | null;
  registrationCost: number | null;
  discountCode: string | null;
  ticketNumber: string | null;
  invoiceNumber: string | null;
  accommodationKindConfidence: Person['accommodationKindConfidence'];
  discountAmount: number | null;
  amountPaid: number | null;
  feesAmount: number | null;
  taxAmount: number | null;
  needsReview: boolean;
  needsReviewReason: string | null;
  /**
   * The Elvanto form submission date — when this person actually registered.
   * NOT the same as `createdAt`, which is when the import first created the row: a bulk
   * import ties a whole batch at one `createdAt`, so ordering by it is meaningless. Null for
   * anyone with no Elvanto meta (manual entry, or a record predating the Form import).
   * Consumers must fall back `dateSubmitted` → `createdAt` → name.
   */
  dateSubmitted: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Single-person GET /registrants/:id — an access-checked fetch, so it may carry dateOfBirth. Still no medicareNumber. */
export interface RegistrantDetailDto extends RegistrantDto {
  dateOfBirth: string | null;
}

/**
 * The JSON shape /campers returns — the SPA's at-camp screens read these bare.
 * LIST/BULK dto: no `medicareNumber`, no `dateOfBirth` (see the privacy rule above).
 */
export interface CamperDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  kind: 'student' | 'leader';
  churchId: string;
  churchName: string;
  zone: string;
  groupId: string | null;
  mobile: string | null;
  gender: Person['gender'];
  grade: Person['grade'];
  accommodationKind: Person['accommodationKind'];
  /** Raw individual override, so the Data Import panels can show raw vs effective. */
  accommodationOverride: Person['accommodationOverride'];
  amountPaidOverride: number | null;
  refundAmount: number | null;
  refundedAt: string | null;
  cancelledAt: string | null;
  registrationType: string | null;
  registrationCost: number | null;
  discountCode: string | null;
  discountAmount: number | null;
  medicalConditions: string[];
  dietaryRequirements: string[];
  otherMedications: string | null;
  /** Panadol/ibuprofen/antihistamine consent — 'yes'|'no'|null ('not specified', incl. every pre-existing registrant). */
  medicationConsent: 'yes' | 'no' | null;
  /** Whether a medicare number is on file — the value itself is only available via the audited reveal endpoint. */
  hasMedicare: boolean;
  parentGuardianName: string | null;
  parentPhone: string | null;
  parentRelation: string | null;
  consentMedical: boolean;
  blueCardNumber: string | null;
  blueCardExpiry: string | null;
  lifecycle: Person['lifecycle'];
  atCamp: boolean;
  checkInHistory: Person['checkInHistory'];
  signOutHistory: Person['signOutHistory'];
  createdAt: string;
  updatedAt: string;
}

/** Single-person GET /campers/:id — an access-checked fetch, so it may carry dateOfBirth. Still no medicareNumber. */
export interface CamperDetailDto extends CamperDto {
  dateOfBirth: string | null;
}

/** Check-in roster entry the SPA reads from /checkin/status. */
export interface RosterEntry {
  camperId: string;
  firstName: string;
  lastName: string;
  church: string;
  zone: string;
  gender: Person['gender'];
  grade: Person['grade'];
  medicalFlag: boolean;
  checkedIn: boolean;
  lastEntry: 'in' | 'out' | null;
}

/**
 * Roles whose responses carry the parent/guardian phone MASKED.
 *
 * Bug 1 (2026-07-17) did this for `firstAid`. **`church` was added 2026-08-03** at the owner's
 * request, so a church leader now taps to reveal a parent's number exactly as first aid does.
 *
 * ⚠ The mask has to be at the DTO boundary, not in the SPA. Hiding it client-side while the
 * real number still travels in the JSON makes the reveal theatre — the number is in devtools,
 * and more importantly the AUDIT ROW is never written, because nothing forced a call to the
 * audited endpoint. Masking here is what makes `GET /search/contact/:id/parent` the only way
 * to see it, and that endpoint records a `parent-contact` reveal against the account.
 * **Every route that serialises a person for these roles must pass through this** (QA item 15,
 * 2026-11-03: /search and /registrants did not).
 *
 * Church logins keep `camper:read:sensitive`, so the reveal itself still succeeds — this
 * changes HOW a church reads the number (one audited tap), not WHETHER it may.
 *
 * director/admin/zoneLeader are deliberately unaffected: they run the camp and a masked
 * roster would add an audited tap to routine oversight work for no safeguarding gain.
 * `prayer` has no reveal step (no `camper:read:sensitive`), so it is not in this set either.
 */
const PARENT_PHONE_MASKED_ROLES: ReadonlySet<Actor['role']> = new Set(['firstAid', 'church']);

export function maskParentPhone<T extends { parentPhone: string | null }>(dto: T, actor: Actor): T {
  if (!PARENT_PHONE_MASKED_ROLES.has(actor.role) || !dto.parentPhone) return dto;
  return { ...dto, parentPhone: maskPhone(dto.parentPhone) };
}

export function toRegistrantDto(p: Person): RegistrantDto {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    kind: p.kind === 'leader' ? 'leader' : 'camper',
    paymentStatus: p.paymentStatus,
    blueCardCollected: p.blueCardNumber != null,
    churchId: p.churchId,
    churchName: p.churchName,
    zone: p.zone,
    status: p.lifecycle === 'cancelled' ? 'cancelled' : 'registered',
    grade: p.grade ?? null,
    accommodationKind: p.accommodationKind ?? null,
    accommodationLabel: p.accommodationLabel ?? null,
    accommodationOverride: p.accommodationOverride ?? null,
    amountPaidOverride: p.amountPaidOverride ?? null,
    refundAmount: p.refundAmount ?? null,
    refundedAt: p.refundedAt ?? null,
    cancelledAt: p.cancelledAt ?? null,
    mobile: p.mobile ?? null,
    parentGuardianName: p.parentGuardianName ?? null,
    parentPhone: p.parentPhone ?? null,
    gender: p.gender,
    medicalConditions: p.medicalConditions,
    dietaryRequirements: p.dietaryRequirements,
    blueCardNumber: p.blueCardNumber ?? null,
    blueCardExpiry: p.blueCardExpiry ?? null,
    email: p.email ?? null,
    suburb: p.suburb ?? null,
    postcode: p.postcode ?? null,
    state: p.state ?? null,
    otherMedications: p.otherMedications ?? null,
    medicationConsent: p.medicationConsent ?? null,
    hasMedicare: p.medicareNumber != null,
    churchUnlistedNote: p.churchUnlistedNote ?? null,
    parentRelation: p.parentRelation ?? null,
    consentMedical: p.consents.medical?.granted ?? false,
    consentMedia: p.consents.media?.granted ?? false,
    consentSupervision: p.consents.supervision?.granted ?? false,
    registrationType: p.registrationType ?? null,
    registrationCost: p.registrationCost ?? null,
    discountCode: p.discountCode ?? null,
    ticketNumber: p.ticketNumber ?? null,
    invoiceNumber: p.invoiceNumber ?? null,
    accommodationKindConfidence: p.accommodationKindConfidence ?? null,
    discountAmount: p.discountAmount ?? null,
    amountPaid: p.amountPaid ?? null,
    feesAmount: p.feesAmount ?? null,
    taxAmount: p.taxAmount ?? null,
    needsReview: p.needsReview ?? false,
    needsReviewReason: p.needsReviewReason ?? null,
    dateSubmitted: p.elvantoMeta?.dateSubmitted ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Detail (single-person, access-checked) view: the list dto plus dateOfBirth. */
export function toRegistrantDetailDto(p: Person): RegistrantDetailDto {
  return { ...toRegistrantDto(p), dateOfBirth: p.dateOfBirth ?? null };
}

export function toCamperDto(p: Person): CamperDto {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: `${p.firstName} ${p.lastName}`,
    kind: p.kind === 'leader' ? 'leader' : 'student',
    churchId: p.churchId,
    churchName: p.churchName,
    zone: p.zone,
    groupId: p.groupId ?? null,
    mobile: p.mobile ?? null,
    gender: p.gender,
    grade: p.grade ?? null,
    accommodationKind: p.accommodationKind ?? null,
    accommodationOverride: p.accommodationOverride ?? null,
    amountPaidOverride: p.amountPaidOverride ?? null,
    refundAmount: p.refundAmount ?? null,
    refundedAt: p.refundedAt ?? null,
    cancelledAt: p.cancelledAt ?? null,
    registrationType: p.registrationType ?? null,
    registrationCost: p.registrationCost ?? null,
    discountCode: p.discountCode ?? null,
    discountAmount: p.discountAmount ?? null,
    medicalConditions: p.medicalConditions,
    dietaryRequirements: p.dietaryRequirements,
    otherMedications: p.otherMedications ?? null,
    medicationConsent: p.medicationConsent ?? null,
    hasMedicare: p.medicareNumber != null,
    parentGuardianName: p.parentGuardianName ?? null,
    parentPhone: p.parentPhone ?? null,
    parentRelation: p.parentRelation ?? null,
    consentMedical: p.consents.medical?.granted ?? false,
    blueCardNumber: p.blueCardNumber ?? null,
    blueCardExpiry: p.blueCardExpiry ?? null,
    lifecycle: p.lifecycle,
    atCamp: p.atCamp,
    checkInHistory: p.checkInHistory,
    signOutHistory: p.signOutHistory,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Detail (single-person, access-checked) view: the list dto plus dateOfBirth. */
export function toCamperDetailDto(p: Person): CamperDetailDto {
  return { ...toCamperDto(p), dateOfBirth: p.dateOfBirth ?? null };
}

/**
 * A /search hit OUTSIDE the actor's canAccessPerson scope (QA item 2, 2026-11-03): an ALLOW-LIST,
 * so a new `Person` field stays private unless someone adds it here. Just enough to locate the
 * person; their church's leader contacts travel beside this in the search result.
 */
export interface CrossScopeHitDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  kind: 'student' | 'leader';
  churchId: string;
  churchName: string;
  zone: string;
  gender: Person['gender'];
  grade: Person['grade'];
}

export function toCrossScopeHitDto(p: Person): CrossScopeHitDto {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: `${p.firstName} ${p.lastName}`,
    kind: p.kind === 'leader' ? 'leader' : 'student',
    churchId: p.churchId,
    churchName: p.churchName,
    zone: p.zone,
    gender: p.gender,
    grade: p.grade ?? null,
  };
}

export function toRosterEntry(p: Person, sessionId: string): RosterEntry {
  const sessionEntries = p.checkInHistory.filter((e) => e.sessionId === sessionId);
  const last = sessionEntries[sessionEntries.length - 1] ?? null;
  return {
    camperId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    church: p.churchName,
    zone: p.zone,
    gender: p.gender,
    grade: p.grade ?? null,
    medicalFlag: p.medicalConditions.length > 0 || p.otherMedications != null,
    checkedIn: last?.type === 'in',
    lastEntry: last?.type ?? null,
  };
}
