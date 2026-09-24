-- Classroom soft freeze + placement order (2026-09-24).
--
-- 1. classroom_freeze — a singleton snapshot (id = 'freeze'); no row = not frozen. While it
--    exists, classroom eligibility and each church×gender pool's split are taken from
--    `snapshot` instead of the live numbers, and each group's growth past its baseline is
--    absorbed into the rooms it already occupies. snapshot = {eligibleChurchIds, shapes, baselines}.
-- 2. classroom_allocations.seq — insertion order of the stored placement map, so the freeze's
--    "first-placed room" tie-break is deterministic. Nullable; pre-existing rows sort last.
--
-- Additive only. Must be applied to prod BEFORE the code deploys — supabase.allocation writes
-- `seq` on every placement save, and the accommodation state endpoint reads classroom_freeze.
create table if not exists classroom_freeze (
  id text primary key,
  frozen_at timestamptz not null,
  frozen_by text not null default '',
  snapshot jsonb not null
);
alter table classroom_freeze enable row level security;

alter table classroom_allocations add column if not exists seq integer;
