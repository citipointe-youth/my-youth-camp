import { buildTicketPriceTable, priceForTicket, type TicketPrice } from './ticket-prices';

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
//   tag 'inperson'            → "Tent in person"          / "Classroom in person"
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
  'tent-inperson': 'Tent in person',
  'tent-discount': 'Discounted tent',
  'tent-sponsor': 'Tent full sponsor',
  classroom: 'Classroom',
  'classroom-inperson': 'Classroom in person',
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
  /**
   * The verbatim Elvanto ticket type. Feeds the learned price table (ticket-prices.ts), which is
   * how an in-person payer gets valued when the camp runs more than one tent ticket.
   */
  registrationType?: string | null;
  /** Owned by the Invoice import — what actually arrived. */
  amountPaid?: number | null;
  /** Individual amount-paid override — beats this entire cascade. Never set by an importer. */
  amountPaidOverride?: number | null;
  /** Refund issued; subtracted from whatever the base value came out as. */
  refundAmount?: number | null;
  /**
   * Registration state. Optional because most callers never set it and every existing
   * fixture predates it. Only the SPONSORSHIP path reads it: a withdrawn place is no longer
   * an ask. The RECEIVED table deliberately still counts a cancelled person's money
   * (2026-09-03) — cancelling must not move the money, so do not add a filter there.
   */
  status?: 'registered' | 'cancelled';
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
  /**
   * The distribution of per-person values behind `lineTotal`, descending by value. A person
   * with no recorded value (see `valueMissingCount`) is folded into the `value: 0` bucket, so
   * `valueBreakdown.reduce((s,b)=>s+b.count,0) === count` always. Populated for every row —
   * a uniform row simply has one entry — so the UI has one field to read regardless of shape.
   */
  valueBreakdown: { value: number; count: number }[];
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
  /**
   * Which discount codes THIS church used, and how many of its people used each (item 1,
   * 2026-07-31). Most-used first, same shape and derivation as the camp-wide "Discount codes"
   * card — `computeDiscountCodeSummary` is reused rather than re-counted, so the per-church
   * numbers can never disagree with the camp-wide ones. Empty when the church used none.
   *
   * Counted per PERSON, not per code: a church with 12 people on `EARLYBIRD` reads 12. The
   * denominator for "of N" is the church's own headcount (`camperCount + leaderCount`).
   */
  discountCodes: DiscountCodeRow[];
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
 * The admin's classification of a person's discount code, independent of accommodation kind.
 * Null when there is no code, or the code is untagged, or the tag value is unrecognised.
 *
 * ⚠️ DELIBERATELY SEPARATE FROM `classifyTicket`. The tag is a fact about the CODE and must be
 * knowable even when `accommodationKind` is null (registered via Form/Invoice but not yet on the
 * Ticket List) — see `personValue`'s use of this for why collapsing the two caused sponsored
 * places to be counted as revenue (2026-08-05 fix).
 */
export function discountTagFor(p: BudgetPerson, tags: DiscountTagMap): DiscountTag | null {
  const code = (p.discountCode ?? '').trim();
  if (!code) return null;
  const tag = tags[code];
  return tag === 'inperson' || tag === 'sponsor' || tag === 'discount' ? tag : null;
}

/**
 * A discount code that the admin has never classified, on a person whose invoice shows a real
 * discount. These are invisible to `computeSponsorSummary` (it only walks sponsor/discount tags),
 * which is how 85 people and ~$13,000 of sponsorship gap went unreported in prod on 2026-09-05.
 *
 * ⚠️ THIS DETECTS, IT DOES NOT INFER. A caller must report the person and EXCLUDE their money
 * from every total. Do not map "100% discount" onto the `sponsor` tag — an untagged 100% code
 * can legitimately be a staff comp or a desk payment, and guessing would ask a sponsor for money
 * nobody owes. Same doctrine as `discountTagConflict`: report, a human decides.
 */
export function isUnclassifiedDiscount(p: BudgetPerson, tags: DiscountTagMap): boolean {
  const code = (p.discountCode ?? '').trim();
  if (!code) return false;
  if (discountTagFor(p, tags) != null) return false;
  if ((p.discountAmount ?? 0) > 0) return true;
  // Fallback for a code whose discountAmount was never recorded: the invoice settled below
  // the ticket price, which is itself evidence of a discount.
  return p.registrationCost != null && p.amountPaid != null && p.amountPaid < p.registrationCost;
}

