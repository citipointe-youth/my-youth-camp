import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {
  computeBudget,
  computeSponsorSummary,
  computeDiscountCodeSummary,
  classifyTicket,
  discountTagFor,
  isUnclassifiedDiscount,
  personValue,
  receivedBeforeRefund,
  resolveTicketPrice,
  sponsorAmountFor,
  labelForRow,
  averageDiscountPercent,
  discountTagConflict,
  type BudgetPerson,
  type BasePrices,
  type DiscountTagMap,
  type DiscountTag,
} from './budget';
import { buildTicketPriceTable } from './ticket-prices';

/*
 * S2 (camp arch round 2026-11-07) — PARITY between the SPA's budget mirror and budget.ts.
 *
 * The live Budget screen and its export run the hand copy in public/index.html; budget.ts is the
 * canonical algorithm (its header says so and it carries the invariants), but nothing in
 * production imports it. This test is the seam that pins the two together: the SPA functions are
 * pulled out of index.html into a vm and every case below must deep-equal the budget.ts answer.
 *
 * ⚠️ If this fails, budget.ts is right and the SPA mirror gets fixed (round ruling). Do not loosen
 * the comparison. The ONLY normalised differences are the documented SPA-only fields stripped in
 * `spaReport`: `categories` (the card's merged view), `_people` (export input), `cancelledCount`.
 */

const SRC = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');

/** One top-level declaration out of index.html by its opening text (same scanner as the
 *  scripts/*-harness.js extractors: skips comments, strings, regex literals; balances brackets). */
function extract(decl: string): string {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error('not found in index.html: ' + decl);
  let depth = 0, started = false, prev = '';
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j]!;
    if (ch === '/' && SRC[j + 1] === '/') { j = SRC.indexOf('\n', j); if (j < 0) break; continue; }
    if (ch === '/' && SRC[j + 1] === '*') { j = SRC.indexOf('*/', j) + 1; continue; }
    if (ch === '/' && '(,=:[!&|?{};+'.includes(prev)) {
      j++;
      while (j < SRC.length && SRC[j] !== '/') { if (SRC[j] === '\\') j++; j++; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; j++;
      while (j < SRC.length && SRC[j] !== q) { if (SRC[j] === '\\') j++; j++; }
      prev = q;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; if (ch === '{') started = true; }
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (started && depth === 0 && ch === '}') return SRC.slice(i, j + 1);
    } else if (ch === ';' && depth === 0) return SRC.slice(i, j + 1);
    if (!/\s/.test(ch)) prev = ch;
  }
  throw new Error('unbalanced extraction for ' + decl);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const ctx: Record<string, unknown> = { SETTINGS: null };
vm.createContext(ctx);
vm.runInContext(
  [
    'function _money(', 'const _BUD_CLASSES=', 'const _BUD_CLASS_LABEL=', 'function _budRowLabel(',
    'function _discountTagFor(', 'function _isUnclassifiedDiscount(', 'function _classifyTicket(',
    'function _normTicketType(', 'function _budTicketPrices(', 'function _priceForTicket(',
    'function _resolveTicketPrice(', 'function _personValue(', 'function _personValueBase(',
    'function _budPrices(', 'function _budTags(', 'function _budValueBreakdown(',
    'function _budScopeRows(', 'function _budMergeScopes(', 'function computeBudgetClient(',
    'function _sponsorAmountFor(', 'const _SPONSOR_TAGS=', 'function _sponsorBands(',
    'function computeSponsorSummaryClient(', 'function _sponsorByTotal(',
    'const _FULL_DISCOUNT_PCT=', 'function _avgDiscountPct(', 'function _discountTagConflict(',
    'function _deriveDiscountPurpose(', 'function computeDiscountSummaryClient(',
  ].map(extract).join('\n'),
  ctx,
);
const spa = ctx as Record<string, Fn>;

/** Run with the SPA's SETTINGS set the way the Budget screen would have it. */
function withSettings<T>(tags: DiscountTagMap, prices: BasePrices, f: () => T): T {
  ctx.SETTINGS = { discountCodeTags: tags, tentPrice: prices.tent, classroomPrice: prices.classroom };
  try { return f(); } finally { ctx.SETTINGS = null; }
}

/** The vm's objects come from another realm; round-trip so toEqual compares plain values. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Strip ONLY the documented SPA-only fields (see the header). */
function spaReport(r: { churches: Record<string, unknown>[] }) {
  const out = plain(r) as { churches: Record<string, unknown>[] };
  for (const c of out.churches) {
    delete c.categories;
    delete c._people;
    for (const k of ['campers', 'leaders'] as const)
      for (const row of c[k] as Record<string, unknown>[]) delete row.cancelledCount;
  }
  return out;
}

