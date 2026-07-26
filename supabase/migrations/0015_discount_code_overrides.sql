-- 0015_discount_code_overrides.sql
-- Per-discount-code "paid in full" override amounts. Design: docs/PLANNED-IMPROVEMENTS.md.
-- Mirrors the existing last_temp_passwords JSONB pattern on settings; no new table.
alter table settings add column if not exists discount_code_overrides jsonb not null default '{}'::jsonb;