/**
 * Which of the nine buckets a registrant falls into.
 *
 * Accommodation kind decides tent vs classroom; the admin's tag on the person's discount code
 * decides the payment half. An unrecognised tag value is treated as untagged (plain), so a
 * hand-edited settings row can never crash the budget.
 *
 * ⚠️ This decides the DISPLAY bucket only. `accommodationKind` unknown → `'unknown'` regardless
 * of the tag — we genuinely don't know tent vs classroom, so there is no `unknown-sponsor` row.
 * That does NOT mean the tag is discarded: `personValue`/`sponsorAmountFor` look the tag up
 * themselves (via `discountTagFor`) so a sponsor/discount code still values correctly even while
 * its accommodation is unrecorded. See the 2026-08-05 fix note on `personValue`.
 */
export function classifyTicket(p: BudgetPerson, tags: DiscountTagMap): TicketClass {
  const kind = p.accommodationKind;
  if (kind !== 'tent' && kind !== 'classroom') return 'unknown';
  const tag = discountTagFor(p, tags);
  if (tag) return `${kind}-${tag}` as TicketClass;
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
/**
 * What one person's place is worth to the budget.
 *
 * ⚠️ THE IN-PERSON CASCADE CHANGED 2026-08-02 — read this before simplifying it. Someone who paid
 * in person has no invoice amount, so their place has to be valued at the TICKET they hold. That
 * used to be a single scalar setting per accommodation kind, which broke the moment the camp ran
 * both an early-bird and a standard tent ticket: one `tentPrice` cannot be two prices. The order
 * is now most-specific-first, and each step is a real fallback, not a preference:
 *
 *   1. their own `registrationCost` — the actual price of the actual ticket they bought;
 *   2. the learned price for their ticket TYPE (ticket-prices.ts) — for someone whose own cost was
 *      never recorded, but whose ticket type other people have invoices for;
 *   3. the admin's `tentPrice`/`classroomPrice` setting — last resort, and only reachable for a
 *      ticket type NOBODY has an invoice for. This is all those settings are for now.
 *
 * `ticketPrice` is the already-resolved result of steps 1-2 (computeBudget does the lookup so this
 * stays a pure function). Null means neither was available.
 *
 * 🔴 BUG FIX (2026-08-05): `tag` is now taken directly (via `discountTagFor`), NOT re-derived from
 * `cls`. Before this, a `sponsor`-tagged code only zeroed the value when `cls` was
 * `'tent-sponsor'`/`'classroom-sponsor'` — which requires `accommodationKind` to be known. Someone
 * registered via Form+Invoice but not yet on the Ticket List has `accommodationKind: null`, so
 * `cls` was `'unknown'` and the sponsor rule never fired: their FULL `registrationCost` was
 * counted as money received (inflating the grand total), and the Sponsorship card showed $0 owed
 * for a place that was never actually paid for (a real ask silently vanishing). Passing the tag
 * separately means a sponsor code always reads $0, whether or not the accommodation is known yet.
 *
 * `amountPaidOverride` and `refundAmount` (2026-09-03): the override short-circuits everything
 * below — see `amountPaidBase` — and the refund then subtracts from whatever the base came out as.
 */
export function personValue(
  p: BudgetPerson,
  cls: TicketClass,
  prices: BasePrices,
  ticketPrice?: number | null,
  tag?: DiscountTag | null,
): number | null {
  const base = receivedBeforeRefund(p, cls, prices, ticketPrice, tag);
  if (base == null) return null; // unknowable stays unknowable — never a bare -refund
  return base - (p.refundAmount ?? 0);
}

/**
 * The pre-refund value. `amountPaidOverride` short-circuits EVERYTHING — it is not another rung
 * on the cascade, it IS the person's value once an admin has set it (including a deliberate 0,
 * which is why this tests `!= null` and not truthiness).
 *
 * EXPORTED 2026-09-05 because the sponsorship ask must be refund-INDEPENDENT: `personValue`
 * subtracts the refund, and `ask = ticketValue − received` therefore grew by exactly the refund
 * amount, asking a sponsor to re-fund money the camp chose to give back. There are now two
 * callers and no third copy of the cascade.
 *
 * ⚠️ MIRRORED in public/index.html `_personValueBase`. Change both together.
 */
export function receivedBeforeRefund(
  p: BudgetPerson,
  cls: TicketClass,
  prices: BasePrices,
  ticketPrice?: number | null,
  tag?: DiscountTag | null,
): number | null {
  if (p.amountPaidOverride != null) return p.amountPaidOverride;
  if (cls === 'tent-inperson' || cls === 'classroom-inperson') {
    if (ticketPrice != null) return ticketPrice;
    const fallback = cls === 'tent-inperson' ? prices.tent : prices.classroom;
    if (fallback != null) return fallback;
  }
  if (cls === 'tent-sponsor' || cls === 'classroom-sponsor' || tag === 'sponsor') return 0;
  if (p.amountPaid != null) return p.amountPaid;
  if (p.registrationCost != null) return p.registrationCost;
  return null;
}

/** Steps 1-2 of the `personValue` in-person cascade: this person's own ticket price, if knowable. */
export function resolveTicketPrice(
  p: BudgetPerson,
  table: Map<string, TicketPrice>,
): number | null {
  if (p.registrationCost != null) return p.registrationCost;
  return priceForTicket(table, p.registrationType);
}

interface Bucket {
  count: number;
  total: number;
  /** per-person value → how many people contributed exactly that value, so a uniform unit
   * price can be reported AND (2026-08-01) a mixed row can show its full distribution. */
  values: Map<number, number>;
  missing: number;
  codes: Map<string, number>;
}

type Scope = Map<TicketClass, Bucket>;

function addToScope(scope: Scope, p: BudgetPerson, cls: TicketClass, value: number | null): void {
  let b = scope.get(cls);
  if (!b) {
    b = { count: 0, total: 0, values: new Map(), missing: 0, codes: new Map() };
    scope.set(cls, b);
  }
  b.count++;
  if (value == null) b.missing++;
  else {
    b.total += value;
    b.values.set(value, (b.values.get(value) ?? 0) + 1);
  }
  const code = (p.discountCode ?? '').trim();
  if (code) b.codes.set(code, (b.codes.get(code) ?? 0) + 1);
}

/**
 * `valueBreakdown` for one bucket — every recorded value, plus a `value: 0` bucket for anyone
 * with no recorded value at all (mirrors how a missing value already contributes $0 to
 * `lineTotal`, so the two stay consistent). Descending by value.
 */
function buildValueBreakdown(b: Bucket): { value: number; count: number }[] {
  const merged = new Map(b.values);
  if (b.missing > 0) merged.set(0, (merged.get(0) ?? 0) + b.missing);
  return [...merged.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, c) => c.value - a.value);
}

