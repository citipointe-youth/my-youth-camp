import { describe, it, expect } from 'vitest';
import {
  computeBudget,
  labelForClass,
  labelForRow,
  classifyTicket,
  personValue,
  budgetToCsv,
  computeDiscountCodeSummary,
  type BudgetPerson,
  type BudgetReport,
  type DiscountTagMap,
  type TicketClass,
  type BasePrices,
} from './budget';

function p(
  over: Partial<BudgetPerson> & { id?: string } & Partial<Pick<BudgetPerson, 'churchId' | 'kind'>>,
): BudgetPerson {
  const churchId = over.churchId ?? 'c1';
  return {
    churchId,
    kind: 'camper',
    churchName: churchId === 'c1' ? 'Victory' : churchId === 'c2' ? 'Grace Point' : 'Riverbend',
    registrationCost: 180,
    discountCode: null,
    accommodationKind: 'tent',
    amountPaid: null,
    ...over,
  };
}

const NO_PRICES: BasePrices = { tent: null, classroom: null };

/** The core invariant: grand total === Σ of every category line total across all churches. */
function sumOfAllLines(r: BudgetReport): number {
  let s = 0;
  for (const c of r.churches) {
    for (const row of c.campers) s += row.lineTotal;
    for (const row of c.leaders) s += row.lineTotal;
  }
  return s;
}

describe('labelForClass', () => {
  it('labels every ticket class', () => {
    expect(labelForClass('tent')).toBe('Tent');
    expect(labelForClass('tent-inperson')).toBe('Tent — paid in person');
    expect(labelForClass('tent-discount')).toBe('Discounted tent');
    expect(labelForClass('tent-sponsor')).toBe('Tent full sponsor');
    expect(labelForClass('classroom')).toBe('Classroom');
    expect(labelForClass('classroom-inperson')).toBe('Classroom — paid in person');
    expect(labelForClass('classroom-discount')).toBe('Discounted classroom');
    expect(labelForClass('classroom-sponsor')).toBe('Classroom full sponsor');
    expect(labelForClass('unknown')).toBe('Accommodation not recorded');
  });
});

describe('labelForRow', () => {
  it('appends the unit price when there is one', () => {
    expect(labelForRow('tent', 180)).toBe('Tent — $180');
  });
  it('omits the price when amount is null (mixed row)', () => {
    expect(labelForRow('tent', null)).toBe('Tent');
  });
});

describe('classifyTicket — all nine outcomes', () => {
  const tags: DiscountTagMap = { INPERSON1: 'inperson', SPONSOR1: 'sponsor', DISC1: 'discount' };

  it('tent, no code → tent', () => {
    expect(classifyTicket(p({ accommodationKind: 'tent', discountCode: null }), tags)).toBe('tent');
  });
  it('tent, untagged code → tent', () => {
    expect(classifyTicket(p({ accommodationKind: 'tent', discountCode: 'RANDOMCODE' }), tags)).toBe('tent');
  });
  it('tent + inperson tag → tent-inperson', () => {
    expect(classifyTicket(p({ accommodationKind: 'tent', discountCode: 'INPERSON1' }), tags)).toBe('tent-inperson');
  });
  it('tent + sponsor tag → tent-sponsor', () => {
    expect(classifyTicket(p({ accommodationKind: 'tent', discountCode: 'SPONSOR1' }), tags)).toBe('tent-sponsor');
  });
  it('tent + discount tag → tent-discount', () => {
    expect(classifyTicket(p({ accommodationKind: 'tent', discountCode: 'DISC1' }), tags)).toBe('tent-discount');
  });
  it('classroom, no code → classroom', () => {
    expect(classifyTicket(p({ accommodationKind: 'classroom', discountCode: null }), tags)).toBe('classroom');
  });
  it('classroom + inperson tag → classroom-inperson', () => {
    expect(classifyTicket(p({ accommodationKind: 'classroom', discountCode: 'INPERSON1' }), tags)).toBe(
      'classroom-inperson',
    );
  });
  it('classroom + sponsor tag → classroom-sponsor', () => {
    expect(classifyTicket(p({ accommodationKind: 'classroom', discountCode: 'SPONSOR1' }), tags)).toBe(
      'classroom-sponsor',
    );
  });
  it('classroom + discount tag → classroom-discount', () => {
    expect(classifyTicket(p({ accommodationKind: 'classroom', discountCode: 'DISC1' }), tags)).toBe(
      'classroom-discount',
    );
  });
  it('accommodationKind null → unknown', () => {
    expect(classifyTicket(p({ accommodationKind: null }), tags)).toBe('unknown');
  });
  it('accommodationKind undefined → unknown', () => {
    const person = p({});
    delete (person as { accommodationKind?: unknown }).accommodationKind;
    expect(classifyTicket(person, tags)).toBe('unknown');
  });
  it('an unrecognised tag value in the map falls back to the plain class, not a crash', () => {
    const badTags = { FOO: 'bogus' as unknown as DiscountTagMap[string] };
    expect(classifyTicket(p({ accommodationKind: 'tent', discountCode: 'FOO' }), badTags)).toBe('tent');
  });
});

