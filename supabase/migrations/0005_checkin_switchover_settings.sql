-- 0005: Unified arrival→daily check-in switchover (at-camp).
--
-- Two client-side-driven settings. The SPA computes arrival-vs-daily from these + Brisbane time
-- (serverless: no scheduler). Backward-compatible & idempotent — existing settings row gets the
-- defaults (14:00 switchover, auto phase).
alter table settings add column if not exists checkin_switchover_time text not null default '14:00';
alter table settings add column if not exists checkin_phase_override text not null default 'auto';
