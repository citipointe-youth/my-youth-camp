import { describe, it, expect } from 'vitest';
import { makeImportService } from './import.service';
import { makeTicketImportService } from './ticket-import.service';
import { makeInvoiceImportService } from './invoice-import.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

// ---------------------------------------------------------------------------
// Real-sample integration test — runs the ACTUAL three Elvanto exports the
// user supplied on 2026-07-02 (Form Submissions, Ticket List, Billing
// Contacts/Invoice) through all three importers in sequence, verifying the
// end-to-end pipeline against real column headers and real data quirks:
//   - Ticket List's real headers differ from the original guesses ("Event
//     Occurrence information" not "Event Occurrence", "Invoice Payment
//     Status" not "Payment Status") and include a "Ticket Status" column
//     not anticipated at design time (only "Active" tickets should count).
//   - Ticket Type values are "Classroom Accommodation" / "EARLY BIRD | Tent
//     Accomodation" (sic) — substring-matched, not exact.
//   - The Invoice export's billing-contact name is very often a PARENT, not
//     the registrant (e.g. invoice for "REDACTED" covers attendee
//     "REDACTED") — proving why invoice-number matching must be tier 1,
//     not the name fallback.
//   - Invoice headers differ from the original guesses too ("Fees Paid" not
//     "Fees", "Total Tax" not "Tax", plain "First Name"/"Last Name" not
//     "Billing First Name").
// ---------------------------------------------------------------------------

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

const FORM_CSV = `Date Submitted,Submission Status,Person,Person Status,First Name,Last Name,Gender,Date of Birth,School Grade,Mobile Number,Email Address,Suburb,Postcode,State,Medicare Number,Medical Conditions,Dietary Requirements,List Other Medical Conditions or Medication Taken,Attendee's Church,"If from a church not listed, please specify church name & Youth Pastor",Blue Card/Working with Children Card Number,Blue Card/Working with Children Card Expiry,I give medical consent for my child as listed above.,I give photography and video consent for my child as listed above.,I understand and agree to the Supervision policy.,Parent/Guardian Name,Relation to Child,Parent/Guardian Phone Number,Today's Date
30/06/2026,Pending,"REDACTED, REDACTED",Pending,REDACTED,REDACTED,Female,01/01/2000,9,0400000000,redacted@example.com,REDACTED,4502,QLD,0000000000,REDACTED,None,,REDACTED Church,,,,Yes,Yes,Yes,Jacqueline REDACTED,Mother,0400000000,30/06/2026
30/06/2026,Pending,,Pending,REDACTED,REDACTED,Male,01/01/2000,12,0400000000,redacted@example.com,REDACTED,4129,Qld,0000000000,,,,REDACTED Church,,,,Yes,Yes,Yes,Chrisa REDACTED,Father,0400000000,30/06/2026
29/06/2026,Pending,"REDACTED, REDACTED",Pending,REDACTED,REDACTED,Male,2000-01-01,18+ Leader,0400000000,redacted@example.com,REDACTED,4670,QLD,0000000000,,,,REDACTED Church,,0000000/0,15/11/2028,Yes,Yes,Yes,REDACTED REDACTED,myself,0400000000,29/06/2026
`;

const TICKET_CSV = `Ticket Number,Ticket Type,Invoice Number,Event Occurrence information,Last Name,First Name,Phone,Invoice Payment Status,Ticket Status
31318,Classroom Accommodation,022243,,REDACTED,REDACTED,0400000000,Paid,Active
31317,EARLY BIRD | Tent Accomodation,022242,,REDACTED,REDACTED,0400000000,Paid,Active
31316,EARLY BIRD | Tent Accomodation,022241,,REDACTED,REDACTED,0400000000,Paid,Active
`;

const INVOICE_CSV = `Invoice Number,Event Name,Last Name,First Name,Email,Phone,Home Address,Home Address City,Home Address State,Home Address Postcode,Home Address Country,Mailing Address,Mailing Address City,Mailing Address State,Mailing Address Postcode,Mailing Address Country,Payment Method,Invoice Date,Invoice Status,Registrants,Amount Paid,Ticket Total,Discount Total,Fees Paid,Total Tax,Tax Type,Total,Total Due,Transaction Total,Discount Code
022243,YOUTH CAMP 2026 - PREPARE THE WAY,REDACTED,REDACTED,redacted@example.com,,,,,,,,,,,,,30/06/2026 21:18,Paid,1,190,190,0,0,0,Inclusive,190,0,190,
022242,YOUTH CAMP 2026 - PREPARE THE WAY,REDACTED,Chrisa,redacted@example.com,,,,,,,,,,,,,30/06/2026 5:05,Paid,1,150,150,0,0,0,Inclusive,150,0,150,
022241,YOUTH CAMP 2026 - PREPARE THE WAY,REDACTED,REDACTED,redacted@example.com,,,,,,,,,,,,,29/06/2026 15:03,Paid,1,0,150,150,0,0,Inclusive,0,0,0,ALIVE100
`;

