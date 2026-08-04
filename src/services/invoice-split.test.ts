import { describe, it, expect } from 'vitest';
import { resolveInvoiceSplit, MAX_UNPRICED_SLOTS, type SplitPerson } from './invoice-split';
import type { AccommodationKind } from '../core/types/enums';

/**
 * These pin the 2026-08-04 change to WHEN a shared invoice raises `needsReview`.
 *
 * Owner: *"the data import review is slightly too sensitive — when it auto-splits an invoice,
 * if the numbers cleanly match a ticket price then don't flag for review."* Before this, an
 * unpriced ticket TYPE was the only question asked, so an invoice whose total had exactly one
 * possible decomposition was flagged anyway.
 *
 * ⚠ The load-bearing assertions here are the pairs that produce the SAME NUMBERS with a
 * DIFFERENT flag ("provably an even split" vs "we gave up and split evenly"), and the
 * one-tent-one-classroom case, where a wrong answer reconciles to the cent.
 */
const CATALOGUE = [150, 190];
/** Prices in CENTS → the kind that price means, as `buildAccommodationPriceLookup` returns. */
const KINDS = new Map<number, AccommodationKind>([[15000, 'tent'], [19000, 'classroom']]);
const NO_KINDS = new Map<number, AccommodationKind>();

const p = (ticketPrice: number | null, accommodationKind: AccommodationKind | null = null): SplitPerson =>
  ({ ticketPrice, accommodationKind });

describe('resolveInvoiceSplit — every ticket type priced', () => {
  it('splits by ticket price and does not flag', () => {
    const r = resolveInvoiceSplit([p(190), p(150)], 340, CATALOGUE, KINDS);
    expect(r.costs).toEqual([190, 150]);
    expect(r.method).toBe('ticket-price');
    expect(r.needsReview).toBe(false);
  });

  it('still does not flag when a shared discount means the tickets exceed the total', () => {
    // $340 of tickets, $320 invoiced. Apportioning the $20 in proportion to what each ticket
    // cost is how a shared discount works — it is not a guess and must not raise review.
    const r = resolveInvoiceSplit([p(190), p(150)], 320, CATALOGUE, KINDS);
    expect(r.costs).toEqual([190, 150]);
    expect(r.needsReview).toBe(false);
  });

  it('does not need an invoice total at all', () => {
    const r = resolveInvoiceSplit([p(190), p(150)], null, CATALOGUE, KINDS);
    expect(r.costs).toEqual([190, 150]);
    expect(r.needsReview).toBe(false);
  });
});

describe('resolveInvoiceSplit — the total resolves the unpriced tickets', () => {
  it('OWNER CASE: one known ticket leaves a residual that is a real price — no review', () => {
    const r = resolveInvoiceSplit([p(190), p(null)], 340, CATALOGUE, KINDS);
    expect(r.costs).toEqual([190, 150]);
    expect(r.method).toBe('residual');
    expect(r.needsReview).toBe(false);
  });

  it('resolves BOTH unpriced tickets when only one decomposition exists', () => {
    // $300 = 150 + 150. The numbers match an even split, but they are DERIVED, not assumed.
    const r = resolveInvoiceSplit([p(null), p(null)], 300, CATALOGUE, KINDS);
    expect(r.costs).toEqual([150, 150]);
    expect(r.method).toBe('residual');
    expect(r.needsReview).toBe(false);
  });

  it('⚠ produces the same numbers as the give-up path but NOT the same flag', () => {
    const resolved = resolveInvoiceSplit([p(null), p(null)], 300, CATALOGUE, KINDS);
    const gaveUp = resolveInvoiceSplit([p(null), p(null)], 317, CATALOGUE, KINDS);
    expect(resolved.needsReview).toBe(false);
    expect(gaveUp.needsReview).toBe(true);
    expect(gaveUp.costs).toBeNull();
  });

  it('resolves three people', () => {
    const r = resolveInvoiceSplit([p(null), p(190), p(null)], 490, CATALOGUE, KINDS);
    expect(r.costs).toEqual([150, 190, 150]);
    expect(r.needsReview).toBe(false);
  });
});

