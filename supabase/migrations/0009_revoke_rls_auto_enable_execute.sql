-- 0009: lock down public.rls_auto_enable() + codify it in a tracked migration.
--
-- Supabase auto-provisions an event-trigger function `public.rls_auto_enable()`
-- (SECURITY DEFINER, RETURNS event_trigger) wired to an `ensure_rls` event trigger on
-- `ddl_command_end`, which auto-enables RLS on any newly created public table. Supabase's
-- default grant leaves this EXECUTE-able by `public`/`anon`/`authenticated`, which exposes
-- it over PostgREST at /rest/v1/rpc/rls_auto_enable — the linter (Supabase advisors) flags
-- this as a "function with insufficient search_path"/"exposed function" finding.
--
-- It is NOT directly exploitable: Postgres refuses to invoke an event-trigger function
-- (returns pseudo-type `event_trigger`) outside real trigger context, so an RPC call to it
-- errors out rather than running. Still, the grant is needless attack surface with no
-- legitimate caller, so we revoke it below.
--
-- Separately: this function + its event trigger currently exist ONLY live on the database —
-- they were never captured in a tracked migration (Supabase creates them automatically per
-- project, outside `supabase db push`). That means a fresh environment rebuilt from
-- `supabase db push` alone (new project, disaster recovery, etc.) would silently lack this
-- RLS safety net. This migration (re)creates the function and trigger explicitly so the
-- behaviour is reproducible from the tracked migration history, then immediately revokes
-- the needless public/anon/authenticated execute grant. No grant is added back — only the
-- Postgres roles that create tables (via the event trigger machinery) ever need to run it.
--
-- The function body below is the CURRENT LIVE definition captured verbatim (search_path
-- pinned to pg_catalog — the safe choice for a SECURITY DEFINER function; partitioned-table
-- handling; per-table exception handling so a single failure can't abort the DDL; diagnostic
-- RAISE LOG). Do NOT "simplify" it to search_path=public or drop the exception block — that
-- would weaken the live behaviour.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
     if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
     else
        raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     end if;
  end loop;
end;
$function$;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

drop event trigger if exists ensure_rls;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
