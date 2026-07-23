-- 0011: Church check-in hard AM/PM windows (item 11) — on by default, admin-editable.
--
-- Four nullable HH:MM text columns; the app supplies defaults on read (AM 06:00-12:00,
-- PM 12:00-22:00) so this migration does not need a NOT NULL default. Also flips the
-- existing church_checkin_time_restricted flag to true — item 11 wants the windows
-- enforced by default rather than opt-in.
alter table settings add column if not exists checkin_window_am_start text;
alter table settings add column if not exists checkin_window_am_end text;
alter table settings add column if not exists checkin_window_pm_start text;
alter table settings add column if not exists checkin_window_pm_end text;

update settings set church_checkin_time_restricted = true;