function scopeToRows(scope: Scope): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const cls of CLASS_ORDER) {
    const b = scope.get(cls);
    if (!b) continue;
    // A single distinct value across the whole row (and nobody missing) → a real unit price.
    const amount = b.values.size === 1 && b.missing === 0 ? [...b.values.keys()][0]! : null;
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
      valueBreakdown: buildValueBreakdown(b),
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
  /* Learned from the FULL set, not the filtered one: a ticket type priced only at another church
     must still price this church's in-person holders of it. */
  const priceTable = buildTicketPriceTable(people);
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
    const value = personValue(p, cls, prices, resolveTicketPrice(p, priceTable), discountTagFor(p, tags));
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
    // Reuse the camp-wide summariser scoped to this church — see the field docs on
    // ChurchBudget.discountCodes for why this must not become a second implementation.
    const discountCodes = computeDiscountCodeSummary(scoped, c.churchId, tags).rows;
    churches.push({
      churchId: c.churchId, churchName: c.churchName, camperCount, leaderCount, total,
      campers, leaders, discountCodes,
    });
  }
  churches.sort((a, b) => a.churchName.localeCompare(b.churchName));

  const grandTotal = churches.reduce((s, c) => s + c.total, 0);
  const camperCount = churches.reduce((s, c) => s + c.camperCount, 0);
  const leaderCount = churches.reduce((s, c) => s + c.leaderCount, 0);

  return { grandTotal, camperCount, leaderCount, churchCount: churches.length, churches, fullAmount };
}

