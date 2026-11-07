import { describe, it, expect } from 'vitest';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { isAppError } from '../core/errors/app-error';
import { makeImportController } from '../api/controllers/import.controller';
import { CONSENT_COLUMNS } from './elvanto-mapping';
import { applyRow } from './field-ownership';
import { buildNameIndex, findPersonMatch } from './person-matching';
import { paymentStanding } from './payment-standing';
import type { HttpRequest, Route } from '../api/http/types';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import type { ImportWarning } from '../core/types/import-warning';

// ---------------------------------------------------------------------------
// Camp round 2026-11-07 regression set, sub-lane `imports` (pinned at 937738b). Everything goes
// through the real routes on an in-memory container (Q13: in-memory only; the Supabase adapter
// is checked by reading code, not run). Response shapes and warning codes here are the ones the
// 11.1 console (run-camp.js WARNING_CODES) reads.
// ---------------------------------------------------------------------------

const admin: Actor = { id: 'u-admin', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' };
const C = CONSENT_COLUMNS.join(',');
type Warned = { warnings: ImportWarning[] } & Record<string, unknown>;

async function world() {
  const container = await buildContainer();
  const routes = buildRoutes(container.services) as Route[];
  const call = async (method: string, path: string, body: unknown = {}, actor: Actor = admin, extra: Partial<HttpRequest> = {}) => {
    const r = routes.find((x) => x.method === method && x.path === path);
    if (!r) throw new Error(`no route ${method} ${path}`);
    return r.handler({ params: {}, query: {}, body, ctx: { actor, token: 't' }, ...extra } as HttpRequest) as Promise<Warned>;
  };
  const people = container.repos.people;
  const byName = async (first: string) => (await people.findAll()).find((p) => p.firstName === first);
  /** Change stored fields without touching presence (P3: re-insert the row). */
  const set = async (first: string, over: Partial<Person>) => {
    const p = (await byName(first))!;
    await people.delete(p.id);
    await people.save({ ...p, ...over });
    return { ...p, ...over };
  };
  const form = (csvData: string, more: Record<string, unknown> = {}) =>
    call('POST', '/import/csv', { csvData, updateExisting: true, ...more });
  return { container, call, people, byName, set, form };
}

const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { return isAppError(e) ? e.statusCode : `throw ${(e as Error).message}`; }
};
const codes = (r: Warned) => r.warnings.map((w) => w.code);

