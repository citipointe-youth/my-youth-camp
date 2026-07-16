# Field Encryption at Rest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt sensitive `people` and `notes` columns at rest with AES-256-GCM so raw DB access (incl. Supabase staff) reveals only ciphertext, while services/exports keep seeing plaintext unchanged.

**Architecture:** A pure `node:crypto` codec (`src/utils/field-crypto.ts`) is called *only inside the Supabase row↔entity mappers* (`supabase.people.ts`, `supabase.notes.ts`). Reads decrypt-or-passthrough (tolerating legacy plaintext); writes always encrypt. `text[]`/`jsonb`/`date` fields move to new `*_enc text` columns; `text` scalars are encrypted in place. `memory`/`json` dev modes are untouched (plaintext).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node 22, `node:crypto`, `postgres` (porsager), vitest, `tsx`. Supabase Postgres in prod (`PERSISTENCE=supabase`, ref `nwfafrgojqkxylbppywo`).

**Spec:** `docs/superpowers/specs/2026-07-16-field-encryption-design.md`

## Global Constraints

- **CommonJS emit stays** (`tsconfig`: `module: CommonJS`) — do not change it. ESM import *syntax* in source, extensionless imports, one `index.ts` barrel per folder.
- **Strict TS:** `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`. Guard every indexed access (`x!` or a null check).
- **Verify with `npm run typecheck` + `npm run test` + reasoning only.** Do NOT start a dev server or drive a browser. This work is backend-only — do **not** touch `public/index.html` or bump `sw.js`.
- **Encrypted fields (final scope):** `people`: `medical_conditions`, `dietary_requirements`, `other_medications`, `medicare_number`, `blue_card_number`, `blue_card_expiry`, `parent_guardian_name`, `parent_phone`, `parent_relation`, `consents`; `notes`: `body`. Nothing else.
- **Null preservation is load-bearing:** `null`/`undefined`/`''`/`[]` must round-trip to the same empty value (never stored as ciphertext). `blueCardNumber == null` and `otherMedications != null` drive real logic.
- **Envelope format:** `v1.<keyId>.<iv_b64url>.<tag_b64url>.<ct_b64url>`. The `v1.` prefix is the "already encrypted?" test → idempotent backfill + mixed-state reads.
- **AAD:** every ciphertext is bound to `"<table>:<column>:<id>"`.
- **Migrations apply to prod BEFORE the code that uses the new columns deploys** (same discipline as `018`/`020`). Sequencing is in the Deployment Runbook at the end — tasks build in order but prod steps are operator-gated.
- **Key env vars:** `FIELD_ENCRYPTION_KEY` (base64, 32 bytes, active) + optional `FIELD_ENCRYPTION_KEY_ID` (default `k1`); `FIELD_ENCRYPTION_KEY_PREV` + `FIELD_ENCRYPTION_KEY_PREV_ID` (default `k0`) for decrypt during rotation. (This `_PREV` naming supersedes the spec's `_NEXT` wording — active key encrypts, prev key only decrypts.)

---

## File Structure

- **Create** `src/utils/field-crypto.ts` — the pure codec (encrypt/decrypt/isEncrypted/maybeEncrypt/maybeDecrypt).
- **Create** `src/utils/field-crypto.test.ts` — codec unit tests.
- **Modify** `src/utils/index.ts` — barrel export the codec.
- **Modify** `src/config/env.ts` — document the new env vars (comment only; codec reads `process.env` directly).
- **Modify** `src/repositories/supabase/supabase.people.ts` — encrypt/decrypt in `toPerson`/`personColumns`; export both for tests.
- **Create** `src/repositories/supabase/supabase.people.mapper.test.ts` — mapper round-trip tests.
- **Modify** `src/repositories/supabase/supabase.notes.ts` — encrypt/decrypt `body`; extract + export `noteColumns`.
- **Create** `src/repositories/supabase/supabase.notes.mapper.test.ts` — note mapper round-trip tests.
- **Create** `supabase/migrations/022_field_encryption_columns.sql` — add `*_enc` columns.
- **Create** `supabase/migrations/023_field_encryption_drop_legacy.sql` — drop legacy columns.
- **Create** `scripts/backfill-field-encryption.ts` — one-off prod backfill.
- **Modify** `SECURITY-ACTIONS.md`, `debug.md`, `CLAUDE.md`, `CHANGELOG.txt` — docs.

---

### Task 1: Crypto codec (`field-crypto.ts`)

**Files:**
- Create: `src/utils/field-crypto.ts`
- Test: `src/utils/field-crypto.test.ts`
- Modify: `src/utils/index.ts` (add `export * from './field-crypto';`)
- Modify: `src/config/env.ts` (doc comment for the new env vars)

**Interfaces:**
- Produces:
  - `isEncrypted(value: unknown): value is string`
  - `encryptField(plaintext: string, aad: string): string`
  - `decryptField(envelope: string, aad: string): string`
  - `maybeEncrypt(value: string | null | undefined, aad: string): string | null`
  - `maybeDecrypt(value: string | null | undefined, aad: string): string | null`

- [ ] **Step 1: Write the failing test** — `src/utils/field-crypto.test.ts`

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import {
  isEncrypted, encryptField, decryptField, maybeEncrypt, maybeDecrypt,
} from './field-crypto';

// Deterministic 32-byte keys for the test process.
const KEY = Buffer.alloc(32, 1).toString('base64');
const KEY2 = Buffer.alloc(32, 2).toString('base64');

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = KEY;
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

describe('field-crypto', () => {
  it('round-trips a value under matching AAD', () => {
    const ct = encryptField('Asthma; peanut allergy', 'people:other_medications:p_1');
    expect(isEncrypted(ct)).toBe(true);
    expect(ct.startsWith('v1.k1.')).toBe(true);
    expect(decryptField(ct, 'people:other_medications:p_1')).toBe('Asthma; peanut allergy');
  });

  it('produces a fresh IV each call (ciphertexts differ)', () => {
    const a = encryptField('x', 'people:medicare_number:p_1');
    const b = encryptField('x', 'people:medicare_number:p_1');
    expect(a).not.toBe(b);
  });

  it('rejects decryption under the wrong AAD (bound to row+column)', () => {
    const ct = encryptField('secret', 'people:medicare_number:p_1');
    expect(() => decryptField(ct, 'people:medicare_number:p_2')).toThrow();
  });

  it('rejects a tampered ciphertext (auth tag fails)', () => {
    const ct = encryptField('secret', 'notes:body:n_1');
    const parts = ct.split('.');
    const flipped = parts[4]!.slice(0, -2) + (parts[4]!.endsWith('A') ? 'B' : 'A');
    const bad = [parts[0], parts[1], parts[2], parts[3], flipped].join('.');
    expect(() => decryptField(bad, 'notes:body:n_1')).toThrow();
  });

  it('maybeEncrypt passes null/empty through as null', () => {
    expect(maybeEncrypt(null, 'a')).toBeNull();
    expect(maybeEncrypt(undefined, 'a')).toBeNull();
    expect(maybeEncrypt('', 'a')).toBeNull();
  });

  it('maybeDecrypt passes null and legacy plaintext through unchanged', () => {
    expect(maybeDecrypt(null, 'a')).toBeNull();
    expect(maybeDecrypt('plain legacy value', 'a')).toBe('plain legacy value');
  });

  it('decrypts ciphertext written under a now-PREV key', () => {
    // Simulate rotation: value encrypted under k1, then k2 becomes active and k1 becomes prev.
    const ct = encryptField('rotate me', 'people:parent_phone:p_9');
    process.env['FIELD_ENCRYPTION_KEY'] = KEY2;
    process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k2';
    process.env['FIELD_ENCRYPTION_KEY_PREV'] = KEY;
    process.env['FIELD_ENCRYPTION_KEY_PREV_ID'] = 'k1';
    expect(decryptField(ct, 'people:parent_phone:p_9')).toBe('rotate me');
    // restore active for later tests
    process.env['FIELD_ENCRYPTION_KEY'] = KEY;
    process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
    delete process.env['FIELD_ENCRYPTION_KEY_PREV'];
    delete process.env['FIELD_ENCRYPTION_KEY_PREV_ID'];
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/field-crypto.test.ts`
Expected: FAIL — cannot resolve `./field-crypto`.

- [ ] **Step 3: Write the implementation** — `src/utils/field-crypto.ts`

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Self-describing envelope: "v1.<keyId>.<iv>.<tag>.<ct>" (each part base64url, unpadded).
// The "v1." prefix is the "is this already encrypted?" test — it keeps the backfill
// idempotent and lets reads tolerate a table that is any mix of plaintext + ciphertext.
const VERSION = 'v1';
const IV_LEN = 12; // 96-bit GCM nonce (standard, most efficient)
const KEY_LEN = 32; // AES-256

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeKey(b64: string, id: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_LEN) {
    throw new Error(`FIELD_ENCRYPTION key '${id}' must decode to ${KEY_LEN} bytes; got ${key.length}`);
  }
  return key;
}

function activeKeyId(): string {
  return process.env['FIELD_ENCRYPTION_KEY_ID'] || 'k1';
}

/** Build the id→key map fresh from the environment on each call (cheap; keeps tests trivial). */
function keyMap(): Map<string, Buffer> {
  const m = new Map<string, Buffer>();
  const active = process.env['FIELD_ENCRYPTION_KEY'];
  if (active) m.set(activeKeyId(), decodeKey(active, activeKeyId()));
  const prev = process.env['FIELD_ENCRYPTION_KEY_PREV'];
  if (prev) {
    const prevId = process.env['FIELD_ENCRYPTION_KEY_PREV_ID'] || 'k0';
    m.set(prevId, decodeKey(prev, prevId));
  }
  if (m.size === 0) {
    throw new Error('FIELD_ENCRYPTION_KEY is required to encrypt/decrypt sensitive fields');
  }
  return m;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(VERSION + '.');
}

export function encryptField(plaintext: string, aad: string): string {
  const id = activeKeyId();
  const key = keyMap().get(id);
  if (!key) throw new Error(`field-crypto: no active key for id '${id}'`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, id, b64url(iv), b64url(tag), b64url(ct)].join('.');
}

export function decryptField(envelope: string, aad: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('field-crypto: malformed ciphertext envelope');
  }
  const id = parts[1]!;
  const key = keyMap().get(id);
  if (!key) throw new Error(`field-crypto: no key for id '${id}'`);
  const decipher = createDecipheriv('aes-256-gcm', key, fromB64url(parts[2]!));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(fromB64url(parts[3]!));
  return Buffer.concat([decipher.update(fromB64url(parts[4]!)), decipher.final()]).toString('utf8');
}

/** Encrypt a nullable scalar. null/undefined/'' → null (never stored as ciphertext). */
export function maybeEncrypt(value: string | null | undefined, aad: string): string | null {
  if (value == null || value === '') return null;
  return encryptField(value, aad);
}

/** Decrypt a value that may be ciphertext, legacy plaintext, or null. */
export function maybeDecrypt(value: string | null | undefined, aad: string): string | null {
  if (value == null) return null;
  if (!isEncrypted(value)) return value; // legacy plaintext passthrough (rollout tolerance)
  return decryptField(value, aad);
}
```

- [ ] **Step 4: Add the barrel export** — append to `src/utils/index.ts`

```ts
export * from './field-crypto';
```

- [ ] **Step 5: Document the env vars** — add this comment block above the closing `} as const;` in `src/config/env.ts` (do NOT add parsing; the codec reads `process.env` directly, like `SESSION_SECRET`)

```ts
  // Field-level encryption (read directly from process.env by src/utils/field-crypto.ts):
  //   FIELD_ENCRYPTION_KEY       base64 of a 32-byte key — REQUIRED when PERSISTENCE=supabase
  //   FIELD_ENCRYPTION_KEY_ID    label for the active key (default 'k1')
  //   FIELD_ENCRYPTION_KEY_PREV / _PREV_ID   previous key, decrypt-only, during rotation
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/utils/field-crypto.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean (no output, exit 0).

- [ ] **Step 8: Commit**

```bash
git add src/utils/field-crypto.ts src/utils/field-crypto.test.ts src/utils/index.ts src/config/env.ts
git commit -m "feat(crypto): AES-256-GCM field codec for at-rest encryption"
```

---

### Task 2: Migration — add `*_enc` columns (`022`)

**Files:**
- Create: `supabase/migrations/022_field_encryption_columns.sql`

**Interfaces:**
- Produces: `people.medical_conditions_enc`, `people.dietary_requirements_enc`, `people.consents_enc`, `people.blue_card_expiry_enc` (all `text`, nullable). Consumed by Task 3's mapper.

> No test cycle — a DDL file. It is verified by Task 3's mapper tests (which exercise the `_enc` column names) and applied to prod per the Deployment Runbook.

- [ ] **Step 1: Write the migration** — `supabase/migrations/022_field_encryption_columns.sql`

```sql
-- 022: Application-level field encryption — add ciphertext columns.
--
-- text[]/jsonb/date fields cannot hold a single ciphertext string in place, so they
-- move to new nullable text columns. The app (supabase.people.ts) writes ciphertext
-- here and reads it back, preferring *_enc and falling back to the legacy column until
-- the backfill completes. The legacy columns are dropped in 023 after backfill.
--
-- Scalar text fields (other_medications, medicare_number, blue_card_number, parent_*,
-- notes.body) are encrypted IN PLACE — no column change needed.
--
-- APPLY TO PROD BEFORE the mapper code that references these columns deploys.
alter table people
  add column if not exists medical_conditions_enc  text,
  add column if not exists dietary_requirements_enc text,
  add column if not exists consents_enc            text,
  add column if not exists blue_card_expiry_enc     text;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/022_field_encryption_columns.sql
git commit -m "feat(db): 022 add field-encryption ciphertext columns"
```

---

### Task 3: People mapper — encrypt/decrypt

**Files:**
- Modify: `src/repositories/supabase/supabase.people.ts`
- Test: `src/repositories/supabase/supabase.people.mapper.test.ts`

**Interfaces:**
- Consumes: `maybeEncrypt`, `maybeDecrypt` from Task 1; the `*_enc` columns from Task 2.
- Produces: `export function toPerson(row, checkIns, signOuts): Person` and `export function personColumns(p: Person): Record<string, unknown>` (both made exportable for tests). Write output puts ciphertext in `*_enc` (arrays/jsonb/date) and in the scalar columns; omits the four legacy columns.

- [ ] **Step 1: Write the failing test** — `src/repositories/supabase/supabase.people.mapper.test.ts`

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toPerson, personColumns } from './supabase.people';
import type { Person } from '../../core/entities/person';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function samplePerson(): Person {
  return {
    id: 'p_enc1',
    firstName: 'Ivy', lastName: 'Sample', gender: 'female',
    dateOfBirth: '2010-05-01', grade: 9, school: null, kind: 'youth',
    churchId: 'ch_1', churchName: 'Sample Church', zone: 'Blue', groupId: null,
    mobile: '0400000000', email: null, suburb: null, postcode: null, state: null,
    medicalConditions: ['Asthma', 'Peanut allergy'],
    dietaryRequirements: ['Vegetarian'],
    otherMedications: 'Ventolin PRN',
    medicareNumber: '1234567890',
    churchUnlistedNote: null,
    parentGuardianName: 'Robin Sample', parentPhone: '0411111111', parentRelation: 'Parent',
    blueCardNumber: 'BC-123', blueCardExpiry: '2027-01-01',
    consents: {
      medical: { granted: true, timestamp: '2026-01-01T00:00:00.000Z' },
      media: { granted: false, timestamp: null },
      supervision: { granted: true, timestamp: '2026-01-01T00:00:00.000Z' },
    },
    paymentStatus: 'paid', accommodationKind: 'tent', accommodationLabel: null,
    registrationType: null, registrationCost: null, discountCode: null,
    ticketNumber: null, invoiceNumber: null, accommodationKindConfidence: null,
    discountAmount: null, amountPaid: null, feesAmount: null, taxAmount: null,
    needsReview: false, needsReviewReason: null,
    lifecycle: 'registered', atCamp: false,
    checkInHistory: [], signOutHistory: [],
    elvantoMeta: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('people mapper encryption', () => {
  it('writes ciphertext to *_enc and scalar columns, omits legacy columns', () => {
    const cols = personColumns(samplePerson());
    // arrays/jsonb/date → *_enc ciphertext
    expect(String(cols['medical_conditions_enc']).startsWith('v1.')).toBe(true);
    expect(String(cols['dietary_requirements_enc']).startsWith('v1.')).toBe(true);
    expect(String(cols['consents_enc']).startsWith('v1.')).toBe(true);
    expect(String(cols['blue_card_expiry_enc']).startsWith('v1.')).toBe(true);
    // scalars encrypted in place
    expect(String(cols['other_medications']).startsWith('v1.')).toBe(true);
    expect(String(cols['medicare_number']).startsWith('v1.')).toBe(true);
    expect(String(cols['blue_card_number']).startsWith('v1.')).toBe(true);
    expect(String(cols['parent_guardian_name']).startsWith('v1.')).toBe(true);
    expect(String(cols['parent_phone']).startsWith('v1.')).toBe(true);
    expect(String(cols['parent_relation']).startsWith('v1.')).toBe(true);
    // legacy array/jsonb/date columns are no longer written
    expect('medical_conditions' in cols).toBe(false);
    expect('dietary_requirements' in cols).toBe(false);
    expect('consents' in cols).toBe(false);
    expect('blue_card_expiry' in cols).toBe(false);
    // non-sensitive column untouched
    expect(cols['first_name']).toBe('Ivy');
  });

  it('round-trips through toPerson (ciphertext → plaintext entity)', () => {
    const cols = personColumns(samplePerson());
    // Simulate the DB handing the same row back (timestamps come back as Date objects).
    const row = { ...cols, created_at: new Date(cols['created_at'] as string), updated_at: new Date(cols['updated_at'] as string) };
    const p = toPerson(row, [], []);
    expect(p.medicalConditions).toEqual(['Asthma', 'Peanut allergy']);
    expect(p.dietaryRequirements).toEqual(['Vegetarian']);
    expect(p.otherMedications).toBe('Ventolin PRN');
    expect(p.medicareNumber).toBe('1234567890');
    expect(p.blueCardNumber).toBe('BC-123');
    expect(p.blueCardExpiry).toBe('2027-01-01');
    expect(p.parentGuardianName).toBe('Robin Sample');
    expect(p.parentPhone).toBe('0411111111');
    expect(p.parentRelation).toBe('Parent');
    expect(p.consents.medical.granted).toBe(true);
  });

  it('preserves null / empty (never stores ciphertext for them)', () => {
    const p = samplePerson();
    p.otherMedications = null; p.blueCardNumber = null; p.blueCardExpiry = null;
    p.medicalConditions = []; p.dietaryRequirements = [];
    const cols = personColumns(p);
    expect(cols['other_medications']).toBeNull();
    expect(cols['blue_card_number']).toBeNull();
    expect(cols['blue_card_expiry_enc']).toBeNull();
    expect(cols['medical_conditions_enc']).toBeNull();
    const row = { ...cols, created_at: new Date(cols['created_at'] as string), updated_at: new Date(cols['updated_at'] as string) };
    const back = toPerson(row, [], []);
    expect(back.otherMedications).toBeNull();
    expect(back.blueCardNumber).toBeNull();
    expect(back.blueCardExpiry).toBeNull();
    expect(back.medicalConditions).toEqual([]);
  });

  it('reads legacy plaintext rows when *_enc is absent (rollout tolerance)', () => {
    const legacyRow: Record<string, unknown> = {
      id: 'p_legacy', first_name: 'Old', last_name: 'Row', gender: 'male',
      date_of_birth: null, grade: null, school: null, kind: 'youth',
      church_id: 'ch_1', church_name: 'C', zone: 'Blue', group_id: null,
      mobile: null, email: null, suburb: null, postcode: null, state: null,
      // legacy plaintext, no *_enc columns present:
      medical_conditions: ['Diabetes'], dietary_requirements: [],
      other_medications: 'Insulin', medicare_number: '999',
      church_unlisted_note: null, elvanto_meta: null,
      parent_guardian_name: 'Pat', parent_phone: '0400', parent_relation: 'Parent',
      blue_card_number: 'BC-legacy', blue_card_expiry: '2028-02-02',
      consents: { medical: { granted: true, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
      payment_status: 'unpaid', accommodation_kind: null, accommodation_label: null,
      registration_type: null, registration_cost: null, discount_code: null,
      ticket_number: null, invoice_number: null, accommodation_kind_confidence: null,
      discount_amount: null, amount_paid: null, fees_amount: null, tax_amount: null,
      needs_review: false, needs_review_reason: null,
      lifecycle: 'registered', at_camp: false,
      created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const p = toPerson(legacyRow, [], []);
    expect(p.medicalConditions).toEqual(['Diabetes']);
    expect(p.otherMedications).toBe('Insulin');
    expect(p.blueCardNumber).toBe('BC-legacy');
    expect(p.blueCardExpiry).toBe('2028-02-02');
    expect(p.consents.medical.granted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/repositories/supabase/supabase.people.mapper.test.ts`
Expected: FAIL — `toPerson`/`personColumns` are not exported.

- [ ] **Step 3: Add the codec import + AAD/field helpers** near the top of `src/repositories/supabase/supabase.people.ts`, directly after the existing `import { isCamper } ...` line

```ts
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
```

- [ ] **Step 4: Export the mappers and decrypt fields in `toPerson`.** Change the signature to `export function toPerson(...)`, add `const id = row['id'] as string;` as the first line of its body, then replace exactly these lines inside the returned object:

Replace:
```ts
    medicalConditions: (row['medical_conditions'] as string[] | null) ?? [],
    dietaryRequirements: (row['dietary_requirements'] as string[] | null) ?? [],
    otherMedications: (row['other_medications'] as string | null) ?? null,
    medicareNumber: (row['medicare_number'] as string | null) ?? null,
```
with:
```ts
    medicalConditions: readEncArray(row, 'medical_conditions', id),
    dietaryRequirements: readEncArray(row, 'dietary_requirements', id),
    otherMedications: maybeDecrypt(row['other_medications'] as string | null, aad('other_medications', id)),
    medicareNumber: maybeDecrypt(row['medicare_number'] as string | null, aad('medicare_number', id)),
```

Replace:
```ts
    parentGuardianName: (row['parent_guardian_name'] as string | null) ?? null,
    parentPhone: (row['parent_phone'] as string | null) ?? null,
    parentRelation: (row['parent_relation'] as string | null) ?? null,
    blueCardNumber: (row['blue_card_number'] as string | null) ?? null,
    blueCardExpiry: dateOnly(row['blue_card_expiry']),
    consents: (row['consents'] as Person['consents']) ?? {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
```
with:
```ts
    parentGuardianName: maybeDecrypt(row['parent_guardian_name'] as string | null, aad('parent_guardian_name', id)),
    parentPhone: maybeDecrypt(row['parent_phone'] as string | null, aad('parent_phone', id)),
    parentRelation: maybeDecrypt(row['parent_relation'] as string | null, aad('parent_relation', id)),
    blueCardNumber: maybeDecrypt(row['blue_card_number'] as string | null, aad('blue_card_number', id)),
    blueCardExpiry: readEncDate(row, 'blue_card_expiry', id),
    consents: readEncConsents(row, id),
```

- [ ] **Step 5: Encrypt fields in `personColumns`.** Change the signature to `export function personColumns(p: Person): Record<string, unknown>`, add `const id = p.id;` as the first line of its body, then:

Replace:
```ts
    medical_conditions: p.medicalConditions,
    dietary_requirements: p.dietaryRequirements,
    other_medications: p.otherMedications ?? null,
    medicare_number: p.medicareNumber ?? null,
```
with:
```ts
    medical_conditions_enc: encArray(p.medicalConditions, 'medical_conditions', id),
    dietary_requirements_enc: encArray(p.dietaryRequirements, 'dietary_requirements', id),
    other_medications: maybeEncrypt(p.otherMedications ?? null, aad('other_medications', id)),
    medicare_number: maybeEncrypt(p.medicareNumber ?? null, aad('medicare_number', id)),
```

Replace:
```ts
    parent_guardian_name: p.parentGuardianName ?? null,
    parent_phone: p.parentPhone ?? null,
    parent_relation: p.parentRelation ?? null,
    blue_card_number: p.blueCardNumber ?? null,
    blue_card_expiry: p.blueCardExpiry ?? null,
    consents: p.consents,
```
with:
```ts
    parent_guardian_name: maybeEncrypt(p.parentGuardianName ?? null, aad('parent_guardian_name', id)),
    parent_phone: maybeEncrypt(p.parentPhone ?? null, aad('parent_phone', id)),
    parent_relation: maybeEncrypt(p.parentRelation ?? null, aad('parent_relation', id)),
    blue_card_number: maybeEncrypt(p.blueCardNumber ?? null, aad('blue_card_number', id)),
    blue_card_expiry_enc: maybeEncrypt(p.blueCardExpiry ?? null, aad('blue_card_expiry', id)),
    consents_enc: maybeEncrypt(JSON.stringify(p.consents), aad('consents', id)),
```

> Note: the four legacy columns (`medical_conditions`, `dietary_requirements`, `blue_card_expiry`, `consents`) are now **omitted** from the insert map — new INSERTs get their column DEFAULT (`'{}'` / NULL), so stale plaintext is never written by the app again.

- [ ] **Step 6: Update `PERSON_UPDATE_COLS`.** Replace the whole array with (removes the 4 legacy names, adds the 4 `_enc` names):

```ts
const PERSON_UPDATE_COLS = [
  'first_name', 'last_name', 'gender', 'date_of_birth', 'grade', 'school', 'kind',
  'church_id', 'church_name', 'zone', 'group_id', 'mobile', 'email', 'suburb',
  'postcode', 'state', 'medical_conditions_enc', 'dietary_requirements_enc', 'other_medications',
  'parent_guardian_name', 'parent_phone', 'parent_relation', 'blue_card_number',
  'blue_card_expiry_enc', 'consents_enc', 'payment_status', 'accommodation_kind',
  'accommodation_label', 'registration_type', 'registration_cost', 'discount_code',
  'lifecycle', 'at_camp', 'updated_at',
  'elvanto_meta', 'medicare_number', 'church_unlisted_note',
  'ticket_number', 'invoice_number', 'accommodation_kind_confidence', 'discount_amount',
  'amount_paid', 'fees_amount', 'tax_amount', 'needs_review', 'needs_review_reason',
] as const;
```

- [ ] **Step 7: Run the mapper tests to verify they pass**

Run: `npx vitest run src/repositories/supabase/supabase.people.mapper.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/repositories/supabase/supabase.people.ts src/repositories/supabase/supabase.people.mapper.test.ts
git commit -m "feat(repo): encrypt sensitive people columns in the Supabase mapper"
```

---

### Task 4: Notes mapper — encrypt `body`

**Files:**
- Modify: `src/repositories/supabase/supabase.notes.ts`
- Test: `src/repositories/supabase/supabase.notes.mapper.test.ts`

**Interfaces:**
- Consumes: `encryptField`, `maybeDecrypt` from Task 1.
- Produces: `export function toNote(r): StudentNote` (already module-local — add `export`) and a new `export function noteColumns(note: StudentNote): Record<string, unknown>` used by `save`. `body` is ciphertext on the wire (`aad = "notes:body:<id>"`), non-empty always encrypted, `''` stored as `''`.

- [ ] **Step 1: Write the failing test** — `src/repositories/supabase/supabase.notes.mapper.test.ts`

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toNote, noteColumns } from './supabase.notes';
import type { StudentNote } from '../../core/entities/note';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function sampleNote(): StudentNote {
  return {
    id: 'n_1', camperId: 'p_1', body: 'Pastoral: struggling with anxiety, prayed together.',
    authorId: 'u_1', authorName: 'Leader', authorChurchId: 'ch_1', sessionId: null,
    category: 'testimony', sensitive: true, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('notes mapper encryption', () => {
  it('encrypts body on write', () => {
    const cols = noteColumns(sampleNote());
    expect(String(cols['body']).startsWith('v1.')).toBe(true);
    expect(cols['category']).toBe('testimony'); // non-sensitive column untouched
  });

  it('round-trips body through toNote', () => {
    const cols = noteColumns(sampleNote());
    const row = { ...cols, created_at: new Date(cols['created_at'] as string) };
    const n = toNote(row);
    expect(n.body).toBe('Pastoral: struggling with anxiety, prayed together.');
    expect(n.sensitive).toBe(true);
  });

  it('reads a legacy plaintext body (rollout tolerance)', () => {
    const row: Record<string, unknown> = {
      id: 'n_legacy', camper_id: 'p_1', body: 'legacy plaintext note',
      author_id: 'u_1', author_name: 'L', author_church_id: null, session_id: null,
      category: 'note', sensitive: false, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toNote(row).body).toBe('legacy plaintext note');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/repositories/supabase/supabase.notes.mapper.test.ts`
Expected: FAIL — `toNote`/`noteColumns` not exported.

- [ ] **Step 3: Add the import** at the top of `src/repositories/supabase/supabase.notes.ts`

```ts
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';
```

- [ ] **Step 4: Export `toNote` and decrypt `body`.** Change `function toNote(...)` to `export function toNote(...)` and replace the `body` line:

Replace:
```ts
    body: r['body'] as string,
```
with:
```ts
    body: maybeDecrypt(r['body'] as string, `notes:body:${r['id'] as string}`) ?? '',
```

- [ ] **Step 5: Extract + export `noteColumns` and use it in `save`.** Add this function above the class:

```ts
export function noteColumns(note: StudentNote): Record<string, unknown> {
  return {
    id: note.id,
    camper_id: note.camperId ?? null,
    // body is `not null`; encrypt when present, keep '' as '' (never null).
    body: note.body ? encryptField(note.body, `notes:body:${note.id}`) : note.body,
    author_id: note.authorId,
    author_name: note.authorName,
    author_church_id: note.authorChurchId ?? null,
    session_id: note.sessionId ?? null,
    category: note.category ?? null,
    sensitive: note.sensitive ?? false,
    created_at: note.createdAt,
  };
}
```

Then replace the body of `save` with:
```ts
  async save(note: StudentNote): Promise<StudentNote> {
    await this.sql`
      insert into notes ${this.sql(noteColumns(note))}
      on conflict (id) do update set body = excluded.body, category = excluded.category, sensitive = excluded.sensitive
    `;
    return note;
  }
```

(`excluded.body` is the already-encrypted inserted value, so the upsert stays correct.)

- [ ] **Step 6: Run the note mapper tests**

Run: `npx vitest run src/repositories/supabase/supabase.notes.mapper.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Full suite + typecheck (regression gate).** The existing ~465 tests run in `memory` mode and never touch the codec — they must stay green, proving services are oblivious to encryption.

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; all tests pass (existing count + the new codec/mapper tests).

- [ ] **Step 8: Commit**

```bash
git add src/repositories/supabase/supabase.notes.ts src/repositories/supabase/supabase.notes.mapper.test.ts
git commit -m "feat(repo): encrypt note body in the Supabase mapper"
```

---

### Task 5: Backfill script

**Files:**
- Create: `scripts/backfill-field-encryption.ts`

**Interfaces:**
- Consumes: `buildContainer` from `src/container` (encryption-aware repos). Reuses `people.findAll/saveMany` and `notes.findAll/saveMany`.
- Produces: an idempotent, resumable, order-independent prod backfill (a "load all, save all" through the encryption-aware repo — reads tolerate mixed state, saves emit ciphertext to `*_enc`/scalar columns). Re-running only re-encrypts; correctness is unaffected.

> This script runs against **prod** by the operator (see Deployment Runbook), not in a unit test — its encryption logic is already covered by Tasks 1/3/4. Keep it thin and obvious.

- [ ] **Step 1: Write the script** — `scripts/backfill-field-encryption.ts`

```ts
/**
 * One-off backfill: re-save every person + note through the encryption-aware Supabase
 * repos so all sensitive fields become ciphertext. Idempotent (already-encrypted values
 * decrypt then re-encrypt to the same plaintext), resumable (re-run after any interruption),
 * order-independent (keyed by id). updated_at is preserved (personColumns writes the
 * existing value, not now()).
 *
 * Run (bash):
 *   PERSISTENCE=supabase DATABASE_URL='<pooler url>' \
 *     FIELD_ENCRYPTION_KEY='<base64 32 bytes>' \
 *     npx tsx scripts/backfill-field-encryption.ts
 *
 * Run (PowerShell):
 *   $env:PERSISTENCE='supabase'; $env:DATABASE_URL='<pooler url>';
 *   $env:FIELD_ENCRYPTION_KEY='<base64 32 bytes>';
 *   npx tsx scripts/backfill-field-encryption.ts
 */
import { buildContainer } from '../src/container';

const BATCH = 200;

async function main(): Promise<void> {
  if (process.env['PERSISTENCE'] !== 'supabase') {
    throw new Error('Refusing to run: set PERSISTENCE=supabase (this backfill targets the live DB).');
  }
  if (!process.env['FIELD_ENCRYPTION_KEY']) {
    throw new Error('FIELD_ENCRYPTION_KEY is required.');
  }
  const { repos } = await buildContainer();

  const people = await repos.people.findAll();
  console.log(`people: ${people.length} rows`);
  for (let i = 0; i < people.length; i += BATCH) {
    const batch = people.slice(i, i + BATCH);
    await repos.people.saveMany(batch);
    console.log(`  people ${Math.min(i + BATCH, people.length)}/${people.length}`);
  }

  const notes = await repos.notes.findAll();
  console.log(`notes: ${notes.length} rows`);
  for (let i = 0; i < notes.length; i += BATCH) {
    const batch = notes.slice(i, i + BATCH);
    await repos.notes.saveMany(batch);
    console.log(`  notes ${Math.min(i + BATCH, notes.length)}/${notes.length}`);
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-field-encryption.ts
git commit -m "feat(scripts): idempotent field-encryption backfill"
```

---

### Task 6: Migration — drop legacy columns (`023`)

**Files:**
- Create: `supabase/migrations/023_field_encryption_drop_legacy.sql`

**Interfaces:**
- Consumes: nothing further. Runs only AFTER the backfill populated `*_enc` for every row (Deployment Runbook step 5). The mapper already stopped writing these columns in Task 3, and its reads fall back harmlessly (the fallback branch is never taken post-backfill).

> `VACUUM FULL` cannot run inside a migration transaction — it is a separate operator command in the runbook, not in this file.

- [ ] **Step 1: Write the migration** — `supabase/migrations/023_field_encryption_drop_legacy.sql`

```sql
-- 023: Drop the legacy plaintext columns now that data lives encrypted in *_enc.
--
-- PRECONDITIONS (see docs/superpowers/plans/2026-07-16-field-encryption.md runbook):
--   1. 022 applied, encryption-aware mapper deployed (writes ciphertext).
--   2. scripts/backfill-field-encryption.ts run to completion against this DB.
--   3. Verified: no person row has a NULL *_enc where the source value was non-null.
--
-- After applying this, run VACUUM FULL (outside a transaction) to physically purge the
-- dropped-column data and the in-place-scalar dead tuples from disk:
--     VACUUM FULL people;
--     VACUUM FULL notes;
alter table people
  drop column if exists medical_conditions,
  drop column if exists dietary_requirements,
  drop column if exists consents,
  drop column if exists blue_card_expiry;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/023_field_encryption_drop_legacy.sql
git commit -m "feat(db): 023 drop legacy plaintext columns after backfill"
```

---

### Task 7: Documentation

**Files:**
- Modify: `SECURITY-ACTIONS.md`, `debug.md`, `CLAUDE.md`, `CHANGELOG.txt`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a key-setup step to `SECURITY-ACTIONS.md`** — insert after the "## 1. Set SESSION_SECRET" section

```markdown
## 1b. Set FIELD_ENCRYPTION_KEY
Sensitive people/notes columns are encrypted at rest (AES-256-GCM) using this key.
Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
Set FIELD_ENCRYPTION_KEY in Vercel Environment Variables (base64, 32 bytes).

⚠️ BACK THIS KEY UP OUT-OF-BAND. If it is lost, every encrypted field (medical,
dietary, medicare, blue card, parent contacts, consents, note bodies) is PERMANENTLY
unrecoverable — that is the security property, not a bug. Losing the key = losing the data.

Rotation: set the new key as FIELD_ENCRYPTION_KEY (+ FIELD_ENCRYPTION_KEY_ID), move the
old one to FIELD_ENCRYPTION_KEY_PREV (+ _PREV_ID), re-run
scripts/backfill-field-encryption.ts, then remove the PREV key.
```

- [ ] **Step 2: Add a troubleshooting row to `debug.md`** (in the symptom/where table)

```markdown
| **A sensitive field reads as gibberish / "malformed ciphertext" / manual SQL shows `v1.` blobs** | Those columns are AES-256-GCM encrypted at the app layer (`src/utils/field-crypto.ts`, applied in `supabase.people.ts`/`supabase.notes.ts`). The SQL editor cannot read/edit `medical_conditions_enc`, `dietary_requirements_enc`, `consents_enc`, `blue_card_expiry_enc`, `other_medications`, `medicare_number`, `blue_card_number`, `parent_*`, `notes.body` — go through the app or a keyed script. "malformed ciphertext"/tag errors = wrong or missing `FIELD_ENCRYPTION_KEY`, or a value moved between rows (AAD is bound to `table:column:id`). |
```

- [ ] **Step 3: Add a `CHANGELOG.txt` entry** (top, dated 2026-07-16) and a short `CLAUDE.md` section summarising: scope, seam (Supabase mappers only), envelope format, key management + rotation, the 022→backfill→023→VACUUM rollout, and that memory/json modes stay plaintext. (Follow the existing changelog/section style; backend-only, no `sw.js` bump.)

- [ ] **Step 4: Commit**

```bash
git add SECURITY-ACTIONS.md debug.md CLAUDE.md CHANGELOG.txt
git commit -m "docs: field encryption at rest — setup, rotation, troubleshooting"
```

---

## Deployment Runbook (operator-gated — human runs these against prod)

Do these IN ORDER. Steps 1–4 of the plan (Tasks 1,3,4 code + Task 2 migration) are the "tolerant" release; the rest are the cutover.

1. **Generate + set `FIELD_ENCRYPTION_KEY`** in Vercel (and back it up out-of-band). Redeploy is not needed yet.
2. **Apply migration `022`** (add `*_enc` columns) to prod — via the project's normal migration path. Verify the four columns exist.
3. **Deploy the encryption-aware code** (Tasks 1, 3, 4 — push to `master` auto-deploys). From now on: reads decrypt-or-passthrough, writes emit ciphertext. Smoke-test in prod: edit a camper's medical/parent fields and re-open; download the Elvanto export and the audit workbook and confirm the sensitive columns show **plaintext** (proves decryption flows into exports). In the Supabase table editor, confirm a freshly-edited row shows `v1.` blobs.
4. **Run the backfill** (Task 5) against prod: `PERSISTENCE=supabase DATABASE_URL=… FIELD_ENCRYPTION_KEY=… npx tsx scripts/backfill-field-encryption.ts`. Re-runnable if interrupted.
5. **Verify** every row is encrypted. In the SQL editor:
   ```sql
   select count(*) from people
     where (medical_conditions_enc  is null and medical_conditions  <> '{}')
        or (dietary_requirements_enc is null and dietary_requirements <> '{}')
        or (consents_enc is null)
        or (blue_card_expiry is not null and blue_card_expiry_enc is null)
        or (other_medications is not null and other_medications  not like 'v1.%')
        or (medicare_number  is not null and medicare_number      not like 'v1.%')
        or (blue_card_number is not null and blue_card_number     not like 'v1.%');
   -- expect 0
   select count(*) from notes where body is not null and body <> '' and body not like 'v1.%';
   -- expect 0
   ```
6. **Apply migration `023`** (drop legacy columns).
7. **Purge plaintext from disk** in a low-traffic window (brief exclusive lock):
   ```sql
   VACUUM FULL people;
   VACUUM FULL notes;
   ```
8. **Confirm** the Elvanto export + audit workbook still render correctly (final decryption sanity check).

**Rollback:** before step 6, everything is reversible (legacy columns still hold plaintext; reverting the code makes reads use them again). After step 6/7 the `*_enc`/scalar ciphertext columns are authoritative.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** cipher/IV/tag/AAD/envelope → Task 1; Supabase-mapper placement → Tasks 3–4; field scope (all candidates) → Global Constraints + Tasks 3–4; text[]/jsonb/date via `*_enc`, scalars in place → Tasks 2–3; single key + versioned keyId + rotation → Task 1 + docs; phased idempotent/resumable backfill → Task 5 + runbook; drop + `VACUUM FULL` plaintext purge → Task 6 + runbook; export/audit unchanged (decrypted flow) → runbook steps 3/8; null/empty preservation → Task 1/3 tests; memory/json untouched → Task 4 regression gate; docs → Task 7. No gaps.
- **Placeholder scan:** none — every code/step is concrete.
- **Type consistency:** `toPerson`/`personColumns`/`toNote`/`noteColumns` names + signatures consistent across tasks and tests; `maybeEncrypt`/`maybeDecrypt`/`encryptField`/`decryptField`/`isEncrypted` used exactly as defined in Task 1; AAD string `"<table>:<column>:<id>"` consistent everywhere.
