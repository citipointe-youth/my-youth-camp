-- 0010_scheduled_notices.sql
-- Item 9 (2026-07-23 batch): scheduled notices. A notice with a future `scheduled_for` is
-- withheld from every audience feed until that instant passes (lazy-fire — no server scheduler).
-- Null/absent = an ordinary immediate notice. The creator (+ director/admin) can view/edit/delete
-- pending scheduled notices.

alter table notifications
  add column if not exists scheduled_for timestamptz null;
