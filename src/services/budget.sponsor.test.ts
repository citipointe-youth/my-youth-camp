import { describe, it, expect } from 'vitest';
import {
  computeBudget,
  computeSponsorSummary,
  sponsorAmountFor,
  classifyTicket,
  type BudgetPerson,
  type BasePrices,
  type DiscountTagMap,
} from './budget';

/*
 * Sponsorship summary (2026-08-04). The owner's case, verbatim: one sponsor code used across
 * BOTH an early-bird tent ticket and a full-price tent ticket, where "the codes applied for
 * early bird would be a lower value sponsor than the ones on the regular tickets".
 *
 * The thing these tests exist to stop is an AVERAGE creeping back in. Every other view of a
 * discount code in this app collapses it to one number; the whole feature is that it must not.
 */

const NO_PRICES: BasePrices = { tent: null, classroom: null };

function p(over: Partial<BudgetPerson>): BudgetPerson {
  return {
    churchId: 'c1',
    churchName: 'Victory',
    kind: 'camper',
    registrationCost: null,
    discountCode: null,
    accommodationKind: 'tent',
    amountPaid: null,
    ...over,
  };
}

/** Two tent tickets at two prices — the situation the whole feature is for. */
const EARLY = 'EARLY BIRD | Tent Accomodation';
const STANDARD = 'Tent Accomodation';
const early = (over: Partial<BudgetPerson> = {}) =>
  p({ registrationType: EARLY, registrationCost: 150, ...over });
const standard = (over: Partial<BudgetPerson> = {}) =>
  p({ registrationType: STANDARD, registrationCost: 190, ...over });

const SPONSOR: DiscountTagMap = { YC26SPON: 'sponsor' };

describe('computeSponsorSummary — the early-bird / full-price differential', () => {
  const people = [
    early({ discountCode: 'YC26SPON', amountPaid: 0 }),
    early({ discountCode: 'YC26SPON', amountPaid: 0 }),
    early({ discountCode: 'YC26SPON', amountPaid: 0 }),
    standard({ discountCode: 'YC26SPON', amountPaid: 0 }),
    standard({ discountCode: 'YC26SPON', amountPaid: 0 }),
  ];

  it('keeps the two sponsor values apart instead of averaging them', () => {
    const s = computeSponsorSummary(people, { tags: SPONSOR, prices: NO_PRICES });
    const row = s.codes[0]!;
    expect(row.code).toBe('YC26SPON');
    expect(row.bands.map((b) => [b.amount, b.count, b.total])).toEqual([
      [190, 2, 380],
      [150, 3, 450],
    ]);
    // The average of 150 and 190 is 170 — a figure describing nobody. It must not appear.
    expect(row.bands.some((b) => b.amount === 170)).toBe(false);
  });

  it('names each band by its ticket type, so the differential is legible', () => {
    const s = computeSponsorSummary(people, { tags: SPONSOR, prices: NO_PRICES });
    expect(s.codes[0]!.bands.map((b) => b.ticketTypes)).toEqual([[STANDARD], [EARLY]]);
  });

  it('totals the code, the camp, and reports it as a FULL sponsorship', () => {
    const s = computeSponsorSummary(people, { tags: SPONSOR, prices: NO_PRICES });
    expect(s.codes[0]!.total).toBe(830);
    expect(s.total).toBe(830);
    expect(s.fullTotal).toBe(830);
    expect(s.partialTotal).toBe(0);
    expect(s.count).toBe(5);
  });

  it('a band total always equals amount x count, and the bands sum to the code total', () => {
    const s = computeSponsorSummary(people, { tags: SPONSOR, prices: NO_PRICES });
    const row = s.codes[0]!;
    row.bands.forEach((b) => expect(b.total).toBe(b.amount * b.count));
    expect(row.bands.reduce((t, b) => t + b.total, 0)).toBe(row.total);
    expect(row.bands.reduce((t, b) => t + b.count, 0)).toBe(row.count - row.unpricedCount);
  });
});

