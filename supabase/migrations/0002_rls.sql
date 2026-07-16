-- 0002: Row-Level Security on every live table (defence-in-depth).
--
-- The Express API connects as the postgres superuser (DATABASE_URL), which BYPASSES
-- RLS — so the app keeps working with no policies. With RLS on and no anon policies,
-- any connection using the Supabase anon key is denied all rows.
--
-- Idempotent: `enable row level security` is a no-op where already on. The only table
-- this newly covers vs. the old 003/004 pair is allocation_overrides (old 020 never
-- enabled RLS on it).
alter table users                 enable row level security;
alter table churches              enable row level security;
alter table people                enable row level security;
alter table check_in_history      enable row level security;
alter table sign_out_history      enable row level security;
alter table classrooms            enable row level security;
alter table classroom_allocations enable row level security;
alter table zones                 enable row level security;
alter table groups                enable row level security;
alter table notes                 enable row level security;
alter table notifications         enable row level security;
alter table schedule_items        enable row level security;
alter table devotionals           enable row level security;
alter table faqs                  enable row level security;
alter table settings              enable row level security;
alter table defaults              enable row level security;
alter table allocation_overrides  enable row level security;