// ───────────────────────────────────────────────────────────────────────────────
// SPONSORSHIP — how much money has to be RAISED, and how it differs per ticket.
//
// Owner, 2026-08-04: *"a church may have a discount sponsor code that is used across both
// tent early bird and tent full price ticket prices. In this case the codes applied for
// early bird would be a lower value sponsor than the ones on the regular tickets. This
// differential should be able to be seen."*
//
// ⚠️ THE WHOLE POINT IS THAT ONE CODE IS NOT ONE AMOUNT. Every existing view of a discount
// code — the count chip, the `purpose` pill, `avgPercent` — collapses the code to a single
// figure, and an AVERAGE is precisely the wrong summary here: a code covering five $150
// early-bird tents and five $190 standard tents averages $170, a number that describes
// nobody and that no sponsor can be asked for. `SponsorCodeRow.bands` keeps the amounts
// separate; **more than one band IS the differential.**
//
// ⚠️ SPONSOR MONEY IS DEFINED AS THE GAP THE BUDGET ALREADY IMPLIES, not a second opinion:
//
//     sponsor amount = the place's ticket value − what `personValue` counts as received
//
// That is deliberate. `personValue` is what makes the grand total read as MONEY RECEIVED
// (see its doc comment), so this figure is exactly what has to arrive from somewhere else
// for the camp to be whole. Sponsor total + grand total = the value of every place. Compute
// it any other way — from `discountAmount` alone, say — and the two numbers stop
// reconciling, which is how a director ends up with three different answers to "what do we
// still need?".
//
// A `sponsor`-tagged code contributes the WHOLE ticket (personValue hard-codes it to $0); a
// `discount`-tagged code contributes only the part that did not arrive. Both are in scope
// because the owner's own phrase is "discount sponsor code", but they are reported under
// their own tag and totalled separately — a full place and a half place are not the same ask.
//
// ⚠️ `inperson` IS DELIBERATELY EXCLUDED. That money WAS received; it was just taken by hand
// at the desk instead of by invoice. Counting it as sponsorship would invent a shortfall.
// ───────────────────────────────────────────────────────────────────────────────

/** The two tags that mean money did not arrive. `inperson` is not one of them — see above. */
export type SponsorTag = Extract<DiscountTag, 'sponsor' | 'discount'>;

const SPONSOR_TAGS: readonly DiscountTag[] = ['sponsor', 'discount'];

/** One distinct sponsor amount within a code — the unit a sponsor is actually asked for. */
export interface SponsorBand {
  /** What ONE place in this band costs a sponsor. */
  amount: number;
  /** The full ticket that place is worth. Equal to `amount` for a full sponsorship. */
  ticketValue: number;
  count: number;
  /** `amount × count`. */
  total: number;
  /**
   * The verbatim Elvanto ticket type(s) behind this band, so the band can be named rather
   * than merely priced ("EARLY BIRD | Tent Accomodation" vs "Tent Accomodation"). Sorted,
   * de-duplicated; empty when nobody in the band has a recorded ticket type.
   */
  ticketTypes: string[];
}

export interface SponsorCodeRow {
  code: string;
  tag: SponsorTag;
  count: number;
  total: number;
  /** Descending by amount. **LENGTH > 1 IS THE DIFFERENTIAL.** */
  bands: SponsorBand[];
  /** People on this code whose ticket has no known price. Counted, never totalled. */
  unpricedCount: number;
  /** Which churches use this code, biggest ask first. */
  churches: SponsorScopeRow[];
}

/** A code's or a church's contribution, used on both sides of the code↔church split. */
export interface SponsorScopeRow {
  id: string;
  name: string;
  count: number;
  total: number;
}

export interface SponsorChurchRow extends SponsorScopeRow {
  /** Which codes this church uses, biggest ask first. */
  codes: { code: string; tag: SponsorTag; count: number; total: number }[];
}

