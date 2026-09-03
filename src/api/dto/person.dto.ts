import type { Person } from '../../core/entities/person';
import { isCamper } from '../../core/entities/person';

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
