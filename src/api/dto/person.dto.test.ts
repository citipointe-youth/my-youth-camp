import { describe, it, expect } from 'vitest';
import {
  toCamperDto,
  toCamperDetailDto,
  toRegistrantDto,
  toRegistrantDetailDto,
} from './person.dto';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';

const ADMIN: Actor = { id: 'admin-1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin User' };

// ---------------------------------------------------------------------------
// PII regression guard (audit 2026-07-19): the LIST/BULK DTOs are mapped over
// entire rosters (GET /campers, GET /registrants, /search), so they must
// NEVER serialize `medicareNumber` or `dateOfBirth`. The boolean
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
    const dto = toCamperDto(personFixture(), ADMIN);
    expect(dto).not.toHaveProperty('medicareNumber');
    expect(dto).not.toHaveProperty('dateOfBirth');
    expect(dto.hasMedicare).toBe(true);
  });

  it('toRegistrantDto omits both and sets hasMedicare', () => {
    const dto = toRegistrantDto(personFixture(), ADMIN);
    expect(dto).not.toHaveProperty('medicareNumber');
    expect(dto).not.toHaveProperty('dateOfBirth');
    expect(dto.hasMedicare).toBe(true);
  });

  it('hasMedicare is false when no medicare number is on file', () => {
    expect(toCamperDto(personFixture({ medicareNumber: null }), ADMIN).hasMedicare).toBe(false);
    expect(toRegistrantDto(personFixture({ medicareNumber: undefined }), ADMIN).hasMedicare).toBe(false);
  });

  it('the raw value never appears anywhere in the serialized list DTOs', () => {
    const p = personFixture();
    expect(JSON.stringify(toCamperDto(p, ADMIN))).not.toContain('1234 56789 0');
    expect(JSON.stringify(toRegistrantDto(p, ADMIN))).not.toContain('1234 56789 0');
    expect(JSON.stringify(toCamperDto(p, ADMIN))).not.toContain('2010-05-01');
    expect(JSON.stringify(toRegistrantDto(p, ADMIN))).not.toContain('2010-05-01');
  });
});

describe('detail DTOs add dateOfBirth back but still never medicareNumber', () => {
  it('toCamperDetailDto', () => {
    const dto = toCamperDetailDto(personFixture(), ADMIN);
    expect(dto.dateOfBirth).toBe('2010-05-01');
    expect(dto.hasMedicare).toBe(true);
    expect(dto).not.toHaveProperty('medicareNumber');
  });

  it('toRegistrantDetailDto', () => {
    const dto = toRegistrantDetailDto(personFixture(), ADMIN);
    expect(dto.dateOfBirth).toBe('2010-05-01');
    expect(dto.hasMedicare).toBe(true);
    expect(dto).not.toHaveProperty('medicareNumber');
  });

  it('detail dateOfBirth is null when unset', () => {
    expect(toCamperDetailDto(personFixture({ dateOfBirth: null }), ADMIN).dateOfBirth).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `dateSubmitted` (2026-07-31) — the registration-list PNG export orders people
// by when they actually registered. `createdAt` cannot answer that: a bulk import
// stamps a whole batch at one instant. This is the Elvanto form submission date,
// surfaced from `elvantoMeta` so the browser can sort on it.
// ---------------------------------------------------------------------------
describe('toRegistrantDto exposes the Elvanto submission date', () => {
  it('carries elvantoMeta.dateSubmitted through', () => {
    const p = personFixture({
      elvantoMeta: {
        dateSubmitted: '2026-06-14T09:30:00.000Z',
        submissionStatus: 'Complete',
        person: null,
        personStatus: null,
        todaysDate: null,
      },
    });
    expect(toRegistrantDto(p, ADMIN).dateSubmitted).toBe('2026-06-14T09:30:00.000Z');
    expect(toRegistrantDetailDto(p, ADMIN).dateSubmitted).toBe('2026-06-14T09:30:00.000Z');
  });

  it('is null when there is no Elvanto meta at all', () => {
    expect(toRegistrantDto(personFixture({ elvantoMeta: null }), ADMIN).dateSubmitted).toBeNull();
  });

  it('is null when the meta exists but carries no submission date', () => {
    const p = personFixture({
      elvantoMeta: {
        dateSubmitted: null,
        submissionStatus: null,
        person: null,
        personStatus: null,
        todaysDate: null,
      },
    });
    expect(toRegistrantDto(p, ADMIN).dateSubmitted).toBeNull();
  });
});

describe('individual overrides and cancel/refund fields', () => {
  it('carries the individual overrides and cancel/refund fields to the SPA', () => {
    const dto = toRegistrantDto({ ...personFixture(), accommodationKind: 'classroom',
      accommodationOverride: 'classroom', amountPaidOverride: 250, refundAmount: 50,
      refundedAt: '2026-09-01T00:00:00.000Z', cancelledAt: null, lifecycle: 'cancelled' }, ADMIN);
    expect(dto.accommodationKind).toBe('classroom'); // already resolved by the mapper
    expect(dto.accommodationOverride).toBe('classroom');
    expect(dto.amountPaidOverride).toBe(250);
    expect(dto.refundAmount).toBe(50);
    expect(dto.refundedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(dto.status).toBe('cancelled');
  });
});

describe('A2: the person DTOs are viewer-aware (mask + money strip inside the serialiser)', () => {
  const as = (role: Actor['role']): Actor => ({ ...ADMIN, id: role, role });
  const ROLES: Actor['role'][] = ['admin', 'director', 'zoneLeader', 'church', 'firstAid', 'prayer'];
  const MASKED = new Set(['church', 'firstAid', 'prayer']); // T-1: prayer masked too
  const MONEYLESS = new Set(['firstAid', 'prayer']);

  it.each(ROLES)('%s: parent phone masked only for church/firstAid/prayer, on every person DTO', (role) => {
    const p = personFixture();
    const phones = [toCamperDto(p, as(role)), toCamperDetailDto(p, as(role)), toRegistrantDto(p, as(role)), toRegistrantDetailDto(p, as(role))]
      .map((d) => d.parentPhone);
    for (const ph of phones) {
      if (MASKED.has(role)) { expect(ph).not.toBe('0400 000 000'); expect(ph).toBeTruthy(); }
      else expect(ph).toBe('0400 000 000');
    }
  });

  it.each(ROLES)('%s: camper money/blue-card fields null only for firstAid/prayer', (role) => {
    const dto = toCamperDto(personFixture({ registrationCost: 300, blueCardNumber: 'BC1' }), as(role));
    if (MONEYLESS.has(role)) expect([dto.registrationCost, dto.blueCardNumber]).toEqual([null, null]);
    else expect([dto.registrationCost, dto.blueCardNumber]).toEqual([300, 'BC1']);
  });

  it('a missing parent phone stays null when masked', () => {
    expect(toCamperDto(personFixture({ parentPhone: null }), as('church')).parentPhone).toBeNull();
  });
});
