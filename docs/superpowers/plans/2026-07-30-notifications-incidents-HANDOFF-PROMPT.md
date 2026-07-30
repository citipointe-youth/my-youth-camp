# HANDOFF PROMPT — notifications + incidents, post-review remediation

**Paste everything below the line into a fresh Claude Code session started in
`Project 9 - Camp Platform/youth-camp-platform-masterv2`.** Written 2026-07-30, immediately after
a deep review of the notification/web-push feature, a 100+-leader load assessment, and a review of
the incidents feature. Prod state in §2 was verified by querying Supabase directly, not read from
docs.

---

You are picking up remediation work on the **Youth Camp Platform** (`youth-camp-platform-masterv2`).
Read `CLAUDE.md` first — all of it is relevant, but especially the new
**"Notification hardening before the check-in warning is switched on — 2026-07-30"** section, which
documents work already done and sitting uncommitted in the working tree.

Your job, in order: **(1) ask the owner the clarifying questions in §5 before writing any code that
depends on them, (2) verify the completed work in §1 still passes, (3) implement §3 and whichever
of §4 the owner approves, (4) update the trackers.** Use the subagent fan-out plan in §7 to keep
token use down.

## 0. ⚠️ Read these five operational facts before touching anything

1. **The working tree has ~19 uncommitted files of finished, tested work** (§1). Nothing is
   committed, and `HEAD == origin/master`.
2. **This repo auto-deploys to production on push to `master`.** There is no PR workflow and no
   staging. A commit + push IS a prod release.
3. **Migration `0018` MUST be applied to prod BEFORE that push.**
   `supabase.notifications.save()` writes `target_user_id` on every save, so until the column
   exists *every* notice write fails — including `incident.service.log()`, which is in active use.
   Apply, then reconcile the history row (see `CLAUDE.md` §4.6 of the web-push design: the MCP
   `apply_migration` tool records a generated timestamp version, so follow up with
   `update supabase_migrations.schema_migrations set version='0018' where version='<generated>'`).
4. **Do NOT apply migration `0014`** (the `pg_cron` push tick). It is committed but deliberately
   unapplied, and it must stay that way until the per-tick send cap in §3.3 exists AND
   `CRON_SECRET` is set in both Vercel and Supabase Vault. Applying it early means every tick
   fires silently into a 404 or 401 — `pg_net` is fire-and-forget and surfaces nothing.
5. **If you spawn subagents with `isolation: "worktree"`, they will NOT see the uncommitted work**,
   and this repo has a known gotcha where a worktree agent can silently base on the wrong commit —
   verify by commit hash, never by branch name. Either commit first, or keep subagents
   non-isolated. Prefer non-isolated read-only subagents for audits (§7).

## 1. Already done — verify, don't redo

Uncommitted in the working tree. **Baseline to re-establish before you change anything:**
`npm run typecheck` clean, `npx vitest run` = **704 pass / 48 files**, and both
`public/index.html` (extract lines 834–6202) and `public/sw.js` pass `node --check`.
`sw.js` is at `camp-v55`.

Six review findings were fixed, each with regression tests:

