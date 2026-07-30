# Prompt for a fresh Claude instance — paste this AFTER doing the Vercel/Supabase steps

Copy everything inside the box into a new Claude Code session in
`Project 9 - Camp Platform/youth-camp-platform-masterv2`.

Two variants below: **A** if you completed all of `docs/DEPLOY-NEXT-STEPS-2026-07-30.md`
including migration `0014`, or **B** if you did the env vars but want Claude to apply `0014`
and verify the whole chain.

---

## Variant A — "I did all four steps, verify and finish"

```
You are picking up the Youth Camp Platform (youth-camp-platform-masterv2).

Read CLAUDE.md first — especially the two 2026-07-30 sections ("Notification hardening
before the check-in warning is switched on" and "Notification hardening, part 2 — load
fixes, incidents, and web push SHIPPED"). Also read docs/DEPLOY-NEXT-STEPS-2026-07-30.md,
which is what I worked through, and docs/PLANNED-IMPROVEMENTS.md's 2026-07-30 section,
which records what I explicitly DECLINED — do not build those.

Context: the previous session shipped notification hardening + web push phases 4-6 to
production, applied migrations 0018 and 0019, and left everything inert pending my
configuration. I have now set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT and
CRON_SECRET in Vercel, put the same CRON_SECRET in Supabase Vault as 'cron_secret', and
applied migration 0014.

Supabase project: nwfafrgojqkxylbppywo. Production: https://my-youth-camp.vercel.app
This repo AUTO-DEPLOYS to production on push to master. There is no staging.

Your job, in order — do NOT change code until you have finished step 1 and told me what
you found:

1. VERIFY THE WHOLE CHAIN IS ACTUALLY LIVE. Check and report each of these separately,
   with the evidence, not a summary:
   a. Migration 0014's history row — is it recorded as version '0014' or under a
      generated timestamp? Reconcile it if it drifted (this project needs that after
      EVERY apply_migration; see CLAUDE.md).
   b. `select jobid, schedule, active from cron.job;` — is the tick scheduled and active?
   c. `select id, status_code, created from net._http_response order by created desc
      limit 10;` — are ticks actually landing? 200 = good. 401 = the two CRON_SECRET
      values don't match. 404 = wrong URL in the migration. EMPTY = the job isn't firing
      at all. pg_net is fire-and-forget, so this table is the ONLY place failures show up.
   d. `select count(*) from notifications where dedupe_key is not null;` — has the
      scheduler created any check-in warnings yet? (Expect 0 outside camp dates — camp is
      late September. That is correct, not a fault.)
   e. Confirm GET /push/config now returns configured:true.

2. If anything in step 1 is wrong, diagnose it before changing anything. The most likely
   fault by far is a CRON_SECRET mismatch between Vercel and Supabase Vault.

3. Once verified, do a REAL END-TO-END TEST of the check-in warning rather than trusting
   the unit tests. The tick only does anything on a camp day inside the warning window, so
   this needs the camp dates temporarily moved to today. Propose exactly how you'd do that
   and what you'd change back, and WAIT for my approval before touching settings —
   production has 202 real registrants and 30 live accounts.

4. Report honestly what is verified vs assumed. Do not tell me push "works" unless you
   have seen a 200 from a push service or a real notification arrive on a device.

Repo gotchas that will bite you (full list in CLAUDE.md):
- tsconfig MUST emit CommonJS or @vercel/node crashes on load.
- Any change to public/index.html requires bumping CACHE in public/sw.js (now camp-v56).
- node --check the SPA by extracting the <script> body — DERIVE the line range, don't
  hardcode it (it moved to 834-6393 this session). A naive <script>…</script> regex fails
  because the file contains the literal string </script>.
- New optional fields on schemas the SPA posts to must be .nullish(), not .optional().
- Migration history drift on 0009-0012 AND 0016-0017 (six rows under generated
  timestamps). Known. Don't run `supabase db push` — it would try to re-run all six.
- Baseline to beat: npm run typecheck clean, npx vitest run = 749 pass / 49 files.
```

---

## Variant B — "I did the env vars; you apply 0014"

Same as Variant A, but replace the "and applied migration 0014" sentence with:

```
I have NOT applied migration 0014 — you do it, but ONLY after you have proved the
preconditions, in this order:

  i.   Confirm GET /push/config returns configured:true (VAPID keys reached the build).
  ii.  Confirm `curl -i https://my-youth-camp.vercel.app/internal/cron/tick` returns 401.
  iii. Confirm the same curl WITH `-H "Authorization: Bearer <the secret>"` returns 200.
       Ask me for the secret value; do not guess it or read it from anywhere.
  iv.  Confirm the Vault secret exists:
       `select name from vault.decrypted_secrets where name = 'cron_secret';`

  Only if all four pass, apply supabase/migrations/0014_push_cron_schedule.sql via the
  Supabase MCP apply_migration tool, then IMMEDIATELY reconcile the history row:
    update supabase_migrations.schema_migrations
       set version = '0014' where version = '<the generated timestamp>';
  and verify it by selecting it back.

  If ANY of i-iv fails, stop and tell me which one. Applying 0014 early means every tick
  fires silently into a 404 or 401 forever — pg_net surfaces nothing, so it will look
  installed and do nothing.
```

---

## If something is broken and you need to roll back

The previous production deployment is the "Schedule editor: copy day / paste day" build
(commit `17d4230`), marked as a rollback candidate in Vercel. Vercel → Deployments → that
one → "⋯" → **Promote to Production**.

Note the two new DB columns (`notifications.target_user_id`, `incidents.occurred_at`) are
**additive and nullable**, so the older build ignores them harmlessly. A rollback is safe
and needs no database change.
