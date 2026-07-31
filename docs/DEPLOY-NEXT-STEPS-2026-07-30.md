# Turning on alerts — your steps (written 2026-07-30, for the next morning)

Everything below is **yours to do by hand**, because the Vercel MCP server has no env-var
tool. Nothing here needs a code change: the code is already live in production and is
deliberately doing nothing until these values exist.

**Total time: about 15 minutes.** Do the parts in order — step 4 (the pg_cron schedule) is
the one that must go LAST, and doing it early fails *silently*.

---

## What's already done (you don't need to do these)

- ✅ Migrations `0018` and `0019` applied to production and verified.
- ✅ All the code deployed to `master` → production.
- ✅ Web push phases 4–6 built: subscribe API, service worker, opt-in card, sender, pruning.
- ✅ **`npm run typecheck` clean, 749 tests passing across 49 files.**

## What is deliberately switched off right now

| Thing | State | Turned on by |
|---|---|---|
| Web push | Inert — no keys | Step 2 |
| The 5-minute scheduler tick | Never runs — `pg_cron` isn't installed | Steps 3 + 4 |
| Check-in "window closing" warnings | Built, tested, never fired | Steps 3 + 4 |

Until you do these, the app behaves exactly as it did yesterday. There is no half-on state:
the "Alerts on this device" card doesn't even render while the keys are missing.

---

## Step 1 — Sanity check (1 min)

Open https://my-youth-camp.vercel.app and log in. You should see the app working normally
and **no "Alerts on this device" card** on the Home screen. That absence is correct — it
confirms the code is live and correctly detecting that push isn't configured yet.

If you see anything broken, stop and tell Claude before continuing.

---

## Step 2 — Add the VAPID keys to Vercel (5 min)

These sign your push messages.

> ⚠️ **The keypair originally printed here has been REDACTED and must never be used.**
> This repo (`citipointe-youth/my-youth-camp`) is **public**, so committing the private key
> published it. A fresh keypair was generated on 2026-07-31 and set directly in Vercel; it was
> never written to any tracked file. **Never paste a VAPID private key, `CRON_SECRET`, or any
> other credential into a file in this repo** — set it with `vercel env add` or the dashboard.

Generate a keypair with `npx web-push generate-vapid-keys`. You need three values:

```
VAPID_PUBLIC_KEY     <the public key it prints>
VAPID_PRIVATE_KEY    <the private key it prints — Sensitive>
VAPID_SUBJECT        mailto:youth@citipointechurch.com
```

**Where:** Vercel → team `citipointe-youth` → project `my-youth-camp` → Settings →
Environment Variables.

For each of the three:
1. Add the name and value exactly as above.
2. Tick **Production** *and* **Preview**. (A preview deploy that can't sign will 500 the
   cron — tick both.)
3. For `VAPID_PRIVATE_KEY` **only**, mark it **Sensitive**.

Then **redeploy** — env vars only reach a *new* build. Deployments → the latest one → "⋯" →
**Redeploy**.

> **Losing the private key is not a data-loss event.** Unlike `FIELD_ENCRYPTION_KEY` it
> decrypts nothing; it only authorises sending. But rotating it invalidates **every existing
> subscription** and forces every leader to re-subscribe, so don't rotate casually.

### Check it worked
Reload the app. The **"Alerts on this device"** card should now appear at the bottom of Home.
Tap **Turn on alerts**, read the consent text, allow the prompt — it should say "Alerts are
on for this device."

> **On iPhone the card shows install instructions instead of a button.** That's correct and
> unavoidable: **iOS gives no notification permission prompt at all until the app is added to
> the Home Screen.** See the note at the bottom — this is the single biggest adoption risk in
> the whole feature.

---

## Step 3 — Set `CRON_SECRET` in BOTH places (4 min)

This is a shared password the scheduler uses to prove a tick request is really yours. It must
be **the same value in two places** or every tick silently fails.

Pick any long random string — e.g. run this and copy the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**3a — Vercel:** add `CRON_SECRET` = that value, **Production + Preview**, marked
**Sensitive**. Redeploy again (or do this before the step-2 redeploy and save yourself one).