// ── Fixtures: every branch of the cascade, across three churches and both audiences ──────────
const EARLY = 'EARLY BIRD | Tent Accomodation';
const STANDARD = 'Tent Accomodation';
const CLASS = 'Classroom Accomodation';
let n = 0;
function p(over: Partial<BudgetPerson>): BudgetPerson {
  n++;
  const churchId = over.churchId ?? 'c1';
  return {
    churchId,
    churchName: churchId === 'c1' ? 'Victory' : churchId === 'c2' ? 'Grace Point' : 'Riverbend',
    kind: n % 4 === 0 ? 'leader' : 'camper',
    registrationCost: 190,
    registrationType: STANDARD,
    discountCode: null,
    discountAmount: null,
    accommodationKind: 'tent',
    amountPaid: 190,
    ...over,
  };
}

const PEOPLE: BudgetPerson[] = [
  p({}),
  p({ amountPaid: null }),
  p({ registrationCost: null, amountPaid: null }),
  p({ registrationType: EARLY, registrationCost: 150, amountPaid: 150 }),
  p({ registrationType: EARLY, registrationCost: 150, amountPaid: 150, churchId: 'c2' }),
  p({ registrationType: CLASS, registrationCost: 230, amountPaid: 230, accommodationKind: 'classroom' }),
  p({ registrationType: CLASS, registrationCost: 230, amountPaid: 230, accommodationKind: 'classroom', churchId: 'c3' }),
  // in person: own cost, learned type price, admin fallback, nothing
  p({ discountCode: 'INP', amountPaid: 0 }),
  p({ discountCode: 'INP', registrationCost: null, registrationType: EARLY, amountPaid: null }),
  p({ discountCode: 'INP', registrationCost: null, registrationType: 'Mystery ticket', amountPaid: null }),
  p({ discountCode: 'INP', registrationCost: null, registrationType: null, accommodationKind: 'classroom', amountPaid: null, churchId: 'c2' }),
  // sponsor: known accommodation, unknown accommodation (2026-08-05 fix), early vs standard bands
  p({ discountCode: 'SPON', amountPaid: 0, discountAmount: 190 }),
  p({ discountCode: 'SPON', registrationType: EARLY, registrationCost: 150, amountPaid: 0, discountAmount: 150 }),
  p({ discountCode: 'SPON', accommodationKind: null, amountPaid: 0, discountAmount: 190, churchId: 'c2' }),
  p({ discountCode: ' SPON ', amountPaid: 0, discountAmount: 190, churchId: 'c3' }),
  p({ discountCode: 'SPON', registrationCost: null, registrationType: 'Mystery ticket', amountPaid: null, accommodationKind: null }),
  // discount / upgrade
  p({ discountCode: 'DISC', amountPaid: 95, discountAmount: 95 }),
  p({ discountCode: 'DISC', amountPaid: 100, discountAmount: 90, accommodationKind: 'classroom', registrationType: CLASS, registrationCost: 230 }),
  p({ discountCode: 'DISC', amountPaid: 0, discountAmount: 190, churchId: 'c2' }),
  p({ discountCode: 'UPG', amountPaid: 40, discountAmount: 190 }),
  p({ discountCode: 'UPG', accommodationKind: 'classroom', registrationType: CLASS, registrationCost: 230, amountPaid: 40, discountAmount: 190 }),
  // unclassified: by discountAmount, by paid < cost, and an untagged code with no evidence
  p({ discountCode: 'MYSTERY', amountPaid: 95, discountAmount: 95 }),
  p({ discountCode: 'MYSTERY', amountPaid: 50, discountAmount: null, churchId: 'c3' }),
  p({ discountCode: 'PLAINCODE', amountPaid: 190 }),
  p({ discountCode: 'BOGUS', amountPaid: 190 }),
  // overrides, refunds, cancellations
  p({ amountPaidOverride: 0 }),
  p({ amountPaidOverride: 120, refundAmount: 20, churchId: 'c2' }),
  p({ refundAmount: 50 }),
  p({ refundAmount: 50, amountPaid: null, registrationCost: null }),
  p({ discountCode: 'SPON', amountPaid: 0, discountAmount: 190, refundAmount: 30 }),
  p({ status: 'cancelled' }),
  p({ status: 'cancelled', discountCode: 'SPON', amountPaid: 0, discountAmount: 190 }),
  p({ status: 'cancelled', discountCode: 'MYSTERY', amountPaid: 95, discountAmount: 95, churchId: 'c2' }),
  p({ status: 'cancelled', discountCode: 'INP', amountPaid: 0 }),
  // accommodation not recorded, no code
  p({ accommodationKind: null }),
  p({ accommodationKind: null, amountPaid: null, registrationCost: null, churchId: 'c3' }),
  // tie-break on the learned price table: two costs equally common → the lower one
  p({ registrationType: 'Tie ticket', registrationCost: 170, amountPaid: 170 }),
  p({ registrationType: 'Tie ticket', registrationCost: 160, amountPaid: 160 }),
  p({ registrationType: 'tie   TICKET', registrationCost: null, amountPaid: null, discountCode: 'INP' }),
];

