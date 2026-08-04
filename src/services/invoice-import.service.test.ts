import { describe, it, expect } from 'vitest';
import { makeInvoiceImportService, parseMoney } from './invoice-import.service';
import { InMemoryPersonRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { ForbiddenError, BadRequestError } from '../core/errors/app-error';

// ---------------------------------------------------------------------------
// invoice-import.service.test.ts — Invoice CSV importer (Elvanto 3-CSV split).
// This CSV has no church field and often no reliable name field, so matching
// is tiered (invoice number -> cross-church name+phone -> unmatched, never an
// orphan). Coverage focuses on the tiers, the group-invoice $ withholding, the
// never-overwrite-confirmed-accommodation invariant, and the price->kind guess
// thresholds.
// ---------------------------------------------------------------------------

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

let idCounter = 0;
function person(over: Partial<Person> = {}): Person {
  idCounter += 1;
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: `p${idCounter}`,
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    mobile: null,
    email: null,
    medicalConditions: [],
    dietaryRequirements: [],
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid',
    needsReview: false,
    lifecycle: 'registered',
    atCamp: false,
    checkInHistory: [],
    signOutHistory: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

async function build(people: Person[] = []) {
  const personRepo = new InMemoryPersonRepository();
  await personRepo.init();
  for (const p of people) await personRepo.save(p);
  const svc = makeInvoiceImportService(personRepo);
  return { svc, personRepo };
}

const HDR = 'Invoice Number,Billing First Name,Billing Last Name,Billing Phone,Ticket Total,Discount Total,Amount Paid,Fees,Tax,Discount Code';

describe('parseMoney', () => {
  it('parses a plain amount', () => {
    expect(parseMoney('250')).toBe(250);
  });

  it('strips currency symbols/commas', () => {
    expect(parseMoney('$1,250.50')).toBe(1250.5);
  });

  it('preserves a leading minus sign (negative discount/fee)', () => {
    expect(parseMoney('-15.50')).toBe(-15.5);
  });

  it('returns null for empty/blank input', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
  });

  it('returns null when nothing numeric remains', () => {
    expect(parseMoney('N/A')).toBeNull();
  });
});

describe('InvoiceImportService.importInvoicesCsv — RBAC + validation', () => {
  it('forbids roles without import:run (church, zoneLeader)', async () => {
    const { svc } = await build();
    for (const role of ['church', 'zoneLeader'] as const) {
      await expect(svc.importInvoicesCsv(actor(role), { csvData: `${HDR}\nINV-1,,,,250,,250,,,` }))
        .rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('throws BadRequest when there are no data rows', async () => {
    const { svc } = await build();
    await expect(svc.importInvoicesCsv(actor('admin'), { csvData: HDR })).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('InvoiceImportService.importInvoicesCsv — invoice-number matching (single)', () => {
  it('matches a single person by invoice number and applies financial fields', async () => {
    const target = person({ id: 'p1', invoiceNumber: 'INV-100' });
    const { svc, personRepo } = await build([target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-100,,,,250,10,240,5,2,SUMMER10`,
    });
    expect(res.updated).toBe(1);
    expect(res.ambiguousGroupInvoices).toBe(0);
    const p = (await personRepo.findAll()).find((x) => x.id === 'p1')!;
    expect(p.registrationCost).toBe(250);
    expect(p.discountAmount).toBe(10);
    expect(p.amountPaid).toBe(240);
    expect(p.feesAmount).toBe(5);
    expect(p.taxAmount).toBe(2);
    expect(p.discountCode).toBe('SUMMER10');
  });
});

/* Family invoices (2026-08-02). These used to have their money WITHHELD from everyone on them,
   which in prod meant 64 of 217 people reported $0 with no discount code to explain it — the
   single biggest hole in the budget. They are split now; these tests pin the split. */
describe('InvoiceImportService.importInvoicesCsv — shared family invoices', () => {
  // Priced from single-invoice people already in the repo, exactly as the real table is built.
  const priced = (): Person[] => [
    person({ id: 'seedC', registrationType: 'Classroom Accommodation', registrationCost: 190 }),
    person({ id: 'seedT', registrationType: 'EARLY BIRD | Tent Accomodation', registrationCost: 150 }),
  ];

  it('splits a shared invoice by ticket price and the parts sum to the invoice exactly', async () => {
    // The real prod shape: invoice 030032 — a classroom and a tent sibling, $340 of tickets,
    // $320 paid after a $20 discount.
    const a = person({ id: 'p1', firstName: 'Charlotte', lastName: 'Winslow',
      invoiceNumber: 'INV-200', registrationType: 'Classroom Accommodation' });
    const b = person({ id: 'p2', firstName: 'Hannah', lastName: 'Winslow',
      invoiceNumber: 'INV-200', registrationType: 'EARLY BIRD | Tent Accomodation' });
    const { svc, personRepo } = await build([...priced(), a, b]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-200,,,,340,20,320,,,SUMMER10`,
    });
    expect(res.ambiguousGroupInvoices).toBe(1);
    const all = await personRepo.findAll();
    const pa = all.find((x) => x.id === 'p1')!;
    const pb = all.find((x) => x.id === 'p2')!;
    // Cost is each person's OWN ticket, not a share of the total.
    expect(pa.registrationCost).toBe(190);
    expect(pb.registrationCost).toBe(150);
    // Paid is apportioned 190:150 — and the two parts must add up to the invoice EXACTLY.
    expect((pa.amountPaid ?? 0) + (pb.amountPaid ?? 0)).toBe(320);
    expect((pa.discountAmount ?? 0) + (pb.discountAmount ?? 0)).toBe(20);
    expect(pa.amountPaid!).toBeGreaterThan(pb.amountPaid!);
    for (const p of [pa, pb]) expect(p.discountCode).toBe('SUMMER10');
    // A price-based split is a fact, not a guess — it must NOT raise the review flag.
    for (const p of [pa, pb]) expect(p.needsReview ?? false).toBe(false);
    expect(res.updated).toBe(2);
  });

  /* 🔴 2026-08-04 — THE ACTUAL CAUSE OF "the review is too sensitive".
     Measured against prod after the rollover: 287 people, 41 shared invoices, and ALL 92 people
     on them flagged. Not one resolved. The reason was ordering, not the split rules: only the
     Invoice import writes `registrationCost`, so on the first import into a freshly-wiped camp
     the price table was built from a table where every cost was null — EMPTY — and every shared
     invoice fell to the equal split. The prices were sitting in the same CSV the importer was
     reading. Running the import twice fixed it, which is a workaround nobody should need. */
  it('🔴 prices a shared invoice from SINGLE invoices in the SAME FILE, on a camp with no costs yet', async () => {
    // Nobody has a cost — exactly the state after a new-year rollover + Form/Ticket import.
    const solo = person({ id: 'solo', invoiceNumber: 'INV-300',
      registrationType: 'Classroom Accommodation' });
    const a = person({ id: 'p1', invoiceNumber: 'INV-301', registrationType: 'Classroom Accommodation' });
    const b = person({ id: 'p2', invoiceNumber: 'INV-301', registrationType: 'EARLY BIRD | Tent Accomodation' });
    const soloTent = person({ id: 'soloT', invoiceNumber: 'INV-302',
      registrationType: 'EARLY BIRD | Tent Accomodation' });
    const { svc, personRepo } = await build([solo, a, b, soloTent]);

    // The shared invoice sits BETWEEN the two singles that price its ticket types, so this only
    // passes if the group is deferred until after every single row has been applied.
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-300,,,,190,,190,,,\nINV-301,,,,340,,340,,,\nINV-302,,,,150,,150,,,`,
    });

    const all = await personRepo.findAll();
    const pa = all.find((x) => x.id === 'p1')!;
    const pb = all.find((x) => x.id === 'p2')!;
    expect(pa.registrationCost).toBe(190);
    expect(pb.registrationCost).toBe(150);
    // Before the two-pass fix these were $170 each and both flagged.
    expect(pa.amountPaid).toBe(190);
    expect(pb.amountPaid).toBe(150);
    for (const p of [pa, pb]) expect(p.needsReview ?? false).toBe(false);
    expect(res.warnings.some((w) => w.message.includes('EQUALLY'))).toBe(false);
    expect(res.ambiguousGroupInvoices).toBe(1);
    expect(res.updated).toBe(4);
  });

  it('does not let a group\'s own equal split teach the price table', async () => {
    // Two 'Mystery' people on one $500 invoice and nothing else priced. The equal split writes
    // $250 each — if that fed back into the table, a second group on the same ticket type would
    // "resolve" against a number this importer invented. Nothing is priced, so both stay flagged.
    const g1 = ['p1', 'p2'].map((id) => person({ id, invoiceNumber: 'INV-310', registrationType: 'Mystery' }));
    const g2 = ['p3', 'p4'].map((id) => person({ id, invoiceNumber: 'INV-311', registrationType: 'Mystery' }));
    const { svc, personRepo } = await build([...g1, ...g2]);
    await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-310,,,,500,,500,,,\nINV-311,,,,500,,500,,,`,
    });
    const all = await personRepo.findAll();
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      expect(all.find((x) => x.id === id)!.needsReview).toBe(true);
    }
  });

  /* 2026-08-04 — the owner's "review is too sensitive" report. An unpriced ticket TYPE used to
     be the only question asked; now the invoice TOTAL is evidence too. See invoice-split.ts. */
  it('resolves an unpriced ticket from the invoice total and does NOT flag for review', async () => {
    // $340 covering a known $190 classroom and a ticket type nobody has an invoice for.
    // The residual is $150, which is a real ticket price — nothing here needs a human.
    const a = person({ id: 'p1', invoiceNumber: 'INV-210', registrationType: 'Classroom Accommodation' });
    const b = person({ id: 'p2', invoiceNumber: 'INV-210', registrationType: 'Mystery Ticket' });
    const { svc, personRepo } = await build([...priced(), a, b]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-210,,,,340,,340,,,`,
    });
    const all = await personRepo.findAll();
    const pa = all.find((x) => x.id === 'p1')!;
    const pb = all.find((x) => x.id === 'p2')!;
    expect(pa.registrationCost).toBe(190);
    expect(pb.registrationCost).toBe(150);
    // NOT the $170/$170 equal split it would have been before, and NOT flagged.
    expect(pa.amountPaid).toBe(190);
    expect(pb.amountPaid).toBe(150);
    for (const p of [pa, pb]) expect(p.needsReview ?? false).toBe(false);
    expect(res.warnings.some((w) => w.message.includes('EQUALLY'))).toBe(false);
  });

  it('keeps flagging one tent + one classroom when nothing says which sibling is which', async () => {
    // Both ticket types unpriced, $340 = 150 + 190 — one multiset, two assignments. Putting
    // the tent price on the classroom camper reconciles to the cent and is still wrong.
    const a = person({ id: 'p1', invoiceNumber: 'INV-211', registrationType: 'Mystery A' });
    const b = person({ id: 'p2', invoiceNumber: 'INV-211', registrationType: 'Mystery B' });
    const { svc, personRepo } = await build([...priced(), a, b]);
    await svc.importInvoicesCsv(actor('admin'), { csvData: `${HDR}\nINV-211,,,,340,,340,,,` });
    const all = await personRepo.findAll();
    for (const id of ['p1', 'p2']) expect(all.find((x) => x.id === id)!.needsReview).toBe(true);
  });

  it('resolves that same invoice once a CONFIRMED accommodation kind picks the assignment', async () => {
    // The price->kind lookup needs >=3 confirmed samples at a price before it is trusted, so
    // seed enough of each. Then the siblings' own confirmed kinds settle who paid what.
    const seeds: Person[] = [];
    for (let i = 0; i < 3; i++) {
      seeds.push(person({ registrationType: 'Classroom Accommodation', registrationCost: 190,
        accommodationKind: 'classroom', accommodationKindConfidence: 'confirmed' }));
      seeds.push(person({ registrationType: 'EARLY BIRD | Tent Accomodation', registrationCost: 150,
        accommodationKind: 'tent', accommodationKindConfidence: 'confirmed' }));
    }
    const a = person({ id: 'p1', invoiceNumber: 'INV-212', registrationType: 'Mystery A',
      accommodationKind: 'classroom', accommodationKindConfidence: 'confirmed' });
    const b = person({ id: 'p2', invoiceNumber: 'INV-212', registrationType: 'Mystery B',
      accommodationKind: 'tent', accommodationKindConfidence: 'confirmed' });
    const { svc, personRepo } = await build([...seeds, a, b]);
    await svc.importInvoicesCsv(actor('admin'), { csvData: `${HDR}\nINV-212,,,,340,,340,,,` });
    const all = await personRepo.findAll();
    const pa = all.find((x) => x.id === 'p1')!;
    const pb = all.find((x) => x.id === 'p2')!;
    expect(pa.registrationCost).toBe(190);
    expect(pb.registrationCost).toBe(150);
    for (const p of [pa, pb]) expect(p.needsReview ?? false).toBe(false);
  });

  it('splits equally and flags for review when a ticket type has no known price', async () => {
    const a = person({ id: 'p1', invoiceNumber: 'INV-201', registrationType: 'Mystery Ticket' });
    const b = person({ id: 'p2', invoiceNumber: 'INV-201', registrationType: 'Mystery Ticket' });
    const { svc, personRepo } = await build([a, b]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-201,,,,500,,500,,,`,
    });
    const all = await personRepo.findAll();
    const pa = all.find((x) => x.id === 'p1')!;
    const pb = all.find((x) => x.id === 'p2')!;
    expect(pa.amountPaid).toBe(250);
    expect(pb.amountPaid).toBe(250);
    for (const p of [pa, pb]) {
      expect(p.needsReview).toBe(true);
      expect(p.needsReviewReason).toContain('split equally');
    }
    expect(res.warnings.some((w) => w.message.includes('EQUALLY'))).toBe(true);
  });

  it('never loses or invents a cent when the split does not divide evenly', async () => {
    // $100 across three equal shares is 33.33/33.33/33.34 — a per-person round() would give
    // $99.99 and the camp total would stop matching the sum of its rows.
    const people = ['p1', 'p2', 'p3'].map((id) =>
      person({ id, invoiceNumber: 'INV-202', registrationType: 'Mystery Ticket' }));
    const { svc, personRepo } = await build(people);
    await svc.importInvoicesCsv(actor('admin'), { csvData: `${HDR}\nINV-202,,,,100,,100,,,` });
    const all = await personRepo.findAll();
    const paid = ['p1', 'p2', 'p3'].map((id) => all.find((x) => x.id === id)!.amountPaid ?? 0);
    expect(paid.reduce((s, v) => s + v, 0)).toBe(100);
    expect(paid.every((v) => v >= 33.33 && v <= 33.34)).toBe(true);
  });

  it('is idempotent — re-importing the same file does not double the split', async () => {
    const a = person({ id: 'p1', invoiceNumber: 'INV-203', registrationType: 'Classroom Accommodation' });
    const b = person({ id: 'p2', invoiceNumber: 'INV-203', registrationType: 'EARLY BIRD | Tent Accomodation' });
    const { svc, personRepo } = await build([...priced(), a, b]);
    const csvData = `${HDR}\nINV-203,,,,340,,340,,,`;
    await svc.importInvoicesCsv(actor('admin'), { csvData });
    await svc.importInvoicesCsv(actor('admin'), { csvData });
    const all = await personRepo.findAll();
    const total = ['p1', 'p2'].reduce((s, id) => s + (all.find((x) => x.id === id)!.amountPaid ?? 0), 0);
    expect(total).toBe(340);
  });
});

describe('InvoiceImportService.importInvoicesCsv — billing-name fallback', () => {
  it('matches by billing-contact name when no invoice number matches, with a verify warning', async () => {
    const target = person({ id: 'p1', firstName: 'Liam', lastName: 'Est' });
    const { svc, personRepo } = await build([target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\n,Liam,Est,,300,,300,,,`,
    });
    expect(res.updated).toBe(1);
    const p = (await personRepo.findAll()).find((x) => x.id === 'p1')!;
    expect(p.registrationCost).toBe(300);
    expect(res.warnings.some((w) => w.message.includes('Matched by billing-contact name only'))).toBe(true);
  });
});

describe('InvoiceImportService.importInvoicesCsv — unmatched invoices (no orphan)', () => {
  it('records an unmatched invoice without creating a Person', async () => {
    const { svc, personRepo } = await build([]);
    const before = await personRepo.findAll();
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-999,Unknown,Payer,,100,,100,,,`,
    });
    expect(res.unmatchedInvoices).toHaveLength(1);
    expect(res.unmatchedInvoices[0]).toMatchObject({
      invoiceNumber: 'INV-999',
      billingName: 'Unknown Payer',
      amountPaid: 100,
      ticketTotal: 100,
    });
    expect(res.created).toBe(0);
    const after = await personRepo.findAll();
    expect(after).toHaveLength(before.length);
  });

  it('rows with no financial data at all are skipped with a warning (not treated as unmatched)', async () => {
    const { svc } = await build([]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-1,,,,,,,,,`,
    });
    expect(res.skipped).toBe(1);
    expect(res.unmatchedInvoices).toHaveLength(0);
    expect(res.warnings.some((w) => w.message.includes('No financial data'))).toBe(true);
  });
});

describe('InvoiceImportService.importInvoicesCsv — accommodation guess', () => {
  function confirmed(kind: Person['accommodationKind'], cost: number, idOver: string): Person {
    return person({
      id: idOver,
      accommodationKind: kind,
      accommodationKindConfidence: 'confirmed',
      registrationCost: cost,
    });
  }

  it('never overwrites an already-confirmed accommodationKind', async () => {
    const samples = [
      confirmed('tent', 300, 's1'),
      confirmed('tent', 300, 's2'),
      confirmed('tent', 300, 's3'),
    ];
    const target = person({
      id: 'target',
      invoiceNumber: 'INV-CONF',
      accommodationKind: 'classroom',
      accommodationKindConfidence: 'confirmed',
    });
    const { svc, personRepo } = await build([...samples, target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-CONF,,,,300,,300,,,`,
    });
    const p = (await personRepo.findAll()).find((x) => x.id === 'target')!;
    expect(p.accommodationKind).toBe('classroom');
    expect(p.accommodationKindConfidence).toBe('confirmed');
    expect(res.guessedAccommodationCount).toBe(0);
  });

  it('does NOT guess when there are too few samples at that price', async () => {
    const samples = [confirmed('tent', 400, 's1'), confirmed('tent', 400, 's2')]; // only 2, default minSample=3
    const target = person({ id: 'target', invoiceNumber: 'INV-FEW' });
    const { svc, personRepo } = await build([...samples, target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-FEW,,,,400,,400,,,`,
    });
    const p = (await personRepo.findAll()).find((x) => x.id === 'target')!;
    expect(p.accommodationKind).toBeUndefined();
    expect(res.guessedAccommodationCount).toBe(0);
  });

  it('does NOT guess when enough samples exist but below the majority ratio', async () => {
    const samples = [
      confirmed('tent', 500, 's1'),
      confirmed('tent', 500, 's2'),
      confirmed('classroom', 500, 's3'),
    ]; // 3 samples (meets minSample) but majority ratio is 2/3 ≈ 0.667 < default 0.9
    const target = person({ id: 'target', invoiceNumber: 'INV-SPLIT' });
    const { svc, personRepo } = await build([...samples, target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-SPLIT,,,,500,,500,,,`,
    });
    const p = (await personRepo.findAll()).find((x) => x.id === 'target')!;
    expect(p.accommodationKind).toBeUndefined();
    expect(res.guessedAccommodationCount).toBe(0);
  });

  it('guesses accommodationKind when sample size and majority thresholds are met', async () => {
    const samples = [
      confirmed('classroom', 600, 's1'),
      confirmed('classroom', 600, 's2'),
      confirmed('classroom', 600, 's3'),
    ];
    const target = person({ id: 'target', invoiceNumber: 'INV-GUESS' });
    const { svc, personRepo } = await build([...samples, target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-GUESS,,,,600,,600,,,`,
    });
    const p = (await personRepo.findAll()).find((x) => x.id === 'target')!;
    expect(p.accommodationKind).toBe('classroom');
    expect(p.accommodationKindConfidence).toBe('guessed');
    expect(res.guessedAccommodationCount).toBe(1);
  });
});

describe('InvoiceImportService.importInvoicesCsv — never deletes, dry-run', () => {
  it('never deletes anyone (created/deleted are always 0)', async () => {
    const target = person({ id: 'p1', invoiceNumber: 'INV-1' });
    const other = person({ id: 'p2', firstName: 'Other', lastName: 'Person' });
    const { svc, personRepo } = await build([target, other]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-1,,,,100,,100,,,`,
    });
    expect(res.created).toBe(0);
    expect(res.deleted).toBe(0);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(2);
  });

  it('dry-run makes no changes to the repo', async () => {
    const target = person({ id: 'p1', invoiceNumber: 'INV-1' });
    const { svc, personRepo } = await build([target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-1,,,,100,,100,,,`,
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.updated).toBe(1); // counted, but not persisted
    const p = (await personRepo.findAll()).find((x) => x.id === 'p1')!;
    expect(p.registrationCost).toBeUndefined();
  });
});

describe('InvoiceImportService.importInvoicesCsv — negative amounts', () => {
  it('parses a negative discount amount correctly via parseMoney', async () => {
    const target = person({ id: 'p1', invoiceNumber: 'INV-NEG' });
    const { svc, personRepo } = await build([target]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: `${HDR}\nINV-NEG,,,,100,-15.50,84.50,,,`,
    });
    expect(res.updated).toBe(1);
    const p = (await personRepo.findAll()).find((x) => x.id === 'p1')!;
    expect(p.discountAmount).toBe(-15.5);
  });
});

/* Item A (2026-07-28) — THE WRONG-TICKET / PAY-THE-DIFFERENCE CASE.
   Someone buys a $150 ticket, is told to buy the correct $190 one with a code covering what they
   already paid, and pays the $40 difference. That's two invoice rows for one registrant. The old
   behaviour was last-row-wins, so the budget recorded only whichever row came second. */
describe('invoice-import: multiple invoices for one person (item A)', () => {
  const twoInvoices = [
    HDR,
    'INV-1,Robin,Thompson,0400000001,150,0,150,0,0,',
    'INV-2,Robin,Thompson,0400000001,190,150,40,0,0,TOPUP150',
  ].join('\n');

  it('sums amount paid and discount across both invoices, and takes the LATEST ticket total', async () => {
    const { svc, personRepo } = await build([
      person({ id: 'ivy', firstName: 'Robin', lastName: 'Thompson', invoiceNumber: 'INV-1' }),
    ]);
    // Both rows resolve to the same person: INV-1 by invoice number, INV-2 by billing name.
    await svc.importInvoicesCsv(actor('admin'), { csvData: twoInvoices });
    const p = (await personRepo.findAll())[0]!;
    expect(p.amountPaid).toBe(190);          // 150 + 40 — what they actually paid
    expect(p.discountAmount).toBe(150);      // 0 + 150
    expect(p.registrationCost).toBe(190);    // the corrected ticket they're attending on
    expect(p.discountCode).toBe('TOPUP150');
  });

  it('flags the person for review and warns, so the budget is not silently trusted', async () => {
    const { svc, personRepo } = await build([
      person({ id: 'ivy', firstName: 'Robin', lastName: 'Thompson', invoiceNumber: 'INV-1' }),
    ]);
    const res = await svc.importInvoicesCsv(actor('admin'), { csvData: twoInvoices });
    expect(res.warnings.some((w) => /2 invoices in this file/i.test(w.message))).toBe(true);
    const p = (await personRepo.findAll())[0]!;
    expect(p.needsReview).toBe(true);
    expect(p.needsReviewReason).toMatch(/Multiple invoices/i);
  });

  it('is idempotent — re-importing the same file does NOT double-count', async () => {
    const { svc, personRepo } = await build([
      person({ id: 'ivy', firstName: 'Robin', lastName: 'Thompson', invoiceNumber: 'INV-1' }),
    ]);
    await svc.importInvoicesCsv(actor('admin'), { csvData: twoInvoices });
    await svc.importInvoicesCsv(actor('admin'), { csvData: twoInvoices });
    const p = (await personRepo.findAll())[0]!;
    expect(p.amountPaid).toBe(190);   // NOT 380 — accumulation starts from the file, not the row
    expect(p.discountAmount).toBe(150);
  });

  it('a single invoice is unchanged — no review flag, values taken straight from the row', async () => {
    const { svc, personRepo } = await build([
      person({ id: 'solo', firstName: 'Robin', lastName: 'Thompson', invoiceNumber: 'INV-1' }),
    ]);
    await svc.importInvoicesCsv(actor('admin'), {
      csvData: [HDR, 'INV-1,Robin,Thompson,0400000001,190,0,190,0,0,'].join('\n'),
    });
    const p = (await personRepo.findAll())[0]!;
    expect(p.amountPaid).toBe(190);
    expect(p.needsReview).toBe(false);
  });
});

/* Item 12 (2026-07-28): a trailing blank line is spreadsheet padding, not a defect — it used to
   surface as a "Missing firstName or lastName"-class error on a file that imported perfectly. */
describe('invoice-import: blank padding rows (item 12)', () => {
  it('skips an entirely-blank row without reporting an error or a warning', async () => {
    const { svc } = await build([person({ id: 'x', invoiceNumber: 'INV-9' })]);
    const res = await svc.importInvoicesCsv(actor('admin'), {
      csvData: [HDR, 'INV-9,Robin,Thompson,0400000001,190,0,190,0,0,', ',,,,,,,,,'].join('\n'),
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(1);
  });
});