describe('computeSponsorSummary — what counts as sponsor money', () => {
  it('RECONCILES: sponsor total + grand total = the value of every place', () => {
    /* The load-bearing property. `personValue` makes the grand total read as money RECEIVED;
       this figure is the rest. If someone recomputes the ask from `discountAmount` instead,
       this is the test that fails. */
    const people = [
      early({ discountCode: 'YC26SPON', amountPaid: 0 }),
      standard({ discountCode: 'YC26SPON', amountPaid: 0 }),
      standard({ amountPaid: 190 }),
    ];
    const budget = computeBudget(people, { tags: SPONSOR, prices: NO_PRICES });
    const sponsor = computeSponsorSummary(people, { tags: SPONSOR, prices: NO_PRICES });
    expect(budget.grandTotal + sponsor.total).toBe(150 + 190 + 190);
  });

  it('a discounted code asks only for the part that did not arrive', () => {
    const tags: DiscountTagMap = { HALF: 'discount' };
    const people = [standard({ discountCode: 'HALF', amountPaid: 95, discountAmount: 95 })];
    const s = computeSponsorSummary(people, { tags, prices: NO_PRICES });
    expect(s.codes[0]!.tag).toBe('discount');
    expect(s.codes[0]!.bands).toEqual([
      { amount: 95, ticketValue: 190, count: 1, total: 95, ticketTypes: [STANDARD] },
    ]);
    expect(s.partialTotal).toBe(95);
    expect(s.fullTotal).toBe(0);
  });

  it('EXCLUDES an in-person code — that money arrived, it was just taken by hand', () => {
    const tags: DiscountTagMap = { YC26CASH: 'inperson' };
    const people = [standard({ discountCode: 'YC26CASH', amountPaid: 0 })];
    const s = computeSponsorSummary(people, { tags, prices: NO_PRICES });
    expect(s.codes).toEqual([]);
    expect(s.total).toBe(0);
  });

  it('ignores an untagged code and a person with no code at all', () => {
    const people = [
      standard({ discountCode: 'MYSTERY', amountPaid: 0 }),
      standard({ amountPaid: 0 }),
    ];
    expect(computeSponsorSummary(people, { tags: SPONSOR, prices: NO_PRICES }).codes).toEqual([]);
  });

  it('never returns a negative ask when someone over-paid their own ticket', () => {
    const tags: DiscountTagMap = { HALF: 'discount' };
    const people = [standard({ discountCode: 'HALF', amountPaid: 250 })];
    expect(computeSponsorSummary(people, { tags, prices: NO_PRICES }).total).toBe(0);
  });
});

describe('computeSponsorSummary — prices it cannot know', () => {
  const UNPRICED = p({
    discountCode: 'YC26SPON',
    registrationType: 'Mystery Ticket',
    registrationCost: null,
    accommodationKind: null,
    amountPaid: 0,
  });

  it('counts an unpriced place but never totals it as $0', () => {
    const s = computeSponsorSummary([UNPRICED], { tags: SPONSOR, prices: NO_PRICES });
    expect(s.count).toBe(1);
    expect(s.unpricedCount).toBe(1);
    expect(s.total).toBe(0);
    // A $0 band would read as "already covered" — there must be no band at all.
    expect(s.codes[0]!.bands).toEqual([]);
  });

  it('falls back to the scalar setting when the ticket type has no invoice', () => {
    const s = computeSponsorSummary(
      [p({ discountCode: 'YC26SPON', accommodationKind: 'tent', amountPaid: 0 })],
      { tags: SPONSOR, prices: { tent: 150, classroom: 190 } },
    );
    expect(s.total).toBe(150);
    expect(s.unpricedCount).toBe(0);
  });

  it('prefers a price learned from ANOTHER church over the scalar setting', () => {
    /* Same reason computeBudget builds its table from the full set: the table is learned
       before scoping, so a filtered view still prices what the whole camp knows. */
    const people = [
      standard({ churchId: 'c2', churchName: 'Grace Point', amountPaid: 190 }),
      p({ discountCode: 'YC26SPON', registrationType: STANDARD, registrationCost: null, amountPaid: 0 }),
    ];
    const s = computeSponsorSummary(people, {
      tags: SPONSOR,
      prices: { tent: 999, classroom: null },
      filterChurchId: 'c1',
    });
    expect(s.total).toBe(190);
  });
});

describe('computeSponsorSummary — a sponsored place with unrecorded accommodation (2026-08-05 fix)', () => {
  /* 🔴 REGRESSION — the feature-review finding. Registered via Form+Invoice (so registrationCost
     is known) but not yet matched to a Ticket List row, so accommodationKind is null and
     classifyTicket returns 'unknown'. Before this fix, sponsorAmountFor/personValue only zeroed
     "received" when `cls` was 'tent-sponsor'/'classroom-sponsor' — which 'unknown' never is —
     so `received` fell through to registrationCost, making the ask look like $0 (as if the whole
     ticket had already been covered) instead of the true $190 still needed. */
  const person = p({
    accommodationKind: null,
    discountCode: 'YC26SPON',
    registrationCost: 190,
    amountPaid: null,
  });

  it('is still counted as a full $190 ask, not $0, even though accommodation is unrecorded', () => {
    const s = computeSponsorSummary([person], { tags: SPONSOR, prices: NO_PRICES });
    expect(s.unpricedCount).toBe(0); // the ticket price IS known — just not the accommodation kind
    expect(s.total).toBe(190);
    expect(s.fullTotal).toBe(190);
    expect(s.codes[0]!.bands).toEqual([
      { amount: 190, ticketValue: 190, count: 1, total: 190, ticketTypes: [] },
    ]);
  });

  it('the matching computeBudget row correctly reads $0 received (not the $190 registrationCost)', () => {
    const b = computeBudget([person], { tags: SPONSOR });
    expect(b.grandTotal).toBe(0);
  });
});

