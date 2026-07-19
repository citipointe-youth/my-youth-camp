import { describe, it, expect } from 'vitest';
import {
  toCamperDto,
  toCamperDetailDto,
  toRegistrantDto,
  toRegistrantDetailDto,
} from './person.dto';
import type { Person } from '../../core/entities/person';

// ---------------------------------------------------------------------------
// PII regression guard (audit 2026-07-19): the LIST/BULK DTOs are mapped over
// entire rosters (GET /campers, GET /registrants, listMedicalWatch, /search),
// so they must NEVER serialize `medicareNumber` or `dateOfBirth`. The boolean
// `hasMedicare` replaces the value; the cleartext number is only ever returned
// by the audited POST /campers/:id/reveal-medicare. The access-checked DETAIL
// DTOs (single-person GET) may add dateOfBirth back — but never medicareNumber.
// ---------------------------------------------------------------------------

function personFixture(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    dateOfBirth: '2010-05-01',
    grade: 9,
    school: null,
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory Church',
    zone: 'Yellow',
    groupId: null,
    mobile: '0411 928 301',
    email: null,
    suburb: null,
    postcode: null,
    state: null,
    medicalConditions: ['asthma'],
    dietaryRequirements: [],
    otherMedications: null,
    medicareNumber: '1234 56789 0',
    churchUnlistedNote: null,
    parentGuardianName: 'Parent Name',
    parentPhone: '0400 000 000',
    parentRelation: 'Mother',
    blueCardNumber: null,
    blueCardExpiry: null,
    consents: {
      medical: { granted: true, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: true, timestamp: null },
    },
    paymentStatus: 'paid',
    accommodationKind: 'tent',
    accommodationLabel: null,
    registrationType: null,
    registrationCost: null,
    discountCode: null,
    ticketNumber: null,
    invoiceNumber: null,
    accommodationKindConfidence: null,
    discountAmount: null,
    amountPaid: null,
    feesAmount: null,
    taxAmount: null,
    needsReview: false,
    needsReviewReason: null,
    lifecycle: 'registered',
    atCamp: false,
    checkInHistory: [],
    signOutHistory: [],
    elvantoMeta: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

describe('list DTOs never leak medicareNumber or dateOfBirth', () => {
  it('toCamperDto omits both and sets hasMedicare', () => {
    const dto = toCamperDto(personFixture());
    expect(dto).not.toHaveProperty('medicareNumber');
    expect(dto).not.toHaveProperty('dateOfBirth');
    expect(dto.hasMedicare).toBe(true);
  });

  it('toRegistrantDto omits both and sets hasMedicare', () => {
    const dto = toRegistrantDto(personFixture());
    expect(dto).not.toHaveProperty('medicareNumber');
    expect(dto).not.toHaveProperty('dateOfBirth');
    expect(dto.hasMedicare).toBe(true);
  });

  it('hasMedicare is false when no medicare number is on file', () => {
    expect(toCamperDto(personFixture({ medicareNumber: null })).hasMedicare).toBe(false);
    expect(toRegistrantDto(personFixture({ medicareNumber: undefined })).hasMedicare).toBe(false);
  });

  it('the raw value never appears anywhere in the serialized list DTOs', () => {
    const p = personFixture();
    expect(JSON.stringify(toCamperDto(p))).not.toContain('1234 56789 0');
    expect(JSON.stringify(toRegistrantDto(p))).not.toContain('1234 56789 0');
    expect(JSON.stringify(toCamperDto(p))).not.toContain('2010-05-01');
    expect(JSON.stringify(toRegistrantDto(p))).not.toContain('2010-05-01');
  });
});

describe('detail DTOs add dateOfBirth back but still never medicareNumber', () => {
  it('toCamperDetailDto', () => {
    const dto = toCamperDetailDto(personFixture());
    expect(dto.dateOfBirth).toBe('2010-05-01');
    expect(dto.hasMedicare).toBe(true);
    expect(dto).not.toHaveProperty('medicareNumber');
  });

  it('toRegistrantDetailDto', () => {
    const dto = toRegistrantDetailDto(personFixture());
    expect(dto.dateOfBirth).toBe('2010-05-01');
    expect(dto.hasMedicare).toBe(true);
    expect(dto).not.toHaveProperty('medicareNumber');
  });

  it('detail dateOfBirth is null when unset', () => {
    expect(toCamperDetailDto(personFixture({ dateOfBirth: null })).dateOfBirth).toBeNull();
  });
});
