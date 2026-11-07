// PRODUCTION Supabase people repository — the live store behind PERSISTENCE=supabase
// (my-youth-camp.vercel.app). It holds minors' PII: sensitive columns (medicare number,
// medical/dietary data, parent contacts, blue card, consents) are encrypted at rest via
// AES-256-GCM in the row↔entity mappers below (see src/utils/field-crypto.ts).
//
// Unified `people` table (design D2) with hybrid mapping (D4): scalar columns on
// `people`, encrypted `*_enc` columns, and the check-in / sign-out histories hydrated
// from CHILD TABLES (check_in_history, sign_out_history).
import type { SqlClient, TxClient } from './client';
import type { IPersonRepository, PresenceDecide, PresenceWrite } from '../interfaces/entity-repositories';
import { withPresenceWrite } from '../interfaces/entity-repositories';
import { NotFoundError } from '../../core/errors/app-error';
import type { Person } from '../../core/entities/person';
import type { CheckInEntry, SignOutEvent, ElvantoMeta } from '../../core/entities/person';
import { maybeEncrypt, maybeDecrypt } from '../../utils/field-crypto';

const T = 'people';
const aad = (col: string, id: string): string => `${T}:${col}:${id}`;

const DEFAULT_CONSENTS = (): Person['consents'] => ({
  medical: { granted: false, timestamp: null },
  media: { granted: false, timestamp: null },
  supervision: { granted: false, timestamp: null },
});

/** Read an encrypted JSON string[] from `<col>_enc`, falling back to the legacy `<col>` array. */
function readEncArray(row: Record<string, unknown>, col: string, id: string): string[] {
  const enc = (row[`${col}_enc`] as string | null | undefined) ?? null;
  if (enc != null) {
    const s = maybeDecrypt(enc, aad(col, id));
    return s ? (JSON.parse(s) as string[]) : [];
  }
  return (row[col] as string[] | null) ?? [];
}

/** Encrypt a string[] to a ciphertext string for `<col>_enc` (empty/null → null). */
function encArray(values: string[] | null | undefined, col: string, id: string): string | null {
  if (values == null || values.length === 0) return null;
  return maybeEncrypt(JSON.stringify(values), aad(col, id));
}

/** Read encrypted consents from `consents_enc`, falling back to legacy jsonb `consents`. */
function readEncConsents(row: Record<string, unknown>, id: string): Person['consents'] {
  const enc = (row['consents_enc'] as string | null | undefined) ?? null;
  if (enc != null) {
    const s = maybeDecrypt(enc, aad('consents', id));
    return s ? (JSON.parse(s) as Person['consents']) : DEFAULT_CONSENTS();
  }
  return (row['consents'] as Person['consents']) ?? DEFAULT_CONSENTS();
}

/** Read an encrypted date string from `<col>_enc`, falling back to the legacy `<col>` date. */
function readEncDate(row: Record<string, unknown>, col: string, id: string): string | null {
  const enc = (row[`${col}_enc`] as string | null | undefined) ?? null;
  if (enc != null) return maybeDecrypt(enc, aad(col, id)); // stored as 'YYYY-MM-DD'
  return dateOnly(row[col]);
}

// The "Unallocated" sentinel churchId (see src/services/church-allocation.ts —
// UNALLOCATED_CHURCH_ID; duplicated here, not imported, to keep repositories/
// from depending on services/). It is NOT a row in `churches`, so it can never
// be written to `people.church_id` (which has a real FK to `churches(id)`) —
// doing so throws a foreign-key violation ("An unexpected error occurred") on
// every write. Map it to/from SQL NULL instead, which the FK already allows
// (`on delete set null`).
const UNALLOCATED_CHURCH_ID = '__unallocated__';

// ---------------------------------------------------------------------------
// Row → entity mappers
// ---------------------------------------------------------------------------

function dateOnly(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().split('T')[0]!;
  if (typeof v === 'string' && v) return v.split('T')[0]!;
  return null;
}

function toCheckInEntry(row: Record<string, unknown>): CheckInEntry {
  return {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    sessionLabel: row['session_label'] as string,
    type: row['type'] as 'in' | 'out',
    leaderId: row['leader_id'] as string,
    timestamp: (row['timestamp'] as Date).toISOString(),
  };
}

