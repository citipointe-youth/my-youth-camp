import { describe, it, expect } from 'vitest';
import { applyRow, OWNERSHIP, type Importer } from './field-ownership';
import type { Person } from '../core/entities/person';

// Interface tests for I1: the ownership table and `applyRow`. Importer-level behaviour is pinned
// in import-field-rules.characterisation.test.ts and the three importers' own suites.

const stored = (over: Partial<Person> = {}): Person => ({
  id: 'p1', firstName: 'Ada', lastName: 'Lovelace', email: 'old@example.com', grade: 9, kind: 'youth', zone: 'Yellow',
  medicalConditions: ['Asthma'], registrationType: 'Tent', registrationCost: 150, discountCode: 'EARLY',
  accommodationKind: 'tent', accommodationKindRaw: 'tent', accommodationKindConfidence: 'confirmed',
  ticketNumber: 't1', invoiceNumbers: ['i1'], amountPaid: 150, needsReview: false,
  ...over,
} as Person);

const IMPORTERS: Importer[] = ['form', 'ticket', 'invoice'];

describe('applyRow — policies', () => {
  it('write: a non-blank value overwrites; null, "", whitespace, [] keep', () => {
    expect(applyRow('form', stored(), { email: 'new@example.com' }).email).toBe('new@example.com');
    for (const blank of [null, undefined, '', '   ']) {
      expect(applyRow('form', stored(), { email: blank as string | null }).email).toBe('old@example.com');
    }
    expect(applyRow('form', stored(), { medicalConditions: [] }).medicalConditions).toEqual(['Asthma']);
    expect(applyRow('form', stored(), { medicalConditions: ['None'] }).medicalConditions).toEqual(['None']);
    expect(applyRow('invoice', stored(), { amountPaid: 0 }).amountPaid).toBe(0); // 0 is a value
  });

  it('write-blank: the value always lands, null included; a key left out keeps', () => {
    expect(applyRow('form', stored(), { grade: null, kind: 'youth' }).grade).toBeNull();
    expect(applyRow('form', stored(), { zone: '' }).zone).toBe('');
    expect(applyRow('form', stored(), {}).grade).toBe(9);
    expect(applyRow('ticket', stored(), { invoiceNumbers: null }).invoiceNumbers).toBeNull();
  });

  it('seed-only: lands only when the stored value is null (B-16)', () => {
    const kept = applyRow('form', stored(), { registrationType: 'Classroom', registrationCost: 190, discountCode: 'LATE' });
    expect(kept).toMatchObject({ registrationType: 'Tent', registrationCost: 150, discountCode: 'EARLY' });
    const seeded = applyRow('form', stored({ registrationType: null, registrationCost: null, discountCode: null }),
      { registrationType: 'Classroom', registrationCost: 190, discountCode: 'LATE' });
    expect(seeded).toMatchObject({ registrationType: 'Classroom', registrationCost: 190, discountCode: 'LATE' });
  });

  it('seed-only kind tests the importers\' raw column, never the overridden effective kind (IA OQ-6)', () => {
    // raw null + override showing as the effective kind: the Form seeds, and does not bake the override in.
    const overridden = stored({ accommodationKind: 'classroom', accommodationKindRaw: null, accommodationOverride: 'classroom' });
    expect(applyRow('form', overridden, { accommodationKind: 'tent', accommodationKindRaw: 'tent' }))
      .toMatchObject({ accommodationKind: 'tent', accommodationKindRaw: 'tent' });
    // raw set: kept, and re-stated from raw (as B-16 did).
    const rawTent = stored({ accommodationKind: 'classroom', accommodationKindRaw: 'tent', accommodationOverride: 'classroom' });
    expect(applyRow('form', rawTent, { accommodationKind: 'classroom', accommodationKindRaw: 'classroom' }))
      .toMatchObject({ accommodationKind: 'tent', accommodationKindRaw: 'tent' });
    // hand-built person (no raw key): falls back to accommodationKind.
    const { accommodationKindRaw: _r, ...noRaw } = stored();
    expect(applyRow('form', noRaw as Person, { accommodationKind: 'classroom', accommodationKindRaw: 'classroom' }).accommodationKind).toBe('tent');
  });

  it('seed-only on a person this file created: a later duplicate submission wins, a blank keeps (item 7)', () => {
    const own = { createdThisRun: true };
    expect(applyRow('form', stored(), { registrationType: 'Classroom', registrationCost: 190 }, own))
      .toMatchObject({ registrationType: 'Classroom', registrationCost: 190 });
    expect(applyRow('form', stored(), { registrationType: null, discountCode: null }, own))
      .toMatchObject({ registrationType: 'Tent', discountCode: 'EARLY' });
  });

  it('the Form never writes confidence, money or ticket fields; a non-owner write throws', () => {
    for (const key of ['accommodationKindConfidence', 'amountPaid', 'ticketNumber', 'needsReview'] as const) {
      expect(() => applyRow('form', stored(), { [key]: null })).toThrow(/does not own/);
    }
    expect(() => applyRow('invoice', stored(), { email: 'x' })).toThrow(/does not own/);
    expect(() => applyRow('ticket', stored(), { amountPaid: 1 })).toThrow(/does not own/);
  });

  it('returns a new object and leaves fields the row does not name alone', () => {
    const p = stored();
    const out = applyRow('ticket', p, { ticketNumber: 't2' });
    expect(out).not.toBe(p);
    expect(p.ticketNumber).toBe('t1');
    expect(out).toMatchObject({ ticketNumber: 't2', email: 'old@example.com', amountPaid: 150 });
  });
});

describe('OWNERSHIP table', () => {
  it('names the documented owners (imports.md field ownership)', () => {
    const owners = (k: keyof Person) => IMPORTERS.filter((i) => OWNERSHIP[k]?.write[i]).join('+');
    expect(owners('registrationType')).toBe('form+ticket');
    expect(owners('accommodationKind')).toBe('form+ticket+invoice');
    expect(owners('accommodationKindConfidence')).toBe('ticket+invoice');
    expect(owners('registrationCost')).toBe('form+invoice');
    expect(owners('amountPaid')).toBe('invoice');
    expect(owners('paymentStatus')).toBe('ticket');
    expect(owners('consents')).toBe('form');
    // B-16: every field the Form shares with Ticket/Invoice is seed-only for the Form.
    for (const k of ['registrationType', 'registrationCost', 'discountCode', 'accommodationKind', 'accommodationKindRaw'] as const) {
      expect(OWNERSHIP[k]!.write.form).toBe('seed-only');
    }
  });

  it('no importer writes the admin-only fields', () => {
    for (const k of ['accommodationOverride', 'amountPaidOverride', 'refundAmount', 'lifecycle', 'atCamp', 'churchId', 'checkInHistory'] as const) {
      expect(OWNERSHIP[k]).toBeUndefined();
    }
  });
});
