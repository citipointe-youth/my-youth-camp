-- 0033: move pg_net out of public (advisor warning). Run right AFTER a camp-push-tick fires (every 5 min).
-- Rollback: begin; drop extension pg_net; create extension pg_net with schema public; commit;
--
-- camp-push-tick (0014) calls `net.http_get(...)`. The `net` schema is created by the
-- extension whatever its install schema, so the cron body needs no change. Dropping the
-- extension discards net._http_response history and any request still queued — hence
-- applying straight after a tick.
begin;
drop extension pg_net;
create extension pg_net with schema extensions;
commit;
