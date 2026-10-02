-- 0031: cron.job_run_details is never pruned by pg_cron. Keep 7 days; prune weekly.
--
-- camp-push-tick (0014) runs every 5 min = 288 rows/day; on 2026-10-02 the table held
-- 18,229 rows (16,213 older than 7 days). This deletes only cron run history and adds one
-- weekly job (Sunday 03:17 UTC). camp-push-tick is unchanged.
--
-- Rollback (job only — deleted history is not recoverable and not needed):
--   select cron.unschedule('camp-cron-prune');

delete from cron.job_run_details
 where coalesce(end_time, start_time) < now() - interval '7 days';

select cron.schedule(
  'camp-cron-prune',
  '17 3 * * 0',
  $$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$$
);
