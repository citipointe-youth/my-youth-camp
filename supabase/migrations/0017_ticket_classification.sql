-- 0017 — Budget ticket classification (2026-07-29)
--
-- Replaces the budget's cost-band categories ("Full — $180" / "Half" / "Part" / "Sponsored")
-- with ticket classifications: accommodation kind (tent | classroom) crossed with a payment
-- tag the admin sets on each DISCOUNT CODE, plus an "Accommodation not recorded" bucket.
--
-- ⚠ APPLY THIS TO PROD **BEFORE** PUSHING THE CODE.
-- `supabase.settings` writes EVERY settings column on EVERY save, so if these columns don't
-- exist yet, the first settings save (and mode switch, and new-year rollover) fails outright.
-- Reads tolerate absence; writes do not. This has bitten the same way on 0015 and 0016.

-- The payment half of the classification: code -> 'inperson' | 'sponsor' | 'discount'.
-- A code absent from this map is a plain full-price ticket.
alter table settings add column if not exists discount_code_tags jsonb not null default '{}'::jsonb;

-- Admin-set reference prices for a full-price ticket.
--
-- NOTE FOR ANYONE READING THE MIGRATION HISTORY: `settings.tent_price` and
-- `settings.classroom_price` existed before and were deliberately DROPPED by migration 0004,
-- when the budget moved to per-registrant `registration_cost`. They are back with a NARROWER
-- job — a reference price used to value a "paid in person" ticket and to define what
-- "discounted" is measured against. They are NOT the source of every registrant's cost;
-- do not restore the old price × headcount behaviour.
alter table settings add column if not exists tent_price numeric;
alter table settings add column if not exists classroom_price numeric;

-- Carry the retired `discount_code_overrides` forward. That field held a dollar amount for
-- codes representing an EFTPOS/cash payment taken by hand at registration — which is exactly
-- what the 'inperson' tag now means — so every key in it becomes an 'inperson' tag.
-- The old column is left in place, unused, so a rollback is possible.
update settings
set discount_code_tags = coalesce(
      (select jsonb_object_agg(k, '"inperson"'::jsonb)
       from jsonb_object_keys(coalesce(discount_code_overrides, '{}'::jsonb)) as k),
      '{}'::jsonb)
where discount_code_overrides is not null
  and discount_code_overrides <> '{}'::jsonb
  and discount_code_tags = '{}'::jsonb;