describe('computeSponsorSummary — code x church', () => {
  const tags: DiscountTagMap = { SPONA: 'sponsor', HALF: 'discount' };
  const people = [
    standard({ discountCode: 'SPONA', amountPaid: 0 }),
    early({ discountCode: 'SPONA', amountPaid: 0 }),
    standard({ churchId: 'c2', churchName: 'Grace Point', discountCode: 'SPONA', amountPaid: 0 }),
    standard({ churchId: 'c2', churchName: 'Grace Point', discountCode: 'HALF', amountPaid: 95 }),
  ];

  it('splits each code by church and each church by code, to the same totals', () => {
    const s = computeSponsorSummary(people, { tags, prices: NO_PRICES });
    expect(s.total).toBe(190 + 150 + 190 + 95);
    const spona = s.codes.find((c) => c.code === 'SPONA')!;
    expect(spona.churches.map((c) => [c.name, c.count, c.total])).toEqual([
      ['Victory', 2, 340],
      ['Grace Point', 1, 190],
    ]);
    const grace = s.churches.find((c) => c.name === 'Grace Point')!;
    expect(grace.total).toBe(285);
    expect(grace.codes.map((c) => [c.code, c.total])).toEqual([
      ['SPONA', 190],
      ['HALF', 95],
    ]);
    // The two breakdowns are two views of one figure and must agree with it.
    expect(s.churches.reduce((t, c) => t + c.total, 0)).toBe(s.total);
    expect(s.codes.reduce((t, c) => t + c.total, 0)).toBe(s.total);
  });

  it('scopes to one church exactly as computeBudget does', () => {
    const s = computeSponsorSummary(people, { tags, prices: NO_PRICES, filterChurchId: 'c2' });
    expect(s.churches.map((c) => c.name)).toEqual(['Grace Point']);
    expect(s.total).toBe(285);
  });

  it('orders codes and churches by the size of the ask', () => {
    const s = computeSponsorSummary(people, { tags, prices: NO_PRICES });
    expect(s.codes.map((c) => c.code)).toEqual(['SPONA', 'HALF']);
    expect(s.churches.map((c) => c.name)).toEqual(['Victory', 'Grace Point']);
  });
});

describe('sponsorAmountFor', () => {
  it('a full sponsor is the whole ticket; a plain ticket is nothing', () => {
    const person = standard({ discountCode: 'YC26SPON', amountPaid: 0 });
    const cls = classifyTicket(person, SPONSOR);
    expect(sponsorAmountFor(person, cls, NO_PRICES, 190)).toEqual({ ticketValue: 190, amount: 190 });
    const plain = standard({ amountPaid: 190 });
    expect(sponsorAmountFor(plain, classifyTicket(plain, SPONSOR), NO_PRICES, 190)).toEqual({
      ticketValue: 190,
      amount: 0,
    });
  });

  it('reports a null ticket value rather than a $0 ask', () => {
    const person = p({ accommodationKind: null, registrationCost: null });
    expect(sponsorAmountFor(person, classifyTicket(person, {}), NO_PRICES, null)).toEqual({
      ticketValue: null,
      amount: 0,
    });
  });
});

