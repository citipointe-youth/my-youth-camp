-- 0032: the app uses the postgres role only; anon/authenticated have no use for public tables.
--
-- The app connects as `postgres` through DATABASE_URL (session pooler) and the Data API is
-- disabled, so nothing reaches public tables as anon/authenticated. Supabase's default
-- privileges still granted them full rights on every table and sequence (294 table grants,
-- 147 each, on 2026-10-02). RLS is on for all 21 tables, so this is defence in depth.
--
-- Rollback:
--   grant all on all tables in schema public to anon, authenticated;
--   grant all on all sequences in schema public to anon, authenticated;
--   (plus `alter default privileges in schema public grant all on tables/sequences to anon, authenticated;`)

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

do $$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  exception when insufficient_privilege then
    raise notice 'skipped supabase_admin default privileges (insufficient_privilege)';
  end;
end $$;
