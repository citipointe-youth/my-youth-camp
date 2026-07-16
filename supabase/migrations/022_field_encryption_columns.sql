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