describe('2026-09-05 fix — cancelled, refunded and unclassified places', () => {
  const tags: DiscountTagMap = { SPON: 'sponsor', HALFOFF: 'discount', INP: 'inperson' };
  const prices: BasePrices = { tent: null, classroom: null };
  const base = (over: Partial<BudgetPerson> = {}): BudgetPerson => ({
    churchId: 'c1', churchName: 'Carindale', kind: 'camper',
    registrationCost: 190, amountPaid: 0, accommodationKind: 'classroom',
    discountCode: 'SPON', ...over,
  });

  it('excludes a cancelled place from the ask and reports it separately', () => {
    const r = computeSponsorSummary([base(), base({ status: 'cancelled' })], { tags, prices });
    expect(r.total).toBe(190);          // one place, not two
    expect(r.count).toBe(1);
    expect(r.withdrawnCount).toBe(1);
    expect(r.withdrawnTotal).toBe(190); // named, not silently dropped
  });

  it('a refund does not inflate the ask', () => {
    // A 'discount' code, not 'sponsor': 'sponsor' forces $0 received UNCONDITIONALLY (a
    // deliberate, documented 2026-08-04 rule — see receivedBeforeRefund), so it can never
    // exercise the refund-subtracts-from-what-was-actually-received path this test targets.
    const noRefund = computeSponsorSummary(
      [base({ discountCode: 'HALFOFF', amountPaid: 190 })], { tags, prices });
    const refunded = computeSponsorSummary(
      [base({ discountCode: 'HALFOFF', amountPaid: 190, refundAmount: 190 })], { tags, prices });
    expect(noRefund.total).toBe(0);
    expect(refunded.total).toBe(0);     // was 190 before this fix
  });

  it('reports an untagged code carrying a real discount, and never totals it', () => {
    const r = computeSponsorSummary(
      [base({ discountCode: 'UNTAGGED', discountAmount: 190, amountPaid: 0 })],
      { tags, prices });
    expect(r.total).toBe(0);            // excluded from the ask
    expect(r.count).toBe(0);
    expect(r.unclassifiedCount).toBe(1);
    expect(r.unclassifiedTotal).toBe(190);
    expect(r.unclassified).toEqual([
      { code: 'UNTAGGED', count: 1, total: 190, avgPercent: 100 },
    ]);
  });

  it('withdrawnCount is scoped to the ASK population, not every cancelled place', () => {
    // Review round 1 (2026-09-05): the cancelled check must be hoisted ahead of the
    // unclassified check, or a cancelled person on an untagged (but discounted) code falls
    // through into unclassifiedTotal instead of withdrawnTotal, which is the headline "money
    // we still need" figure this feature exists to surface. Reverting that ordering would
    // report outstanding money for someone who withdrew.
    //
    // Round 2 (2026-09-05): hoisting the check unconditionally then over-corrected — it also
    // counted a cancelled `inperson`-tagged place (never an ask to begin with: that money
    // genuinely arrived, just at the desk) into withdrawnCount, and would have counted a
    // plain untagged code with no discount evidence too. The Summary sheet renders this as
    // "Withdrawn (not asked for): N place(s), $X excluded from the total above" — asserting
    // an exclusion that never happened inflates N against a $0 amount and misleadingly reads
    // as sponsored places going missing. `withdrawnCount`/`withdrawnTotal` must therefore be
    // scoped to exactly the population that would otherwise have entered the ask: a
    // sponsor/discount-tagged code, or an untagged code `isUnclassifiedDiscount` flags.

    // cancelled + sponsor code -> withdrawn (unchanged from round 1)
    const sponsorCase = computeSponsorSummary(
      [base({ discountCode: 'SPON', status: 'cancelled' })], { tags, prices });
    expect(sponsorCase.withdrawnCount).toBe(1);

    // cancelled + untagged discounted code -> withdrawn, never unclassified (unchanged from round 1)
    const untaggedDiscountedCase = computeSponsorSummary(
      [base({ discountCode: 'UNTAGGED', discountAmount: 190, amountPaid: 0, status: 'cancelled' })],
      { tags, prices });
    expect(untaggedDiscountedCase.withdrawnCount).toBe(1);
    expect(untaggedDiscountedCase.unclassifiedCount).toBe(0);
    expect(untaggedDiscountedCase.unclassifiedTotal).toBe(0);

    // cancelled + inperson code -> NOT withdrawn (new — the regression guard for round 2)
    const inpersonCase = computeSponsorSummary(
      [base({ discountCode: 'INP', amountPaid: 190, status: 'cancelled' })], { tags, prices });
    expect(inpersonCase.withdrawnCount).toBe(0);

    // cancelled + no discount code at all -> NOT withdrawn (new)
    const noCodeCase = computeSponsorSummary(
      [base({ discountCode: null, amountPaid: 190, status: 'cancelled' })], { tags, prices });
    expect(noCodeCase.withdrawnCount).toBe(0);
  });

  it('does not flag an untagged code with no discount evidence', () => {
    const r = computeSponsorSummary(
      [base({ discountCode: 'PLAIN', discountAmount: 0, amountPaid: 190 })],
      { tags, prices });
    expect(r.unclassifiedCount).toBe(0);
  });

  it('a tagged code is never reported as unclassified', () => {
    const r = computeSponsorSummary([base({ discountAmount: 190 })], { tags, prices });
    expect(r.unclassifiedCount).toBe(0);
    expect(r.count).toBe(1);
  });
});
