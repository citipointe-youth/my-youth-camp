-- 0033: move pg_net's extension record out of public (advisor lint 0014). Low value: pg_net keeps
-- its functions and tables in schema `net` wherever the extension is recorded.
--
-- pg_net is not relocatable (`relocatable = false`), so ALTER EXTENSION ... SET SCHEMA fails. Drop and
-- recreate is the only path. camp-push-tick (0014) calls `net.http_get(...)` by qualified name and
-- reads vault.decrypted_secrets by qualified name. The job text lives in cron.job and has no
-- dependency on the extension, so it resolves again after the recreate without a change.
--
-- LOST: net._http_response history (6 h retention, diagnostic only) and anything in
-- net.http_request_queue. A lost tick is covered by the next one, 5 minutes later (the check-in
-- warning window is 60 minutes and its dedupe key stops a double send).
--
-- BEFORE, right after a tick (:00, :05 ...), at least 30 s after it so its 25 s request has finished.
-- Stop unless: the ledger has no 0033, extschema = public, queued = 0, and the last response is
-- under 1 minute old (which also means nothing is in flight):
--   select version from supabase_migrations.schema_migrations where version = '0033';
--   select extnamespace::regnamespace as extschema, extversion from pg_extension where extname = 'pg_net';
--   select default_version from pg_available_extensions where name = 'pg_net';  -- note if it differs
--   select username, command ~ 'net\.http_get' as qualified from cron.job where jobname = 'camp-push-tick';  -- true
--   select count(*) as queued from net.http_request_queue;
--   select now() - max(created) as last_response_age from net._http_response;
--
-- VERIFY, after the next tick (up to 5 min):
--   select extnamespace::regnamespace from pg_extension where extname = 'pg_net';  -- extensions
--   select net.check_worker_is_up();                                               -- no error
--   select has_function_privilege('postgres', 'net.http_get(text,jsonb,jsonb,integer)', 'execute'); -- true
--   select status_code, error_msg, created from net._http_response order by created desc limit 5;
--     -- a new row with status_code 200
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'camp-push-tick')
--    order by start_time desc limit 3;                                             -- succeeded
-- If the job succeeded but no response row appears after a second tick:
--   select net.worker_restart();   then wait for one more tick.
-- Then reconcile the history label to '0033' (CLAUDE.md "Migrations").
--
-- ROLLBACK (right after a tick, same loss of history; the advisor warning returns):
--   begin; drop extension pg_net; create extension pg_net with schema public; commit;
-- This transaction is all-or-nothing: if it fails, pg_net stays in public and nothing changes.
begin;
set local lock_timeout = '5s';
drop extension pg_net;
create extension pg_net with schema extensions;
commit;
