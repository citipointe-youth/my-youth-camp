-- Remove the deprecated "parents met at pickup" field — no longer collected (2026-07-24).
alter table sign_out_history drop column if exists parents_met;
