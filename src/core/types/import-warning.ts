/**
 * Import warning codes — the STABLE contract for grouping warnings.
 *
 * ⚠️ These strings are consumed by out-of-repo API clients (the upload machine's polling
 * script groups its emailed summary by them) as well as by the SPA's import preview. Treat a
 * code like a public enum value: ADD freely, never rename or repurpose one. The human-readable
 * `message` stays free-text and may be reworded at any time — that is exactly why the code
 * exists, so nothing has to pattern-match the prose.
 *
 * Every code carries a fixed severity so a client can rank a run without knowing each code:
 *   'critical' — silent data loss or a wrong number if ignored (deletes, blank care columns)
 *   'review'   — imported, but a human should confirm it (sets or implies needsReview)
 *   'info'     — a normal, expected outcome worth reporting (a church created, a row skipped)
 */
export type ImportWarningCode =
  // ---- Form import (import.service.ts) ----
  | 'missing-care-column'
  | 'church-would-be-created'
  | 'church-created'
  | 'unknown-grade'
  | 'manual-allocation-ambiguous'
  | 'manual-allocation-church-forced'
  | 'accommodation-church-override'
  | 'duplicate-submission'
  | 'duplicate-submission-order-undetermined'
  | 'absent-but-retained'
  | 'absent-will-delete'
  | 'absent-delete-truncated'
  // ---- Ticket List import (ticket-import.service.ts) ----
  | 'occurrence-mismatch'
  | 'ticket-not-active'
  | 'unknown-ticket-type'
  | 'unknown-payment-status'
  | 'multiple-active-tickets'
  | 'unmatched-orphan-created'
  | 'multiple-occurrences'
  // ---- Invoice import (invoice-import.service.ts) ----
  | 'no-financial-data'
  | 'billing-name-match-only'
  | 'billing-name-ambiguous'
  | 'invoice-unmatched'
  | 'multiple-invoices-summed'
  | 'shared-invoice-split-by-price'
  | 'shared-invoice-split-residual'
  | 'shared-invoice-split-equally';

export interface ImportWarning {
  /** 1-based CSV row. 0 = a whole-file warning with no single source row. */
  row: number;
  message: string;
  code: ImportWarningCode;
}

/**
 * Short label + severity per code. The SPA renders these as the collapsed group headers, so a
 * label must read as a category ("Matched by billing-contact name only"), never as one row's
 * message. Kept beside the union so adding a code without a label is a type error.
 */
export const IMPORT_WARNING_META: Record<
  ImportWarningCode,
  { label: string; severity: 'critical' | 'review' | 'info' }
> = {
  'missing-care-column': {
    label: 'Care column missing from the export — imports blank',
    severity: 'critical',
  },
  'church-would-be-created': { label: 'Unrecognised church — would be created', severity: 'info' },
  'church-created': { label: 'Unrecognised church — created', severity: 'info' },
  'unknown-grade': { label: 'Unrecognised school grade — left blank', severity: 'review' },
  'manual-allocation-ambiguous': {
    label: 'Manual allocation skipped — duplicate name/mobile',
    severity: 'review',
  },
  'manual-allocation-church-forced': {
    label: 'Church forced by manual allocation',
    severity: 'info',
  },
  'accommodation-church-override': {
    label: 'Accommodation overridden by church override',
    severity: 'info',
  },
  'duplicate-submission': {
    label: 'Duplicate submission — most recent won',
    severity: 'review',
  },
  'duplicate-submission-order-undetermined': {
    label: 'Duplicate submission — most recent COULD NOT be determined',
    severity: 'critical',
  },
  'absent-but-retained': {
    label: 'Absent from file but KEPT (cancellation/refund/override)',
    severity: 'info',
  },
  'absent-will-delete': { label: 'Absent from file — will be DELETED', severity: 'critical' },
  'absent-delete-truncated': { label: 'More deletions not listed individually', severity: 'critical' },
  'occurrence-mismatch': { label: 'Row occurrence does not match filter — skipped', severity: 'info' },
  'ticket-not-active': { label: 'Ticket status not Active — row skipped', severity: 'info' },
  'unknown-ticket-type': {
    label: 'Unrecognised ticket type — accommodation unchanged',
    severity: 'review',
  },
  'unknown-payment-status': { label: 'Unrecognised payment status — unchanged', severity: 'review' },
  'multiple-active-tickets': { label: 'Multiple active tickets — one kept', severity: 'review' },
  'unmatched-orphan-created': {
    label: "No matching student — created as an orphan ('Needs review')",
    severity: 'review',
  },
  'multiple-occurrences': { label: 'Multiple event occurrences in one file', severity: 'review' },
  'no-financial-data': { label: 'No financial data in row — skipped', severity: 'info' },
  'billing-name-match-only': {
    label: 'Matched by billing-contact name only — verify the payer is the registrant',
    severity: 'review',
  },
  'billing-name-ambiguous': {
    label: 'Billing contact matches several people — invoice unmatched',
    severity: 'review',
  },
  'invoice-unmatched': { label: 'No matching person — invoice NOT imported', severity: 'critical' },
  'multiple-invoices-summed': {
    label: 'Multiple invoices for one person — amounts summed',
    severity: 'review',
  },
  'shared-invoice-split-by-price': {
    label: 'Shared invoice — split cleanly by ticket price',
    severity: 'info',
  },
  'shared-invoice-split-residual': {
    label: 'Shared invoice — split by the only resolvable price combination',
    severity: 'info',
  },
  'shared-invoice-split-equally': {
    label: 'Shared invoice — price unknown, split EQUALLY and flagged',
    severity: 'review',
  },
};