describe('personValue', () => {
  it('tent-inperson with prices.tent set → the base price, even if amountPaid is 0', () => {
    const person = p({ accommodationKind: 'tent', amountPaid: 0, registrationCost: 180 });
    expect(personValue(person, 'tent-inperson', { tent: 180, classroom: null })).toBe(180);
  });

  it('tent-inperson with prices.tent null → falls through to amountPaid/registrationCost instead of inventing a number', () => {
    const person = p({ accommodationKind: 'tent', amountPaid: 150, registrationCost: 180 });
    expect(personValue(person, 'tent-inperson', { tent: null, classroom: null })).toBe(150);
  });

  it('classroom-inperson with prices.classroom set → the base price', () => {
    const person = p({ accommodationKind: 'classroom', amountPaid: 0 });
    expect(personValue(person, 'classroom-inperson', { tent: null, classroom:90 })).toBe(90);
  });

  it('*-sponsor → 0 even when registrationCost is 180', () => {
    const person = p({ registrationCost: 180 });
    expect(personValue(person, 'tent-sponsor', NO_PRICES)).toBe(0);
    expect(personValue(person, 'classroom-sponsor', NO_PRICES)).toBe(0);
  });

  // Deliberate 2026-07-29 owner decision: the grand total reads as MONEY RECEIVED, not value of
  // all places, so amountPaid (what actually arrived) wins over registrationCost (the ticket
  // total) whenever both are recorded.
  it('otherwise amountPaid WINS over registrationCost (money received, not value of all places)', () => {
    const person = p({ registrationCost: 180, amountPaid: 150 });
    expect(personValue(person, 'tent', NO_PRICES)).toBe(150);
  });

  it('falls back to registrationCost when amountPaid is not recorded', () => {
    const person = p({ registrationCost: 180, amountPaid: null });
    expect(personValue(person, 'tent', NO_PRICES)).toBe(180);
  });

  it('both null → null', () => {
    const person = p({ registrationCost: null, amountPaid: null });
    expect(personValue(person, 'tent', NO_PRICES)).toBeNull();
  });
});

