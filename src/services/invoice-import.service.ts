import type { IPersonRepository } from '../repositories/interfaces/entity-repositories';
import type { Person } from '../core/entities/person';
import type { AccommodationKind } from '../core/types/enums';
import type { ImportWarning, ImportWarningCode } from '../core/types/import-warning';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { BadRequestError } from '../core/errors/app-error';
import { parseCsv } from '../utils/csv';
import { nowISO } from '../utils/date';
import { field, isBlankRow, titleCaseName } from './elvanto-mapping';
import {
  buildNameIndex, findPersonMatch, mergeOwnedFields,
} from './person-matching';
import { invalidateDashboardCache } from './dashboard-cache';
import { buildTicketPriceTable, priceForTicket, ticketPriceCatalogue } from './ticket-prices';
import { resolveInvoiceSplit } from './invoice-split';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// invoice-import.service.ts — Invoice CSV importer (Elvanto 3-CSV split, leg 2
// of 3 alongside the Form import in `import.service.ts` and the Ticket List
// import). This CSV carries per-invoice financial data (amount paid, discount,
// fees, tax) and — unlike the Form/Ticket List CSVs — has NO church field and
// often no reliable name field either, only a billing/payer contact and an
// invoice number. Matching is therefore tiered: invoice number first (against
// `Person.invoiceNumber`, set by the Ticket List import), then a cross-church
// name+phone fallback via `person-matching.ts`, and finally "unmatched" (never
// an orphan Person — see the no-orphan note below).
// ---------------------------------------------------------------------------

const InvoiceImportOptionsSchema = z.object({
  csvData: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  minAccommodationSampleSize: z.number().int().min(1).optional().default(3),
  minAccommodationMajorityRatio: z.number().min(0).max(1).optional().default(0.9),
});

export interface InvoiceImportResult {
  created: 0;
  updated: number;
  skipped: number;
  deleted: 0;
  /**
   * Invoices whose invoice number matched MORE THAN ONE person — a family invoice. Since
   * 2026-08-02 these are SPLIT across the people on them (by ticket price, or equally with a
   * review flag when a price is unknown), not withheld. The name is kept for the API shape;
   * the UI reads it as "N invoices covered multiple people and were split".
   */
  ambiguousGroupInvoices: number;
  /** Persons who received a NEW accommodationKind guess this run (via the price lookup). */
  guessedAccommodationCount: number;
  dryRun: boolean;
  errors: Array<{ row: number; message: string }>;
  warnings: ImportWarning[];
  unmatchedInvoices: Array<{
    row: number;
    invoiceNumber: string | null;
    billingName: string | null;
    amountPaid: number | null;
    ticketTotal: number | null;
  }>;
}

export interface InvoiceImportService {
  importInvoicesCsv(actor: Actor, input: unknown): Promise<InvoiceImportResult>;
}

/**
 * Parse a money string, PRESERVING a leading minus sign (discount/fee rows may be
 * negative depending on export convention). Strips everything except digits, '.',
 * and a leading '-'. Returns null for empty/blank input or a non-finite result.
 */