function toSignOutEvent(row: Record<string, unknown>): SignOutEvent {
  return {
    id: row['id'] as string,
    type: row['type'] as 'out' | 'in',
    leaderName: row['leader_name'] as string,
    reason: (row['reason'] as string | null) ?? undefined,
    authorId: row['author_id'] as string,
    timestamp: (row['timestamp'] as Date).toISOString(),
  };
}

/** Build a Person from a `people` row + its already-fetched history rows. */
export function toPerson(
  row: Record<string, unknown>,
  checkIns: CheckInEntry[],
  signOuts: SignOutEvent[],
): Person {
  const id = row['id'] as string;
  return {
    id: row['id'] as string,
    firstName: row['first_name'] as string,
    lastName: row['last_name'] as string,
    gender: row['gender'] as Person['gender'],
    dateOfBirth: dateOnly(row['date_of_birth']),
    grade: (row['grade'] as Person['grade'] | null) ?? null,
    school: (row['school'] as string | null) ?? null,
    kind: row['kind'] as Person['kind'],
    churchId: (row['church_id'] as string | null) ?? UNALLOCATED_CHURCH_ID,
    churchName: row['church_name'] as string,
    zone: row['zone'] as string,
    groupId: (row['group_id'] as string | null) ?? null,
    mobile: (row['mobile'] as string | null) ?? null,
    email: (row['email'] as string | null) ?? null,
    suburb: (row['suburb'] as string | null) ?? null,
    postcode: (row['postcode'] as string | null) ?? null,
    state: (row['state'] as string | null) ?? null,
    medicalConditions: readEncArray(row, 'medical_conditions', id),
    dietaryRequirements: readEncArray(row, 'dietary_requirements', id),
    otherMedications: maybeDecrypt(row['other_medications'] as string | null, aad('other_medications', id)),
    medicationConsent: (maybeDecrypt(row['medication_consent'] as string | null, aad('medication_consent', id)) as Person['medicationConsent']) ?? null,
    medicareNumber: maybeDecrypt(row['medicare_number'] as string | null, aad('medicare_number', id)),
    churchUnlistedNote: (row['church_unlisted_note'] as string | null) ?? null,
    elvantoMeta: (row['elvanto_meta'] as ElvantoMeta | null) ?? null,
    parentGuardianName: maybeDecrypt(row['parent_guardian_name'] as string | null, aad('parent_guardian_name', id)),
    parentPhone: maybeDecrypt(row['parent_phone'] as string | null, aad('parent_phone', id)),
    parentRelation: maybeDecrypt(row['parent_relation'] as string | null, aad('parent_relation', id)),
    blueCardNumber: maybeDecrypt(row['blue_card_number'] as string | null, aad('blue_card_number', id)),
    blueCardExpiry: readEncDate(row, 'blue_card_expiry', id),
    consents: readEncConsents(row, id),
    paymentStatus: row['payment_status'] as Person['paymentStatus'],
    /* THE OVERRIDE CHOKEPOINT. Resolved once, here, on the read path: every consumer of
       accommodationKind (dashboard counts, allocation grouping, tent distribution, the
       allocations screen + its 4-sheet export, budget classifyTicket, the audit workbook,
       the Data tab) honours an individual override with no code of its own. The raw column
       rides alongside as accommodationKindRaw and is what personColumns writes back. */
    accommodationKind:
      ((row['accommodation_override'] as Person['accommodationKind']) ??
        (row['accommodation_kind'] as Person['accommodationKind'])) ?? null,
    accommodationKindRaw: (row['accommodation_kind'] as Person['accommodationKind']) ?? null,
    accommodationOverride: (row['accommodation_override'] as Person['accommodationOverride']) ?? null,
    accommodationLabel: (row['accommodation_label'] as string | null) ?? null,
    registrationType: (row['registration_type'] as string | null) ?? null,
    registrationCost: (row['registration_cost'] as number | null) ?? null,
    discountCode: (row['discount_code'] as string | null) ?? null,
    ticketNumber: (row['ticket_number'] as string | null) ?? null,
    invoiceNumber: (row['invoice_number'] as string | null) ?? null,
    invoiceNumbers: (row['invoice_numbers'] as string[] | null) ?? null,
    /* An override is a human decision, so it reads as 'confirmed'. This is also what stops the
       Invoice import's price-guessing from touching an overridden person
       (invoice-import.service.ts:434-439 only guesses when nothing better exists). */
    accommodationKindConfidence: row['accommodation_override'] != null
      ? 'confirmed'
      : ((row['accommodation_kind_confidence'] as Person['accommodationKindConfidence']) ?? null),
    discountAmount: (row['discount_amount'] as number | null) ?? null,
    amountPaid: (row['amount_paid'] as number | null) ?? null,
    feesAmount: (row['fees_amount'] as number | null) ?? null,
    taxAmount: (row['tax_amount'] as number | null) ?? null,
    amountPaidOverride: (row['amount_paid_override'] as number | null) ?? null,
    refundAmount: (row['refund_amount'] as number | null) ?? null,
    refundedAt: row['refunded_at'] ? (row['refunded_at'] as Date).toISOString() : null,
    cancelledAt: row['cancelled_at'] ? (row['cancelled_at'] as Date).toISOString() : null,
    needsReview: (row['needs_review'] as boolean | null) ?? false,
    needsReviewReason: (row['needs_review_reason'] as string | null) ?? null,
    lifecycle: row['lifecycle'] as Person['lifecycle'],
    atCamp: row['at_camp'] as boolean,
    checkInHistory: checkIns,
    signOutHistory: signOuts,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export class SupabasePersonRepository implements IPersonRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: the table already exists (created by the migrations).
  }

  // --- history hydration -----------------------------------------------------

  /** Fetch + group both history tables for a set of person ids (avoids N+1). */
  private async loadHistories(ids: string[], db: SqlClient | TxClient = this.sql): Promise<{
    checkIns: Map<string, CheckInEntry[]>;
    signOuts: Map<string, SignOutEvent[]>;
  }> {
    const checkIns = new Map<string, CheckInEntry[]>();
    const signOuts = new Map<string, SignOutEvent[]>();
    if (ids.length === 0) return { checkIns, signOuts };

    // `, id` breaks timestamp ties so the order is stable (last-entry-wins depends on it).
    const ciRows = await db`
      select * from check_in_history where person_id in ${db(ids)} order by timestamp, id
    `;
    for (const r of ciRows) {
      const pid = r['person_id'] as string;
      (checkIns.get(pid) ?? checkIns.set(pid, []).get(pid)!).push(toCheckInEntry(r));
    }
    const soRows = await db`
      select * from sign_out_history where person_id in ${db(ids)} order by timestamp, id
    `;
    for (const r of soRows) {
      const pid = r['person_id'] as string;
      (signOuts.get(pid) ?? signOuts.set(pid, []).get(pid)!).push(toSignOutEvent(r));
    }
    return { checkIns, signOuts };
  }

  private async hydrate(rows: readonly Record<string, unknown>[], db: SqlClient | TxClient = this.sql): Promise<Person[]> {
    const ids = rows.map((r) => r['id'] as string);
    const { checkIns, signOuts } = await this.loadHistories(ids, db);
    return rows.map((r) =>
      toPerson(r, checkIns.get(r['id'] as string) ?? [], signOuts.get(r['id'] as string) ?? []),
    );
  }

  // --- reads -----------------------------------------------------------------

  async findAll(): Promise<Person[]> {
    const rows = await this.sql`select * from people order by last_name, first_name`;
    return this.hydrate(rows);
  }

  async findById(id: string): Promise<Person | null> {
    const rows = await this.sql`select * from people where id = ${id}`;
    if (!rows[0]) return null;
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findByChurch(churchId: string): Promise<Person[]> {
    if (churchId === UNALLOCATED_CHURCH_ID) {
      return this.hydrate(await this.sql`select * from people where church_id is null order by last_name, first_name`);
    }
    return this.hydrate(await this.sql`select * from people where church_id = ${churchId} order by last_name, first_name`);
  }

  async findByZone(zone: string): Promise<Person[]> {
    return this.hydrate(await this.sql`select * from people where zone = ${zone} order by last_name, first_name`);
  }

  async search(query: string): Promise<Person[]> {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const rows = await this.sql`select * from people order by last_name, first_name`;
    const matched = rows.filter((r: Record<string, unknown>) => {
      const full = `${r['first_name']} ${r['last_name']}`.toLowerCase();
      return terms.every((t) => full.includes(t));
    });
    return this.hydrate(matched);
  }

  // --- writes ----------------------------------------------------------------

  /** Upsert the `people` row. P3: the UPDATE set never holds presence (`at_camp`, `lifecycle`,
   *  `cancelled_at`) and history child rows are written only when the row was INSERTED
   *  (`xmax = 0`), so a stale full-row save can't revert a tap or re-insert cleared history.
   *  Returns the caller's `person` as given — NOT a read-back. */
  async save(person: Person): Promise<Person> {
    await this.sql.begin(async (tx: TxClient) => {
      await upsertPerson(tx, person);
    });
    return person;
  }

  async saveMany(people: Person[]): Promise<Person[]> {
    if (people.length === 0) return [];
    await this.sql.begin(async (tx: TxClient) => {
      // Each person must be upserted individually — the batch ON CONFLICT DO UPDATE
      // would incorrectly overwrite every conflicting row with batch[0]'s values.
      for (const p of people) await upsertPerson(tx, p);
    });
    return people;
  }

  /** P3 presence seam: lock the row, decide on the stored state, write presence + one history row. */
  async transition(id: string, decide: PresenceDecide): Promise<Person> {
    return this.sql.begin(async (tx: TxClient) => {
      const [current] = await this.lockAndLoad(tx, [id]);
      if (!current) throw new NotFoundError('Person not found');
      return writePresence(tx, current, decide(current));
    });
  }

  async transitionMany(ids: string[], decide: PresenceDecide): Promise<Person[]> {
    if (ids.length === 0) return [];
    return this.sql.begin(async (tx: TxClient) => {
      const out: Person[] = [];
      for (const current of await this.lockAndLoad(tx, [...new Set(ids)])) {
        out.push(await writePresence(tx, current, decide(current)));
      }
      return out;
    });
  }

  /** `select … for update` in id order (IA OQ-9), then load histories on the SAME transaction —
   *  using `this.sql` here would take a second pool connection while this one holds the lock. */
  private async lockAndLoad(tx: TxClient, ids: string[]): Promise<Person[]> {
    const rows = await tx`select * from people where id in ${tx(ids)} order by id for update`;
    return this.hydrate(rows, tx);
  }

  async delete(id: string): Promise<boolean> {
    // ON DELETE CASCADE removes the child history rows.
    const rows = await this.sql`delete from people where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from people returning id`;
    // children cascade; for a hard reset prefer `truncate people cascade` (no count).
    return rows.length;
  }

  /** Reset logs (A-2, P3): presence reset and both history deletes in one transaction. The
   *  UPDATE runs first because its `exists` tests read the history rows the deletes remove. */
  async clearPresence(now: string): Promise<number> {
    return this.sql.begin(async (tx: TxClient) => {
      const touched = await tx`
        update people set
          at_camp = false,
          lifecycle = case when lifecycle in ('cancelled', 'registered') then lifecycle else 'registered' end,
          updated_at = ${now}
        where at_camp
           or exists (select 1 from check_in_history h where h.person_id = people.id)
           or exists (select 1 from sign_out_history s where s.person_id = people.id)
        returning id`;
      await tx`delete from check_in_history`;
      await tx`delete from sign_out_history`;
      return touched.length;
    });
  }
}

// ---------------------------------------------------------------------------
// Column maps + history replacement helpers
// ---------------------------------------------------------------------------

export function personColumns(p: Person): Record<string, unknown> {
  const id = p.id;
  return {
    id: p.id,
    first_name: p.firstName,
    last_name: p.lastName,
    gender: p.gender,
    date_of_birth: p.dateOfBirth ?? null,
    grade: p.grade ?? null,
    school: p.school ?? null,
    kind: p.kind,
    church_id: p.churchId === UNALLOCATED_CHURCH_ID ? null : (p.churchId ?? null),
    church_name: p.churchName,
    zone: p.zone,
    group_id: p.groupId ?? null,
    mobile: p.mobile ?? null,
    email: p.email ?? null,
    suburb: p.suburb ?? null,
    postcode: p.postcode ?? null,
    state: p.state ?? null,
    medical_conditions_enc: encArray(p.medicalConditions, 'medical_conditions', id),
    dietary_requirements_enc: encArray(p.dietaryRequirements, 'dietary_requirements', id),
    other_medications: maybeEncrypt(p.otherMedications ?? null, aad('other_medications', id)),
    medication_consent: maybeEncrypt(p.medicationConsent ?? null, aad('medication_consent', id)),
    medicare_number: maybeEncrypt(p.medicareNumber ?? null, aad('medicare_number', id)),
    church_unlisted_note: p.churchUnlistedNote ?? null,
    elvanto_meta: p.elvantoMeta ?? null,
    parent_guardian_name: maybeEncrypt(p.parentGuardianName ?? null, aad('parent_guardian_name', id)),
    parent_phone: maybeEncrypt(p.parentPhone ?? null, aad('parent_phone', id)),
    parent_relation: maybeEncrypt(p.parentRelation ?? null, aad('parent_relation', id)),
    blue_card_number: maybeEncrypt(p.blueCardNumber ?? null, aad('blue_card_number', id)),
    blue_card_expiry_enc: maybeEncrypt(p.blueCardExpiry ?? null, aad('blue_card_expiry', id)),
    consents_enc: maybeEncrypt(JSON.stringify(p.consents), aad('consents', id)),
    payment_status: p.paymentStatus,
    /* ⚠️ RAW, never p.accommodationKind — that field is the RESOLVED effective value and writing
       it back would bake an override into the importers' column, destroying what the CSV said.
       `undefined` = hand-built person (no mapper), so fall back. See Person.accommodationKindRaw. */
    accommodation_kind: (p.accommodationKindRaw !== undefined ? p.accommodationKindRaw : p.accommodationKind) ?? null,
    accommodation_override: p.accommodationOverride ?? null,
    amount_paid_override: p.amountPaidOverride ?? null,
    refund_amount: p.refundAmount ?? null,
    refunded_at: p.refundedAt ?? null,
    cancelled_at: p.cancelledAt ?? null,
    accommodation_label: p.accommodationLabel ?? null,
    registration_type: p.registrationType ?? null,
    registration_cost: p.registrationCost ?? null,
    discount_code: p.discountCode ?? null,
    ticket_number: p.ticketNumber ?? null,
    invoice_number: p.invoiceNumber ?? null,
    invoice_numbers: p.invoiceNumbers ?? null,
    /* ⚠️ Same write-back trap as accommodation_kind, on the sibling column. `toPerson` forces
       p.accommodationKindConfidence to 'confirmed' whenever an override is present, REGARDLESS
       of what is actually stored — so writing it straight back would overwrite a genuine
       'guessed'/null confidence with a fabricated 'confirmed' the moment ANY unrelated field on
       this person is saved. That corruption survives clearing the override (invoice-import's
       alreadyConfirmed gate would then wrongly treat the person as permanently confirmed). While
       an override is active the read path ignores this column entirely (it keys off
       accommodation_override), so writing null here is safe now and honest later. */
    accommodation_kind_confidence: p.accommodationOverride != null ? null : (p.accommodationKindConfidence ?? null),
    discount_amount: p.discountAmount ?? null,
    amount_paid: p.amountPaid ?? null,
    fees_amount: p.feesAmount ?? null,
    tax_amount: p.taxAmount ?? null,
    needs_review: p.needsReview ?? false,
    needs_review_reason: p.needsReviewReason ?? null,
    lifecycle: p.lifecycle,
    at_camp: p.atCamp,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// Columns updated on conflict: everything except id, created_at and presence (at_camp, lifecycle,
// cancelled_at — written only by transition/transitionMany/clearPresence, P3).
const PERSON_UPDATE_COLS = [
  'first_name', 'last_name', 'gender', 'date_of_birth', 'grade', 'school', 'kind',
  'church_id', 'church_name', 'zone', 'group_id', 'mobile', 'email', 'suburb',
  'postcode', 'state', 'medical_conditions_enc', 'dietary_requirements_enc', 'other_medications',
  'medication_consent',
  'parent_guardian_name', 'parent_phone', 'parent_relation', 'blue_card_number',
  'blue_card_expiry_enc', 'consents_enc', 'payment_status', 'accommodation_kind',
  'accommodation_label', 'registration_type', 'registration_cost', 'discount_code',
  'updated_at',
  // Pre-existing bug fix (unrelated to this change): these three columns were being
  // written on insert but never updated on conflict, so edits to them silently never
  // persisted on save/saveMany.
  'elvanto_meta', 'medicare_number', 'church_unlisted_note',
  // Ticket List / Invoice import fields (017).
  'ticket_number', 'invoice_number', 'accommodation_kind_confidence', 'discount_amount',
  'amount_paid', 'fees_amount', 'tax_amount', 'needs_review', 'needs_review_reason',
  // Individual overrides + cancel/refund (0022). Never written by any importer.
  // `cancelled_at` left this set in P3: cancel/uncancel write it through `transition`.
  'accommodation_override', 'amount_paid_override', 'refund_amount', 'refunded_at',
  // Every invoice number seen for this person (0023).
  'invoice_numbers',
] as const;


/** Insert-or-update one person. History rows only on a real INSERT (`xmax = 0` is true for a
 *  freshly inserted row, false for one the ON CONFLICT branch updated). */
async function upsertPerson(tx: TxClient, p: Person): Promise<void> {
  const [r] = await tx`
    insert into people ${tx(personColumns(p))}
    on conflict (id) do update set ${tx(personColumns(p), ...PERSON_UPDATE_COLS)}
    returning (xmax = 0) as inserted
  `;
  if (r?.['inserted'] === true) await appendHistories(tx, p);
}

/** Write a decided presence change on an already-locked row. Null = no-op, nothing written. */
async function writePresence(tx: TxClient, current: Person, w: PresenceWrite | null): Promise<Person> {
  if (!w) return current;
  const set: Record<string, unknown> = { at_camp: w.atCamp, lifecycle: w.lifecycle, updated_at: w.updatedAt };
  if (w.cancelledAt !== undefined) set['cancelled_at'] = w.cancelledAt;
  await tx`update people set ${tx(set)} where id = ${current.id}`;
  await appendHistories(tx, {
    ...current,
    checkInHistory: w.appendCheckIn ? [w.appendCheckIn] : [],
    signOutHistory: w.appendSignEvent ? [w.appendSignEvent] : [],
  });
  return withPresenceWrite(current, w);
}

/**
 * Append a person's history child rows additively (INSERT … ON CONFLICT DO NOTHING).
 *
 * History entries are immutable, append-only audit events: ids are unique (both child
 * tables have `id text primary key`), a row is never edited after creation, and no
 * domain flow removes an individual entry — entries only disappear when the person row
 * itself is deleted (ON DELETE CASCADE), on reset/new-year (deleteAll), or all at once on
 * Reset logs (clearPresence). Called on an INSERT and by writePresence, never on an UPDATE save.
 *
 * This used to DELETE-then-reinsert the whole history from the in-memory copy, which
 * meant two concurrent writers to the same person could silently drop an entry the
 * other had just appended (lost update on a check-in/sign-out audit record). Inserting
 * only rows that don't already exist keeps concurrently appended entries intact.
 */
async function appendHistories(tx: TxClient, p: Person): Promise<void> {
  if (p.checkInHistory.length > 0) {
    /* B-5: two taps on one person+session at once (a queue re-drain while a request is in
       flight) each carry a fresh `newId('ci')`, so `on conflict (id)` can't dedupe them. A row
       is inserted only if the LAST stored row for its (person, session) is not the same type —
       the presence module's checkIn N5 rule (presence.ts), enforced in SQL. Atomic because the caller holds the people row lock
       (INSERT, or S2 `for update`); `h.id desc` breaks an exact-ms tie the way hydrate's
       `order by timestamp, id` does: the second tap's transaction waits there until the first
       commits, and under READ COMMITTED this later statement then sees the first tap's row.
       No refusal (the tap still answers 200) and the timestamp stays server time (Q9).
       Sign-out history stays unconditional (OQ-33). */
    const rows = p.checkInHistory.map((e) => ({
      id: e.id,
      person_id: p.id,
      session_id: e.sessionId,
      session_label: e.sessionLabel,
      type: e.type,
      leader_id: e.leaderId,
      timestamp: e.timestamp,
    }));
    await tx`
      insert into check_in_history (id, person_id, session_id, session_label, type, leader_id, "timestamp")
      select v.id, v.person_id, v.session_id, v.session_label, v.type, v.leader_id, v."timestamp"
      from jsonb_to_recordset(${tx.json(rows)}) as v(
        id text, person_id text, session_id text, session_label text, type text, leader_id text, "timestamp" timestamptz
      )
      where (
        select h.type from check_in_history h
        where h.person_id = v.person_id and h.session_id = v.session_id
        order by h."timestamp" desc, h.id desc limit 1
      ) is distinct from v.type
      on conflict (id) do nothing`;
  }
  if (p.signOutHistory.length > 0) {
    await tx`insert into sign_out_history ${tx(
      p.signOutHistory.map((e) => ({
        id: e.id,
        person_id: p.id,
        type: e.type,
        leader_name: e.leaderName,
        reason: e.reason ?? null,
        author_id: e.authorId,
        timestamp: e.timestamp,
      })),
    )} on conflict (id) do nothing`;
  }
}
