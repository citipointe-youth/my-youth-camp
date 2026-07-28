import { describe, it, expect } from 'vitest';
import {
  computeBudget,
  labelForAmount,
  budgetToCsv,
  computeDiscountCodeSummary,
  applyDiscountOverrides,
  type BudgetPerson,
  type BudgetReport,
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
    ...over,
  };
}

/** The core invariant: grand total === Σ of every category line total across all churches. */
function sumOfAllLines(r: BudgetReport): number {
  let s = 0;
  for (const c of r.churches) {
    for (const row of c.campers) s += row.lineTotal;
    for (const row of c.leaders) s += row.lineTotal;
  }
  return s;
}

describe('labelForAmount — dataset-relative smart labels', () => {
  it('highest positive = Full, 0 = Sponsored, half-of-full = Half, other = Part', () => {
    expect(labelForAmount(180, 180)).toBe('Full — $180');
    expect(labelForAmount(0, 180)).toBe('Sponsored — $0');
    expect(labelForAmount(90, 180)).toBe('Half — $90');
    expect(labelForAmount(120, 180)).toBe('Part — $120');
  });
  it('null = Cost not recorded', () => {
    expect(labelForAmount(null, 180)).toBe('Cost not recorded');
  });
  it('does not hardcode 180 — full anchor follows the data', () => {
    expect(labelForAmount(250, 250)).toBe('Full — $250');
    expect(labelForAmount(125, 250)).toBe('Half — $125');
  });
});

describe('computeBudget — mixed tiers', () => {
  const people: BudgetPerson[] = [
    // Grace Point: 3 full campers, 2 half, 2 sponsored, 2 sponsored leaders
    p({ churchId: 'c2', kind: 'camper', registrationCost: 180 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 180 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 180 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 90 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 90 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 0 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 0 }),
    p({ churchId: 'c2', kind: 'leader', registrationCost: 0 }),
    p({ churchId: 'c2', kind: 'leader', registrationCost: 0 }),
    // Victory: 7 full campers
    ...Array.from({ length: 7 }, () => p({ churchId: 'c1', kind: 'camper', registrationCost: 180 })),
  ];

  it('full anchor is the highest positive cost', () => {
    expect(computeBudget(people).fullAmount).toBe(180);
  });

  it('per-church camper categories carry count, amount, lineTotal', () => {
    const r = computeBudget(people);
    const gp = r.churches.find((c) => c.churchId === 'c2')!;
    const full = gp.campers.find((row) => row.amount === 180)!;
    expect(full.count).toBe(3);
    expect(full.lineTotal).toBe(540);
    const half = gp.campers.find((row) => row.amount === 90)!;
    expect(half).toMatchObject({ count: 2, lineTotal: 180 });
    const spon = gp.campers.find((row) => row.amount === 0)!;
    expect(spon).toMatchObject({ count: 2, lineTotal: 0 });
  });

  it('leaders are a separate group', () => {
    const gp = computeBudget(people).churches.find((c) => c.churchId === 'c2')!;
    expect(gp.leaderCount).toBe(2);
    expect(gp.leaders).toHaveLength(1);
    expect(gp.leaders[0]).toMatchObject({ amount: 0, count: 2, lineTotal: 0 });
  });

  it('church total = Σ camper lines + Σ leader lines', () => {
    const gp = computeBudget(people).churches.find((c) => c.churchId === 'c2')!;
    expect(gp.total).toBe(540 + 180 + 0 + 0); // 720
  });

  it('grand total = Σ church totals AND = Σ of every line total (the acceptance invariant)', () => {
    const r = computeBudget(people);
    expect(r.grandTotal).toBe(720 + 7 * 180); // Grace Point 720 + Victory 1260 = 1980
    expect(r.grandTotal).toBe(sumOfAllLines(r));
  });

  it('churches are sorted by name', () => {
    const r = computeBudget(people);
    expect(r.churches.map((c) => c.churchName)).toEqual(['Grace Point', 'Victory']);
  });
});

