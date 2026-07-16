-- Adds a per-account flag forcing a password change before any other route is
-- reachable (enforced in the app layer, not RLS — see MustChangePasswordError).
-- Default false: adding the column does NOT retroactively flag any existing row.
alter table users add column must_change_password boolean not null default false;