describe('computeBudget — core invariant', () => {
  it('grandTotal === Σ every category lineTotal, across churches/audiences, surviving sponsored/unknown/nothing-recorded people', () => {
    const tags: DiscountTagMap = { SPON: 'sponsor', INP: 'inperson' };
    const prices: BasePrices = { tent: 180, classroom: 150 };
    const people: BudgetPerson[] = [
      p({ churchId: 'c2', kind: 'camper', accommodationKind: 'tent', registrationCost: 180 }),
      p({ churchId: 'c2', kind: 'camper', accommodationKind: 'tent', registrationCost: 180 }),
      p({ churchId: 'c2', kind: 'camper', accommodationKind: 'classroom', registrationCost: 150 }),
      p({ churchId: 'c2', kind: 'camper', accommodationKind: 'tent', discountCode: 'SPON', registrationCost: 180 }),
      p({ churchId: 'c2', kind: 'camper', accommodationKind: 'tent', discountCode: 'INP', amountPaid: 0 }),
      p({ churchId: 'c2', kind: 'camper', accommodationKind: null, registrationCost: null, amountPaid: null }),
      p({ churchId: 'c2', kind: 'leader', accommodationKind: 'tent', discountCode: 'SPON', registrationCost: 180 }),
      p({ churchId: 'c2', kind: 'leader', accommodationKind: 'tent', registrationCost: 180 }),
      ...Array.from({ length: 7 }, () =>
        p({ churchId: 'c1', kind: 'camper', accommodationKind: 'classroom', registrationCost: 150 }),
      ),
      p({ churchId: 'c1', kind: 'camper', accommodationKind: null }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: null, amountPaid: null }),
    ];
    const r = computeBudget(people, { tags, prices });
    expect(r.grandTotal).toBe(sumOfAllLines(r));
    // sanity: nobody silently dropped
    expect(r.camperCount + r.leaderCount).toBe(people.length);
  });
});

describe('computeBudget — row ordering', () => {
  it('rows follow the fixed CLASS_ORDER within a scope', () => {
    const tags: DiscountTagMap = { SPON: 'sponsor', INP: 'inperson', DISC: 'discount' };
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'classroom' }),
      p({ accommodationKind: null }),
      p({ accommodationKind: 'tent', discountCode: 'SPON' }),
      p({ accommodationKind: 'tent' }),
      p({ accommodationKind: 'tent', discountCode: 'DISC' }),
      p({ accommodationKind: 'tent', discountCode: 'INP' }),
    ];
    const rows = computeBudget(people, { tags }).churches[0]!.campers;
    const order: TicketClass[] = ['tent', 'tent-inperson', 'tent-discount', 'tent-sponsor', 'classroom', 'unknown'];
    expect(rows.map((row) => row.key)).toEqual(order);
  });
});

describe('computeBudget — amount vs lineTotal', () => {
  it('a uniform-value row reports that value as amount', () => {
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'tent', registrationCost: 180 }),
      p({ accommodationKind: 'tent', registrationCost: 180 }),
    ];
    const row = computeBudget(people).churches[0]!.campers[0]!;
    expect(row.amount).toBe(180);
    expect(row.lineTotal).toBe(360);
  });

  it('a mixed-value row reports amount === null but a correct lineTotal', () => {
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'tent', registrationCost: 180 }),
      p({ accommodationKind: 'tent', registrationCost: 90 }),
    ];
    const row = computeBudget(people).churches[0]!.campers[0]!;
    expect(row.amount).toBeNull();
    expect(row.lineTotal).toBe(270);
  });

  it('valueMissingCount counts members who contributed $0 because nothing was recorded', () => {
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'tent', registrationCost: 180 }),
      p({ accommodationKind: 'tent', registrationCost: null, amountPaid: null }),
      p({ accommodationKind: 'tent', registrationCost: null, amountPaid: null }),
    ];
    const row = computeBudget(people).churches[0]!.campers[0]!;
    expect(row.valueMissingCount).toBe(2);
    expect(row.lineTotal).toBe(180);
    // mixed because two members are missing while one has 180 recorded
    expect(row.amount).toBeNull();
  });

  it('unrecorded is true ONLY on the unknown row', () => {
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'tent', registrationCost: 180 }),
      p({ accommodationKind: null }),
    ];
    const rows = computeBudget(people).churches[0]!.campers;
    for (const row of rows) {
      expect(row.unrecorded).toBe(row.key === 'unknown');
    }
  });
});

