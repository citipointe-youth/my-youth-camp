> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: spa platform lessons

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## 16-item owner batch — push latency, parent masking, Android review — 2026-08-03

Owner list of 20 items; one was withdrawn during clarification (a check-in-screen button,
superseded by the check-in-status export below) and three were verification requests answered
in prose rather than code. `npm run typecheck` clean, `npx vitest run` **894 pass / 57 files**
(was 885/56; **+17**), `node --check` OK on the SPA body (range **956–8564**, re-derived) and
`sw.js`. `sw.js` `camp-v82`→**`camp-v83`**. **No schema or migration change** — next migration
is still `0021`.

### 1 — 🟠 URGENT NOTICES WAITED ON A 5-MINUTE POLL, AND THE JITTER TAXED THE SMALL CASE
Owner: *"urgent notices take a while to arrive… review low-risk ways to reduce the delay, then
do a similar review of the incidents notifications (max 10-15 devices)."*

Two independent delays, and the guess in the question was the smaller one:

| Source | Cost | Fix |
|---|---|---|
| Nothing pushed a notice until the next `pg_cron` tick | 0–5 min, **mean 2.5 min** | `push.sendNow()` at creation |
| `PUSH_JITTER_MS` spread every send over 4s regardless of audience size | mean **2s** | `PUSH_JITTER_MIN_SENDS` |

**`sendNow(n)`** on the push service, called from `notification.service.send` (urgent only) and
`incident.service.log` (high severity only). The container now builds `push` BEFORE those two so
it can be injected; both params are **optional**, so every existing test constructs them
unchanged and an absent push service is exactly the old behaviour.

- ⚠️ **IT GOES THROUGH `claimForPush`, AND THAT IS THE ONLY THING MAKING IT SAFE.** The claim is
  atomic and **permanent**. If `sendNow` claims, the tick's `pushSentAt == null` filter skips it;
  if it loses a race, `claimedIds` will not contain the id and it sends nothing. **Do not
  "optimise" this into a direct `sendOne` loop that skips the claim** — a duplicate push is not
  self-correcting.
- ⚠️ **A SCHEDULED NOTICE IS GATED OUT EXPLICITLY**, not left to the audience resolver.
  `canSeeNotification` would resolve an empty audience for a future `scheduledFor` — but relying
  on that means CLAIMING it now and **burning its one permanent claim**, so it could never push
  when it actually published. `publishesNow` is checked in `send()`.
- **It never throws and never reports failure upward.** The notice row is already committed and
  is the guaranteed channel; the tick stays the safety net. Worst case = the old behaviour.
- **Awaited, not fire-and-forget** — on serverless the function can be frozen the moment the
  response is written, so a detached send is not reliably delivered. Cost is bounded: an
  incident's ~10-15 devices now land in well under a second.

**`PUSH_JITTER_MIN_SENDS = 20`** — below that many total (notice × device) sends, the jitter is
skipped entirely. Its stated purpose is stopping 100+ devices opening the app in the same
second; an incident alert is 10-15 devices, so every one of them was paying a mean 2s for a
crowd that does not exist. A camp-wide urgent notice (~224 sends) is far above the threshold and
keeps the full window. **Both sides are tested** — a change that silently dropped the jitter
altogether looks identical on the small-batch test alone.

> **The cron cadence was deliberately NOT changed.** `*/1` instead of `*/5` was considered and
> rejected: with immediate send in place the tick's two real jobs do not benefit — the check-in
> warning already fires on a **60-minute** lead window, where 5-minute granularity is irrelevant
> — so it would buy only scheduled-notice push precision, at 5× the invocations and 5× the rows
> in `net._http_response`.

### 2 — The high-severity push no longer says "Incident logged"
`buildPushPayload`'s `leadersOnly` branch now returns a **fixed** `title: 'High priority
incident'` / `body: 'Open app to view'` instead of the notice's stored title. On a lock screen
"Incident logged" reads as a filing confirmation — something already handled — which is the
opposite of what it means. **`leadersOnly` is set by exactly one code path** (`incident.service
.log` on high severity), so that branch is always an incident alert.
The **zone is dropped from the push on purpose**; the in-app notice and Notices list keep the
full `Incident logged · <Zone> Zone` title. Tests pin both the wording and that the zone does
not leak into the payload.

### 3 — 🟠 A CHURCH LOGIN'S PARENT NUMBERS ARE NOW MASKED AND AUDITED
Owner: *"church login, students screen, mask parents number until revealed by clicking (then
have it be clickable to call similar to the first aid account). Also check it gets logged."*

`maskParentForFirstAid` → **`maskParentPhone`**, driven by
**`PARENT_PHONE_MASKED_ROLES = {firstAid, church}`** (firstAid alone since 2026-07-17).

