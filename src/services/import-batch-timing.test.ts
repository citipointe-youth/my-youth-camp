import { describe, it, expect } from 'vitest';
import { makeImportService } from './import.service';
import { makeTicketImportService } from './ticket-import.service';
import { makeInvoiceImportService } from './invoice-import.service';
import { makeImportBatchService } from './import-batch.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

// I2 risk (IA OQ-22): POST /import/batch preview must fit Vercel's 30 s maxDuration at full camp
// size. In-memory is faster than Supabase, so the budget here is a third of the limit.
const ROWS = 1425;
const BUDGET_MS = 10_000;
const admin = { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin' } as Actor;

const FORM_HEAD = `Date Submitted,Submission Status,Person,Person Status,First Name,Last Name,Gender,Date of Birth,School Grade,Mobile Number,Email Address,Suburb,Postcode,State,Medicare Number,Medical Conditions,Dietary Requirements,List Other Medical Conditions or Medication Taken,Attendee's Church,"If from a church not listed, please specify church name & Youth Pastor",Blue Card/Working with Children Card Number,Blue Card/Working with Children Card Expiry,I give medical consent for my child as listed above.,I give photography and video consent for my child as listed above.,I understand and agree to the Supervision policy.,Parent/Guardian Name,Relation to Child,Parent/Guardian Phone Number,Today's Date`;
const TICKET_HEAD = 'Ticket Number,Ticket Type,Invoice Number,Event Occurrence information,Last Name,First Name,Phone,Invoice Payment Status,Ticket Status';
const INVOICE_HEAD = 'Invoice Number,Event Name,Last Name,First Name,Email,Phone,Home Address,Home Address City,Home Address State,Home Address Postcode,Home Address Country,Mailing Address,Mailing Address City,Mailing Address State,Mailing Address Postcode,Mailing Address Country,Payment Method,Invoice Date,Invoice Status,Registrants,Amount Paid,Ticket Total,Discount Total,Fees Paid,Total Tax,Tax Type,Total,Total Due,Transaction Total,Discount Code';

const FIRST = ['Ivy', 'Noah', 'Micah', 'Ella', 'Jack', 'Mia', 'Liam', 'Zoe', 'Ben', 'Ruby', 'Sam', 'Hannah', 'Caleb', 'Grace', 'Josh', 'Abby', 'Luke', 'Lily', 'Ethan', 'Chloe'];
const LAST = ['Thompson', 'Whitfield', 'Sol', 'Nguyen', 'Patel', 'Kowalski', 'Bennett', 'Okafor', 'Lindqvist', 'Moretti', 'Hughes', 'Tran', 'Alvarez', 'Fraser', 'Ng', 'Donovan', 'Reyes', 'Walsh', 'Sato', 'Murphy'];
const CHURCHES = Array.from({ length: 40 }, (_, i) => `Sample Church ${i + 1}`);

function fixture() {
  const form = [FORM_HEAD], tickets = [TICKET_HEAD], invoices = [INVOICE_HEAD];
  for (let i = 0; i < ROWS; i++) {
    const first = FIRST[i % FIRST.length], last = `${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i}`;
    const grade = 7 + (i % 6);
    const dob = `${String(1 + (i % 28)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/${2026 - grade - 6}`;
    const phone = `04${String(10000000 + i * 7)}`;
    const inv = String(100000 + i);
    form.push(`30/06/2026,Pending,"${last}, ${first}",Pending,${first},${last},${i % 2 ? 'Female' : 'Male'},${dob},${grade},${phone},${first}.${last}@example.com,Fakeville,4000,QLD,${1234567890 + i},${i % 9 ? '' : 'Asthma'},${i % 11 ? 'None' : 'Vegetarian'},,${CHURCHES[i % CHURCHES.length]},,,,Yes,Yes,Yes,Parent ${last},Mother,${phone},30/06/2026`);
    tickets.push(`${200000 + i},${i % 3 ? 'Classroom Accommodation' : 'EARLY BIRD | Tent Accomodation'},${inv},,${last},${first},${phone},Paid,Active`);
    invoices.push(`${inv},SAMPLE YOUTH CAMP 2026,Parent${last},Robin,parent.${last}@example.com,,,,,,,,,,,,,30/06/2026 21:18,Paid,1,190,190,0,0,0,Inclusive,190,0,190,`);
  }
  return { form: form.join('\n') + '\n', tickets: tickets.join('\n') + '\n', invoices: invoices.join('\n') + '\n' };
}

async function build() {
  const people = new InMemoryPersonRepository(), churches = new InMemoryChurchRepository(), overrides = new InMemoryAllocationOverrideRepository();
  await Promise.all([people.init(), churches.init(), overrides.init()]);
  const form = makeImportService(people, churches, overrides);
  const tickets = makeTicketImportService(people, churches);
  const invoices = makeInvoiceImportService(people);
  return { people, form, tickets, invoices, batch: makeImportBatchService({ people, churches, overrides }, { form, tickets, invoices }) };
}

describe('POST /import/batch preview at full camp size', () => {
  it(`previews ${ROWS} Form + Ticket + Invoice rows inside ${BUDGET_MS} ms, on an empty DB and on a populated one`, async () => {
    const csv = fixture();
    const files = [
      { type: 'form' as const, csvData: csv.form },
      { type: 'tickets' as const, csvData: csv.tickets },
      { type: 'invoices' as const, csvData: csv.invoices },
    ];
    const { batch, form, people } = await build();

    let t = performance.now();
    const empty = await batch.previewBatch(admin, { files });
    const emptyMs = performance.now() - t;
    expect(empty.results.map((r) => r.type)).toEqual(['form', 'tickets', 'invoices']);
    expect(empty.results.every((r) => !('error' in r))).toBe(true);
    expect((empty.results[0] as { result: { created: number } }).result.created).toBe(ROWS);
    expect((empty.results[1] as { result: { updated: number; orphansCreated: unknown[] } }).result).toMatchObject({ updated: ROWS, orphansCreated: [] }); // tickets match the staged Form people
    expect(await people.findAll()).toHaveLength(0); // preview wrote nothing

    await form.importCsv(admin, { csvData: csv.form, dryRun: false });
    expect(await people.findAll()).toHaveLength(ROWS);
    t = performance.now();
    const populated = await batch.previewBatch(admin, { files, updateExisting: true });
    const populatedMs = performance.now() - t;
    expect(populated.results.every((r) => !('error' in r))).toBe(true);

    console.log(`[I2 timing] ${ROWS} rows x3 files: empty DB ${Math.round(emptyMs)} ms, populated DB ${Math.round(populatedMs)} ms`);
    expect(emptyMs).toBeLessThan(BUDGET_MS);
    expect(populatedMs).toBeLessThan(BUDGET_MS);
  }, 60_000);
});