describe('computeBudget — edge cases (J5)', () => {
  it('all-sponsored church: total 0, invariant holds', () => {
    const people = Array.from({ length: 5 }, () => p({ churchId: 'c1', kind: 'camper', registrationCost: 0 }));
    const r = computeBudget(people);
    expect(r.grandTotal).toBe(0);
    expect(r.grandTotal).toBe(sumOfAllLines(r));
    expect(r.churches[0]!.campers[0]!.label).toBe('Sponsored — $0');
  });

  it('null cost → "Cost not recorded", counted but $0, never dropped; total stays honest', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 180 }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: null }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: null }),
    ];
    const r = computeBudget(people);
    expect(r.camperCount).toBe(3); // none dropped
    const c1 = r.churches[0]!;
    const unrec = c1.campers.find((row) => row.unrecorded)!;
    expect(unrec.count).toBe(2);
    expect(unrec.lineTotal).toBe(0);
    expect(unrec.label).toBe('Cost not recorded');
    expect(r.grandTotal).toBe(180); // only the recorded camper contributes
    expect(r.grandTotal).toBe(sumOfAllLines(r));
  });

  it('leaders-only church', () => {
    const people = Array.from({ length: 3 }, () => p({ churchId: 'c1', kind: 'leader', registrationCost: 0 }));
    const r = computeBudget(people);
    expect(r.camperCount).toBe(0);
    expect(r.leaderCount).toBe(3);
    expect(r.churches[0]!.campers).toHaveLength(0);
  });

  it('empty dataset', () => {
    const r = computeBudget([]);
    expect(r).toMatchObject({ grandTotal: 0, camperCount: 0, leaderCount: 0, churchCount: 0 });
    expect(r.fullAmount).toBeNull();
  });

  it('cost-not-recorded sorts last within a scope', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: null }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 180 }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90 }),
    ];
    const rows = computeBudget(people).churches[0]!.campers;
    expect(rows.map((r) => r.amount)).toEqual([180, 90, null]);
  });
});

describe('computeBudget — single-church filter', () => {
  const people: BudgetPerson[] = [
    p({ churchId: 'c1', kind: 'camper', registrationCost: 180 }),
    p({ churchId: 'c2', kind: 'camper', registrationCost: 90 }),
  ];
  it('scopes to one church and its grand total', () => {
    const r = computeBudget(people, 'c1');
    expect(r.churchCount).toBe(1);
    expect(r.grandTotal).toBe(180);
    expect(r.grandTotal).toBe(sumOfAllLines(r));
  });
});

describe('discount code hint', () => {
  it('surfaces a code only when every person in the tier shares it', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90, discountCode: 'EARLYBIRD' }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90, discountCode: 'EARLYBIRD' }),
    ];
    const row = computeBudget(people).churches[0]!.campers[0]!;
    expect(row.codeHint).toBe('EARLYBIRD');
  });
  it('no hint when codes differ', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90, discountCode: 'A' }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90, discountCode: 'B' }),
    ];
    expect(computeBudget(people).churches[0]!.campers[0]!.codeHint).toBeNull();
  });
});