- ⚠️ **THE MASK HAS TO BE AT THE DTO BOUNDARY, NOT IN THE SPA.** Hiding it client-side while the
  real number still travels in the `/campers` JSON makes the reveal theatre — it is one devtools
  tap away, and far worse **the audit row is never written**, because nothing forced a call to
  the audited endpoint. Masking server-side is what makes `GET /search/contact/:id/parent` the
  only route to the number.
- **It was already logged, and that was verified rather than assumed.** Church holds
  `camper:read:sensitive`, and `revealContact` records kind **`parent-contact`** to
  `reveal_audit` → the compliance workbook's "Sensitive Reveals" sheet. No new capability and no
  schema change; what changed is that a church now *has* to go through it.
- **director / admin / zoneLeader are deliberately unaffected** — they run the camp, and a
  masked roster adds an audited tap to routine oversight for no safeguarding gain.
- SPA: **`_parentPhoneCell(p,id)`** renders a Reveal button, and `faRevealLeader` (reused
  verbatim) swaps it for a `tel:` link on success — one tap to reveal, one to call, same as
  first aid. ⚠️ **It detects the mask by looking for `*` in the value, NOT by testing the role.**
  A role test here silently offers a Reveal button for a cleartext number (or hides one for a
  masked one) the moment the server's rule changes. It is also why the pre-camp `/registrants`
  path, which is not masked, still renders a plain `tel:` link correctly.
- 9 new tests in `parent-phone-mask.controller.test.ts`, including one asserting the raw number
  appears **nowhere** in the serialized detail DTO.

### 4 — "Randomise & export passwords" now covers every account but the original admin
Was church logins only. Now also director / zone leader / first aid / **secondary admins**, in
the same operation and the same CSV (new `Role` column; `Gender` is blank on a leadership row,
because only church logins are gender-scoped).

- ⚠️ **THE ORIGINAL ADMIN IS EXCLUDED, AND THIS IS LOAD-BEARING.** It is the recovery account —
  the one login that cannot be deleted, deactivated or demoted by anyone including itself. An
  admin pressing this button is often already locked out of something; rotating the password out
  from under their own live session and returning the new one only via a CSV download that could
  fail is how a camp ends up with no way in at all. Secondary admins **are** rotated.
- **Inactive accounts are skipped** — rotating a deactivated login puts a working credential for
  it into a distributed CSV, the opposite of deactivating it.
- `mustChangePassword` is still **not** set (these are the real handed-out passwords).
- The button **moved to its own card at the top** of Accounts & churches. It used to sit in the
  Churches card header, which was right when it only touched church logins and now describes
  itself wrongly as well as being hard to find. Filename `church-passwords` → `camp-passwords`.

### 5 — Check-in status export (PNG), and both export cards collapsed
New **Check-in status (PNG)** card on Records & Export, below Registration lists: pick a camp
day, get an image of how many check-ins each church **missed**, worst first, morning + afternoon
summed. Counts only — no names. `_csGather` / `_csDraw` / `exportCheckinStatusPng`, drawn with
the same canvas conventions as `_rlDraw` so the two images read as a set.

- **"Missed" is the ROSTER's definition, not a second one.** A miss is a person on that session's
  roster who is not checked in. The roster already excludes leaders and anyone not `atCamp`, so a
  student who never arrived is not counted. Re-deriving that population from `/registrants` would
  produce a bigger number than the one the leader was looking at on the check-in screen — the
  fastest way to make an accountability report nobody trusts. `checkedIn` is
  **last-entry-wins**, consistent with the check-in screen and `churchesBehind`.
- ⚠️ **SESSIONS COME FROM `GET /checkin/sessions`, NEVER CONSTRUCTED AS `day~am` + `day~pm`.**
  Under AC-1 the first camp day is **PM-only** and the last is **AM-only**, so building both ids
  by hand 404s on exactly the two days most likely to be checked.
