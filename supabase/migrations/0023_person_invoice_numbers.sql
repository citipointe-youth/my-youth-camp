-- 0023: every invoice number seen for a person, not just the most recent one (2026-09-09).
--
-- `people.invoice_number` is a single scalar, so a person who bought two tickets — each with
-- its own invoice number — loses the first one the moment the second is imported. This column
-- is additive: it holds the full array. `invoice_number` is untouched and keeps meaning "the
-- single most-recent invoice number", exactly as it does today.
--
-- Nullable with no default, so applying this changes nothing about existing rows.
alter table people add column invoice_numbers text[];
