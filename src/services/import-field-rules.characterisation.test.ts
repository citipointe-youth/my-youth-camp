import { describe, it, expect } from 'vitest';
import { makeImportService } from './import.service';
import { makeTicketImportService } from './ticket-import.service';
import { makeInvoiceImportService } from './invoice-import.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';
import { CONSENT_COLUMNS } from './elvanto-mapping';

// ---------------------------------------------------------------------------
// Characterisation (written before I1, green on the old code): the per-field update rules the
// three importers applied by hand, which I1 moves into the field-ownership table. Each case is
// one rule that no other test pinned directly.
// ---------------------------------------------------------------------------

const admin: Actor = { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin' };
const C = CONSENT_COLUMNS.join(',');

function existing(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'female', dateOfBirth: '2012-01-01',
    grade: 9, school: null, kind: 'youth', churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
    groupId: null, mobile: '0400000001', email: 'old@example.com', suburb: 'Oldtown', postcode: null,
    state: null, medicalConditions: ['Asthma'], dietaryRequirements: [], otherMedications: null,
    medicareNumber: null, churchUnlistedNote: null,
    elvantoMeta: { dateSubmitted: '01/01/2026', submissionStatus: '', person: '', personStatus: '', todaysDate: '' },
    parentGuardianName: 'Mum', parentPhone: null, parentRelation: null, blueCardNumber: null, blueCardExpiry: null,
    consents: { medical: { granted: true, timestamp: now }, media: { granted: false, timestamp: null }, supervision: { granted: true, timestamp: now } },
    paymentStatus: 'paid', accommodationKind: 'tent', accommodationKindRaw: 'tent', accommodationKindConfidence: 'confirmed',
    accommodationLabel: null, registrationType: 'Tent', registrationCost: 150, discountCode: 'EARLY',
    ticketNumber: 't1', invoiceNumber: 'i1', invoiceNumbers: ['i1'], discountAmount: 0, amountPaid: 150,
    feesAmount: null, taxAmount: null, needsReview: false, needsReviewReason: null,
    lifecycle: 'registered', atCamp: false, checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now,
    ...over,
  } as Person;
}

async function world(p: Person) {
  const people = new InMemoryPersonRepository();
  const churches = new InMemoryChurchRepository();
  const overrides = new InMemoryAllocationOverrideRepository();
  await people.init(); await churches.init(); await overrides.init();
  const blank = { name: '', phone: '' };
  await churches.save({ id: 'c1', name: 'Victory', zone: 'Blue', contacts: { male: { primary: blank, backup: blank }, female: { primary: blank, backup: blank } }, createdAt: p.createdAt, updatedAt: p.createdAt } as Church);
  await people.save(p);
  return {
    get: async () => (await people.findById('p1'))!,
    form: (csv: string) => makeImportService(people, churches, overrides).importCsv(admin, { csvData: csv, updateExisting: true }),
    ticket: (csv: string) => makeTicketImportService(people, churches).importTicketsCsv(admin, { csvData: csv }),
    invoice: (csv: string) => makeInvoiceImportService(people).importInvoicesCsv(admin, { csvData: csv }),
  };
}

const formRow = (cols: string, vals: string) => `First Name,Last Name,Attendee's Church,Mobile Number,${cols},${C}\nAda,Lovelace,Victory,0400000001,${vals},,,`;

describe('Form update rules (pinned before I1)', () => {
  it('a blank School Grade keeps grade and kind; zone always follows the church', async () => {
    const w = await world(existing());
    await w.form(formRow('School Grade,Email Address', ','));
    const p = await w.get();
    expect(p).toMatchObject({ grade: 9, kind: 'youth', zone: 'Blue', email: 'old@example.com', medicalConditions: ['Asthma'] });
    expect(p.elvantoMeta?.dateSubmitted).toBe('01/01/2026');
  });

  it('an unrecognised School Grade clears the grade; a leader grade sets kind', async () => {
    const w = await world(existing());
    await w.form(formRow('School Grade', 'banana'));
    expect(await w.get()).toMatchObject({ grade: null, kind: 'youth' });
    await w.form(formRow('School Grade', '18+ Leader'));
    expect(await w.get()).toMatchObject({ grade: null, kind: 'leader' });
  });

  it('non-blank cells overwrite; Ticket/Invoice fields stay (B-16 seed-only)', async () => {
    const w = await world(existing());
    await w.form(formRow('Email Address,Type,Cost,Code', 'new@example.com,Classroom,$190,LATE'));
    expect(await w.get()).toMatchObject({
      email: 'new@example.com', registrationType: 'Tent', registrationCost: 150, discountCode: 'EARLY',
      accommodationKind: 'tent', accommodationKindRaw: 'tent', accommodationKindConfidence: 'confirmed',
    });
  });

  it('seed-only writes when the stored value is blank', async () => {
    const w = await world(existing({ registrationType: null, registrationCost: null, discountCode: null, accommodationKind: null, accommodationKindRaw: null, accommodationKindConfidence: null }));
    await w.form(formRow('Type,Cost,Code', 'Classroom,$190,LATE'));
    expect(await w.get()).toMatchObject({ registrationType: 'Classroom', registrationCost: 190, discountCode: 'LATE', accommodationKind: 'classroom', accommodationKindRaw: 'classroom', accommodationKindConfidence: null });
  });
});

describe('Ticket update rules (pinned before I1)', () => {
  const H = 'Ticket Number,Ticket Type,Invoice Number,First Name,Last Name,Phone,Invoice Payment Status,Ticket Status';
  it('blank ticket#/status keep; invoiceNumbers is rebuilt from this file; kind written back from raw', async () => {
    const w = await world(existing());
    await w.ticket(`${H}\n,,,Ada,Lovelace,0400000001,,Active`);
    expect(await w.get()).toMatchObject({
      ticketNumber: 't1', invoiceNumber: 'i1', paymentStatus: 'paid', registrationType: 'Tent',
      invoiceNumbers: null, accommodationKind: 'tent', accommodationKindRaw: 'tent', accommodationKindConfidence: 'confirmed',
    });
  });
  it('a ticket type overwrites kind and confirms it', async () => {
    const w = await world(existing({ accommodationKindConfidence: 'guessed' }));
    await w.ticket(`${H}\nt2,Classroom,i2,Ada,Lovelace,0400000001,Paid,Active`);
    expect(await w.get()).toMatchObject({ ticketNumber: 't2', invoiceNumbers: ['i2'], registrationType: 'Classroom', accommodationKind: 'classroom', accommodationKindConfidence: 'confirmed' });
  });
});

describe('Invoice update rules (pinned before I1)', () => {
  it('blank money cells and a blank code keep the stored values', async () => {
    const w = await world(existing());
    await w.invoice('Invoice Number,First Name,Last Name,Amount Paid,Ticket Total,Discount Code\ni1,Ada,Lovelace,,190,');
    expect(await w.get()).toMatchObject({ amountPaid: 150, discountCode: 'EARLY', registrationCost: 190, accommodationKindConfidence: 'confirmed' });
  });
});
