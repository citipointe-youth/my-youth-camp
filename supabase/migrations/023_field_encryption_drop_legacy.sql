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
