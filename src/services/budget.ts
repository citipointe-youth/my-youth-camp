// Budget & costings — pure costing logic (Category H / brief §5).
//
// This is the CANONICAL costing algorithm and the unit-test target. The SPA mirrors the
// same algorithm in JS (the single-file HTML can't import from src/), so the vitest suite
// here proves the maths and the mock render proves the SPA mirror.
//
// ─── 2026-07-29 REWRITE: ticket CLASSIFICATION replaced cost bands ───────────────────────
// A category used to be "a distinct registrationCost value" and was labelled as a band —
// "Full — $180", "Half — $90", "Part — $120", "Sponsored — $0". The owner does not think in
// cost bands, they think in TICKET TYPES, and that model made the tent/classroom split
// invisible in the budget entirely.
//
// A category is now a TicketClass: the accommodation kind (tent | classroom) crossed with a
// payment tag the admin sets ON THE DISCOUNT CODE, plus one bucket for people whose
// accommodation kind was never recorded.
//
//   (no code / untagged code) → "Tent"                    / "Classroom"
//   tag 'inperson'            → "Tent — paid in person"   / "Classroom — paid in person"
//   tag 'sponsor'             → "Tent full sponsor"       / "Classroom full sponsor"
//   tag 'discount'            → "Discounted tent"         / "Discounted classroom"
//   accommodationKind == null → "Accommodation not recorded"   (flagged, never dropped)
//
// The tag lives on the code rather than the person because the codes ARE the mechanism the
// camp already uses: a no-code invoice is a plain full-price ticket, and every concession,
// sponsorship and pay-at-the-desk arrangement is expressed as a code against that baseline.
// One tag per code covers every registrant who used it — no per-person data entry.
//
// ⚠ THE GRAND TOTAL IS "MONEY RECEIVED", NOT "VALUE OF ALL PLACES". See `personValue` for
// the ordering and the reasoning; this was a deliberate 2026-07-29 change and it moves the
// number. Do not "fix" it back to registrationCost without re-reading that comment.
//
// Invariants (asserted by tests, unchanged):
//  - Church total = Σ camper line totals + Σ leader line totals.
//  - Grand total = Σ church totals, and MUST equal the sum of every category line total.
//    Nobody is ever silently dropped — that is what makes the grand total honest.

/** How an admin has classified a discount code on the Budget screen. */
export type DiscountTag = 'inperson' | 'sponsor' | 'discount';

/** code → tag. A code that is absent (or maps to an unknown value) is a plain ticket. */
export type DiscountTagMap = Record<string, DiscountTag>;

/** The nine budget categories. Also the stable `CategoryRow.key`. */
export type TicketClass =
  | 'tent'
  | 'tent-inperson'
  | 'tent-sponsor'
  | 'tent-discount'
  | 'classroom'
  | 'classroom-inperson'
  | 'classroom-sponsor'
  | 'classroom-discount'
  | 'unknown';

/** Admin-set reference prices (settings.tentPrice / settings.classroomPrice). */
export interface BasePrices {
  tent: number | null;
  classroom: number | null;
}

/** Fixed display order — also the row order within a scope, so the table reads consistently. */
const CLASS_ORDER: readonly TicketClass[] = [
  'tent',
  'tent-inperson',
  'tent-discount',
  'tent-sponsor',
  'classroom',
  'classroom-inperson',
  'classroom-discount',
  'classroom-sponsor',
  'unknown',
];

const CLASS_LABEL: Record<TicketClass, string> = {
  tent: 'Tent',
  'tent-inperson': 'Tent — paid in person',
  'tent-discount': 'Discounted tent',
  'tent-sponsor': 'Tent full sponsor',
  classroom: 'Classroom',
  'classroom-inperson': 'Classroom — paid in person',
  'classroom-discount': 'Discounted classroom',
  'classroom-sponsor': 'Classroom full sponsor',
  unknown: 'Accommodation not recorded',
};

/** The human label for a ticket class. Exported so the SPA mirror and tests agree on wording. */
export function labelForClass(cls: TicketClass): string {
  return CLASS_LABEL[cls];
}

/** One registrant as the budget cares about it (a subset of RegistrantDto). */
export interface BudgetPerson {
  churchId: string;
  churchName: string;
  kind: 'camper' | 'leader';
  registrationCost: number | null;
  discountCode?: string | null;
  discountAmount?: number | null;
  /** Owned by the Ticket List import (or a church accommodation override). */
  accommodationKind?: 'tent' | 'classroom' | null;
  /** Owned by the Invoice import — what actually arrived. */
  amountPaid?: number | null;
}

