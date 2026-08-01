import { describe, it, expect } from 'vitest';
import {
  buildTicketPriceTable, normalizeTicketType, priceForTicket, ticketPriceRows,
} from './ticket-prices';

// ---------------------------------------------------------------------------
// ticket-prices.test.ts — the price table is DERIVED from the invoices, not
// configured, which is what lets the camp run an early-bird tent ticket and a
// standard tent ticket at the same time (two scalar settings cannot).
// ---------------------------------------------------------------------------

const p = (registrationType: string | null, registrationCost: number | null) =>
  ({ registrationType, registrationCost });

describe('normalizeTicketType', () => {
  it('folds case and collapses whitespace so one ticket is one type', () => {
    expect(normalizeTicketType('EARLY BIRD | Tent Accomodation'))
      .toBe(normalizeTicketType('early bird |  tent   accomodation '));
  });
  it('treats missing/blank as unpriceable rather than a type named ""', () => {
    expect(normalizeTicketType(null)).toBe('');
    expect(normalizeTicketType('   ')).toBe('');
  });
});

describe('buildTicketPriceTable', () => {
  it('learns one price per ticket type from the real prod shape', () => {
    const table = buildTicketPriceTable([
      ...Array.from({ length: 108 }, () => p('Classroom Accommodation', 190)),
      ...Array.from({ length: 45 }, () => p('EARLY BIRD | Tent Accomodation', 150)),
    ]);
    expect(priceForTicket(table, 'Classroom Accommodation')).toBe(190);
    expect(priceForTicket(table, 'EARLY BIRD | Tent Accomodation')).toBe(150);
    expect(table.get(normalizeTicketType('Classroom Accommodation'))!.distinctCosts).toBe(1);
  });

  it('prices an early-bird AND a standard tent ticket independently — the case two settings could not express', () => {
    const table = buildTicketPriceTable([
      p('EARLY BIRD | Tent Accomodation', 150),
      p('EARLY BIRD | Tent Accomodation', 150),
      p('Tent Accomodation', 180),
      p('Tent Accomodation', 180),
    ]);
    expect(priceForTicket(table, 'EARLY BIRD | Tent Accomodation')).toBe(150);
    expect(priceForTicket(table, 'Tent Accomodation')).toBe(180);
  });

  it('ignores people with no cost, and omits a type nobody has an invoice for', () => {
    const table = buildTicketPriceTable([
      p('Classroom Accommodation', 190),
      p('Classroom Accommodation', null),
      p('Paid In Person Only', null),
    ]);
    expect(table.get(normalizeTicketType('Classroom Accommodation'))!.sample).toBe(1);
    // Absent, NOT zero — the caller must fall back rather than value the place at $0.
    expect(priceForTicket(table, 'Paid In Person Only')).toBeNull();
  });

  it('takes the most common cost when a type was re-priced, and reports it as ambiguous', () => {
    const table = buildTicketPriceTable([
      p('Classroom Accommodation', 190),
      p('Classroom Accommodation', 190),
      p('Classroom Accommodation', 190),
      p('Classroom Accommodation', 210),
    ]);
    const row = table.get(normalizeTicketType('Classroom Accommodation'))!;
    expect(row.price).toBe(190);
    expect(row.distinctCosts).toBe(2);   // the UI's cue to flag it
    expect(row.sample).toBe(4);
  });

  it('breaks a tie DOWNWARD — guessing high would invent income nobody paid', () => {
    const table = buildTicketPriceTable([
      p('Classroom Accommodation', 190),
      p('Classroom Accommodation', 210),
    ]);
    expect(table.get(normalizeTicketType('Classroom Accommodation'))!.price).toBe(190);
  });

  it('buckets cents, so 190 and 190.00 are one price not two', () => {
    const table = buildTicketPriceTable([
      p('Classroom Accommodation', 190),
      p('Classroom Accommodation', 190.0),
    ]);
    expect(table.get(normalizeTicketType('Classroom Accommodation'))!.distinctCosts).toBe(1);
  });

  it('returns null for an unknown or blank type rather than throwing', () => {
    const table = buildTicketPriceTable([p('Classroom Accommodation', 190)]);
    expect(priceForTicket(table, 'Nope')).toBeNull();
    expect(priceForTicket(table, null)).toBeNull();
  });

  it('orders display rows by how many people hold the ticket', () => {
    const rows = ticketPriceRows(buildTicketPriceTable([
      p('Tent Accomodation', 180),
      ...Array.from({ length: 3 }, () => p('Classroom Accommodation', 190)),
    ]));
    expect(rows.map((r) => r.label)).toEqual(['Classroom Accommodation', 'Tent Accomodation']);
  });
});
