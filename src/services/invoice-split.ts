import type { AccommodationKind } from '../core/types/enums';

// ---------------------------------------------------------------------------
// invoice-split.ts — deciding what each person on a SHARED (family) invoice was
// charged, and — the point of this module — deciding when that answer is solid
// enough that a human does not need to look at it.
//
// WHY THIS EXISTS (2026-08-04). The first version of the shared-invoice split
// (2026-08-02) had exactly two outcomes: every person's ticket TYPE has a learned
// price → split by price, no flag; otherwise → split equally and flag everyone
// `needsReview`. Owner: *"the data import review is slightly too sensitive — when
// it auto-splits an invoice, if the numbers cleanly match a ticket price then
// don't flag for review."*
//
// That is a fair complaint, because the ticket TYPE is not the only evidence on
// the row. The invoice TOTAL is evidence too:
//
//     $340 across two people, one ticket type unknown, the other a $190 classroom
//     → the unknown one cost $150, and $150 is a real ticket price. Nothing is
//       being guessed; the arithmetic has one answer.
//
//     $300 across two people, both ticket types unknown, $150 in the catalogue
//     → $150 + $150. Also one answer, and it happens to equal the equal split —
//       but "the equal split is provably right" and "we gave up and split equally"
//       are different facts and must not raise the same flag.
//
// So the rule is now: state a per-person cost whenever the invoice total can be
// decomposed into catalogue prices in EXACTLY ONE way. One way = a fact. More
// than one way = a genuine ambiguity and the flag is earned.
//
// ⚠️ THE ONE-TENT-ONE-CLASSROOM CASE IS WHY `accommodationKind` IS HERE.
// Two unknown tickets totalling $340 against a {$150, $190} catalogue decomposes
// as {150, 190} — one multiset, but TWO assignments, because we do not know which
// sibling is which. Recording the tent price against the classroom camper is a
// wrong number that reconciles perfectly, i.e. the worst kind. Their CONFIRMED
// accommodation kind breaks the tie: if $150 is known to be a tent price and one
// of them is confirmed tent, only one assignment survives and the split is a fact
// again. Without that evidence it stays ambiguous and stays flagged.
//
// ⚠️ ONLY A **CONFIRMED** KIND MAY BE USED. A `guessed` kind was itself inferred
// from an invoice total by `buildAccommodationPriceLookup`, so feeding it back in
// here would let a guess confirm itself.
// ---------------------------------------------------------------------------

/** One person on a shared invoice, as the resolver cares about them. */
export interface SplitPerson {
  /** The learned price for their ticket TYPE (`priceForTicket`), or null if unpriced. */
  ticketPrice: number | null;
  /** Their accommodation kind — pass null unless the confidence is `confirmed`. */
  accommodationKind: AccommodationKind | null;
}

export interface InvoiceSplit {
  /**
   * Per-person ticket cost, aligned to the input. Null means we could not state one
   * for everybody, and the caller should fall back to its own even split.
   */
  costs: number[] | null;
  /** How `costs` was reached — drives the warning line, and nothing else. */
  method: 'ticket-price' | 'residual' | 'unresolved';
  /** True only when the split is a guess. A resolved split is a fact and never flags. */
  needsReview: boolean;
}

/**
 * Beyond this many unpriced people the search is abandoned rather than run.
 * A shared invoice is a family — prod's largest is three — and a wide search over
 * a long catalogue is both slow and far more likely to find a coincidental second
 * decomposition, which would flag the invoice anyway. Bailing early reaches the
 * same outcome without the work.
 */
export const MAX_UNPRICED_SLOTS = 4;

const toCents = (v: number): number => Math.round(v * 100);

/**
 * Enumerate every assignment of catalogue prices to `slots` that sums to `residual`,
 * stopping as soon as a second one is found — the caller only ever asks "is there
 * exactly one?", so counting past two is wasted work.
 *
 * Returns assignment VECTORS, not multisets, and that distinction is load-bearing:
 * {150,190} and {190,150} are two different answers to "what did each person pay",
 * and if both survive the `allowed` filter the invoice is genuinely ambiguous.
 */
function enumerateAssignments(
  slots: number,
  residual: number,
  catalogue: readonly number[],
  allowed: (slot: number, priceCents: number) => boolean,
): number[][] {
  if (slots <= 0 || catalogue.length === 0) return [];
  const min = catalogue[0]!;
  const max = catalogue[catalogue.length - 1]!;
  const found: number[][] = [];
  const current: number[] = [];

  const walk = (slot: number, remaining: number): void => {
    if (found.length > 1) return; // two is enough to know it is ambiguous
    const left = slots - slot;
    if (left === 0) {
      if (remaining === 0) found.push([...current]);
      return;
    }
    // Nothing in range can reach the remainder — prune the whole subtree.
    if (remaining < min * left || remaining > max * left) return;
    for (const price of catalogue) {
      if (price > remaining) break; // catalogue is ascending
      if (!allowed(slot, price)) continue;
      current.push(price);
      walk(slot + 1, remaining - price);
      current.pop();
      if (found.length > 1) return;
    }
  };

  walk(0, residual);
  return found;
}

/**
 * Work out what each person on a shared invoice was charged.
 *
 * `catalogue` is the set of distinct learned ticket prices (see `ticketPriceCatalogue`);
 * `kindByPrice` maps a price in CENTS to the accommodation kind that price is known to
 * mean (the same map `invoice-import.service` builds for its accommodation guessing).
 */
export function resolveInvoiceSplit(
  people: readonly SplitPerson[],
  invoiceTotal: number | null,
  catalogue: readonly number[],
  kindByPrice: ReadonlyMap<number, AccommodationKind>,
): InvoiceSplit {
  const unresolved: InvoiceSplit = { costs: null, method: 'unresolved', needsReview: true };
  if (people.length === 0) return unresolved;

  const base = people.map((p) => (p.ticketPrice != null && p.ticketPrice > 0 ? p.ticketPrice : null));

  // Everyone's ticket type is priced — the original, and still the common, case.
  // Note this does NOT require the prices to sum to the invoice: when a shared
  // discount was applied they will not, and apportioning it in proportion to what
  // each ticket cost is how a shared discount actually works. Still a fact, still
  // no flag.
  if (base.every((v): v is number => v != null)) {
    return { costs: base, method: 'ticket-price', needsReview: false };
  }

  if (invoiceTotal == null) return unresolved;

  const slots: number[] = [];
  base.forEach((v, i) => { if (v == null) slots.push(i); });
  if (slots.length > MAX_UNPRICED_SLOTS) return unresolved;

  const knownCents = base.reduce<number>((sum, v) => sum + (v == null ? 0 : toCents(v)), 0);
  const residual = toCents(invoiceTotal) - knownCents;
  if (residual <= 0) return unresolved;

  const priceCents = [...new Set(catalogue.filter((p) => p > 0).map(toCents))].sort((a, b) => a - b);

  const allowed = (slot: number, price: number): boolean => {
    const kind = kindByPrice.get(price);
    if (!kind) return true; // the price says nothing about where they sleep
    const person = people[slots[slot]!]!;
    // Only a CONFIRMED kind is passed in, so a mismatch here is real evidence.
    return person.accommodationKind == null || person.accommodationKind === kind;
  };

  const solutions = enumerateAssignments(slots.length, residual, priceCents, allowed);
  if (solutions.length !== 1) return unresolved;

  const costs = [...base] as (number | null)[];
  solutions[0]!.forEach((cents, i) => { costs[slots[i]!] = cents / 100; });
  return { costs: costs as number[], method: 'residual', needsReview: false };
}