describe('resolveInvoiceSplit — one tent, one classroom', () => {
  const TENT_AND_CLASSROOM = 340;

  it('⚠ FLAGS when both tickets are unpriced and nothing says who is who', () => {
    // 150+190 is the only multiset, but (A=150,B=190) and (A=190,B=150) are both possible.
    // Recording the tent price against the classroom camper is a WRONG number that
    // reconciles perfectly — exactly the case a human has to settle.
    const r = resolveInvoiceSplit([p(null), p(null)], TENT_AND_CLASSROOM, CATALOGUE, KINDS);
    expect(r.costs).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it('resolves it when a CONFIRMED accommodation kind picks the assignment', () => {
    const r = resolveInvoiceSplit(
      [p(null, 'classroom'), p(null, 'tent')], TENT_AND_CLASSROOM, CATALOGUE, KINDS);
    expect(r.costs).toEqual([190, 150]);
    expect(r.needsReview).toBe(false);
  });

  it('resolves it from ONE confirmed kind — the other person is then forced', () => {
    const r = resolveInvoiceSplit(
      [p(null), p(null, 'tent')], TENT_AND_CLASSROOM, CATALOGUE, KINDS);
    expect(r.costs).toEqual([190, 150]);
    expect(r.needsReview).toBe(false);
  });

  it('flags again when the price→kind map cannot distinguish the prices', () => {
    // Same people, but nothing is known about which price means which kind.
    const r = resolveInvoiceSplit(
      [p(null, 'classroom'), p(null, 'tent')], TENT_AND_CLASSROOM, CATALOGUE, NO_KINDS);
    expect(r.needsReview).toBe(true);
  });

  it('flags when the confirmed kinds contradict every decomposition', () => {
    // Two confirmed tents cannot cost $340 when a tent is $150.
    const r = resolveInvoiceSplit(
      [p(null, 'tent'), p(null, 'tent')], TENT_AND_CLASSROOM, CATALOGUE, KINDS);
    expect(r.costs).toBeNull();
    expect(r.needsReview).toBe(true);
  });
});

describe('resolveInvoiceSplit — falls back rather than guessing', () => {
  it('flags when more than one decomposition exists', () => {
    // $600 over three unpriced tickets: 150+150+300? no — but 190+190+220 no...
    // With {150,190}: 150*4=600 needs four slots; over three there is no exact hit, so use a
    // catalogue where two answers genuinely exist: {100,200,300} over two slots summing to 400
    // = 100+300, 300+100, 200+200 → three assignments.
    const r = resolveInvoiceSplit([p(null), p(null)], 400, [100, 200, 300], NO_KINDS);
    expect(r.costs).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it('flags when no combination reaches the total', () => {
    const r = resolveInvoiceSplit([p(null), p(null)], 317, CATALOGUE, KINDS);
    expect(r.needsReview).toBe(true);
  });

  it('flags when there is no invoice total to work from', () => {
    const r = resolveInvoiceSplit([p(190), p(null)], null, CATALOGUE, KINDS);
    expect(r.costs).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it('flags when the catalogue is empty (nobody has an invoice yet)', () => {
    const r = resolveInvoiceSplit([p(null), p(null)], 500, [], NO_KINDS);
    expect(r.needsReview).toBe(true);
  });

  it('flags when the known tickets already exceed the invoice total', () => {
    const r = resolveInvoiceSplit([p(190), p(190), p(null)], 340, CATALOGUE, KINDS);
    expect(r.needsReview).toBe(true);
  });

  it('bails out past MAX_UNPRICED_SLOTS rather than searching wide', () => {
    const many = Array.from({ length: MAX_UNPRICED_SLOTS + 1 }, () => p(null));
    const r = resolveInvoiceSplit(many, 150 * many.length, CATALOGUE, KINDS);
    expect(r.needsReview).toBe(true);
  });

  it('handles an empty group', () => {
    expect(resolveInvoiceSplit([], 100, CATALOGUE, KINDS).costs).toBeNull();
  });
});

describe('resolveInvoiceSplit — money arithmetic', () => {
  it('matches on cents, so a fractional price is not lost to float drift', () => {
    const r = resolveInvoiceSplit([p(null), p(null)], 195.1, [97.55], NO_KINDS);
    expect(r.costs).toEqual([97.55, 97.55]);
    expect(r.needsReview).toBe(false);
  });

  it('treats a zero or negative learned price as unpriced, never as a weight of 0', () => {
    // A 0 weight would hand the whole invoice to the other person.
    const r = resolveInvoiceSplit([p(0), p(190)], 340, CATALOGUE, KINDS);
    expect(r.costs).toEqual([150, 190]);
    expect(r.needsReview).toBe(false);
  });
});