async function build() {
  const personRepo = new InMemoryPersonRepository();
  const churchRepo = new InMemoryChurchRepository();
  const overrideRepo = new InMemoryAllocationOverrideRepository();
  await personRepo.init();
  await churchRepo.init();
  await overrideRepo.init();
  return {
    personRepo,
    churchRepo,
    formSvc: makeImportService(personRepo, churchRepo, overrideRepo),
    ticketSvc: makeTicketImportService(personRepo, churchRepo),
    invoiceSvc: makeInvoiceImportService(personRepo),
  };
}

describe('Multi-source import — real 2026-07-02 sample files, run in sequence (Form -> Ticket -> Invoice)', () => {
  it('creates 3 registrants from the real Form export, auto-creating their churches', async () => {
    const { formSvc, personRepo, churchRepo } = await build();
    const res = await formSvc.importCsv(actor('admin'), { csvData: FORM_CSV });
    expect(res).toMatchObject({ created: 3, updated: 0, skipped: 0, errors: [] });
    const people = await personRepo.findAll();
    expect(people).toHaveLength(3);
    const churches = await churchRepo.findAll();
    expect(churches.map((c) => c.name).sort()).toEqual(
      ['REDACTED Church', 'REDACTED Church', 'REDACTED Church'].sort(),
    );
    const redactedPerson2 = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson2.kind).toBe('leader'); // "18+ Leader" School Grade
  });

  it('the real Ticket List file matches all 3 by name (cross-church) and sets confirmed accommodation', async () => {
    const { formSvc, ticketSvc, personRepo } = await build();
    await formSvc.importCsv(actor('admin'), { csvData: FORM_CSV });
    const res = await ticketSvc.importTicketsCsv(actor('admin'), { csvData: TICKET_CSV });
    // All 3 real rows match an existing person by (cross-church) name — no orphans, no skips.
    expect(res).toMatchObject({ created: 0, updated: 3, skipped: 0, errors: [] });

    const people = await personRepo.findAll();
    expect(people).toHaveLength(3); // no orphans created

    const redactedPerson = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson.accommodationKind).toBe('classroom'); // "Classroom Accommodation"
    expect(redactedPerson.accommodationKindConfidence).toBe('confirmed');
    expect(redactedPerson.ticketNumber).toBe('31318');
    expect(redactedPerson.invoiceNumber).toBe('022243');
    expect(redactedPerson.paymentStatus).toBe('paid');

    const redactedPerson3 = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson3.accommodationKind).toBe('tent'); // "EARLY BIRD | Tent Accomodation" (real misspelling)
    expect(redactedPerson3.accommodationKindConfidence).toBe('confirmed');
    expect(redactedPerson3.ticketNumber).toBe('31317');
    expect(redactedPerson3.invoiceNumber).toBe('022242');

    const redactedPerson2 = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson2.accommodationKind).toBe('tent');
    expect(redactedPerson2.ticketNumber).toBe('31316');
    expect(redactedPerson2.invoiceNumber).toBe('022241');
  });

  it('a non-Active Ticket Status is skipped, not treated as confirmed truth', async () => {
    const { formSvc, ticketSvc, personRepo } = await build();
    await formSvc.importCsv(actor('admin'), { csvData: FORM_CSV });
    const cancelledCsv = TICKET_CSV.replace(
      '31318,Classroom Accommodation,022243,,REDACTED,REDACTED,0400000000,Paid,Active',
      '31318,Classroom Accommodation,022243,,REDACTED,REDACTED,0400000000,Paid,Cancelled',
    );
    const res = await ticketSvc.importTicketsCsv(actor('admin'), { csvData: cancelledCsv });
    expect(res.skipped).toBe(1); // the cancelled row
    expect(res.updated).toBe(2); // the other two still import
    expect(res.warnings.some((w) => /Ticket Status "Cancelled" is not Active/.test(w.message))).toBe(true);
    const redactedPerson = (await personRepo.findAll()).find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson.accommodationKind).toBeNull(); // untouched — cancelled ticket never wrote it
  });

  it('the real Billing Contacts file attributes money to the RIGHT registrant via invoice number, even though the billing contact is a different-named parent', async () => {
    const { formSvc, ticketSvc, invoiceSvc, personRepo } = await build();
    await formSvc.importCsv(actor('admin'), { csvData: FORM_CSV });
    await ticketSvc.importTicketsCsv(actor('admin'), { csvData: TICKET_CSV });
    const res = await invoiceSvc.importInvoicesCsv(actor('admin'), { csvData: INVOICE_CSV });
    // All 3 real rows resolve via tier-1 invoiceNumber match (set by the Ticket List import
    // above) — the billing-contact-name fallback (tier 2) is never needed, which is exactly
    // right since "REDACTED REDACTED" (the billing contact) is NOT "REDACTED REDACTED" (the
    // registrant) and would otherwise risk a wrong/ambiguous name-only match.
    expect(res).toMatchObject({
      created: 0, updated: 3, skipped: 0, deleted: 0, ambiguousGroupInvoices: 0, errors: [],
    });
    expect(res.warnings.some((w) => /billing-contact name only/.test(w.message))).toBe(false);

    const people = await personRepo.findAll();
    const redactedPerson = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson.registrationCost).toBe(190);
    expect(redactedPerson.amountPaid).toBe(190);
    expect(redactedPerson.discountAmount).toBe(0);
    expect(redactedPerson.feesAmount).toBe(0);
    expect(redactedPerson.taxAmount).toBe(0);
    // accommodationKind was already 'confirmed' via Ticket List — Invoice must not touch it.
    expect(redactedPerson.accommodationKind).toBe('classroom');
    expect(redactedPerson.accommodationKindConfidence).toBe('confirmed');

    const redactedPerson2 = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson2.registrationCost).toBe(150);
    expect(redactedPerson2.discountAmount).toBe(150); // ALIVE100 — fully discounted
    expect(redactedPerson2.amountPaid).toBe(0);
    expect(redactedPerson2.discountCode).toBe('ALIVE100');
  });

  it('full pipeline (Form -> Ticket -> Invoice) leaves all 3 real registrants fully reconciled with no orphans and nothing flagged for review', async () => {
    const { formSvc, ticketSvc, invoiceSvc, personRepo } = await build();
    await formSvc.importCsv(actor('admin'), { csvData: FORM_CSV });
    await ticketSvc.importTicketsCsv(actor('admin'), { csvData: TICKET_CSV });
    await invoiceSvc.importInvoicesCsv(actor('admin'), { csvData: INVOICE_CSV });

    const people = await personRepo.findAll();
    expect(people).toHaveLength(3);
    for (const p of people) {
      expect(p.needsReview).toBe(false);
      expect(p.accommodationKind).not.toBeNull();
      expect(p.accommodationKindConfidence).toBe('confirmed');
      expect(p.ticketNumber).not.toBeNull();
      expect(p.invoiceNumber).not.toBeNull();
      expect(p.registrationCost).not.toBeNull();
      expect(p.paymentStatus).toBe('paid');
      // grade/gender/medical (Form-owned) survive both later imports untouched.
      expect(p.gender).not.toBe('other'); // both real students/leader have a real Gender value
    }
  });

  /** Reverse a CSV's data rows while keeping the header on line 1 — matching is by name/
   * invoice-number key, never row position, so this must produce identical results. */
  function reverseRows(csv: string): string {
    const lines = csv.trim().split('\n');
    const [header, ...rows] = lines;
    return [header, ...rows.reverse()].join('\n') + '\n';
  }

  it('row order within (and matching across) the three CSVs does not affect matching — reversing every file yields the identical fully-reconciled result', async () => {
    const { formSvc, ticketSvc, invoiceSvc, personRepo } = await build();
    await formSvc.importCsv(actor('admin'), { csvData: reverseRows(FORM_CSV) });
    await ticketSvc.importTicketsCsv(actor('admin'), { csvData: reverseRows(TICKET_CSV) });
    await invoiceSvc.importInvoicesCsv(actor('admin'), { csvData: reverseRows(INVOICE_CSV) });

    const people = await personRepo.findAll();
    expect(people).toHaveLength(3); // no orphans, no duplicates from the reordering

    const redactedPerson = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson.accommodationKind).toBe('classroom');
    expect(redactedPerson.registrationCost).toBe(190);
    expect(redactedPerson.amountPaid).toBe(190);

    const redactedPerson3 = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson3.accommodationKind).toBe('tent');
    expect(redactedPerson3.registrationCost).toBe(150);

    const redactedPerson2 = people.find((p) => p.firstName === 'REDACTED')!;
    expect(redactedPerson2.kind).toBe('leader');
    expect(redactedPerson2.accommodationKind).toBe('tent');
    expect(redactedPerson2.discountCode).toBe('ALIVE100');
    expect(redactedPerson2.amountPaid).toBe(0);

    for (const p of people) {
      expect(p.needsReview).toBe(false);
      expect(p.accommodationKindConfidence).toBe('confirmed');
    }
  });
});
