-- 0004: Drop the deprecated settings pricing columns.
--
-- tent_price/classroom_price were deprecated 2026-06-29 (Budget reads per-registrant
-- registration_cost; both were removed from the Settings UI, columns left in the DB).
-- 0001 never creates them, so this is a no-op on a fresh deploy; against prod it is the
-- real cleanup.
--
-- PRECONDITION: the app code no longer references these columns (settings entity,
-- content.schema, seed, supabase.settings mapper — Task 2) and that deploy is LIVE.
-- Otherwise the next settings save fails "column ... does not exist". See design §2/§5.
alter table settings
  drop column if exists tent_price,
  drop column if exists classroom_price;
