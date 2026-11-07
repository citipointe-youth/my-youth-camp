import type { Person } from '../core/entities/person';
import { isBlank } from './person-matching';

// ---------------------------------------------------------------------------
// field-ownership.ts — WHO may write each Person field on an import UPDATE, and what a blank
// cell does (I1, 2026-11-07). One table instead of a Form merge literal, two OWNED_KEYS lists
// and docs prose. The importers still parse and match; they hand `applyRow` "what this row
// says" and it decides what lands. Creating a new person is not covered: a create writes every
// field it has.
//
// Policies (per importer):
//   write        a non-blank value overwrites; a blank (null/undefined/''/[]) keeps the stored value
//   write-blank  the value always lands, blank included (the importer leaves the key out when the
//                row says nothing, e.g. a blank School Grade cell)
//   seed-only    lands only when the STORED value is null (B-16 / IA OQ-6): the Form never
//                overwrites a Ticket/Invoice-owned value. Exception: a person this same file
//                created (`createdThisRun`) is the importer's own, so a later duplicate
//                submission still wins field by field (item 7) — a blank keeps.
//   (absent)     this importer may not write the field; applyRow throws (a code bug, not data)
// ---------------------------------------------------------------------------

export type Importer = 'form' | 'ticket' | 'invoice';
export type WritePolicy = 'write' | 'write-blank' | 'seed-only';

/** What one row says: any owned field, `null`/blank meaning "this row has no value". */
export type RowValues = { [K in keyof Person]?: Person[K] | null };

export interface FieldRule {
  write: Partial<Record<Importer, WritePolicy>>;
  /** The stored value a `seed-only` write tests, when it is not the field itself. */
  stored?: (p: Person) => unknown;
}

/* The importers' own kind column. `!== undefined`, never `??` on the effective value: a genuine
   `null` raw (accommodation_kind blank, accommodation_override set) must not be walked past to
   `accommodationKind` (the resolved value), or the override gets baked back into this column. */
const storedKind = (p: Person) => (p.accommodationKindRaw !== undefined ? p.accommodationKindRaw : p.accommodationKind);

const FORM = { form: 'write' } as const;
const FORM_BLANK = { form: 'write-blank' } as const;

export const OWNERSHIP: Partial<Record<keyof Person, FieldRule>> = {
  // ---- Form (Elvanto registration) ----
  firstName: { write: FORM },
  lastName: { write: FORM },
  gender: { write: FORM },
  grade: { write: FORM_BLANK },   // sent only when the School Grade cell is non-blank
  kind: { write: FORM_BLANK },    // same cell as grade
  dateOfBirth: { write: FORM },
  mobile: { write: FORM },
  email: { write: FORM },
  suburb: { write: FORM },
  postcode: { write: FORM },
  state: { write: FORM },
  medicareNumber: { write: FORM },
  zone: { write: FORM_BLANK },    // follows the resolved church, '' for unallocated
  medicalConditions: { write: FORM },
  dietaryRequirements: { write: FORM },
  otherMedications: { write: FORM },
  medicationConsent: { write: FORM },
  blueCardNumber: { write: FORM },
  blueCardExpiry: { write: FORM },
  churchUnlistedNote: { write: FORM },
  elvantoMeta: { write: FORM },   // sent only when Date Submitted is set
  consents: { write: FORM },      // per-consent blank-keeps inside buildConsents (A-1)
  parentGuardianName: { write: FORM },
  parentRelation: { write: FORM },
  parentPhone: { write: FORM },

  // ---- Ticket List ----
  ticketNumber: { write: { ticket: 'write' } },
  invoiceNumber: { write: { ticket: 'write' } },
  invoiceNumbers: { write: { ticket: 'write-blank' } }, // rebuilt from this file every run
  paymentStatus: { write: { ticket: 'write' } },
  registrationType: { write: { form: 'seed-only', ticket: 'write' } },

  // ---- Ticket + Invoice: accommodation. The Ticket import writes back the raw kind (or its
  // church override) every row; the Invoice import writes only a price guess, and never over a
  // confirmed kind (the importer checks that, it is a rule about the value not the field). ----
  accommodationKind: { write: { form: 'seed-only', ticket: 'write-blank', invoice: 'write' }, stored: storedKind },
  accommodationKindRaw: { write: { form: 'seed-only', ticket: 'write-blank', invoice: 'write' }, stored: storedKind },
  accommodationKindConfidence: { write: { ticket: 'write-blank', invoice: 'write' } }, // never the Form

  // ---- Invoice ----
  registrationCost: { write: { form: 'seed-only', invoice: 'write' } },
  discountCode: { write: { form: 'seed-only', invoice: 'write' } },
  discountAmount: { write: { invoice: 'write' } },
  amountPaid: { write: { invoice: 'write' } },
  feesAmount: { write: { invoice: 'write' } },
  taxAmount: { write: { invoice: 'write' } },

  // ---- Review flag: set by Ticket/Invoice, cleared by nobody (latch, PLANNED-IMPROVEMENTS) ----
  needsReview: { write: { ticket: 'write', invoice: 'write' } },
  needsReviewReason: { write: { ticket: 'write', invoice: 'write' } },

  updatedAt: { write: { form: 'write', ticket: 'write', invoice: 'write' } },
};

/** Merge one import row onto the stored person by the table above. Returns a new object;
 *  fields the row does not mention are kept. */
export function applyRow(
  importer: Importer,
  existing: Person,
  incoming: RowValues,
  opts: { createdThisRun?: boolean } = {},
): Person {
  const out: Person = { ...existing };
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(incoming) as (keyof Person)[]) {
    const rule = OWNERSHIP[key];
    const policy = rule?.write[importer];
    if (!policy) throw new Error(`field-ownership: the ${importer} import does not own "${String(key)}"`);
    const value = incoming[key];
    const stored = rule!.stored ? rule!.stored(existing) : existing[key];
    const lands =
      policy === 'write-blank' ? true
      : policy === 'write' || (policy === 'seed-only' && opts.createdThisRun) ? !isBlank(value)
      : stored == null;
    // A kept seed-only kind is re-stated from the importers' column (as B-16 did), so the
    // in-memory copy never carries an override as its own kind.
    if (lands) target[key] = value;
    else if (policy === 'seed-only') target[key] = stored;
  }
  return out;
}
