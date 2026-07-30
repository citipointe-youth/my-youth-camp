-- 0018_notification_target_user.sql
-- Per-login addressing for notifications. Additive; safe to apply BEFORE the code push
-- (nothing reads the column until the code that writes it is live).
--
-- Why: the scheduler's check-in warning is counted PER LOGIN, not per church. Church accounts
-- are gender-scoped (`b-`/`g-`, migration 0006) and share a church_id, so two notices carrying
-- two different counts for the same session both matched on church_id alone — each login saw
-- both numbers, and every admin/director saw all of them (oversight roles bypass scope checks).
-- A notice with target_user_id set goes to that ONE login and nobody else; enforced in
-- src/services/notification-visibility.ts.
--
-- Null for every human-authored notice, which stays addressed by scope (camp/zone/church).

alter table notifications
  add column if not exists target_user_id text references users(id) on delete cascade;

-- No index: feeds read via findActive() and filter in memory (tens of rows). Add one only if
-- a query ever selects ON this column.

-- Deliberately NOT unique and NOT combined with dedupe_key: dedupe_key already guarantees one
-- notice per (session, login), and target_user_id is addressing, not identity.
