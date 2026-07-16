# Application-level field encryption at rest — design

**Date:** 2026-07-16
**Status:** Approved for planning (4 key decisions locked with the owner 2026-07-16)
**Repo:** `citipointe-youth/my-youth-camp` (public) — production `PERSISTENCE=supabase`, ref `nwfafrgojqkxylbppywo`

## Goal

Sensitive personal fields must be **encrypted at rest at the application layer** so they are
unreadable to anyone with raw database access (including Supabase staff). Ciphertext lives in the
Postgres columns; plaintext exists only inside the running Node process after decryption, and only
flows to authorised API responses/exports exactly as it does today.

This is **not** row-level security or transport encryption (both already exist — RLS in migration
`003`, HTTPS at the edge). It is column-value encryption owned by the app.

## Locked decisions (owner, 2026-07-16)

1. **Field scope:** encrypt **all** candidate fields (see table below).
2. **Placement:** encrypt/decrypt in the **Supabase mappers only**. `memory`/`json` modes stay
   plaintext (dev/test only; never production).
3. **Key management:** **single 32-byte key** in a Vercel env var, ciphertext carries a `keyId`
   so a second key can coexist for rotation.
4. **Backfill:** **phased backfill + `VACUUM FULL`** to purge leftover plaintext from disk.

## Why the Supabase mappers are the right seam

The codebase is layered `api → controllers → services → repositories (interfaces) → core`.
Services depend only on repo *interfaces* and always work with fully-materialised `Person` /
`StudentNote` objects. The **only** place raw column values cross into typed domain objects is:

- `src/repositories/supabase/supabase.people.ts` — `toPerson()` (read) / `personColumns()` +
  `PERSON_UPDATE_COLS` (write)
- `src/repositories/supabase/supabase.notes.ts` — `toNote()` (read) / `save()` (write)

Encrypting here means **every service, DTO, export, and audit path automatically sees plaintext**
with zero changes to business logic, and the ciphertext never leaves the repository boundary.

## Field-by-field inventory (the query-safety proof)

Encryption breaks any DB-level `WHERE` / `ORDER BY` / `GROUP BY` / `JOIN` / `LIKE` on the column.
Every candidate field was traced. **None is used in a DB-level operation** — every consumer is an
in-process operation over already-decrypted entities, so all candidates are safe to encrypt.

