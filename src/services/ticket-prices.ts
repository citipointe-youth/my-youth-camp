// ---------------------------------------------------------------------------
// ticket-prices.ts — what each Elvanto ticket type costs, LEARNED FROM THE
// INVOICES rather than typed into settings.
//
// WHY THIS EXISTS (2026-08-02). The camp had two scalar settings, `tentPrice`
// and `classroomPrice`, and they had never been filled in — so every ticket the
// budget could not value from an invoice was counted at $0. The owner then asked
// the question that kills the scalar model outright: *"what if there is a
// standard tent AND an early bird tent price?"* There is no answer with two
// numbers. Real ticket types in prod today:
//
//     "Classroom Accommodation"        $190   162 people
//     "EARLY BIRD | Tent Accomodation" $150    55 people
//
// and a standard tent ticket becomes a third the day early-bird closes.
//
// The key observation is that the price is ALREADY IN THE DATA and is perfectly
// consistent: `registrationCost` comes from the invoice, and each ticket type has
// exactly one distinct cost across every person who has one. So the table below
// is derived, not configured — a new ticket type prices itself the moment its
// first invoice lands, and there is nothing for an admin to keep in sync.
//
// The `tentPrice`/`classroomPrice` settings survive ONLY as a last-resort
// fallback for a ticket type that no one has an invoice for (e.g. a type whose
// every holder paid in person). See `personValue` in budget.ts for the cascade.
// ---------------------------------------------------------------------------

/** One ticket type's learned price, plus enough context to distrust it. */
export interface TicketPrice {
  /** The verbatim `registrationType` as first seen (for display). */
  label: string;
  /** The chosen price — the most common `registrationCost` among holders of this type. */
  price: number;
  /** How many people this price was derived from. */
  sample: number;
  /**
   * How many DISTINCT costs were seen for this type. 1 = unambiguous (the case for
   * every type in prod today). >1 means the ticket was re-priced mid-sale, or two
   * different tickets share a name — the UI should say so rather than pretending.
   */
  distinctCosts: number;
}

/** A person as the price table cares about them. */
export interface TicketPricePerson {
  registrationType?: string | null;
  registrationCost?: number | null;
}

/**
 * Canonical key for a ticket type: case- and whitespace-insensitive, so
 * `"EARLY BIRD | Tent Accomodation"` and `"early bird |  tent accomodation"`
 * are one type. Returns '' for a missing/blank type, which is never priced.
 */
export function normalizeTicketType(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Learn a price per ticket type from people who have BOTH a ticket type and a
 * recorded cost. Types with no priced holder are simply absent — callers fall
 * back rather than getting a made-up number.
 *
 * ⚠️ TIE-BREAK IS DELIBERATELY THE LOWER PRICE. When two costs are equally common
 * for one type, this table is used to value money as RECEIVED (and to split a
 * shared invoice), so guessing high invents income that nobody paid. Guessing low
 * under-reports, which is the direction the rest of the budget already errs in and
 * which `distinctCosts > 1` tells the UI to flag. Do not "improve" this to `max`.
 */
export function buildTicketPriceTable(people: readonly TicketPricePerson[]): Map<string, TicketPrice> {
  const seen = new Map<string, { label: string; counts: Map<number, number> }>();
  for (const p of people) {
    const key = normalizeTicketType(p.registrationType);
    if (!key) continue;
    if (p.registrationCost == null || !Number.isFinite(p.registrationCost)) continue;
    // Cost is money; bucket in cents so 190 and 190.0 are one price.
    const cents = Math.round(p.registrationCost * 100);
    let entry = seen.get(key);
    if (!entry) {
      entry = { label: (p.registrationType ?? '').trim(), counts: new Map() };
      seen.set(key, entry);
    }
    entry.counts.set(cents, (entry.counts.get(cents) ?? 0) + 1);
  }

  const table = new Map<string, TicketPrice>();
  for (const [key, entry] of seen) {
    let bestCents: number | null = null;
    let bestCount = 0;
    let sample = 0;
    for (const [cents, count] of entry.counts) {
      sample += count;
      if (count > bestCount || (count === bestCount && bestCents !== null && cents < bestCents)) {
        bestCount = count;
        bestCents = cents;
      }
    }
    if (bestCents === null) continue;
    table.set(key, {
      label: entry.label,
      price: bestCents / 100,
      sample,
      distinctCosts: entry.counts.size,
    });
  }
  return table;
}

/** The learned price for a person's ticket type, or null if the type is absent/unpriced. */
export function priceForTicket(
  table: Map<string, TicketPrice>,
  registrationType: string | null | undefined,
): number | null {
  const key = normalizeTicketType(registrationType);
  if (!key) return null;
  return table.get(key)?.price ?? null;
}

/** The table as a display list, most-used type first. */
export function ticketPriceRows(table: Map<string, TicketPrice>): TicketPrice[] {
  return [...table.values()].sort((a, b) => b.sample - a.sample || a.label.localeCompare(b.label));
}
