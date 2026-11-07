import type { Person } from '../core/entities/person';

// ---------------------------------------------------------------------------
// payment-standing.ts — is this person still owing money? Worked out once, on the server (I5,
// 2026-11-07), and sent on RegistrantDto as `paymentStanding`. The SPA's "Still needed" payment
// item reads `state === 'owing'`; its old `_paymentMissing` body stays as the fallback for a
// cached response without the field; payment-standing.test.ts pins the two to the same answer.
//
// The order mirrors the SPA rule exactly (OQ-58): a stored `paymentStatus` of paid/free/refunded
// wins over the money, even when the money says something is still owed (4 people on 7 Nov).
// Budget totals are NOT here — the SPA's computeBudgetClient keeps them (S2).
// RegistrantDto only: never CamperDto or search (A-6, firstAid/prayer get no money).
// ---------------------------------------------------------------------------

export type PaymentStandingState = 'settled' | 'free' | 'refunded' | 'override' | 'not-matched' | 'owing';
/** `owing` is the amount still due when a price is on record, else null. */
export interface PaymentStanding { state: PaymentStandingState; owing: number | null }

type StandingInput = Pick<Person,
  'paymentStatus' | 'refundAmount' | 'amountPaidOverride' | 'ticketNumber' | 'invoiceNumber' |
  'registrationCost' | 'discountAmount' | 'amountPaid'>;

export function paymentStanding(p: StandingInput): PaymentStanding {
  const settled = (state: PaymentStandingState): PaymentStanding => ({ state, owing: null });
  if (p.paymentStatus === 'paid') return settled('settled');
  if (p.paymentStatus === 'free') return settled('free');
  if (p.paymentStatus === 'refunded' || p.refundAmount != null) return settled('refunded');
  if ((p.amountPaidOverride ?? 0) > 0) return settled('override');
  // No ticket or invoice matched yet: the 'unpaid' default alone is not a finding.
  if (!(p.ticketNumber || p.invoiceNumber)) return settled('not-matched');
  // A price on record decides it: a discount covering the ticket is a free place (budget-money.md).
  if (p.registrationCost != null) {
    const due = p.registrationCost - (p.discountAmount || 0) - (p.amountPaid || 0);
    return due > 0 ? { state: 'owing', owing: Math.round(due * 100) / 100 } : settled('settled');
  }
  return p.paymentStatus === 'deposit' || p.amountPaid == null ? { state: 'owing', owing: null } : settled('settled');
}