| Field (column) | Type | DB-level use | App-level use (post-decrypt) | Column strategy |
|---|---|---|---|---|
| `medicalConditions` (`medical_conditions`) | `text[]` | none | `listMedicalWatch` (`.length>0`), `medicalFlag` DTO, export | **new `_enc text`** |
| `dietaryRequirements` (`dietary_requirements`) | `text[]` | none | export, client `_ALLERGY_RE` flag (post-DTO) | **new `_enc text`** |
| `otherMedications` (`other_medications`) | `text` | none | `medicalFlag`/`listMedicalWatch` null-check, export | **in place** |
| `medicareNumber` (`medicare_number`) | `text` | none | export, audited `revealMedicare` | **in place** |
| `blueCardNumber` (`blue_card_number`) | `text` | none | `noBlueCardCount` **null-check only**, export | **in place** |
| `blueCardExpiry` (`blue_card_expiry`) | `date` | none | export | **new `_enc text`** (date can't hold ciphertext) |
| `parentGuardianName` (`parent_guardian_name`) | `text` | none | export, reveal | **in place** |
| `parentPhone` (`parent_phone`) | `text` | none | export, reveal | **in place** |
| `parentRelation` (`parent_relation`) | `text` | none | export | **in place** |
| `consents` (`consents`) | `jsonb` | none | export, `medicalFlag` never reads it | **new `_enc text`** |
| `notes.body` (`body`) | `text` | none | `note.service.forCamper`, audit workbook | **in place** |

Every Supabase query filters/sorts only on `church_id`, `zone`, `group_id`, `kind`, `lifecycle`,
`at_camp`, `created_at`, `last_name`/`first_name`. `SupabasePersonRepository.search()` pulls all
rows and matches names in JS — it never reads a sensitive column. Notes are queried only by
`camper_id` / `author_id` / a `zone` join on `people` / `created_at`.

**Null-ness must be preserved** (real logic depends on it): `blueCardNumber == null` and
`otherMedications != null` are load-bearing. Encrypt only non-null, non-empty values; keep `null`
as `null`.

### Explicitly out of scope

`mobile`, `email`, `suburb`, `postcode`, `state` (contact fields, not requested — and `mobile` is
an in-app import-matching key, though that's post-decrypt and would still work); `first_name` /
`last_name` (needed plaintext for search + RBAC scoping); `churches.contact_email` /
`contact_phone`; `elvanto_meta` (raw submission blob); `notifications.body` (broadcast notices,
not personal data); `users.password_hash` (already a scrypt hash). Revisit `elvanto_meta` later if
byte-for-byte export fidelity of PII in that blob becomes a concern.

## Cryptographic design

- **Algorithm:** AES-256-GCM via `node:crypto` (`createCipheriv`/`createDecipheriv`).
- **IV:** fresh 12-byte random IV per value (`randomBytes(12)`).
- **Auth tag:** 16-byte GCM tag (authenticated, tamper-evident).
- **AAD:** bind each ciphertext to `"<table>:<column>:<id>"` as additional-authenticated-data, so a
  ciphertext copied to another row or field fails decryption. Safe because ids are app-generated
  (`utils/id.ts`) and immutable.
- **Envelope format (self-describing, versioned):**
  `v1.<keyId>.<iv_b64url>.<tag_b64url>.<ct_b64url>`
  The `v1.` prefix is the "is this already encrypted?" test — it makes the backfill idempotent and
  lets reads tolerate a half-migrated table (decrypt if prefixed, else pass through).
- **Serialisation of non-scalar fields:** `text[]` and `jsonb` are `JSON.stringify`-ed to a
  canonical string *before* encryption, and `JSON.parse`- d *after* decryption. `text` scalars are
  encrypted as-is.
- **Key(s):** 32-byte key(s), base64, in env. Ciphertext's `keyId` selects the key on decrypt, so
  the old and new key coexist during rotation. Two keys max at a time (`current` + `next`).

### New module: `src/utils/field-crypto.ts` (pure, DB-free, unit-tested)

```
encryptField(plaintext: string, aad: string): string        // → "v1.<keyId>...."
decryptField(envelope: string, aad: string): string          // handles keyId lookup; throws on tag fail
isEncrypted(value: string): boolean                          // "v1." prefix test
maybeEncrypt(value, aad): string | null                     // null/'' passthrough
maybeDecrypt(value, aad): string | null                     // null / non-prefixed passthrough
```

Keys loaded from env at module init (mirrors how `auth.service.ts` reads `SESSION_SECRET`
directly). Missing key in production = hard startup error; in `memory`/`json` dev the codec is
never invoked so no key is required.

### Env vars

```
FIELD_ENCRYPTION_KEY=<base64 32 bytes>            # REQUIRED when PERSISTENCE=supabase
FIELD_ENCRYPTION_KEY_NEXT=<base64 32 bytes>       # optional, only during rotation
FIELD_ENCRYPTION_KEY_ID=v1                        # optional label; defaults to a fixed id
```

Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Add to `src/config/env.ts` for documentation, but the codec may read `process.env` directly like
the session secret does. **The key must be backed up out-of-band** — losing it makes the encrypted
data permanently unrecoverable (that is the security property, not a bug).

## Mapper integration (people + notes)

- **`personColumns()` / `save()` / `saveMany()` (write):** for each in-scope field, compute
  `aad = "people:<column>:<person.id>"`, then `maybeEncrypt(serialise(value), aad)`. Array/jsonb
  fields write to the new `*_enc` columns and write `NULL` to the legacy columns going forward.
  Scalars overwrite their own column with ciphertext.
- **`toPerson()` (read):** for `*_enc` columns, `maybeDecrypt` then `JSON.parse` (fall back to the
  legacy plaintext column if `_enc` is null — the rollout-transition read path). For in-place
  scalars, `maybeDecrypt` (a non-prefixed legacy plaintext value passes straight through).
- **`PERSON_UPDATE_COLS`** must include the new `*_enc` columns and continue to `NULL` the legacy
  ones on conflict.
- **Notes:** `toNote()` decrypts `body`; `save()` encrypts `body` with
  `aad = "notes:body:<note.id>"`. The `on conflict do update set body = excluded.body` stays correct
  (`excluded.body` is the already-encrypted inserted value).

`memory`/`json` repos are untouched — they store and return plaintext, so the default test suite and
local dev keep working with no key. Codec correctness is covered by direct unit tests plus a
mapper round-trip test.

## Rollout — idempotent, resumable, order-independent

1. **Ship tolerant code first.** Deploy the codec + mapper changes with **read = decrypt-if-prefixed-
   else-passthrough, write = always-encrypt**. From this deploy on, any created/edited person or
   note self-encrypts; the app tolerates a table that is any mix of plaintext and ciphertext.
2. **Migration `022_field_encryption_columns.sql`:** add nullable `medical_conditions_enc text`,
   `dietary_requirements_enc text`, `consents_enc text`, `blue_card_expiry_enc text` to `people`.
   (Apply to prod before/with the deploy — same discipline as `018`/`020`.)
3. **Backfill script** (`scripts/backfill-field-encryption.ts`, run once against prod, re-runnable):
   batch by `id`; for each row, skip any value already `v1.`-prefixed (idempotent), else encrypt and
   write. Order-independent (keyed by id, not row order). Resumable (re-running only touches
   still-plaintext values). Reuses the same codec.
4. **Verify:** assert no in-scope column/`_enc` value is missing its `v1.` prefix where the source
   was non-null; spot-check a decrypt round-trip via the app.
5. **Migration `023_field_encryption_drop_legacy.sql`:** drop the legacy `medical_conditions`,
   `dietary_requirements`, `consents`, `blue_card_expiry` columns (their data now lives encrypted in
   `*_enc`). Rename `*_enc` → original names is **optional** and deferred (keeping `_enc` avoids a
   second mapper rename; mapper reads whichever name is chosen).
6. **Purge plaintext from disk:** `VACUUM FULL people; VACUUM FULL notes;` (brief exclusive lock;
   rewrites the tables so dropped-column data and dead plaintext tuples are physically gone). Run in
   a low-traffic window. This step is what makes the "unreadable to Supabase staff" guarantee real —
   without it, plaintext lingers in dead tuples/dropped columns until autovacuum.

Rollback within steps 1–4 is trivial (legacy columns still hold plaintext). After step 5/6 the
encrypted columns are authoritative.

## Consequences / operational notes

- **Manual prod SQL** (the team occasionally hand-corrects rows, e.g. the `__unallocated__` fixes)
  can no longer read or write these fields in the SQL editor — values are opaque ciphertext. Edits
  to encrypted fields must go through the app or a keyed script. Document in `debug.md`.
- **Export/audit unchanged:** `export.service` (`personToElvantoRow`) and `audit-export.service`
  consume `personRepo.findAll()` / `noteRepo` (decrypted). Decrypted PII flows into the Elvanto
  round-trip export and compliance workbook exactly as today — **verify explicitly** after cutover.
- **Performance:** AES-GCM over ≤~2k people × ~10 fields ≈ single-digit ms per `findAll`;
  per-note body trivial. Negligible at camp scale. No added DB round-trips.
- **Rotation story:** add `FIELD_ENCRYPTION_KEY_NEXT`, re-run the backfill (re-encrypts under the
  new `keyId`, tolerated by the dual-key decrypt), then retire the old key. Same script, no schema
  change.
- **SECURITY-ACTIONS.md** gains a step: generate + set `FIELD_ENCRYPTION_KEY`, back it up
  out-of-band, and note that key loss = data loss.

## Testing

- `field-crypto.test.ts`: round-trip, null/empty passthrough, wrong-AAD rejection, tamper (flipped
  byte) rejection, `isEncrypted` prefix, keyId selection / dual-key decrypt, idempotent re-encrypt.
- Supabase mapper round-trip unit test (row-map → `toPerson` → `personColumns` → row-map) asserting
  ciphertext on the wire and plaintext on the entity, and null preservation.
- Backfill script test against a fixture (mixed plaintext/ciphertext → all encrypted, idempotent on
  re-run).
- Regression: existing `person.service` / `export` / `audit-export` tests must stay green
  unchanged (they run in `memory` mode, proving services are oblivious to encryption).

## Out-of-scope / deferred

- Encrypting `mobile`/`email`/address, `churches.contact_*`, `elvanto_meta`.
- Renaming `*_enc` columns back to canonical names (cosmetic; deferred).
- KMS/envelope encryption (revisit only if a compliance requirement demands per-record keys or an
  external audit trail).

## Phased task list (for the implementer)

**Phase 0 — Codec (no DB, TDD).**
- Add `src/utils/field-crypto.ts` + `field-crypto.test.ts`. AES-256-GCM, versioned envelope, AAD,
  null/empty passthrough, keyId lookup, dual-key decrypt, `isEncrypted`.
- Wire `FIELD_ENCRYPTION_KEY[/_NEXT/_ID]` into `env.ts` (doc) and the codec's env read. Hard error
  when `PERSISTENCE=supabase` and no key.

**Phase 1 — Mapper integration (people + notes).**
- Update `supabase.people.ts` `toPerson`/`personColumns`/`PERSON_UPDATE_COLS`: encrypt on write
  (in-place scalars + new `*_enc` for array/jsonb/date), decrypt on read with legacy-column
  fallback, preserve null.
- Update `supabase.notes.ts` `toNote`/`save`: encrypt/decrypt `body`.
- Mapper round-trip unit test. Full `npm run typecheck` + `npm run test` green (memory-mode services
  unaffected).

**Phase 2 — Schema.**
- `022_field_encryption_columns.sql` (add `*_enc` columns). Apply to prod before/with deploy.

**Phase 3 — Deploy tolerant code.**
- Push (auto-deploys). Now writes encrypt, reads tolerate mixed state. Smoke-test a create/edit +
  an export in prod.

**Phase 4 — Backfill.**
- `scripts/backfill-field-encryption.ts` (batched, idempotent, resumable) + test. Run against prod.
- Verify: no non-null in-scope value lacks the `v1.` prefix; decrypt round-trip via the app.

**Phase 5 — Drop legacy + purge.**
- `023_field_encryption_drop_legacy.sql` (drop legacy array/jsonb/date columns).
- `VACUUM FULL people; VACUUM FULL notes;` in a low-traffic window.

**Phase 6 — Docs.**
- `SECURITY-ACTIONS.md` key-setup + backup step; `debug.md` note on opaque manual-SQL fields;
  `CLAUDE.md` changelog entry; bump `sw.js` only if any SPA file changed (it should not — this is
  backend-only).