export interface SponsorSummary {
  /** The camp-wide ask: `fullTotal + partialTotal`. */
  total: number;
  /** From `sponsor`-tagged codes — whole places. */
  fullTotal: number;
  /** From `discount`-tagged codes — the part of a place that did not arrive. */
  partialTotal: number;
  /** People on any sponsor/discount code, INCLUDING the unpriced ones. */
  count: number;
  /**
   * People whose ticket has no known price from any source, so their ask could not be
   * worked out. They are in `count` and absent from every total — the number is surfaced
   * so the UI can say the total under-reads rather than quietly under-reporting it.
   */
  unpricedCount: number;
  /** Cancelled places, excluded from every total above. Reported so the exclusion is visible. */
  withdrawnCount: number;
  withdrawnTotal: number;
  /** Untagged codes with a measured discount. NOT in `total` — see `isUnclassifiedDiscount`. */
  unclassifiedCount: number;
  unclassifiedTotal: number;
  unclassified: UnclassifiedCodeRow[];
  codes: SponsorCodeRow[];
  churches: SponsorChurchRow[];
}

/** An untagged code carrying a measured discount. Reported, never totalled. */
export interface UnclassifiedCodeRow {
  code: string;
  count: number;
  /** The gap these places represent — what the ask WOULD be if the code were classified. */
  total: number;
  /** Measured average discount on the invoices, or null when no invoice carried both figures. */
  avgPercent: number | null;
}

/**
 * What one sponsored/discounted place costs a sponsor.
 *
 * `ticketValue` is the same cascade `personValue` uses for an in-person ticket — their own
 * `registrationCost`, then the learned price for their ticket TYPE, then the admin's scalar
 * setting — because "what is this place worth" is the identical question in both places.
 * A null `ticketValue` means no source knew, and the caller must count that person as
 * unpriced rather than as $0 (a $0 ask reads as "already covered").
 *
 * `tag` (2026-08-05) is passed through to `personValue` so a sponsor code still reads $0
 * received even when `cls` is `'unknown'` (accommodation not yet imported) — see the fix note
 * on `personValue`. Every caller here already knows the tag (it's how they found this code in
 * the first place), so this is never a re-derivation.
 */
export function sponsorAmountFor(
  p: BudgetPerson,
  cls: TicketClass,
  prices: BasePrices,
  ticketPrice?: number | null,
  tag?: DiscountTag | null,
): { ticketValue: number | null; amount: number } {
  const kind = p.accommodationKind;
  const fallback = kind === 'tent' ? prices.tent : kind === 'classroom' ? prices.classroom : null;
  const ticketValue = ticketPrice ?? fallback;
  if (ticketValue == null) return { ticketValue: null, amount: 0 };
  // ⚠️ receivedBeforeRefund, NOT personValue — see that function's note. A refund must not
  // re-open a sponsorship gap; the money was returned deliberately, not left outstanding.
  const received = receivedBeforeRefund(p, cls, prices, ticketPrice, tag) ?? 0;
  // Never negative: someone who over-paid against their ticket is not owed a sponsor.
  return { ticketValue, amount: Math.max(0, ticketValue - received) };
}

interface SponsorEntry {
  churchId: string;
  churchName: string;
  amount: number;
  ticketValue: number | null;
  ticketType: string;
}

function toBands(entries: readonly SponsorEntry[]): SponsorBand[] {
  const byAmount = new Map<number, { amount: number; ticketValue: number; count: number; types: Set<string> }>();
  for (const e of entries) {
    if (e.ticketValue == null) continue;
    // Bucket in cents so 150 and 150.00 are one band.
    const key = Math.round(e.amount * 100);
    let b = byAmount.get(key);
    if (!b) {
      b = { amount: e.amount, ticketValue: e.ticketValue, count: 0, types: new Set() };
      byAmount.set(key, b);
    }
    b.count++;
    if (e.ticketType) b.types.add(e.ticketType);
  }
  return [...byAmount.values()]
    .map((b) => ({
      amount: b.amount,
      ticketValue: b.ticketValue,
      count: b.count,
      total: b.amount * b.count,
      ticketTypes: [...b.types].sort((a, c) => a.localeCompare(c)),
    }))
    .sort((a, b) => b.amount - a.amount);
}

const byTotalThenName = (a: SponsorScopeRow, b: SponsorScopeRow): number =>
  b.total - a.total || a.name.localeCompare(b.name);

