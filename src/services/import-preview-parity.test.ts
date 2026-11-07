import { describe, it, expect } from 'vitest';
import { makeImportService } from './import.service';
import { makeTicketImportService } from './ticket-import.service';
import { makeInvoiceImportService } from './invoice-import.service';
import { makeImportBatchService } from './import-batch.service';
import { ForbiddenError } from '../core/errors/app-error';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import type { Church } from '../core/entities/church';
import { CONSENT_COLUMNS } from './elvanto-mapping';

// ---------------------------------------------------------------------------
// I2 regression: a dry-run preview reports exactly what the commit does. The only allowed
// differences are the preview's names for a new church (`church-would-be-created` /
// `phantomChurches` vs `church-created` / `churchesCreated`) and the `dryRun` flag.
// ---------------------------------------------------------------------------

const admin: Actor = { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin' };
const C = CONSENT_COLUMNS.join(',');

function church(id: string, name: string): Church {
  const now = '2026-01-01T00:00:00.000Z';
  const blank = { name: '', phone: '' };
  return { id, name, zone: 'Blue', contacts: { male: { primary: blank, backup: blank }, female: { primary: blank, backup: blank } }, createdAt: now, updatedAt: now };
}

async function world() {
  const people = new InMemoryPersonRepository();
  const churches = new InMemoryChurchRepository();
  const overrides = new InMemoryAllocationOverrideRepository();
  await people.init(); await churches.init(); await overrides.init();
  await churches.save(church('c1', 'Victory'));
  return {
    people, churches,
    form: makeImportService(people, churches, overrides),
    ticket: makeTicketImportService(people, churches),
    invoice: makeInvoiceImportService(people),
  };
}

// Normalise a result so the preview and the commit can be compared field for field.
function norm(r: Record<string, unknown>) {
  const { dryRun: _d, phantomChurches, churchesCreated, warnings, ...rest } = r as {
    dryRun: boolean; phantomChurches?: string[]; churchesCreated?: string[]; warnings: Array<{ code: string; row: number; message: string }>;
  };
  return {
    ...rest,
    newChurches: [...(phantomChurches ?? []), ...(churchesCreated ?? [])],
    warnings: warnings.map((w) => ({
      code: w.code === 'church-would-be-created' ? 'church-created' : w.code,
      row: w.row,
      message: w.code.startsWith('church-') ? '' : w.message,
    })),
  };
}

const FORM = `First Name,Last Name,Attendee's Church,School Grade,Type,Mobile Number,${C}
Ada,Lovelace,Victory,9,Tent,0400000001,Yes,Yes,Yes
Grace,Hopper,New Hope,8,Classroom,0400000002,Yes,No,Yes
Alan,Turing,New Hope,10,Tent,0400000003,Yes,Yes,Yes`;
const TICKETS = `Ticket Number,Ticket Type,Invoice Number,First Name,Last Name,Phone,Invoice Payment Status,Ticket Status
t1,Tent,i1,Ada,Lovelace,0400000001,Paid,Active
t2,Classroom,i2,Grace,Hopper,0400000002,Paid,Active
t3,Tent,i3,Nobody,Known,,Paid,Active`;
const INVOICES = `Invoice Number,First Name,Last Name,Amount Paid,Ticket Total,Discount Total,Discount Code
i1,Ada,Lovelace,150,150,0,
i2,Grace,Hopper,190,190,0,EARLY
i9,Zed,Unknown,10,10,0,`;

describe('I2 — preview equals commit', () => {
  it('Form: two rows naming the same new church preview the same as they commit', async () => {
    const a = await world();
    const b = await world();
    const preview = await a.form.importCsv(admin, { csvData: FORM, updateExisting: true, dryRun: true });
    const commit = await b.form.importCsv(admin, { csvData: FORM, updateExisting: true });
    expect(norm(preview as never)).toEqual(norm(commit as never));
    expect(preview.phantomChurches).toEqual(['New Hope']);
    expect(preview.warnings.filter((w) => w.code === 'church-would-be-created')).toHaveLength(1);
    // The preview wrote nothing.
    expect(await a.people.findAll()).toHaveLength(0);
    expect(await a.churches.findAll()).toHaveLength(1);
  });

  it('Ticket and Invoice: preview equals commit after the same Form commit', async () => {
    const a = await world();
    const b = await world();
    for (const w of [a, b]) await w.form.importCsv(admin, { csvData: FORM, updateExisting: true });
    const tPreview = await a.ticket.importTicketsCsv(admin, { csvData: TICKETS, dryRun: true });
    const tCommit = await b.ticket.importTicketsCsv(admin, { csvData: TICKETS });
    expect(norm(tPreview as never)).toEqual(norm(tCommit as never));
    await a.ticket.importTicketsCsv(admin, { csvData: TICKETS });
    const iPreview = await a.invoice.importInvoicesCsv(admin, { csvData: INVOICES, dryRun: true });
    const iCommit = await b.invoice.importInvoicesCsv(admin, { csvData: INVOICES });
    expect(norm(iPreview as never)).toEqual(norm(iCommit as never));
    // The previews wrote nothing on top of the commits they were compared with.
    const ada = (await a.people.findAll()).find((p) => p.firstName === 'Ada')!;
    expect(ada.amountPaid ?? null).toBeNull();
  });
});

describe('I2 — POST /import/batch preview (one overlay, IA OQ-22)', () => {
  type FileOut = { type: string; result: Record<string, unknown> & { warnings: Array<{ code: string; message: string }> } };
  const ALL = [
    { type: 'form', csvData: FORM }, { type: 'tickets', csvData: TICKETS }, { type: 'invoices', csvData: INVOICES },
  ];
  async function batchOf() {
    const w = await world();
    const overrides = new InMemoryAllocationOverrideRepository();
    await overrides.init();
    const batch = makeImportBatchService(
      { people: w.people, churches: w.churches, overrides },
      { form: w.form, tickets: w.ticket, invoices: w.invoice },
    );
    return { w, batch };
  }

  it('on an empty DB, Ticket and Invoice preview against the Form file in the same batch', async () => {
    const { w, batch } = await batchOf();
    const out = await batch.previewBatch(admin, { updateExisting: true, files: ALL });
    expect(out.dryRun).toBe(true);
    const [f, t, i] = out.results as unknown as FileOut[];
    expect(f!.result).toMatchObject({ created: 3, dryRun: true });
    // Only the unknown ticket row is an orphan; Ada and Grace match the Form's people.
    expect(t!.result).toMatchObject({ created: 1, updated: 2, dryRun: true });
    // i1 + i2 match through the Ticket file's invoice numbers; only i9 is unmatched.
    const unmatched = i!.result.warnings.filter((x) => x.code === 'invoice-unmatched');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.message).toContain('i9');
    expect(i!.result).toMatchObject({ updated: 2 });
    // Nothing written.
    expect(await w.people.findAll()).toHaveLength(0);
    expect(await w.churches.findAll()).toHaveLength(1);
  });

  it('equals the three sequential commits, file by file', async () => {
    const { batch } = await batchOf();
    const out = await batch.previewBatch(admin, { updateExisting: true, files: ALL });
    const b = await world();
    const commits = [
      await b.form.importCsv(admin, { csvData: FORM, updateExisting: true }),
      await b.ticket.importTicketsCsv(admin, { csvData: TICKETS }),
      await b.invoice.importInvoicesCsv(admin, { csvData: INVOICES }),
    ];
    out.results.forEach((r, k) => expect(norm((r as unknown as FileOut).result)).toEqual(norm(commits[k] as never)));
  });

  it('a refused file is reported on that file; the next files still preview', async () => {
    const { batch } = await batchOf();
    const noConsent = 'First Name,Last Name\nAda,Lovelace';
    const out = await batch.previewBatch(admin, { files: [{ type: 'form', csvData: noConsent }, { type: 'tickets', csvData: TICKETS }] });
    expect(out.results[0]).toMatchObject({ type: 'form', error: expect.stringContaining('Consent column missing') });
    expect(out.results[1]).toMatchObject({ type: 'tickets', result: { created: 3 } });
  });

  it('needs import:run and rejects a malformed body', async () => {
    const { batch } = await batchOf();
    const church: Actor = { ...admin, role: 'church' };
    await expect(batch.previewBatch(church, { files: [{ type: 'form', csvData: FORM }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(batch.previewBatch(admin, { files: [] })).rejects.toThrow();
    await expect(batch.previewBatch(admin, { files: [{ type: 'nope', csvData: 'x' }] })).rejects.toThrow();
  });
});

