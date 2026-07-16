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