/**
 * The camp's sponsorship ask, per code (with its differential), per church, and in total.
 *
 * Same options and same scoping as `computeBudget`, so the two are always talking about the
 * same population. The price table is built from the FULL set for the same reason
 * `computeBudget` does it: a ticket type priced only at another church must still price this
 * church's holders of it.
 */
export function computeSponsorSummary(
  people: readonly BudgetPerson[],
  opts?: { tags?: DiscountTagMap; prices?: BasePrices; filterChurchId?: string | null },
): SponsorSummary {
  const tags = opts?.tags ?? {};
  const prices = opts?.prices ?? { tent: null, classroom: null };
  const priceTable = buildTicketPriceTable(people);
  const scoped = opts?.filterChurchId
    ? people.filter((p) => p.churchId === opts.filterChurchId)
    : people;

  const byCode = new Map<string, { tag: SponsorTag; entries: SponsorEntry[] }>();
  const unclassifiedBy = new Map<string, { count: number; total: number; pairs: { cost: number; discount: number }[] }>();
  let withdrawnCount = 0;
  let withdrawnTotal = 0;
  for (const p of scoped) {
    const code = (p.discountCode ?? '').trim();
    if (!code) continue;

    // The tag is resolved once, up front, via `discountTagFor` rather than a raw `tags[code]`
    // lookup — the code may legitimately be untagged (tag === null) at this point in the loop,
    // and `discountTagFor` already validates against the three known tag values, so it is a
    // drop-in replacement for the `tags[code]` lookup the tagged path used to do on its own.
    const tag = discountTagFor(p, tags);
    const unclassified = isUnclassifiedDiscount(p, tags);
    const inAskPopulation = (tag != null && SPONSOR_TAGS.includes(tag)) || unclassified;

    // A withdrawn place is not an ask, regardless of how its code is classified — checked
    // FIRST, before the unclassified check and the tag check, so a cancelled person on an
    // untagged (but discounted) code cannot fall through into unclassifiedTotal, which is
    // exactly the bug this task exists to fix, just relocated to a different bucket
    // (2026-09-05, review round 1).
    //
    // ⚠️ SCOPED TO THE ASK POPULATION ONLY (round 2). A cancelled person whose code is
    // untagged-with-no-discount-evidence, or tagged `inperson`, was never part of any ask to
    // begin with — `inperson` money genuinely arrived (it was just taken by hand at the desk),
    // so counting its cancellation as "withdrawn" would assert an exclusion that never
    // happened and inflate the reported count against a $0 amount, misleadingly implying a
    // sponsored place went missing. Such a person is skipped entirely below, exactly as they
    // were before cancellation was ever considered.
    if (p.status === 'cancelled') {
      if (inAskPopulation) {
        const cls = classifyTicket(p, tags);
        const { ticketValue, amount } = sponsorAmountFor(
          p, cls, prices, resolveTicketPrice(p, priceTable), tag);
        withdrawnCount++;
        withdrawnTotal += ticketValue == null ? 0 : amount;
      }
      continue;
    }

    if (unclassified) {
      const cls = classifyTicket(p, tags);
      const { ticketValue } = sponsorAmountFor(p, cls, prices, resolveTicketPrice(p, priceTable), null);
      const received = receivedBeforeRefund(p, cls, prices, resolveTicketPrice(p, priceTable), null) ?? 0;
      const gap = ticketValue == null ? 0 : Math.max(0, ticketValue - received);
      let u = unclassifiedBy.get(code);
      if (!u) { u = { count: 0, total: 0, pairs: [] }; unclassifiedBy.set(code, u); }
      u.count++;
      u.total += gap;
      if (p.registrationCost != null && p.registrationCost > 0 && p.discountAmount != null) {
        u.pairs.push({ cost: p.registrationCost, discount: p.discountAmount });
      }
      continue;
    }

    if (!tag || !SPONSOR_TAGS.includes(tag)) continue;

    const cls = classifyTicket(p, tags);
    const { ticketValue, amount } = sponsorAmountFor(p, cls, prices, resolveTicketPrice(p, priceTable), tag);
    let bucket = byCode.get(code);
    if (!bucket) {
      bucket = { tag: tag as SponsorTag, entries: [] };
      byCode.set(code, bucket);
    }
    bucket.entries.push({
      churchId: p.churchId,
      churchName: p.churchName,
      amount,
      ticketValue,
      ticketType: (p.registrationType ?? '').trim(),
    });
  }

  const unclassified: UnclassifiedCodeRow[] = [...unclassifiedBy.entries()]
    .map(([code, u]) => ({
      code, count: u.count, total: u.total, avgPercent: averageDiscountPercent(u.pairs),
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const churchAgg = new Map<string, { name: string; count: number; total: number; codes: Map<string, { tag: SponsorTag; count: number; total: number }> }>();
  const codes: SponsorCodeRow[] = [];
  let fullTotal = 0;
  let partialTotal = 0;
  let count = 0;
  let unpricedCount = 0;

  for (const [code, bucket] of byCode) {
    const bands = toBands(bucket.entries);
    const total = bands.reduce((s, b) => s + b.total, 0);
    const unpriced = bucket.entries.filter((e) => e.ticketValue == null).length;
    count += bucket.entries.length;
    unpricedCount += unpriced;
    if (bucket.tag === 'sponsor') fullTotal += total;
    else partialTotal += total;

    const perChurch = new Map<string, SponsorScopeRow>();
    for (const e of bucket.entries) {
      let row = perChurch.get(e.churchId);
      if (!row) {
        row = { id: e.churchId, name: e.churchName, count: 0, total: 0 };
        perChurch.set(e.churchId, row);
      }
      row.count++;
      row.total += e.ticketValue == null ? 0 : e.amount;

      let ch = churchAgg.get(e.churchId);
      if (!ch) {
        ch = { name: e.churchName, count: 0, total: 0, codes: new Map() };
        churchAgg.set(e.churchId, ch);
      }
      ch.count++;
      ch.total += e.ticketValue == null ? 0 : e.amount;
      let chCode = ch.codes.get(code);
      if (!chCode) {
        chCode = { tag: bucket.tag, count: 0, total: 0 };
        ch.codes.set(code, chCode);
      }
      chCode.count++;
      chCode.total += e.ticketValue == null ? 0 : e.amount;
    }

    codes.push({
      code,
      tag: bucket.tag,
      count: bucket.entries.length,
      total,
      bands,
      unpricedCount: unpriced,
      churches: [...perChurch.values()].sort(byTotalThenName),
    });
  }

  codes.sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));

  const churches: SponsorChurchRow[] = [...churchAgg.entries()]
    .map(([id, c]) => ({
      id,
      name: c.name,
      count: c.count,
      total: c.total,
      codes: [...c.codes.entries()]
        .map(([code, v]) => ({ code, tag: v.tag, count: v.count, total: v.total }))
        .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code)),
    }))
    .sort(byTotalThenName);

  return {
    total: fullTotal + partialTotal, fullTotal, partialTotal, count, unpricedCount,
    withdrawnCount, withdrawnTotal,
    unclassifiedCount: unclassified.reduce((s, u) => s + u.count, 0),
    unclassifiedTotal: unclassified.reduce((s, u) => s + u.total, 0),
    unclassified,
    codes, churches,
  };
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
  /**
   * The MEASURED average discount as a percentage of the ticket, across everyone who used this
   * code and has both figures recorded — null when nobody does. This is the raw number `purpose`
   * is a label for; it is exposed separately so the tag/invoice disagreement below can be detected
   * from the same figure the label came from, rather than by parsing the label back out.
   */
  avgPercent: number | null;
  /**
   * Set when the admin's `tag` contradicts what the invoices actually recorded — see
   * `discountTagConflict`. Null when they agree, when there is no tag, or when there is no
   * invoice evidence either way.
   */
  tagConflict: string | null;
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
 * At/above this, the discount covers the whole ticket. Used for two different judgements that must
 * agree: labelling a code a ticket-difference correction, and deciding whether a `sponsor` tag is
 * consistent with the invoices. Not 100 — real invoices land a cent or two short.
 */