| # | Fix | Files |
|---|---|---|
| 1 | **Per-login notice addressing.** New `Notification.targetUserId`; one clause in `canSeeNotification` sends a targeted notice to that login and **nobody else, deliberately including admin/director**. Fixes gender-scoped `b-`/`g-` logins each seeing both of each other's contradictory check-in counts, and admin/director seeing all 26 churches' warnings. | `core/entities/notification.ts`, `services/notification-visibility.ts`, `services/cron.service.ts`, `repositories/supabase/supabase.notifications.ts`, migration `0018` |
| 2 | **Check-in warnings expire** at the window they warn about. New `zonedToInstant()` (inverse of `zonedNow`) + `ChurchBehind.windowEndAt`. | `utils/date.ts`, `services/checkin-warnings.ts`, `services/cron.service.ts` |
| 3 | **Feeds order by publish time** (`scheduledFor ?? createdAt`) via new `publishedAt`/`byPublishedDesc`. A notice scheduled days ahead used to publish *buried* below anything sent in the meantime — and Home renders only `feed.slice(0,3)`, so it could publish without appearing on Home at all. | `services/notification-visibility.ts`, `services/notification.service.ts`, `services/dashboard.service.ts` |
| 4 | **`dashboard.service` now calls `canSeeNotification`** instead of a drifted hand-rolled copy that never implemented the `scheduledFor` withhold (it returned a future notice's title AND body early) and denied admin/director the see-all-scopes rule. | `services/dashboard.service.ts` |
| 5 | **Urgent-priority tooltip** no longer promises a full-screen alert that was deleted on 2026-07-26. | `public/index.html` |
| 6 | **`newYear` deletes push subscriptions** — `reset()` did, `newYear` was relying by accident on the users FK cascade (works on Supabase, not in-memory). | `services/admin.service.ts` |
| + | In-memory notification repo now enforces the `dedupe_key` partial unique index and raises a real SQLSTATE `23505`, so the scheduler's dedupe exists outside Postgres; `clearAll` throws `ForbiddenError` not a bare `Error` (was a 500). | `repositories/in-memory/in-memory.repositories.ts`, `services/notification.service.ts` |

**Invariants these fixes established — do not "simplify" them away:**
- `notification-visibility.ts` is the **single** source of audience + ordering rules. Two copies
  drifted once already (finding 4). Do not inline them anywhere.
- `target_user_id` must stay in `notifColumns`, `toNotif` **and the on-conflict `do update set`
  list**. Dropping it from the last one makes the value silently never persist — this repo has that
  exact bug class three times in its history.
- `zonedToInstant` is computed inside `warnWindow`, where the camp timezone is in hand. A caller
  that re-derives it is how the UTC-vs-Brisbane bug (which has hit this repo twice) comes back.

## 2. Verified production state (2026-07-30, project `nwfafrgojqkxylbppywo`)

This is the single most important context: **the notification scheduler has never run in prod.**

| | |
|---|---|
| `pg_cron` / `pg_net` installed | **No** (`installed_version: null` both) — migration `0014` never applied |
| Notices created by the scheduler (`dedupe_key not null`) | **0** |
| `push_sent_at not null` / `push_subscriptions` rows | 0 / 0 |
| Migration `0018` applied | **No** |
| Notifications | 8, all human-authored, **all 8 with `expires_at` null** |
| Scheduled notices | 1 used, 0 still pending |
| **Incidents** | **6, using both `low` and `high`** — this feature IS in real use |
| Accounts | **30 active; 26 church logins across 13 churches = exactly 2.0 per church** (the `b-`/`g-` pair) |
| People | 202 (183 students, 19 leaders) — registration still open, camp is late September |
| `check_in_history` / `sign_out_history` | 0 / 36 (camp hasn't happened) |

Two consequences worth internalising:
- Phases 1–3 of the web-push design are merged but **inert**. Nothing about notifications has
  changed behaviour in prod yet. The check-in warning — the one piece of real value that needs no
  push infrastructure — is built, tested, deployed and switched off.
- The fan-out unit for push is the **device/endpoint, not the account**:
  `push_subscriptions` is keyed on `endpoint` so several leaders sharing `b-victory` each register
  their own phone (design decision D5). 26 logins × ~4 leaders ≈ **100+ endpoints from 26
  accounts.** "100+ leaders notified at once" is real at the device level.

## 3. Implement now — approved, no clarification needed

### 3.1 Drop `invalidateDashboardCache()` from `checkIn` and `signEvent` (highest value, one line each)
`services/person.service.ts` (~lines 299–320). That function wipes **every** cache entry globally.
The dashboard cache is keyed on `(role, churchId, zone, genderScope)` — **not per device** — so
100+ devices collapse to only ~30 distinct keys, a ~4:1 ratio that would absorb a check-in burst
almost entirely. Instead, every single check-in tap flushes the cache for everyone, precisely when
every device is loading `/home`. A 30-second-stale "still to check in" count during a rush is
harmless — the leader is on the roster screen, not the dashboard.
Confirm with a test that the count still refreshes within the 30s TTL.

### 3.2 Scope `/home` for church logins
`services/dashboard.service.ts` at-camp branch calls `personRepo.findAll()` → three unbounded
queries (`people`, plus **all** of `check_in_history` and `sign_out_history`) for every actor. A
church login can see ~30 students and pays for all of them. At camp that's ~700 people and ~3,500
history rows per uncached request. Use `findByChurch` for `role==='church'`, mirroring the existing
`_scoped` work already done for `/registrants` and `/campers`.
⚠️ Keep `canAccessPerson` as the actual gate — gender scoping must still apply. Verify the church
dashboard numbers are unchanged by the switch.
**Do not optimise the field decryption:** measured at 34ms for 700 people × 10 fields. Row volume
is the cost, not AES.

### 3.3 Cap push fan-out per tick — **before `0014` is ever applied**
All 26 church logins hit their window boundary together, so one tick generates up to 26 notices →
~104 pushes in a single serverless invocation with `maxDuration: 30`. At concurrency 10 and
~325ms/send that is ~8.5s plus cold start; at 6 devices/church (~156 sends) ~13s. Because the
`push_sent_at` claim is taken **before** sending, a timeout loses those pushes **permanently**.
Cap at ~40 sends per tick and let the next tick continue — the 60-minute lead window gives 12
ticks (~480 capacity). The claim makes continuing safe. This is a guard to write now even though
the sender itself is unbuilt, so the cap exists before anyone switches the tick on.

### 3.4 Validate `zone` on incidents
`CreateIncidentSchema` takes `zone` as free text. A typo silently mis-files a safeguarding record
and renders as garbage. Restrict to `ZONE_NAMES` (`['Yellow','Blue','Black','Red']`,
`core/types/enums.ts`). **Leave the cross-zone-attribution behaviour alone for now** — it is
covered by an existing passing test (`incident.service.test.ts:51`, "an explicit zone overrides the
actor zone") and changing it is question §5.4.

## 4. Implement only if the owner says yes (see §5)

- **4.1 Incident review state** — `reviewedAt`/`reviewedBy` + optional outcome note, settable by
  director/admin. This is the biggest *usefulness* gap: low-severity incidents are for an
  end-of-day review, but an incident carries no state, so a director re-reads the same
  undifferentiated list every evening with no record of what has been actioned. Needs migration
  `0019`. (Q §5.1)
- **4.2 Server-side acknowledgement of high-severity alerts** — "Got it" writes only to
  `localStorage['cp_dismissed_notices']` on that one device. There is no server record that the
  director ever saw a safeguarding alert, the same person on a second device sees it again, and the
  audit workbook's Incidents sheet has no acknowledgement column. Needs migration `0019` and an
  audit-export column. (Q §5.1)
- **4.3 Zone-scope `incident.list()`** — every `zoneLeader` currently reads every zone's incident
  summaries, including ones naming minors they have no relationship to. This is the one place the
  app abandons the `canAccessPerson`/`canAccessChurch` discipline it applies everywhere else, on
  its most sensitive record type. May well be intended. (Q §5.2)
- **4.4 Soft-delete incidents** — an append-only safeguarding record can currently be hard-deleted
  by admin/director with nothing recording that it existed; the workbook export silently loses it.
  (Q §5.3)
- **4.5 `occurredAt` on incidents** — only the logging time is recorded. "When did this happen" is
  recoverable only from free text. (Q §5.1)
- **4.6 Expire incident alerts** — the `leadersOnly` notice never expires; prod has 2 sitting
  permanently. (Q §5.1)
- **4.7 Incidents unreachable pre-camp** — `RENDER.incidents` was deliberately made
  mode-independent (2026-07-18 revert) but the only route to it is the at-camp home tile, so the
  revert's intent isn't actually delivered (`public/index.html:1975` admits this).
- **4.8 Jitter push sends** so 100+ devices don't all open the app in the same 5 seconds. Only
  matters if push ships (Q §5.5).
- **4.9 Dead cost** — `estimateAudience` runs a full people scan on every send to compute
  `audienceEstimate`, which **nothing reads**; `churchRepo` is injected into
  `makeNotificationService` unused. Pure cleanup, touches container wiring.

## 5. Ask the owner these BEFORE writing dependent code

Ask them together, early, in one go. Do not guess — several change what gets built.

1. **Incidents workflow.** You described high severity as "in the moment" and low as "end-of-day
   review". Should incidents get **review state** (reviewed by / when / outcome), a **server-side
   acknowledgement record** for high-severity alerts, and an **`occurredAt`** field? All three
   serve that workflow and share one migration. Which do you want? (§4.1, 4.2, 4.5, 4.6)
2. **Should a zone leader see other zones' incidents?** Currently yes, camp-wide. Intended, or
   should it be own-zone with director/admin seeing all? (§4.3)
3. **Should deleting an incident be reversible/auditable** (soft delete) rather than a hard
   delete that vanishes from the audit workbook? (§4.4)
4. **Should a zone leader be able to file an incident against a different zone?** Currently allowed
   and enshrined in a test; `canSendNotification` restricts the equivalent for notices. (§3.4)
5. **Is web push actually shipping for this camp, or is the in-app notice the whole feature?**
   This is the big one. Phases 4–6 (VAPID, subscribe API, service worker, opt-in UI, sender,
   pruning) are ~all the remaining work and carry all the privacy surface plus the iOS
   Add-to-Home-Screen adoption problem the design itself names as the biggest risk. The
   alternative — **turn the check-in warning on as in-app only** — delivers its whole operational
   value with zero new personal data and zero third-party involvement.
6. **If yes to 5:** the four organisational questions in the design's §12 (third-party transfer
   posture, under-18 account holders, privacy-notice ownership, who delivers the iOS install
   comms) still gate rollout to real leaders and are not answered.
7. **Turning the tick on.** Enabling the check-in warning needs `CRON_SECRET` in Vercel (**by hand
   — the Vercel MCP server has no env-var tool**), the same value in Supabase Vault as
   `cron_secret`, then migration `0014`. Do you want that done this session, after §3 lands?

## 6. Repo gotchas that will bite you

- **`tsconfig` must emit CommonJS.** Switching to `ESNext`/`Bundler` makes `@vercel/node` crash on
  load. Not caught by `tsc` or `vitest`.
- **`.gitignore`'s `/data/` rule must stay anchored** or `src/data/seed.ts` silently leaves git and
  the git auto-deploy fails with "Cannot find module './data/seed'".
- **Any change to `public/index.html` requires bumping `CACHE` in `public/sw.js`** (currently
  `camp-v55`) — iOS standalone PWAs are documented as lazy about picking up a new worker.
- **`supabase.settings` writes ALL settings columns on every save**, so any migration adding a
  settings column must be applied to prod BEFORE the code push. (`0018` touches `notifications`,
  but the same rule applies there because `save()` writes every column.)
- **`.sched-row .sr-t` vs `.sched-row .fld` are equal specificity** — source order decides. Not
  relevant to this work, but don't reorder that CSS.
- **Migration history drift on `0009`–`0012`** (recorded under generated timestamp versions) is a
  known, deliberately-unfixed issue: a `supabase db push` would try to re-run them. Use the MCP
  `apply_migration` + manual version reconciliation, not `db push`.
- New optional fields on schemas the SPA posts to should be **`.nullish()`, not `.optional()`** —
  Zod's `.optional()` rejects an explicit `null` and the SPA sends nulls.
- `node --check` the SPA by extracting **lines 834–6202** of `public/index.html`. A naive
  `<script>…</script>` regex fails because the file contains the literal string `</script>`.

## 7. Subagent fan-out plan — spend tokens where they buy something

Read `superpowers:dispatching-parallel-agents` before fanning out. **Constraint: two agents must
never edit the same file.** The streams below are file-disjoint. Do not use
`isolation: "worktree"` unless you commit first (§0.5).

**Fan out these in parallel, read-only, cheap models — they are grep-and-report work with no
judgement calls:**

| Task | Model | Why it's safe to delegate |
|---|---|---|
| Audit all ~30 `invalidateDashboardCache()` call sites; for each, report whether the write can actually change a dashboard DTO field, so §3.1 can be generalised beyond `checkIn`/`signEvent` | `haiku` | Mechanical: read call site, compare against the `AtCampDashboard`/`PreCampDashboard` field list. Returns a table. |
| Hunt for any OTHER hand-rolled duplicate of an audience/scoping rule (the `dashboard.service` copy was found by accident; `canAccessPerson`, `canAccessChurch`, `canSeeNotification`, `redactSensitive` are the canonical ones) | `sonnet` | Pure search + judgement about whether a filter duplicates a canonical rule. High value, found a real bug last time. |
| Find every per-request handler that calls an unbounded `findAll()` on `people`, `notifications`, `notes` or `incidents`, and report the actor roles that reach it | `haiku` | Mechanical trace from `router.ts` → controller → service. |
| Verify the 2026-07-30 CLAUDE.md section matches the actual diff (no claim in it is unsupported by code) | `haiku` | Cheap doc/code consistency check; this repo has a documented history of prose describing unbuilt work. |

Use the `Explore` agent type for the search-heavy ones — it reads excerpts rather than whole files,
which is the point.

**Do these yourself, in the main session, sequentially — do NOT delegate:**
- Anything touching `notification-visibility.ts` (single source of truth; §1 invariants).
- The migration ordering and the prod apply of `0018` (irreversible, needs the history
  reconciliation, and a mistake breaks every notice write).
- §3.1 and §3.2 — they are adjacent (`person.service.ts` + `dashboard.service.ts` +
  `dashboard.service.test.ts`) and the second changes numbers the first's test asserts.
- The §5 clarifications and any §4 design that follows from them.
- The final CLAUDE.md / `debug.md` / `CHANGELOG.txt` update — single writer, last.

**One sequential implementation subagent is worth it for §4.1/4.2/4.5 if approved** (incidents:
entity, schema, service, controller, repo mappers, migration `0019`, SPA screen, audit-export
column) — it is a coherent, file-disjoint slice from everything in §3. Give it the owner's answers,
`sonnet` or `opus` depending on how much of 4.1–4.6 was approved, and require it to return
`typecheck` + test output. Do not start it before §5 is answered.

## 8. Definition of done

- `npm run typecheck` clean; `npx vitest run` green with **new tests for every §3/§4 change**
  (704 is the current floor, and state the new number).
- `public/index.html` (lines 834–6202) and `public/sw.js` pass `node --check`; `CACHE` bumped if
  `index.html` changed.
- Migration `0018` (and `0019` if built) applied to prod **before** the push, each with its
  `schema_migrations` version reconciled and verified present by a query.
- `CLAUDE.md` updated (append to the 2026-07-30 section, don't start a competing one),
  `debug.md` symptom-router entries added, `CHANGELOG.txt` dated entry.
- The §5 answers recorded in `docs/PLANNED-IMPROVEMENTS.md` so the reasoning isn't lost.
- Report honestly what was left out and why. If the owner declined something, say so rather than
  quietly building it.
