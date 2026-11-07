import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { paymentStanding } from './payment-standing';
import { toRegistrantDto, toCamperDto } from '../api/dto/person.dto';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';

// I5 interface tests. The cases are the qa-batch2 harness table for the SPA's `_paymentMissing`,
// plus a grid that runs the SPA's fallback body (read from public/index.html) against the server
// rule, so the two cannot drift during the one-release overlap.

type In = Parameters<typeof paymentStanding>[0];
const base: In = { paymentStatus: 'unpaid', ticketNumber: null, invoiceNumber: null, amountPaid: null, refundAmount: null };
const owing = (o: Partial<In>) => paymentStanding({ ...base, ...o }).state === 'owing';

describe('paymentStanding — the qa-batch2 table', () => {
  const cases: Array<[string, Partial<In>, boolean]> = [
    ['default unpaid, nothing matched', {}, false],
    ['invoice import: Paid $X', { invoiceNumber: 'I1', amountPaid: 250 }, false],
    ['free or refunded invoice', { invoiceNumber: 'I1', amountPaid: 0 }, false],
    ['refund recorded', { ticketNumber: 'T1', refundAmount: 50 }, false],
    ['paid', { ticketNumber: 'T1', paymentStatus: 'paid' }, false],
    ['ticket says unpaid, no invoice figure', { ticketNumber: 'T1' }, true],
    ['deposit only', { ticketNumber: 'T1', paymentStatus: 'deposit', amountPaid: 50 }, true],
    ['ticket Free, no invoice', { ticketNumber: 'T1', paymentStatus: 'free' }, false],
    ['ticket Refunded, no invoice', { ticketNumber: 'T1', paymentStatus: 'refunded' }, false],
    ['Paid $0 of $180', { ticketNumber: 'T1', invoiceNumber: 'I1', amountPaid: 0, registrationCost: 180 }, true],
    ['hand-entered amount, no invoice', { amountPaidOverride: 180 }, false],
    ['hand-entered amount beats ticket Unpaid', { ticketNumber: 'T1', amountPaidOverride: 180 }, false],
    ['free place, $0 paid', { ticketNumber: 'T1', registrationCost: 180, discountAmount: 180, amountPaid: 0 }, false],
    ['free place, no invoice figure', { ticketNumber: 'T1', registrationCost: 180, discountAmount: 180 }, false],
    ['part discount, nothing paid', { ticketNumber: 'T1', registrationCost: 180, discountAmount: 30, amountPaid: 0 }, true],
    ['part paid', { ticketNumber: 'T1', registrationCost: 180, amountPaid: 100 }, true],
    ['paid in full, status never set', { ticketNumber: 'T1', registrationCost: 180, amountPaid: 180 }, false],
    // OQ-58: stored status wins over money that says owing.
    ['status paid but money short', { ticketNumber: 'T1', paymentStatus: 'paid', registrationCost: 180, amountPaid: 100 }, false],
  ];
  for (const [label, o, expected] of cases) it(label, () => expect(owing(o)).toBe(expected));

  it('names the state and the amount still due', () => {
    expect(paymentStanding({ ...base, ticketNumber: 'T1', registrationCost: 180, discountAmount: 30, amountPaid: 100.1 }))
      .toEqual({ state: 'owing', owing: 49.9 });
    expect(paymentStanding({ ...base, ticketNumber: 'T1' })).toEqual({ state: 'owing', owing: null });
    expect(paymentStanding({ ...base, paymentStatus: 'free' }).state).toBe('free');
    expect(paymentStanding({ ...base, refundAmount: 0 }).state).toBe('refunded');
    expect(paymentStanding({ ...base, amountPaidOverride: 1 }).state).toBe('override');
    expect(paymentStanding(base).state).toBe('not-matched');
  });
});

describe('paymentStanding — same answer as the SPA fallback', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const start = src.indexOf('function _paymentMissing(s){');
  const end = /\r?\n\}\r?\n/.exec(src.slice(start))!;
  const body = src.slice(start, start + end.index + end[0].length);
  const ctx: { _paymentMissing?: (s: object) => boolean } = {};
  vm.createContext(ctx);
  vm.runInContext(body, ctx);

  it('the SPA uses the server field when present', () => {
    expect(ctx._paymentMissing!({ paymentStanding: { state: 'owing' }, paymentStatus: 'paid' })).toBe(true);
    expect(ctx._paymentMissing!({ paymentStanding: { state: 'settled' }, ticketNumber: 'T1' })).toBe(false);
  });

  it('matches the SPA body on every combination', () => {
    let n = 0;
    for (const paymentStatus of ['unpaid', 'deposit', 'paid', 'free', 'refunded'] as const)
      for (const refundAmount of [null, 0, 50])
        for (const amountPaidOverride of [null, 0, 180])
          for (const [ticketNumber, invoiceNumber] of [[null, null], ['T1', null], [null, 'I1']])
            for (const registrationCost of [null, 0, 180])
              for (const discountAmount of [null, 30, 180])
                for (const amountPaid of [null, 0, 100, 180]) {
                  const p = { paymentStatus, refundAmount, amountPaidOverride, ticketNumber, invoiceNumber, registrationCost, discountAmount, amountPaid };
                  expect(paymentStanding(p).state === 'owing', JSON.stringify(p)).toBe(ctx._paymentMissing!(p));
                  n++;
                }
    expect(n).toBe(4860);
  });
});

describe('who receives paymentStanding (A-6 / OQ-58)', () => {
  const p = {
    id: 'p1', firstName: 'A', lastName: 'B', kind: 'youth', gender: 'other', churchId: 'c1', churchName: 'V', zone: 'Y',
    medicalConditions: [], dietaryRequirements: [],
    consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
    paymentStatus: 'unpaid', ticketNumber: 'T1', registrationCost: 180, amountPaid: 100,
    lifecycle: 'arrived', atCamp: true, checkInHistory: [], signOutHistory: [], createdAt: '', updatedAt: '',
  } as unknown as Person;

  it('RegistrantDto carries it', () => {
    expect(toRegistrantDto(p, { id: 'admin-1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin User' }).paymentStanding).toEqual({ state: 'owing', owing: 80 });
  });

  it('CamperDto never does, for any role', () => {
    for (const role of ['admin', 'church', 'firstAid', 'prayer'] as const) {
      const actor: Actor = { id: 'u', role, churchId: 'c1', churchName: 'V', zone: 'Yellow', displayName: role };
      expect('paymentStanding' in toCamperDto(p, actor)).toBe(false);
    }
  });
});
