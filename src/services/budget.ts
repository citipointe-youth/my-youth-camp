// Budget & costings — pure costing logic (Category H / brief §5).
//
// This is the CANONICAL costing algorithm and the unit-test target. The SPA mirrors the
// same algorithm in JS (the single-file HTML can't import from src/), so the vitest suite
// here proves the maths and the mock render proves the SPA mirror.
//
// Design (owner decisions, brief §5):
//  - A registration CATEGORY = a distinct `registrationCost` value within a (church, audience)
//    scope. Audience = camper | leader (shown separately).
//  - `registrationCost == null` → a "Cost not recorded" category: counted, flagged, contributes
//    $0 to totals (NEVER dropped — this is what makes the grand total honest).
//  - Friendly labels are derived from the amount RELATIVE TO THE DATASET (no hardcoded
//    180/90/0): the highest distinct positive cost → "Full"; 0 → "Sponsored"; a value ≈50% of
//    Full → "Half"; other positive values → "Part". A discountCode consistently tied to a tier
//    is surfaced as a hint.
//  - Church total = Σ camper line totals + Σ leader line totals.
//  - Grand total = Σ church totals, and MUST equal the sum of every category line total
//    (the core acceptance invariant — asserted by tests).

/** One registrant as the budget cares about it (a subset of RegistrantDto). */
export interface BudgetPerson {
  churchId: string;
  churchName: string;
  kind: 'camper' | 'leader';
  registrationCost: number | null;
  discountCode?: string | null;
  discountAmount?: number | null;
}

export interface CategoryRow {
  /** stable key within its (church, audience) scope: the cost as a string, or 'null'. */
  key: string;
  label: string;
  /** the per-person amount; null = "Cost not recorded" (counts as $0 toward totals). */
  amount: number | null;
  count: number;
  /** count * (amount ?? 0). */
  lineTotal: number;
  /** true for the "Cost not recorded" category, so the UI can flag it. */
  unrecorded: boolean;
  /** a discount code consistently associated with this tier, if any (UI hint). */
  codeHint?: string | null;
}

export interface ChurchBudget {
  churchId: string;
  churchName: string;
  camperCount: number;
  leaderCount: number;
  /** campers + leaders line totals. */
  total: number;
  campers: CategoryRow[];
  leaders: CategoryRow[];
}

export interface BudgetReport {
  grandTotal: number;
  camperCount: number;
  leaderCount: number;
  churchCount: number;
  churches: ChurchBudget[];
  /** the highest distinct positive cost in the dataset (the "Full" anchor), or null. */
  fullAmount: number | null;
}

const money = (n: number): string =>
  '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Derive a friendly label for an amount, relative to the dataset's `fullAmount`.
 * Pure and dataset-relative — no hardcoded tier values.
 */
export function labelForAmount(amount: number | null, fullAmount: number | null): string {
  if (amount == null) return 'Cost not recorded';
  if (amount === 0) return `Sponsored — ${money(0)}`;
  if (fullAmount != null && amount === fullAmount) return `Full — ${money(amount)}`;
  // ≈ half of full (within $1) reads as "Half"; otherwise a generic "Part".
  if (fullAmount != null && fullAmount > 0 && Math.abs(amount - fullAmount / 2) < 1) {
    return `Half — ${money(amount)}`;
  }
  return `Part — ${money(amount)}`;
}

interface Scope {
  byCost: Map<string, { amount: number | null; count: number; codes: Map<string, number> }>;
}

function emptyScope(): Scope {
  return { byCost: new Map() };
}

function addToScope(scope: Scope, p: BudgetPerson): void {
  const key = p.registrationCost == null ? 'null' : String(p.registrationCost);
  let row = scope.byCost.get(key);
  if (!row) {
    row = { amount: p.registrationCost ?? null, count: 0, codes: new Map() };
    scope.byCost.set(key, row);
  }
  row.count++;
  const code = (p.discountCode ?? '').trim();
  if (code) row.codes.set(code, (row.codes.get(code) ?? 0) + 1);
}