describe('computeBudget — leaders get the same nine classes as campers', () => {
  it('a sponsored leader and a tent leader both classify and total correctly', () => {
    const tags: DiscountTagMap = { SPON: 'sponsor' };
    const people: BudgetPerson[] = [
      p({ kind: 'leader', accommodationKind: 'tent', discountCode: 'SPON', registrationCost: 180 }),
      p({ kind: 'leader', accommodationKind: 'tent', registrationCost: 180 }),
    ];
    const r = computeBudget(people, { tags });
    const leaders = r.churches[0]!.leaders;
    const sponsorRow = leaders.find((row) => row.key === 'tent-sponsor')!;
    const tentRow = leaders.find((row) => row.key === 'tent')!;
    expect(sponsorRow).toMatchObject({ count: 1, lineTotal: 0 });
    expect(tentRow).toMatchObject({ count: 1, amount: 180, lineTotal: 180 });
  });
});

describe('computeBudget — church filter', () => {
  it('scopes to one church via filterChurchId', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', registrationCost: 180 }),
      p({ churchId: 'c2', registrationCost: 90 }),
    ];
    const r = computeBudget(people, { filterChurchId: 'c1' });
    expect(r.churchCount).toBe(1);
    expect(r.grandTotal).toBe(180);
    expect(r.grandTotal).toBe(sumOfAllLines(r));
  });
});

describe('computeBudget — edge cases', () => {
  it('empty dataset', () => {
    const r = computeBudget([]);
    expect(r).toMatchObject({ grandTotal: 0, camperCount: 0, leaderCount: 0, churchCount: 0 });
    expect(r.fullAmount).toBeNull();
  });
});

describe('discount code hint', () => {
  it('surfaces a code only when every person in the row shares it', () => {
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'tent', registrationCost: 90, discountCode: 'EARLYBIRD' }),
      p({ accommodationKind: 'tent', registrationCost: 90, discountCode: 'EARLYBIRD' }),
    ];
    const row = computeBudget(people).churches[0]!.campers[0]!;
    expect(row.codeHint).toBe('EARLYBIRD');
  });
  it('no hint when codes differ', () => {
    const people: BudgetPerson[] = [
      p({ accommodationKind: 'tent', registrationCost: 90, discountCode: 'A' }),
      p({ accommodationKind: 'tent', registrationCost: 90, discountCode: 'B' }),
    ];
    expect(computeBudget(people).churches[0]!.campers[0]!.codeHint).toBeNull();
  });
});

describe('budgetToCsv', () => {
  it('emits header, per-church rows, church totals and a grand-total row; reconciles', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', accommodationKind: 'tent', registrationCost: 180 }),
      p({ churchId: 'c1', kind: 'leader', accommodationKind: 'tent', registrationCost: 0, amountPaid: 0 }),
    ];
    const r = computeBudget(people);
    const csv = budgetToCsv(r);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('Church,Audience,Category,Count,UnitPrice,LineTotal');
    expect(csv).toContain('Grand Total');
    expect(rows[rows.length - 1]!.endsWith(',' + r.grandTotal)).toBe(true);
  });

  it('writes an empty UnitPrice cell (not 0) for a mixed-value row', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', accommodationKind: 'tent', registrationCost: 180 }),
      p({ churchId: 'c1', kind: 'camper', accommodationKind: 'tent', registrationCost: 90 }),
    ];
    const r = computeBudget(people);
    const csv = budgetToCsv(r);
    const line = csv.split('\n').find((l) => l.includes('Victory,Camper,Tent,'))!;
    expect(line).toBeDefined();
    // Church,Audience,Category,Count,UnitPrice,LineTotal — UnitPrice cell must be blank
    const cells = line.split(',');
    expect(cells[4]).toBe('');
    expect(Number(cells[5])).toBe(270);
  });
});

