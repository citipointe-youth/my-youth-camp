# Security Actions — First Deploy Checklist

Complete these steps IN ORDER before telling anyone the app URL.

## 1. Set SESSION_SECRET
In Vercel Environment Variables, set SESSION_SECRET to 64+ random hex chars.
Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
Without this, anyone can forge auth tokens.

## 1b. Set FIELD_ENCRYPTION_KEY
Sensitive people/notes columns are encrypted at rest (AES-256-GCM) using this key.
Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
Set FIELD_ENCRYPTION_KEY in Vercel Environment Variables (base64, 32 bytes).

⚠️ BACK THIS KEY UP OUT-OF-BAND. If it is lost, every encrypted field (medical,
dietary, medicare, blue card, parent contacts, consents, note bodies) is PERMANENTLY
unrecoverable — that is the security property, not a bug. Losing the key = losing the data.

Rotation: set the new key as FIELD_ENCRYPTION_KEY (+ FIELD_ENCRYPTION_KEY_ID), move the
old one to FIELD_ENCRYPTION_KEY_PREV (+ _PREV_ID), re-run
scripts/backfill-field-encryption.ts, then remove the PREV key.

## 2. Lock CORS
Set CORS_ORIGINS to your exact Vercel URL (e.g. `https://youth-camp-platform.vercel.app`).
Never leave this as `*` in production.

## 3. Set the admin password
After first deploy, visit https://<your-url>/setup
Enter your chosen admin username and password.
This endpoint is permanently disabled once any password is set.

## 4. Confirm RLS is active
In Supabase → SQL Editor, run:
  SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
All tables should show rowsecurity = true.

Test that the anon key cannot read data:
  curl https://<supabase-url>/rest/v1/users -H "apikey: <anon-key>"
Expected: 401 or empty result (not user rows).

## 5. Verify migrations applied
In Supabase → Table Editor, confirm these tables exist:
  users, churches, people, check_in_history, sign_out_history,
  reservations, accommodation_blocks, zones, groups, notes,
  notifications, schedule_items, devotionals, faqs, settings, defaults

## 6. After new-year rollover  (R9 — RESOLVED 2026-06-30)
POST /admin/new-year now generates a **temporary password** for every restored
church/zone account (the admin account keeps its own real password). You do NOT need to
set passwords by hand any more.

- The temp passwords are shown in the **rollover confirmation modal** immediately after
  close-out — copy them then.
- If that modal is dismissed, they are **retained for the next compliance export**: run
  Admin → Records & Export → Download audit workbook; the "Temp Passwords" tab lists
  username + temp password. They are included **once** and then cleared from settings.
- Share each temp password securely with its church/zone leader. **The forced-password-
  change gate is currently DISABLED** (`MUST_CHANGE_PASSWORD_ENFORCED = false` in
  `src/api/http/express-adapter.ts`, by owner decision on 2026-07-11, same day it
  shipped — see `CLAUDE.md` "Forced password change"). The `mustChangePassword` flag is
  still set on these accounts and on any admin-set password, but nothing currently
  blocks a leader from using it indefinitely without ever changing it — a temp/admin-set
  password is **not** force-rotated on first login. Because of this, operational
  discipline is required in the meantime: choose strong, non-shared temp passwords and
  ask each leader to rotate their password manually after first login. Admin → Accounts
  can also reset any account's password (same non-enforced flag).

  Separately, note that changing a password does **not** currently revoke that user's
  existing signed session tokens — a session issued before a reset/rotation stays valid
  until its own 12h TTL expires, regardless of any password change made in the meantime.

Note: the temp passwords live in plaintext in `settings.lastTempPasswords` only between
rollover and the first export-or-view, then are wiped. Treat the audit workbook (which
carries them) as sensitive.
