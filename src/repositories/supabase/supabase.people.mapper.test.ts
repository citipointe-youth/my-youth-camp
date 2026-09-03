import { describe, it, expect, beforeAll } from 'vitest';
import { toPerson, personColumns } from './supabase.people';
import type { Person } from '../../core/entities/person';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function samplePerson(): Person {
  return {
    id: 'p_enc1',
    firstName: 'Ivy', lastName: 'Sample', gender: 'female',
    dateOfBirth: '2010-05-01', grade: 9, school: null, kind: 'youth',
    churchId: 'ch_1', churchName: 'Sample Church', zone: 'Blue', groupId: null,
    mobile: '0400000000', email: null, suburb: null, postcode: null, state: null,
    medicalConditions: ['Asthma', 'Peanut allergy'],
    dietaryRequirements: ['Vegetarian'],
    otherMedications: 'Ventolin PRN',
    medicareNumber: '1234567890',
    churchUnlistedNote: null,
    parentGuardianName: 'Robin Sample', parentPhone: '0411111111', parentRelation: 'Parent',
    blueCardNumber: 'BC-123', blueCardExpiry: '2027-01-01',
    consents: {
      medical: { granted: true, timestamp: '2026-01-01T00:00:00.000Z' },
      media: { granted: false, timestamp: null },
      supervision: { granted: true, timestamp: '2026-01-01T00:00:00.000Z' },
    },
    paymentStatus: 'paid', accommodationKind: 'tent', accommodationLabel: null,
    registrationType: null, registrationCost: null, discountCode: null,
    ticketNumber: null, invoiceNumber: null, accommodationKindConfidence: null,
    discountAmount: null, amountPaid: null, feesAmount: null, taxAmount: null,
    needsReview: false, needsReviewReason: null,
    lifecycle: 'registered', atCamp: false,
    checkInHistory: [], signOutHistory: [],
    elvantoMeta: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('people mapper encryption', () => {
  it('writes ciphertext to *_enc and scalar columns, omits legacy columns', () => {
    const cols = personColumns(samplePerson());
    // arrays/jsonb/date → *_enc ciphertext
    expect(String(cols['medical_conditions_enc']).startsWith('v1.')).toBe(true);
    expect(String(cols['dietary_requirements_enc']).startsWith('v1.')).toBe(true);
    expect(String(cols['consents_enc']).startsWith('v1.')).toBe(true);
    expect(String(cols['blue_card_expiry_enc']).startsWith('v1.')).toBe(true);
    // scalars encrypted in place
    expect(String(cols['other_medications']).startsWith('v1.')).toBe(true);
    expect(String(cols['medicare_number']).startsWith('v1.')).toBe(true);
    expect(String(cols['blue_card_number']).startsWith('v1.')).toBe(true);
    expect(String(cols['parent_guardian_name']).startsWith('v1.')).toBe(true);
    expect(String(cols['parent_phone']).startsWith('v1.')).toBe(true);
    expect(String(cols['parent_relation']).startsWith('v1.')).toBe(true);
    // legacy array/jsonb/date columns are no longer written
    expect('medical_conditions' in cols).toBe(false);
    expect('dietary_requirements' in cols).toBe(false);
    expect('consents' in cols).toBe(false);
    expect('blue_card_expiry' in cols).toBe(false);
    // non-sensitive column untouched
    expect(cols['first_name']).toBe('Ivy');
  });

  it('round-trips through toPerson (ciphertext → plaintext entity)', () => {
    const cols = personColumns(samplePerson());
    // Simulate the DB handing the same row back (timestamps come back as Date objects).
    const row = { ...cols, created_at: new Date(cols['created_at'] as string), updated_at: new Date(cols['updated_at'] as string) };
    const p = toPerson(row, [], []);
    expect(p.medicalConditions).toEqual(['Asthma', 'Peanut allergy']);
    expect(p.dietaryRequirements).toEqual(['Vegetarian']);
    expect(p.otherMedications).toBe('Ventolin PRN');
    expect(p.medicareNumber).toBe('1234567890');
    expect(p.blueCardNumber).toBe('BC-123');
    expect(p.blueCardExpiry).toBe('2027-01-01');
    expect(p.parentGuardianName).toBe('Robin Sample');
    expect(p.parentPhone).toBe('0411111111');
    expect(p.parentRelation).toBe('Parent');
    expect(p.consents.medical.granted).toBe(true);
  });

  it('preserves null / empty (never stores ciphertext for them)', () => {
    const p = samplePerson();
    p.otherMedications = null; p.blueCardNumber = null; p.blueCardExpiry = null;
    p.medicalConditions = []; p.dietaryRequirements = [];
    const cols = personColumns(p);
    expect(cols['other_medications']).toBeNull();
    expect(cols['blue_card_number']).toBeNull();
    expect(cols['blue_card_expiry_enc']).toBeNull();
    expect(cols['medical_conditions_enc']).toBeNull();
    const row = { ...cols, created_at: new Date(cols['created_at'] as string), updated_at: new Date(cols['updated_at'] as string) };
    const back = toPerson(row, [], []);
    expect(back.otherMedications).toBeNull();
    expect(back.blueCardNumber).toBeNull();
    expect(back.blueCardExpiry).toBeNull();
    expect(back.medicalConditions).toEqual([]);
  });

  it('reads legacy plaintext rows when *_enc is absent (rollout tolerance)', () => {
    const legacyRow: Record<string, unknown> = {
      id: 'p_legacy', first_name: 'Old', last_name: 'Row', gender: 'male',
      date_of_birth: null, grade: null, school: null, kind: 'youth',
      church_id: 'ch_1', church_name: 'C', zone: 'Blue', group_id: null,
      mobile: null, email: null, suburb: null, postcode: null, state: null,
      // legacy plaintext, no *_enc columns present:
      medical_conditions: ['Diabetes'], dietary_requirements: [],
      other_medications: 'Insulin', medicare_number: '999',
      church_unlisted_note: null, elvanto_meta: null,
      parent_guardian_name: 'Pat', parent_phone: '0400', parent_relation: 'Parent',
      blue_card_number: 'BC-legacy', blue_card_expiry: '2028-02-02',
      consents: { medical: { granted: true, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
      payment_status: 'unpaid', accommodation_kind: null, accommodation_label: null,
      registration_type: null, registration_cost: null, discount_code: null,
      ticket_number: null, invoice_number: null, accommodation_kind_confidence: null,
      discount_amount: null, amount_paid: null, fees_amount: null, tax_amount: null,
      needs_review: false, needs_review_reason: null,
      lifecycle: 'registered', at_camp: false,
      created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const p = toPerson(legacyRow, [], []);
    expect(p.medicalConditions).toEqual(['Diabetes']);
    expect(p.otherMedications).toBe('Insulin');
    expect(p.blueCardNumber).toBe('BC-legacy');
    expect(p.blueCardExpiry).toBe('2028-02-02');
    expect(p.consents.medical.granted).toBe(true);
  });
});

describe('individual accommodation override (0022)', () => {
  function baseRow(): Record<string, unknown> {
    return {
      id: 'p_ovr1', first_name: 'Sam', last_name: 'Override', gender: 'male',
      date_of_birth: null, grade: null, school: null, kind: 'youth',
      church_id: 'ch_1', church_name: 'C', zone: 'Blue', group_id: null,
      mobile: null, email: null, suburb: null, postcode: null, state: null,
      medical_conditions: [], dietary_requirements: [],
      other_medications: null, medicare_number: null,
      church_unlisted_note: null, elvanto_meta: null,
      parent_guardian_name: null, parent_phone: null, parent_relation: null,
      blue_card_number: null, blue_card_expiry: null,
      consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
      payment_status: 'unpaid', accommodation_kind: null, accommodation_label: null,
      registration_type: null, registration_cost: null, discount_code: null,
      ticket_number: null, invoice_number: null, accommodation_kind_confidence: null,
      discount_amount: null, amount_paid: null, fees_amount: null, tax_amount: null,
      accommodation_override: null, amount_paid_override: null,
      refund_amount: null, refunded_at: null, cancelled_at: null,
      needs_review: false, needs_review_reason: null,
      lifecycle: 'registered', at_camp: false,
      created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  function handBuiltPerson(): Person {
    return {
      id: 'p_hb1',
      firstName: 'Hand', lastName: 'Built', gender: 'male',
      dateOfBirth: null, grade: null, school: null, kind: 'youth',
      churchId: 'ch_1', churchName: 'C', zone: 'Blue', groupId: null,
      mobile: null, email: null, suburb: null, postcode: null, state: null,
      medicalConditions: [], dietaryRequirements: [],
      otherMedications: null, medicareNumber: null,
      churchUnlistedNote: null,
      parentGuardianName: null, parentPhone: null, parentRelation: null,
      blueCardNumber: null, blueCardExpiry: null,
      consents: {
        medical: { granted: false, timestamp: null },
        media: { granted: false, timestamp: null },
        supervision: { granted: false, timestamp: null },
      },
      paymentStatus: 'unpaid', accommodationKind: null, accommodationLabel: null,
      registrationType: null, registrationCost: null, discountCode: null,
      ticketNumber: null, invoiceNumber: null, accommodationKindConfidence: null,
      discountAmount: null, amountPaid: null, feesAmount: null, taxAmount: null,
      needsReview: false, needsReviewReason: null,
      lifecycle: 'registered', atCamp: false,
      checkInHistory: [], signOutHistory: [],
      elvantoMeta: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      // accommodationKindRaw deliberately absent (undefined) — this Person was not built by toPerson.
    };
  }

  it('resolves accommodationKind from accommodation_override and marks it confirmed', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: 'classroom',
      accommodation_kind_confidence: 'guessed' }, [], []);
    expect(p.accommodationKind).toBe('classroom');       // effective
    expect(p.accommodationKindRaw).toBe('tent');         // what the importers said
    expect(p.accommodationOverride).toBe('classroom');
    expect(p.accommodationKindConfidence).toBe('confirmed');
  });

  it('falls through to accommodation_kind when there is no override', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: null,
      accommodation_kind_confidence: 'guessed' }, [], []);
    expect(p.accommodationKind).toBe('tent');
    expect(p.accommodationKindRaw).toBe('tent');
    expect(p.accommodationOverride).toBeNull();
    expect(p.accommodationKindConfidence).toBe('guessed');
  });

  it('maps the money and cancel fields', () => {
    const p = toPerson({ ...baseRow(), amount_paid_override: 250, refund_amount: 50,
      refunded_at: new Date('2026-09-01T00:00:00Z'), cancelled_at: new Date('2026-09-02T00:00:00Z') }, [], []);
    expect(p.amountPaidOverride).toBe(250);
    expect(p.refundAmount).toBe(50);
    expect(p.refundedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(p.cancelledAt).toBe('2026-09-02T00:00:00.000Z');
  });

  // THE REGRESSION GUARD. Without this, saving an overridden person bakes the override
  // into the importers' accommodation_kind column and the original value is gone for good.
  it('personColumns persists the RAW accommodation kind, never the resolved override', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: 'classroom' }, [], []);
    const cols = personColumns(p);
    expect(cols['accommodation_kind']).toBe('tent');
    expect(cols['accommodation_override']).toBe('classroom');
  });

  it('personColumns falls back to accommodationKind for a hand-built person (no raw carrier)', () => {
    const cols = personColumns({ ...handBuiltPerson(), accommodationKind: 'tent' });
    expect(cols['accommodation_kind']).toBe('tent');
  });

  // THE SIBLING REGRESSION GUARD (fix round). Without this, `toPerson`'s forced 'confirmed'
  // (synthesised whenever accommodation_override is set) would be written straight back into
  // accommodation_kind_confidence by ANY unrelated save, permanently corrupting a genuine
  // 'guessed'/null confidence — surviving even after the override is later cleared.
  it('personColumns writes null confidence for an overridden person, never the forced "confirmed"', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: 'classroom',
      accommodation_kind_confidence: 'guessed' }, [], []);
    expect(p.accommodationKindConfidence).toBe('confirmed'); // the forced read-time value
    const cols = personColumns(p);
    expect(cols['accommodation_kind_confidence']).toBeNull(); // never the forced value
  });

  it('personColumns writes the real confidence through unchanged when there is no override', () => {
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: null,
      accommodation_kind_confidence: 'guessed' }, [], []);
    const cols = personColumns(p);
    expect(cols['accommodation_kind_confidence']).toBe('guessed');
  });

  // Separates `!== undefined` from `??` in personColumns' raw carrier — a hand-built case with
  // raw undefined and kind 'tent' would pass under `??` too, so a future "simplification" to
  // `??` would slip through the existing guard unnoticed. `null` must persist as `null`.
  it('personColumns persists a null accommodationKindRaw as null, never falls through to accommodationKind', () => {
    const cols = personColumns({ ...handBuiltPerson(), accommodationKindRaw: null, accommodationKind: 'classroom' });
    expect(cols['accommodation_kind']).toBeNull();
  });

  // Coverage for the 5th read-modify-write site found in review: allocation.service.allocate
  // computes a forced accommodationKind from the CHURCH's accommodationOverride and saves
  // `{...person, accommodationKind, accommodationKindRaw: accommodationKind, ...}` — a plain
  // spread over a mapper-built Person. The in-memory repo used by allocation.service.test.ts
  // stores objects verbatim and cannot catch a stale-raw-carrier bug; this exercises the same
  // shape through the REAL mapper instead.
  it('a plain spread with a fresh accommodationKindRaw (allocation.service pattern) persists the new kind, not the stale raw', () => {
    // Mapper-built person: raw says 'tent' from the Ticket List, no individual override.
    const p = toPerson({ ...baseRow(), accommodation_kind: 'tent', accommodation_override: null }, [], []);
    expect(p.accommodationKindRaw).toBe('tent');
    // allocation.service.allocate's save pattern: church accommodationOverride forces 'classroom',
    // and the fix carries it into accommodationKindRaw too (not just accommodationKind).
    const forced = 'classroom' as const;
    const saved = { ...p, accommodationKind: forced, accommodationKindRaw: forced };
    const cols = personColumns(saved);
    expect(cols['accommodation_kind']).toBe('classroom'); // not the stale 'tent' raw
  });
});