const FULL_DISCOUNT_PERCENT = 97;

/**
 * Derive a human label for a discount code from the (pre-discount cost, discount amount)
 * pairs of the people who used it — e.g. "25% Off" or "$20 Off". Percentage is checked
 * first (a % code stays consistent across different ticket prices); if the average isn't
 * close to one of the four standard tiers, falls back to the average flat dollar amount.
 */
/**
 * The average discount as a percentage of the ticket price, across the people who used a code and
 * have BOTH figures recorded. Null when nobody does — which is not the same as 0%, and the
 * difference matters: 0% would mean "measured, and it's a full-price ticket", null means "no
 * invoice has ever said". Only the latter must suppress the disagreement check below.
 */
export function averageDiscountPercent(pairs: { cost: number; discount: number }[]): number | null {
  const valid = pairs.filter((p) => p.cost > 0 && p.discount != null);
  if (!valid.length) return null;
  return valid.reduce((s, p) => s + (p.discount / p.cost) * 100, 0) / valid.length;
}

/**
 * 🔴 THE TAG AND THE INVOICES CAN DISAGREE, AND THE MONEY FOLLOWS THE TAG (2026-08-02).
 *
 * A tag is what the admin *says* a code is; `avgPercent` is what the invoices *record*. They are
 * independent, and `personValue` trusts the tag — a `sponsor` code is hard-coded to $0 regardless
 * of what arrived. So a code tagged "Full sponsor" whose invoices show a 50% discount silently
 * discards the half that WAS paid, and the two facts sat side by side on the Budget screen with
 * nothing marking them as contradictory. That is what the owner spotted on `YC26YP` (2 people,
 * $75 and $95 genuinely paid, both counted as $0).
 *
 * The invoices are evidence, not authority — a code really can be a full sponsorship recorded
 * badly upstream. So this REPORTS the disagreement and changes no figure; only a human can say
 * which side is wrong.
 *
 * `inperson` is deliberately not checked: a code that zeroes an invoice because the money was
 * handed over at the desk is *expected* to show a ~100% discount, and a partial one is a legitimate
 * part-cash arrangement. There is nothing to contradict.
 */
