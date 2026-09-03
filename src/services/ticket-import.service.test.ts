import { describe, it, expect } from 'vitest';
import { makeTicketImportService } from './ticket-import.service';
import { InMemoryPersonRepository, InMemoryChurchRepository } from '../repositories/in-memory';
import type { Church } from '../core/entities/church';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { ForbiddenError, BadRequestError } from '../core/errors/app-error';

// ---------------------------------------------------------------------------
// TicketImportService tests — Ticket List CSV import (leg 1 of the Elvanto
// 3-CSV split). Focus areas: cross-church name(+phone) matching via
// person-matching.ts, unconditional accommodation overwrite, church-override
// precedence, orphan creation with needsReview, never-deletes, payment-status
// mapping, and eventOccurrence filtering.
// ---------------------------------------------------------------------------

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

function church(over: Partial<Church>): Church {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'c1',
    name: 'Victory',
    zone: 'Yellow',
    contacts: {
      male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
      female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
    },
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function person(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'p1',
    firstName: 'Test',
    lastName: 'Person',
    gender: 'other',
    dateOfBirth: null,
    grade: null,
    school: null,
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    groupId: null,
    mobile: null,
    email: null,
    suburb: null,
    postcode: null,
    state: null,
    medicalConditions: [],
    dietaryRequirements: [],
    otherMedications: null,
    medicareNumber: null,
    churchUnlistedNote: null,
    elvantoMeta: null,
    parentGuardianName: null,
    parentPhone: null,
    parentRelation: null,
    blueCardNumber: null,
    blueCardExpiry: null,
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid',
    accommodationKind: null,
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
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

async function build(churches: Church[] = [church({ id: 'c1', name: 'Victory' })], persons: Person[] = []) {
  const personRepo = new InMemoryPersonRepository();
  const churchRepo = new InMemoryChurchRepository();
  await personRepo.init();
  await churchRepo.init();
  for (const c of churches) await churchRepo.save(c);
  for (const p of persons) await personRepo.save(p);
  const svc = makeTicketImportService(personRepo, churchRepo);
  return { svc, personRepo, churchRepo };
}

describe('TicketImportService.importTicketsCsv — RBAC + validation', () => {
  it('forbids roles without import:run (church, zoneLeader)', async () => {
    const { svc } = await build();
    for (const role of ['church', 'zoneLeader'] as const) {
      await expect(
        svc.importTicketsCsv(actor(role), { csvData: 'First Name,Last Name\nA,B' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('throws BadRequest when there are no data rows', async () => {
    const { svc } = await build();
    await expect(svc.importTicketsCsv(actor('admin'), { csvData: 'First Name,Last Name' })).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});

describe('TicketImportService.importTicketsCsv — orphan creation', () => {
  it('creates an unmatched orphan flagged needsReview with a reason when no person matches', async () => {
    const { svc, personRepo } = await build();
    const csv = 'First Name,Last Name,Ticket Number\nAda,Lovelace,TKT-001';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(1);
    expect(res.updated).toBe(0);
    expect(res.orphansCreated).toEqual(['Ada Lovelace']);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.needsReview).toBe(true);
    expect(all[0]!.needsReviewReason).toContain('TKT-001');
    expect(all[0]!.ticketNumber).toBe('TKT-001');
    expect(all[0]!.kind).toBe('youth');
    expect(all[0]!.churchId).toBe('');
  });
});

describe('TicketImportService.importTicketsCsv — match and update', () => {
  it('matches an existing person by name and updates ticket/invoice fields', async () => {
    const existing = person({ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', churchId: 'c1' });
    const { svc, personRepo } = await build([church({ id: 'c1', name: 'Victory' })], [existing]);
    const csv = 'First Name,Last Name,Ticket Number,Invoice Number\nAda,Lovelace,TKT-99,INV-5';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    expect(res.updated).toBe(1);
    expect(res.created).toBe(0);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(1); // no orphan created
    expect(all[0]!.ticketNumber).toBe('TKT-99');
    expect(all[0]!.invoiceNumber).toBe('INV-5');
  });
});

describe('TicketImportService.importTicketsCsv — cross-church matching', () => {
  it('disambiguates two same-named people in different churches by phone', async () => {
    const p1 = person({ id: 'p1', firstName: 'Sam', lastName: 'Lee', churchId: 'c1', mobile: '0400111111' });
    const p2 = person({ id: 'p2', firstName: 'Sam', lastName: 'Lee', churchId: 'c2', mobile: '0400222222' });
    const { svc, personRepo } = await build(
      [church({ id: 'c1', name: 'Victory' }), church({ id: 'c2', name: 'Grace' })],
      [p1, p2],
    );
    const csv = 'First Name,Last Name,Phone,Ticket Number\nSam,Lee,0400 222 222,TKT-2';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    expect(res.updated).toBe(1);
    expect(res.created).toBe(0);
    const all = await personRepo.findAll();
    expect(all.find((p) => p.id === 'p2')!.ticketNumber).toBe('TKT-2');
    expect(all.find((p) => p.id === 'p1')!.ticketNumber).toBeNull();
  });

  it('creates an orphan when the same name is ambiguous and no phone disambiguates', async () => {
    const p1 = person({ id: 'p1', firstName: 'Sam', lastName: 'Lee', churchId: 'c1', mobile: '0400111111' });
    const p2 = person({ id: 'p2', firstName: 'Sam', lastName: 'Lee', churchId: 'c2', mobile: '0400222222' });
    const { svc, personRepo } = await build(
      [church({ id: 'c1', name: 'Victory' }), church({ id: 'c2', name: 'Grace' })],
      [p1, p2],
    );
    const csv = 'First Name,Last Name,Ticket Number\nSam,Lee,TKT-3'; // no phone column to disambiguate
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(1);
    expect(res.updated).toBe(0);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(3); // orphan created; both existing twins untouched
    expect(all.find((p) => p.id === 'p1')!.ticketNumber).toBeNull();
    expect(all.find((p) => p.id === 'p2')!.ticketNumber).toBeNull();
  });
});

describe('TicketImportService.importTicketsCsv — accommodation overwrite', () => {
  it('unconditionally overwrites accommodationKind + sets confidence confirmed, even over an existing guessed value', async () => {
    const existing = person({
      id: 'p1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      churchId: 'c1',
      accommodationKind: 'tent',
      accommodationKindConfidence: 'guessed',
    });
    const { svc, personRepo } = await build([church({ id: 'c1', name: 'Victory' })], [existing]);
    const csv = 'First Name,Last Name,Ticket Type\nAda,Lovelace,Classroom';
    await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all[0]!.accommodationKind).toBe('classroom');
    expect(all[0]!.accommodationKindConfidence).toBe('confirmed');
  });
});

describe('TicketImportService.importTicketsCsv — null raw with an individual override (fix round)', () => {
  it('does not let a null accommodationKindRaw fall through to the resolved (overridden) accommodationKind', async () => {
    // The raw column is genuinely empty (no ticket-derived kind), but an individual override
    // has resolved accommodationKind to 'classroom'. A re-import with no Ticket Type on this
    // row must not treat the resolved value as if it were the raw one.
    const existing = person({
      id: 'p1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      churchId: 'c1',
      accommodationKind: 'classroom',
      accommodationKindRaw: null,
      accommodationOverride: 'classroom',
      accommodationKindConfidence: 'confirmed',
    });
    const { svc, personRepo } = await build([church({ id: 'c1', name: 'Victory' })], [existing]);
    const csv = 'First Name,Last Name,Ticket Number\nAda,Lovelace,TKT-9'; // no Ticket Type column
    await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all[0]!.accommodationKind).toBeNull();
    expect(all[0]!.accommodationKindRaw).toBeNull();
    // The override itself is untouched — this importer never reads or writes it.
    expect(all[0]!.accommodationOverride).toBe('classroom');
  });
});

describe('TicketImportService.importTicketsCsv — church override', () => {
  it('church override wins over the CSV ticket type with a warning, for a youth', async () => {
    const existing = person({ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', churchId: 'c1', kind: 'youth' });
    const { svc, personRepo } = await build(
      [church({ id: 'c1', name: 'Victory', accommodationOverride: 'classroom' })],
      [existing],
    );
    const csv = 'First Name,Last Name,Ticket Type\nAda,Lovelace,Tent';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all[0]!.accommodationKind).toBe('classroom');
    expect(all[0]!.accommodationKindConfidence).toBe('confirmed');
    expect(res.warnings.some((w) => w.message.includes('overridden'))).toBe(true);
  });

  it('overrides a leader too (Bug 2) — a church override forces everyone', async () => {
    const existing = person({ id: 'p1', firstName: 'Alelia', lastName: 'Ino', churchId: 'c1', kind: 'leader' });
    const { svc, personRepo } = await build(
      [church({ id: 'c1', name: 'Victory', accommodationOverride: 'classroom' })],
      [existing],
    );
    const csv = 'First Name,Last Name,Ticket Type\nAlelia,Ino,Tent';
    await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    // Bug 2 (2026-07-17): the leader is now forced to the church override, not left as 'tent'.
    expect(all[0]!.accommodationKind).toBe('classroom');
  });
});

describe('TicketImportService.importTicketsCsv — never deletes', () => {
  it('does not delete a person absent from the ticket CSV', async () => {
    const untouched = person({ id: 'p1', firstName: 'Not', lastName: 'InFile', churchId: 'c1' });
    const { svc, personRepo } = await build([church({ id: 'c1', name: 'Victory' })], [untouched]);
    const csv = 'First Name,Last Name\nOther,Person';
    await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all.some((p) => p.id === 'p1')).toBe(true);
    expect(all).toHaveLength(2); // untouched + new orphan
  });
});

describe('TicketImportService.importTicketsCsv — payment status mapping', () => {
  it('maps a recognized payment status value', async () => {
    const { svc, personRepo } = await build();
    const csv = 'First Name,Last Name,Payment Status\nAda,Lovelace,Completed';
    await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all[0]!.paymentStatus).toBe('paid');
  });

  it('leaves an existing paymentStatus unchanged and warns for an unrecognized value', async () => {
    const existing = person({
      id: 'p1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      churchId: 'c1',
      paymentStatus: 'deposit',
    });
    const { svc, personRepo } = await build([church({ id: 'c1', name: 'Victory' })], [existing]);
    const csv = 'First Name,Last Name,Payment Status\nAda,Lovelace,Weird Value';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all[0]!.paymentStatus).toBe('deposit');
    expect(res.warnings.some((w) => w.message.includes('Unrecognized Payment Status'))).toBe(true);
  });
});

describe('TicketImportService.importTicketsCsv — eventOccurrence filtering', () => {
  it('imports rows matching the filter and skips non-matching rows with a warning', async () => {
    const { svc, personRepo } = await build();
    const csv = 'First Name,Last Name,Event Occurrence\nAda,Lovelace,Week 1\nGrace,Hopper,Week 2';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv, eventOccurrence: 'Week 1' });
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.firstName).toBe('Ada');
    expect(res.warnings.some((w) => w.message.includes('does not match filter'))).toBe(true);
  });

  it('warns but does not block when multiple occurrences are present without a filter', async () => {
    const { svc } = await build();
    const csv = 'First Name,Last Name,Event Occurrence\nAda,Lovelace,Week 1\nGrace,Hopper,Week 2';
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(2);
    expect(res.warnings.some((w) => w.message.includes('Multiple event occurrences'))).toBe(true);
  });
});

describe('TicketImportService.importTicketsCsv — dryRun', () => {
  it('dryRun:true returns counts but persists nothing', async () => {
    const { svc, personRepo } = await build();
    const res = await svc.importTicketsCsv(actor('admin'), {
      csvData: 'First Name,Last Name\nAda,Lovelace',
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.created).toBe(1);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(0);
  });
});

/* Item A/B (2026-07-28) — TWO ACTIVE TICKETS FOR ONE PERSON.
   The "bought the wrong ticket, then bought the right one" flow produces two Active ticket rows
   for one registrant. Matching already handled it (same person, later row wins — which is the
   corrected ticket); what was missing was any signal that a person's accommodation had been
   decided by one of two competing tickets. */
describe('TicketImportService — duplicate active tickets (item A/B)', () => {
  const csv = [
    'First Name,Last Name,Ticket Number,Ticket Type,Ticket Status',
    'Ada,Lovelace,TKT-001,Tent Accomodation,Active',
    'Ada,Lovelace,TKT-002,Classroom Accomodation,Active',
  ].join('\n');

  it('keeps the LAST ticket\'s accommodation and creates no duplicate person', async () => {
    const { svc, personRepo } = await build(undefined, [person({ id: 'ada', firstName: 'Ada', lastName: 'Lovelace' })]);
    await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    const all = await personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.accommodationKind).toBe('classroom');
    expect(all[0]!.accommodationKindConfidence).toBe('confirmed');
  });

  it('warns naming the winning ticket, and flags the person for review', async () => {
    const { svc, personRepo } = await build(undefined, [person({ id: 'ada', firstName: 'Ada', lastName: 'Lovelace' })]);
    const res = await svc.importTicketsCsv(actor('admin'), { csvData: csv });
    expect(res.warnings.some((w) => /2 active tickets/i.test(w.message) && /TKT-002/.test(w.message))).toBe(true);
    const p = (await personRepo.findAll())[0]!;
    expect(p.needsReview).toBe(true);
    expect(p.needsReviewReason).toMatch(/Multiple active tickets/i);
  });

  it('a single ticket raises no warning and no review flag', async () => {
    const { svc, personRepo } = await build(undefined, [person({ id: 'ada', firstName: 'Ada', lastName: 'Lovelace' })]);
    const res = await svc.importTicketsCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Ticket Number,Ticket Type,Ticket Status\nAda,Lovelace,TKT-001,Tent Accomodation,Active',
    });
    expect(res.warnings.filter((w) => /active tickets/i.test(w.message))).toEqual([]);
    expect((await personRepo.findAll())[0]!.needsReview).toBe(false);
  });
});

/* Item 12 (2026-07-28): a trailing blank line is padding, not a missing-name error. */
describe('TicketImportService — blank padding rows (item 12)', () => {
  it('skips an entirely-blank row silently instead of reporting a missing-name error', async () => {
    const { svc } = await build(undefined, [person({ id: 'ada', firstName: 'Ada', lastName: 'Lovelace' })]);
    const res = await svc.importTicketsCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Ticket Number,Ticket Status\nAda,Lovelace,TKT-001,Active\n,,,',
    });
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it('resolves a header whose casing/spacing differs from the canonical alias', async () => {
    const { svc, personRepo } = await build(undefined, [person({ id: 'ada', firstName: 'Ada', lastName: 'Lovelace' })]);
    const res = await svc.importTicketsCsv(actor('admin'), {
      csvData: 'first name,LAST NAME,Ticket  Number,Ticket Status\nAda,Lovelace,TKT-009,Active',
    });
    expect(res.errors).toEqual([]);
    expect((await personRepo.findAll())[0]!.ticketNumber).toBe('TKT-009');
  });
});
