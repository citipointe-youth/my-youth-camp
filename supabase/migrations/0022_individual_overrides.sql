-- 0022: per-person accommodation / amount-paid overrides + cancel & refund (2026-09-03).
--
-- The Data Import screen gains two admin tools: "Individual accommodation override" (this
-- person sleeps HERE and/or paid THIS, regardless of what the three CSVs say) and
-- "Registration cancels / refunds".
--
-- `accommodation_override` beats the Ticket List, the Invoice AND churches.accommodation_override.
-- It is resolved on the READ path only (supabase.people.ts `toPerson`), so every existing consumer
-- of accommodationKind honours it with no code of its own; `accommodation_kind` keeps meaning
-- "what the importers said" and is never written from the resolved value (see accommodationKindRaw).
--
-- `amount_paid_override` short-circuits the whole personValue cascade (inperson tag -> sponsor tag
-- -> amount_paid -> registration_cost). `refund_amount` is then subtracted from whatever the base
-- came out as. Cancelling does NOT change the budget — cancel state lives in `lifecycle`;
-- `cancelled_at` is an audit stamp only, kept because this is money-adjacent.
--
-- NO importer reads or writes any of these five columns, and the Form import's delete-absent sweep
-- skips anyone carrying one (import.service.ts) so a re-import cannot destroy them.
--
-- ⚠️ MUST BE APPLIED TO PROD BEFORE THIS CODE PUSHES. `supabase.people` writes every column in
-- personColumns()/PERSON_UPDATE_COLS on every save, so person saves fail until these exist —
-- the same standing rule as 0016, 0017, 0018, 0020 and 0021.
--
-- All five are nullable with no default, so applying this changes nothing about existing rows.
alter table people add column if not exists accommodation_override text
  check (accommodation_override in ('tent','classroom') or accommodation_override is null);
alter table people add column if not exists amount_paid_override numeric;
alter table people add column if not exists refund_amount numeric;
alter table people add column if not exists refunded_at timestamptz;
alter table people add column if not exists cancelled_at timestamptz;