export function discountTagConflict(tag: DiscountTag | null, avgPercent: number | null): string | null {
  if (tag == null || avgPercent == null) return null;
  const pct = Math.round(avgPercent);
  if (tag === 'sponsor' && avgPercent < FULL_DISCOUNT_PERCENT)
    return `Tagged full sponsor, but the invoices record ${pct}% off — the rest was paid and is being counted as $0.`;
  if (tag === 'discount' && avgPercent >= FULL_DISCOUNT_PERCENT)
    return `Tagged discounted, but the invoices record the whole ticket discounted (${pct}%).`;
  return null;
}

function deriveDiscountPurpose(pairs: { cost: number; discount: number }[]): string | null {
  const avgPercent = averageDiscountPercent(pairs);
  if (avgPercent == null) return null;
  const valid = pairs.filter((p) => p.cost > 0 && p.discount != null);
  /* Item C (2026-07-28) — TICKET-DIFFERENCE CODES.
     When someone buys the wrong ticket and is issued a code covering what they already paid, the
     discount is (nearly) the whole ticket price. Counted as an ordinary concession that reads as
     "100% Off", which is materially misleading: nobody was sponsored, they simply paid in two
     instalments. Such a code is still COUNTED in the summary (the owner's call) but is labelled
     for what it is, so a director reading the budget isn't left thinking free places were given
     away. The test is a discount at/above ~97% of the ticket price, which is exactly the
     already-paid-the-difference shape and never a real 70%-or-less concession tier. */
  if (avgPercent >= FULL_DISCOUNT_PERCENT) return 'Ticket difference — already paid';
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
    .map(([code, count]) => {
      const pairs = pairsByCode.get(code) ?? [];
      const avgPercent = averageDiscountPercent(pairs);
      const tag = t[code] ?? null;
      return {
        code,
        count,
        purpose: deriveDiscountPurpose(pairs),
        tag,
        avgPercent,
        tagConflict: discountTagConflict(tag, avgPercent),
      };
    })
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
    emit(c.churchName, 'Student', c.campers);
    emit(c.churchName, 'Leader', c.leaders);
    lines.push([esc(c.churchName), 'Total', '', c.camperCount + c.leaderCount, '', c.total].join(','));
  }
  lines.push(['ALL CHURCHES', 'Grand Total', '', report.camperCount + report.leaderCount, '', report.grandTotal].join(','));
  return lines.join('\n');
}
