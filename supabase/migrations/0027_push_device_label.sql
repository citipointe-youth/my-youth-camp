-- Notification delivery screen (owner request, 2026-09-22): record a coarse phone type per push
-- subscription ("iPhone", "Android", …) so the admin can see which kind of device each account's
-- alerts go to. Additive and nullable — existing rows read as "unknown device" until that phone
-- next opens the app and the SPA back-fills its label (POST /push/label).
--
-- ⚠ Must be applied to prod BEFORE the code that writes it deploys: supabase.push-subscriptions
-- save() names this column in its insert and on-conflict list, so without it every subscribe —
-- and every post-send lastSuccessAt/failureCount update — fails.
--
-- Deliberately a coarse enum-ish label, never the raw User-Agent string: the UA is a device
-- fingerprint, and "iPhone" is all this screen needs.
alter table push_subscriptions add column if not exists device_label text;

-- Recent successful deliveries to this phone (ISO timestamps, newest first, capped at 15 in the
-- application layer — same shape as users.login_history, migration 0026). Appended ATOMICALLY
-- in SQL by recordSuccess(), never read-modify-written, because two notices in one cron tick can
-- reach the same phone concurrently. Cleared when the phone is re-subscribed under a DIFFERENT
-- account, so an account never shows deliveries that were made to someone else's login.
alter table push_subscriptions add column if not exists delivery_history jsonb not null default '[]'::jsonb;
