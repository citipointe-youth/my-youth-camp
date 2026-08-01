import { describe, it, expect, beforeEach } from 'vitest';
import { makeImportService, type ImportService } from './import.service';
import { makeInvoiceImportService, type InvoiceImportService } from './invoice-import.service';
import {
  InMemoryPersonRepository,
  InMemoryChurchRepository,
  InMemoryAllocationOverrideRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import type { Church } from '../core/entities/church';

/**
 * Item 7 (2026-07-31) — the same student registered TWICE, the second time to upgrade from a
 * tent to a classroom, paying only the difference with a code.
 *
 * Two halves:
 *  - FORM: the later submission wins field-by-field, and a blank cell in it must not wipe a
 *    value the earlier one had. That only works if the rows are processed in submission order,
 *    which the Elvanto export does NOT guarantee — hence the sort.
 *  - INVOICE: the money ACCUMULATES (original ticket + the delta), so the budget shows what was
 *    really paid rather than whichever row happened to land second.
 */

const NOW = '2026-01-01T00:00:00.000Z';

const admin: Actor = {
  id: 'u-admin', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin',
};

function church(): Church {
  return {
    id: 'c1',
    name: 'Victory Church',
    zone: 'Yellow',
    contacts: {
      male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
      female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const HEADERS =
  'First Name,Last Name,Gender,School Grade,Mobile Number,' +
  "Attendee's Church,Date Submitted,Type,Medical Conditions";

/** The upgrade submission is listed FIRST in the file but was submitted LATER. */
const OUT_OF_ORDER =
  `${HEADERS}\n` +
  'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-02,Classroom,\n' +
  'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01,Tent,Asthma\n';

describe('duplicate registrations — Form import', () => {
  let people: InMemoryPersonRepository;
  let churches: InMemoryChurchRepository;
  let svc: ImportService;

  beforeEach(async () => {
    people = new InMemoryPersonRepository();
    churches = new InMemoryChurchRepository();
    const overrides = new InMemoryAllocationOverrideRepository();
    await Promise.all([people.init(), churches.init(), overrides.init()]);
    await churches.save(church());
    svc = makeImportService(people, churches, overrides);
  });

  it('the LATER submission wins even when it is listed first in the file', async () => {
    await svc.importCsv(admin, { csvData: OUT_OF_ORDER });
    const all = await people.findAll();
    expect(all).toHaveLength(1);
    // Row order alone would have left the tent (last row); submission order gives the upgrade.
    expect(all[0]!.accommodationKind).toBe('classroom');
  });

  it('a blank cell in the later submission keeps the earlier value', async () => {
    // The upgrade row has no Medical Conditions cell; the original recorded "Asthma".
    // Losing a medical condition to a re-registration is the worst outcome here.
    await svc.importCsv(admin, { csvData: OUT_OF_ORDER });
    const all = await people.findAll();
    expect(all[0]!.medicalConditions).toEqual(['Asthma']);
  });

  it('warns that the person appears twice, quoting the ORIGINAL spreadsheet line', async () => {
    const res = await svc.importCsv(admin, { csvData: OUT_OF_ORDER });
    const dup = res.warnings.filter((w) => /appears 2 times/.test(w.message));
    expect(dup).toHaveLength(1);
    // The upgrade row is line 2 of the file; after sorting it is processed second. The warning
    // must point at the line the admin can actually find in their spreadsheet.
    expect(dup[0]!.row).toBe(2);
  });

  it('creates ONE person, not two', async () => {
    const res = await svc.importCsv(admin, { csvData: OUT_OF_ORDER });
    expect(res.created).toBe(1);
    expect(await people.findAll()).toHaveLength(1);
  });

  it('a file with no Date Submitted column keeps its original row order', async () => {
    const noDate =
      "First Name,Last Name,Gender,School Grade,Attendee's Church,Type\n" +
      'Ivy,Thompson,Female,Year 9,Victory Church,Tent\n' +
      'Ivy,Thompson,Female,Year 9,Victory Church,Classroom\n';
    const res = await svc.importCsv(admin, { csvData: noDate });
    const all = await people.findAll();
    expect(all).toHaveLength(1);
    // Last row wins, exactly as before the sort existed — regression guard: no Date Submitted
    // column must not perturb file order in any way.
    expect(all[0]!.accommodationKind).toBe('classroom');
    // With no dates at all, both rows tie on the (empty) sort key — order could not be
    // determined from the file, and the admin must be told that explicitly.
    const dup = res.warnings.filter((w) => /appears 2 times/.test(w.message));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toMatch(/could NOT be used to determine/);
  });

  it('same-day duplicates (no time component) warn that order could not be determined', async () => {
    // Both rows share the exact same date, no time — the sort key ties, so "most recent wins"
    // cannot actually be applied even though the sort ran without error.
    const sameDay =
      `${HEADERS}\n` +
      'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01,Tent,Asthma\n' +
      'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01,Classroom,\n';
    const res = await svc.importCsv(admin, { csvData: sameDay });
    const dup = res.warnings.filter((w) => /appears 2 times/.test(w.message));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toMatch(/could NOT be used to determine which submission is most recent/);
    expect(dup[0]!.message).toMatch(/Check the ticket type and cost by hand/);
  });

  it('a dated-with-time file orders same-day submissions correctly within the day', async () => {
    // Same calendar day, but the second submission carries a later TIME — the upgrade must
    // still win, and this time the file genuinely does tell us so (no "could not determine").
    const sameDayWithTime =
      `${HEADERS}\n` +
      'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01 09:00,Tent,Asthma\n' +
      'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01 14:32,Classroom,\n';
    const res = await svc.importCsv(admin, { csvData: sameDayWithTime });
    const all = await people.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.accommodationKind).toBe('classroom');
    // Blank cell in the later (14:32) row must not clobber the earlier "Asthma" value.
    expect(all[0]!.medicalConditions).toEqual(['Asthma']);
    const dup = res.warnings.filter((w) => /appears 2 times/.test(w.message));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).not.toMatch(/could NOT be used to determine/);
  });

  it('a dated-with-time file orders correctly even when listed out of order in the file', async () => {
    // The later (16:00) submission is listed FIRST in the file — only the time-aware sort
    // key, not row position, should determine the winner.
    const outOfOrderWithTime =
      `${HEADERS}\n` +
      'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01T16:00:00,Classroom,\n' +
      'Ivy,Thompson,Female,Year 9,0411928301,Victory Church,2026-08-01T08:15:00,Tent,Asthma\n';
    await svc.importCsv(admin, { csvData: outOfOrderWithTime });
    const all = await people.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.accommodationKind).toBe('classroom');
    expect(all[0]!.medicalConditions).toEqual(['Asthma']);
  });
});

describe('duplicate registrations — Invoice import (the delta payment)', () => {
  let people: InMemoryPersonRepository;
  let svc: InvoiceImportService;

  beforeEach(async () => {
    people = new InMemoryPersonRepository();
    await people.init();
    svc = makeInvoiceImportService(people);
    await people.save({
      id: 'p1',
      firstName: 'Ivy',
      lastName: 'Thompson',
      gender: 'female',
      kind: 'youth',
      churchId: 'c1',
      churchName: 'Victory Church',
      zone: 'Yellow',
      invoiceNumber: null,
      lifecycle: 'registered',
      atCamp: false,
      needsReview: false,
      checkInHistory: [],
      signOutHistory: [],
      medicalConditions: [],
      dietaryRequirements: [],
      createdAt: NOW,
      updatedAt: NOW,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('sums the original ticket and the upgrade delta rather than taking the last row', async () => {
    const csv =
      'First Name,Last Name,Ticket Total,Amount Paid,Discount Total\n' +
      'Ivy,Thompson,150,150,0\n' +
      'Ivy,Thompson,190,40,150\n';
    await svc.importInvoicesCsv(admin, { csvData: csv });
    const p = await people.findById('p1');
    // Paid 150 then 40 = 190 in total. Last-row-wins would have reported 40.
    expect(p!.amountPaid).toBe(190);
    // registrationCost takes the LATEST row — the corrected ticket they are attending on.
    expect(p!.registrationCost).toBe(190);
  });

  it('flags the person for review so the budget is not silently trusted', async () => {
    const csv =
      'First Name,Last Name,Ticket Total,Amount Paid\n' +
      'Ivy,Thompson,150,150\n' +
      'Ivy,Thompson,190,40\n';
    await svc.importInvoicesCsv(admin, { csvData: csv });
    const p = await people.findById('p1');
    expect(p!.needsReview).toBe(true);
    expect(p!.needsReviewReason).toMatch(/Multiple invoices/);
  });

  it('is idempotent — re-importing the same file does NOT double-count', async () => {
    const csv =
      'First Name,Last Name,Ticket Total,Amount Paid\n' +
      'Ivy,Thompson,150,150\n' +
      'Ivy,Thompson,190,40\n';
    await svc.importInvoicesCsv(admin, { csvData: csv });
    await svc.importInvoicesCsv(admin, { csvData: csv });
    const p = await people.findById('p1');
    expect(p!.amountPaid).toBe(190);
  });
});