**3b — Supabase Vault:** Supabase → project `nwfafrgojqkxylbppywo` → SQL Editor:

```sql
select vault.create_secret('PASTE_THE_SAME_VALUE_HERE', 'cron_secret');
```

The name must be exactly `cron_secret`.

### Check it worked
```bash
curl -i https://my-youth-camp.vercel.app/internal/cron/tick
# expect: 401  (good — it's guarded)

curl -i -H "Authorization: Bearer PASTE_THE_SAME_VALUE_HERE" \
  https://my-youth-camp.vercel.app/internal/cron/tick
# expect: 200 with a JSON body like
# {"ok":true,"checkinWarningsCreated":0,"failed":0,"pushAttempted":0,...}
```

**Do not go to step 4 until the second command returns 200.** That is the entire point of
doing them in this order.

---

## Step 4 — Apply migration `0014` — LAST (2 min)

This installs `pg_cron`/`pg_net` and schedules the tick every 5 minutes.

⚠️ **This must be last.** `pg_net` is fire-and-forget: if the secret is wrong or the route
isn't reachable, every tick fails **silently** — no error, no log, nothing in the app. You'd
have a scheduler that looks installed and does nothing. That's why it has sat unapplied.

Easiest path: ask Claude to apply `supabase/migrations/0014_push_cron_schedule.sql` via the
Supabase MCP **and reconcile the history row afterwards** (this project records a generated
timestamp instead of `0014` — see the prompt in the companion file, which covers this).

### Check it worked
After ~10 minutes:

```sql
-- the job should exist and be active
select jobid, schedule, active from cron.job;

-- and it should be getting real HTTP responses, not silence
select id, status_code, created
from net._http_response
order by created desc limit 5;
```

You want **`status_code = 200`**. A `401` means the two secrets don't match. A `404` means
the URL in the migration is wrong. **An empty table means the job isn't firing at all.**

---

## Then: what actually starts happening

1. **Check-in window warnings.** ~60 min before a check-in window closes, any church login
   with students still unchecked gets a notice — addressed to that **specific** login, so
   the boys' and girls' accounts each get their own correct count. It expires when the window
   closes.
2. **Push notifications** for those warnings, for high-severity incident alerts, and for
   scheduled notices — but **only to devices that have opted in**, and only ever saying
   "open the app." No student name, no medical or incident detail, ever reaches a lock screen.

Nothing fires outside camp dates, so between now and late September this will be quiet. To
test it properly, either wait for camp or temporarily set the camp dates to today.

---

## ⚠️ The thing to actually worry about: iOS adoption

**On iPhone, a leader gets no notifications at all until they add the app to their Home
Screen and open it from there.** There's no way around it — Apple gives web apps no
permission prompt in a normal Safari tab. This is a **communications problem, not a code
problem**, and it's the design's own stated biggest risk.

Before camp, someone needs to tell leaders — in the channel they actually read — to install
the app and tap "Turn on alerts." `public/install.html` (linked from the card and the login
screen) has the instructions. **Assume alerts reach roughly the fraction of leaders who
complete that, and make sure nothing safety-critical depends only on a push.** The in-app
notice is the guaranteed channel; push is the nudge.

## ~~Four questions still unanswered~~ — ALL ANSWERED 2026-07-31

Recorded in `docs/PLANNED-IMPROVEMENTS.md` (2026-07-31 section). In short: metadata transfer
**accepted**; **no** under-18 login holders (all are compliance-trained leaders); the **youth team**
owns the privacy/compliance update; iOS install happens at the **pre-camp training day**.
Nothing organisational gates rollout now. The original questions, for context:

1. **Third-party transfer posture.** Every push transits Apple, Google or Mozilla. They can't
   read the payload (it's end-to-end encrypted) but they do see the endpoint, exact timing and
   message size on every send. Does the church have a position on that? Note the subjects of
   that metadata are **leaders, not minors**.
2. **Is any account holder under 18?** A leader account bound to a minor's personal device
   changes the consent picture.
3. **Who owns and publishes the privacy notice** covering the device registration?
4. **Who delivers the iOS install comms**, and when?

None of these block the technical steps above. All of them should be answered before you tell
real leaders to switch alerts on.