function scopeToRows(scope: Scope, fullAmount: number | null): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const [key, v] of scope.byCost) {
    const amount = v.amount;
    const lineTotal = (amount ?? 0) * v.count;
    // A code is a "hint" only if EVERY person in the tier shares the same single code.
    let codeHint: string | null = null;
    if (v.codes.size === 1) {
      const [onlyCode, n] = [...v.codes.entries()][0] as [string, number];
      if (n === v.count) codeHint = onlyCode;
    }
    rows.push({
      key,
      label: labelForAmount(amount, fullAmount),
      amount,
      count: v.count,
      lineTotal,
      unrecorded: amount == null,
      codeHint,
    });
  }
  // Sort: by amount descending; "Cost not recorded" (null) always last.
  rows.sort((a, b) => {
    if (a.amount == null) return 1;
    if (b.amount == null) return -1;
    return b.amount - a.amount;
  });
  return rows;
}

/**
 * Apply per-discount-code "paid in full" overrides before budgeting.
 *
 * Some registrants carry `registrationCost: 0` because a discount code was used to record a
 * manual EFTPOS/cash payment taken at registration — the money WAS collected, but the ticket
 * reads $0, so the budget buckets them as "Sponsored" and undercounts the total.
 *
 * Only a null/0 cost is filled. A genuinely recorded nonzero cost is never overwritten — an
 * override is a statement about missing data, not a repricing.
 *
 * Pure; returns a new array and does not mutate its input. Output flows through computeBudget
 * unchanged, so category bucketing, per-church totals, the grand total and the CSV export all
 * pick it up for free.
 */
export function applyDiscountOverrides(
  people: BudgetPerson[],
  overrides: Record<string, number>,
): BudgetPerson[] {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return people.slice();
  return people.map((p) => {
    const code = (p.discountCode ?? '').trim();
    if (!code) return p;
    const amount = overrides[code];
    if (amount == null) return p;
    // Only fill missing/zero — never reprice a recorded cost.
    if (p.registrationCost != null && p.registrationCost !== 0) return p;
    return { ...p, registrationCost: amount };
  });
}

/**
 * Compute the full budget report from a flat list of registrants.
 * @param people  registrants (campers + leaders) within the desired scope.
 * @param filterChurchId  if set, only this church is included and the grand total is scoped to it.
 */
export function computeBudget(
  people: readonly BudgetPerson[],
  filterChurchId?: string | null,
): BudgetReport {
  const scoped = filterChurchId ? people.filter((p) => p.churchId === filterChurchId) : people;

  // The "Full" anchor = the highest distinct POSITIVE cost across the (scoped) dataset.
  let fullAmount: number | null = null;
  for (const p of scoped) {
    if (p.registrationCost != null && p.registrationCost > 0) {
      fullAmount = fullAmount == null ? p.registrationCost : Math.max(fullAmount, p.registrationCost);
    }
  }

  // Group by church → audience.
  const byChurch = new Map<
    string,
    { churchId: string; churchName: string; campers: Scope; leaders: Scope }
  >();
  for (const p of scoped) {
    let c = byChurch.get(p.churchId);
    if (!c) {
      c = { churchId: p.churchId, churchName: p.churchName, campers: emptyScope(), leaders: emptyScope() };
      byChurch.set(p.churchId, c);
    }
    addToScope(p.kind === 'leader' ? c.leaders : c.campers, p);
  }

  const churches: ChurchBudget[] = [];
  for (const c of byChurch.values()) {
    const campers = scopeToRows(c.campers, fullAmount);
    const leaders = scopeToRows(c.leaders, fullAmount);
    const camperCount = campers.reduce((s, r) => s + r.count, 0);
    const leaderCount = leaders.reduce((s, r) => s + r.count, 0);
    const total =
      campers.reduce((s, r) => s + r.lineTotal, 0) + leaders.reduce((s, r) => s + r.lineTotal, 0);
    churches.push({ churchId: c.churchId, churchName: c.churchName, camperCount, leaderCount, total, campers, leaders });
  }
  churches.sort((a, b) => a.churchName.localeCompare(b.churchName));

  const grandTotal = churches.reduce((s, c) => s + c.total, 0);
  const camperCount = churches.reduce((s, c) => s + c.camperCount, 0);
  const leaderCount = churches.reduce((s, c) => s + c.leaderCount, 0);

  return { grandTotal, camperCount, leaderCount, churchCount: churches.length, churches, fullAmount };
}

