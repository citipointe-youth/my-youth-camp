-- 0013_push_subscriptions.sql
-- Web Push phase 1-2. Additive only; safe to apply ahead of the code push.
-- Design: docs/superpowers/specs/2026-07-26-web-push-design.md

-- 1. Device registrations. Bound to a USER (an account holder), never to a Person —
--    no minor ever has a subscription row.
create table if not exists push_subscriptions (
  id                text primary key,
  user_id           text not null references users(id) on delete cascade,
  endpoint          text not null unique,
  p256dh_enc        text not null,
  auth_enc          text not null,
  consent_version   int  not null default 1,
  created_at        timestamptz not null default now(),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  failure_count     int  not null default 0
);

create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

-- RLS on, no policies — matches every other table (0002_rls.sql). The API connects as
-- postgres and bypasses RLS; an anon-key connection is denied all rows.
alter table push_subscriptions enable row level security;

-- 2. Delivery-once bookkeeping on notifications.
alter table notifications add column if not exists push_sent_at timestamptz;
alter table notifications add column if not exists dedupe_key   text;

-- Partial unique index: ordinary notices (dedupe_key null) are unaffected.
create unique index if not exists notifications_dedupe_key_idx
  on notifications(dedupe_key) where dedupe_key is not null;

-- The SCHEDULER is deliberately NOT here — see `0014_push_cron_schedule.sql`.
-- Split 2026-07-26: this file must be applied to prod BEFORE the code that writes
-- `push_sent_at`/`dedupe_key` deploys, but the cron job must NOT start until the
-- `/internal/cron/tick` route exists and `cron_secret` is in Vault. Applying them
-- together would leave a scheduler firing every 5 minutes at a 404 for weeks.