- Rows are **one per church with the `b-`/`g-` logins summed** (owner's choice) — that is who
  gets chased. Ties break on name so the image is stable between runs.
- Both this and **Registration lists** are now default-collapsed `<details class="setg">`
  (owner request). ⚠️ **Do not add `open`** — same standing rule as the three Data Import cards.
  The `<select>`s stay in the DOM while collapsed, so `sel('rlChurch')` and
  `_loadRegListChurches()` work regardless of open state.

### 6 — 🟠 THE KEYBOARD SCROLL BUG IS NOT THE ONE `_fixViewportGap` FIXES
Owner: *"often when a keyboard is opened the screen will slightly scroll up and not return when
the keyboard is minimised."* This is why the 2026-07-29 fix did not address it:

> `_fixViewportGap` re-scrolls to `window.scrollY` — it repairs the **layout** against a stale
> viewport height. The reported bug is about the **position**. Focusing an input makes the
> browser scroll it into view (real and wanted); dismissing the keyboard grows the viewport back
> but nothing returns the document, because as far as the browser is concerned that scroll was
> legitimate and is now simply where you are. **Both functions are needed.**

New `_kbScroll` / `_kbArmedAt` / `_kbVH` / `_KB_SETTLE` / `_kbRestore`: capture the offset on
`focusin`, restore it once the keyboard has gone.

- ⚠️ **It must not fight a deliberate scroll.** If the user scrolls while typing, that position
  is theirs. The capture is **disarmed by any scroll outside `_KB_SETTLE` (350ms)** — the
  browser's scroll-into-view lands within a couple of frames of focus; a human scroll does not.
- ⚠️ **Restores only on a genuine shrink-then-grow of `visualViewport`.** A `<select>` opens a
  picker on Android without resizing the visual viewport, and a focusout with no keyboard
  involved must be a no-op, or merely tapping a dropdown would jump the page. `INPUT|TEXTAREA`
  only (never `SELECT`), phone only (`_isWide()` returns early), and clamped to `scrollHeight`
  so it cannot scroll past the end of a page that shrank while the keyboard was up.

### 7 — Android compatibility review (owner request) + four low-risk fixes
Reviewed against the SPA, `sw.js`, `manifest.json` and `push.service.ts`. **The two things most
likely to be wrong were verified correct:** the `_vpKick` viewport hack is gated
`_vpIsStandalone() && _vpIsIOS()` and is provably inert on Android, and every modern API in use
(`CompressionStream`, `PushManager`, `visualViewport`, `beforeinstallprompt`, credentials) is
feature-detected. The maskable 192/512 icons are correct. Fixed:

- **🔴 `exportBudget()` never appended its anchor to the document** before clicking it — the one
  export in the file that skipped it. A detached-anchor click is unreliable on mobile Chromium,
  so this button could silently do nothing on an Android phone.
- **Six exports revoked their object URL in the same tick as `.click()`.** The repo's own lesson
  (`_rlSaveBlob`, 2026-07-31: *"revoking immediately can cancel the download on some mobile
  browsers"*) had only ever been applied to the PNG export. All seven download sites now route
  through **`_rlSaveBlob` / `_saveTextFile`** — append, click, remove, revoke after 20s. ⚠️
  **Route every new download through these. Do not hand-roll the anchor dance again.**
- **The push `badge` was the full-colour app icon.** Android masks `badge` to a silhouette using
  the **alpha channel alone**, and `icon-192.png` is an opaque gradient tile — every pixel
  opaque, so it rendered as a featureless blob in the status bar. iOS ignores `badge` entirely,
  which is why iOS-only testing never showed it. New **`public/icons/badge-mono.png`**: the
  tent+cross glyph on transparency, 96×96 grey+alpha, generated by hand (there is no image
  library in this repo) and **verified by decoding it back and rendering it as ASCII**, not
  assumed. Keep it transparent — a filled background reintroduces the blob. `icon` correctly
  stays the full-colour tile.
- **`renotify: true` added.** Replacing a notification that shares a `tag` is **silent** on
  Android by default, so a second high-severity incident would quietly overwrite the first in the
  tray with no alert at all. Collapsing is still wanted; being silent about it is not.
- **`::-webkit-calendar-picker-indicator{display:none}` is now Safari-scoped.** On iOS the whole
  time field opens the picker so hiding the indicator is free; on Android Chrome that indicator
  **is** the element that opens it, so the schedule editor's time fields could have been typable
  with the picker unreachable.

**Reviewed and deliberately NOT changed:** `requireInteraction` on push (a judgement call about
how insistent an alert should be — worth a decision, not a silent default), and the body-scroll
shell, which uses no Android-incompatible syntax but has never been device-verified there.

### 8 — The rest
- **Leader contacts is PRE-CAMP ONLY on the church home** (`_contactsCardHtml` returns `''` at
  camp). Editing four emergency numbers is not something to invite while an incident is in
  progress. ⚠️ `RENDER.mycontacts` itself is **not** hard-gated — admin/director reach the same
  screen, and a hard mode gate has stranded real records on this codebase before (the 2026-07-17
  incidents revert). This hides a nav entry point, nothing else.
- **Testimonies & Notes: the record TYPE badge moved to the top-right**, beside the year level.
  It was the last item on a run-on grey footer line, so the one fact deciding whether a tile is
  worth reading moved horizontally depending on the church name's length. The name now
  ellipsises rather than shoving the badge off the row.
- **The Records filter is a dropdown-style multi-select** (`.msel`), replacing the chips, plus a
  new **Day** dropdown — four controls that tile as an even 2×2 on a phone. ⚠️ **Not a native
  `<select multiple>`** (needs ctrl/cmd-click on desktop, renders as a cramped scrolling box on
  iOS). Semantics are unchanged, including the important one: **an EMPTY set means ALL**, and the
  button reads "All records" rather than "0 selected", which says the opposite. Day matches on
  `localDateISO(n.createdAt)` — **Brisbane, not the UTC slice**, which would file everything
  logged before 10am local under the previous day. "Before camp" is a real option: incidents and
  notes genuinely get logged ahead of camp and would otherwise vanish the moment a day was picked.
- **The Schedule screen opens on TODAY** when today is a camp day, else day 1
  (`_schedDefaultDay`). It always opened on day 1, so from day 2 of camp every visit started on
  the wrong day — and day 1 is the one day nobody needs to look up.
- **The medical-consent tick carries the real consent clause** in a tooltip, on both the granted
  and not-granted states — the same text is what has *not* been agreed to when it is missing.
- **The alerts consent sheet is about a third of its old length.** ⚠️ Do not cut the lock-screen
  line or the "no names" line to shorten it further — those two are the substance of the consent.

### Two verification requests — answered, no code change
- **Renaming the Citipointe logins to `CP-<location>`: SAFE.** Church **name** and Elvanto import
  matching are keyed on `Church.name` (`import.service.ts` matches `Attendee's Church` against a
  lowercased name map); `username` is referenced nowhere in any of the three importers. The
  schema allows hyphens and capitals, and `_churchUserBase`'s `^[bg]-` strip round-trips
  `CP-Carindale` intact. **Three caveats, all operational:** (a) `account.service.updateUser`
  **lowercases every username on save**, so it will store and display `cp-carindale` — the login
  works, the capitals do not stick without a code change; (b) `ycp_initials_<username>` and
  `ycp_ciq_<username>` are keyed on the username, so **a rename orphans saved initials and any
  unsynced offline check-ins — let the queue drain before renaming**, and expect leaders to
  re-enter initials and re-save the credential in their password manager; (c) if one of a renamed
  pair is ever deleted, "Split church accounts" / "Randomise passwords" regenerates the sibling
  from `slugifyUsername(church.name)`, producing a mismatched pair.
- **Excel/CSV export: yes, for every dataset that matters.** The compliance workbook (`.xlsx`, 9
  sheets), sign-in/out CSV, registrants CSV, offline sign-in sheet (`.xlsx`), notes CSV, budget
  CSV, first-aid CSV and the passwords CSV all open in Excel. Gaps, all minor: **incidents**,
  **check-in history** and **reveal audit** have no standalone export and are reachable only
  inside the workbook (director/admin); **accommodation allocations have no export at all**.
  Registration lists are PNG/ZIP by design — the same roster is available as CSV elsewhere.


## ✅ The viewport kick no longer jitters — the fix was self-triggering — 2026-08-01

Owner: *"when the horizontal bar pull down triggers, half the time it will jitter up/down rapidly
(10 times within 1 second) then it will be correctly pulled down."* SPA-only. `sw.js` → `camp-v76`.

### Root cause: `_vpKick` re-entered the resize it caused
A kick changes layout, so iOS fires `visualViewport.resize` — and that listener scheduled **another**
kick 120ms later. The cooldown was measured from the kick's START, so an echo landing after it had
lapsed passed the guard and kicked again, firing another resize. On top of that the launch volley
`[120,400,900,1600]` was four **uncoalesced** timers stacking onto the echoes. Every kick makes iOS
animate its chrome, and that animation is the visible jitter. It settled only once the shortfall hit
0 and every path began early-returning — hence "jitter, then correct", and hence intermittent.

> The old comment claimed *"each attempt early-returns the instant the shortfall is 0, so at most one
> of these does any work."* That is only true once a kick has **already succeeded**, and iOS does not
> resize instantly. Treat that sentence as the lesson: the guard you reason about statically is not
> the guard that runs during a 600ms animation.

### Three rules now, all load-bearing
1. **Coalescing** — every trigger goes through `_vpKickSoon`, which REPLACES the pending timer, so a
   burst collapses to one kick.
2. **Echo suppression** — a resize within `_VP_KICK_SETTLE` (500ms) of our own kick is OUR echo and
   is ignored. This is the loop-breaker. **Do not call `_vpKickReset()` from the resize listener** —
   resize is the echo path, and resetting there restores the unbounded oscillation.
3. **Verify-then-retry** — the fixed volley is GONE. `restore()` schedules one re-measure; only a
   surviving shortfall kicks again, capped at `_VP_KICK_MAX` (5) roughly 1s apart.

⚠️ **`_VP_KICK_VERIFY` MUST stay greater than `_VP_KICK_COOLDOWN`**, or the retry lands inside its own
cooldown, early-returns, and the chain dies silently after one attempt.

⚠️ **A COOLDOWN BLOCK MUST RESCHEDULE, NOT DROP.** Because `_vpKickSoon` coalesces by *replacing* the
pending timer, a late resize echo can cancel the verify-retry queued by `restore()`; if that
replacement then lands inside the cooldown and simply returned, the chain would die and a device that
ignored the first kick would never be kicked again — the fix silently stopping after one attempt.
**This bug was in the first version of this fix and was caught only by the harness below.**

### Verified in isolation — `scripts/vpkick-harness.js` + `scripts/vpkick-compare.js`
The real functions are extracted from `public/index.html` and run against stubbed globals and a fake
clock (`node scripts/vpkick-harness.js <extracted.js>`; the extraction ranges are in the script
header). Five scenarios pass: cooperative launch = **exactly 1 kick**; iOS ignoring = capped at 5,
spaced ≥900ms; 5 rapid triggers = **1 kick**; fast echo = bounded; focused input = **no kick**.
The comparison run against the previous commit's code, on a device modelled as never accepting:

| | kicks in 12s | spacing | stops? |
|---|---|---|---|
| Old (as shipped 2026-07-31) | **20**, unbounded | ~608ms | never |
| New | **5** | ~944ms | yes, capped |

Two harness failures on the way were STUB bugs, not code bugs, and are worth knowing before reusing
it: **`_vpIsIOS` reads a BARE `navigator`**, not `window.navigator`, so a sandbox without it throws
and every kick silently early-returns; and **`_vpKickAt` initialises to `0`**, so a fake clock
starting at `0` blocks the very first cooldown check — start the clock at a real epoch value.
Modelling the iOS chrome animation as a **stream** of resize events rather than a single echo is what
exposed the retry-chain bug; a single-echo model shows nothing.

### The readout gained `kick tries`
`_vpTries + ' / ' + _VP_KICK_MAX`, beside `kicks fired` (five taps on the header title). `kicks fired`
alone cannot tell a smooth single kick from an oscillation. On a good launch this reads **1 / 5**;
climbing toward 5 means iOS is genuinely ignoring the kick, while a high `kicks fired` with `tries`
back at 0 means repeated NEW triggers, not a runaway chain.

**Still device-only.** The failure mode stays deliberately benign: if iOS ignores us the shortfall
simply remains and the result is the old tall bar, never a clipped nav.

## 14-item owner batch — reveal audit, admin accounts, church contacts — 2026-07-31

Owner bug/improvement list (14 numbered items). Backend + SPA + **migration `0020`**
(`reveal_audit`, **applied to prod and history-reconciled to `'0020'` BEFORE the code push**).
`npm run typecheck` clean, `npx vitest run` = **832 pass / 54 files** (was 794/49; **38 new**).
SPA + `sw.js` `node --check` OK. `sw.js` `camp-v73`→**`camp-v74`**.

### 5 — Sensitive reveals are now a real, exportable audit (migration `0020`)
Before this, the ONLY trail for a Medicare or contact reveal was a `logger.info('[audit] …')`
line in the Vercel runtime logs — which the owner cannot read, cannot export, and which rolls
off. New `reveal_audit` table + entity + repo trio + `reveal-audit.service.ts`, surfacing as the
**"Sensitive Reveals"** sheet in the compliance workbook (When / What / Student / Church /
Account / Role / Leader initials).

- ⚠️ **THE REVEALED VALUE IS NEVER STORED.** No number, no fragment. `people.medicare_number`
  and `parent_phone` are encrypted at rest precisely so a database reader cannot see them; an
  audit table holding a plaintext copy of everything anyone looked at hands back exactly what
  that encryption removes. There is a test asserting the row's key set, so adding such a field
  fails the suite.
- **`record()` NEVER THROWS.** A first-aider standing over an injured child needs the number
  more than the camp needs a perfect log. On failure it logs and returns null; the log line is
  the fallback trail, i.e. exactly what existed before the table.
- **Covers medicare AND contact reveals** (owner's choice), as three `kind`s —
  `medicare` / `parent-contact` / `leader-contact`, constrained by a CHECK so a typo can't
  create a silent fourth category.
- **It resolves the ACCOUNT USERNAME, not `actor.displayName`** — a church displayName is the
  church name and is IDENTICAL for the `b-` and `g-` logins, so recording it alone could not
  answer "which login revealed this". One indexed `userRepo.findById` per reveal; a reveal is a
  deliberate human tap, not a per-request cost.
- `person_name`/`church_name` are denormalised and there is deliberately **no FK to `people`** —
  the audit must stay readable after a rollover deletes the person, and a cascade would erase
  the record of the reveal along with its subject.
- Purged by **`reset()`, `resetLogs()` AND `newYear()`** (the standing "a new repository must be
  added to all of them in the same commit" rule).
- The two first-aid page notes were reworded to describe what is actually recorded.

### 2 — Secondary admin accounts; the ORIGINAL admin is protected
`createUser`/`updateUser` no longer refuse `role: 'admin'`. A secondary admin is a **full peer**
— it can do everything including creating further admins.

> **`findOriginalAdmin(users)` = the EARLIEST-CREATED admin** (id as a deterministic tiebreak).
> Deliberately NOT hard-coded to the seed id `user_seed_admin`: a new-year rollover or a fresh
> deployment can produce a working camp whose first admin has a different id, and a constant
> would leave those installations with no protected account at all.

The original cannot be **deleted, deactivated or demoted** — by anyone, **including itself**. It
is the recovery account. `reset()` keeps ALL admins (not just the original): reset requires an
admin actor, so deleting secondary admins would let one destroy its own account mid-wipe.
SPA: `admin` is in the role picker (with a warning box), admins appear on the Accounts screen
with an "Original" pill, and the original renders **without** a delete button — offering a
button that can only 403 is worse than not offering it. Admin accounts stay non-previewable.

### 12 — Notices auto-expire 6 hours after PUBLISH
`NOTICE_TTL_HOURS = 6` + `defaultNoticeExpiry(publishAt, explicit?)`. Measured from
`scheduledFor ?? createdAt`, **not composition** — a notice written Monday to publish Thursday
must live six hours after it appears, not expire two days before anyone can see it.
`findActive()` already filters on `expiresAt`, so this alone drops it off Home and Notices
together. **Rescheduling moves the expiry with it.** An explicit `expiresAt` still wins — this
changed the DEFAULT, not the capability. System notices (check-in warning, incident alert) set
their own expiry and never come through here.

### 11 — Church logins set their own four leader contacts
New capability **`church:contacts:write`** (church + director + admin) and a NARROW route
`PATCH /accounts/churches/:id/contacts` with its own `UpdateChurchContactsSchema`.

> ⚠️ **The capability is not the gate.** `updateChurchContacts` also checks
> `actor.churchId === id` for non-oversight roles — without it any church could rewrite every
> other church's emergency numbers. And the schema is separate from `UpdateChurchSchema` on
> purpose: a shared schema is one `.optional()` away from letting a church rename itself or move
> its own zone. There is a test asserting a name/zone/override sent to this endpoint is ignored.

SPA: new `RENDER.mycontacts` screen (**and its `<section class="screen" id="mycontacts">` in the
shell** — a missing one of those is the 2026-07-17 blank-screen bug) reachable from a
**"Leader contacts"** card on BOTH church home variants. Field ids are identical to
`RENDER.adminContacts`' so `saveContacts` is shared verbatim; that function now posts to the new
narrow route for every role. Owner chose all four contacts, not just the login's own gender.

### 7 — Duplicate registrations (the "delta cost to upgrade" case)
- **Form import now processes rows in `Date Submitted` order** before merging. The merge was
  already "latest wins, but a blank cell never clobbers a known value" — which is exactly the
  behaviour wanted — but it only gives the right answer if the latest submission is processed
  LAST, and the Elvanto export does not guarantee chronological order. The sort is **stable**
  and undated rows sort first, so a file with no `Date Submitted` column keeps its original
  order exactly (nothing regresses). ⚠️ **`rowNum` is captured from the ORIGINAL position** —
  reporting a sorted index would point the admin at the wrong line of their spreadsheet.
- A repeat name in one file now raises a **warning** naming the person; silent merging is
  correct but invisible.
- **Invoice accumulation was VERIFIED, not rewritten** — `moneyByPerson` already sums
  `amountPaid`/`discountAmount`/`feesAmount`/`taxAmount` across rows in a run, takes
  `registrationCost` from the latest row, sets `needsReview`, and is idempotent on re-import.
  New tests pin all of it (a $150 ticket + a $40 delta reads as $190 paid, not $40).

### 1 — Per-church discount code counts on Budget
`ChurchBudget.discountCodes` (+ the SPA mirror in `computeBudgetClient`) — rendered inside each
church's expandable row via `_budChurchCodes(c)`. **Derived by scoping
`computeDiscountCodeSummary` to the one church, never counted again**, so the per-church numbers
cannot disagree with the camp-wide card. Read-only there on purpose: the classification dropdown
stays camp-wide, because a tag applies to the CODE across the whole camp — two editable copies
would read as a per-church setting and it isn't.

### The rest
- **4 — the Site map button is gone from the first-aid Search landing.** firstAid has no Home
  screen (`RENDER.home` redirects it here), so that was the role's only map route; every other
  role keeps its Home hero Map button and `RENDER.sitemap` is untouched. ⚠️ The explanatory
  comment sits INSIDE a JS template literal — it must never contain a backtick (it did, once,
  and took the whole script out).
- **6 — revealed numbers are diallable.** The reported case: first aid reveals a parent's number
  and then has to retype ten digits. The reveal control is a `<button>` (it has to be — the
  reveal is an audited action), so on success it is **replaced with an `<a href="tel:">`**
  rather than trying to make one element be both. The students-search `reveal()`, which only
  toasted the number into a message that vanishes, now opens a sheet with a Call button. The
  Data tab's Mobile column runs through `telLink`.
- **8 — the Data Import overrides card is SPLIT.** It was conflating finished work
  (`kind === 'unallocated'` — designated from OTHER) with deliberate manual corrections.
  Designated-from-OTHER is now its own **default-collapsed** section below; both people lists
  scroll internally at `ALLOC_VISIBLE_ROWS = 4` (mirrored by `.alloc-scroll`'s max-height —
  change both together). Undo behaves identically from either section.
- **9 — the admin Settings save button floats** (`.setg-save`, `position:fixed` above the nav,
  z-index 105). ⚠️ Fixed, never absolute — the phone `.app` grows with content and is not
  viewport height. A `.setg-savepad` spacer keeps the last section clear.
- **10 — the "Your day · N still to check in" card is hidden during the sign-in phase**
  (`campPhase()==='signin'`), so day 1 doesn't show a backlog for a session that hasn't opened.
  Do NOT re-derive this from the day number — `SETTINGS.campDay` is the preview-only toggle.
- **13 — the Testimonies & Notes "Record" dropdown is now multi-select chips** (`NOTE_CATS`,
  `NOTE_CAT_OPTIONS`, `_toggleNoteCat`). ⚠️ **An EMPTY set means ALL** — it is a normal state you
  reach by deselecting the last chip, and showing nothing there would look broken. Chips rather
  than `<select multiple>`, which needs ctrl/cmd-click on desktop and is a cramped scrolling box
  on iOS.
- **14 — a collapsed "Leaders" sub-menu on Students → My group** (`_loadMyLeaders`,
  `_sortLeaders`, `leaderRow`), below "Not signed in". Signed-in first, then alphabetical by
  FIRST name. Leaders are excluded from the check-in roster and from the "Not signed in" list,
  so no screen answered "which of my leaders are actually here". ⚠️ **Scope is NOT computed
  client-side** — both feeds are already narrowed by `canAccessPerson`; re-deriving the gender
  rule here is how a `b-` login ends up seeing the girls' leaders. Filtered by zone/gender but
  NOT by grade (a leader has no grade; any year level would empty the list).

### 3 — Churches (data operation, not code)
The owner's master list holds 28 real churches; prod had 15. The 15 missing were created (zone
Yellow, with `b-`/`g-` logins) and **`Citipointe North` was merged into
`Citipointe North (Caboolture)`**. ⚠️ Names must match the Elvanto export string EXACTLY or the
Form import auto-creates a duplicate on the next run. `Connect Church Caboolture` is in prod but
not on the master list and was left alone — it has a real person attached.


> **Scope:** the real **camp** app — TS/Express backend (`src/`) + `public/` SPA. The offline demos live in `../youth app demo/CLAUDE.md` (that folder is the Vercel deploy source for the **demo** at `yc-camp-demo`). **This repo auto-deploys the real app to https://my-youth-camp.vercel.app on push to `master`.** Project map: `../CLAUDE.md`. Sibling app: `../youth-allocation-platform/CLAUDE.md`. Change workflow: `../CHANGE-PROMPTS.md`.

Guidance for Claude Code when working in this package. Read this before editing.

> **📋 Check `docs/PLANNED-IMPROVEMENTS.md` every time you read this file.** It holds an
> approved-but-unbuilt design (discount codes → "paid in full" budget classification) and a
> list of topics the owner wants questioned/scoped in a future session (editor initials, sign-in
> UX, time-lock behavior outside camp dates, etc). Keep flagging it here until it's cleared out.

## ✅ THE BOTTOM-NAV / TALL-WHITE-BAR BUG IS ACTUALLY FIXED — 2026-07-31

**Seventh attempt, and the first one verified on a device instead of assumed.** Follow-ups 3-7
(2026-07-24), the 2026-07-26 `html{background:#fff}` change and the 2026-07-28 `.tabs::after`
change were all blind guesses at this. SPA-only (`public/index.html`); no backend, schema or
migration change. `sw.js` `camp-v68`→**`camp-v73`** across the whole investigation.

> **If a bar/gap/floating-nav symptom EVER comes back: turn on the viewport readout FIRST (five
> taps on the header title) and read `SHORTFALL`. Do not start editing CSS.** That is the entire
> lesson of this session.

### The actual root cause
iOS gives the installed PWA a **layout viewport ~58-62px SHORTER than the screen** — at launch,
and again after a keyboard is dismissed. Measured on the owner's iPhone 16 Pro (402x874pt):

| | broken | after one drag |
|---|---|---|
| `innerHeight` / `scrollHeight` / `vv.height` | 816 (and 812 on another screen) | **874** |
| `nav.bottom` | 816 | 874 |
| `screen.height` | 874 | 874 |
| white at the bottom of the screen | **96pt** | 34pt |

`874 - 812 = 62` = exactly `safe-area-inset-top`; `62 + 34` = exactly the 96pt of white measured.
The nav is at `bottom:0` of the viewport it was given — it is the **viewport** that is short.

### ⚠️ Why six previous attempts all missed it
**Every metric a page can normally read agrees with itself in the broken state.** `innerHeight`,
`clientHeight`, `scrollHeight`, `visualViewport` and `100dvh` ALL report the short height, and
BOTH nav-gap checks (`innerHeight - nav.bottom`, `vv.height + vv.offsetTop - nav.bottom`) read
**0**. Nothing inside the layout viewport can see the problem. **`window.screen.height` is the
only reference that reports the true height** — that is what made this findable at all.

### ⚠️ TWO THINGS THAT DO NOT WORK — both tried on 2026-07-31, do not repeat
1. **Moving the nav down** (`transform:translateY(<shortfall>)`). Built on the inference that
   `safe-area-inset-bottom` reporting 34px while broken proved the WEB VIEW still covered the
   screen and only the layout viewport was short. **That inference is FALSE.** The web view is
   short too: with `innerHeight` 816 the last painted row of a full-screen screenshot was 815pt —
   **the document cannot paint past `innerHeight`.** The nav went to 841-874 and was clipped
   ("half of the nav bar was hidden"), strictly worse than the bar it replaced. Reverted same day.
   The strip below belongs to iOS. No transform, negative margin or ancestor height can reach it.
2. **`.tabs::after`** (the 120px white slab, 2026-07-28 Bug 15). It painted below the nav's bottom
   edge, which is already at `innerHeight` — so it was clipped and **never visible**. Removed;
   removing it changed nothing on screen. This also finally explains Bug 15 properly: that strip is
   **not** filled with the manifest `background_color` (`#0b1220`, near-black), it is filled by iOS
   extending the **document's own backdrop colour** — which is why `html{background:#fff}` fixed its
   *colour* in 2026-07-26 and why it read light-purple when `html`/`body` carried `--paper`.
   **`html`/`body` backgrounds are the only control over that strip's colour.**

### The fix that works — `_vpKick()`
The strip can't be painted, so the view has to actually get bigger, and the one thing observed to do
that is **a real scroll**. `_vpKick()` briefly makes the document 200px taller than the viewport,
scrolls 1px, and puts both back.

**That "briefly taller" step is the whole trick.** On Home the content is shorter than the viewport
(`scrollHeight === innerHeight`), so the document is **not scrollable and there is nowhere to scroll
to** — which is why the pre-existing `_fixViewportGap()` (`scrollTo(0, scrollY)`, 2026-07-29) is a
no-op in exactly the state that needs it, and why the bug never self-corrected. Both remain: this
one re-sizes the view, `_fixViewportGap` restores scroll position after a keyboard.

**Two triggers, both owner-reported and both covered:** app launch (retried over the first 1.6s —
iOS is still moving things well after the first frame, hence 62px on one screen and 58px on
another) and keyboard-dismiss (via `visualViewport.resize` + `focusout`). A keyboard does **not**
change `innerHeight` on iOS, only `visualViewport.height`, so the shortfall reads 0 while typing and
the kick correctly stays asleep until the keyboard has gone.

Guards, all load-bearing: gated to iOS standalone with a plausible-range check (in Safari and on
Android that same `screen.height - innerHeight` difference is legitimate browser/system chrome, and
kicking there would scroll the page for no reason); never while an input is focused; a
`_vpKicking` flag + 600ms cooldown, because the kick changes layout and can re-enter through the
resize listener that called it; and the restore runs in a double rAF **and** on the throw path, so
a failure mid-kick cannot strand the document with 200px of dead scroll space. It stops firing by
itself once the shortfall reaches 0. Verified in isolation — 14 cases run against the real
extracted functions with stubbed globals (detection, Safari/Android inertness, both restores,
re-entrancy, cooldown).

### The readout is KEPT — `_vpDbg*` + `.vpdbg`, off by default, five taps on the header title
Built as a throwaway; **do not delete it as leftover debug code.** It is the only reason this was
diagnosed, it caught the failed `translateY` attempt immediately (`kicks fired` + `SHORTFALL`
distinguish "never ran" from "ran and iOS ignored it"), and it caught the deploy miss below.
Costs a cached-boolean check every 500ms when off; `pointer-events:none` so it can never swallow
a tap; every read wrapped, since it renders on every screen for every role.

### ⚠️ DEPLOY GOTCHA THAT COST A WHOLE TEST CYCLE — a push is NOT proof of a deploy
`48459c0` reached `origin/master` and **Vercel never created a deployment for it.** The last
production build stayed at the previous commit and prod served the old `sw.js` twenty minutes
later, so the owner's test screenshots were of a build without the fix in it — which nearly read as
"the fix doesn't work". Same webhook miss recorded on 2026-07-17. Recovered with an **empty commit**
to produce a fresh push event; it built in ~30s.
**When asking the owner to test on a device, verify the deploy landed first** — `curl -s
https://my-youth-camp.vercel.app/sw.js | head -1` and check the `camp-vNN` you just shipped, or grep
the live HTML for a symbol you just added. This supersedes the "no need to poll Vercel" line in the
verify-and-deploy convention **for device-test cycles specifically**; for ordinary pushes it still
holds. (`vercel deploy --prod --yes` is the documented CLI fallback but was blocked by a permission
rule in this session.)

