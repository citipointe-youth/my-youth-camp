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

-- 3. The scheduler (D1). Vercel Hobby cron is daily-only, so the database drives the
--    tick instead. Keeping the schedule here means it lives in git, not just in prod.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret is read from Vault at run time and is NEVER written into this migration.
-- One-time out-of-band setup, before this runs:
--   select vault.create_secret('<the-cron-secret>', 'cron_secret');
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
