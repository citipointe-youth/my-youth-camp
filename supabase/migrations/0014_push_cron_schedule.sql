-- 0014_push_cron_schedule.sql
-- The scheduled tick (design D1). Split out of 0013 on 2026-07-26.
-- Design: docs/superpowers/specs/2026-07-26-web-push-design.md §4.1
--
-- ⚠ DO NOT APPLY THIS UNTIL BOTH ARE TRUE:
--   1. `GET /internal/cron/tick` is registered and LIVE in production (plan Task 7).
--      Until then every tick 404s, silently, into `net._http_response`.
--   2. The bearer secret exists in Vault, matching Vercel's CRON_SECRET env var:
--        select vault.create_secret('<the-cron-secret>', 'cron_secret');
--      Without it the header is NULL and every tick 401s — also silently, because
--      pg_net is fire-and-forget and never surfaces the response to the caller.
--
-- Vercel Hobby cron is daily-only, which is unusable for the check-in-window warning,
-- so the database drives the tick instead. Keeping the schedule in a migration means it
-- lives in git rather than existing only as invisible prod state.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret is read from Vault at run time and is NEVER written into this file.
select cron.schedule('camp-push-tick', '*/5 * * * *', $$
  select net.http_get(
    url     := 'https://my-youth-camp.vercel.app/internal/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 25000
  );
$$);

-- Kill switch, no deploy required:   select cron.unschedule('camp-push-tick');
-- Execution history:                 select * from cron.job_run_details order by start_time desc limit 20;
-- HTTP responses (pg_net):           select status_code, created from net._http_response order by created desc limit 20;