describe('computeDiscountCodeSummary', () => {
  const people: BudgetPerson[] = [
    p({ churchId: 'c1', kind: 'camper', discountCode: 'EARLYBIRD' }),
    p({ churchId: 'c1', kind: 'camper', discountCode: 'EARLYBIRD' }),
    p({ churchId: 'c2', kind: 'leader', discountCode: 'ALIVE100' }),
    p({ churchId: 'c2', kind: 'camper', discountCode: null }),
    p({ churchId: 'c1', kind: 'camper', discountCode: '  ' }), // blank/whitespace-only — not a code
  ];

  it('groups by code, most-used first, and totals against all registrants in scope', () => {
    const summary = computeDiscountCodeSummary(people);
    expect(summary.totalInScope).toBe(5);
    expect(summary.rows).toEqual([
      { code: 'EARLYBIRD', count: 2, purpose: null, tag: null },
      { code: 'ALIVE100', count: 1, purpose: null, tag: null },
    ]);
  });

  it('scopes to a single church via filterChurchId', () => {
    const summary = computeDiscountCodeSummary(people, 'c1');
    expect(summary.totalInScope).toBe(3); // 2 EARLYBIRD + 1 blank-code camper, all c1
    expect(summary.rows).toEqual([{ code: 'EARLYBIRD', count: 2, purpose: null, tag: null }]);
  });

  it('no discount codes at all → empty rows, totalInScope still reflects the scope', () => {
    const none: BudgetPerson[] = [p({ churchId: 'c1', kind: 'camper', discountCode: null })];
    expect(computeDiscountCodeSummary(none)).toEqual({ totalInScope: 1, rows: [] });
  });

  it('carries the admin-set tag for a row, or null when untagged', () => {
    const tags: DiscountTagMap = { EARLYBIRD: 'discount' };
    const summary = computeDiscountCodeSummary(people, undefined, tags);
    expect(summary.rows).toEqual([
      { code: 'EARLYBIRD', count: 2, purpose: null, tag: 'discount' },
      { code: 'ALIVE100', count: 1, purpose: null, tag: null },
    ]);
  });

  it('derives a clean percentage label when the discount is nearly one of the standard tiers', () => {
    const half: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 180, discountAmount: 90, discountCode: 'HALF' }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90, discountAmount: 46, discountCode: 'HALF' }), // ~51% — within tolerance
    ];
    expect(computeDiscountCodeSummary(half).rows).toEqual([
      { code: 'HALF', count: 2, purpose: '50% Off', tag: null },
    ]);

    // Item C (2026-07-28): a code that wipes out the WHOLE ticket price is the "bought the wrong
    // ticket, pay only the difference" correction, not a sponsored place — it is still counted,
    // but labelled for what it is so the budget can't be misread as free places given away.
    const full: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 150, discountAmount: 150, discountCode: 'ALIVE100' }),
    ];
    expect(computeDiscountCodeSummary(full).rows).toEqual([
      { code: 'ALIVE100', count: 1, purpose: 'Ticket difference — already paid', tag: null },
    ]);
  });

  it('still labels a genuine 70% concession as a percentage, not a ticket difference (item C)', () => {
    const seventy: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 190, discountAmount: 133, discountCode: 'HARDSHIP' }),
    ];
    expect(computeDiscountCodeSummary(seventy).rows).toEqual([
      { code: 'HARDSHIP', count: 1, purpose: '70% Off', tag: null },
    ]);
  });

  it('falls back to a flat dollar label when the percentage is not close to a standard tier', () => {
    const flat: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 190, discountAmount: 20, discountCode: 'SIBLING20' }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 150, discountAmount: 20, discountCode: 'SIBLING20' }),
    ];
    expect(computeDiscountCodeSummary(flat).rows).toEqual([
      { code: 'SIBLING20', count: 2, purpose: '$20 Off', tag: null },
    ]);
  });

  it('purpose is null when no one using the code has both a cost and a discount amount recorded', () => {
    const noFinancials: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: null, discountAmount: null, discountCode: 'MYSTERY' }),
    ];
    expect(computeDiscountCodeSummary(noFinancials).rows).toEqual([
      { code: 'MYSTERY', count: 1, purpose: null, tag: null },
    ]);
  });
});
