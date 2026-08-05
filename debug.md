# debug.md — Youth Camp Platform debugging map

> Companion to `CLAUDE.md`. Point Claude at **both** files when reloading context for a bug.
> CLAUDE.md = system/architecture/contract. This file = "where does this symptom live?"
> Don't duplicate CLAUDE.md here — it already covers the SPA↔backend contract, presence
> invariants (atCamp vs lifecycle), RBAC model, camp-mode behaviour, and deploy gotchas.

## How to use this file (per bug set)

1. Read `CLAUDE.md` + this file. **Don't read anything else yet.**
2. From the **symptom router** below, jump to the one function/file that owns it.
3. **Confirm line numbers by Grep on the symbol name** — line numbers here are approximate
   (snapshot 2026-06-26) and drift as the file changes. The *names* are stable; grep them.
4. Read only that function's range. Most SPA bugs are one function in `public/index.html`.

> **Don't re-grep the whole map on reload** — line numbers only drift when `index.html` is
> edited, and the per-symbol grep in step 3 self-corrects where the current bug is.
> **Maintenance rule:** when a fix shifts offsets in `index.html`, update the affected line
> numbers in this file *as part of that fix*, so the map is correct at the next reload.

> **Verify & deploy conventions (this repo) — do NOT:**
> - **Start a localhost dev server or drive a browser to test.** Verify with `npm run typecheck`
>   + `npm run test` and reasoning/grep only. CSS/layout changes can't be fully proven this way —
>   make the change and tell the user to eyeball it on-device.
> - **Check the Vercel deployment** *for an ordinary push*. GitHub is linked to Vercel; a push to
>   `master` auto-deploys, so pushing is normally the deploy.
>
> **⚠️ EXCEPTION, added 2026-07-31 — if you are about to ask the owner to TEST ON A DEVICE, verify
> the deploy landed first.** A push reached `origin/master` and Vercel **never created a deployment
> for it**; prod served the old build twenty minutes later and the owner's test screenshots were of
> a build without the fix, which nearly read as "the fix doesn't work". (Same webhook miss recorded
> in CLAUDE.md on 2026-07-17.) One command:
> `curl -s https://my-youth-camp.vercel.app/sw.js | head -1` → confirm the `camp-vNN` you just
> shipped. Or grep the live HTML for a symbol you just added. Recovery: an **empty commit** to
> produce a fresh push event (built in ~30s). `vercel deploy --prod --yes` is the CLI fallback.

### Per-set input template (what to give Claude each time)

```
Read CLAUDE.md and debug.md. Don't read other files yet.
Account: <username> (role: church | zoneLeader | director | admin | firstAid)
Mode: <pre-camp | at-camp>
Bug(s):
1. <symptom — what you saw vs expected>
```

Role + mode are the two variables that decide *expected* behaviour. Use the grid below to
check "expected vs actual" before touching code.

---