describe('budgetToCsv', () => {
  it('emits header, per-church rows, church totals and a grand-total row; reconciles', () => {
    const people: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 180 }),
      p({ churchId: 'c1', kind: 'leader', registrationCost: 0 }),
    ];
    const r = computeBudget(people);
    const csv = budgetToCsv(r);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('Church,Audience,Category,Count,UnitPrice,LineTotal');
    expect(csv).toContain('Grand Total');
    // grand total in the last row equals the report grand total
    expect(rows[rows.length - 1]!.endsWith(',' + r.grandTotal)).toBe(true);
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
      { code: 'EARLYBIRD', count: 2, purpose: null },
      { code: 'ALIVE100', count: 1, purpose: null },
    ]);
  });

  it('scopes to a single church via filterChurchId', () => {
    const summary = computeDiscountCodeSummary(people, 'c1');
    expect(summary.totalInScope).toBe(3); // 2 EARLYBIRD + 1 blank-code camper, all c1
    expect(summary.rows).toEqual([{ code: 'EARLYBIRD', count: 2, purpose: null }]);
  });

  it('no discount codes at all → empty rows, totalInScope still reflects the scope', () => {
    const none: BudgetPerson[] = [p({ churchId: 'c1', kind: 'camper', discountCode: null })];
    expect(computeDiscountCodeSummary(none)).toEqual({ totalInScope: 1, rows: [] });
  });

  it('derives a clean percentage label when the discount is nearly one of the standard tiers', () => {
    const half: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 180, discountAmount: 90, discountCode: 'HALF' }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 90, discountAmount: 46, discountCode: 'HALF' }), // ~51% — within tolerance
    ];
    expect(computeDiscountCodeSummary(half).rows).toEqual([{ code: 'HALF', count: 2, purpose: '50% Off' }]);

    // Item C (2026-07-28): a code that wipes out the WHOLE ticket price is the "bought the wrong
    // ticket, pay only the difference" correction, not a sponsored place — it is still counted,
    // but labelled for what it is so the budget can't be misread as free places given away.
    // (This supersedes the earlier "100% Off" label; 100% is no longer reachable via the tier
    // buckets, which now top out below the 97% threshold.)
    const full: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 150, discountAmount: 150, discountCode: 'ALIVE100' }),
    ];
    expect(computeDiscountCodeSummary(full).rows).toEqual([
      { code: 'ALIVE100', count: 1, purpose: 'Ticket difference — already paid' },
    ]);
  });

  it('still labels a genuine 70% concession as a percentage, not a ticket difference (item C)', () => {
    const seventy: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 190, discountAmount: 133, discountCode: 'HARDSHIP' }),
    ];
    expect(computeDiscountCodeSummary(seventy).rows).toEqual([
      { code: 'HARDSHIP', count: 1, purpose: '70% Off' },
    ]);
  });

  it('falls back to a flat dollar label when the percentage is not close to a standard tier', () => {
    const flat: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: 190, discountAmount: 20, discountCode: 'SIBLING20' }),
      p({ churchId: 'c1', kind: 'camper', registrationCost: 150, discountAmount: 20, discountCode: 'SIBLING20' }),
    ];
    expect(computeDiscountCodeSummary(flat).rows).toEqual([{ code: 'SIBLING20', count: 2, purpose: '$20 Off' }]);
  });

  it('purpose is null when no one using the code has both a cost and a discount amount recorded', () => {
    const noFinancials: BudgetPerson[] = [
      p({ churchId: 'c1', kind: 'camper', registrationCost: null, discountAmount: null, discountCode: 'MYSTERY' }),
    ];
    expect(computeDiscountCodeSummary(noFinancials).rows).toEqual([{ code: 'MYSTERY', count: 1, purpose: null }]);
  });
});

describe('applyDiscountOverrides', () => {
  it('fills a null cost for a person whose code has an override', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: null, discountCode: 'EFTPOS' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(180);
  });

  it('fills a zero cost the same way', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: 'EFTPOS' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(180);
  });

  it('NEVER overwrites a genuinely recorded nonzero cost', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 90, discountCode: 'EFTPOS' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(90);
  });

  it('leaves people whose code has no override untouched', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: 'SPONSOR' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(0);
  });

  it('leaves people with no discount code untouched', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: null })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(0);
  });

  it('matches the code after trimming, consistent with computeDiscountCodeSummary', () => {
    const out = applyDiscountOverrides(
      [p({ id: '1', registrationCost: 0, discountCode: '  EFTPOS  ' })],
      { EFTPOS: 180 },
    );
    expect(out[0]?.registrationCost).toBe(180);
  });

  it('does not mutate its input', () => {
    const people = [p({ id: '1', registrationCost: 0, discountCode: 'EFTPOS' })];
    applyDiscountOverrides(people, { EFTPOS: 180 });
    expect(people[0]?.registrationCost).toBe(0);
  });

  it('feeds computeBudget so the overridden amount reaches the grand total', () => {
    const people = [
      p({ id: '1', registrationCost: 180, discountCode: null }),
      p({ id: '2', registrationCost: 0, discountCode: 'EFTPOS' }),
    ];
    const before = computeBudget(people);
    const after = computeBudget(applyDiscountOverrides(people, { EFTPOS: 180 }));
    expect(before.grandTotal).toBe(180);
    expect(after.grandTotal).toBe(360);
  });

  it('re-buckets the overridden person into the normal Full category', () => {
    const people = [
      p({ id: '1', registrationCost: 180, discountCode: null }),
      p({ id: '2', registrationCost: 0, discountCode: 'EFTPOS' }),
    ];
    const after = computeBudget(applyDiscountOverrides(people, { EFTPOS: 180 }));
    const labels = after.churches.flatMap((c) => c.campers.map((r) => r.label));
    expect(labels.some((l) => l.startsWith('Full'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Sponsored'))).toBe(false);
  });

  it('is a no-op for an empty override map', () => {
    const people = [p({ id: '1', registrationCost: 0, discountCode: 'EFTPOS' })];
    expect(computeBudget(applyDiscountOverrides(people, {})).grandTotal).toBe(
      computeBudget(people).grandTotal,
    );
  });
});