export interface CategoryRow {
  /** stable key within its (church, audience) scope: the TicketClass. */
  key: TicketClass;
  label: string;
  /**
   * The per-person amount, when every person in the row contributed the SAME value —
   * otherwise null, meaning "mixed, read the line total". Distinct from `unrecorded`:
   * a null here is a display detail, not missing data.
   */
  amount: number | null;
  count: number;
  /** Σ of each member's individual value. Always exact, whatever `amount` says. */
  lineTotal: number;
  /** true for the "Accommodation not recorded" row, so the UI can flag it. */
  unrecorded: boolean;
  /** how many people in this row had no recorded value at all and contributed $0. */
  valueMissingCount: number;
  /** a discount code consistently associated with this row, if any (UI hint). */
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
  /** the highest distinct positive value in the dataset, or null. Informational. */
  fullAmount: number | null;
}

const money = (n: number): string =>
  '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** `labelForClass` plus the unit price when there is a single one — the row's display label. */
export function labelForRow(cls: TicketClass, amount: number | null): string {
  const base = labelForClass(cls);
  return amount == null ? base : `${base} — ${money(amount)}`;
}

/**
 * Which of the nine buckets a registrant falls into.
 *
 * Accommodation kind decides tent vs classroom; the admin's tag on the person's discount code
 * decides the payment half. An unrecognised tag value is treated as untagged (plain), so a
 * hand-edited settings row can never crash the budget.
 */
export function classifyTicket(p: BudgetPerson, tags: DiscountTagMap): TicketClass {
  const kind = p.accommodationKind;
  if (kind !== 'tent' && kind !== 'classroom') return 'unknown';
  const code = (p.discountCode ?? '').trim();
  const tag = code ? tags[code] : undefined;
  if (tag === 'inperson' || tag === 'sponsor' || tag === 'discount') {
    return `${kind}-${tag}` as TicketClass;
  }
  return kind;
}

/**
 * What this registrant contributes to the budget, in dollars. `null` = nothing was recorded
 * (counted, flagged, contributes $0).
 *
 * ⚠ THE ORDER MATTERS AND IT ENCODES A DELIBERATE OWNER DECISION (2026-07-29):
 *
 *  1. A code tagged 'inperson' → the admin-set base price for their accommodation kind.
 *     This is the whole point of the tag: the money was collected by hand at registration,
 *     so no invoice records it and the ticket reads $0. Falls through to the normal path
 *     when no base price has been set yet, rather than inventing a number.
 *  2. A code tagged 'sponsor' → $0. No money was received. The owner explicitly chose this
 *     over counting it at face value, and explicitly declined a separate "value given away"
 *     figure.
 *  3. Otherwise `amountPaid` when the Invoice import recorded one — what ACTUALLY arrived.
 *  4. Otherwise `registrationCost` — the ticket total, the best available proxy when no
 *     invoice has been imported.
 *
 * Steps 2–4 together mean the grand total reads as MONEY RECEIVED, not value of all places.
 * `registrationCost` is the ticket total and `amountPaid` is the settlement: a 100%-discount
 * invoice records `registrationCost: 180, amountPaid: 0`, so preferring registrationCost would
 * count every sponsored place as revenue and contradict decision 2. The same precedent already
 * exists in the SPA's `_paidOrCostRow` ("Paid" when amountPaid exists, else "Cost").
 *
 * To read the budget as "value of all places" instead, swap steps 3 and 4 here and in the SPA
 * mirror `_personValue`. Nothing else needs to change.
 */
export function personValue(p: BudgetPerson, cls: TicketClass, prices: BasePrices): number | null {
  if (cls === 'tent-inperson' && prices.tent != null) return prices.tent;
  if (cls === 'classroom-inperson' && prices.classroom != null) return prices.classroom;
  if (cls === 'tent-sponsor' || cls === 'classroom-sponsor') return 0;
  if (p.amountPaid != null) return p.amountPaid;
  if (p.registrationCost != null) return p.registrationCost;
  return null;
}

interface Bucket {
  count: number;
  total: number;
  /** distinct per-person values seen, so a uniform unit price can be reported. */
  values: Set<number>;
  missing: number;
  codes: Map<string, number>;
}

type Scope = Map<TicketClass, Bucket>;

function addToScope(scope: Scope, p: BudgetPerson, cls: TicketClass, value: number | null): void {
  let b = scope.get(cls);
  if (!b) {
    b = { count: 0, total: 0, values: new Set(), missing: 0, codes: new Map() };
    scope.set(cls, b);
  }
  b.count++;
  if (value == null) b.missing++;
  else {
    b.total += value;
    b.values.add(value);
  }
  const code = (p.discountCode ?? '').trim();
  if (code) b.codes.set(code, (b.codes.get(code) ?? 0) + 1);
}

function scopeToRows(scope: Scope): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const cls of CLASS_ORDER) {
    const b = scope.get(cls);
    if (!b) continue;
    // A single distinct value across the whole row (and nobody missing) → a real unit price.
    const amount = b.values.size === 1 && b.missing === 0 ? [...b.values][0]! : null;
    // A code is a "hint" only if EVERY person in the row shares the same single code.
    let codeHint: string | null = null;
    if (b.codes.size === 1) {
      const [onlyCode, n] = [...b.codes.entries()][0] as [string, number];
      if (n === b.count) codeHint = onlyCode;
    }
    rows.push({
      key: cls,
      label: labelForRow(cls, amount),
      amount,
      count: b.count,
      lineTotal: b.total,
      unrecorded: cls === 'unknown',
      valueMissingCount: b.missing,
      codeHint,
    });
  }
  return rows;
}