// ---------------------------------------------------------------------------
describe('[A-1] Form re-import consents (Q3, IA-OQ-2)', () => {
  const H = `First Name,Last Name,Church,Grade,Date Submitted,${C}`;

  it('[A-1][Q3] a blank consent cell keeps the earlier value and its timestamp', async () => {
    const w = await world();
    await w.form(`${H}\nAda,Lovelace,Victory,9,01/08/2026,Yes,Yes,Yes`);
    await w.form(`${H}\nAda,Lovelace,Victory,9,01/09/2026,,,`);
    const p = (await w.byName('Ada'))!;
    for (const t of ['medical', 'media', 'supervision'] as const) {
      expect(p.consents[t]).toEqual({ granted: true, timestamp: '2026-08-01T00:00:00.000Z' });
    }
  });

  it('[A-1] an explicit "No" revokes (IA-OQ-2); other blanks keep', async () => {
    const w = await world();
    await w.form(`${H}\nAda,Lovelace,Victory,9,01/08/2026,Yes,Yes,Yes`);
    await w.form(`${H}\nAda,Lovelace,Victory,9,01/09/2026,No,,Yes`);
    const p = (await w.byName('Ada'))!;
    expect(p.consents.medical.granted).toBe(false);
    expect(p.consents.media).toEqual({ granted: true, timestamp: '2026-08-01T00:00:00.000Z' });
    expect(p.consents.supervision.granted).toBe(true);
  });

  it('[A-1][Q3] a missing or renamed consent column stops the import with a 400, nothing written (preview and commit)', async () => {
    const w = await world();
    await w.form(`${H}\nAda,Lovelace,Victory,9,01/08/2026,Yes,Yes,Yes`);
    const [medical, media, supervision] = CONSENT_COLUMNS;
    const missing = `First Name,Last Name,Church,Grade,${media},${supervision}\nAda,Lovelace,Victory,9,No,No\nNew,Person,Victory,9,Yes,Yes`;
    const renamed = `First Name,Last Name,Church,Grade,${medical} (renamed),${media},${supervision}\nAda,Lovelace,Victory,9,No,No,No`;
    for (const csv of [missing, renamed]) {
      for (const dryRun of [true, false]) {
        await expect(w.form(csv, { dryRun })).rejects.toThrow(/Consent column missing from this file/);
        expect(await status(w.form(csv, { dryRun }))).toBe(400);
      }
    }
    expect(await w.people.findAll()).toHaveLength(1);
    expect((await w.byName('Ada'))!.consents.medical.granted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('[A-4] fuzzy matches are never applied (Q5, IA-OQ-4)', () => {
  it('[A-4][Q5] Ticket: a near-miss name creates a needsReview orphan + "ticket-possible-match", the real student untouched', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,Grade,${C}\nJonathan,Smith,Victory,9,Yes,Yes,Yes`);
    for (const dryRun of [true, false]) {
      const r = await w.call('POST', '/import/tickets', {
        dryRun, csvData: 'First Name,Last Name,Ticket Number,Invoice Number\nJonathon,Smith,TKT-7,INV-7',
      });
      expect(r).toMatchObject({ created: 1, updated: 0 });
      const pm = r.warnings.filter((x) => x.code === 'ticket-possible-match');
      expect(pm).toHaveLength(1);
      expect(pm[0]!.message).toContain('possible match: Jonathan Smith');
      expect(codes(r)).not.toContain('unmatched-orphan-created'); // one warning per row
    }
    const real = (await w.byName('Jonathan'))!;
    expect(real.ticketNumber ?? null).toBeNull();
    const orphan = (await w.byName('Jonathon'))!;
    expect(orphan).toMatchObject({ churchId: '', ticketNumber: 'TKT-7', needsReview: true });
    expect(orphan.needsReviewReason).toContain('possible match: Jonathan Smith');
  });

  it('[A-4] Invoice: a fuzzy billing-name match is unmatched (invoice-unmatched + "possible match"), no money applied', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,Grade,${C}\nRobin,Thompson,Victory,9,Yes,Yes,Yes`);
    const r = await w.call('POST', '/import/invoices', {
      csvData: 'Invoice Number,Billing First Name,Billing Last Name,Billing Phone,Ticket Total,Discount Total,Amount Paid,Fees,Tax,Discount Code\n' +
        'INV-9,Robyn,Thompson,,190,0,190,0,0,',
    }) as Warned & { unmatchedInvoices: Array<{ invoiceNumber: string | null }> };
    expect(r.updated).toBe(0);
    const um = r.warnings.filter((x) => x.code === 'invoice-unmatched');
    expect(um).toHaveLength(1);
    expect(um[0]!.message).toContain('possible match: Robin Thompson (distance 1)');
    expect(codes(r)).not.toContain('billing-name-match-only');
    expect(r.unmatchedInvoices.map((u) => u.invoiceNumber)).toEqual(['INV-9']);
    const p = (await w.byName('Robin'))!;
    expect(p.amountPaid ?? null).toBeNull();
    expect(p.registrationCost ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('[A-7] invoice single-match merges onto this run\'s result', () => {
  it('[A-7] row 2 (blank total, no code) keeps row 1\'s discount code and cost', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,Grade,${C}\nRobin,Thompson,Victory,9,Yes,Yes,Yes`);
    await w.set('Robin', { invoiceNumber: 'INV-1', invoiceNumbers: ['INV-1', 'INV-2'] });
    await w.call('POST', '/import/invoices', {
      csvData: 'Invoice Number,Billing First Name,Billing Last Name,Billing Phone,Ticket Total,Discount Total,Amount Paid,Fees,Tax,Discount Code\n' +
        'INV-1,Robin,Thompson,,150,0,0,0,0,EARLY\nINV-2,Robin,Thompson,,,0,40,0,0,',
    });
    const p = (await w.byName('Robin'))!;
    expect(p).toMatchObject({ discountCode: 'EARLY', registrationCost: 150, amountPaid: 40 });
  });

  it('[A-7] row 2 with no ticket total keeps row 1\'s guessed kind', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,Grade,${C}\nRobin,Thompson,Victory,9,Yes,Yes,Yes\nS1,X,Victory,9,Yes,Yes,Yes\nS2,X,Victory,9,Yes,Yes,Yes\nS3,X,Victory,9,Yes,Yes,Yes`);
    for (const s of ['S1', 'S2', 'S3']) {
      await w.set(s, { accommodationKind: 'classroom', accommodationKindRaw: 'classroom', accommodationKindConfidence: 'confirmed', registrationCost: 600 });
    }
    await w.set('Robin', { invoiceNumber: 'INV-1' });
    await w.call('POST', '/import/invoices', {
      csvData: 'Invoice Number,Billing First Name,Billing Last Name,Billing Phone,Ticket Total,Discount Total,Amount Paid,Fees,Tax,Discount Code\n' +
        'INV-1,Robin,Thompson,,600,0,600,0,0,\nINV-2,Robin,Thompson,,,0,10,0,0,',
    });
    expect(await w.byName('Robin')).toMatchObject({ accommodationKind: 'classroom', accommodationKindConfidence: 'guessed', registrationCost: 600, amountPaid: 610 });
  });
});

// ---------------------------------------------------------------------------
describe('[A-Q12][B-9] ticket/invoice/payment holders survive the Form absent-delete (Q12, OQ-1 literal)', () => {
  it('[A-Q12][B-9][Q12] kept with "absent-kept-needs-review" in preview and commit; a plain absent person is still deleted', async () => {
    for (const dryRun of [true, false]) {
      const w = await world();
      await w.form(`First Name,Last Name,Church,Grade,${C}\n` +
        ['Tick', 'Inv', 'Invs', 'Paid', 'Disc', 'Plain'].map((n) => `${n},Person,Victory,9,Yes,Yes,Yes`).join('\n'));
      await w.set('Tick', { ticketNumber: 'TKT-1', churchId: '', churchName: '' });
      await w.set('Inv', { invoiceNumber: 'INV-1' });
      await w.set('Invs', { invoiceNumbers: ['INV-2'] });
      await w.set('Paid', { amountPaid: 0 }); // a recorded 0 counts
      await w.set('Disc', { discountAmount: 20 });
      const r = await w.form(`First Name,Last Name,Church,Grade,${C}\nNobody,Else,Victory,9,Yes,Yes,Yes`, { dryRun });
      expect(r).toMatchObject({ deleted: 1, retained: 5, dryRun });
      const kept = r.warnings.filter((x) => x.code === 'absent-kept-needs-review');
      expect(kept.map((x) => x.message.split(' ')[0]).sort()).toEqual(['Disc', 'Inv', 'Invs', 'Paid', 'Tick']);
      expect(kept[0]!.message).toContain('KEPT');
      expect(r.warnings.filter((x) => x.code === 'absent-will-delete').map((x) => x.message)).toEqual([expect.stringContaining('Plain Person')]);
      for (const n of ['Tick', 'Inv', 'Invs', 'Paid', 'Disc']) expect(await w.byName(n)).toBeDefined();
      expect(!!(await w.byName('Plain'))).toBe(dryRun);
    }
  });
  it('[CH-1][Q12] a hand-set payment status (not unpaid) also keeps an absent person; unpaid does not', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,Grade,${C}
Paidup,Person,Victory,9,Yes,Yes,Yes
Unpaid,Person,Victory,9,Yes,Yes,Yes`);
    await w.set('Paidup', { paymentStatus: 'paid' });
    const r = await w.form(`First Name,Last Name,Church,Grade,${C}
Nobody,Else,Victory,9,Yes,Yes,Yes`);
    expect(r).toMatchObject({ deleted: 1, retained: 1 });
    expect(r.warnings.filter((x) => x.code === 'absent-kept-needs-review').map((x) => x.message.split(' ')[0])).toEqual(['Paidup']);
    expect(await w.byName('Paidup')).toBeDefined();
    expect(await w.byName('Unpaid')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('[B-16] Form re-import is seed-only for Ticket/Invoice-owned fields (IA-OQ-6)', () => {
  const H = `First Name,Last Name,Church,Type,Cost,Code,${C}`;

  it('[B-16] does not overwrite type, cost, code, raw kind or a confirmed kind', async () => {
    const w = await world();
    await w.form(`${H}\nAda,Lovelace,Victory,Tent,100,FORM1,Yes,Yes,Yes`);
    await w.set('Ada', {
      registrationType: 'Classroom Student', registrationCost: 150, discountCode: 'INV9',
      accommodationKind: 'classroom', accommodationKindRaw: 'classroom', accommodationKindConfidence: 'confirmed',
    });
    await w.form(`${H}\nAda,Lovelace,Victory,Tent,200,FORM2,Yes,Yes,Yes`);
    expect(await w.byName('Ada')).toMatchObject({
      registrationType: 'Classroom Student', registrationCost: 150, discountCode: 'INV9',
      accommodationKind: 'classroom', accommodationKindRaw: 'classroom', accommodationKindConfidence: 'confirmed',
    });
  });

  it('[B-16] seeds them when the stored value is blank', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,${C}\nAda,Lovelace,Victory,Yes,Yes,Yes`);
    await w.form(`${H}\nAda,Lovelace,Victory,Tent,100,FORM1,Yes,Yes,Yes`);
    expect(await w.byName('Ada')).toMatchObject({
      registrationType: 'Tent', registrationCost: 100, discountCode: 'FORM1', accommodationKind: 'tent', accommodationKindRaw: 'tent',
    });
  });
});

// ---------------------------------------------------------------------------
describe('[C11] I2 staging overlay: preview equals commit, preview writes nothing (IA-OQ-22)', () => {
  const FORM = `First Name,Last Name,Church,Grade,${C}\nAda,Lovelace,Victory,9,Yes,Yes,Yes\nGrace,Hopper,New Hope,8,Yes,Yes,Yes\nAlan,Turing,New Hope,10,Yes,Yes,Yes`;
  const strip = (r: Warned) => {
    const { dryRun: _d, phantomChurches, churchesCreated, warnings, ...rest } = r as Warned & { phantomChurches: string[]; churchesCreated: string[] };
    return {
      ...rest, churches: [...phantomChurches, ...churchesCreated],
      warnings: warnings.map((x) => x.code.replace('church-would-be-created', 'church-created')),
    };
  };

  it('[C11] Form preview equals the commit and writes no person or church', async () => {
    const a = await world();
    const b = await world();
    const preview = await a.form(FORM, { dryRun: true });
    const commit = await b.form(FORM);
    expect(strip(preview)).toEqual(strip(commit));
    // New Hope is named on two rows but would be created once (Victory is new here too).
    expect(preview.warnings.filter((x) => x.code === 'church-would-be-created' && x.message.includes('New Hope'))).toHaveLength(1);
    expect(await a.people.findAll()).toHaveLength(0);
    expect((await a.container.repos.churches.findAll()).map((c) => c.name)).not.toContain('New Hope');
  });

  it('[C11] POST /import/batch is preview-only: dryRun results, nothing written, never stamps', async () => {
    const w = await world();
    const out = await w.call('POST', '/import/batch', {
      updateExisting: true,
      files: [
        { type: 'form', csvData: FORM },
        { type: 'tickets', csvData: 'First Name,Last Name,Ticket Number,Invoice Number\nAda,Lovelace,t1,i1' },
      ],
    }) as unknown as { dryRun: boolean; results: Array<{ type: string; result: Warned }> };
    expect(out.dryRun).toBe(true);
    expect(out.results.map((r) => [r.type, r.result.dryRun])).toEqual([['form', true], ['tickets', true]]);
    expect(out.results[1]!.result).toMatchObject({ created: 0, updated: 1 }); // sees the batch's Form people
    expect(await w.people.findAll()).toHaveLength(0);

    // The controller never calls stampImport for a batch (dry-run or not).
    const stamped: string[] = [];
    const ctrl = makeImportController({
      importService: w.container.services.importService,
      importBatch: w.container.services.importBatch,
      settings: { stampImport: async (s) => { stamped.push(s); } },
    });
    await ctrl.previewBatch({ params: {}, query: {}, ctx: { actor: admin, token: 't' }, body: { files: [{ type: 'form', csvData: FORM }] } } as unknown as HttpRequest);
    expect(stamped).toEqual([]);
    expect(await w.people.findAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('[C12] I1 field-ownership module (applyRow)', () => {
  const base = { id: 'p', firstName: 'Ada', lastName: 'L', mobile: '0400', registrationCost: 150, amountPaid: null } as unknown as Person;

  it('[C12] write: non-blank overwrites, blank keeps; seed-only: lands only on a null stored value', () => {
    expect(applyRow('form', base, { mobile: '' }).mobile).toBe('0400');
    expect(applyRow('form', base, { mobile: '0499' }).mobile).toBe('0499');
    expect(applyRow('form', base, { registrationCost: 999 }).registrationCost).toBe(150);
    expect(applyRow('form', { ...base, registrationCost: null } as unknown as Person, { registrationCost: 99 }).registrationCost).toBe(99);
    expect(applyRow('form', base, { registrationCost: 999 }, { createdThisRun: true }).registrationCost).toBe(999);
    expect(applyRow('invoice', base, { registrationCost: 200 }).registrationCost).toBe(200);
  });

  it('[C12] an importer writing a field it does not own throws (Form never writes confidence or money)', () => {
    expect(() => applyRow('form', base, { accommodationKindConfidence: 'confirmed' })).toThrow(/does not own/);
    expect(() => applyRow('form', base, { amountPaid: 1 })).toThrow(/does not own/);
    expect(() => applyRow('ticket', base, { amountPaid: 1 })).toThrow(/does not own/);
  });
});

// ---------------------------------------------------------------------------
describe('[C13] I3 one matcher that says how it matched', () => {
  const p = (id: string, firstName: string, lastName: string, mobile: string | null = null) => ({ id, firstName, lastName, mobile }) as unknown as Person;
  const index = buildNameIndex([p('a', 'Ada', 'Lovelace'), p('t1', 'Sam', 'Twin', '0400000001'), p('t2', 'Sam', 'Twin', '0400000002')]);

  it('[C13][Q5] exact / exact+phone / possible(distance) / ambiguous / not_found', () => {
    expect(findPersonMatch(index, { firstName: 'Ada', lastName: 'Lovelace' })).toMatchObject({ status: 'matched', via: 'exact', person: { id: 'a' } });
    expect(findPersonMatch(index, { firstName: 'Sam', lastName: 'Twin', phone: '0400 000 002' })).toMatchObject({ status: 'matched', via: 'exact+phone', person: { id: 't2' } });
    expect(findPersonMatch(index, { firstName: 'Adda', lastName: 'Lovelace' })).toMatchObject({ status: 'possible', distance: 1, person: { id: 'a' } });
    expect(findPersonMatch(index, { firstName: 'Sam', lastName: 'Twin' })).toMatchObject({ status: 'no_match', reason: 'ambiguous' });
    expect(findPersonMatch(index, { firstName: 'Zed', lastName: 'Nobody' })).toMatchObject({ status: 'no_match', reason: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
describe('[C14] I5 payment standing worked out once on the server', () => {
  it('[C14] paymentStanding: stored status wins, then override / not-matched / owing by price', () => {
    const none = { paymentStatus: 'unpaid', refundAmount: null, amountPaidOverride: null, ticketNumber: null, invoiceNumber: null, registrationCost: null, discountAmount: null, amountPaid: null } as unknown as Parameters<typeof paymentStanding>[0];
    expect(paymentStanding({ ...none, paymentStatus: 'paid', registrationCost: 300, ticketNumber: 't' })).toEqual({ state: 'settled', owing: null });
    expect(paymentStanding(none)).toEqual({ state: 'not-matched', owing: null });
    expect(paymentStanding({ ...none, ticketNumber: 't', registrationCost: 300, discountAmount: 20, amountPaid: 200 })).toEqual({ state: 'owing', owing: 80 });
    expect(paymentStanding({ ...none, ticketNumber: 't', amountPaidOverride: 5 })).toEqual({ state: 'override', owing: null });
  });

  it('[C14] /registrants carries paymentStanding; /campers, /campers/:id and /search never give it (or money values) to firstAid/prayer', async () => {
    const w = await world();
    await w.form(`First Name,Last Name,Church,Grade,${C}\nAda,Lovelace,Victory,9,Yes,Yes,Yes`);
    await w.set('Ada', { ticketNumber: 't', registrationCost: 300, amountPaid: 100 });
    const reg = await w.call('GET', '/registrants') as unknown;
    expect(JSON.stringify(reg)).toContain('"paymentStanding":{"state":"owing","owing":200}');
    const ada = await w.set('Ada', { lifecycle: 'arrived', atCamp: true }); // now a camper
    for (const role of ['firstAid', 'prayer'] as const) {
      const a: Actor = { id: `u-${role}`, role, churchId: null, churchName: null, zone: null, displayName: role };
      const outs = [
        await w.call('GET', '/campers', {}, a),
        await w.call('GET', '/campers', {}, a, { query: { scope: 'all' } }),
        await w.call('GET', '/campers/:id', {}, a, { params: { id: ada.id } }),
        await w.call('GET', '/search', {}, a, { query: { q: 'Ada' } }),
      ].map((x) => JSON.stringify(x));
      expect(outs[0]).toContain(ada.id); // the list really carried Ada
      for (const s of outs) {
        expect(s).not.toContain('paymentStanding');
        // Q4: money fields come back null for these roles (CLAUDE.md roles table).
        expect(s).not.toMatch(/"amountPaid":100|"registrationCost":300/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The three import endpoints keep the response shapes and warning codes the 11.1 console reads
// (run-camp.js: counts, errors[], warnings[{code,row,message}], unmatchedInvoices[]). Cited under
// A-1 / A-4 / A-Q12 (the ids that added codes) and C11 (the overlay that rewired the commit tails).
describe('[A-Q12][A-4][C11] import endpoint contract for the 11.1 console', () => {
  it('[A-Q12][A-4][C11] /import/csv, /import/tickets, /import/invoices keep their keys and codes', async () => {
    const w = await world();
    const f = await w.form(`First Name,Last Name,Church,Grade,${C}\nJonathan,Smith,Victory,9,Yes,Yes,Yes\nGone,Person,Victory,9,Yes,Yes,Yes`);
    expect(Object.keys(f).sort()).toEqual(['churchesCreated', 'created', 'deleted', 'dryRun', 'errors', 'phantomChurches', 'retained', 'skipped', 'updated', 'warnings']);
    await w.set('Gone', { ticketNumber: 'TKT-G' });
    const f2 = await w.form(`First Name,Last Name,Church,Grade,${C}\nJonathan,Smith,Victory,9,Yes,Yes,Yes`, { dryRun: true });
    expect(codes(f2)).toContain('absent-kept-needs-review');
    for (const x of f2.warnings) expect(Object.keys(x).sort()).toEqual(['code', 'message', 'row']);

    const t = await w.call('POST', '/import/tickets', { csvData: 'First Name,Last Name,Ticket Number,Invoice Number\nJonathon,Smith,TKT-7,INV-7' });
    expect(Object.keys(t).sort()).toEqual(['created', 'dryRun', 'errors', 'orphansCreated', 'skipped', 'updated', 'warnings']);
    expect(codes(t)).toEqual(['ticket-possible-match']);
    expect(t.orphansCreated).toEqual(['Jonathon Smith']);

    const i = await w.call('POST', '/import/invoices', {
      csvData: 'Invoice Number,Billing First Name,Billing Last Name,Billing Phone,Ticket Total,Discount Total,Amount Paid,Fees,Tax,Discount Code\nINV-404,Zed,Nobody,,10,0,10,0,0,',
    });
    expect(Object.keys(i).sort()).toEqual(['ambiguousGroupInvoices', 'created', 'deleted', 'dryRun', 'errors', 'guessedAccommodationCount', 'skipped', 'unmatchedInvoices', 'updated', 'warnings']);
    expect(codes(i)).toContain('invoice-unmatched');
    expect(Object.keys((i.unmatchedInvoices as object[])[0]!).sort()).toEqual(['amountPaid', 'billingName', 'invoiceNumber', 'row', 'ticketTotal']);
  });
});