export interface DiscountCodeRow {
  code: string;
  count: number;
  /**
   * Auto-derived summary of what the code is worth, e.g. "25% Off" or "$20 Off" — null
   * when no one using the code has both a registrationCost and a discountAmount recorded.
   */
  purpose: string | null;
}

export interface DiscountCodeSummary {
  /** total registrants in scope — the denominator for "X used of Y". */
  totalInScope: number;
  /** one row per distinct discount code actually used, most-used first. */
  rows: DiscountCodeRow[];
}

/** The four "clean" percentage tiers a code is snapped to when it's close enough. */
const DISCOUNT_PERCENT_BUCKETS = [25, 50, 70, 100] as const;
/** How many percentage points off a bucket still counts as "nearly divisible". */
const DISCOUNT_PERCENT_TOLERANCE = 3;

/**
 * Derive a human label for a discount code from the (pre-discount cost, discount amount)
 * pairs of the people who used it — e.g. "25% Off" or "$20 Off". Percentage is checked
 * first (a % code stays consistent across different ticket prices); if the average isn't
 * close to one of the four standard tiers, falls back to the average flat dollar amount.
 */
function deriveDiscountPurpose(pairs: { cost: number; discount: number }[]): string | null {
  const valid = pairs.filter((p) => p.cost > 0 && p.discount != null);
  if (!valid.length) return null;
  const avgPercent = valid.reduce((s, p) => s + (p.discount / p.cost) * 100, 0) / valid.length;
  const bucket = DISCOUNT_PERCENT_BUCKETS.find((b) => Math.abs(avgPercent - b) <= DISCOUNT_PERCENT_TOLERANCE);
  if (bucket != null) return `${bucket}% Off`;
  const avgDollar = Math.round(valid.reduce((s, p) => s + p.discount, 0) / valid.length);
  return avgDollar > 0 ? `$${avgDollar} Off` : null;
}

/**
 * How many registrants used each discount code, out of the total registrants in scope.
 * Blank/null discount codes are not counted as a "code". Same scoping as computeBudget
 * (own church / own zone / all, applied by the caller via filterChurchId).
 */
export function computeDiscountCodeSummary(
  people: readonly BudgetPerson[],
  filterChurchId?: string | null,
): DiscountCodeSummary {
  const scoped = filterChurchId ? people.filter((p) => p.churchId === filterChurchId) : people;
  const counts = new Map<string, number>();
  const pairsByCode = new Map<string, { cost: number; discount: number }[]>();
  for (const p of scoped) {
    const code = (p.discountCode ?? '').trim();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    if (p.registrationCost != null && p.discountAmount != null) {
      const pairs = pairsByCode.get(code) ?? [];
      pairs.push({ cost: p.registrationCost, discount: p.discountAmount });
      pairsByCode.set(code, pairs);
    }
  }
  const rows = [...counts.entries()]
    .map(([code, count]) => ({ code, count, purpose: deriveDiscountPurpose(pairsByCode.get(code) ?? []) }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { totalInScope: scoped.length, rows };
}

/**
 * Build the CSV export string (mirrors the app's other CSV exports — a plain string the SPA
 * downloads directly). Columns: Church, Audience, Category, Count, UnitPrice, LineTotal, with
 * a church-total row per church and a final grand-total row.
 */
export function budgetToCsv(report: BudgetReport): string {
  const esc = (s: string | number): string => {
    const str = String(s);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines: string[] = [];
  lines.push(['Church', 'Audience', 'Category', 'Count', 'UnitPrice', 'LineTotal'].join(','));
  const emit = (church: string, audience: string, rows: CategoryRow[]): void => {
    for (const r of rows) {
      lines.push(
        [esc(church), audience, esc(r.label), r.count, r.amount ?? 0, r.lineTotal].join(','),
      );
    }
  };
  for (const c of report.churches) {
    emit(c.churchName, 'Camper', c.campers);
    emit(c.churchName, 'Leader', c.leaders);
    lines.push([esc(c.churchName), 'Total', '', c.camperCount + c.leaderCount, '', c.total].join(','));
  }
  lines.push(['ALL CHURCHES', 'Grand Total', '', report.camperCount + report.leaderCount, '', report.grandTotal].join(','));
  return lines.join('\n');
}