> **Improvement Initiative Phases 1–7 (deployed 2026-06-28) — read this before trusting line numbers below.**
> The SPA grew substantially. Key structural changes (grep the symbol, don't trust offsets):
> - **Single nav source:** `navModel(role,mode)` → `{tabs,extras}`; `navSidebar(role,mode)`;
>   `buildTabs` and `_renderWideNav` BOTH derive from these. "Wrong/empty tab or sidebar" → `navModel`.
> - **Budget rebuilt:** `RENDER.budget`/`drawBudget`/`computeBudgetClient`/`exportBudget`/`_budToggle`
>   (mirror of pure `src/services/budget.ts`). "Budget number wrong" → `budget.ts` first (it's tested),
>   then `computeBudgetClient`. Prices are per-registrant `registrationCost`, NOT settings.
> - **Accommodation split (PC-10/C-1):** `accomChurches`/`accomGroups` (+ `_accomGenderGroups`,
>   `_bracketOfGrade`) mirror backend `computeGroups`; pool >50 splits into `…|gender|7-9` / `|10-12`.
>   Requires migration 013 (`bracket` column on `classroom_allocations`).
> - **Icons:** SVG-only; `ic/icSm/icLg/icXl`, `emptyState`. "Blank icon" → key missing from `ICONS`.
>   **⚠ TDZ gotcha:** `ACC_LABEL` (uses `icSm`) must be declared AFTER `const ICONS`. If `ACC_LABEL`
>   appears before `ICONS` in the script, the whole script crashes silently at boot → white screen after
>   login. Fixed 2026-06-30: `ACC_LABEL` moved to immediately after the `ICONS` closing brace.
> - **Type scale / breakpoints:** `:root --t-*` tokens; root font scales at 768/1280; breakpoints
>   540/768/900/980/1280. "Text too small/large" or "doesn't scale" → these.
> - **sw.js `camp-v7`**, `API_RE` now includes `/export`.

> **Admin bug batch + offline sign-in + director digest (deployed 2026-07-04) — read this
> before trusting line numbers in the Admin/At-camp tables below.** Structural changes:
> - `RENDER.adminFaq`/`RENDER.adminDevos`/`RENDER.adminSchedEdit` **no longer exist**. Schedule/
>   FAQ/Devotionals are one merged screen, `RENDER.atCampInfo(sub)` — grep that name, not the old
>   three. Content builders `_acFaqBody`/`_acDevosBody`/`_acScheduleBody` hold what used to be
>   each RENDER function's body. `WIZARD_STEPS`' schedule/devos/faq rows now carry an `arg` field
>   and route via `go('atCampInfo', arg)`.
> - `RENDER.admin` (console) tiles are grouped under three headings — grep `RENDER.admin=function`
>   for the current order, don't trust a remembered tile list (it was re-ordered once already the
>   same day it shipped, per follow-up feedback).
> - New symbols: `localDateISO()` (Brisbane "today", replaces raw `toISOString().slice(0,10)`
>   calls), `_wizardChipHtml`/`_wizardGo` (setup-wizard return chip), `_pulseGoToChurch`
>   (zone-leader per-church pulse tap target), `_digestCardHtml`/`_renderDirectorDigest`
>   (director/admin home digest), `_paidOrCostRow` (Paid/Cost field), `_offlineSignInCardHtml`/
>   `downloadOfflineSignInTemplate`/`offlineSignInUpload` (offline sign-in sheet).
> - Backend gained its first `PUT` route (`PUT /schedule/day`) — `Route`/`BufferRoute` method
>   unions and the Express adapter's method cast now include `'put'`; if a future PUT route 404s,
>   check those two spots weren't reverted.

> **At-camp bug batch (deployed 2026-07-24) — new/changed symbols (grep the name):**
> - **`gbadge(c)`** (near `ZONE_COLORS`) — grade/gender badge ("Y11"/"LDR") drawn to the LEFT of a
>   name on the check-in `rowHtml` AND My-group `myRow` rows (`.gbadge.male/.female/.leader` CSS).
>   "Badge missing/wrong colour on a row" → here. The old initials bubble (`.av`) is gone from
>   those two rows (still used on `openCamper`'s detail header).
> - **`_actingName()`** (by `_isChurchAccount`) — the name attributed to sign-in/out, notes and
>   testimonies (church → `LEADER_INITIALS`, else `ACTOR.displayName`). The typed "Your name" input
>   is GONE from `signOutPrompt`/`signOutReview`, `signInPrompt` (now one-tap for all roles),
>   `notePrompt`/`reviewNote`, and `submitTestimony`. **Only the first-aid log form asks a name.**
>   "Sign-out/note logged under the wrong name" → `_actingName`.
> - **`parentsMet` fully removed** (item 1). No more Yes/No control, no `soPm`/`window._soPm`, no
>   `signInConfirm`. Backend: `SignOutEvent`/`checkin.schema`/`attendance.controller`/
>   `supabase.people`/`audit-export` no longer reference it; migration `0012` drops the column.
> - **`_renderDailyCheckin`** gained `CUR_ID` + `sessionLocked` (item 4): church logins browse every
>   session but only the current one (marked `•`) is editable; a non-current session shows a
>   view-only banner + greyed status pills. `rowHtml(c)` dropped its unused 2nd arg.
> - **`search.service.search()`** (backend) now returns cross-church/cross-gender hits for
>   church/zoneLeader, redacted via **`redactSensitive()`** outside `canAccessPerson` scope (items
>   6/10). "Church sees another church's medical" → `redactSensitive`; "church can't find another
>   church's student" → the visibility branch in `search()`.
> - **`RENDER.students`** resets `STUDENTS_SUB='mygroup'` on open (item 8); seg label
>   "Other churches"→"All churches" (item 7). **`RENDER.devotional`** defaults to `localDateISO()`
>   and greys non-today days (item 12). **`renderHomeAtCamp`** hero tinted by `ZONE_COLORS[ACTOR.zone]`
>   for zoneLeader/church with the role subtitle removed (item 13).
> - **Follow-up (`camp-v35`): "Not signed in" moved from `_renderDailyCheckin` to `filterMyYouth`**
>   (My-students screen) as a `<details>` dropdown via new **`_loadMyNotSignedIn()`**; "Signed out
>   of camp" is now a dropdown too (the old "Late arrivals" block is gone). The check-in load no
>   longer fetches `/campers`. `runSearch` findcard colours the church name by `c.gender`. "Not
>   signed in list wrong/empty" → `_loadMyNotSignedIn`; "signed-out not collapsible" → `filterMyYouth`.
> - **Follow-up 2 (`camp-v36`): scroll preservation on roster actions.** `paint()` keeps scroll on a
>   clean same-screen repaint, but a repaint through an empty/loading shell clamps it. Fixes:
>   **`_rCheckin()`** wraps the check-in action re-renders (`_performCheck`/`undoCheck`/`drainQueue`/
>   `_retryFailedCheckins`; `selDay`/`setFilter` intentionally still reset); **`_refreshAfterAttendance`**
>   (now async) captures/restores the screen scrollTop around `_navTo` (My-students sign-in/out);
>   **`fdDraw`** captures/restores around its `innerHTML` swap (first-day arrival tick/confirm).
>   "Roster jumps to top after check-in/sign-in" → these three. Also **`signInConfirmList`** adds a
>   confirm before signing in from the My-students "Not signed in" list (profile + arrival stay one-tap).
> - **Follow-up 6 (`camp-v42`): phone shell converted to YS Connection body-scroll (bottom-nav float
>   fix).** PHONE now uses natural body-scroll: `.bar` is `position:sticky;top:0`, `.stage` is plain
>   `flex:1`, `.screen` is an in-flow block (NOT `position:absolute;overflow-y:auto`), so the **body**
>   scrolls and the `position:fixed` `.tabs` anchors to the real iOS viewport bottom (the fix for the
>   "nav floats above the home indicator" bug — Follow-ups 3–5 were insufficient). The **≥980px block
>   re-establishes internal-scroll** (`html,body{height:100dvh;overflow:hidden}`, `#stage{overflow:hidden}`,
>   `#stage .screen{position:absolute;inset:0;overflow-y:auto}`, `#bar{position:relative}`) so desktop
>   is unchanged. Because the scroll container differs by layout, **`_scroller(el)`** (`_isWide()` →
>   screen el on desktop, `document.scrollingElement` on phone) now backs every scroll save/restore:
>   `_spinner`, `paint`, `_rCheckin`, `fdDraw`, `openCamper`, `_refreshAfterAttendance`. `_navTo` resets
>   document scroll to top on phone navigations (one shared document scroll now). "Nav floats / black
>   strip below nav on iPhone" → the phone `.stage`/`.screen`/`.bar`/`.tabs` rules; "screen scrolls but
>   nav wrong on desktop, or list jumps to top after an action" → `_scroller`/the ≥980px block.
> - **Follow-up 7 (`camp-v43`): overlays re-pinned to the viewport (`position:absolute`→`fixed`).**
>   The body-scroll conversion made `.app` grow with content, so overlays that were `position:absolute`
>   children of `.app` anchored to the bottom of the tall page. Fixed: **`.toast`** (now
>   `position:fixed`, floats near the TOP — `top:calc(safe-area+60px)` — was `bottom:88px`; the
>   reported "incident notification at the very bottom" bug), **`.modal`** (`#modal` bottom sheet),
>   **`.ig-wrap`** (`#impGuide`), **`#login`/`#mcpGate`**. `#nprog` lives in the sticky `.bar`, not
>   `.app`, so it was fine. **GOTCHA:** any NEW full-viewport overlay/toast MUST be `position:fixed`
>   — the phone `.app` is not viewport-height, it grows with scrolling content. "Toast/modal/gate
>   appears at the bottom of the page or off-screen" → this class of bug.

> **2026-07-26 batch (incident alerts, overlay stacking, preview phases) — new/changed symbols
> (grep the name):**
> - **`_isIncidentNotice(n)` / `_noticeFeed(feed)` / `_urgentAlerts(feed)` / `_alertBannerHtml(feed)`
>   / `_ackAlert(id)`** (declared just above `noticeCard`) — the incident-alert system.
>   `leadersOnly` is set by exactly ONE backend path (`incident.service.log`; everything else is
>   created `leadersOnly:false`), so it is the reliable "raised by an incident" marker.
>   `_noticeFeed` is the single filter every notice LIST renders through — home AND `RENDER.notifs`.
>   `_alertBannerHtml` is the single ALERT surface: the bottom-sheet modal path
>   (`_checkUrgentNoticesFromFeed`/`checkUrgentNotices`/`_ackUrgent`) is **deleted** as of `camp-v45`
>   and every unacknowledged urgent notice — incident or human-sent — renders in the top banner.
>   Acknowledgement is **per device** (`localStorage`, shared `_DISMISS_KEY` store) — by design,
>   not a bug if a second device re-alerts.
> - **`_previewPhase` + `switchPreviewPhase()`** replace `SETTINGS.campDay` + `switchDay()`, both
>   **deleted**. `campPhase()` returns `_previewPhase` outright while `PREVIEW_MODE` — ahead of the
>   time rule AND the admin's `checkinPhaseOverride`. Header badge (`#dayBadge`) reads
>   "Sign-in ›"/"Through camp ›". `isDay1` is forced `true` in preview so BOTH the First-Day button
>   and the Daily Check-in tile always render, one greyed.
> - **Z-INDEX LADDER (new, documented in the CSS above `.modal`):** nav `.tabs` 100 < `.modal`/
>   `.ig-wrap` 120 < `.toast` 130 < `#login`/`#mcpGate` 140 < `.htip-pop` 200 < `#undoToast` 9999.
> - **`.inc-banner`/`.inc-row`/`.inc-txt`/`.inc-ack` CSS** (above `.notice`); **`html{background:#fff}`**
>   (canvas colour, the bottom-strip fix); **`.sched-row .fld`** (compact editor rows);
>   **`.setg input[type=time|date|number]`** (capped settings fields).

> **2026-08-01 review fixes + budget cards + viewport jitter — new/changed symbols (grep the name).
> Full rationale: CLAUDE.md, the two 2026-08-01 sections at the top.**
> - **"A push notification never arrived" → `src/services/push.service.ts` FIRST, and check the
>   Vercel runtime log for `[push] notice … NOT SENT`.** Three separate reasons a notice legitimately
>   does not push, in the order to rule them out: (1) `isPushable(n)` — **normal priority is in-app
>   only**, only urgent/incident/check-in-warning notices push at all; (2) the per-tick cap
>   `MAX_PUSH_SENDS_PER_TICK` (40) deferred it to a later tick — normal, it is not lost; (3) its
>   audience exceeded `PUSH_ABSOLUTE_MAX_SINGLE_NOTICE_SENDS` (400), which logs `NOT SENT` and is a
>   real defect. ⚠️ Do NOT diagnose this by reading `push_sent_at` alone — the claim is taken BEFORE
>   sending, so a claimed row does not prove delivery.
> - **`PUSH_TICK_BUDGET_MS` / `PUSH_SEND_CONCURRENCY` / `PUSH_JITTER_MS`** — the tick's time budget.
>   If you change any of them, redo the arithmetic in the block comment: the old code was sequential
>   with a per-send jitter sleep and needed ~93s against a 30s `maxDuration`, silently and
>   permanently dropping the unsent remainder. The timing tests in `push.service.test.ts` use fake
>   timers and a stubbed send latency — **a test that stubs `sleep` to a no-op cannot catch this.**
> - **`canSeeNotification` now checks `expiresAt`** (`notification-visibility.ts`). Still the ONE copy
>   of the audience rules, used forward (feed) and backward (push audience). "A leader sees/doesn't
>   see a notice they shouldn't/should" → this function, never a second hand-rolled copy.
> - **`submissionSortKey()`** (`elvanto-mapping.ts`) — orders Form-import rows by submission time.
>   Separate from `normalizeDate`, which stays DATE-ONLY by contract. "Duplicate registration merged
>   the wrong way round / cost looks like the older submission" → here. Same-day ties are reported to
>   the admin as *"could not determine order"* rather than silently guessing. Handles 12-hour times
>   (truncating the meridiem inverts the order — there are tests on the 12am/12pm boundary).
> - **Budget cards restructured** — `.budrow` (4-track grid: chevron | label | qty | amount),
>   `.budrow-det`/`.buddet*` (the tap-to-open detail panel), `.budchip-row`/`.budchip` (inline
>   per-church code chips). `CategoryRow.valueBreakdown` exists in BOTH `src/services/budget.ts` and
>   the SPA mirror `_budScopeRows`/`_budValueBreakdown` — change both together. "A budget row shows
>   the wrong people count or a blank unit price" → `_budScopeRows` (mixed rows report a breakdown,
>   never `× —`); "a per-church code count disagrees with the camp-wide panel" → they are the same
>   scoped computation, so suspect the SCOPE argument, not the counting.
>   ⚠️ **Superseded in part on 2026-08-02 — see the block below.** `.budrow-sub` and the
>   `grp('Campers'…)` two-list layout no longer exist.
> - **`_vpKickSoon(ms)` / `_vpKickReset()` / `_vpTries` / `_VP_KICK_SETTLE` / `_VP_KICK_VERIFY` /
>   `_VP_KICK_MAX`** — the viewport kick's scheduler. **"The pull-down jitters up and down rapidly"
>   → the kick is re-entering the resize it caused.** The kick changes layout → iOS fires
>   `visualViewport.resize` → that listener schedules another kick. Three guards keep it smooth and
>   all three are load-bearing: coalescing (`_vpKickSoon` replaces the pending timer), echo
>   suppression (a resize within `_VP_KICK_SETTLE` of our own kick is ignored), and verify-then-retry
>   capped at `_VP_KICK_MAX`. ⚠️ `_VP_KICK_VERIFY` must exceed `_VP_KICK_COOLDOWN`, and a
>   cooldown-blocked kick must RESCHEDULE rather than return, or the retry chain dies after one
>   attempt. **Turn on the readout (five taps on the header title) and read `kick tries` before
>   editing anything** — `1 / 3` on a good launch; climbing to the max means iOS is ignoring the kick.
> - **`scripts/vpkick-harness.js` / `scripts/vpkick-compare.js`** — run the REAL extracted kick
>   functions against stubbed globals and a fake clock, no device needed. Extraction ranges are in
>   the script headers (re-derive them, they drift). Two stub traps: `_vpIsIOS` reads a **bare**
>   `navigator`, and the fake clock must start at a real epoch value or `_vpKickAt = 0` blocks the
>   first cooldown check. Model the iOS chrome animation as a **stream** of resize events — a
>   single-echo model shows nothing.

> **2026-08-02 owner follow-up — Home-return jitter + merged budget rows (grep the name).
> Full rationale: CLAUDE.md, the 2026-08-02 section at the top.**
> - **⚠️ "The screen jitters when I go back to Home" is a DIFFERENT BUG from "the pull-down jitters".**
>   Do not reach for the 08-01 guards. That one was a *feedback* loop (our kick caused a resize that
>   kicked again); this one is a **collapse** loop and it needs iOS to be *cooperating*: Home's
>   content is short → document not scrollable → the kick works → `restore()` un-scrollables it →
>   **iOS collapses the view back** → the retry sees the shortfall again. It ended by exhausting
>   `_VP_KICK_MAX`, not by succeeding.
> - **`_vpLatched` / `_vpLatchValue()` / `_vpApplyLatch()`** — the fix. Once a shortfall has been seen,
>   `<html>` keeps a permanent `min-height` of `screen.height + 1px` so the document stays scrollable
>   by 1px and iOS never collapses. **Read `latch` on the viewport readout first** — `875px` (or
>   whatever `screen.height + 1` is on that device) means it is armed; `off` means no shortfall has
>   been seen this session, so any jitter you are chasing is not this. `latch` armed **and** `kick
>   tries` at the max = iOS genuinely ignoring the kick, a third distinct fault that more retries
>   cannot fix.
>   ⚠️ Three things here look like tidy-ups and are not: it must use **`screen.height`** (every
>   viewport-relative unit reports the short height in the bug state), it must be applied **before
>   `prev` is captured** in `_vpKick`, and it must **never be released** — releasing it re-creates
>   the collapse.
> - **`_VP_KICK_SETTLE` 800 / `_VP_KICK_MAX` 3 / backoff `_VP_KICK_VERIFY × _vpTries`** — retry pacing,
>   secondary to the latch. Every attempt costs a visible iOS chrome animation, so slower and fewer is
>   better; do not tune these upward to "try harder".
> - **`scripts/vpkick-harness.js` scenario 6** covers this (`collapsesOnShortDoc`). To confirm it can
>   still fail rather than passing by accident, neuter `_vpApplyLatch` in a copy of the extract — the
>   one-line `sed` is in the script header. The kick probe is now the **1px scroll**, not the
>   `min-height` write, because the latch writes `min-height` permanently.
> - **`_budMergeScopes()`** — campers + leaders are ONE budget row now; the audience split and the
>   price breakdown are behind the row's chevron (`.budrow-det`). "A category total looks wrong" →
>   check `_budScopeRows` first, this only sums what that produced. ⚠️ **Display-only and client-only
>   on purpose** — do not mirror it into `budget.ts`, and do not delete `church.campers`/`.leaders`,
>   which the CSV export still walks unmerged. Its one real hazard is `codeHint`, which must survive
>   the merge ONLY when every contributing scope reported the same code.
> - **⚠️ "THE BUDGET TOTAL IS TOO LOW" / "PAID IN PERSON SHOWS $0"** — was the missing
>   `settings.tent_price` / `classroom_price`, ~$2,050 across 11 people. **Superseded 2026-08-02
>   (3rd): prices are now DERIVED from the invoices, so an empty setting is no longer a fault.**
>   See the block below before touching anything here.

> **2026-08-02 (3rd) — family invoices + derived ticket prices (grep the name).
> Full rationale: CLAUDE.md, the third 2026-08-02 section at the top.**
> - **⚠️ "A BUNCH OF TICKETS SHOW $0 WITH NO DISCOUNT CODE" → SHARED FAMILY INVOICES.** Check it in
>   one query: group `people` by `invoice_number` and compare `count(*)` with
>   `count(*) filter (where amount_paid is not null)`. Prod on 2026-08-02: every 1-person invoice had
>   money, **every 2- and 3-person invoice had none** — 64 of 217 people, ~$11,760. It was a
>   deliberate withhold branch in `invoice-import.service.ts`, not a matching failure. They are split
>   now.
>   ⚠️ **A DEPLOY DOES NOT BACKFILL THIS.** Rows already stored as null stay null — the owner must
>   re-import the Billing Contacts CSV once. If they report "still $0 after the fix", ask whether they
>   re-imported before reading any code.
> - **`splitExact()`** (`invoice-import.service.ts`) — largest-remainder split so the parts sum to the
>   invoice EXACTLY. ⚠️ Do not replace with per-person `Math.round`: it drifts cents per invoice and
>   the camp total stops matching the sum of its own rows. Handles a negative total (credit note).
> - **`ticket-prices.ts` / `buildTicketPriceTable` / `priceForTicket`, SPA mirror `_budTicketPrices` /
>   `_priceForTicket` / `_resolveTicketPrice`** — each ticket type's price, LEARNED from the invoices.
>   This is what lets an early-bird tent and a standard tent ticket coexist; two scalar settings could
>   not. ⚠️ Tie-break is deliberately the LOWER price (this values money received — guessing high
>   invents income). ⚠️ Mirror and source must change together.
> - **`personValue` in-person cascade** = own `registrationCost` → learned type price → scalar
>   setting. **`settings.tentPrice`/`classroomPrice` are now a last-resort fallback only**, for a
>   ticket type nobody has an invoice for. A blank setting is NOT a fault on its own.
> - **`_budUnpricedInperson()`** — what the top-of-screen warning fires on. It counts a *measured*
>   failure (an in-person payer whose ticket type has no price from any source) rather than checking
>   whether a setting is blank, and names the offending ticket type. Keep it that way: the
>   empty-setting check produced a warning that was true, useless, and permanently on.
> - **`_budUpgrades()` / `_budTicketKind()` / `_budUpgGroup()`** — the tent→classroom upgrade card.
>   "Who is in a classroom without paying the upgrade" = `accommodationKind === 'classroom'` **while
>   `registrationType` says tent** (the church accommodation override is what makes the two diverge).
>   ⚠️ `_budTicketKind` mirrors `mapTicketType` in `ticket-import.service.ts` — change both.
>   ⚠️ Sponsor/discount/in-person classes are excluded deliberately (a sponsored place is $0 by
>   design, not a debt), and "nothing recorded" is its own bucket, never defaulted to "hasn't paid".
>   The amount owed only renders when `classroomPrice` is set; the paid/unpaid split has a
>   price-independent fallback (paid more than their own ticket cost) so the card still works without it.

## Frontend — `public/index.html` (single ~9,450-line SPA as of 2026-08-05)

> **`node --check` extract range: derive it, never cache it.** As of 2026-08-03 the script body
> is lines **956–8564**, but that moves on almost every batch. The naive `<script>…</script>`
> regex fails because the file contains the literal `</script>`. One-liner:
> `S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1); E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1); sed -n "$((S+1)),$((E-1))p" public/index.html > /tmp/spa.js && node --check /tmp/spa.js`

This one file is the only real navigation cost in the repo. Map below (line numbers are a
2026-06-26 snapshot); **grep the name to confirm the line** — they drift on every edit.

> **Desktop/laptop wide layout (≥980px):** restored 2026-06-26 — the grid was orphaned (CSS +
> `_renderWideNav` targeted `#app`/`#header`/`#main`, but the shell is `class="app"`+`id="app"` /
> `id="bar"` / `id="stage"`). Grid now targets `#app`/`#bar`/`#stage` (CSS `@media(min-width:980px)`
> ~213; `_renderWideNav` ~572). **Verified at markup level only, NOT visually** — if the desktop
> view looks off, the `#stage` padding in that media block is the first thing to adjust. The phone
> layout (<980px) is independent of this block.

### Global state (line ~381)
`TOKEN, ACTOR, SETTINGS, CAMP_MODE('pre-camp'), STACK, PREVIEW_MODE` — one declaration line.
Also: `Cache` (313, 30s TTL data cache), `ALLREG/CHURCHES` (~839), `_navToken` (~530),
`SCHED_DAY` (~1519), `DEVO_DAY` (~1533), `_pendingImportCsv` (~2060).

### Infrastructure / plumbing
| Symbol | ~Line | Owns |
|---|---|---|
| `_doFetch` / `api` | 338 / 357 | All HTTP. Bare results, throws on non-2xx. **Preview write-guard** lives in `api()`. Timeout + GET coalescing + **30s result cache**; non-GET writes call `_invalidate`. **`_doFetch` drives the top loading bar** (below). |
| `_npStart` / `_npDone` / `#nprog` | ~586 / ~594 / CSS ~281 | **Global top loading bar** (2026-07-01). Reference-counted; `_doFetch` calls `_npStart()` on entry and `_npDone()` in `finally`, so only **real** network requests animate the bar (cached GETs bypass `_doFetch` → no flash). `#nprog` = first child of `.app`, absolute `top:0`. "Bar stuck / never shows / flashes on cached nav" → the counter balance in these two fns. |
| `Cache` / `_allCached` / `_invalidate` / `_prefetch` | 313 / 322 / 325 / 375 | **Perf layer (ported from CMS).** Cache = 30s TTL Map; `_prefetch` warms endpoints after login; `_invalidate` maps a write path → stale keys. **Stale data after a write = `_invalidate` mapping.** |
| `sessionExpired` | 429 | 401 handling (clears Cache) |
| `ICONS` / `ic` | 394 / 414 | SVG icon set + renderer (incl. `edit/at/key/trash` for account rows). **Blank icon = missing key here.** |
| `heroMark` | ~727 | **(NEW 2026-07-02)** Tent+cross watermark (16% opacity white) for the right side of a `.hero` card — mirrors `public/icons/icon.svg`'s design. Called as the first child of both Home hero cards (`RENDER.home`, `renderHomeAtCamp`). "Watermark missing/wrong on Home" → here; "app icon looks wrong on a phone" → `public/icons/icon.svg` + `sw.js` `CACHE` version (must bump on any icon change or installed users keep the old one) + the known apple-touch-icon SVG/PNG gap noted in `CLAUDE.md`. |
| `toast / modal / closeModal` | 422–424 | Transient UI |
| `dayLong / timeFmt / dtFmt` | 425 | Date formatting (UTC-anchored). `_addDays / _datesBetween` near `adminSettings` derive check-in days. |
| `fmtPhone` / `telLink` | ~1259 / ~1267 | **(NEW 2026-07-02)** `fmtPhone` normalizes AU mobiles for display — reformats a 10-digit `04xxxxxxxx` to `0411 928 301` and re-adds a dropped leading 0 on a 9-digit truncated number (common when a CSV mobile column got numeric-coerced upstream in Excel/Elvanto). Passes through anything else unchanged (incl. masked contact numbers like `0411****01`). `telLink` (tel: links) and every other phone-display site (Data tab, first-aid leader/parent contacts, search reveal, Student Info/camper card) call it. **Doesn't touch editable phone `<input>` values** (e.g. ministry-contacts editor `pair()`) — only rendered/read-only text. "Phone shown inconsistently / missing leading 0" → here. |
| `_vpShortfall` / `_vpKick` | ~1857 / ~1897 | **iOS short-layout-viewport fix (2026-07-31).** `_vpShortfall` = `screen.height - innerHeight`, gated to iOS standalone — **the only metric that can see this bug** (everything viewport-relative agrees with itself in the broken state). `_vpKick` briefly makes the document 200px taller, scrolls 1px, restores. Triggers: launch (retried over 1.6s) + `visualViewport.resize`/`focusout` (keyboard). ⚠️ Do NOT replace with a transform on `.tabs` — tried and reverted; the document cannot paint past `innerHeight`. |
| `_vpDbg*` / `.vpdbg` | ~1935 / CSS ~534 | **Viewport readout.** Off by default; five taps on the header title (`_vpDbgTap` on `#barT`), persisted in `localStorage.ycp_vpdebug`. **KEPT deliberately — do not delete as leftover debug code.** Read `SHORTFALL` + `kicks fired` before touching CSS for any bottom-bar/floating-nav symptom. |
| `_fixViewportGap` | ~1792 | iOS keyboard-dismiss **scroll restore** (2026-07-29). Distinct from `_vpKick` and both are needed: this restores scroll position, `_vpKick` re-sizes the view. Note it is a **no-op when the document is not scrollable**, which is exactly the state `_vpKick` exists for. |
| `_initDemoLogin / quick` | 444 / 451 | Demo quick-login (localhost only) |
| `doLogin / logout / _tryRestoreSession` | 452 / 467 / ~2244 | Auth. `doLogin` saves token+actor to localStorage; `logout` clears localStorage; `_tryRestoreSession` (called at boot) restores session across page reloads. |

### Navigation / shell
| Symbol | ~Line | Owns |
|---|---|---|
| `updateModeUI` | 473 | Preview banner + mode chrome |
| `enterPreview / exitPreview` | 483 / 491 | Client-only at-camp **mode** preview, same user (no backend) |
| `enterAccountPreview / exitAccountPreview / confirmEnterAccountPreview` | grep the name | **Account preview (2026-07-15)** — read-only impersonation of a DIFFERENT login. Swaps API token + `ACTOR`, stashes the admin's session in `_previewStash` (+ `localStorage['ycp_preview_stash']`, restored in `_tryRestoreSession`). Preview POST via `_doFetch` (bypasses the write-guard). `ACCOUNT_PREVIEW` global is orthogonal to `PREVIEW_MODE`. Backend `POST /accounts/users/:id/preview` (`account.controller.preview` → `previewAccount` + `issueTokenFor`). |
| `_updatePreviewBanner / _togglePreviewMode / _exitAnyPreview` | grep the name | Shared preview banner: label + at-camp overlay toggle (shown only when real global mode is pre-camp) + Exit dispatch. Driven from `updateModeUI`. |
| `TAB_OF` | 505 | Tab-id → highlighted-tab map. **Wrong tab highlighted = here.** |
| `_showScreen / _paint / _navTo / go / gotoTab / back` | 513–554 | Router. `_navTo` is **stale-while-revalidate**: shows the previous render (no spinner) on revisits. |
| `_renderWideNav` | 567 | Desktop sidebar — **admin & director only**. Mode-conditional: at-camp shows Check-in/Search/Notes/Notices; pre-camp shows My Youth. Church Import removed. Data/Records merged into "Data, Reset & Exports". |
| `buildTabs` | 605 | Bottom-nav tabs per role × mode. **Missing/extra tab = here.** |

### Home (dispatch at `RENDER.home`, line 629)
`RENDER.home` → firstAid? **redirects to `gotoTab('search')`** (Phase 4: firstAid landing is Search,
not a Home tab; `gotoTab` also maps home→search for firstAid). Else re-fetches `/settings` **only when
not in PREVIEW_MODE** (picks up admin mode switch live; the guard fixed "preview won't load"),
then **parallel-loads** `/home`+`/registrants`+`/notifications`, pre-camp home (inline) vs
`renderHomeAtCamp` (713).
- `renderHomeAtCamp` 713, `renderOversightPulse` 811 (async, no `/campers` fetch — uses session DTO).
  **(2026-07-04)** zoneLeader's pulse now groups by church (`_pulseGoToChurch` tap target), amber
  <70% (`PULSE_AMBER_PCT`); director/admin unchanged (still per-zone). Director+admin also get
  `_digestCardHtml`/`_renderDirectorDigest` (home digest card, inside `.hero`, un-awaited like the
  pulse) — see "New Feature 2" in CLAUDE.md for the full figure/tap-target breakdown.

### Pre-camp screens
| Screen / fn | ~Line |
|---|---|
| `RENDER.people` (My Youth) | 841 |
| `scopeRegs / drawPeople / personRow` | 878 / 879 / 892 |
| `openPerson / markReg` | 906 / 925 |
| `RENDER.help` | 929 |
| `RENDER.budget` (prices from per-registrant `registrationCost` — NOT settings prices, which are deprecated) | ~1249 |
| `RENDER.accom` — classroom **rooms** + allocation map. Helpers: `accomChurches`/`accomGroups` (75% eligibility), `addAlloc` (auto-fill, single-gender guard), `removeAlloc` (cascade), `drawAccom`, `tentDist` (7/tent). **(2026-07-20)** a church under 75% no longer drops its classroom-preference people — `tentDist` folds them into the tent counts (mirrors backend `tentDistribution`); `drawAccom` splits the old single pending table into **"Classrooms (Pending Allocation)"** (eligible groups awaiting a room + anyone with no accommodation type recorded) and a new **"Under 75% — Moved to Tents"** section underneath. | ~1278 |
| `RENDER.data` (director/admin data view) | ~2906 | Linked from the "Data, Reset & Exports" admin screen's `dataTableCard` "View ›" pill (`RENDER.adminData` ~2849). **(2026-07-02)** `dataApply` (~2969) now sorts client-side: `_dataCache` defaults to createdAt-ascending (approximates import order — `/registrants` itself returns alphabetical) and headers are clickable (`dataSort` ~2963, `DATA_COLS`/`_dataSortVal` ~2944) cycling unsorted→asc→desc. `Mobile` column runs through `fmtPhone`. **(2026-07-04, director nav fix)** two buttons at the top — `go('import')` (Data Import) and `go('adminData')` (Records & Export) — the reachable entry point for director in either mode (also reachable at-camp via the home tile "Student Data Table"). |

> **`RENDER.codes` (registration code / self-register) was DELETED** — self-registration is gone
> (all registrants arrive via CSV). No reg-code screen, home card, or `/r/:slug` link.

### At-camp screens
| Screen / fn | ~Line | Notes |
|---|---|---|
| `RENDER.checkin` | grep the name | **(2026-07-17)** now a thin phase-branch wrapper: `campPhase()==='signin'` → `_renderArrival()` (Day-1 arrival, ex-`RENDER.firstday` body redirected via `_fdScreen`); else → `_renderDailyCheckin()` (the original body below, renamed — unchanged internally). `_ciLabel` renamed `_ci()` (in `navModel`), `CHECKIN_QUEUE`, `drainQueue`, `_optimisticState`, `rowHtml` — grep each name. **Sessions = `settings.checkInDays`×AM/PM** (id `${day}~am`), NOT schedule — see backend `checkin-sessions.ts`. The status path `encodeURIComponent`s the id (the `~` delimiter replaced `#`, which broke the URL → "Endpoint not found"). **(2026-07-02)** `rowHtml` tile decluttered: avatar/initials, med badge, and the always-on grey sync dot removed; Check-in is now a primary solid button (ghost once already checked in) labelled "Check in"/"Check out", bigger than the ghost "Add note" button. Per-row sync state (`_updateSyncDots`/`_markSynced`) is now a harmless no-op — the top `ci-sync` banner is the only sync-status UI. **(2026-07-04, item 3)** a collapsed "Not Signed In (N)" `<details>` at the bottom lists scoped students with `atCamp!==true` (any lifecycle — fetched via `/registrants`+`/campers` alongside the roster status, same dedup as `RENDER.firstday`); each row has a direct "Sign in to camp" button (`signInPrompt`). Hidden when N=0. |
| `campPhase() / brisbaneNowTime()` | grep the name, near `_realCampDayNumber` | **(NEW 2026-07-17)** `campPhase()` → `'signin'\|'checkin'`: manual `SETTINGS.checkinPhaseOverride` wins if set, else Day-1-and-before-`SETTINGS.checkinSwitchoverTime` → `'signin'`, else `'checkin'`. Drives `RENDER.checkin`, the Check-in nav tab label, and the church-leader home's first tile. |
| `_performCheck / confirmCheckOut / doCheck` | 1052 / 1062 / 1086 | Optimistic flip + undo (`undoCheck` 1075) |
| `notePrompt` | 1087 | Check-in notes |
| **FIRST AID (Phase 4)** `renderSearchFirstAid / runFaSearch` | ~1375 | firstAid home = student search (no Medical Watch). `_ALLERGY_RE` flags allergy-type dietary items. |
| `openStudentInfo` | ~1391 | "Student Info" (renamed from casualty card). Re-ranked: alert→consent→**leader contacts** (`GET /search/contacts/:id`)→Medicare→dietary→Log→recent logs→parent (bottom). `faRevealLeader` reveals a leader number. |
| `openFirstAidLog / saveFirstAidLog` | ~1490 | Log-action form → `POST /notes {category:'firstaid'}` (4-line body). |
| `RENDER.records / drawFaRecords / faRecSeg / exportFaRecords` | grep the name | First-aid records tab (`GET /notes/firstaid`); Today/All + per-student filter. `_faParse` splits the 4-line body. **Export button → `exportFaRecords()`** builds a CSV client-side from `window._faRecsAll` (no backend). |
| `revealMedicare` | ~1480 | Uses `_currentStudent` (no re-fetch); POSTs the audit reveal. |
| `RENDER.search / runSearch / reveal` | 1193 / 1198 / 1215 | **firstAid only now** (own `search` tab, untouched). At-camp church/zoneLeader/director/admin route to `RENDER.students` instead — `RENDER.search` still exists and delegates to the shared `_renderOtherChurches('search')` body if ever hit by a non-firstAid actor, but nothing navigates it there post-2026-07-17. |
| **`RENDER.students(subtab)` (NEW 2026-07-17)** | grep the name | Replaces the at-camp Search tab for church/zoneLeader/director/admin. `.seg` control (`switchStudentsTab`, state in `STUDENTS_SUB`) with **My group** (default, `_renderMyGroup`/`filterMyYouth` — zoneLeader gets church sub-headings within each At-camp/Signed-out/Late-arrivals section) and **Other churches** (`_renderOtherChurches` — masked leader-contact search, same `doSearch`/`runSearch`/`reveal` as old `RENDER.search`). `TAB_OF`: `camper`→`students`, `myyouth`→`students`, `firstday`→`checkin`. |
| `RENDER.notifs / deleteNotice` | 1218 / 1230 | Notices |
| `RENDER.compose / sendNotif` | 1302 / 1317 | Send notice (zoneLeader/director/admin) |
| `RENDER.firstday` | 1328 | Day-1 arrivals (sign-in). Fetches **both** `/registrants` (lifecycle=registered, kind≠leader) and `/campers` (kind=student) in parallel; deduplicates by id so pre-arrival students appear in "not signed in". |
| `RENDER.myyouth` | 1405 | **Legacy — the `myyouth` screen/home tile are gone (2026-07-17, superseded by `RENDER.students`'s My-group sub-tab)**, but the function is kept (harmless dead code, same as other superseded renderers in this file) as a thin wrapper around the now-shared `_renderMyGroup(screenId)`. |
| `openCamper` | 1449 | Camper detail. Back → Students (`TAB_OF.camper='students'`, 2026-07-17). |
| `signOutPrompt/Confirm`, `signInPrompt/Confirm` | 1485 / 1509 | **Attendance** (writes atCamp/lifecycle) |
| `RENDER.schedule` | 1520 | Pure plan view (no location, no check-in pill). `selSchedDay` 1530 |
| `RENDER.devotional` | 1534 | `selDevoDay` 1547 |
| `RENDER.faq` | 1550 | |
| `RENDER.testimonies / submitTestimony` | 1556 / 1569 | **Student is optional** — defaults to "No specific student identified" (general testimony). |
| `RENDER.notes / drawNotes / exportNotes` | 1574 / 1589 / 1603 | Camper-less notes show as "No specific student". **(2026-07-18)** `drawNotes`'s `badge(n)` shows incident low/high severity (`n.severity`); each card gets a `zoneAccentStyle(n.zone)` left-border accent (`ZONE_COLORS`, ~line 804) — zone = attached student's zone, else the logging church's zone (`churchZoneById` from a new `GET /accounts/churches` fetch in `RENDER.notes`, keyed by the note's `authorChurchId`), else no accent. |

### Admin screens (admin role; identical in both modes)
| Screen / fn | ~Line |
|---|---|
| `RENDER.admin` (console) | 1611 | **(2026-07-04)** tiles grouped under three headings — grep `RENDER.admin=function` for the current tile→heading mapping and order (re-ordered once already the same day per follow-up feedback; don't trust a remembered list). |
| `switchMode` | 1631 |
| `RENDER.adminAccounts` — **rewritten**: one row per login (leadership + churches) with icon actions | 1649 |
| ⮑ `aRoleChange` 1698, `addAcct` 1702, `editLeaderName/saveLeaderName` 1708/1715, `editChurchName/saveChurchName` 1719/1726, `editUsername/saveUsername` 1728/1733, `changePassword/savePassword` 1735/1741, `delAcct/delChurch` 1743/1745, `addChurch` 1747 | — |
| `RENDER.adminAccom` — classroom **rooms** mgmt (+ `saveRoom`/`delRoom`/`addRoom`); tent setup removed (auto-distributed). Prices moved to `RENDER.adminSettings`. **(2026-07-20)** also has an "Accommodation overrides" card (`saveChurchOverride`) — per-church override moved here from the Account Info modal. | ~1779 |
| `RENDER.adminFaqEdit` | 1791 | **Pre-existing dead code** — no nav path reaches it (not a `RENDER.admin` tile, not in `navModel`). Left alone, out of scope for the 2026-07-04 batch. `RENDER.adminFaq` (the reachable pre-camp FAQ editor) was merged into `RENDER.atCampInfo` — see Admin console table below. |
| `RENDER.adminRecords` | ~1808 | **Redirects to `adminData`** — all export/close-out content merged there. |
| `RENDER.adminCloseOut` (+ `doNewYear`) | ~1830 / ~1855 | Back button → `adminData`. |
| `RENDER.adminSettings / saveSettings` | 1891 / 1916 |
| ⮑ **Timezone hardcoded** to Australia/Brisbane (field removed); check-in days **auto-derived** from start/end via `_datesBetween`; `renderCheckinDaysPreview`/`onStartDateChange` (start pre-fills end +3 days). Also hosts the two **login-lock toggles** (`stChurchLock`/`stZoneLock` → `churchLoginLocked`/`zoneLeaderLoginLocked`, `.tgl` switch) saved in `saveSettings`. **(NEW 2026-07-17)** switchover-time input (`stSwitchover` → `checkinSwitchoverTime`) + phase-override `.seg` (`stPhaseSeg`/`setPhaseOverride` → `checkinPhaseOverride`; confirm-gated when forcing away from `'auto'`). | — |
| `RENDER.adminData` (+ `adminReset`, `adminClear`) | ~1926 | **Merged from Records & Export**: shows compliance export card, close-out card, CSV upload, notifications clear (at-camp), rollover, factory reset. Title = "Data, Reset & Exports". |
| `RENDER.import / RENDER.adminData` upload card (`_importUploadCardHtml`) + `adminUpload` / `_renderImportPreview` / `_confirmImport` / `_createPhantomChurches` / `_detectImportType` / `_xlsxToCsv` | grep the names | **Redesigned 2026-07-02 (late):** single multi-file field, header auto-detect, combined Form→Ticket→Invoice preview→confirm, Excel via lazy SheetJS, per-source last-imported stamps. Phantom churches still get a per-church create form that re-runs the dry-run. |
| **Offline Sign-In (NEW 2026-07-04)** — `_offlineSignInCardHtml`/`downloadOfflineSignInTemplate`/`offlineSignInUpload` | grep the names, bottom of `RENDER.import` | Fallback bulk sign-in for churches doing paper/bulk sign-in. Export = `GET /export/offline-signin` (backend `src/services/offline-signin.service.ts`, exceljs); import re-parses the filled sheet client-side via the existing `_readImportFile` pipeline then POSTs raw CSV text to `POST /import/offline-signin`, which matches by First+Last+Church text and bulk-signs-in via `withSignEvent`+`saveMany`. |
| **Elvanto export guide** — `IMPORT_GUIDE` / `openImportGuide` / `_igDraw` / `_igGo` / `_igZoom` / `_igTs`/`_igTe` (swipe) + `#impGuide` overlay in the shell + `.ig-*` CSS | grep the names | **(NEW 2026-07-03)** "How do I export these files from Elvanto?" ghost button on the upload card → full-screen 3-step screenshot walkthrough (Form / Ticket List / Billing Contacts). Images live in `public/img/import-help/*.png` (static, cache-first). "Guide won't open / wrong step / swipe dead / image tiny" → these; "screenshot 404s" → the image path + sw cache. Tap-to-zoom = `.ig-imgwrap.zoom` (220% width, horizontal scroll). |
| `RENDER.adminWizard` (+ `WIZARD_STEPS`) | ~3012 / ~3001 | **10 steps (2026-07-04):** settings→churches→accounts→**import** (NEW)→accom **rooms**→**accomAlloc** (`accom`)→schedule→**devos**→**faq**→**contacts**, logical order. Each step has an auto-`check()` (green tick) + a `tip` shown via `helpTip`. The schedule/devos/faq rows carry an `arg` and route via `go('atCampInfo', arg)` — see `RENDER.atCampInfo` below. "Wizard step wrong/missing tick or tooltip" → `WIZARD_STEPS`. **"Back to setup" chip missing/stuck"** → `_wizardChipHtml` (persistent while `sessionStorage['ycp_wizardReturn']` is set) + `_wizardGo` (sets it on leaving the wizard). |
| `RENDER.adminStudents` (+ `stuApply`/`stuEdit`/`stuSave`/`stuAdd`/`stuCreate`/`_stuNorm`/`_rStu`) — **at-camp Individual Student Data Edit** (2026-07-02): merged `/registrants`+`/campers` students table, church/gender/grade filters + search, row-tap core-field edit via `PATCH /registrants/:id`, manual add via `POST /registrants` (created `registered`, signs in via First-day). Admin-console tile is at-camp only (wizard tile pre-camp only) — both in `RENDER.admin`. | ~2955 |
| **`RENDER.atCampInfo(sub)` (NEW 2026-07-04)** — Schedule/FAQ/Devotionals condensed into one screen, three sub-tab buttons (`AC_INFO_TABS`), defaults to `'schedule'`. Content builders `_acFaqBody`/`_acDevosBody`/`_acScheduleBody` (former `RENDER.adminFaq`/`adminDevos`/`adminSchedEdit` bodies). `_schedRow`/`addSchedRow`/`saveSchedDay` (schedule sub-tab) unchanged internally — `saveSchedDay` calls `PUT /schedule/day` (item 6, one bulk call, not N deletes+N creates). `saveFaqPre`/`saveDevo` unchanged. `_rFaq`/`_rSched` re-render helpers now call `RENDER.atCampInfo('faq'\|'schedule')`. | grep the name |
| `RENDER.adminContacts / saveContacts` (+ `toggleContactCard` 2235; header shows `n/4 Contacts`) | 2210 / 2236 |

---

## Role × mode → what should appear (check expected vs actual first)

**Bottom-nav tabs** (`buildTabs`, line ~605):

**(2026-07-17)** the at-camp `Search` tab is `Students` for every role except firstAid, and the
`Check-in` tab label is phase-driven (`_ci()` in `navModel` — reads "Sign-in" before the Day-1
switchover, else "Check-in"; shown as "Check-in"/"Sign-in" below for brevity):

| Role | pre-camp | at-camp |
|---|---|---|
| `church` | Home · My Youth · Help · Notices | Home · Check-in/Sign-in · **Students** · Notices |
| `zoneLeader` | Home · My Youth · Help · Notices | Home · Check-in/Sign-in · **Students** · Notices |
| `director` | Home · My Youth · **Data** · Help · Notices | Home · Check-in/Sign-in · **Students** · Notices |
| `admin` | Home · My Youth · **Data** · Notices · **Admin** | Home · Check-in/Sign-in · **Students** · **Admin** |
| `firstAid` | Search · Records · Schedule (**same in both modes**; Search is the landing — Phase 4) | Search · Records · Schedule |

**Desktop wide sidebar** (`_renderWideNav`) — all roles get the sidebar at ≥980px; items from `navSidebar(role,mode)` = `navModel` tabs + extras (admin at-camp uses a dedicated order). Items are **mode-conditional**:
- **admin at-camp:** Home, Check In/Sign-in, **Students**, Notices, Accommodation Allocations, Admin Settings
- **admin pre-camp:** Home, My Youth, Data, Notices, Admin, Budget & Costings, Accommodation Allocations
- **director at-camp:** Home, Check-in/Sign-in, **Students**, Notices, Notes
- **director pre-camp:** Home, My Youth, Data, Help, Notices, Budget & Costings, Accommodation Allocations
- **church / zoneLeader at-camp:** Home, Check-in/Sign-in, **Students**, Notices
- **church / zoneLeader pre-camp:** Home, My Youth, Help, Notices
- **firstAid (all modes):** Search, Records, Schedule
- Bottom tabs hidden (`#tabs{display:none}`) at ≥980px; sidebar is the sole nav.

(Full capability/scope matrix is in CLAUDE.md → "Roles". firstAid = read-only, attendance-only,
no notes/admin/pre-camp data.)

---

## Backend — `src/` (layered, small files; grep within the named file)

Architecture: `api (controllers) → services → repositories → core`. Find a route, then its
service. **Bugs are almost always in a service.**

| Concern | File | When the symptom is… |
|---|---|---|
| Route table (path → controller) | `src/api/http/router.ts` | "endpoint 404 / wrong handler" |
| **RBAC** (all role checks) | `src/services/access-control.ts` | any 403 / "should/shouldn't be allowed" |
| Persistence wiring | `src/container.ts` | "works on memory, not supabase" (or vice-versa) |
| Person logic + **presence invariants** | `src/services/person.service.ts` | check-in/sign-in/out, atCamp, lifecycle, medical-watch |
| Daily check-in **sessions** | `src/services/checkin.service.ts` + `checkin-sessions.ts` (pure) | "no check-in sessions", wrong current session, **session-id 404**. Sessions = `settings.checkInDays` × AM/PM (id `${day}~am`/`~pm`), **NOT the schedule** (de-linked 2026-06-25). |
| Dashboard / roster counts | `src/services/dashboard.service.ts` | wrong "checked-in"/"still due" counts, roster contents. Uses `buildSessions(settings.checkInDays)` for today's sessions. **(2026-07-04)** also returns `sessionExpected` (the atCamp-non-leader population subject to the current session — same population `checkInsDue` is computed against) for the director/admin home digest card. |
| Notes / testimonies | `src/services/note.service.ts` | testimony won't save / camper-less note. `camperId` is **optional** (general testimony); `notes.camper_id` is nullable. |
| Schedule | `src/services/schedule.service.ts` + `IScheduleRepository` | CRUD for schedule items. **(2026-07-04, item 6)** `replaceDay(actor, {day, items})` backs `PUT /schedule/day` — replaces a whole day in one call (in-memory: Map delete+re-set; Supabase: delete-then-multi-row-insert inside one `sql.begin` transaction), used by the SPA instead of N deletes+N creates. |
| **Offline sign-in (NEW)** | `src/services/offline-signin.service.ts` | `GET /export/offline-signin` (exceljs template) / `POST /import/offline-signin` (bulk sign-in from a filled sheet). Matches by First+Last+Church text (`norm()`, case/whitespace-insensitive) against non-leader people; the "Sample Student" row is matched by name and always skipped regardless of its Church cell. Bulk-applies via `withSignEvent`+`saveMany`, same pattern as the leader bulk sign-in in `admin.service.setMode`. 9 tests in `offline-signin.service.test.ts`. |
| CSV import (Form, `POST /import/csv`) | `src/services/import.service.ts`, `church-import.service.ts` | import dropping/duplicating rows, dry-run. Churches match/create by **name** (no `code`). Church-scoped matching (`nameChurchKey`/`pickMatch`/`phoneKey`) — **unchanged from before the multi-source work**, still deletes anyone absent from the file. Blank CSV cells no longer clobber existing values on update (2026-07-02 fix) — `parseGender` returns `null` on blank, `'other'` only as the create-time default; `zone` stays unconditional (church-derived, not CSV-derived) by design. |
| **CSV import (Ticket List, NEW `POST /import/tickets`)** | `src/services/ticket-import.service.ts` + `ticket-import.controller.ts` | Owns `accommodationKind`(+`accommodationKindConfidence:'confirmed'`, unconditional unless `Church.accommodationOverride` wins), `ticketNumber`, `invoiceNumber`, `paymentStatus`. Cross-church name(+phone) matching via `person-matching.ts`, never church-scoped, never deletes. No confident match → creates an orphan `Person` (no `churchId`) with `needsReview:true`. Real headers (confirmed 2026-07-02 against a sample): `Event Occurrence information`, `Invoice Payment Status`, plus a **`Ticket Status`** column (skip the row with a warning unless it's exactly `Active` — a cancelled/refunded ticket must never write confirmed accommodation data). `Ticket Type` values are substring-matched (`includes('classroom')`/`includes('tent')`), confirmed to correctly handle real values like `"EARLY BIRD | Tent Accomodation"` (real misspelling in the export). |
| **CSV import (Invoice, NEW `POST /import/invoices`)** | `src/services/invoice-import.service.ts` + `invoice-import.controller.ts` | Owns `registrationCost`/`discountCode` (reused fields), NEW `discountAmount`/`amountPaid`/`feesAmount`/`taxAmount`. **Never creates a person** (no church field in this export, `Person.churchId` is non-nullable) — unmatched rows go to the response's `unmatchedInvoices[]` instead. Tiered match: `invoiceNumber` (cross-referenced against a value Ticket List already set) → billing-contact name+phone fallback. May **guess** `accommodationKind` (`confidence:'guessed'`) via `buildAccommodationPriceLookup` (exact-cents match, ≥3 confirmed samples + ≥90% majority at that price, never overwrites `'confirmed'`). Real headers (confirmed 2026-07-02): plain `First Name`/`Last Name` for the billing contact (NOT `Billing First Name`), `Fees Paid`, `Total Tax`. **Confirmed real risk, not hypothetical**: the billing-contact name is frequently a parent, not the registrant — `src/services/multi-source-import.integration.test.ts` proves the invoice-number tier correctly avoids this trap using the real sample data. |
| **Real-sample regression coverage** | `src/services/multi-source-import.integration.test.ts` (NEW) | Runs the actual 2026-07-02 sample Form/Ticket List/Invoice CSVs (inlined as fixtures) through all three importers in sequence and asserts final per-person state. Re-run this first if a future real export breaks import — it's the closest thing to a real end-to-end check without driving the browser. |
| **Shared matching/merge core** | `src/services/person-matching.ts` (NEW) | `findPersonMatch`/`buildNameIndex`/`addToIndex` (cross-church, normalize-then-exact, bounded Levenshtein≤2 fallback, single-unambiguous-candidate only) and `mergeOwnedFields`/`isBlank` (generic "never overwrite a good value with a blank incoming one" — used by all three import services). "Two people got matched as one" / "an obvious name match didn't happen" → here first. |
| Reset / new-year / defaults / **mode** | `src/services/admin.service.ts` | wipe behaviour, snapshot restore, mode switch |
| Accounts / churches | `src/services/account.service.ts` | login, account CRUD, sole-admin guard |
| Accommodation | `src/services/accommodation.service.ts` + `accommodation-allocation.ts` (pure: groups/validation/tents) | classroom rooms CRUD, allocation map, 75% eligibility, single-gender/capacity validation, lock, church-rooms. **No blocks/reservations** (removed). |
| Search / contact reveal | `src/services/search.service.ts` | search results, reveal audit |
| Audit / export | `src/services/audit-export.service.ts` | export CSV, lastExportedAt |
| Supabase repos | `src/repositories/supabase/*` | prod-only data round-trip issues |
| Types / Zod schemas / errors | `src/core/*` | validation rejects valid input |

Verification: `npm run typecheck` (clean) · `npm run test` (vitest, 442 pass as of 2026-07-04 —
this count drifts every batch, treat it as "roughly this many", not exact). Note the two
deploy-only gotchas in CLAUDE.md (CommonJS tsconfig; anchored `/data/` gitignore) — neither is
caught by tsc/vitest. Schema migrations are **consolidated** (2026-07-16) into `supabase/migrations/0001`–`0004`;
the original `001`–`023` are archived verbatim in `supabase/migrations_archive/`. Prod is at
the full end-state (incl. field-encryption `022`/`023`), and was reconciled 2026-07-17 —
`0002`/`0004` run for real (`0002` a no-op: RLS already on all 17 tables) and prod's tracked
history (`supabase_migrations.schema_migrations`) pruned to exactly `0001`–`0004`, so a future
`supabase db push` is a no-op. `src/repositories/supabase/*` must not reference dropped columns
(`tent_price`/`classroom_price` were dropped from prod by `0004`). Migration `013` adds `bracket text` to `classroom_allocations`;
migration `014` adds `church_login_locked` + `zone_leader_login_locked` (boolean, default false) to
`settings`. **`supabase.settings` writes ALL settings columns on every save** — if a new settings
column isn't migrated to prod, every settings save (and mode switch / new-year) fails; reads
tolerate absence via `?? false`.

---

## Symptom router (fastest path)

### 2026-08-05 — password UPLOAD (the reverse of "Randomise & export passwords")

> **Where it lives:** Admin → **Accounts & churches** → the "All login passwords" card at the top.
> Backend `src/services/password-import.ts` (pure, ALL the decision logic) +
> `account.service.importPasswords`. Route `POST /accounts/passwords/import`, `admin:manage`.
> SPA `uploadPasswords` / `_pwUpPreview` / `_pwUpConfirm`, right after `randomizeChurchPasswords`.
> **Start at the PURE module** — it decides everything and is testable in isolation. The service
> only reads users, hashes and saves.

| Symptom | Go to |
|---|---|
| **"I uploaded the sheet and nothing happened"** | Expected when nothing matched: the preview shows a warnbox and renders **no Confirm button**, deliberately. Cause is almost always the file — check it has a `Username` column and that those usernames exist. `planPasswordImport` reports every unmatched name; read the preview rather than re-running. |
| **"It says N not matched"** | The names are listed in the preview. Matching is `Username` ONLY, lowercased — there is no church/gender fallback, on purpose (a church-name typo would set the WRONG account's password and reconcile perfectly). A `b-`/`g-` prefix missing from the sheet is the usual cause. |
| **🔴 "It wiped/cleared a password"** | It cannot, and there is a test. A blank password cell is counted in `plan.blank` and skipped. If a password genuinely stopped working, look at **`randomizeChurchPasswords`** (which rotates everything) or a manual reset — not this. |
| **"It changed a church I didn't list"** | It cannot — absent accounts are never in `plan.apply`. Check the uploaded file actually contains that username (an unedited full export contains ALL of them, with their real passwords, so re-uploading it untouched re-sets everything it lists). |
| **The original admin's password didn't change** | Correct and deliberate — refused even when listed (`findOriginalAdmin`), same rule as the randomise path. It is the recovery account. It appears in `protectedSkipped`. |
| **A password was set on a DEACTIVATED account** | Deliberate, and it differs from `randomizeChurchPasswords`, which skips inactive accounts. Owner's explicit call 2026-08-05. The username is reported under "set, but the account is deactivated and still cannot log in". The login needs reactivating separately. |
| **🔴 "The import said success but set nothing"** | This is the shape the missing-column guard exists to prevent — `missingPasswordColumns` throws naming the columns found. If you see a genuine silent empty success, that guard was bypassed or the column check was loosened. |
| **A username listed twice did nothing** | Two different passwords for one username → BOTH rejected (`plan.duplicates`), because picking one sets a password the admin cannot predict. Identical duplicates apply once. |
| **A row was rejected as "too short"** | Under 6 chars, matching `SetPasswordSchema`'s `z.string().min(6)`. Change one and change the other — `MIN_IMPORT_PASSWORD_LENGTH`. |
| **The account must change its password at next login** | Should NOT happen — `mustChangePassword:false`, matching the randomise path. If it does, that flag got flipped in `importPasswords`. (Note the gate is repo-wide disabled anyway: `MUST_CHANGE_PASSWORD_ENFORCED=false`.) |
| **The Upload button squashes the Randomise button** | The documented flex bug, 4th occurrence. `.btn` base CSS is `display:block;width:100%`, which becomes the **flex-basis** in a flex row. Upload must keep `btn ghost sm` + `flex:0 0 auto;width:auto`; Randomise keeps `flex:1;min-width:0`. |
| **An .xlsx upload picks the wrong sheet** | `_xlsxToCsv` chooses via `_detectImportType`, which only knows the **Form/Ticket/Invoice** signatures — a passwords workbook matches none, so it falls back to **the first sheet**. Fine for a single-sheet file; a multi-sheet workbook must have the passwords first. Symptom is a loud "missing column" error, not a wrong-account write. Upload CSV if in doubt. |
| **🔴 "The preview showed one file but it set another"** | Fixed 2026-08-05 (found in review) — but if it recurs, it is `_pwUpSeq`. Two overlapping uploads: the armed text (`_pwUpCsv`) and the painted preview must always be the same file. `_pwUpCsv` is assigned LAST, beside the paint, and every await is followed by a `seq!==_pwUpSeq` bail. `_pwUpConfirm` captures csv+seq BEFORE awaiting `confirmSheet`. Anyone "simplifying" those back into a plain read-after-await reopens it. |
| **"Choose the file again" on the confirm button** | Expected: `_pwUpCsv` was blanked because a NEW upload was started (which voids the old preview), or the previous attempt errored. Re-pick the file. |
| **A `Login,Password` file is rejected as missing `Username`** | Fixed 2026-08-05 — the parser and `missingPasswordColumns` had drifted. They now accept exactly the same headers (one `'Username'` alias, normalised by `field()`). ⚠ Add an alias to BOTH or NEITHER; there is a test block pinning the agreement. |
| Verify | `npx vitest run src/services/password-import.test.ts` (**25** — the rules, the parser/guard agreement, and the byte-exact round trip from the real export) + `npx vitest run src/services/account.service.test.ts` (6 for `importPasswords`). |

### 2026-08-04 (5th) — medical consent on the profile + the budget export became a workbook

| Symptom | Go to |
|---|---|
| **"A church leader can't see whether medical consent was given"** | `_medConsentRow(p)` — rendered by BOTH `_paintPerson` (pre-camp, `/registrants`) and `openCamper` (at-camp, `/campers`). If it is missing from one screen only, that screen dropped the call; the DATA is always there (`consentMedical` is on both DTOs and always has been). |
| **The consent row is missing on a LEADER's profile** | Correct and deliberate. The Elvanto field is *"I give medical consent for my child"* — a parent answering about a minor. A leader consents for themselves, so the row is meaningless and a red "Not granted" pill would be a false alarm. Same `isL?'':…` guard as the Medical/Dietary/Parent rows. |
| **The consent wording differs between first aid and the profile** | It cannot, since 2026-08-04: both read `_MED_CONSENT_CLAUSE`. If they differ, someone re-inlined the text into `openStudentInfo`. |
| **"Can a church now see another church's consent?"** | No. Nothing about scope changed — `GET /campers/:id` and `/registrants/:id` are both gated by `canAccessPerson`, and a redacted cross-church search hit still cannot be drilled into. The field was already being sent and thrown away. |
| **🔴 The budget workbook opens with "we found a problem with some content"** | Hand-built OOXML, and Excel names nothing. **Two causes, in this order:** (1) `fills[0]`/`fills[1]` in `_XL_STYLES` are RESERVED (`none`, `gray125`) — inserting a colour at the front shifts every fill; (2) `<worksheet>` child order is schema-fixed: `sheetViews` → `cols` → `sheetData` → `autoFilter`. Both are asserted by the harness, so **run it first** — it will name the one that broke. |
| **The workbook opens but everything is plain / unstyled** | Almost certainly someone routed it back through `XLSX.write`. The vendored SheetJS is the **Community** build: it ACCEPTS `cell.s` and silently discards bold and fills on write (measured — a bold red `A1` came back with `<fonts count="1">`). It keeps `!cols`, `!merges` and number formats, which is why this looks like it should work. The styled writer is `_xlsxBlob` / `_xlSheetXml`. |
| **A total row's fill stops halfway across** | A styled BLANK must still be emitted (`<c r="C5" s="8"/>`). `_xlSheetXml` does this for `_xc('',style)`; returning `''` for an empty cell instead drops it and the fill ends there. |
| **A whole sheet vanished when opened in Excel** | Every declared sheet needs a relationship in `xl/_rels/workbook.xml.rels` AND an Override in `[Content_Types].xml`. Miss either and Excel "repairs" the file by dropping the sheet. Harness section 1. |
| **"There's no Sponsorship SHEET"** | Correct — there were three sheets for a few hours on 2026-08-04; the owner moved sponsorship to the **bottom of "By ministry"**, after a blank row and a heading. Two sheets now: Summary, By ministry. |
| **The sponsorship block is missing entirely** | It renders only when `spon.count > 0`, same rule as the Sponsorship card. No tagged sponsor/discount codes = nothing to ask for = no block, deliberately (a heading over an empty block sends the reader looking for a number that does not exist). |
| **"Where are the sponsor BAND rows / the $150-vs-$190 split?"** | Removed from the export at the owner's request (2026-08-04); it is per ministry per code now. ⚠ The differential is **not** gone from the product — `computeSponsorSummaryClient` still computes `bands` and the Budget screen's Sponsorship card still opens each code into them. **Do not delete `bands` because the export stopped printing it**; a harness check asserts it is still computed. |
| **"Where did the budget CSV go?"** | Replaced, not broken. One export now, `.xlsx`, from the same button (`#budExportBtn`). Two exports of the same figures drift. `exportBudget` is now **async**. |
| **🔴 Summing the workbook over-counts, and sponsorship is in the total** | Filter `Row type = Detail` first, as always. But note the guarantee WEAKENED on 2026-08-04 when sponsorship moved back onto this sheet: it now rests on **three** things, and the harness checks each separately so it will name the broken one — the blank spacer row, the non-`Detail` row types, and the autofilter range stopping at the camp total (`receivedRows`). If someone extended the filter to `rows.length`, that is the bug. |
| **The church total is at the BOTTOM of each ministry's block** | That is the pre-2026-08-04 order and it was deliberately reversed — the total LEADS its block, detail underneath, so scrolling reads as a list of ministry totals. `rep.churches.forEach` pushes the total row before calling `detail()`. Harness section 3 pins the row indices. |
| **Unit price is blank on some rows** | Correct and deliberate — a mixed-value row has no single unit price, and a `0` would read as "free" while the line total says otherwise. |
| **The church name repeats on every row and is hard to read** | It is meant to be there (the sheet must stay filterable/pivotable) but renders in the MUTED style so it recedes. ⚠ Do not "fix" the repetition by blanking the cell — that breaks filtering, and muting is what the owner actually asked for. |
| **A figure the owner asked to be REMOVED from Summary is back** | Three were removed 2026-08-04: the `Ministries` row, the whole `Reconciliation` section, and the `Places` column beside the sponsorship asks (a headcount next to an ask invites "$830 ÷ 6 places" — the per-place average the band split exists to avoid). Harness section 7b asserts all three stay gone. |
| Verify the budget workbook | `node scripts/budget-xlsx-harness.js` — 98 checks over the real extracted writers, incl. both corruption rules, the style of every row kind, total-leads-block ordering, the three-part sponsorship separation, the detail-sums-to-total trap, the $150/$190 differential still being computed, and a read-back through the vendored SheetJS. |
| Verify it in **real Excel** | `BUDGET_XLSX_OUT=C:/tmp/b.xlsx node scripts/budget-xlsx-harness.js`, then open it (or drive Excel over COM and read `Font.Bold` / `Interior.Color` / `NumberFormat` back). Done 2026-08-04: no repair prompt, header bold on `#1E1B4B`, church total bold on `#EDE9FE`, camp total on `#4F46E5`, `FreezePanes=True`, `AutoFilterMode=True`. |

### 2026-08-04 (4th) — schedule "lost", invoice review sensitivity, By-ministry table

| Symptom | Where it lives |
|---|---|
| **"The schedule/devotionals are gone"** (blank Schedule screen, rows still in the DB) | They are almost certainly **stranded on old dates**, not deleted. `select distinct day from schedule_items` and compare to `settings.check_in_days` — the screen looks up by date and a mismatch renders empty. Cause is always the same: camp dates changed **by SQL instead of through the admin UI**, so `remapDays()`/`applyDayMoves()` never ran and could not re-key them by position. Fix = the positional remap (old day 1 → new day 1). ⚠️ A plain `UPDATE` is only safe when the source and target date sets are **disjoint**; otherwise delete-then-reinsert, which is why `remapDays` does. Re-run **Save Defaults** afterwards or the snapshot keeps the wrong dates. |
| **"EVERY shared invoice is flagged and none resolved"** (esp. right after a rollover or reset) | Ordering, not the split rules. Only the Invoice import writes `registrationCost`, so on the **first** import into an empty camp the price table is built from all-null costs and comes back EMPTY. Fixed 2026-08-04 — shared invoices run in a **second pass** after the singles, against a table rebuilt from what the singles just wrote. If it recurs, check the deferral (`deferredGroups` in `invoice-import.service.ts`) survived a refactor. Workaround on an old build: run the invoice import **twice**. |
| **"Too many shared invoices are flagged for review"** | `src/services/invoice-split.ts` — `resolveInvoiceSplit`. Since 2026-08-04 an invoice is only flagged when its total canNOT be decomposed into known ticket prices in exactly one way. If one is still flagged, the total has zero or ≥2 decompositions: check the price catalogue (`ticketPriceCatalogue(buildTicketPriceTable(people))`) actually contains the price you expect. |
| **A student shows a medical alert / roster medical flag but has no condition** | Their care cell holds a placeholder the junk list did not catch. `isPlaceholderCareText` (`elvanto-mapping.ts`) matches on a case-, punctuation- and spacing-stripped key; add the token there and re-import. ⚠️ Whole-value only — never make it a substring test, or `Nil by mouth after 8pm` and `No nuts` get deleted. ⚠️ A match DELETES the value, so never add anything ambiguous (`unknown` and `not sure` are kept on purpose). |
| **Everyone imported with blank medical/dietary** | The column is probably not in the file under the name the importer expects — `field()` cannot tell "absent" from "empty". Since 2026-08-04 the Form import raises a **row-1 warning** naming any missing care column; check the dry-run preview. Fix the Elvanto export, or add the new header as an alias in `import.service.ts` and to `CARE_COLUMNS`. |
| **First-aid alert shows one run-on "Condition: A, B, C" row** | Known and deliberate as of 2026-08-04. `medicalConditions`/`dietaryRequirements` are `string[]` but the importer writes at most ONE element — the raw cell. Splitting on commas would break `Nut, egg and dairy allergy` into a fragment that no longer matches `_ALLERGY_RE` and would drop out of the medical alert, so today's over-alerting is the safe direction. See CLAUDE.md 2026-08-04 (4th) item 2d before changing it. |
| **Flags did not clear after deploying an import fix** | Expected, always. `needs_review`, `registration_cost` and the money columns live on the **person row** — no code change rewrites stored data. Re-run the relevant import; all three are idempotent. |
| **A tent+classroom sibling invoice is still flagged** | Deliberate when neither has a **confirmed** `accommodationKind`. $340 = 150+190 is one multiset but two assignments, and putting the tent price on the classroom camper reconciles perfectly while being wrong. Give them a confirmed kind (the Ticket List import sets it) and it resolves. A `guessed` kind is ignored on purpose — it came from the price lookup, so trusting it is circular. |
| **A shared invoice split unevenly and wasn't flagged** | Correct if every ticket type is priced: costs are each person's own ticket, and a shared discount is apportioned in proportion. Only an unresolvable total flags. |
| **A church is missing from the home "By ministry" table** | Before 2026-08-04 the table was built from `/registrants` alone, so a church with 0 registrants never appeared. `RENDER.home` now seeds every church from `/accounts/churches` first. If one is still absent, it is not in `churchRepo` — check Accounts & churches, not the home screen. |
| **A "By ministry" row named something odd with people in it** | Probably the `__unallocated__` sentinel (`Attendee's Church` was blank or `OTHER - please specify below`). Allocate them on **Data Import → Unallocated registrants**. |

### 2026-08-04 (3rd) — new-year rollover / defaults snapshot

| Symptom | Where it lives |
|---|---|
| **"I rolled over and everything is gone — churches, accounts, rooms, schedule"** | `supabase.defaults.ts`. Until 2026-08-04 the snapshot was written double-encoded (`JSON.stringify` + `::jsonb` → postgres.js encodes the string AGAIN), so the column held a jsonb **string**; `toDefaults` cast it `as Record<…>`, every key read `undefined`, and the `?? []` fallbacks handed `newYear` six empty arrays to `replaceAll` over the live camp. **First check `select jsonb_typeof(snapshot) from defaults` — it must be `object`.** `toDefaults` now throws on anything else. |
| **"Where is the button to restore the baseline?"** | There isn't one, and there never was. The restore is the second half of **`admin.service.newYear`** (`src/services/admin.service.ts`, ~line 270) — purge, then `replaceAll` each scaffold collection from the snapshot. `saveDefaults` (the "Save Defaults" card on Records & Export) writes that snapshot; `RENDER.adminCloseOut` → `doNewYear()` runs the rollover. |
| **Rollover reported 0 temp passwords** | It generates one per non-admin user IN THE SNAPSHOT. Zero means the snapshot's `users` array read empty — the corruption above, not a password bug. Recovered accounts come back **passwordless** by design (the snapshot strips `passwordHash`); use "Randomise & export passwords" on Accounts & churches. |
| **A restored account is missing / an account created after the last Save Defaults is gone** | Expected. The snapshot is a point-in-time baseline (`settings.defaults_saved_at`); anything created after it was never in it. Re-run **Save Defaults** whenever the scaffold changes. |
| **`created_at` on the defaults row looks far too old** | Fixed 2026-08-04 — the upsert only set `created_at` on INSERT, so it stayed pinned to the first save ever. `settings.defaults_saved_at` was always the accurate one. |

### 2026-08-04 (2nd) — sponsorship, the code differential, "camper" → "student"

| Symptom | Go to |
|---|---|
| **"The sponsor total for this code looks wrong / too round"** | Check whether the code spans more than one ticket price. `SponsorCodeRow.bands` splits a code by distinct ask (`$190 × 2`, `$150 × 3`); a single blended number means somebody reintroduced an average. There is a test asserting **$170 — the average of a $150/$190 code — appears nowhere**. |
| **🔴 "The sponsorship total and the budget total don't add up"** | They are designed to: **sponsor total + grand total = the value of every place**, because the ask is defined as `ticket value − what personValue counts as received`. If they stop reconciling, someone has recomputed the ask from `discountAmount` (or from `registrationCost` directly). `budget.sponsor.test.ts` → "RECONCILES". |
| **A code shows $0 sponsorship although people used it** | Three legitimate causes, in likelihood order: (1) it is tagged **Paid in person** — excluded on purpose, that money arrived; (2) it is untagged, so it is a plain full-price ticket; (3) every holder has an `amountPaid` covering their ticket. Check the tag dropdown in the Discount codes card first. |
| **The sponsorship total is lower than the camp knows it needs** | Look for the warnbox: places whose ticket has **no known price from any source** are counted in `count` but excluded from every total. They are never valued at $0 — a $0 ask reads as "already covered". Fix by importing an invoice for that ticket type, or set the scalar fallback in Camp settings → Ticket prices. |
| **The Sponsorship card is missing entirely** | It renders only when `spon.count > 0` — i.e. at least one person is on a code tagged `sponsor` or `discount`. No tagged codes = nothing to ask for = no card. |
| **The By code / By ministry toggle keeps resetting** | It should not: `_sponsorView` is module-level precisely so it survives `_budRedraw()` (which fires on every tag save). If it resets, someone moved the state into the DOM. |
| **Summing the budget CSV now over-counts by the sponsorship** | Filter to `Row type = Detail`, as before. Sponsorship rows (`Sponsor band` / `Sponsor unpriced` / `Sponsor by ministry` / `Sponsor total`) are money that has **not** arrived and are deliberately outside `Detail`. A harness check asserts no sponsor row is ever typed `Detail`. |
| Verify the sponsorship maths | `npx vitest run src/services/budget.sponsor.test.ts` (17 tests) — the canonical algorithm. `node scripts/budget-xlsx-harness.js` section 6 runs the REAL SPA mirror and proves the differential survives into the export (renamed from `budget-csv-harness.js` on 2026-08-04 when the export became a workbook). |
| **🟠 A budget/roster screen went empty after a "camper → student" rename** | Someone rewrote a **data** value, not a label. `BudgetPerson.kind` is `'camper' \| 'leader'` and `RegistrantDto.kind` maps to `'camper'`; `r.kind === 'camper'` is matched on in several places in the SPA. The 2026-08-04 pass changed display strings ONLY. Search for `kind==='camper'` before assuming a rename is safe. |
| **An export still says "Camper"** | The budget export's Audience column is `Student` in BOTH `budgetToCsv` (server, and note it is **dead code** — nothing routes to it) and `exportBudget` (SPA, a workbook since 2026-08-04) — they had drifted to different labels before this. A harness check asserts the word appears nowhere in **any part** of the workbook. |

### 2026-08-04 — saved-view rework (wrong premise) + budget CSV

> ⚠️ **DEPLOYMENT MODEL, because two of the rows below only make sense with it and it is not
> derivable from the code: ONE ACCOUNT, MANY PHONES.** A church login like
> `b-citipointe-brisbane` is shared by ~20 leaders, each on their OWN phone. Devices are
> personal; accounts are shared. The 2026-08-03 filter work assumed the opposite and built a
> warning banner on top of it. **The rows about a "hidden count" or an amber banner in the
> 2026-08-03 section below are superseded by this one.**

| Symptom | Go to |
|---|---|
| **"Why am I being warned every time I open the app?"** | You are not, since 2026-08-04. `_filterBanner` is a QUIET neutral strip (`.filtban`, violet tint) stating the saved view, not a warning. If it is amber or uses a warn/danger class, that is the regression — the leader's filter is a standing preference ("I look after Yr 7 boys"), not a mistake. Two harness checks pin this. |
| **A leader signs in and sees only part of their group** | Expected, and it is the feature — the saved view is restored. The `.filtban` strip above the list names it and "Show all" clears it. If the roster is short and there is NO strip, THAT is the bug. |
| **The saved view says the wrong shown/total** | `_filterBanner(which, shown, total)`. Check-in passes `list.length, roster.length`; My-students passes `all.length, (window._myYouthAll||[]).length`. The leaders block is deliberately outside that count — it is filtered by zone/gender but never grade. |
| **Two leaders on different phones share one account and got each other's filter** | Impossible — `localStorage` is per-device. If it happened, something moved the store to the server. The account in `ycp_filters_<username>` only separates two ACCOUNTS on ONE phone. |
| **A roster renders completely empty after login** | `_restoreFilters` resets to defaults BEFORE overlaying and type-checks every value, precisely so a corrupt blob cannot leave a key `undefined` (which compares false against everything). Clear `localStorage['ycp_filters_*']` to confirm. Harness section 3. |
| Verify the saved view | `node scripts/filter-persist-harness.js` — 22 checks. |
| **🔴 "Weird symbols" / `â€"` / `Ã©` in an exported CSV** | **A MISSING UTF-8 BOM, essentially always.** Excel on Windows reads a `.csv` as the system ANSI codepage unless the file starts with `﻿`. The em dash in `Tent — paid in person` is the usual trigger. `src/utils/csv.ts`'s `toCsvString` already adds it, so every SERVER-built CSV is fine; a CLIENT-built one must add it itself. The budget CSV was the only one missing it (fixed 2026-08-04). ⚠ The BOM is INVISIBLE in an editor — this regresses by someone tidying a concatenation. |
| **A budget CSV column is blank that should not be** | `Accommodation` / `Payment type` come from `_budAccom(r.key)` / `_budPayment(r.key)` — derived from the class KEY, never parsed out of the display label. A new `TicketClass` added to `budget.ts` + `_BUD_CLASSES` without a matching key shape shows up here; the harness walks every class and asserts both map to a known value. |
| **Summing the budget CSV gives roughly double the real total** | Filter to `Row type = Detail` first. Subtotal and total rows are in the same column by design; the `Row type` column (new 2026-08-04) is what makes them separable. Before it, `Audience` mixed Camper/Leader with Total/Grand Total and this trap was invisible. |
| **Budget CSV unit price is empty on some rows** | Correct and deliberate — a mixed-value row has no single unit price, and a `0` there would read as "free" while the line total says otherwise. Same rule as `budgetToCsv` in `budget.ts`. |
| Verify the budget export | ⚠️ **The rows above describe the CSV, which was replaced by a styled .xlsx on 2026-08-04 (5th) — see that section at the top of this router.** The `Row type`, class-key and blank-unit-price rows still apply; **the BOM rows do not**, because an xlsx is UTF-8 XML and there is nothing to mis-decode. Command is now `node scripts/budget-xlsx-harness.js` (87 checks). ⚠ The BOM rule still binds every OTHER client-built CSV. |


### 2026-08-03 (2nd) — accommodation export + persistent roster filters

> ⚠️ **The four FILTER rows in this section are SUPERSEDED by the 2026-08-04 section above** —
> they describe an amber warning banner and a "hidden" count that were built on the wrong
> deployment model and have been reworked. The accommodation-export rows are unaffected and
> still current.

| Symptom | Go to |
|---|---|
| **The accommodation workbook disagrees with the allocations screen** | It should be structurally impossible — `_accomExportRows()` reads `window._accomRegs` / `_accomRooms` / `_accomAlloc`, the same in-memory data `drawAccom()` renders, through the same `accomGroups` / `accomChurches` / `tentDist`. If they disagree, something moved the export server-side or gave it its own copy of the grouping rules. Do neither. |
| **A cohort's student/leader split looks wrong** | `stu`/`ld` are set in `_accomGenderGroups` / `_accomYearGroups` at the same moment `n` is, and `n === stu + ld` always (harness check 2). Do NOT re-derive the split in the export — that is a fourth copy of the arithmetic. |
| **"Capacity of those classrooms" doesn't add up down the column** | Correct and documented: it is the capacity of the rooms a cohort OCCUPIES, and a room shared by two cohorts contributes its FULL capacity to both. Use the "Classrooms by room" sheet for capacity questions. |
| **The export button does nothing / "Could not load the spreadsheet engine"** | `_ensureXlsx()` lazy-loads `public/vendor/xlsx.full.min.js` (SheetJS 0.18.5, same-origin so CSP `script-src 'self'` allows it). It is a full build and CAN write, not just read — verified by round-trip. There is no CSV fallback for this export, which is why that error message no longer suggests one. |
| **The workbook fails to open / throws on export** | Almost always a SHEET NAME: max 31 chars, none of `: \ / ? * [ ]`. `book_append_sheet` throws on a bad one — the same failure that 500'd the compliance workbook for weeks on `'Sign-in/Sign-out Log'`. |
| **Tent counts look low/high in the sheet** | Tents are `ceil(n/7)` with students and leaders counted **separately** — 15 students + 8 leaders is 3 + 2 = 5 tents, not `ceil(23/7)` = 4. Same rule as the on-screen Tent City table. Harness check 5. |
| **A room shows people allocated to a group that no longer exists** | Entries whose `key` is not in `gByKey` are filtered out of the export (harness check 10) — a group disappears when a re-import changes a church's eligibility or bracket split. The screen filters the same way. |
| Verify the export end-to-end | `node scripts/accom-export-harness.js` — 10 scenarios against the REAL extracted functions. |
| **A leader signs in and half their group is missing** | ⚠️ **CHECK FOR A SAVED FILTER FIRST.** Since 2026-08-03 both roster filters persist per account on the device (`ycp_filters_<username>`). `_filterBanner` should be showing above the list with the hidden count and a Clear button — if the roster is short and there is NO banner, that is the bug, not the filter. |
| **One login inherited another's filter** | The key is per ACCOUNT, not per device — this specifically must not happen between the `b-`/`g-` pair on a shared phone (harness check 2). Check `_filtKey()` still reads `ACTOR.username`. |
| **A roster renders completely empty after a login** | `_restoreFilters` resets to defaults BEFORE overlaying stored values and type-checks each one, precisely so a corrupt blob cannot leave a key `undefined` — an undefined filter compares false against everything and empties the list with no error. Harness check 3. Clear `localStorage['ycp_filters_*']` to confirm. |
| **The My-students filter resets when I change tabs** | It should not, since 2026-08-03 — the state is `MY_FILTER`, not the DOM. The `<select>`s call `setMyFilter()`, which reads them into `MY_FILTER` and persists. If it reset, something reverted `filterMyYouth` to reading `sel('myZoneF')` directly. |
| **Filters do not survive a login** | `_restoreFilters()` must be called at all THREE session-start paths (`doLogin`, `submitChangePassword`, `_tryRestoreSession`) BEFORE the first paint, and on both account-preview swaps. Grep for the call count. |
| Verify filter persistence | `node scripts/filter-persist-harness.js` — 22 checks incl. cross-login isolation, malformed blobs and a throwing `localStorage`. |


### 2026-08-03 — 16-item owner batch (push latency, parent masking, check-in status export, Android)

| Symptom | Go to |
|---|---|
| **An urgent notice or incident alert still takes minutes to arrive** | Two delays, two fixes — check which one. (1) `push.sendNow()` should fire at creation from `notification.service.send` / `incident.service.log`; it returns `null` and logs `[push] immediate send failed` if the users/settings repos were not injected (check both `makePushService({...})` blocks in `container.ts` still pass `users` + `settings`, and that `push` is still built BEFORE those two services). (2) `PUSH_JITTER_MIN_SENDS` (20) should be skipping the jitter for a small fan-out. If neither fired, the notice waits for the `*/5` `pg_cron` tick, which is the OLD behaviour and still correct-but-slow. |
| **A notice pushed TWICE** | Should be impossible: `sendNow` goes through the same atomic `claimForPush` as the tick. Check nobody replaced it with a direct `sendOne` loop. The claim is permanent, so a duplicate is not self-correcting. |
| **A SCHEDULED notice never pushes at all** | `send()` gates on `publishesNow` before calling `sendNow`. If that gate were removed, the notice is claimed at COMPOSE time, burns its one permanent claim against an empty audience, and can never push when it publishes. `pushSentAt` will be non-null on a notice nobody received. |
| **A normal-priority notice buzzed a phone** | `isPushable` is checked in BOTH `sendNow` and `sendForNotifications`. It should be unreachable. Note an unpushable notice is deliberately left UNCLAIMED. |
| Lock screen says **"Incident logged"** | Should read **"High priority incident" / "Open app to view"** — a FIXED string in `buildPushPayload`'s `leadersOnly` branch, not `n.title`. The in-app notice keeps `Incident logged · <Zone> Zone`; that is correct and intentional. |
| **Android: notification badge is a solid blob in the status bar** | `sw.js` `badge` must be `/icons/badge-mono.png` (transparent glyph), never `icon-192.png` (opaque tile). Android masks `badge` on the ALPHA channel only. iOS ignores `badge`, so this is invisible on an iPhone. |
| **Android: a second incident alert arrives silently** | `renotify: true` in `sw.js`'s `showNotification` options. Without it, replacing a notification that shares a `tag` is silent on Android. |
| **A church login sees a parent number in cleartext** (or can't reveal one) | `PARENT_PHONE_MASKED_ROLES` in `camper.controller.ts` = `{firstAid, church}`. The mask is server-side on purpose — client-side hiding writes no audit row. SPA side: `_parentPhoneCell` decides by looking for `*` in the value, NOT by role. |
| **A parent reveal isn't in the compliance workbook** | `search.service.revealContact` records kind `parent-contact` via `revealAudit.record`, which **never throws** — a failure is logged, not surfaced. Check the "Sensitive Reveals" sheet and the runtime logs. Church holds `camper:read:sensitive`, so a 403 here means something else changed. |
| **"Randomise & export passwords" locked the admin out / skipped an account** | `randomizeChurchPasswords` now rotates every `status==='active'` account except `findOriginalAdmin(allUsers)`. Inactive accounts are skipped by design. If the ORIGINAL admin's password changed, that exclusion has been broken — it is the recovery account. |
| **Can't find the randomise button** | Moved 2026-08-03 to its own card at the TOP of Accounts & churches ("All login passwords"). It is no longer in the Churches card header. |
| **Check-in status PNG numbers disagree with the check-in screen** | `_csGather` counts `!r.checkedIn` over the ROSTER from `GET /checkin/sessions/:id/status` — same population and same last-entry-wins rule as the screen. If they disagree, something re-derived the population from `/registrants`. Do not do that. |
| **Check-in status export says "No check-in sessions on that day"** | Sessions are read from `GET /checkin/sessions` and filtered on `s.day`. Under AC-1 day 1 is PM-only and the last day AM-only — one session that day is CORRECT, zero is not. |
| **Registration lists / Check-in status cards are expanded** | Both are `<details class="setg">` with **no `open`** attribute, deliberately. Do not add one. |
| **The screen stays scrolled up after the keyboard closes** | `_kbRestore` (2026-08-03), NOT `_fixViewportGap` — they fix different halves (position vs layout) and both are needed. Restore is cancelled by any scroll outside `_KB_SETTLE` (350ms) and only fires on a genuine `visualViewport` shrink-then-grow. If it over-fires (page jumps when tapping a dropdown), check the `INPUT\|TEXTAREA`-only guard is intact — `SELECT` must never arm it. |
| **Testimonies & Notes: type badge in the wrong place / name overflowing** | `drawNotes`'s card header row — badge is top-right beside the grade; the name has `min-width:0` + ellipsis so it truncates instead of pushing the badge out. |
| **Records filter shows nothing / "0 selected"** | An EMPTY `NOTE_CATS` means **ALL** — unchanged from the chip version. The label must read "All records". `_ntCatLabel()` updates it; `.msel` open/close is `_mselToggle` plus one document-level click listener. |
| **Day filter on Notes hides records logged today** | Matching is `localDateISO(n.createdAt)` (Brisbane). A raw `createdAt.slice(0,10)` is UTC and files anything before 10am local under the previous day. Records outside `checkInDays` live under "Before camp". |
| **Schedule opens on the wrong day** | `_schedDefaultDay()` — today if today is in `checkInDays`, else day 1. `SCHED_DAY` is sticky once set and is cleared on login/settings resync. |
| **Leader contacts card missing from a church home** | Intentional at camp — `_contactsCardHtml` returns `''` when `CAMP_MODE==='at-camp'` (2026-08-03). `RENDER.mycontacts` is still reachable and is NOT mode-gated. |
| **A download does nothing / produces a 0-byte file (esp. Android, esp. installed PWA)** | Every download must go through **`_rlSaveBlob`** (blob) or **`_saveTextFile`** (text/CSV): append the anchor, click, remove, revoke after 20s. A hand-rolled anchor that skips the append or revokes synchronously is the bug — `exportBudget` did both until 2026-08-03. |
| **Android: schedule editor time field won't open its picker** | `::-webkit-calendar-picker-indicator{display:none}` is now inside a Safari-only `@media not all and (min-resolution:.001dpcm)` + `@supports(-webkit-appearance:none)` block. On Android that indicator IS the picker's click target — do not hide it globally. |


### 2026-08-02 — owner batch (Unallocate button, budget redraw, discount tag conflict, overrides moved)

| Symptom | Go to |
|---|---|
| **A discount code's grey pill disagrees with its classification** (e.g. "50% Off on invoices" on a code tagged **Full sponsor**) | **Not a bug — the screen is telling you two true, contradictory things, and now says so.** The pill is MEASURED from the invoices (`averageDiscountPercent`); the dropdown is what the admin DECLARED, and `personValue` follows the declaration — a `sponsor` code is hard-coded to $0 whatever arrived. `discountTagConflict` (budget.ts, mirrored as `_discountTagConflict`) renders the warnbox. Real case: prod `YC26YP`, 2 people, $75 and $95 genuinely paid, both counted as $0. **A human decides which side is wrong; the code never "corrects" either.** |
| A conflict warning fires on a code that looks fine | Rules are only two: `sponsor` with < 97% measured, and `discount` with ≥ 97%. `inperson` is never checked (a desk payment legitimately zeroes an invoice). `avgPercent === null` (no invoice has both figures) can never conflict. `FULL_DISCOUNT_PERCENT` = 97 and is shared with the ticket-difference label — change both or neither. |
| The budget screen jumps to the top / every church card collapses after classifying a code | Should no longer happen — `_saveDiscountTag` calls **`_budRedraw()`**, not `RENDER.budget()`. A tag change needs no re-fetch (it isn't stored on a person), so it recomputes from `window._budgetRegs` and restores the open `.budchurch` cids + scroll. If it regresses, check nothing put `RENDER.budget()` back. |
| The Data Import designated list says "Undo" instead of "Unallocate" | `ovRow(o, actionLabel)` in `_renderAllocCards` — one row builder, two labels; cardB passes `'Undo'`, cardC `'Unallocate'`. Both call the same `undoOverride`. |
| A button in a `.rowsb` row eats the whole width and squashes the text beside it | `.btn` is `display:block;width:100%`, and inside a flex row that `width:100%` becomes the **flex-basis**. Use `btn … sm` (which sets `width:auto`) + `flex:0 0 auto`, and give the text block `flex:1;min-width:0`. Third occurrence of this exact bug (2026-07-08 Confirm button, 2026-08-02 Unallocate button). |
| "Accommodation overrides" missing from Admin → Accommodation setup | **Moved 2026-08-02** to the **Accommodation allocations** screen (`_accomOverrideCard`), default-**collapsed**. The setup screen keeps a count + an "Open" button. It is **admin-only** there — `PATCH /accounts/churches/:id` is `admin:manage`, and a director reaches the allocations screen but would only get a 403. |
| The overrides `<details>` slams shut whenever an allocation is changed | It must live **outside** `#accomBody` — `drawAccom()` rewrites that div on every allocation edit. Check the `paint('accom', …)` call in `RENDER.accom`. |

### 2026-07-31 — 14-item owner batch (reveal audit, admin accounts, church contacts, imports)

| Symptom | Go to |
|---|---|
| "Who looked at this Medicare number?" / reveal audit empty or missing from the workbook | `src/services/reveal-audit.service.ts` (`record` — **it never throws**, so a failure is a `[ERROR] [audit] FAILED to persist` log line, not a user-visible error), then the `Sensitive Reveals` sheet in `audit-export.service.ts`. Migration `0020` = `reveal_audit`. |
| The audit shows a church NAME where an account should be | `record()` resolves the username via `userRepo.findById`; it falls back to `actor.displayName` when the repo is absent or the lookup throws. Both `b-`/`g-` logins share a displayName — that fallback is the ambiguous case. |
| A reveal is logged but the number is not in the export | **Correct and deliberate.** The revealed value is never stored. See the entity docs + the key-set test in `reveal-audit.service.test.ts`. |
| Can't create an admin / "Cannot create admin accounts via API" | Stale build — that guard was removed 2026-07-31. `account.service.createUser`. |
| Can't delete/deactivate/demote an admin | Expected IF it is the ORIGINAL (earliest-created) admin — `findOriginalAdmin` in `account.service.ts`. Any other admin is deletable. The SPA hides the delete button for the original. |
| Notices vanish "too early" / a scheduled notice never appears | `defaultNoticeExpiry` in `notification.service.ts` — 6h from `scheduledFor ?? createdAt`. Rescheduling moves the expiry. `findActive()` does the filtering. |
| A church can't save its leader contacts (403) | `updateChurchContacts` — capability `church:contacts:write` AND `actor.churchId === id`. Route is `PATCH /accounts/churches/:id/contacts`, NOT the admin-only `PATCH /accounts/churches/:id`. |
| A church renamed itself / changed zone via the contacts screen | Shouldn't be possible — `UpdateChurchContactsSchema` accepts `contacts` only and the save writes only that field. There is a test. |
| "Leader contacts" card missing on a church home | `_contactsCardHtml()` — church role + `ACTOR.churchId` only. Blank screen when tapped → check `<section class="screen" id="mycontacts">` exists in the shell and the RENDER key is lowercase `RENDER.mycontacts` (the router dispatches `RENDER[id]`). |
| A re-registered student shows the WRONG ticket type or lost a medical condition | `import.service.ts` — rows are sorted by `Date Submitted` before the merge loop. Undated rows sort first (original order preserved). Blank cells never clobber on the matched branch. |
| An import warning points at the wrong spreadsheet line | `rowNum` comes from `ordered[i].rowNum` (original position), never the sorted index. |
| A two-invoice person's paid amount looks wrong | `invoice-import.service.ts` `moneyByPerson` — sums within ONE run, `registrationCost` from the latest row, `needsReview` set. Never reads the stored value, so re-import is idempotent. |
| Budget per-church code counts disagree with the camp-wide card | They can't — both come from `computeDiscountCodeSummary` / `computeDiscountSummaryClient`. If they do, someone added a second count. `ChurchBudget.discountCodes`, SPA `_budChurchCodes`. |
| First aid has no Site map button | Removed 2026-07-31 (item 4). Deliberate — that was firstAid's only map route. |
| A revealed number isn't tappable | `faRevealLeader` replaces the button with an `<a href="tel:">`; `reveal()` opens a sheet with a Call button. |
| Data Import: designated-from-OTHER people missing | They moved to their own default-collapsed "Designated from OTHER" section (`_renderAllocCards`, `kind === 'unallocated'`). |
| **"I can't see the Unallocated / Church overrides / Designated from OTHER cards"** | **(2026-08-01)** All three are `<details>` with **no `open`** — collapsed, each is one bold line carrying its count. Check the screen first: they render on **`RENDER.import`** (admin console → **Data Import** tile, or the pre-camp bottom-nav Data Import tab) — **not** Admin → Settings, **not** Records & Export. Then check the data: `cardC` renders only when `allocation_overrides` has ≥1 row with `kind='unallocated'`; `cardA`/`cardB` always render (with a "none yet" hint). Then the role: `allocation:manage` = **director + admin** only. |
| **"Church overrides (0)" / no Designated-from-OTHER card, but `allocation_overrides` HAS rows** | **`GET /import/allocations` is 500ing and the SPA is swallowing it.** Root cause when this was found (fixed 2026-08-01): `supabase.allocation-override.ts` cast `created_at`/`updated_at` `as string`, but postgres.js returns `timestamptz` as a **Date**, so `listOverrides`' `b.updatedAt.localeCompare(…)` threw. **Check `get_runtime_logs(query='/import/allocations')` FIRST** — the DB rows and the SPA render logic both look perfectly healthy in this failure mode, and MCP SQL serialises timestamps to strings so it cannot reproduce it. Since the fix, `_loadAllocation` collects failures in `_allocErrs` and prints them above the cards, so a repeat says so on screen. Any other repo mapper casting a timestamp `as string` has the same latent bug. |
| **Allocate/Undo succeeds (toast fires, DB row written) but the lists don't change** | SPA 30s GET cache. `_loadAllocation` re-reads `/import/unallocated` + `/import/allocations` through `api()`; the write must call `_invalidate('/import/…')` so it lands in the `path.startsWith('/import')` branch, whose `Cache.del` list includes `'/import'`. `_invalidate('/registrants')` does **not** match that branch — that was the 2026-08-01 bug. Same class as any "the save didn't work but the data is there" report. |
| Data Import list won't scroll / shows all rows | `.alloc-scroll` is applied only above `ALLOC_VISIBLE_ROWS` (4). CSS max-height and that constant must stay in step. |
| Settings Save button off-screen or overlapping | `.setg-save` (`position:fixed`, z-index 105) + the `.setg-savepad` spacer. Must be fixed, not absolute. |
| "Your day · N still to check in" missing on day 1 | Expected — `renderMyDay` returns '' while `campPhase()==='signin'`. |
| Notes screen shows nothing / shows everything | `NOTE_CATS` is a Set and **empty means ALL**. `_toggleNoteCat`, `drawNotes`. |
| Leaders sub-menu on My group empty or showing the wrong gender | `_loadMyLeaders` merges `/campers` + `/registrants`; scope comes from the server's `canAccessPerson`, NOT from any client filter. Sort is `_sortLeaders` (signed-in first, then first name). |


### 2026-07-31 — ⚠️ ANY bottom bar / floating nav / "wrong until I scroll" symptom — READ THIS FIRST

**Turn on the viewport readout before touching CSS: tap the header title five times, read
`SHORTFALL`.** This bug was "fixed" blind SIX times because it is invisible to every metric a page
can normally read. Full write-up: `CLAUDE.md`, "THE BOTTOM-NAV / TALL-WHITE-BAR BUG IS ACTUALLY
FIXED".

| Symptom | Go to |
|---|---|
| **Tall white bar under the bottom nav; correct after you drag/scroll** | The known bug. iOS hands the installed PWA a layout viewport ~58-62px shorter than the screen. `_vpKick()` (`public/index.html`) fixes it by making the document briefly taller, scrolling 1px, and restoring. If it is back: readout on → `SHORTFALL` non-zero + `kicks fired` 0 means the kick never triggered (event wiring); non-zero + `kicks fired` ≥1 means iOS ignored it (new iOS behaviour — do NOT escalate to moving the nav). |
| **Same bar after opening and dismissing a keyboard** | Same bug, second trigger. Wired via `visualViewport.resize` + `focusout` in the `_vpKick` block. Note a keyboard does NOT change `innerHeight` on iOS (only `visualViewport.height`), so `SHORTFALL` is correctly 0 *while* typing. |
| **Half the nav bar is hidden / nav clipped at the bottom** | Someone re-added a downward `transform` on `.tabs`. Tried and reverted 2026-07-31 — **the document cannot paint past `innerHeight`**, so a translated nav is simply clipped. See the do-not-retry note on `.tabs` in the CSS. |
| **A COLOURED (not white) strip under the nav** | `html`/`body` backgrounds — both must be `#fff`; `--paper` belongs on `.app` alone. iOS fills that strip with the *document's* backdrop colour, **not** the manifest `background_color`. Do NOT re-add `.tabs::after` (it paints below `innerHeight` and is invisible). |
| **The whole screen jitters when returning to the Home screen** (2026-08-02) | A THIRD trigger, and a different mechanism from the two above — the collapse loop. Read `latch` on the readout, then the 2026-08-02 symbol block near the top of this file. Do not start from the `_vpKick` scheduler. |
| **`SHORTFALL` reads 0 but the layout still looks wrong** | Not this bug. `SHORTFALL` is `screen.height - innerHeight`, gated to iOS standalone — it is 0 by design in Safari, on Android and on desktop. |
| **Nav gap metrics both read 0 yet there is clearly a gap** | Expected, and the trap that cost six attempts. `innerHeight`/`clientHeight`/`scrollHeight`/`visualViewport`/`100dvh` all agree with each other in the broken state. Only `window.screen.height` disagrees. |

### 2026-07-31 — "Other" removed from the student gender picker

| Symptom | Go to |
|---|---|
| **A student's gender box is blank / says "— Select —"** | Intended. `_stuFormFields` shows the placeholder whenever the stored value is not `male`/`female` — almost always `'other'`, which `import.service` assigns to a NEW person when the Form CSV's Gender cell is blank or unparseable. The record needs a real answer; pick one and save. |
| **"Choose Male or Female" won't let me save** | The guard in `stuSave`/`stuCreate`. It exists so a legacy `'other'` row can't be silently rewritten to male by a select falling back to its first option. Fix the gender, don't remove the guard. |
| **A student silently became male after an unrelated edit** | This is the bug the placeholder prevents — if it reappears, someone deleted the placeholder branch in `_stuFormFields` or the guard. Check both. |
| **`'other'` still appears in data / the API accepts it** | Correct and deliberate. `GENDERS` in `src/core/types/enums.ts` still includes it because `import.service`'s default depends on it and narrowing the enum would make existing rows fail validation on read. Only the admin's *choice* was removed. |
| **Gender filters elsewhere show no "Other"** | They never did — the three other gender `<select>`s (My Youth, Data table, Student edit list) are filters and have always been Male/Female. |

### 2026-07-31 — Notices tile removed from the Admin console

| Symptom | Go to |
|---|---|
| **"An admin can't get to Notices"** | Expected on a **phone in pre-camp** — the console tile was removed 2026-07-31 at the owner's request and `navModel`'s `extras` (where Notices lives for admin) render only in the **≥980px sidebar**. Not a regression to "fix" by re-cutting the bottom nav, which is deliberately 4 slots with Data Import in that position (bug 6). Restore `_adminTile('bell','Notices',"gotoTab('notifs')")` in `RENDER.admin` if the route is wanted back. |
| **Notices missing for a non-admin role** | Unrelated to the above — church/zoneLeader/director all have `notifs` as a real bottom-nav tab in `navModel`. Go there. |
| **Notices unreachable for admin AT camp** | Also unrelated — that role gets a Notices tile in the at-camp home grid (`renderHomeAtCamp`, the `ACTOR.role!=='director'` push). |

### 2026-07-31 — four-item owner batch (install prompt, hero accommodation, PNG lists, testimony picker)

| Symptom | Go to |
|---|---|
| **The install banner never appears on an Android phone** | `_installBanner()`. Four gates, in order: (1) the UA test — **Android only**, desktop Chromium is deliberately excluded; (2) `beforeinstallprompt` must actually fire — Chromium withholds it if the app is **already installed**, if the manifest/SW fails its install criteria, or sometimes until the user has engaged with the site; (3) `_installDismissed()` — clear `localStorage['ycp_installdismissed']` to re-arm; (4) `#installBanner` must exist, i.e. the login screen is up. Check (2) in Chrome DevTools → Application → Manifest, which lists any unmet installability criterion. |
| **The install banner appears on an iPhone** | It cannot — `beforeinstallprompt` does not exist in Safari, and nothing else shows the div. If something iOS-shaped is on the login screen it is `_loginTips()`'s `/install.html` link, which is intended and predates this. |
| **Tapping Install does nothing** | `_installGo` — the deferred event is **single-use**. If `prompt()` already ran once, `_deferredInstall` is null and the function returns silently by design. ⚠ Do not move `prompt()` out of the tap handler into the event listener: Chromium refuses a gesture-less call and the refusal is **silent**. |
| **A church login sees BOTH genders' accommodation on the home hero** (or none) | `renderHomeAtCamp()`, the `/accommodation/church-rooms/` block. It filters on `ACTOR.genderScope`. A **null** genderScope keeps both rooms on purpose (unsplit account ⇒ no narrowing) — so "sees both" usually means the account has no genderScope, not that the filter broke. Check the account in Admin → Accounts. "Shows To be confirmed" = the filter emptied the list, i.e. no room is allocated to that gender yet. |
| **A registration PNG is missing someone / has the wrong people** | `_rlSheets` (which images exist and who is on each) then `_rlTier` (which split was chosen). Cancelled registrations are filtered out in `exportRegistrationPngs` (`status!=='cancelled'`); leaders are split off by `kind==='leader'` and **always get their own single image**. Anyone with no grade lands on a **"Grade not recorded"** sheet — if that sheet is missing, they were dropped and that is a bug. |
| **The names are in the wrong order** | `_rlSortKey`/`_rlSort`. Oldest registration first. The key is `dateSubmitted` (the Elvanto **form** date, added to `RegistrantDto` 2026-07-31) → `createdAt` → name. If a whole batch appears in name order, they have no `dateSubmitted` and fell through to `createdAt`, which is identical across a bulk import — that is the fallback working, not a bug. Fix it by re-running the Form import, not by changing the sort. |
| **The wrong split was used** | Automatic tiers on the **student** count only: `<50` whole church, `50–100` by gender, `>100` by grade. Leaders never move it. The Split dropdown overrides. |
| **Only the first one or two PNGs download** | The ~300ms stagger in `exportRegistrationPngs`' loop was removed or shortened. Mobile Safari/Chrome throttle simultaneous downloads and drop the tail silently. Same class: revoking the object URL immediately instead of on the 20s timer cancels the download on some mobile browsers. Use **Download as .zip** instead — one file, no stagger to defeat. |
| **The two export buttons disagree about who's included** | They can't — both go through **`_rlGenerate`**, which fetches, tiers and draws once. `exportRegistrationPngs` and `exportRegistrationZip` differ only in delivery. If they ever do disagree, someone has duplicated the generation logic; put it back in `_rlGenerate`. |
| **The .zip won't open / is corrupt** | `_zipBlob`. The three classic mistakes, in order of likelihood: the **CRC and uncompressed-size fields must describe the ORIGINAL bytes** (only compressed-size is the deflated length); the central-directory entry's last field is the offset of that entry's **local** header; and the EOCD's two counts are entries-on-this-disk and total-entries, both the same here. `_crc32` is checkable against `"123456789"` → `0xCBF43926`. Verify end-to-end by extracting with PowerShell `Expand-Archive` and hashing — that is how it was validated. |
| **The .zip is barely smaller than the images** | Expected. PNG is already deflated, so `_deflateRaw` usually returns something LARGER and the entry falls back to STORE (method 0). The zip is for getting one file instead of twelve, not for shrinkage. |
| **"Could not build the zip" toast** | `exportRegistrationZip`'s catch. Everything up to that point is shared with the working images path, so the fault is in `_zipBlob`/`_deflateRaw` — most likely `CompressionStream` throwing rather than being absent (absent is handled: `typeof` check → STORE). |
| **Text overlaps or bleeds across the PNG columns** | `_rlDraw`. Canvas neither wraps nor clips — `_rlFit` truncates each name to its column width. Layout constants are `RL_W`/`RL_PAD`/`RL_ROW` and the local `headH`/`colHeadH`/`footH`; the header rule sits at `headH-12`, **below** the 176-baseline subtitle (at `headH-26` it struck through it). |
| **A student's payment/medical/accommodation data is on a shared image** | It must never be. `_rlDraw` prints **names only** — see the note in CLAUDE.md item 3. Anything else on that canvas is a defect to remove, not a feature to keep. |
| **The church dropdown is empty or defaults to the wrong church** | `_loadRegListChurches`. It calls `/accounts/churches` (admin/director only) after paint, and picks the default by **regex on the NAME** (`/citipointe\s*brisbane/i`), falling back to the first church — deliberately not a hard-coded id, because the new-year rollover recreates church rows with new ids. Renaming that church changes the default. |
| **The testimony picker shows / doesn't show the church** | `RENDER.testimonies` — the church was removed from the `<option>` for all roles on 2026-07-31. `churchName` is still on the `items` array, so re-adding it is a one-token change if that is ever wanted back. |

### 2026-07-31 — church check-in refused ("N check-ins didn't save")

| Symptom | Go to |
|---|---|
| **A church login's daily check-in fails but admin's works** | `checkin.service.assertSessionAllowed` — it returns immediately for every role except `church`, so a role split like this points at it before anything else. It refuses when `settings.churchCheckinTimeRestricted` is on AND `allowedWindowSession()` returns null, i.e. **today is not in `check_in_days`**, or the clock is outside the AM/PM windows. Before camp that is EVERY check-in. To test outside camp dates, turn off the toggle in Admin → Camp settings → *Check-in & timing*. |
| **The check-in banner shows a reason now** | Intended (2026-07-31). `drainQueue` keeps the first server message in `_checkinFailReason` and the banner prints it. If the banner says only "tap to retry", the failure carried no message (network/timeout), not a refusal. |
| **The roster is tappable when check-in is actually closed** | The lock is `sessionLocked = churchRestricted && SEL_SESSION !== ALLOWED_ID`, where `ALLOWED_ID` comes from **`GET /checkin/sessions/allowed`**. ⚠ Do **not** re-derive it from `/checkin/sessions/current` — that is a NAVIGATION helper that never returns null once camp dates exist (it falls back to the nearest past/upcoming session). That substitution is exactly what caused this bug. The fetch **fails closed**: no answer ⇒ locked. |
| **Adding a new rule about when a check-in is permitted** | Put it in `allowedSession()` inside `checkin.service.ts` — the one function `assertSessionAllowed` (the gate) and `GET /checkin/sessions/allowed` (what the UI greys on) both call. A second copy is how the button and the write end up disagreeing. |

### 2026-07-30 — notification hardening, incidents, web push

| Symptom | Go to |
|---|---|
| **No push notification ever arrives** | FIRST check whether push is even configured: `GET /push/config` returns `{configured:false}` when any of `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` is unset in Vercel — that is the deployed state until they're added, and everything is intentionally inert. THEN check migration `0014` is applied (the tick doesn't run at all without it) and `CRON_SECRET` is set in Vercel **and** in Supabase Vault as `cron_secret`. `pg_net` is fire-and-forget: a 404/401 tick surfaces **nowhere** — query `net._http_response` to see it. |
| **"Alerts on this device" isn't on Home** | Correct as of 2026-07-31 — it **moved to the Notices screen** (owner request) as a compact `btn ghost sm`. `RENDER.notifs` is the only caller of `_renderPushCard()`, in both its branches. ⚠ `firstAid` has no Notices screen, so that role can't opt in (it never could — `RENDER.home` redirects firstAid to Search). Admin on a phone reaches Notices only via the Admin console tile (pre-camp) / at-camp home tile, since `extras` render only in the ≥980px sidebar. |
| **The opt-in button doesn't appear at all on the Notices screen** | `_renderPushCard()` (`public/index.html`) hides itself, deliberately, in five cases: preview modes; no `serviceWorker`/`PushManager`/`Notification`; `/push/config` fails; `configured:false`; or any throw (it's fully try/caught so it can never break the screen). On **iOS not installed to the Home Screen it shows install instructions instead of a button** — no permission prompt is possible until the app is added to the Home Screen. |
| **"Could not turn on alerts" on an installed iPhone (worked on a laptop)** | Fixed 2026-07-31. That toast is the `catch`, i.e. a real throw. Root cause: **WebKit scopes user activation to the event handler's call stack**, so `Notification.requestPermission()` called after `await confirmSheet(...)` throws `NotAllowedError`; Chrome's activation is a 5-second window, hence laptop-only success. `_pushOn` now ONLY opens the sheet and **`_pushConsentGo`** (the sheet's own `onclick`) calls `requestPermission()` as its first statement, before `closeModal()` and before anything async; the rest is `_pushFinish`. **Never put an `await` between the tap and that call** — the regression is invisible on every desktop browser. The toast now names the error (`_pushFail`): `NotAllowedError` = activation/permission, `AbortError` = the OS push service refused, anything else = our `/push/subscribe` call. |
| **"InvalidCharacterError" after granting notification permission** | `atob()` in `_urlB64ToUint8` — the VAPID public key served by `GET /push/config` is not base64url. 2026-07-31: prod held 180 chars of pasted TABLE TEXT there (and it contained the private key + CRON_SECRET, which `/push/config` was serving to every authenticated client — a real leak, rotated). Can no longer happen: `readPushConfig` validates the shape (65 bytes, leading `0x04`) and returns null, and `_isValidVapidKey()` hides the card. **If push silently goes inert after an env change, check the Vercel function log for `[push] VAPID_…` — that error names the variable and its length.** |
| **An env var "was set" but behaves as unset** | Two traps, both hit on 2026-07-31. (1) **`vercel env add` ignores stdin for agents** — `< file` and `cat \| ` report success and write an EMPTY string; use `--value`. (2) **A `sensitive` var is never readable back** — `vercel env pull` gives `""` and so does the REST API with `decrypt=true`; `vercel env ls` shows "Encrypted" for both types and can't distinguish them. An empty pull is NOT evidence of an empty value (`PERSISTENCE`/`DATABASE_URL` also read empty and work fine). Verify a public value by storing it `--no-sensitive`; verify a secret one functionally. |
| **"Why is there a button at all — shouldn't install just ask?"** | It can't. A PWA gets **no install-time permission hook**: nothing fires at "Add to Home Screen", and both iOS Safari and Chrome refuse a gesture-less `requestPermission()` (silently on iOS). A tap is the earliest legitimate prompt. Don't accept a request to auto-prompt on load — it fails closed and burns the permission. |
| **Push arrives but tapping it doesn't open the right screen** | `notificationclick` in `public/sw.js` → `postMessage({type:'push-nav'})` → the `navigator.serviceWorker` message listener in `index.html`. Cold start goes via `openWindow('/?nav=…')` → `_consumePushNav()` at the end of `_tryRestoreSession`. The SPA has **no URL router**, so it can't navigate by URL. |
| **Some leaders get the push, others don't** | Audience is `resolvePushAudience` → `canSeeNotification` (the same predicate as the feed) minus `isPushSuppressed`. Suppression is the usual cause: `status!=='active'`, or `churchLoginLocked`/`zoneLeaderLoginLocked` — those block login AND now suppress push, by design (D8). A **targeted** notice (`targetUserId`) goes to exactly one login and nobody else, deliberately including admin/director. |
| **Only some of the expected pushes went out this tick** | Expected. `MAX_PUSH_SENDS_PER_TICK = 40` (`push.service.ts`); the rest are **deferred, not lost** — they stay unclaimed and the next tick takes them. Check `pushDeferred` in the tick result. Do NOT raise the cap without redoing the arithmetic in that constant's comment: the claim is taken before sending, so a `maxDuration:30` timeout loses pushes permanently. |
| **A push contained a student name / incident detail** | Should be impossible — `buildPushPayload` never reads `notification.body`, `incident.summary` or any person field, and there are tests asserting it. If it happens, someone "improved" that function. The check-in warning is the ONE case that uses a stored body, and only because it's an aggregate count. |
| **"Validation failed" logging an incident with a time** | `occurredAt` must be a **full ISO instant**. `<input type="datetime-local">` gives a bare wall-clock string with no zone and the schema rejects it on purpose. `_incOccurredISO()` (`index.html`) does the conversion; it returns `null` for an empty field, which is valid. |
| **A high-severity incident alert vanished after a while** | Correct as of 2026-07-30: it expires `INCIDENT_ALERT_TTL_HOURS = 12` after creation (`incident.service.ts`), filtered out by `findActive()`. The incident row itself is untouched. |
| **A gender-scoped `b-`/`g-` login sees the wrong check-in count** | `Notification.targetUserId` + the targeted clause in `notification-visibility.ts`. If the value isn't persisting, check `target_user_id` is in `notifColumns`, `toNotif` **AND** the on-conflict `do update set` list in `supabase.notifications.ts` — missing it from the third is this repo's documented recurring bug class. |
| **Dashboard count looks ~30s out of date during a check-in rush** | Expected as of 2026-07-30. `checkIn`/`signEvent` no longer flush the dashboard cache (it's a GLOBAL flush and these are the only bursty writes). The 30s TTL bounds it; the roster screen is always live. Don't "fix" it by re-adding `invalidateDashboardCache()`. |
| **A church login's `/home` numbers look wrong** | `personsInScope(actor)` in `dashboard.service.ts` now uses `findByChurch` for `role==='church'`. `canAccessPerson` is still the gate — `findByChurch` does NOT know about `genderScope`, so if boys/girls figures cross over, that filter has been dropped. |
| **First aid sees no churches / an empty church picker** | `account.service.listChurches` — fixed 2026-07-30. It used to hand-roll `canAccessChurch` and dropped firstAid (who has no `churchId`) into an always-false branch. It now delegates. |

### Earlier

| Symptom | Go to |
|---|---|
| **White screen after login (header visible, content blank)** | SPA `ACC_LABEL` TDZ crash at boot — `ACC_LABEL` must appear after `const ICONS` in the script (fixed 2026-06-30). If it reappears, check script init order. |
| Blank / wrong icon | SPA `ICONS` (394) |
| Wrong tab highlighted | SPA `TAB_OF` (505) |
| Tab missing/extra for a role or mode | SPA `buildTabs` (605) / `_renderWideNav` (567) — check grid above |
| **Stale data after a write / screen won't refresh** | SPA `Cache` (313) + `_invalidate` (325) — the write's path must map to the right stale keys. `{noCache:true}` forces fresh. |
| Slow home / spinner flash on revisit | SPA `_prefetch` (375, warms admin `/accounts/*` too), `_navTo` stale-while-revalidate (537), parallel loads in `RENDER.home` (629) |
| **Top loading bar stuck / missing / flashes on cached nav** | SPA `_npStart`/`_npDone` (~586/~594) + `#nprog` CSS (~281). Only `_doFetch` (real network) drives it; cached GETs bypass it by design. Feels unresponsive on button tap = expected serverless latency, now covered by the bar. |
| **Home Screen (PWA) icon looks wrong / stale on a phone** | `public/icons/icon.svg` (design) + `public/sw.js` `CACHE` (must bump the version any time the icon changes, or installed users keep the cached old one) + the documented `apple-touch-icon` SVG/PNG gap in `CLAUDE.md` (iOS may need a PNG, not the raw SVG). |
| **Home hero card missing/wrong watermark on the right** | SPA `heroMark` (~727); called from `RENDER.home` (pre-camp) and `renderHomeAtCamp` (at-camp) as the first child of `.hero`. |
| **Setup wizard: wrong step order / missing tick / no tooltip** | SPA `WIZARD_STEPS` (~3001) — 9 steps, each with `check()` (tick) + `tip` (`helpTip`). `RENDER.adminWizard` ~3012. |
| **Schedule-edit Time/Activity inputs overlap on phone** | SPA `_schedRow` (~3048) grid `96px minmax(0,1fr) auto` + `.sched-row input{min-width:0}`. Native `type=time` `min-width:auto` overflows a fixed track without this. |
| **`.pill` badge ("View ›" etc.) wraps to two lines on phone** | SPA `.pill` CSS (~123) — needs `white-space:nowrap;flex-shrink:0` (fixed 2026-07-02); a long sibling in the same `.rowsb` was squeezing it below its content width. |
| **Data tab: phone shown inconsistently / missing leading 0** | SPA `fmtPhone` (~1259) — see Infrastructure table above. |
| **Data tab: can't sort columns / doesn't default to import order** | SPA `RENDER.data`/`dataApply` (~2906/~2969) — see Pre-camp screens table above. |
| Write silently blocked, "preview" toast | SPA `api()` preview guard (357, now `PREVIEW_MODE\|\|ACCOUNT_PREVIEW`) + `enterPreview` (483) / `enterAccountPreview` |
| **Preview button missing on an account / "Preview" does nothing** | SPA `RENDER.adminAccounts` `acctTile` `onPreview` (set only for active non-admin; churches need an active login `cu`) → `confirmEnterAccountPreview` → `enterAccountPreview`. Backend `POST /accounts/users/:id/preview` (`account.controller.preview` → `previewAccount` + `issueTokenFor`). |
| **Writes not blocked during account preview / an audit row appeared** | SPA `api()` guard must read `if(PREVIEW_MODE\|\|ACCOUNT_PREVIEW)`. Read-only is CLIENT-SIDE ONLY by design — the minted token is fully capable server-side. |
| **Stranded in a preview after refresh / can't get back to admin** | `_previewStash` + `localStorage['ycp_preview_stash']` restore in `_tryRestoreSession`; `_exitAnyPreview`→`exitAccountPreview` restores the stashed admin token. `logout()` clears both preview flags + the stash before its POST. |
| **Login/every screen 403s with `MUST_CHANGE_PASSWORD`, or a "Set a New Password" screen appears** | `mustChangePassword` gate — **currently DISABLED** (2026-07-11, `MUST_CHANGE_PASSWORD_ENFORCED = false` in both `express-adapter.ts` and `public/index.html`; see CLAUDE.md). If you see this, one of those two constants was flipped back to `true` without the other, or a stale deploy is live — check both are in sync and `sw.js` was bumped. |
| **Preview at-camp view won't load** | SPA `RENDER.home` `/settings` re-fetch is guarded by `if(!PREVIEW_MODE)` (~636); `enterPreview` (483) |
| Mode change didn't reach a logged-in user | SPA `RENDER.home` `/settings` re-fetch (~636, skipped in preview); backend `admin.service` |
| **Check-in "Endpoint not found" / session 404** | SPA `RENDER.checkin` (981) — status path must `encodeURIComponent` the id; session-id delimiter is `~` (NOT `#`). Backend `checkin-sessions.ts` `parseSessionId`. |
| "No check-in sessions configured" | backend `checkin-sessions.ts` `buildSessions` — driven by `settings.checkInDays` (set via admin Settings dates), NOT the schedule |
| Check-in count / roster wrong | SPA `RENDER.checkin` (981) + `_optimisticState` (975); backend `checkin.service` / `dashboard.service` / `person.service` (atCamp scoping) |
| Check-in tap doesn't stick / undo broken | SPA `CHECKIN_QUEUE` (946) `drainQueue` (956) `_performCheck` (1052) `undoCheck` (1075) |
| Sign-in/out wrong (atCamp/lifecycle) | SPA `signOut/InConfirm` (1485/1509); backend `person.service.signEvent` + presence invariants in CLAUDE.md |
| Search / reveal contact | SPA `runSearch` (1198) `reveal` (1215); backend `search.service` |
| First-aid student lookup / Student Info card | SPA `renderSearchFirstAid`/`openStudentInfo`/`revealMedicare`; leader contacts via `GET /search/contacts/:id` (`search.service.resolveContacts`). (Medical Watch + `/campers/medical` removed from the first-aid path in Phase 4; `listMedicalWatch` still serves other roles.) |
| First-aid records (log an action / Records tab / Notes "First-aid" filter) | SPA `openFirstAidLog`/`saveFirstAidLog`, `RENDER.records`/`drawFaRecords`, `drawNotes` firstaid branch. Backend `note.service.add` (category-scoped: `note:write:firstaid`) + `recentFirstAid` (`note:read:firstaid`, `canAccessPerson`-scoped) → `GET /notes/firstaid`. Body = 4 lines Problem/Treatment/First-aider/Brought by (`_faParse`). No migration. |
| **First-aid Records "Export" button (CSV) missing/wrong** | SPA `exportFaRecords()` (on the `RENDER.records` page) — builds the CSV client-side from `window._faRecsAll` (loaded from `/notes/firstaid?limit=100`) via `_faParse`; filename via `_exportName`. No backend/permission change (firstAid = `note:read:firstaid` only). Exports the loaded records, not the on-screen Today/All filter. |
| Notices not showing / urgent popup | SPA `RENDER.notifs` (1218); `renderHomeAtCamp` (713) |
| Accommodation allocation (rooms/auto-fill/unallocated/single-gender) | SPA `RENDER.accom`/`addAlloc`/`removeAlloc`/`drawAccom` (~1278); backend `accommodation.service` + `accommodation-allocation.ts` (75% eligibility, `validateAllocations`). Classroom pools include **both students and leaders** (tent pools keep students/leaders separate). |
| Budget numbers wrong | ⚠ **SUPERSEDED 2026-07-29** — see "2026-07-29 — seven-item owner batch" at the end of this file. Categories are TICKET CLASSIFICATIONS now, not cost bands, and the total reads as money received (`personValue` prefers `amountPaid`). Everything after this sentence describes the pre-2026-07-29 model: Pure `src/services/budget.ts` (`computeBudget`, tested) → SPA `computeBudgetClient`/`drawBudget`. Costs = per-registrant `registrationCost` (NOT settings prices, which are deprecated). Grand total must == Σ all line totals. Null cost = "Cost not recorded" ($0, flagged). |
| Budget grand total ≠ sum of rows | the reconciliation invariant — check `computeBudget`/`computeBudgetClient` line-total math; covered by `budget.test.ts`. |
| Church/zoneLeader desktop sidebar empty, or admin at-camp sidebar wrong | `navModel`/`navSidebar` (single source) — NOT `_renderWideNav`'s old per-role lists (deleted). |
| Bottom tabs ≠ sidebar items | both derive from `navModel` now; fix it there (D3). |
| Accommodation group counts wrong / no 7-9·10-12 split | `accomGroups`/`_accomGenderGroups` (SPA) + `computeGroups`/`groupsForGender` (backend, tested). Split triggers at pool >50; leaders halved (ceil→7-9). SPA now includes leaders in the pool (was camper-only). |
| **A church's classroom-preference people (incl. leaders of one gender) are missing from BOTH the classroom groups and Tent City totals** | **(Fixed 2026-07-20)** was a real gap — a church under the 75% classroom-eligibility threshold had no classroom group AND its people weren't literally `accommodationKind==='tent'`, so they were uncounted anywhere. `tentDistribution` (backend `accommodation-allocation.ts`) and its SPA mirror `tentDist` now fold in anyone whose `accommodationKind==='classroom'` but whose church isn't eligible — `isEligible`/`tallyChurches` is the shared eligibility check both `computeGroups` and `tentDistribution` use. If this regresses, check that fold-in condition first; covered by `accommodation-allocation.test.ts` ("folds a classroom-preference person into tents…"). |
| First/last camp day has wrong check-in sessions | `checkin-sessions.buildSessions` (AC-1): day1 PM-only, last AM-only. Tested in `checkin-sessions.test.ts`. |
| "Signed out" filter / record missing on Notes | `RENDER.notes`/`drawNotes` — synthesised from camper `signOutHistory` (atCamp:false). |
| FAQ showing in at-camp | `RENDER.faq` guards `CAMP_MODE==='at-camp'`→home; no at-camp home FAQ tile; Help only a pre-camp tab in `navModel` (PC-7). |
| Compliance export downloads broken / serves HTML | `sw.js` `API_RE` must include `/export` (fixed since `camp-v4`; current cache is **`camp-v16`**). If the workbook itself 500s, see the audit-workbook row below (illegal sheet name). |
| Church can't / shouldn't see allocated room | SPA `renderHomeAtCamp` church tile — gated `campMode==='at-camp' && !PREVIEW_MODE`; backend `GET /accommodation/church-rooms/:churchId` |
| Pre-camp registrant edits / scoping | SPA `RENDER.people` (841) `scopeRegs` (878) `markReg` (925) |
| Testimony won't save / "no specific student" | SPA `RENDER.testimonies` (1556); backend `note.service` (`camperId` optional) + `notes.camper_id` nullable |
| Account: can't rename / change password / username | SPA `RENDER.adminAccounts` (1649) row actions — **rename+username merged into one "Account Info" modal** (`editLeaderName`/`editChurchName`, 2026-07-02; `editUsername` deleted); backend `POST /accounts/users/password` + `account.service` |
| **Accommodation override not applied / applied to a leader** | Set per-church in **Admin → Accommodation setup** (`RENDER.adminAccom`'s "Accommodation overrides" card → `saveChurchOverride` → `PATCH /accounts/churches/:id {accommodationOverride}`; moved 2026-07-20 off the church Account Info modal). Applied ONLY at CSV import — backend `import.service` `churchOverrideById` (tested). Column `churches.accommodation_override` (migration 016). |
| **At-camp student edit table wrong / add-student fails** | SPA `RENDER.adminStudents`/`stuSave`/`stuCreate` (~2955); backend `registrant.controller` PATCH (accepts churchId/churchName/zone + medical/dietary strings), `person.service.create/update`. New students are `registered` (NOT at camp) by design — they sign in via First-day arrivals. |
| **Import: file detected as the wrong type / rejected as unknown / Excel won't read** | SPA **redesigned 2026-07-02 (late)** — the segmented `IMPORT_SOURCES`/`setImportSource` picker is GONE. One field auto-detects each file by headers: `_detectImportType`/`_IMPORT_SIGNATURES` (add a column marker here if a real export isn't recognised), `_parseHeaderRow`, `adminUpload`→`_renderImportPreview`→`_confirmImport`, unknowns via `_renderImportUnknown`. Files run Form→Ticket→Invoice (`IMPORT_TYPES[...].order`). Excel: `_readImportFile`→`_ensureXlsx` (lazy-loads `public/vendor/xlsx.full.min.js`)→`_xlsxToCsv`. "last imported" line = `_loadImportStamps` (settings `*_imported_at`, stamped by `src/api/controllers/_import-stamp.ts`). |
| Import CSV issues (Form) | SPA `_confirmImport`/`adminUpload` / church import; backend `import.service` (church match by **name**). Ticket accommodation "blank" = the Ticket List was imported before/without a matching Form (rows → needsReview orphans); the combined upload auto-orders Form first. |
| **Import screen "How do I export…" guide broken (won't open / swipe / zoom / image missing)** | SPA `openImportGuide`/`_igDraw`/`IMPORT_GUIDE` + the `#impGuide` overlay div + `.ig-*` CSS (2026-07-03). Screenshots = `public/img/import-help/*.png` — a 404 there means the file wasn't committed or the path in `IMPORT_GUIDE` drifted; bump `sw.js` `CACHE` if an image is replaced (cache-first). |
| **Audit workbook download 500 / "unexpected error"** | `audit-export.service.ts` — worksheet names cannot contain `* ? : \ / [ ]`. `'Sign-in/Sign-out Log'` had a `/` and threw on `addWorksheet` (fixed 2026-07-02: `'Sign-in & Sign-out Log'`). Covered by `audit-export.service.test.ts`. First-aid records are their own `First-Aid Records` sheet. |
| **First-aid: tapping a student (Search or All Students) doesn't open the profile** | SPA `openStudentInfo`/`openFirstAidLog` must paint the ACTIVE first-aid screen via `_faScreen()` — hard-coding `'search'` made `paint()`'s stale-guard drop the render when on the `allstudents` screen (fixed 2026-07-02). Back button = `_faBackExpr(scr)`. |
| **Import: Ticket List / Invoice row not matching an existing person** | backend `person-matching.ts` `findPersonMatch` first — check name normalization/Levenshtein threshold; then the source-specific service (`ticket-import.service.ts` cross-church, `invoice-import.service.ts` tiered invoiceNumber→billing-name). Real header names are unconfirmed — check the field-mapping table in the design spec before assuming the matching logic is at fault. |
| **Import: a record has a "Needs review" badge that won't go away / accommodation "Guessed" pill looks wrong** | SPA Data tab `reviewCell`/`openReviewModal`/`_markReviewed` and `accomCell` (~3030, `RENDER.data`/`dataApply`); "Mark reviewed" PATCHes `needsReview:false` only — it does **not** fix/merge the record, that's still a manual edit. `accommodationKindConfidence` set by backend `ticket-import.service.ts` (always `'confirmed'`) or `invoice-import.service.ts` (`'guessed'`, via `buildAccommodationPriceLookup`). |
| New-year / reset / wipe guard | SPA `adminCloseOut`/`doNewYear` (1843/1867), `adminReset` (2038); backend `admin.service` |
| 403 / permission denied | backend `access-control.ts` (one file) |
| 401 / kicked to login | SPA `sessionExpired` (429) `api()` (357); check `SESSION_SECRET` env |
| **Login "Invalid credentials" for every failure (can't tell why a login fails)** | Working as designed (2026-07-03 enumeration hardening) — `auth.service.login` returns the SAME `Invalid credentials` for wrong username / inactive / passwordless / wrong password, and runs an equal-cost dummy scrypt (`DUMMY_PASSWORD_HASH`) so timing doesn't reveal account existence. To distinguish causes when debugging, check the user row directly (`status`, `passwordHash != null`), not the login response. |
| **"Too many login attempts" (429 on login)** | `express-adapter.ts` `loginLimiter` + `loginKeyOf` — 10 FAILED attempts per **ip+username** per 15 min (2026-07-02 rework; successes don't count, so shared camp WiFi can't lock the site out). Per-instance in-memory — a retry a minute later often lands on a fresh instance. |
| **Every request slow (~1s+) even on good WiFi** | `vercel.json` `"regions": ["syd1"]` must be present — without it functions run in iad1 (US East) while Supabase is in Sydney and every query pays a trans-Pacific round trip. |
| **Church / zone leader can't log in ("disabled by the camp administrator")** | Working as designed — admin toggled a login lock in **Settings** (`churchLoginLocked` / `zoneLeaderLoginLocked`). Backend check is `auth.service.login` (after the password). Locks block **new logins only**; existing sessions persist to the 12h TTL. admin/director/firstAid never blocked. Toggles: `RENDER.adminSettings`/`saveSettings`. |
| **Home/dashboard shows stale numbers for up to ~30s after a write** | `src/services/dashboard-cache.ts` (30s TTL). Check the write path called `invalidateDashboardCache()` — if a NEW write path was added that touches people/churches/notifications/settings and isn't in the list in CLAUDE.md ("Security & perf hardening ported from CMS"), add the call there. Never disable the cache to "fix" this — invalidate on write instead. |
| **A church/zone login sees another church's/zone's dashboard numbers** | Check `dashboard-cache.ts`'s cache key — it MUST be `${role}:${churchId ?? '_'}:${zone ?? '_'}`. If someone "simplified" the key (e.g. dropped churchId/zone), that's the bug — covered by `dashboard.service.test.ts` → "dashboard response cache" → the two scoping tests. |
| **A sensitive field reads as gibberish / "malformed ciphertext" / manual SQL shows `v1.` blobs** | Those columns are AES-256-GCM encrypted at the app layer (`src/utils/field-crypto.ts`, applied in `supabase.people.ts`/`supabase.notes.ts`). The SQL editor cannot read/edit `medical_conditions_enc`, `dietary_requirements_enc`, `consents_enc`, `blue_card_expiry_enc`, `other_medications`, `medicare_number`, `blue_card_number`, `parent_*`, `notes.body` — go through the app or a keyed script. "malformed ciphertext"/tag errors = wrong or missing `FIELD_ENCRYPTION_KEY`, or a value moved between rows (AAD is bound to `table:column:id`). |
| **Browser console shows a CSP violation / a resource silently fails to load** | `public/index.html` `<head>` `Content-Security-Policy` meta tag — a new external resource (font, script, API host) needs an allowlist entry there, not a workaround. The vendored SheetJS (`public/vendor/xlsx.full.min.js`) is same-origin so `script-src 'self'` already covers it. CSP also has `frame-ancestors 'none'` (2026-07-02). Bump `sw.js` `CACHE` (currently **`camp-v20`**) whenever `index.html` changes. |
| **Response security headers (HSTS / COOP / CORP / no-store / X-Powered-By)** | Set in `src/api/http/express-adapter.ts` (2026-07-02): `x-powered-by` disabled; HSTS (prod only), `Cross-Origin-Opener-Policy` + `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: no-store` on all API/export responses (static assets served by `express.static` stay cacheable). Google Fonts are unaffected (CORP governs our own responses). |
| **A leader isn't showing as "at camp" / still shows on My Youth as a late arrival** | Working as designed unless the mode switch never actually fired — leaders are bulk-signed-in ONLY on the pre-camp→at-camp transition (`admin.service.ts` `setMode`), not retroactively. A leader added by CSV import AFTER that switch already happened stays `atCamp:false` until manually signed in — they'll be in My Youth's "Late arrivals" bucket (`filterMyYouth`, no longer student-only) with the normal "Sign in to camp" button (`openCamper`). |
| **A leader appears on the twice-daily check-in screen, or inflates "still due to check in"** | Should never happen — `checkin.service.getSessionStatus` filters `kind !== 'leader'` and `dashboard.service`'s `checkInsDue` calc (`atCampNow`) does too. If it does, one of those two filters was removed/bypassed. |
| **Sensitive note/testimony still visible to a church login** | `note.service.ts` `forCamper` — the filter is `actor.role==='church'` only (zoneLeader/director/admin always see it). Check the note's `sensitive` field was actually persisted (`notes.sensitive` column, migration `019`) and that the toggle in `notePrompt`/`RENDER.testimonies` was checked before submit. |
| **Budget "Discount codes" section missing or counts look wrong** | SPA `computeDiscountSummaryClient` (mirrors `src/services/budget.ts` `computeDiscountCodeSummary`, tested) inside `drawBudget`. Blank/whitespace discount codes are never counted as a "code"; the total is registrants in the same scope as the rest of the budget table (church filter included). |
| **Sign-in/out log running totals look wrong, or rows aren't in time order** | `audit-export.service.ts` `buildSignInOutTimeline` — sorts ALL sign-in/out events (every person, students AND leaders) into one chronological list by ISO timestamp before replaying the running counters. If a event's `timestamp` isn't real ISO 8601, the lexical sort breaks; the counters increment on `type:'in'`, decrement on `type:'out'`, split by `person.kind`. |
| **Unallocated registrants "Confirm" button overwide / church select squished to just arrows (phone)** | SPA `_renderAllocCards` (~3464) — the `Confirm` button has an inline `width:auto;flex:0 0 auto` override (fixed 2026-07-08) so `.btn`'s base `width:100%` doesn't win the flex-basis fight against the `flex:1` church `<select>` beside it. If a similar select+button row elsewhere looks lopsided on phone, same fix applies. |
| **Unallocated list empty / an "OTHER" registrant not showing there** | `import.service.ts` sentinel branch (`isUnlistedChurchCell` → `churchId='__unallocated__'`, `zone=''`) — the church cell must be the exact literal `OTHER - please specify below` (case-insensitive) or blank. `GET /import/unallocated` = `people.findByChurch('__unallocated__')` in `allocation.service.ts` (filters out `cancelled`). SPA `RENDER.import`→`_loadAllocation`/`_renderAllocCards`; the SPA `UNALLOCATED_ID` const must equal the backend `UNALLOCATED_CHURCH_ID`. |
| **Manual church allocation lost after re-import / a duplicate person appears** | `import.service.ts` override index + redirect (runs BEFORE zone/accommodation are derived). Overrides come from `allocation_overrides` (migration `020`), keyed by name(+mobile) via `overrideNameKey`/`matchOverride` (`church-allocation.ts`). Ambiguous same-name+mobile → skipped with a warning (never mis-assigned). If the person is absent from a re-import they're deleted AND their override pruned (by design — they withdrew). Manual choice ALWAYS wins over the CSV. |
| **Allocated person didn't get the church's accommodation override / wrong zone** | Both are derived from `resolvedChurchId` AFTER the override redirect, so an allocated person inherits the assigned church's zone + accommodation override automatically. Immediate allocation applies it too via `accommodationKindForChurch` (`church-allocation.ts`, shared by `import.service` + `allocation.service.allocate`). Sentinel church = no override (correct). |
| **Church override tools missing / 403 on the Data Import screen** | New `allocation:manage` capability (`access-control.ts`) = **director + admin** only. Routes: `GET /import/unallocated`, `GET /import/allocations`, `POST /import/allocate`, `DELETE /import/allocations/:id`. SPA cards render only for director/admin (the `RENDER.import` role guard). |
| **Director can't reach Data Import / Records & Export** | SPA `RENDER.data` (2026-07-04) — two buttons at the top, `go('import')`/`go('adminData')`. If missing, check `navModel` hasn't regressed director's route to the `'data'` tab itself (pre-camp tab, also reachable at-camp via the home tile "Student Data Table"). |
| **Day badge / home tile / First-aid "Today" filter off by a few hours around midnight** | SPA `localDateISO()` (Brisbane-anchored "today") — check every "today" comparison uses it (`_realCampDayNumber`, `drawFaRecords`) instead of a raw `new Date().toISOString().slice(0,10)` (UTC, wrong before ~10am Brisbane). |
| **"Not Signed In" section missing/wrong on check-in** | SPA `RENDER.checkin`'s `notSignedIn`/`notSignedInSection` — fetches `/registrants`+`/campers` alongside the roster status; filters `atCamp!==true` (any lifecycle). Row action = `signInPrompt`. |
| **Zone-leader pulse shows zones not churches, or wrong amber threshold** | `renderOversightPulse` — `byChurch = ACTOR.role==='zoneLeader'` branch; amber threshold = `PULSE_AMBER_PCT` (70). Director/admin are DELIBERATELY still per-zone (not a bug). |
| **"Back to setup" chip never appears / never goes away** | `_wizardChipHtml` (checks `sessionStorage['ycp_wizardReturn']` + that the current screen id is a `WIZARD_STEPS` target) + `_wizardGo` (sets the flag, called from `RENDER.adminWizard`'s row `onclick`) + `RENDER.adminWizard` (clears it on arrival) + `logout()` (clears it defensively). |
| **`PUT /schedule/day` 404s, or schedule save still looks like N round trips** | Router (`src/api/http/router.ts`) needs the `PUT /schedule/day` entry AND `Route`/`BufferRoute`'s method union + the Express adapter's method-cast must include `'PUT'`/`'put'` (this was the app's first PUT route — easy to lose on a router refactor). Service-side: `schedule.service.ts` `replaceDay` + `IScheduleRepository.replaceDay` (both in-memory and Supabase implementations). |
| **Offline sign-in: export missing rows / wrong columns, or import doesn't match anyone** | `src/services/offline-signin.service.ts` — export filters `kind!=='leader' && lifecycle!=='cancelled'`; import matches by normalized `churchName|firstName|lastName` (exact text, no id column) and requires the "Signed In?" cell to be exactly `Y` (case-insensitive). A church editing names/church spelling on the sheet will silently land in `unmatched`, not a crash — check the returned `unmatched[]` list first. |
| **Director/admin home digest card missing a figure, or tapping it goes nowhere** | `_digestCardHtml`/`_renderDirectorDigest` (`public/index.html`) — Day N + "X/Y checked in" come from the `/home` DTO's `sessionExpected`/`checkInsDue` (backend `dashboard.service.ts`); "churches complete" re-fetches check-in session status and groups by church; "first-aid today" fetches `/notes/firstaid` and filters via `localDateISO()`. First-aid tap = `go('notes','firstaid')` — `RENDER.notes` must accept a `presetFilter` param for this to pre-select the filter. |
| **At-Camp Info shows the wrong sub-tab, or Schedule/FAQ/Devotionals edits don't save** | `RENDER.atCampInfo(sub)` + `_acInfoSub` (module-level state) — `AC_INFO_TABS` defines the three sub-tabs; content builders `_acFaqBody`/`_acDevosBody`/`_acScheduleBody` do the actual fetching/rendering. Save functions (`saveFaqPre`/`saveDevo`/`saveSchedDay`) are unchanged; their re-render helpers (`_rFaq`/`_rSched`) now call `RENDER.atCampInfo('faq'\|'schedule')` instead of the old standalone RENDER functions (which no longer exist). |
| **"Paid" on a student profile doesn't match what the church actually paid** | SPA `_paidOrCostRow` (`_paintPerson`) — shows `amountPaid` labelled "Paid" when an Invoice import recorded one (may be less than `registrationCost` for a partial payment/discount), else `registrationCost` labelled "Cost". If it's showing "Cost" and you expected "Paid", the person has no Invoice-import `amountPaid` on record. |

### 2026-07-17 feature batch (gender accounts, incidents, initials, passwords, bugs)

| Symptom | Go to |
|---|---|
| **A `b-`/`g-` login sees the other gender (or an `other`-gender student is invisible)** | `canAccessPerson` (`person.service.ts`) — gender narrowing is the ONLY place; denial is limited to a *concrete opposite* gender (`'other'`/unset = visible to both, by design). Roster/search/dashboard/registrant-`?churchId` fast-path all funnel through it. Scope rides `Actor.genderScope` (from `users.gender_scope`, migration `0006`, threaded in `auth.service.toActor`). A church login can't PATCH church/gender/zone (`update()` strips those for role `church` + re-asserts scope). |
| **Church split / `b-`/`g-` accounts not created, or legacy login still works** | `account.service` `createChurchWithAccount` (creates both), `splitChurchAccounts` (idempotent back-fill + retire), `randomizeChurchPasswords` (splits+retires+randomises+returns CSV rows). Routes `POST /accounts/churches`, `/split`, `/randomize-passwords` (**admin-only**). One-off: `scripts/split-church-accounts.ts`. **Prod churches were split for real 2026-07-18** via the button — if a NEW church is added later and stays single-login, re-run the button or the split route. |
| **Church password wrong format / export missing** | `src/utils/memorable-password.ts` (`Word.###`, ≥6 chars). SPA "Randomise & export passwords" button in `RENDER.adminAccounts` → `POST /accounts/churches/randomize-passwords` → client CSV. `mustChangePassword` is never set on these. ⚠ Since 2026-08-05 there is a sibling **Upload** button that goes the other way (sets passwords from an edited sheet) — see the 2026-08-05 section of the symptom router. The two share the card, not the code path. |
| **"Randomise & export passwords" shows a network-error toast** | Check whether the CSV actually downloaded first — the export itself (`POST /accounts/churches/randomize-passwords`) runs and downloads BEFORE the cosmetic `_rAccts()` accounts-list refresh; a failure in that refresh alone must never read as the randomise having failed (fixed 2026-07-18, `randomizeChurchPasswords()` in `public/index.html`). If the CSV genuinely didn't download, the real error is in the POST itself — check the network tab / server logs, not this toast wording. |
| **Incident won't log / not visible / church can see it** | `incident.service.ts` (Zod + `incident:manage` = zoneLeader/director/admin; delete = admin/director) + `incidents` table (migration `0007`, `summary` **encrypted** in `supabase.incidents.ts`). Routes `GET/POST /incidents`, `DELETE /incidents/:id`. SPA `RENDER.incidents` + home tile (`canManageIncident`) + Notes-page Record-filter "Incidents" option (leadership only). **Role-gated only — reachable in BOTH camp modes** (an at-camp-only gate was tried 2026-07-17 and reverted 2026-07-18: it left zoneLeader/director with no way to review a pre-camp incident). |
| **Incidents screen is completely blank (form/list/buttons render as nothing)** | The shell's fixed `<section class="screen" id="…">` divs (see "Frontend files"/`_navTo` in this file) are the ONLY valid `paint()` targets — `paint`/`_showScreen`/`_spinner` silently no-op if `getElementById(id)` is null. Confirm `<section class="screen" id="incidents">` exists in the shell markup (it was missing entirely for one deploy, 2026-07-17→18 — not caught by typecheck/vitest, only a live browser check). If a FUTURE new `RENDER.<x>` screen goes blank, this missing-container class of bug is the first thing to check. |
| **High incident: alert missing, or a church/firstAid CAN see the summary** | `incident.service.log` raises a `leadersOnly:true` urgent `Notification` (body=summary). Filtered from church/firstAid in **both** `notification.service.getActorFeed` AND `dashboard.service` `latestNotification` (duplicate filter — fix both). Body **encrypted at rest** in `supabase.notifications.ts` when `leadersOnly` (migration `0008` = `notifications.leaders_only`). |
| **Leader initials not prefilling / not in the export / one account sees another's** | SPA globals `LEADER_INITIALS` + `localStorage['ycp_initials_<username>']` (per-account), header `✎` badge, post-login prompt (church role only), seeds `LAST_LEADER`. Threaded into `CheckInEntry.leaderId` (check-in POST) + `SignOutEvent.leaderName`; export "Leader Initials" column (`audit-export.service`). Reveals log an `[audit]` line (`camper.controller`/`search.controller`) — no persisted reveal table exists. |
| **Compliance export (`/export/audit`, `/export/signin-out`) works for a church/zoneLeader** | Should 403 — gated on the new `export:compliance` capability (director+admin only) in `audit-export.service` (was `camper:read[:sensitive]`, which church/zoneLeader hold). Capability defined in `access-control.ts`. |
| **First-aid: leader number masked (should be plain) / parent number in cleartext** | `search.service.resolveContacts` returns leader unmasked + a masked `'parent'` contact; `revealContact(…, 'parent')` is the audited reveal (`camper:read:sensitive`). ALSO `camper.controller.maskParentForFirstAid` masks `parentPhone` in the `/campers` DTO for role `firstAid` (else it leaks in cleartext via the profile fetch). Other roles unchanged. |
| **Accommodation override not applied to a leader** | Now applies to EVERYONE on all 3 paths — `import.service` (Form), `ticket-import.service` (Ticket List), `accommodationKindForChurch` in `church-allocation.ts` (used by `allocation.service` manual allocate). If a leader keeps the wrong kind, check whichever of the three set it. |
| **Preview roster empty / drill-in contradicts the row / false "didn't save" banner** | Feature 1 sim (SPA, client-only): `_previewSimActive` (PREVIEW_MODE && real mode pre-camp), `_previewCanonicalPeople`/`_previewNotCheckedInIds` (last-5 by surname, 0 for ≤5 people)/`_previewIsPresent`/`_previewLocalFlips`. Applied to roster, Students/My-group list, AND `openCamper` presence. Check-in taps flip locally only (no `CHECKIN_QUEUE`). NEVER writes (api() guard backstop). |
| **iOS won't offer to autofill the saved password** | SPA login `<form id="loginForm">` (submit→`doLogin`), `autocomplete="username"`/`"current-password"`, stable `name`s. Device-only to confirm; saving a NEW password may not prompt (form never navigates) — autofill of an existing credential is the goal. |
| **Setup wizard step count / At-Camp-Info merge / no tooltip** | `WIZARD_STEPS` — Schedule/FAQ/Devotionals merged into ONE `atCampInfo` step (done = any has content); now **8 steps**. Each step shows a plain one-sentence `summary` line (the old `helpTip` bubbles are gone). |
| **Extra white bar at the bottom of the screen** | SPA `.tabs` CSS — `calc(2px + env(safe-area-inset-bottom) * 0.15)` (was full inset ≈1cm). Eyeball on a home-indicator phone. |

### 2026-07-18 fix batch (Testimonies & Notes: incident severity, zone accent)

| Symptom | Go to |
|---|---|
| **Incident record on Testimonies & Notes doesn't show Low/High** | `drawNotes`'s `badge(n)` (grep the name, `public/index.html`) — reads `n.severity` (`'high'`→red `pill warn` "Incident · High", else amber `pill amb` "Incident · Low"). `severity` itself comes from `GET /incidents` via `RENDER.notes`'s `incidentRecs` map — check that response has the field before assuming the badge logic is at fault. |
| **Note/testimony card missing its left-edge zone colour, or has the wrong colour** | `zoneAccentStyle(n.zone)` (near `ZONES`/`ZONE_COLORS`, ~line 804) applied as inline `style` on each card in `drawNotes`. `n.zone` resolution order (set in `RENDER.notes`): attached student's zone (`cmap` from `/campers`) → else the logging church's zone (`churchZoneById`, from a `GET /accounts/churches` fetch, keyed by the note's `authorChurchId`) → else `null` (no accent, by design — "zone-agnostic"). `ZONE_COLORS` must stay in sync with `ZONES`/backend `ZONE_NAMES` (currently Yellow/Blue/Black/Red) if a zone is ever renamed. |
| **Every card on Testimonies & Notes has no zone colour at all** | Check `RENDER.notes`'s new `GET /accounts/churches` call isn't failing/403ing (it's `.catch(()=>[])`'d, so a failure silently produces an empty `churchZoneById` — check the network tab / server logs, not just this screen). |
| **First Aid "All Students" is empty / still asks to pick a church first** | Church is no longer required (fixed 2026-07-19) — `RENDER.allstudents`/`drawAllStudents` (grep the name) renders the full camp-wide roster by default; church/zone/gender/grade are all optional filters now. If it's asking for a church again, that gate was reintroduced by mistake. |
| **First Aid alert box: "no medical conditions" looks alarming, or "no leader contact" looks calm** | Swapped 2026-07-19 (`openStudentInfo`, grep the name) — reassuring cases use `.fa-neutral` (new class, same quiet shell as `.fa-lead`), the actionable "no leader contact on file" case uses `.fa-alert`. If it looks inverted again, check which class each branch returns. |
| **Mode switch / full reset / new-year rollover: no confirmation dialog appears, or a native browser popup appears instead of the app's own dialog** | These 3 (`switchMode`, `adminReset`, `doNewYear`) were moved off native `confirm()`/`prompt()` onto the `.sheet`/`#modal` system 2026-07-19 — `_switchModeConfirmed`, `_adminResetConfirmed` (grep the names) are the continuation functions the modal's Confirm button calls. The other ~13 `confirm()`/`prompt()` sites in the file are unchanged/native by design (see `docs/FRONTEND-FIXES-PLAN-2026-07-18.md`). |
| **Camp mode changes but no toast appears (only the badge/tabs update silently)** | `_applyModeChange` (grep the name) now toasts on every genuine change — check its `mode===CAMP_MODE` early-return isn't firing when it shouldn't (e.g. `SETTINGS.campMode` was already mutated elsewhere before this ran). Covers both the cross-tab `storage` listener and the on-refocus `visibilitychange` handler, since both funnel through this one function. |

### 2026-07-26 batch (incident alerts, overlay stacking, preview phases)

| Symptom | Go to |
|---|---|
| **A deleted row (incident, FAQ, …) stays on screen until reload** | `_invalidate(path)` (`public/index.html`) — a write to `/<resource>/<id>` falls through to the generic `Cache.del(path)`, which matches only keys equal to or UNDER `/<resource>/<id>` and therefore **leaves the cached collection key `/<resource>` intact** for the 30s TTL. `/incidents` and `/faq` got explicit branches 2026-07-26; `/notifications`, `/notes`, `/registrants`, `/accounts` already had prefix branches. **Any NEW id-suffixed write endpoint needs its own branch naming the collection key.** |
| **A light-purple bar appears under the bottom nav (or under the login card) and vanishes when you scroll** | `html{background:#fff}` (near `html{font-size:16px}`). The CANVAS paints the strip iOS briefly exposes below the body box when the dynamic toolbar retracts / the keyboard dismisses; with no background on `html` the canvas inherits `body`'s `--paper`. If the purple bar returns, that rule was removed or a later `html` rule overrode it. NOT the same bug as the 2026-07-24 *black* bar (that one was fixed by making `body` light — both fixes are needed). |
| **A bottom sheet / overlay renders UNDER the bottom nav (its button is unreachable)** | The z-index ladder above `.modal` in the CSS: `.tabs` is **100**, so every full-viewport overlay must be `position:fixed` **AND** above 100. `.modal`/`.ig-wrap` 120, `.toast` 130, `#login`/`#mcpGate` 140. A new overlay that copies an old `z-index:50`-era rule will be covered by the nav. |
| **An urgent/incident alert appears at the BOTTOM of Home (bottom sheet), or at the top AND bottom at once** | The bottom-sheet path is **deleted** (`camp-v45`) — `_checkUrgentNoticesFromFeed`, `checkUrgentNotices` and `_ackUrgent` no longer exist. EVERY unacknowledged urgent notice (incident or human-sent) renders in the single top banner: `_urgentAlerts` → `_alertBannerHtml` → `_ackAlert`, `.inc-banner` CSS. If a sheet reappears, someone reintroduced a `modal()` call on the home render path. **If a user still sees the old sheet, it's a stale service worker** — the SPA is cache-first, so an installed PWA serves the previous `index.html` until the SW updates; force-reload / reopen to pick up the new `CACHE` version. |
| **An incident appears in the Notices list (home or the Notices screen)** | Both lists render through **`_noticeFeed()`**, which drops `leadersOnly` notices (owner decision 2026-07-26 — incidents live on the Incidents screen, the Notes record filter and the Home banner only). If one shows up, a call site bypassed `_noticeFeed`. |
| **An incident alert re-appears after acknowledging** | Expected on a DIFFERENT device / after clearing site data — acknowledgement is `localStorage`-only (`_DISMISS_KEY`), the owner's explicit choice over a server-side ack table. Same device re-alerting IS a bug: check `_ackAlert` wrote to `_DISMISS_KEY` and that `isNoticeDismissed` reads the same key. |
| **Preview shows "Day 1"/"Day 2", or only one of First-Day-Sign-In / Daily Check-in** | `SETTINGS.campDay`/`switchDay()` were **deleted** 2026-07-26 → `_previewPhase`/`switchPreviewPhase()`. Both controls must render in preview (`isDay1` is forced `true`), one greyed by `campPhase()`. If the phase ignores the badge, check `campPhase()`'s `if(PREVIEW_MODE)return _previewPhase` early-return still precedes the `checkinPhaseOverride` check. |
| **A `paint()` title/subtitle shows a literal `&amp;` (or `&lt;`)** | `_paint` writes them with **`.textContent`** — entities are never decoded. Use a bare `&` in `paint()`'s 3rd/4th args; `&amp;` is correct only inside `innerHTML` body strings. |
| **`b-<church>` and `g-<church>` see each other's dashboard counts** | `dashboard-cache.ts` `_actorKey` must include **`genderScope`** (added 2026-07-26; it was missing from the moment gender scoping landed in migration `0006`). Key = `${role}:${churchId}:${zone}:${genderScope}`. Covered by `dashboard.service.test.ts` → "scopes the cache key by genderScope". Any future scoping dimension goes here too. |

### 2026-07-19 fix batch (two-pass frontend review — 14 findings)

| Symptom | Go to |
|---|---|
| **A hardcoded color/font-size looks different from before** | ~35 literals were tokenized onto existing `--root` tokens (pure 1:1 value substitution, e.g. `#4f46e5`→`var(--blue)`) — should be visually identical. If something looks different, that substitution mapped to the wrong token; grep the old hex/rem value in git history (`git log -p -- public/index.html` around commit `b6bca4f`/`a3e2f16`) to find which token it became and check the token's actual value in `:root`. |
| **Check-in session picker (`#dayseg`) squeezes/overlaps past ~6 sessions** | Should scroll+snap instead (fixed 2026-07-19, CSS-only — `#dayseg`/`#dayseg button` rules near `.seg`). If it's squeezing again, the `overflow-x:auto`/`flex:0 0 auto` rules were reverted or overridden. |
| **A fetch-failure error shows in a muted/quiet style instead of the red `.err` box** | 4 specific catch blocks (`_navTo`, `RENDER.allstudents`, `RENDER.records`, `offlineSignInUpload`) were switched from `.note-hint` to `.err` 2026-07-19 — note `.err` defaults to `display:none` (built for the static login-error divs), so any NEW usage needs an explicit `style="display:block"` inline or it'll render invisibly. Don't blanket-replace `.note-hint` elsewhere — most of its ~50+ other usages are legitimate empty/info states, not errors (see `docs/FRONTEND-FIXES-PLAN-2026-07-18.md`'s correction on this finding). |
| **`#login`/`#mcpGate` stretch edge-to-edge on a wide screen/desktop** | Should be capped at `max-width:420px` and centered (fixed 2026-07-19, `#login>*,#mcpGate>*` rule). |

### 2026-07-23 overnight batch (items 1-9,11)

| Symptom | Go to |
|---|---|
| **iPhone won't offer to SAVE a new password** | SPA `#loginForm` (real `<form>` submit, `autocomplete="username"`/`current-password`, `type="text"` username) + `doLogin`'s `navigator.credentials.store(new PasswordCredential(...))` (feature-detected — Chrome/Edge/Android only; **Safari has no Credential Management API**). Old iOS may still not prompt for a brand-new credential; autofill of an EXISTING saved one is the reliable path. Not a bug if a never-seen credential doesn't prompt on old iOS. |
| **Session expires too soon / too late** | `auth.service.ts` `TOKEN_TTL_MS` (now **24h**, was 12h). Stateless token carries its own `exp`; no DB/session store. |
| **Signing a student in/out jumps to their profile instead of updating the list** | Should NOT anymore — `signInConfirm`/`signOutConfirm` call `_refreshAfterAttendance(id)` (grep it) which re-renders the CURRENT screen (`STACK` top) in place; only refreshes the profile if the action started there. Church sign-in is one-tap (`signInPrompt`→`_doSignIn`, no modal). If a list shows stale state after the write, check `_invalidate('/attendance')` still clears `/registrants`+`/campers`+`/checkin` (item 3 added those). |
| **Church initials prompt keeps appearing / is skippable / initials asked per action** | Item 7: `enforceInitials()` (no Skip) runs at login + session restore for church accounts; `_ensureInitials()` guards attributed writes. Note/testimony/sign-out DON'T show a name field for church (auto-applies `LEADER_INITIALS`); sign-in is one tap. The header ✎ badge = `promptInitials(true)` (switch). If initials are re-requested per action, a `_ensureInitials()`/hidden-field guard was removed. Per-account key `localStorage['ycp_initials_<user>']`. |
| **Home: First-Day Sign-In / Daily Check-in greying wrong, or the wide button missing** | `renderHomeAtCamp` — First-Day Sign-In is a **wide button** (`.wide-signin`, Day-1 only via `isDay1`), greyed (`.btn.bdis`) when `campPhase()!=='signin'`; Daily Check-in is the first **tile**, greyed (`.tile.tdis`) when `campPhase()==='signin'`. Both route via `openCheckinFace(face)` → one-shot `_forceCheckinFace` consumed by `RENDER.checkin`. Greyed taps `toast(...)`. "Wrong face opens" → `_forceCheckinFace` not cleared, or `campPhase()`/`checkinSwitchoverTime` wrong. |
| **Scheduled notice fires late / not at all / shows before its time** | Item 9 is **lazy-fire, no cron**: `notification.service` `getActorFeed` drops `scheduledFor > now` for everyone; a scheduled notice appears on the **next feed fetch after** its time (home load / Notices open) — it will NOT push at the exact minute if nobody opens the app. Pending list = `GET /notifications/scheduled` (`scheduled(actor)`: own if zoneLeader, all if director/admin). SPA `RENDER.scheduled`/`RENDER.compose` When-segment; datetime is **Brisbane UTC+10** (`_localInputToIso`/`_isoToLocalInput`). |
| **Can't edit/delete a scheduled notice / "you can only edit notices you created"** | `notification.service` `update` = creator (`senderId===actor.id`) or director/admin; `remove` widened so a creator deletes their own. Route `PATCH /notifications/:id`. Supabase `save` on-conflict set list was widened (title/body/scope/zone/church_id/priority/expires_at/scheduled_for/audience_estimate) — if an edit doesn't persist a field, check that list. |
| **A leader shows at-camp right after the mode switch (should be signed in manually)** | Item 5: `admin.service.setMode` NO LONGER bulk-signs-in leaders on pre-camp→at-camp. Leaders start `atCamp:false`; sign in via My-group "Late arrivals". If they auto-appear at-camp, the removed block was reintroduced. |
| **Audit workbook/CSV rows out of time order** | Item 6: `audit-export.service.ts` — Daily Check-in Log flattened `{p,ci}` sorted by `ci.timestamp` (workbook + `exportCheckInLogCsv`); Notes/First-Aid/Incidents sorted by `createdAt`. If unsorted, a sort copy was dropped. |
| **Camp settings screen: a section won't expand, or Save doesn't write a field** | Item 4: `RENDER.adminSettings` is now grouped `<details class="setg">` sections; ALL inputs stay in the DOM so `saveSettings` reads them regardless of collapse state. New window inputs = `stAmStart/stAmEnd/stPmStart/stPmEnd`; restriction = `stChurchCheckinRestrict`. "Notices missing from settings" is BY DESIGN → admin console **Communications** group (`RENDER.admin`). |
| **Church check-in blocked/allowed at the wrong time, or on a non-camp day** | Item 11: `checkin.service.assertSessionAllowed` → pure `allowedWindowSession(days,today,now,windows)` in `checkin-sessions.ts` (null = blocked: outside window OR non-camp day). Church only; no-op unless `settings.churchCheckinTimeRestricted` (now **defaults ON**). Windows = `settings.checkinWindow{Am,Pm}{Start,End}` (optional, defaults 06:00-12:00 / 12:00-22:00), editable in the settings "Check-in & timing" section. Zone/director/admin never restricted. |
| **Every settings save fails after adding a settings column** | Unchanged rule — `supabase.settings` writes ALL columns every save. The four `checkin_window_*` columns + `notifications.scheduled_for` were applied to prod (migrations `0010`/`0011`) BEFORE the 2026-07-23 push for exactly this reason. |

### 2026-07-26 web push phases 1-3 + launch-readiness batch

| Symptom | Go to |
|---|---|
| **A check-in-window-closing warning fires at the wrong time, on the wrong day, or not at all** | `warnWindow()` (the cheap settings-only gate) then `churchesBehind()` — both pure, both in `src/services/checkin-warnings.ts`, both with the clock **injected** (`zonedNow(tz, now)`), so reproduce them in a test rather than waiting for a real minute. Three traps live here: (1) "checked in" is **last-entry-wins**, matching `toRosterEntry` (`src/api/dto/person.dto.ts`) — a student checked in then out is NOT checked in; (2) **AC-1** means the first camp day is **PM-only** and the last is **AM-only**, so a missing AM/PM warning on those days is `allowedWindowSession()` returning null, not a bug; (3) times are **Brisbane, not UTC** (`DEFAULT_TZ` must stay byte-identical to `checkin.service.ts`). Lead time = `WARN_LEAD_MINUTES` (60). |
| **The scheduled tick runs but nothing is created / one bad church killed the whole tick / a "dedupe" was reported that was really a broken column** | `makeCronService` (`src/services/cron.service.ts`). It runs 288×/day so it MUST short-circuit on `warnWindow()` before loading people. Per-church errors are caught individually into a `failed` counter. Dedupe detection is on **SQLSTATE `23505`** only — never match the error message (`/dedupe_key/i` would swallow "column does not exist" and report success). |
| **`GET /internal/cron/tick` 401s / 404s / lets anyone in** | `src/api/controllers/cron.controller.ts` (`makeCronController`). Registered `auth:false` in `router.ts` and guarded by `Authorization: Bearer <CRON_SECRET>` via a constant-time `secretMatches` that **length-checks first** (`timingSafeEqual` throws on a length mismatch → a 500 that leaks length). An **unset `CRON_SECRET` fails closed** by design. It THROWS `UnauthorizedError` — returning an error object would come back as a 200. Silent failure end-to-end usually means the scheduler side: `pg_net` is fire-and-forget, so a 404 (route not deployed) or 401 (no `cron_secret` in Supabase Vault) only shows up in `net._http_response`. Reading `Authorization` at all needs `HttpRequest.headers` (`src/api/http/types.ts`) — new in this release. |
| **A leader sees (or is pushed) a notice they shouldn't, or a scheduled/expired/leaders-only notice leaks** | `canSeeNotification()` (`src/services/notification-visibility.ts`) — the **single** audience rule: `leadersOnly` (church + firstAid excluded), zone/church scope, expiry, and `scheduledFor > now` withholding. `getActorFeed` calls it and so will the push audience resolver. **Never reimplement these rules elsewhere.** One pre-existing duplicate remains: `dashboard.service`'s `latestNotification` `leadersOnly` filter — fix both if you change the rule. |
| **Queued check-ins lost on reload / replayed after a force-quit / attributed to the wrong leader** | `_ciqKey()` / `_persistQueue()` / `_restoreQueue()` (`public/index.html`). `CHECKIN_QUEUE` mirrors to `localStorage` per account (`ycp_ciq_<username>`), rehydrated once at boot (`window._ciqRestored`). **Initials are captured at QUEUE time** (`_queueEntry` stores `initials`), so a rehydrated entry keeps its original author even if the ✎ badge was switched. Entries whose `sessionId` isn't the selected session are **dropped with a toast** (window closed, the POST would 403) — reconcile against the paper sheet. ⚠ Known, accepted: a crash in the one-tick gap between `drainQueue`'s `await` resolving and the shift+persist replays the entry → a **duplicate row in the compliance export** (`withCheckIn` has no `(sessionId,camperId)` dedup). Displayed state is unaffected. |
| **A discount code's "paid in full" override doesn't apply / the budget total ignores it / a director gets 403 saving it** | ⚠ **SUPERSEDED 2026-07-29** — see "2026-07-29 — seven-item owner batch" at the end of this file. `applyDiscountOverrides`, `_applyDiscountOverrides`, `_saveDiscountOverride` and `PATCH /settings/discount-overrides` **no longer exist** — the per-code dollar amount became a per-code TAG (`_saveDiscountTag` → `PATCH /settings/discount-tags`), and migration `0017` carried the old keys across as `'inperson'`. Historical description follows: Pure `applyDiscountOverrides` (`src/services/budget.ts`, tested) runs before `computeBudget`; SPA mirror `_applyDiscountOverrides` + `_saveDiscountOverride` (Budget screen). Endpoint = `PATCH /settings/discount-overrides` (`settings.service.ts`), gated on the new **`budget:manage`** capability = **admin + director only** (deliberately not folded into `admin:manage`). Persisted in `settings.discount_code_overrides` (**migration `0015`, NOT yet applied to prod** — until it is, every settings save fails, since `supabase.settings` writes all columns). |
| **A church login's list read is slow / the prefetch never hits / two screens show people in different orders** | `_scoped(path)` (`public/index.html`) appends `?churchId=` for church logins on `/registrants` and `/campers`, activating the backend `scopedAll` → `findByChurch` fast path. ⚠ It must be used for the `api()` call **and** the matching `_allCached()`/`_prefetch()` key — `Cache.get` is an exact-key lookup, so a mismatch silently disables the cache hit (no error, just slower). Ordering is `(last_name, first_name)` on all 10 people finders — if two screens disagree, one finder lost its ORDER BY. |
| **App boots green then 500s on every person read ("An unexpected error occurred")** | Should no longer be possible on Supabase — `assertFieldEncryptionKey()` (`src/utils/field-crypto.ts`) is called from `src/app.ts` at boot when `PERSISTENCE==='supabase'`, beside `assertSessionSecret()`, so a missing/malformed `FIELD_ENCRYPTION_KEY` refuses to start instead. If it boots anyway, that call was removed or the guard condition changed. (Minor: the `try/catch` around `Buffer.from(raw,'base64')` is dead code — the 32-byte length check does the real validation.) |
| **The "Confirm N sign-ins" bar on the arrival screen is stranded at the end of a long roster / hidden behind the nav** | `.fd-confirm` CSS (`public/index.html` ~line 399) — must be `position:fixed` with `z-index:105` (between `.tabs` 100 and `.modal` 120), NOT `position:sticky` (sticky pins to the bottom of the CONTENT, and the phone shell is body-scroll). Same class of bug as the 2026-07-24 Follow-up 7 `absolute`→`fixed` sweep. A spacer keeps the last row clear while the bar is shown. |
| **⚠ Schedule editor time boxes won't shrink no matter what you change** | **`.sched-row .sr-t` and `.sched-row .fld` have EQUAL specificity (0,2,0)** and the time input carries **both** classes (`<input class="fld sr-t" type="time">`) — so the rule that appears **LAST in the stylesheet wins**, and a `.sr-t` rule placed ABOVE `.fld` is **silently dead**. Three separate attempts to shrink these boxes had no effect for exactly this reason (each narrowed the grid track while `.fld`'s padding/font kept winning, and `overflow:hidden` on `.sched-row input` hid the overflow rather than fitting the box). The `.sr-t` block must stay **after** `.sched-row .fld` (~line 383). If it must win from elsewhere, raise the specificity (`input.sr-t.fld`) instead of relying on source order. |
| **A documented feature isn't in prod even though CLAUDE.md describes it in the past tense** | Check `git log origin/master..HEAD --oneline` **before** debugging. This bit hard on 2026-07-27: the entire 2026-07-26 web-push/launch-readiness batch (9 commits) was sitting unmerged on `feat/web-push-phase1-3` while prod ran `369437c`. This repo auto-deploys **`master`** — a commit on any other branch is not live no matter what the docs say. |
| **Leaders missing from the Day-1 arrival screen** | Fixed 2026-07-26 — leaders were filtered out of BOTH the `/campers` and `/registrants` feeds on that screen, so a leader missed by the bulk sign-in could not be signed in at all. They badge "Leader" and the grade filter has a Leaders option. They remain **correctly** excluded from the twice-daily check-in roster (`checkin.service.getSessionStatus` filters `kind !== 'leader'`) — that is a different screen, don't "fix" it there. |

### 2026-07-27 small SPA fix batch (incidents placement, testimony picker, settings collapse, nav label)

| Symptom | Go to |
|---|---|
| **Incidents is a slim link instead of a tile on the home menu** | It's a **tile** again as of 2026-07-27 (`renderHomeAtCamp` — `canManageIncident()` pushes it into `tiles`). The 2026-07-26 demotion to `incidentsLinkHtml` was a misread of the owner's request and that const is deleted. **The thing that was meant to move is the alert banner, not the tile** — don't "re-apply" the old change. |
| **The urgent-alert banner ("Got it" strip) is at the top of Home / has moved / appears twice** | `_alertBannerHtml(feed)` — since 2026-07-27 it is injected **immediately above the "Notices" heading** on BOTH home variants (`renderHomeAtCamp`, and inside the notices block in `RENDER.home`), NOT at the head of the markup. There is still exactly ONE alert surface, so this moved human-sent urgent notices as well as incident auto-alerts. If it renders twice, a call site kept the old head-of-`html` injection. Acknowledgement is still per-device `localStorage` (`_DISMISS_KEY`). |
| **Testimony dropdown is missing a student / shows students who never arrived** | `RENDER.testimonies` reads **`/campers` only** (2026-07-27) = `isCamper`, lifecycle ≥ `arrived`. A student who never signed in is correctly absent; one who signed in and later signed out is correctly present. This **deliberately reverses the earlier "CH-2" fix** which merged `/registrants` in — the requirement has now flipped in both directions, so confirm with the owner before changing it a third time. A near-empty list in pre-camp is expected (the screen is only reachable from the at-camp home tile). |
| **A Camp Settings section is expanded on open** | `RENDER.adminSettings` — all three `<details class="setg">` must be plain `<details>`, no `open` attribute (2026-07-27). Collapse state is purely cosmetic: every input stays in the DOM so the single `saveSettings()` PATCH writes them all regardless. Don't make section bodies render lazily to "tidy this up" — that would silently break Save. |
| **Bottom nav still says "Sign-in" after the app has moved into check-in (or vice versa)** | `_syncNavPhase()` (declared beside `campPhase()`, 2026-07-27). `navModel._ci()` always computed the label correctly — the bug was that `buildTabs()` only ran at login / mode switch, so the label froze for the whole session. `_syncNavPhase()` compares `campPhase()` to the cached `_navPhase` and rebuilds only on a real change; it is called from `RENDER.home` (switchover time passing), `switchPreviewPhase()` (preview toggle) and `saveSettings()` (admin pins `checkinPhaseOverride`). If the label is stale from a NEW code path that changes the phase, that path needs a `_syncNavPhase()` call too. **The desktop sidebar never had this bug** — `_renderWideNav` runs on every `paint()`, so a mismatch between sidebar and bottom nav is the tell. |
| **An admin's phase override / switchover-time edit doesn't reach other logged-in sessions** | `RENDER.home`'s `/settings` re-sync now copies `checkinPhaseOverride` + `checkinSwitchoverTime` onto `SETTINGS` (2026-07-27) — it used to copy **only** `campMode`, so `campPhase()` kept reading the values loaded at login. Same guard as the mode sync: skipped entirely while `PREVIEW_MODE` (a previewing user must not be snapped out). |

### 2026-07-27 — "Missing bearer token" on load, gone after a refresh

| Symptom | Go to |
|---|---|
| **A raw `Missing bearer token` error appears on load and a refresh "fixes" it** | Two defects, both fixed 2026-07-27, both in `public/index.html`. (1) **`GET /settings` is `auth: false`** (router.ts:82 — the login screen needs camp name/branding before anyone is authenticated), and `_tryRestoreSession()` used it as its only probe. A dead token therefore **passed the restore gate**, the login screen was hidden, and the app only fell over one tick later when `_prefetch()`'s authed calls all 401'd. It now calls **`await api('/auth/me',{noCache:true})`** first — an authenticated route — so a dead session goes straight to the login screen. (2) `_doFetch`'s 401 branch was guarded on **`&& TOKEN`**. `_prefetch()` fires five requests in one tick; the first 401 runs `sessionExpired()` which **nulls TOKEN**, so the other four fell past the guard and surfaced the server's raw string as a toast. The guard is now `path.indexOf('/auth/login')!==0` — `/auth/login`'s own 401 means *wrong password* and must keep its own message on the login form. |
| **Users get logged out roughly once a day** | Expected. Sessions are **stateless HMAC with a 24h TTL** (`TOKEN_TTL_MS`, `auth.service.ts:10`) — there is no refresh/sliding window. Anyone returning the next day gets a clean "Session expired — please sign in again." on the login screen. That is the fix above working, not a bug. |
| **Diagnosing an auth problem in prod** | The Vercel runtime logs answer it in one call — filter `statusCode: 401`. The tell for this bug was that **`/settings` was absent** from the 401 list while `/home`, `/notifications`, `/checkin/sessions`, `/accounts/churches`, `/accounts/users` (exactly `_prefetch()`'s set) were all there. |

### 2026-07-28 - 28-item bug/improvement batch (schedule, allocations, site map, reset logs, imports)

New/changed symbols - grep the name, don't trust offsets.

| Symptom | Go to |
|---|---|
| **Schedule screen looks like a flat list / an item is the wrong colour or the wrong size** | Colour logic is current; the SIZE figures below were **recut 2026-07-29** (`min(133,max(38,28+mins*0.27))`, ~30% shorter, duration inline in `.sch-time`) — see the 2026-07-29 section at the end of this file. SPA `RENDER.schedule` + `SCHED_CATEGORIES` / `schedCategory()` / `_schedMinutes()` / `_schedHeight()` and the `.sch-*` CSS. Colour = first keyword match on the activity TITLE (session -> violet, zone battle -> rose, pre show -> teal, meal words -> amber, anything else -> grey). Size = minutes until the NEXT item's start; the LAST item of the day runs to 24:00 (which is what "Lights Out" wants). Height is deliberately compressed (`40 + mins*0.38`, clamped 54-190px) so a 30-minute item stays tappable. Adding a category = one `SCHED_CATEGORIES` entry + one `.sch-<id>` CSS line; the admin editor's tooltip quotes the same list via `_schedKeywordHelp()`. |
| **Schedule editor "+ Add row" adds at the bottom instead of after the row I was typing in** | SPA `_schedLastRow` / `_schedFocus()` / `addSchedRow()`. The row is remembered on `focus` of either input; the insert only happens when that row is still in the document AND belongs to the same day's `#schedRows_<d>` wrapper - otherwise it appends, which is also the never-touched-anything case. |
| **Devotionals / schedule went blank after the camp dates were moved** | `remapDays()` + `applyDayMoves()` in `src/services/settings.service.ts`, wired via `makeSettingsService(repo, {devotionals, schedule})` in `container.ts`. Content is keyed by absolute DATE but authored per day NUMBER, so a date change re-keys it by POSITION. Rows are DELETED then re-saved (an overlapping shift means day 2's old date IS day 1's new date - a per-row update would clobber mid-pass). Shrinking the camp leaves the surplus day's rows on their old date: **hidden, never deleted**, so lengthening again recovers them. `makeSettingsService(repo)` with no deps makes the remap a no-op (unit tests, `admin.service`'s internal instance). |
| **Budget: the text under a church's "Campers"/"Leaders" heading is blank, sometimes with just a warning triangle** | SPA `_budScopeRows` - it built rows without a `label`, while `drawBudget`'s `catRow` renders `esc(r.label)`. `_budLabel(amount, full)` (the mirror of `labelForAmount` in `src/services/budget.ts`) now fills it; `full` was already threaded in for exactly this and was simply unused. |
| **Classroom allocation: a church has per-year-level pools (`c1|male|Y8`) instead of `7-9`/`10-12`** | Working as designed since 2026-07-28 (bug 5). TWO levels of split now: a church x gender classroom pool over `SPLIT_THRESHOLD` (50) splits into `7-9`/`10-12`, and a bracket that is ITSELF over 50 splits again into single year levels `Y7`...`Y12` - up to 6 pools per gender, 12 per church. `groupsForGender` / `yearGroupsFor` / `spreadLeaders` in `src/services/accommodation-allocation.ts` (tested), mirrored by `_accomGenderGroups` / `_accomYearGroups` / `_spreadLeaders` in the SPA. Leaders halve across brackets then spread evenly across that bracket's year levels, remainder to the earliest. Unknown-grade youth ride with the bracket's LOWEST year. `classroom_allocations.bracket` is unconstrained `text`, so the wider key values needed no migration. |
| **A tooltip bubble is cut off / hidden behind the sidebar on a laptop** | SPA `_clampTip` - it now clamps inside the nearest `.screen`, not just the window. At >=980px the content sits in a 220px-inset `#stage .screen` that is `overflow:hidden` both ways, so a viewport-only clamp still let the bubble run under the sidebar and get clipped there. Phone behaviour is unchanged (no `.screen` inset -> falls back to the viewport). |
| **A light-purple strip under the bottom nav (still, after the 2026-07-26 fix)** | Two rules together, BOTH required: `html{background:#fff}` (2026-07-26, the CANVAS) **and** - new 2026-07-28 - `body{background:#fff}` with `--paper` left on `.app` alone, plus **`.tabs::after`** which extends the nav's white surface 120px BELOW it. The 2026-07-26 fix only covered the canvas; the strip iOS exposes below the layout viewport is also painted by the BODY box, which still carried `--paper`. `.tabs::after` starts at `top:100%` inside the nav's own stacking context, so it can never cover page content. |
| **Church accounts: editing one gender's username breaks both logins** | Fixed 2026-07-28 (bug 13). `editChurchName`/`saveChurchName` now edit the church + BOTH logins as one unit: the admin types the BASE only and `_churchPrefix(cu)+base` re-applies `b-`/`g-` per account. Helpers `_churchUserBase` / `_churchAccts` / `_churchPrefix`. `bulkChurchUpdate`/`saveBulkChurch` do the same (one `data-bcbase` field per church; passwords stay per account). The accounts screen now renders ONE joined `.ch-pair` card per church (blue `.ch-m` / pink `.ch-f` halves) rather than two independent tiles - the old two-tile layout is what made a shared-modal edit look safe. |
| **"Hi <church>" shows only the first word of a long ministry name** | `dashboard.service.ts` `greetingName` - `displayName.split(' ')[0]` is now applied ONLY to personal leadership logins; a `church` actor gets its full name (its displayName IS the ministry name). SPA `_heroNameCls(name)` adds `.long` past 14 chars -> half type size + wrapping (`.hero h2.long`). |
| **First-aid lists hide someone / "Signed in only" is on and I didn't set it** | By design (bug 20). `_faSignedInOnly` defaults **true**; `_faSignedInFilter` is applied to BOTH `runFaSearch` and `drawAllStudents`. The filter is INERT pre-camp (`_faPresenceMatters()` - nobody has signed in yet), same reasoning as the red "Not on site" row flag. Toggle = `_faSignedInToggleHtml`/`_faSetSignedIn`. |
| **First aid: tapping a parent number says "Camper not found"** | Fixed 2026-07-28 (bug 21). `search.service.revealContact` required `isCamper(person)` (lifecycle >= arrived) while `resolveContacts` deliberately did not - so the card rendered a masked number for a not-yet-arrived student that could never be revealed. The two now agree; `canAccessPerson` is still the real gate. |
| **A student's second ministry contact is the opposite gender's leader** | By design (bug 22). `contactsForPerson()` in `search.service.ts`: lead with the person's own gender, and if that gender has a primary but **no backup**, borrow the opposite gender's PRIMARY as the secondary. A gender that already lists a backup is untouched. The older "no same-gender contacts at all -> use the whole opposite list" fallback still takes precedence. |
| **An incident survived a "full reset"** | Fixed 2026-07-28 (bug 16). `makeAdminService` was never given the incident or push-subscription repos, so `reset()`'s wipe list was silently incomplete. Both are now constructor params (`container.ts` passes `incidents, pushSubscriptions`) and both are cleared. **If a NEW repository is ever added, add it to `reset()` in the same commit** - nothing type-checks this. |
| **"Reset logs" cleared / didn't clear something** | `admin.service.resetLogs` (`POST /admin/reset-logs`). Clears exactly what the compliance workbook contains: every person's `checkInHistory` + `signOutHistory` (returning them to `atCamp:false` / `lifecycle:'registered'`, except `cancelled` which is preserved), ALL notes/testimonies/first-aid records, ALL incidents. **Notifications are deliberately NOT touched** - separate button on the same card. Guarded by the same export-or-force gate as a full reset. |
| **A typed confirmation ("I understand this cannot be undone") won't accept my input** | It is case-insensitive and whitespace-trimmed as of 2026-07-28 - `_CONFIRM_PHRASE` / `_confirmPhraseOk()` in the SPA. The canonical string is still what goes over the wire (`CONFIRM_WIPE_STRING` in `admin.service.ts` is a protocol constant and must match exactly); only what the admin TYPES is compared loosely, so a phone auto-capitalising the first letter no longer reads as a failed confirmation. |
| **Notices and Scheduled notices are one screen now** | Item 10, 2026-07-28. `RENDER.notifs(sub)` has a Sent/Scheduled `.seg` (`NOTICE_SUB`, `switchNoticeTab`); the Scheduled tab is sender-only. `RENDER.scheduled` is a thin alias that redirects to it, and the compose flow's returns set `NOTICE_SUB` then `gotoTab('notifs')` directly. The `#scheduled` screen container is retained but unused. The admin console's "Communications" group is gone - the single Notices tile lives under **Data**. |
| **The "Got it" alert banner doesn't appear for an urgent notice** | By design as of 2026-07-28 (bug 18). `_urgentAlerts` now also requires `_isIncidentNotice(n)` - acknowledgement was only ever meant for incidents. An ordinary urgent notice is read in the Notices list like any other. Because `leadersOnly` notices are filtered server-side for church/firstAid, **those roles never see the banner and never acknowledge anything** - intended, not a regression. |
| **Adding a note from the Students screen fails with "Validation failed"** | Fixed 2026-07-28 (bug 19). The SPA posted `sessionId: SEL_SESSION`, which is genuinely `null` outside the daily check-in screen, and Zod's `.optional()` rejects `null` (it accepts only `undefined`). `AddNoteSchema` now uses `.nullish()` AND `confirmNote` omits the key when there is no session - either alone is sufficient, both mean neither side can reintroduce it. **Any new optional field on a schema the SPA posts to should be `.nullish()`, not `.optional()`.** |
| **Import reports "Missing firstName or lastName" but then imports fine** | Fixed 2026-07-28 (item 12). A trailing blank line is spreadsheet padding, not a defect - `isBlankRow(row)` (`elvanto-mapping.ts`) now skips an entirely-blank row silently in all three importers. Also `field()` falls back to a NORMALISED header lookup (lowercase, non-alphanumerics stripped), so "First name" / "FIRST NAME" / "First  Name" all resolve. A genuinely half-filled row still errors. |
| **Import preview didn't warn me someone was about to be deleted** | `import.service.ts` - the Form import is authoritative and deletes anyone absent from the file. It now emits ONE warning per absent person naming them and their church (capped at 50, then an "...and N more" row), visible in the DRY-RUN preview before anything is confirmed. The `deleted` count is still authoritative. |
| **A person has two tickets / two invoices** | Item A, 2026-07-28 (the "bought the wrong ticket, pay the difference with a code" flow). **Tickets** (`ticket-import.service.ts`): matching already collapsed them onto one person and the LATER row's type wins (the corrected ticket) - it now also warns naming the winning ticket number and sets `needsReview`. **Invoices** (`invoice-import.service.ts`): money fields ACCUMULATE across rows (`moneyByPerson`) - `amountPaid`/`discountAmount`/`feesAmount`/`taxAmount` summed, `registrationCost` from the latest row - plus a warning and `needsReview`. Accumulation starts from the rows in THIS file, never from the stored value, so **re-importing the same export is idempotent and cannot double-count**. Do not "simplify" that to read the existing person's value. |
| **A discount code reads "Ticket difference - already paid" instead of "100% Off"** | Item C, 2026-07-28. `deriveDiscountPurpose` (`budget.ts`, + SPA mirror `_deriveDiscountPurpose`): a code averaging >=97% of the ticket price is the pay-the-difference correction, not a sponsored place. It is still COUNTED in the summary (owner's decision) but labelled honestly so the budget cannot be misread as free places given away. 100% is no longer reachable via the tier buckets. |
| **Audit workbook rows are newest-first** | By design as of 2026-07-28 (item 24) - every sheet. The Sign-in & Sign-out timeline still computes its running totals CHRONOLOGICALLY and only reverses afterwards, so each row's counts stay correct for the moment it happened and the TOP row carries the live totals. If you ever re-sort it, keep the fold BEFORE the reverse. |
| **Where is a Medicare reveal recorded?** | `camper.controller.revealMedicare` emits an `[audit]` log line (person id, actor role+id, initials, IP) to the Vercel runtime logs. There is **no persisted reveal table** and it is **not** in the compliance workbook - the Student Info card's caption says exactly that. Same model as the contact reveal in `search.controller`. |
| **Site map missing / Map button not showing / crop looks wrong** | Item 8, 2026-07-28. `settings.siteMapImage` (**migration `0016`**, `settings.site_map_image text`, applied to prod 2026-07-28) holds a client-baked `data:image/...` URI - the server never touches image bytes and the Zod schema REJECTS anything that is not a data-image URI. Button = `heroMapBtn()` on both home heroes (hidden when no map is set; firstAid has no home screen, so it gets a button on `renderSearchFirstAid` instead). Screen = `RENDER.sitemap` + the `<section id="sitemap">` container + `.map-*` CSS. Crop tool = `_openMapCropModal` / `_mapRectFor` / `_mapClampPan` / `_mapCropConfirm`, ported from YS Connection's SQUARE logo cropper and generalised to an arbitrary aspect ratio (`vp` -> `vpW`/`vpH`). Output: ~1400px long edge, PNG, falling back to JPEG 0.92 then 0.8 if it exceeds the 1.6M-char cap. |
| **Every settings save fails right after a deploy** | Unchanged rule, and it applied again here - `supabase.settings` writes ALL columns on every save, so migration `0016` (`site_map_image`) had to reach prod BEFORE the code. Reads tolerate absence (`?? null`); writes do not. |

### 2026-07-29 — site map follow-ups (owner testing)

| Symptom | Where it actually lives |
|---|---|
| **"Could not read that image file" on a perfectly ordinary PNG** | Fixed 2026-07-29. Nothing to do with `FileReader` or the file itself — the page's `<meta http-equiv="Content-Security-Policy">` (`index.html` line ~12) shipped `img-src 'self'`, which blocks **`data:` URIs**, so `probe.src = dataUrl` in `_openMapCropModal` fired `onerror` and hit the generic toast. The site map is the app's ONLY data-URI image, so nothing else ever exposed the gap. `img-src` is now `'self' data:` — **keep `data:` there**; removing it silently breaks the crop probe, the settings preview and the whole Map screen at once. The port from YS Connection's logo cropper missed this line because that app's CSP already allowed it. |
| **A tooltip opens downward into the bottom nav bar** | Fixed 2026-07-29. `_clampTip`'s flip-up test measured against `document.documentElement.clientHeight`, but `.tabs` is `position:fixed` over the content, so the last ~64px + safe-area of that height is not usable. It now takes `vh = min(clientHeight, tabs.getBoundingClientRect().top)`. `.tabs` is `display:none` on the >=980px sidebar layout, which gives a zero-height rect — that is why the guard tests `height > 0` rather than `offsetParent` (`offsetParent` is ALWAYS null for a fixed element, so that check would never fire). |

### 2026-07-29 — seven-item owner batch (schedule sizing, budget classification, imports, login UX)

New/changed symbols — grep the name, don't trust offsets. Migration `0017`
(`settings.discount_code_tags` / `tent_price` / `classroom_price`); `sw.js` `camp-v52`→`camp-v53`.

| Symptom | Go to |
|---|---|
| **Schedule rows are the wrong height, or the duration wrapped onto its own line again** | SPA `_schedHeight` (now `min(133,max(38,28+mins*0.27))` — a uniform ~30% cut from the 2026-07-28 curve) and the `.sch-item`/`.sch-time`/`.sch-dur` CSS. The duration lives INSIDE `.sch-time` as an inline `<span class="sch-dur">· 30m</span>`; `.sch-dur` must NOT have `display:block` (that was the old second line) and `.sch-item`'s time column must stay at **92px** — narrow it and the duration wraps, which puts the height back. Colour/category logic (`SCHED_CATEGORIES`/`schedCategory`) is unchanged. |
| **Budget rows say "Tent"/"Classroom" instead of "Full — $180"/"Half"/"Part"** | Working as designed since 2026-07-29. Categories are `TicketClass`es now: accommodation kind × the admin's tag on the person's discount code, plus `'unknown'`. `classifyTicket` (backend `budget.ts`, SPA `_classifyTicket`) is the whole rule. `labelForAmount` and `applyDiscountOverrides` **no longer exist** — if you find a reference to either, it is stale. |
| **The budget grand total dropped / a sponsored student stopped counting** | Expected, and deliberate. **`personValue` prefers `amountPaid` over `registrationCost`, and a `sponsor`-tagged code contributes $0** — so the total reads MONEY RECEIVED, not value of all places. `registrationCost` is the ticket TOTAL; a 100%-discount invoice records `registrationCost: 180, amountPaid: 0`, which is why preferring it would count sponsored places as revenue. Read `personValue`'s doc comment before touching this. To flip the reading, swap its last two lines AND the same two in the SPA mirror `_personValue` — nothing else changes. |
| **A student is in "Accommodation not recorded" / that row has a warning triangle** | `accommodationKind` is null on them — the Ticket List was never imported, or they are a needs-review orphan. Working as designed: they are counted and flagged, never dropped, because the grand-total-equals-sum-of-rows invariant is tested. Fix the DATA (import the Ticket List, or set the kind on the student), not the budget. |
| **A budget row shows "3 × —" instead of a unit price** | By design. `CategoryRow.amount` is the UNIFORM per-person value and is null when the row's members contributed different amounts; `lineTotal` is always the exact sum regardless. `amount == null` is a display detail and is NOT the same as `unrecorded` (true only for the `'unknown'` row). The CSV writes a BLANK UnitPrice cell for these, never `0` — a `0` reads as "free" beside a non-zero LineTotal. |
| **A code tagged "paid in person" isn't adding anything to the total** | `settings.tentPrice`/`classroomPrice` haven't been set. `personValue` falls through to the person's recorded amount (usually $0 for exactly these people) rather than inventing a number. Set them in **Admin → Camp settings → Ticket prices**; `drawBudget` shows a `warnbox` on the Discount codes card when this is happening. |
| **Where did the per-code "Mark paid in full" dollar field go?** | Replaced 2026-07-29 by the classification dropdown on the same card. The tag implies the value, so there is nothing to type. `_saveDiscountOverride`/`_prefillDiscountOverride` are deleted; the handler is **`_saveDiscountTag(code, tag)`** → **`PATCH /settings/discount-tags`** (was `/settings/discount-overrides`) → `SettingsService.updateDiscountCodeTags`. Same `budget:manage` gate (admin + director). Migration `0017` carried every old override key across as `'inperson'`. |
| **Saving a discount tag 400s, or an unknown tag value is rejected** | It shouldn't — `updateDiscountCodeTags` **silently drops** anything that isn't one of the three tags, and drops blank keys. Clearing a tag is a normal edit (the dropdown's "plain" option posts an empty string), not an error. If you see a 400 it is the capability gate or the route path, not the value. |
| **`tent_price`/`classroom_price` are back after migration `0004` dropped them** | Deliberate (migration `0017`) and their job is **narrower** than the pre-`0004` one: a REFERENCE full price used to value an `inperson` ticket and to define what "discounted" measures against. They are **not** the source of any registrant's recorded cost. Do not restore price × headcount. |
| **Every settings save fails right after this deploy** | The unchanged rule, and it applies to `0017` too: `supabase.settings` writes ALL columns on EVERY save, so `discount_code_tags`/`tent_price`/`classroom_price` must exist in prod BEFORE the code push. Reads tolerate absence; writes do not. |
| **"Clear all notifications" is missing from Data Export/Reset** | Removed 2026-07-29 at the owner's request. The backend route `DELETE /admin/notifications` is still registered but **nothing calls it** — same precedent as the retired sign-in/out CSV button. `adminClear()` is deleted from the SPA. Delete notices individually on the Notices screen. Don't re-add a bulk button without asking. |
| **An imported name is still ALL CAPS / a name like "McDonald" got mangled** | `titleCaseName()` (`elvanto-mapping.ts`). It fixes ONLY strings that are entirely upper- or entirely lower-case; **anything containing both cases is returned untouched**, which is what protects `McDonald`, `O'Brien`, `de Silva`, `van Wyk`. So "MCDONALD" → "Mcdonald" is the expected (accepted) trade-off of that rule. Applied in `import.service`, `ticket-import.service`, `invoice-import.service` — deliberately NOT inside `field()` (it also reads church names/ticket types/emails) and NOT in `offline-signin.service` (matches, never stores). **Import path only** — there is no prod backfill; an existing bad name self-corrects on the next Form import. |
| **iPhone: the screen stays scrolled down after the keyboard closes** | `_fixViewportGap()` (declared beside `_scroller`) — a same-position `scrollTo` on the next frame, on `visualViewport.resize` plus a delegated `focusout`. If it stops working, check both listeners are still registered at module scope. **NOT the same fix as the `html`/`body` white background + `.tabs::after` rules** (2026-07-26/28): those paint over the strip iOS exposes, this restores the scroll position. Both are needed; neither replaces the other. |
| **Login help links missing / 404 on `/install.html` or `/save-password.html`** | `_loginTips()` (beside `_initDemoLogin`, called at boot) fills `<p id="loginTips">` and is **UA-gated to iPhone/iPad/Android** — a desktop browser is meant to show nothing. The pages themselves are plain static files in `public/`; a 404 means they weren't committed. They are standalone pages, not in-app overlays, because the SPA shell isn't up on the login screen. Both fill their address from `location.host` (`.js-host`) and **must not call `/settings`** — the camp app has no `ministryConfig.branding.appName` (that block was dropped in the port from YS). |
| **The username field is prefilled on the login screen** | By design (2026-07-29) — `localStorage['ycp_lastuser']`, written on successful login by `doLogin`, read by `_loginTips()`. **The password is never stored.** Beyond saving typing it gives the phone's password manager a stable id to match its saved credential against. Cleared by clearing site data, not by `logout()` (deliberate — the next person to sign in on that device is almost always the same person). |
| **Login feels ~150ms slower** | Deliberate. `doLogin` awaits a 150ms timeout before hiding the form: Safari decides whether to offer to SAVE a credential shortly after the submit resolves, and tearing down the password field in the same tick can make it drop the prompt. Don't remove it to "speed up" login. |
| **`#mcpGate` (Set a New Password) looks different / its buttons stopped working** | It is a real `<form id="mcpForm">` with a submit button as of 2026-07-29, not a `<div>` of `onclick` buttons — the submit event is the main signal password managers watch for. The Sign Out button needs `type="button"` or it submits the form. There is also a hidden `autocomplete="username"` input (`#mcp-user`) filled by `_showChangePasswordGate`. The gate is dormant in prod (`MUST_CHANGE_PASSWORD_ENFORCED = false`), so this is pre-emptive. |

### 2026-07-30 — schedule editor copy / paste day

| Symptom | Go to |
|---|---|
| **"Paste day" did nothing / said "Copy a day first"** | `_schedClip` is module-level and is NOT persisted — a page reload (or reopening an installed PWA) clears it by design. It survives `_rSched()`'s re-render and At-Camp-Info sub-tab navigation, which is all it was meant to. |
| **A pasted day reverted / wasn't there next time** | Working as designed: `pasteSchedDay` fills that day's EDITOR only and writes nothing. The admin must press that day's **Save**, which is the single `PUT /schedule/day` write path. If you are tempted to auto-save on paste, don't — the review step is what makes a mis-paste recoverable (leave the screen and come back). |
| **Copy grabbed the wrong rows / missed a row I could see** | `_schedReadRows(d)` takes only rows with **both** a time and an activity — the same rule `saveSchedDay` has always used, and now literally the same function. A half-filled row is invisible to both. |
| **Paste wiped a day without asking** | It should confirm via `confirmSheet` whenever the target day has at least one filled row; it deliberately does NOT ask when the day is empty. Pasting onto the day you copied from is a no-op toast, not a confirm. |
| **"+ Add row" started appending at the bottom right after a paste** | Expected. `pasteSchedDay` replaces the wrapper's `innerHTML`, so the `_schedLastRow` anchor is no longer connected and is cleared — which is the documented never-touched-anything fallback in `addSchedRow`. Focus a row and it resumes inserting after it. |
| **The Save button moved** | Yes — it is now its own full-width row beneath `+ Add row` / `Copy day` / `Paste day`, because four equal buttons on one row don't fit a phone. |

### 2026-07-31 — web push behaviour (titles, urgent-only, self-test, deep links)

| Symptom | Go to |
|---|---|
| **Tapping a notification opens a BLANK app** | The payload named a screen the SPA doesn't have. `_showScreen` strips `.active` off every `<section class="screen">` and then matches nothing — **no exception, nothing in any log**. This shipped: the server sent `screen: 'notices'`, the screen is **`notifs`**. Fixed in `buildPushPayload`, and `_pushNavTo()` now falls back to `home` for an unknown id. Notifications already delivered to a phone keep their OLD payload, so the guard is what rescues those — don't "simplify" it back to a bare `go()`. There is a test that scrapes the screen ids out of `public/index.html`; if it fails you renamed a screen and a push deep link is now dead. |
| **A normal-priority notice didn't buzz anyone's phone** | Working as designed since 2026-07-31 (`isPushable`). **Normal = in-app only, urgent = push.** Incident alerts and check-in warnings always push regardless of priority. Change the notice to Urgent, or change the rule in one place — but read the note on `isPushable` first: it is applied BEFORE `resolvePushAudience` on purpose, and moving it after would put a per-user subscription lookup on all 288 ticks a day. |
| **A skipped normal notice is stuck at `push_sent_at = null` forever** | Correct. Filtered notices are deliberately **not claimed**, so if the rule is ever reverted they deliver rather than having been silently burned. They expire out of `findActive()` normally. |
| **The push shows the notice's title now — was that meant to happen?** | Yes, owner request 2026-07-31. `title` travels, `body` still never does. **The body rule in `push.service.ts` is unchanged and is the important one.** If a camper's name appears on someone's lock screen it came from a human-typed notice title, not from a code path — the compose screen warns about exactly this. |
| **A long notice title is truncated with `…` on the phone** | `pushTitle()`, capped at `PUSH_TITLE_MAX` (80) and collapsed to one line. iOS shows ~40 characters anyway. A whitespace-only title falls back to the generic string rather than producing a blank OS notification. |
| **"Send a test" says "No devices registered for this account yet"** | The account holds zero `push_subscriptions` rows — alerts were never turned on, or were turned on under a different login. Note the fan-out unit is the DEVICE, not the account. |
| **"Send a test" says the registration had expired** | The endpoint returned 404/410 and the row was pruned, which is the normal self-cleaning contract. Turn alerts off and on again on that device. |
| **A test alert arrives but a real one never does** | The test only proves **delivery + the deep link** — it reuses the check-in warning's payload shape but bypasses notice creation, audience resolution and claiming. If tests work and real alerts don't, look at `resolvePushAudience` / `canSeeNotification` / `isPushable`, not at VAPID. |
| **Tapping "Send a test" repeatedly deleted my subscription** | It shouldn't — a failed *test* deliberately does not count towards `PUSH_FAILURE_LIMIT`. A 410 still prunes, because that endpoint is genuinely dead. Real sends still count. |
| **Could `/push/test` be used to spam another leader?** | No. The user id comes from the session and is never read from the body — it can only reach devices the caller already opted in on. Keep it that way: the payload renders as a genuine camp alert on a locked phone, so a body-supplied id would be a spoofing primitive. |

### 2026-07-31 — admin test button for the check-in warning

| Symptom | Go to |
|---|---|
| **Where is it?** | `Admin → Settings → Check-in & timing`, bottom of the card. `POST /admin/test-checkin-warning` → `cron.testCheckinWarnings`, gated `admin:manage`. |
| **The toast says "none currently have students outstanding"** | The alert worked; there was just nothing to be behind on. `churches` is who was messaged, `churchesWithOutstanding` is what a REAL warning would have found — they are reported separately precisely so this case can't be mistaken for a broken counter. Check a student in/out and press it again. |
| **It says phone alerts are not configured** | `isPushConfigured()` is false — a VAPID env var is missing or malformed. The in-app notices were still created. See the 2026-07-31 secret-incident section. |
| **A church says they got the alert but the number looked wrong** | The count comes from `churchesBehindFor`, the SAME function the real warning uses — present + non-leader, per gender-scoped login, last check-in entry wins. If the number is wrong, it is wrong for the real alert too. Don't "fix" it in one place. |
| **Test notices are cluttering the Notices feed** | They expire like real ones — at the session's window end, or `CHECKIN_TEST_TTL_MINUTES` from now, whichever is later. Out of season the floor is what stops them being invisible on write. |
| **Pressing it twice created two sets** | Intended. The dedupe key carries the run's timestamp so the button is repeatable. That is also what stops it colliding with — or consuming — the real `checkin-warn:<session>:<user>` key, which would suppress the genuine warning for that session. |
| **Nothing arrived on the admin's phone** | The admin's copy is a separate notice with `targetUserId = actor.id` — real warnings are church-scoped, so without it an admin sees nothing. If the church logins got theirs and the admin didn't, the admin has no push subscription; use "Send a test" on Notices to check that device first. |
| **Can I use it during camp?** | Yes, and it uses the genuinely open session when there is one. But it messages every church login, so it is a confirm-first action; the SPA asks before sending. |

### 2026-07-31 — alerts offered when initials are set

| Symptom | Go to |
|---|---|
| **I set initials and got no alerts offer** | Check the gates in `_maybeOfferPushAfterInitials()` in order: preview mode, missing `serviceWorker`/`PushManager`/`Notification`, `Notification.permission` already `granted` **or** `denied` (neither is re-promptable), iOS-but-not-installed, the once-per-device flag `localStorage.ycp_push_asked`, and finally an absent/invalid server VAPID key. Any one of them silently returns — by design, none of them should surface a toast. |
| **My admin/director account never gets offered** | Correct and unavoidable: initials are **church accounts only** (`_isChurchAccount`). Every other role sets none, so this hook never fires for them. They turn alerts on from the Notices card. |
| **It offered once, I cancelled, now it never asks** | Intended. The flag is written *before* the sheet opens so a cancel is respected rather than nagged. Clear `ycp_push_asked` in devtools to re-test, or use the Notices card. |
| **Can it call `Notification.requestPermission()` directly instead of the sheet?** | No. It runs from a `setTimeout`, so user activation is gone and WebKit refuses the call — that is the original "Could not turn on alerts" bug. The sheet's own button is what restores activation. Keep the `_pushOn`/`_pushConsentGo` split. |
| **Why not prompt on install instead?** | There is no install-time hook in any PWA — nothing fires on Add to Home Screen, and a gesture-less `requestPermission()` is refused by both iOS Safari and Chrome. Initials are the earliest real user gesture that means "this device is mine". |

### 2026-07-31 — the alerts offer on non-church logins

| Symptom | Go to |
|---|---|
| **A church login got the alerts offer instead of the initials gate** | It shouldn't — `_offerAlertsAfterLogin()` returns early for `_isChurchAccount()`. If a church account ever sees a consent sheet where the initials gate belongs, that guard has been removed, and the account will end up with no initials (which blocks every attributed write). |
| **A director/admin never gets offered after logging in** | Check the three call sites are all still there: `doLogin`, `submitChangePassword`, `_tryRestoreSession`. The middle one is easy to miss — a `mustChangePassword` account never reaches `doLogin`'s tail. Then check the gates in `_maybeOfferAlerts` (permission already `granted`/`denied`, iOS not installed, `ycp_push_asked` already set, VAPID key absent/invalid). |
| **The offer appears every time I sign in** | It shouldn't. `ycp_push_asked` is written before the sheet opens. If it repeats, either localStorage is being cleared between sessions (private browsing, "clear site data") or the flag write is throwing — it's wrapped in a try/catch that deliberately swallows, so a storage-disabled browser will re-offer. |
| **Where did all the notices go?** | Production `notifications` was cleared to 0 on 2026-07-31 at the owner's request (32 rows: 30 from the check-in test run, 2 incident alerts). **`incidents` was not touched** — the notices were only the alerts. `push_subscriptions` untouched, so no device needed to re-subscribe. |
