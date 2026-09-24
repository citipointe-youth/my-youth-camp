-- Accommodation "Left to per-registration" (owner, 2026-09-24). A ministry that sends juniors to
-- classrooms and seniors to tents sits under the 75% classroom bar, which moved ALL its
-- classroom-kind people to tents. When true, the church skips the bar: each person sleeps where
-- they registered. Set from the Accommodation allocations screen (PATCH
-- /accommodation/per-registration/:churchId).
--
-- Additive, default false (= today's behaviour for every church), no backfill. Must be applied to
-- prod BEFORE the code deploys — supabase.churches names it in its insert and on-conflict list.
alter table churches add column if not exists accommodation_per_registration boolean not null default false;