/**
 * Compute the full budget report from a flat list of registrants.
 * @param people  registrants (campers + leaders) within the desired scope.
 * @param opts.tags  discount-code → classification tag (settings.discountCodeTags).
 * @param opts.prices  admin-set tent/classroom reference prices.
 * @param opts.filterChurchId  if set, only this church is included and the grand total is scoped to it.
 */
export function computeBudget(
  people: readonly BudgetPerson[],
  opts?: { tags?: DiscountTagMap; prices?: BasePrices; filterChurchId?: string | null },
): BudgetReport {
  const tags = opts?.tags ?? {};
  const prices = opts?.prices ?? { tent: null, classroom: null };
  const filterChurchId = opts?.filterChurchId;
  const scoped = filterChurchId ? people.filter((p) => p.churchId === filterChurchId) : people;

  let fullAmount: number | null = null;

  const byChurch = new Map<
    string,
    { churchId: string; churchName: string; campers: Scope; leaders: Scope }
  >();
  for (const p of scoped) {
    let c = byChurch.get(p.churchId);
    if (!c) {
      c = { churchId: p.churchId, churchName: p.churchName, campers: new Map(), leaders: new Map() };
      byChurch.set(p.churchId, c);
    }
    const cls = classifyTicket(p, tags);
    const value = personValue(p, cls, prices);
    if (value != null && value > 0) {
      fullAmount = fullAmount == null ? value : Math.max(fullAmount, value);
    }
    addToScope(p.kind === 'leader' ? c.leaders : c.campers, p, cls, value);
  }

  const churches: ChurchBudget[] = [];
  for (const c of byChurch.values()) {
    const campers = scopeToRows(c.campers);
    const leaders = scopeToRows(c.leaders);
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
  /** the admin's classification for this code, or null when it hasn't been tagged. */
  tag: DiscountTag | null;
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
  /* Item C (2026-07-28) — TICKET-DIFFERENCE CODES.
     When someone buys the wrong ticket and is issued a code covering what they already paid, the
     discount is (nearly) the whole ticket price. Counted as an ordinary concession that reads as
     "100% Off", which is materially misleading: nobody was sponsored, they simply paid in two
     instalments. Such a code is still COUNTED in the summary (the owner's call) but is labelled
     for what it is, so a director reading the budget isn't left thinking free places were given
     away. The test is a discount at/above ~97% of the ticket price, which is exactly the
     already-paid-the-difference shape and never a real 70%-or-less concession tier. */
  const avgPercent = valid.reduce((s, p) => s + (p.discount / p.cost) * 100, 0) / valid.length;
  if (avgPercent >= 97) return 'Ticket difference — already paid';
  const bucket = DISCOUNT_PERCENT_BUCKETS.find((b) => Math.abs(avgPercent - b) <= DISCOUNT_PERCENT_TOLERANCE);
  if (bucket != null) return `${bucket}% Off`;
  const avgDollar = Math.round(valid.reduce((s, p) => s + p.discount, 0) / valid.length);
  return avgDollar > 0 ? `$${avgDollar} Off` : null;
}

/**
 * How many registrants used each discount code, out of the total registrants in scope, and
 * how the admin has classified each one. This is the data behind the Budget screen's
 * "Discount codes" card, where the classification dropdown lives.
 *
 * Blank/null discount codes are not counted as a "code". Same scoping as computeBudget
 * (own church / own zone / all, applied by the caller via filterChurchId).
 */
export function computeDiscountCodeSummary(
  people: readonly BudgetPerson[],
  filterChurchId?: string | null,
  tags?: DiscountTagMap,
): DiscountCodeSummary {
  const scoped = filterChurchId ? people.filter((p) => p.churchId === filterChurchId) : people;
  const t = tags ?? {};
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
    .map(([code, count]) => ({
      code,
      count,
      purpose: deriveDiscountPurpose(pairsByCode.get(code) ?? []),
      tag: t[code] ?? null,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { totalInScope: scoped.length, rows };
}

/**
 * Build the CSV export string (mirrors the app's other CSV exports — a plain string the SPA
 * downloads directly). Columns: Church, Audience, Category, Count, UnitPrice, LineTotal, with
 * a church-total row per church and a final grand-total row.
 *
 * UnitPrice is blank (not 0) when a row has mixed per-person values — writing 0 there would
 * read as "free" in a spreadsheet, when the LineTotal says otherwise.
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
        [esc(church), audience, esc(r.label), r.count, r.amount ?? '', r.lineTotal].join(','),
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
