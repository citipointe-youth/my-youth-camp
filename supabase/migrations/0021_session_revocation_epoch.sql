-- 0021: settings.church_sessions_valid_from / zone_leader_sessions_valid_from (2026-08-05).
--
-- Per-role session revocation epoch, paired with the TOKEN_TTL_MS 24h->48h doubling
-- (auth.service.ts). Doubling the TTL doubles how long a token from a LOCKED role would
-- otherwise keep working (churchLoginLocked/zoneLeaderLoginLocked only ever blocked new
-- logins), so a kill switch ships alongside it: flipping a lock false->true stamps that
-- role's epoch to "now" (settings.service.ts `update()` — the ONLY writer of these columns,
-- there is deliberately no separate admin control), and any token whose embedded `issuedAt`
-- predates the epoch is revoked in auth.service.ts `resolveToken`.
--
-- Both columns are nullable and default to null = "never locked" = no revocation check for
-- that role, so this is safe to apply at any time and changes nothing until an admin actually
-- flips a lock on.
--
-- ⚠️ MUST BE APPLIED TO PROD BEFORE THIS CODE PUSHES. `supabase.settings` writes every column
-- on every save (settingsCols()/UPDATE_COLS), so a settings save fails until these columns
-- exist — same standing rule as every other settings-table migration in this repo (0016, 0017,
-- 0018, 0020).
alter table settings add column if not exists church_sessions_valid_from timestamptz;
alter table settings add column if not exists zone_leader_sessions_valid_from timestamptz;
