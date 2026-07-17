-- 0007: Incidents (Feature 3).
--
-- A safeguarding / operational incident log. `summary` is free text that can describe a
-- minor, so it is CHILD-SAFETY DATA and is stored ENCRYPTED AT REST — the application layer
-- (src/repositories/supabase/supabase.incidents.ts) writes an AES-256-GCM envelope into the
-- column, exactly like notes.body. The column type is plain text; encryption is transparent
-- to Postgres. Append-only in the UI; only admin/director may delete.
create table if not exists incidents (
  id text primary key,
  summary text not null,              -- encrypted in place (field-crypto envelope)
  severity text not null,             -- low | high
  created_by_id text not null,
  created_by_name text not null,
  created_by_role text not null,
  zone text,
  created_at timestamptz not null default now()
);
create index if not exists incidents_created_idx on incidents(created_at desc);

-- Constrain severity to the two legal values. Guarded so the migration is re-runnable
-- (Postgres has no `add constraint if not exists`).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'incidents_severity_chk'
  ) then
    alter table incidents
      add constraint incidents_severity_chk
      check (severity in ('low', 'high'));
  end if;
end $$;

-- RLS on, consistent with every other live table (the Express API connects as the
-- postgres superuser via DATABASE_URL, which BYPASSES RLS; the anon key is denied all rows).
alter table incidents enable row level security;
