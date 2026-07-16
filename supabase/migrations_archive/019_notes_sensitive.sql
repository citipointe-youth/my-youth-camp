-- 019: Sensitive note/testimony flag.
--
-- When true, a note is hidden from the individual student-profile note list
-- (GET /notes/camper/:id) for 'church' logins only — zoneLeader/director/admin
-- are unaffected. Defaults false so existing notes keep their current visibility.
alter table notes add column if not exists sensitive boolean not null default false;