const TAGS: DiscountTagMap = {
  INP: 'inperson', SPON: 'sponsor', DISC: 'discount', UPG: 'upgrade',
  BOGUS: 'nonsense' as unknown as DiscountTag,
};
const SETUPS: { name: string; tags: DiscountTagMap; prices: BasePrices }[] = [
  { name: 'no tags, no prices', tags: {}, prices: { tent: null, classroom: null } },
  { name: 'tags, no prices', tags: TAGS, prices: { tent: null, classroom: null } },
  { name: 'tags + admin prices', tags: TAGS, prices: { tent: 175, classroom: 225 } },
];
const FILTERS: (string | null)[] = [null, 'c1', 'c2', 'c3'];

describe('SPA budget mirror ↔ budget.ts parity (S2)', () => {
  for (const s of SETUPS) {
    describe(s.name, () => {
      for (const f of FILTERS) {
        it(`computeBudgetClient = computeBudget (filter ${f ?? 'all'})`, () => {
          const server = computeBudget(PEOPLE, { tags: s.tags, prices: s.prices, filterChurchId: f });
          const client = withSettings(s.tags, s.prices, () => spa.computeBudgetClient!(PEOPLE, f ?? 'all'));
          expect(spaReport(client)).toEqual(plain(server));
        });
        it(`computeSponsorSummaryClient = computeSponsorSummary (filter ${f ?? 'all'})`, () => {
          const server = computeSponsorSummary(PEOPLE, { tags: s.tags, prices: s.prices, filterChurchId: f });
          const client = withSettings(s.tags, s.prices, () => spa.computeSponsorSummaryClient!(PEOPLE, f ?? 'all'));
          expect(plain(client)).toEqual(plain(server));
        });
        it(`computeDiscountSummaryClient = computeDiscountCodeSummary (filter ${f ?? 'all'})`, () => {
          const server = computeDiscountCodeSummary(PEOPLE, f, s.tags);
          const client = withSettings(s.tags, s.prices, () => spa.computeDiscountSummaryClient!(PEOPLE, f ?? 'all'));
          expect(plain(client)).toEqual(plain(server));
        });
      }

      it('per person: class, tag, unclassified, ticket price, value, pre-refund value, sponsor amount', () => {
        const table = buildTicketPriceTable(PEOPLE);
        const spaTable = spa._budTicketPrices!(PEOPLE);
        for (const person of PEOPLE) {
          const cls = classifyTicket(person, s.tags);
          const tag = discountTagFor(person, s.tags);
          const tp = resolveTicketPrice(person, table);
          const server = {
            cls, tag, unclassified: isUnclassifiedDiscount(person, s.tags), tp,
            value: personValue(person, cls, s.prices, tp, tag),
            base: receivedBeforeRefund(person, cls, s.prices, tp, tag),
            sponsor: sponsorAmountFor(person, cls, s.prices, tp, tag),
          };
          const client = {
            cls: spa._classifyTicket!(person, s.tags),
            tag: spa._discountTagFor!(person, s.tags),
            unclassified: spa._isUnclassifiedDiscount!(person, s.tags),
            tp: spa._resolveTicketPrice!(person, spaTable),
            value: spa._personValue!(person, cls, s.prices, tp, tag),
            base: spa._personValueBase!(person, cls, s.prices, tp, tag),
            sponsor: spa._sponsorAmountFor!(person, cls, s.prices, tp, tag),
          };
          expect(plain(client), JSON.stringify(person)).toEqual(server);
        }
      });
    });
  }

  it('learned ticket price table', () => {
    expect(plain([...spa._budTicketPrices!(PEOPLE).entries()])).toEqual(plain([...buildTicketPriceTable(PEOPLE).entries()]));
  });

  it('row labels', () => {
    for (const cls of ['tent', 'tent-upgrade', 'classroom-sponsor', 'unknown'] as const)
      for (const amt of [null, 0, 190, 1234.5])
        expect(spa._budRowLabel!(cls, amt)).toBe(labelForRow(cls, amt));
  });

  it('average discount percent and tag conflict', () => {
    const cases = [
      [],
      [{ cost: 0, discount: 10 }],
      [{ cost: 190, discount: 190 }],
      [{ cost: 190, discount: 95 }, { cost: 150, discount: 150 }],
      [{ cost: 200, discount: 193 }],
    ];
    for (const pairs of cases) {
      const avg = averageDiscountPercent(pairs);
      expect(spa._avgDiscountPct!(pairs)).toBe(avg);
      for (const tag of [null, 'sponsor', 'discount', 'inperson', 'upgrade'] as const)
        expect(spa._discountTagConflict!(tag, avg)).toBe(discountTagConflict(tag, avg));
    }
  });
});
