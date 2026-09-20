-- Login activity tracking (owner request, 2026-09-20): capture the most recent login
-- timestamps per account so the admin can see which churches haven't logged in yet ahead of
-- camp (2026-09-28) and reach out to help. Additive, nullable-safe default — does not affect
-- any existing row, and no read path depends on it until the code that reads it ships.
--
-- Written on every successful login by auth.service.ts's login(), capped client-side (in the
-- application layer, not here) to the 15 most recent entries, newest first.
alter table users add column if not exists login_history jsonb not null default '[]'::jsonb;