export function parseMoney(raw: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const cleaned = trimmed.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Build a price(cents) -> AccommodationKind lookup from persons whose accommodationKind
 * was CONFIRMED (never guessed) and whose registrationCost is known. Only prices with
 * at least `minSample` confirmed observations, where one kind holds at least
 * `minMajorityRatio` of them, are trusted as a guess source.
 */
export function buildAccommodationPriceLookup(
  allPeople: Person[],
  minSample: number,
  minMajorityRatio: number,
): Map<number, AccommodationKind> {
  const counts = new Map<number, Map<AccommodationKind, number>>();
  for (const p of allPeople) {
    if (p.accommodationKindConfidence !== 'confirmed') continue;
    if (p.accommodationKind == null) continue;
    if (p.registrationCost == null) continue;
    // ⚠️ An individual override reads as 'confirmed' with the OVERRIDE as its kind (never a
    // ticket-derived one), and its registrationCost is whatever ticket they actually bought —
    // e.g. a $150 tent ticket forced to 'classroom'. Training the price table on that teaches
    // "$150 = classroom", which is exactly backwards. Same "a guess must not confirm itself"
    // rule as the CONFIRMED-only gate above, mirrored onto human corrections.
    if (p.accommodationOverride != null) continue;
    const cents = Math.round(p.registrationCost * 100);
    let kindCounts = counts.get(cents);
    if (!kindCounts) {
      kindCounts = new Map<AccommodationKind, number>();
      counts.set(cents, kindCounts);
    }
    kindCounts.set(p.accommodationKind, (kindCounts.get(p.accommodationKind) ?? 0) + 1);
  }

  const lookup = new Map<number, AccommodationKind>();
  for (const [cents, kindCounts] of counts) {
    let total = 0;
    let majorityKind: AccommodationKind | null = null;
    let majorityCount = 0;
    for (const [kind, count] of kindCounts) {
      total += count;
      if (count > majorityCount) {
        majorityCount = count;
        majorityKind = kind;
      }
    }
    if (total < minSample) continue;
    if (majorityKind === null) continue;
    if (majorityCount / total < minMajorityRatio) continue;
    lookup.set(cents, majorityKind);
  }
  return lookup;
}

/**
 * Split `total` into parts proportional to `weights`, in cents, so the parts sum to `total`
 * EXACTLY. Largest-remainder: floor everything, then hand the leftover cents out to whoever
 * was rounded down hardest.
 *
 * ⚠️ Per-person `Math.round(total * w / sum)` does NOT do this — it drifts by a cent or two per
 * invoice, and with 30 shared invoices that is a camp total that visibly disagrees with the sum
 * of its own rows. The exactness is the point.
 */
export function splitExact(total: number, weights: readonly number[], weightSum: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (!(weightSum > 0)) {
    // Degenerate (all-zero weights): fall back to an even split rather than dividing by zero.
    return splitExact(total, weights.map(() => 1), n);
  }
  const totalCents = Math.round(total * 100);
  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = totalCents - floors.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  // `remainder` can be negative when `total` is (a credit note), so step toward zero either way.
  const step = remainder >= 0 ? 1 : -1;
  for (let k = 0; remainder !== 0 && k < order.length * 2; k++) {
    const idx = order[k % order.length]!.i;
    out[idx] = (out[idx] ?? 0) + step;
    remainder -= step;
  }
  return out.map((c) => c / 100);
}

/** Money for a human-readable warning line. Not for display in the UI. */
function formatMoney(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}`;
}

const OWNED_KEYS = [
  'registrationCost',
  'discountCode',
  'discountAmount',
  'amountPaid',
  'feesAmount',
  'taxAmount',
  'accommodationKind',
  'accommodationKindRaw',
  'accommodationKindConfidence',
  // Item A (2026-07-28): the multi-invoice review flag has to be an owned key or
  // `mergeOwnedFields` silently drops it (it only copies keys named here).
  'needsReview',
  'needsReviewReason',
] as const satisfies readonly (keyof Person)[];

export function makeInvoiceImportService(personRepo: IPersonRepository): InvoiceImportService {
  return {
    async importInvoicesCsv(actor, input) {
      assertCan(actor, 'import:run');
      const opts = InvoiceImportOptionsSchema.parse(input);
      const rows = parseCsv(opts.csvData);
      if (rows.length === 0) throw new BadRequestError('CSV has no data rows');

      let updated = 0;
      let skipped = 0;
      let ambiguousGroupInvoices = 0;
      let guessedAccommodationCount = 0;
      const errors: InvoiceImportResult['errors'] = [];
      const warnings: InvoiceImportResult['warnings'] = [];
      const unmatchedInvoices: InvoiceImportResult['unmatchedInvoices'] = [];

      const allPeople = await personRepo.findAll();

      const priceLookup = buildAccommodationPriceLookup(
        allPeople,
        opts.minAccommodationSampleSize,
        opts.minAccommodationMajorityRatio,
      );

      /* ⚠️ SHARED INVOICES ARE PROCESSED IN A SECOND PASS, AFTER THE SINGLES — 2026-08-04.
         A shared invoice is split using prices learned from SINGLE-person invoices, and this
         table used to be built once from the pre-run state and never rebuilt. That is correct
         for a top-up import into an established camp, and completely wrong for the first import
         into an empty one:

             after the 2026-08-04 rollover, `registrationCost` was null on all 287 people
             (only the Invoice import sets it), so the table was EMPTY when the run started,
             so NOTHING had a price, so all 41 shared invoices fell to the equal split and
             all 92 people on them were flagged for review.

         That is what the owner reported as "the review is too sensitive", and it is not
         sensitivity — the importer simply had not read the prices yet, though they were sitting
         in the very file it was processing. Running the same import twice fixed it, which is a
         workaround nobody should have to know. So the singles are applied first, the table is
         rebuilt from what they just wrote, and the shared invoices are resolved against it.
         **Do not fold this back into one pass.** */
      const deferredGroups: Array<{
        rowNum: number;
        invoiceNumber: string | null;
        matchedPeople: Person[];
        ticketTotal: number | null;
        amountPaid: number | null;
        discountAmount: number | null;
        feesAmount: number | null;
        taxAmount: number | null;
        discountCode: string | null;
      }> = [];

      const byInvoiceNumber = new Map<string, Person[]>();
      for (const p of allPeople) {
        if (!p.invoiceNumber) continue;
        const pool = byInvoiceNumber.get(p.invoiceNumber);
        if (pool) pool.push(p);
        else byInvoiceNumber.set(p.invoiceNumber, [p]);
      }

      const nameIndex = buildNameIndex(allPeople);

      const touched = new Map<string, Person>();
      /* Item A (2026-07-28): running per-person money totals for THIS run only — see the
         accumulation note at the single-match branch below. Keyed by person id. */
      const moneyByPerson = new Map<string, {
        amountPaid: number | null; discountAmount: number | null;
        feesAmount: number | null; taxAmount: number | null; rows: number;
      }>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const rowNum = i + 2;
        // Item 12 (2026-07-28): see import.service.ts — a blank padding row is skipped silently.
        if (isBlankRow(row)) { skipped++; continue; }

        try {
          const invoiceNumber = field(row, 'Invoice Number', 'Invoice #', 'Invoice ID', 'invoiceNumber') || null;
          // Real Billing Contacts export (2026-07-02 sample) uses plain "First Name"/"Last Name"
          // for the billing contact — NOT a "Billing "/"Payer " prefix as first guessed. Note this
          // is very often a PARENT, not the registrant (e.g. invoice billed to "Robin Thompson"
          // for attendee "Ivy Thompson") — that's exactly why invoice-number matching is tier 1
          // and this name is only a fallback (see the "billing-contact name only" warning below).
          const billingFirst = titleCaseName(field(row, 'First Name', 'Billing First Name', 'Payer First Name') || '');
          const billingLast = titleCaseName(field(row, 'Last Name', 'Billing Last Name', 'Payer Last Name') || '');
          const billingPhone = field(row, 'Phone', 'Billing Phone', 'Payer Phone', 'Mobile Number') || null;

          const ticketTotalRaw = field(row, 'Ticket Total', 'Tickets Total', 'registrationCost') || '';
          const discountTotalRaw = field(row, 'Discount Total', 'Discount Amount') || '';
          const amountPaidRaw = field(row, 'Amount Paid', 'Paid Amount', 'Total Paid') || '';
          const feesRaw = field(row, 'Fees Paid', 'Fees', 'Processing Fee', 'Fees Total') || '';
          const taxRaw = field(row, 'Total Tax', 'Tax', 'GST', 'Tax Total') || '';
          const discountCode = field(row, 'Discount Code', 'Code', 'Coupon Code') || null;

          const ticketTotal = parseMoney(ticketTotalRaw);
          const discountAmount = parseMoney(discountTotalRaw);
          const amountPaid = parseMoney(amountPaidRaw);
          const feesAmount = parseMoney(feesRaw);
          const taxAmount = parseMoney(taxRaw);

          if (
            ticketTotal === null &&
            discountAmount === null &&
            amountPaid === null &&
            feesAmount === null &&
            taxAmount === null
          ) {
            warnings.push({ code: 'no-financial-data', row: rowNum, message: 'No financial data in row — skipped' });
            skipped++;
            continue;
          }

          const billingName = billingFirst || billingLast ? `${billingFirst} ${billingLast}`.trim() : null;

          // ---- Tiered matching ----
          let matchedPeople: Person[] = [];
          let viaGroup = false;

          if (invoiceNumber) {
            const candidates = byInvoiceNumber.get(invoiceNumber);
            if (candidates && candidates.length === 1) {
              matchedPeople = [candidates[0]!];
            } else if (candidates && candidates.length > 1) {
              matchedPeople = candidates;
              viaGroup = true;
            }
          }

          if (matchedPeople.length === 0 && billingFirst && billingLast) {
            const result = findPersonMatch(nameIndex, {
              firstName: billingFirst,
              lastName: billingLast,
              phone: billingPhone,
            });
            if (result.status === 'matched') {
              matchedPeople = [result.person];
              warnings.push({
                code: 'billing-name-match-only',
                row: rowNum,
                message: `Matched by billing-contact name only — verify "${billingFirst} ${billingLast}" is actually a covered registrant, not just the payer`,
              });
            } else if (result.reason === 'ambiguous') {
              warnings.push({
                code: 'billing-name-ambiguous',
                row: rowNum,
                message: `Billing contact "${billingFirst} ${billingLast}" matches ${result.candidates.length} people — ambiguous, invoice unmatched`,
              });
            }
          }

          if (matchedPeople.length === 0) {
            unmatchedInvoices.push({
              row: rowNum,
              invoiceNumber,
              billingName,
              amountPaid,
              ticketTotal,
            });
            warnings.push({
              code: 'invoice-unmatched',
              row: rowNum,
              message: `No matching person for invoice ${invoiceNumber ?? '(no invoice number)'} (amount paid: ${amountPaid ?? 'unknown'}) — not imported`,
            });
            skipped++;
            continue;
          }

          /* ── SHARED (FAMILY) INVOICE ──────────────────────────────────────────────────────
             ⚠️ THIS BRANCH USED TO WITHHOLD THE MONEY FROM EVERYONE ON THE INVOICE, and that
             was the single biggest hole in the budget. Measured against prod 2026-08-02:

                 invoices with 1 registrant : 153 — all had money        (0 missing)
                 invoices with 2 registrants:  26 — NONE had money   (52 people)
                 invoices with 3 registrants:   4 — NONE had money   (12 people)

             i.e. 64 of 217 people, roughly $11,760 of ticket value, silently reported as $0
             with no discount code to explain it — which is exactly what the owner noticed.
             "Cannot attribute a shared total to individuals" was true of the total alone, but
             we know each person's TICKET, and the ticket has a price (see ticket-prices.ts).
             A $340 invoice covering a $190 classroom and a $150 tent is not ambiguous at all.

             Split rules, in order (the decision itself lives in `invoice-split.ts`):
               1. every person's ticket price is known → weight by price. When the invoice total
                  equals the sum of the tickets (the normal case) this is EXACT, not an estimate;
                  when a discount was applied it apportions it in proportion to what each ticket
                  cost, which is how a shared discount actually works.
               2. some ticket type is unpriced, but the invoice total decomposes into known ticket
                  prices in EXACTLY ONE way → use that. Added 2026-08-04 on the owner's report that
                  review was firing too often: a $340 invoice covering one known $190 classroom and
                  one unknown ticket leaves $150, and $150 is a real price — there is nothing there
                  for a human to adjudicate. A confirmed `accommodationKind` breaks the one-tent-
                  one-classroom tie; see that module's header.
               3. otherwise → equal split, and everyone is flagged `needsReview`, because that
                  IS a guess and a human should look before the budget is trusted.
             ⚠️ 2 and 3 can produce the SAME NUMBERS and must still differ on the flag: "the equal
             split is provably right" is not "we gave up and split equally".
             Rounding uses largest-remainder so the parts always sum to the invoice EXACTLY —
             a per-person round() would drift the camp total by cents per invoice. */
          if (viaGroup) {
            ambiguousGroupInvoices++;
            deferredGroups.push({
              rowNum, invoiceNumber, matchedPeople,
              ticketTotal, amountPaid, discountAmount, feesAmount, taxAmount, discountCode,
            });
            continue;
          }
          // Single match.
          const person = matchedPeople[0]!;
          const incoming: Partial<Person> = {};

          /* Item A (2026-07-28) — MULTIPLE INVOICES FOR ONE PERSON.
             Real case: someone buys the wrong ticket ($150), is told to buy the correct one
             ($190) with a discount code covering the difference, and pays $40. That is two
             invoice rows for one registrant. The old behaviour was last-row-wins, so the budget
             recorded whichever row happened to come second and under-reported what was actually
             paid.
             Now the money fields ACCUMULATE across rows within a run: amountPaid / discountAmount
             / feesAmount / taxAmount are summed, and registrationCost takes the LATEST row's
             ticket total (the corrected ticket is the one they're actually attending on).
             Accumulation starts from the rows in THIS file, never from the stored value — so
             re-importing the same export is idempotent and cannot double-count. */
          const prior = moneyByPerson.get(person.id);
          const sum = (a: number | null | undefined, b: number | null) =>
            b === null ? (a ?? null) : (a ?? 0) + b;
          const acc = {
            amountPaid: sum(prior?.amountPaid, amountPaid),
            discountAmount: sum(prior?.discountAmount, discountAmount),
            feesAmount: sum(prior?.feesAmount, feesAmount),
            taxAmount: sum(prior?.taxAmount, taxAmount),
            rows: (prior?.rows ?? 0) + 1,
          };
          moneyByPerson.set(person.id, acc);
          if (prior) {
            warnings.push({
              code: 'multiple-invoices-summed',
              row: rowNum,
              message:
                `${person.firstName} ${person.lastName} has ${acc.rows} invoices in this file — ` +
                `amounts summed (paid ${acc.amountPaid ?? 0}, discount ${acc.discountAmount ?? 0}); ` +
                `ticket total taken from this row. Flagged for review.`,
            });
            // Gate (item A/B): a person with more than one invoice is worth a human look before
            // the budget is trusted — same review flag the Ticket List import uses.
            incoming.needsReview = true;
            incoming.needsReviewReason = `Multiple invoices found (${acc.rows}) — amounts were summed`;
          }

          if (ticketTotal !== null) incoming.registrationCost = ticketTotal;
          if (acc.discountAmount !== null) incoming.discountAmount = acc.discountAmount;
          if (acc.amountPaid !== null) incoming.amountPaid = acc.amountPaid;
          if (acc.feesAmount !== null) incoming.feesAmount = acc.feesAmount;
          if (acc.taxAmount !== null) incoming.taxAmount = acc.taxAmount;
          if (discountCode) incoming.discountCode = discountCode;

          const alreadyConfirmed =
            person.accommodationKind != null && person.accommodationKindConfidence === 'confirmed';
          if (ticketTotal !== null && !alreadyConfirmed) {
            const guess = priceLookup.get(Math.round(ticketTotal * 100));
            if (guess) {
              incoming.accommodationKind = guess;
              incoming.accommodationKindRaw = guess;
              incoming.accommodationKindConfidence = 'guessed';
              guessedAccommodationCount++;
            }
          }

          if (Object.keys(incoming).length === 0) {
            skipped++;
            continue;
          }

          const merged = mergeOwnedFields(person, incoming, OWNED_KEYS);
          merged.updatedAt = nowISO();
          const firstTouch = !touched.has(merged.id);
          touched.set(merged.id, merged);
          if (firstTouch) updated++;
        } catch (err) {
          errors.push({ row: rowNum, message: err instanceof Error ? err.message : String(err) });
          skipped++;
        }
      }

      /* ── SECOND PASS: the shared invoices ──────────────────────────────────────────────
         The price table is rebuilt from the pre-run people OVERLAID with everything the
         first pass just wrote, so a single-person invoice in this very file prices the
         ticket type for a family invoice further down it. See the note at `deferredGroups`.
         ⚠️ Only `touched` is overlaid, never the deferred groups' own equal-split output —
         that would let a guess teach the table a price and then be validated by it. */
      if (deferredGroups.length > 0) {
        const pricedPeople = [...allPeople.filter((p) => !touched.has(p.id)), ...touched.values()];
        const priceTable = buildTicketPriceTable(pricedPeople);
        const priceCatalogue = ticketPriceCatalogue(priceTable);

        for (const g of deferredGroups) {
          const { rowNum, invoiceNumber, matchedPeople, ticketTotal, amountPaid,
            discountAmount, feesAmount, taxAmount, discountCode } = g;
          try {
            const split = resolveInvoiceSplit(
              matchedPeople.map((p) => ({
                ticketPrice: priceForTicket(priceTable, p.registrationType),
                // ⚠️ CONFIRMED ONLY. A `guessed` kind was itself inferred from an invoice total
                // by `buildAccommodationPriceLookup`, so passing it here lets a guess confirm
                // itself and silently un-flags an invoice we never actually resolved.
                accommodationKind:
                  p.accommodationKindConfidence === 'confirmed' ? p.accommodationKind ?? null : null,
              })),
              ticketTotal,
              priceCatalogue,
              priceLookup,
            );
            const resolved = split.costs;
            const weights = resolved ?? matchedPeople.map(() => 1);
            const weightSum = weights.reduce((s, w) => s + w, 0);
            const share = (total: number | null): (number | null)[] =>
              total === null
                ? matchedPeople.map(() => null)
                : splitExact(total, weights, weightSum);

            const paidParts = share(amountPaid);
            const costParts = resolved ?? share(ticketTotal);
            const discountParts = share(discountAmount);
            const feeParts = share(feesAmount);
            const taxParts = share(taxAmount);

            const names = (parts: (number | null)[]): string =>
              matchedPeople
                .map((p, i) => `${p.firstName} ${p.lastName} ${formatMoney(parts[i] ?? null)}`)
                .join(', ');
            // The three split outcomes get DISTINCT codes on purpose: only 'split-equally'
            // sets needsReview, and CLAUDE.md's 2026-08-07 entry turns on being able to tell
            // "the split is too sensitive" apart from "why is this flagged".
            const splitCode: ImportWarningCode =
              split.method === 'ticket-price'
                ? 'shared-invoice-split-by-price'
                : split.method === 'residual'
                  ? 'shared-invoice-split-residual'
                  : 'shared-invoice-split-equally';
            warnings.push({
              code: splitCode,
              row: rowNum,
              message:
                split.method === 'ticket-price'
                  ? `Invoice ${invoiceNumber} covers ${matchedPeople.length} people — split by ticket price (${names(paidParts)})`
                  : split.method === 'residual'
                    ? `Invoice ${invoiceNumber} covers ${matchedPeople.length} people, not all ticket types priced — the total resolves to known ticket prices one way only, so it was split on those (${names(costParts)})`
                    : `Invoice ${invoiceNumber} covers ${matchedPeople.length} people and the total cannot be resolved to known ticket prices — split EQUALLY and flagged for review`,
            });

            for (let m = 0; m < matchedPeople.length; m++) {
              const person = touched.get(matchedPeople[m]!.id) ?? matchedPeople[m]!;
              const incoming: Partial<Person> = {};
              if (costParts[m] != null) incoming.registrationCost = costParts[m]!;
              if (paidParts[m] != null) incoming.amountPaid = paidParts[m]!;
              if (discountParts[m] != null) incoming.discountAmount = discountParts[m]!;
              if (feeParts[m] != null) incoming.feesAmount = feeParts[m]!;
              if (taxParts[m] != null) incoming.taxAmount = taxParts[m]!;
              if (discountCode) incoming.discountCode = discountCode;
              if (split.needsReview) {
                incoming.needsReview = true;
                incoming.needsReviewReason =
                  `Shared invoice ${invoiceNumber ?? ''} split equally between ${matchedPeople.length} people — ticket price unknown`.trim();
              }
              if (Object.keys(incoming).length === 0) continue;
              const merged = mergeOwnedFields(person, incoming, OWNED_KEYS);
              merged.updatedAt = nowISO();
              const firstTouch = !touched.has(merged.id);
              touched.set(merged.id, merged);
              if (firstTouch) updated++;
            }
          } catch (err) {
            errors.push({ row: rowNum, message: err instanceof Error ? err.message : String(err) });
            skipped++;
          }
        }
      }

      if (!opts.dryRun && touched.size > 0) {
        await personRepo.saveMany([...touched.values()]);
        invalidateDashboardCache();
      }

      return {
        created: 0,
        updated,
        skipped,
        deleted: 0,
        ambiguousGroupInvoices,
        guessedAccommodationCount,
        dryRun: opts.dryRun,
        errors,
        warnings,
        unmatchedInvoices,
      };
    },
  };
}
