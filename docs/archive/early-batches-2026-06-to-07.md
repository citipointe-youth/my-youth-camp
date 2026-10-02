# Archive: early batches 2026 06 to 07

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## At-camp bug/feature batch (13 items) — deployed 2026-07-24

Admin-requested batch from an at-camp review. SPA + backend (`search.service.ts`, item-1 removal)
+ **migration `0012`** (drops `sign_out_history.parents_met`, applied to prod AFTER the code push).
`npm run typecheck` clean, `npm run test` = **579 pass**, SPA `node --check` OK. `sw.js`
`camp-v33`→`camp-v34`. Design: `docs/superpowers/specs/2026-07-24-atcamp-bug-batch-design.md`.

- **1 — "Parents met at pickup" removed entirely.** The Yes/No control is gone (a plain text
  reminder stays); `parentsMet` stripped from the `SignOutEvent` entity, Zod schema,
  `attendance.controller`, `supabase.people` mapper, and BOTH audit exports (workbook + CSV);
  `openCamper`'s "Parents met" row removed. **Migration `0012`** drops the column.
- **2 — Non-church accounts auto-use the account name.** New SPA helper **`_actingName()`** (church
  → saved initials, else `ACTOR.displayName`) replaces the typed "Your name" field on **sign-out,
  sign-in, add-note and testimony**. Sign-in is now one tap for every role. **Only the first-aid log
  form still asks for a name.**
- **3 — Admin console top note removed.**
- **4 — Church daily-check-in session switching.** All sessions are browsable; the current one is
  marked `•` and selected by default. A restricted church viewing a NON-current session gets a
  view-only banner + greyed status pills (`sessionLocked` in `_renderDailyCheckin`). This replaced
  the old static "<label> only" pill whose tooltip was unreadable (the reported bug).
- **5 / 9 / 11 — Row restyle + `gbadge()`.** New shared **`gbadge(c)`** helper renders a
  grade/gender badge ("Y11"/"LDR") to the LEFT of the name on BOTH the daily check-in (`rowHtml`)
  and My-group (`myRow`) rows; gender-coloured (`.gbadge.male/.female`, leaders violet). Church
  logins no longer repeat their own church on tiles (rows collapse to one line, fit more per
  screen); buttons slightly smaller.
- **6 / 10 — "All churches" search cross-scope.** `search.service.search()` now lets
  church/zoneLeader find ANY arrived camper across churches AND genders (item 10), but
  **`redactSensitive()`** blanks medical/dietary/medication/medicare/parent/blue-card/consents/DOB/
  contact for any hit OUTSIDE the actor's `canAccessPerson` scope (item 6). director/admin/firstAid
  unchanged. `GET /campers/:id` still gates on `canAccessPerson`, so redacted hits can't be
  drilled into.
- **7 — "Other churches" → "All churches"** label; misleading "find another church's leader"
  heading corrected.
- **8 — My group is the default Students sub-tab** on every open (`STUDENTS_SUB` reset in
  `RENDER.students`).
- **12 — Devotional greys non-current days** and defaults to today (`localDateISO()`); all days
  stay selectable outside the camp dates.
- **13 — Home hero tinted to the login's zone** (gradient from `ZONE_COLORS` into navy) for
  zoneLeader/church, with the role subtitle removed for those two roles; admin/director unchanged.

**Follow-up (same day, SPA-only, `sw.js` `camp-v34`→`camp-v35`):**
- **"Not signed in" moved off the daily check-in screen** to the bottom of the My-students screen
  (`filterMyYouth`) as a `<details>` dropdown with the same one-tap "Sign in to camp" button; built
  by new helper `_loadMyNotSignedIn(previewSim,campers)` (/registrants + not-atCamp campers w/o
  sign-out history, deduped). The check-in load dropped its `/campers` fetch as a result.
- **My-students "Signed out of camp" is now a `<details>` dropdown** too (the old always-open
  "Late arrivals" block is folded into the "Not signed in" dropdown). `filterMyYouth` refactored
  with shared `grouped()`/`dropdown()` helpers.
- **"All churches" search: church name coloured by the student's gender** (blue/pink) in the
  `runSearch` findcard.

**Follow-up 2 (same day, SPA-only, `sw.js` `camp-v35`→`camp-v36`):**
- **Confirm before signing in from the My-students "Not signed in" list** (`signInConfirmList` →
  `_confirmSignInList` → `signInPrompt`). Sign-in from the camper profile and the first-day arrival
  flow stay one-tap.
- **Scroll position preserved on sign-in / check-in-out** across three roster screens: daily
  check-in (new `_rCheckin()` wraps the action re-renders in `_performCheck`/`undoCheck`/`drainQueue`/
  `_retryFailedCheckins` — `selDay`/`setFilter` still reset to top), My-students (`_refreshAfterAttendance`
  now captures/restores the screen scrollTop around the full re-nav), and first-day arrival (`fdDraw`
  captures/restores before its `innerHTML` swap, fixing the jump on every tick/confirm). Root cause:
  `paint()` preserves scroll on a clean same-screen repaint, but paths that repaint an empty/loading
  shell first clamp it.

**Follow-up 3 (same day, CSS-only, `sw.js` `camp-v36`→`camp-v38`):**
- **Black bar under the bottom nav on home-indicator iPhones fixed — copied YS Connection's nav
  layout.** Root cause: the fixed-height `.app` (`height:100dvh`) doesn't quite reach the physical
  screen bottom on a home-indicator phone, and the bottom nav is a flex child clipped at the app's
  edge — so the near-black `body` backdrop (`#0b0a1a`) showed through the home-indicator strip and
  no amount of nav `padding-bottom` could cover it (v37's `max(6px,env(safe-area-inset-bottom))`
  padding was necessary but insufficient on its own). Fix (matching YS's `body{background:var(--paper)}`
  + `.bot-nav`): **`body` background is now light (`var(--paper)`)** so that strip (and the desktop
  letterbox) blends with the near-white nav instead of reading black; the nav keeps the full-inset
  reservation and gained a soft top shadow (`0 -2px 10px`); the `.app` box-shadow was softened for
  the light backdrop. Supersedes the Bug-3 2026-07-17 fractional-inset tweak.
- **Follow-up 4 (`camp-v38`→`camp-v39`): bottom nav pinned to the true viewport bottom.** The nav
  (`.tabs`) was still floating above the home indicator with a light gap below it, because it was a
  flex child of the fixed-height `.app` (`height:100dvh`) which doesn't reach the physical screen
  bottom on iOS. Copied YS Connection's `.bot-nav`: `.tabs` is now `position:fixed;left:0;right:0;
  bottom:0;z-index:100`, so it sticks to the visual-viewport bottom and adapts as the browser
  toolbar shows/hides. `.screen` bottom padding raised to `calc(64px + env(safe-area-inset-bottom))`
  so content clears the fixed bar. (`#tabs{display:none}` at >=980px still hides it for the sidebar.)
- **Follow-up 4 also: At-Camp Info schedule editor time/activity overlap.** `_schedRow`'s native
  `<input type="time">` could overflow its 96px cell into the Activity field on iOS. Time column
  narrowed to 86px, gap 6->8px, `.sched-row input{overflow:hidden}` clips native overflow, and
  `.sched-row .sr-t` gets tighter horizontal padding (less white space around the value).

**Follow-up 5 (`camp-v40`→`camp-v41`, CSS-only): the real iOS bottom-nav bug — `overflow:hidden` shell.**
The `position:fixed` bottom nav floated above the home indicator on iPhones (in Safari AND standalone,
verified by loading the live page in a real browser: the nav is provably `position:fixed;bottom:0` at
the viewport bottom in Chrome, but iOS floats it). Root cause: **iOS mis-positions `position:fixed`
descendants of an `overflow:hidden` ancestor** — the app shell was `body`/`.app { height:100dvh;
overflow:hidden }`, so iOS pinned the nav to the app's short 100dvh edge, not the true viewport bottom.
YS Connection has no such `overflow:hidden` shell (its body scrolls naturally), which is why its fixed
nav sits correctly. Fix: dropped `overflow:hidden` and switched `height:100dvh`→`min-height:100dvh` on
`body` + `.app`. Internal scroll still lives on `.stage`/`.screen` (unchanged), so no JS/scroll-logic
change; the ≥980px grid re-sets its own `height:100dvh` on `#app`. If iOS still floats after this, the
next step is the full YS body-scroll model (screens flow in the document, sticky header) — a larger
change deferred because this minimal one targets the exact documented trigger.

**Follow-up 6 (`camp-v41`→`camp-v42`, CSS+JS): full YS Connection body-scroll conversion — the
fix that finally worked.** Follow-up 5's minimal `overflow:hidden` removal was NOT sufficient on the
user's iOS — the nav still floated (the shell was still a fixed 100dvh flex column whose screens
scrolled internally, so the body never actually scrolled and the fixed nav still anchored to the
app's 100dvh edge, not the dynamic-toolbar viewport bottom). Converted the PHONE shell to YS
Connection's natural body-scroll model:
- `.bar` → `position:sticky;top:0;z-index:30` (was `relative`) — pins to viewport top as the body scrolls.
- `.stage` → plain `flex:1` (dropped `position:relative;overflow:hidden`).
- `.screen` → normal in-flow block: `overflow-x:hidden;padding:… calc(64px+safe-area)` (dropped
  `position:absolute;inset:0;overflow-y:auto;overscroll-behavior;-webkit-overflow-scrolling`). The
  active screen now flows in the document and the **body** scrolls, so `position:fixed` `.tabs`
  anchors to the true visual-viewport bottom on iOS (exactly why YS's nav sits correctly).
- **≥980px grid re-establishes the internal-scroll shell** so the desktop layout is unchanged:
  `html,body{height:100dvh;overflow:hidden}`, `#stage{position:relative;overflow:hidden}`,
  `#stage .screen{position:absolute;inset:0;overflow-y:auto}`, `#bar{position:relative}`.
- **JS scroll refactor** — because a screen's scroll now lives on the *document* on phone but on the
  *screen element* on desktop, added a layout-aware helper: `_isWide()` (`innerWidth>=980`) and
  `_scroller(el)` (returns `el` on desktop, `document.scrollingElement` on phone). Routed every
  save/restore through it: `_spinner`, `paint` (samePaint keepY), `_rCheckin`, `fdDraw`,
  `openCamper`, `_refreshAfterAttendance`. `_navTo` now resets the document scroll to top on phone
  navigations (all screens share one document scroll, so a genuine nav must reset; in-place
  refreshes bypass `_navTo` and are preserved by `paint()`). The `#stage`-based `_r*` reloaders were
  already scroll no-ops (stage never scrolled) and stay so — `paint()` handles real preservation.
  The import-guide modal's own `igBody.scrollTop` (its own scroll container) is untouched.

**Follow-up 7 (`camp-v42`→`camp-v43`, CSS-only): overlays anchored to `.app` re-pinned to the
viewport after the body-scroll conversion.** Follow-up 6 made `.app` grow with content on phone, so
every `position:absolute` overlay that was a direct child of `.app` (and relied on `.app` == the
viewport) started anchoring to the bottom/height of the tall page instead of the screen. Reported
symptom: the incident-log confirmation **toast showed at the very bottom** (off-screen when scrolled).
Fixes — all switched `position:absolute`→`position:fixed` so they track the viewport in both layouts:
- **`.toast`** → `position:fixed`, and moved to float near the **top** (`top:calc(env(safe-area-inset-top)
  + 60px)`, slides down into view, `z-index:110`) per the owner's request — was `bottom:88px`.
- **`.modal`** (`#modal` bottom-sheet) → `position:fixed;inset:0` — a sheet opened while scrolled
  down had been landing at the bottom of the page.
- **`.ig-wrap`** (`#impGuide` Elvanto guide overlay) → `position:fixed;inset:0`.
- **`#login,#mcpGate`** (full-screen gates) → `position:fixed;inset:0` (+ `overflow-y:auto` so a
  tall form scrolls internally now that it can't use body-scroll).
`#nprog` (the top loading bar) is a child of the sticky `.bar`, not `.app`, so it was unaffected.
GOTCHA for future overlays: any full-viewport overlay/toast MUST be `position:fixed`, never
`position:absolute` — the phone `.app` is not viewport-height, it grows with the scrolling content.

## "Other" removed from the student gender picker — deployed 2026-07-31

Owner request, SPA-only, no backend/schema change. `sw.js` `camp-v60`→**`camp-v61`**.
`npm run typecheck` clean, `npm run test` = 759 pass (unchanged — browser-only code).

`_stuFormFields`' `#seGen` (Individual Student Data Edit → add & edit) now offers **Male /
Female only**.

> ⚠️ **It was NOT simply deleted, and must not be "tidied" into a plain two-option select.**
> `'other'` records genuinely exist in prod: `import.service.ts` defaults a brand-new person to
> `gender:'other'` when the Form CSV's Gender cell is blank or unparseable (`Person.gender` is
> non-nullable and needs *some* value), and **this screen is exactly where an admin fixes them**.
> With the option gone, such a student's `<select>` would fall back to its FIRST option — Male —
> so saving any unrelated field would silently re-record them as male. Gender drives
> `genderScope` visibility for `b-`/`g-` church logins and the accommodation pools, so that is a
> real data change, not a cosmetic one.

Instead: anything that isn't `male`/`female` renders a **blank "— Select —" placeholder**, and
`stuSave`/`stuCreate` both refuse with *"Choose Male or Female"* until a real choice is made.
Add (`s` null) gets the placeholder too, so a new student can't be created as male by
inattention either — that was pre-existing behaviour and is now closed.

**`GENDERS` in `src/core/types/enums.ts` still contains `'other'` and the backend still accepts
it.** Deliberate: the import default depends on it, and narrowing the enum would make every
existing `'other'` row fail validation on read. This change is about what an admin can *choose*.
The other three gender `<select>`s in the SPA are filters and were already Male/Female only.

## Registration lists: second export button (.zip) — deployed 2026-07-31

Owner request, SPA-only, no backend/schema change. `sw.js` `camp-v59`→**`camp-v60`**.
`npm run typecheck` clean, `npm run test` = 759 pass (unchanged — this is browser-only code).

The card now has **Download images** (the original staggered per-file downloads) and
**Download as .zip**. Both call the shared **`_rlGenerate(say)`**, which does the fetch, the
tiering and the drawing exactly once, so the two buttons can never produce different sets —
`exportRegistrationPngs` and `exportRegistrationZip` only differ in how they deliver the result.
`_rlSaveBlob` is the one anchor-click download helper.

### The zip writer is hand-rolled (`_zipBlob`, `_crc32`, `_deflateRaw`, `_dosDateTime`, `_CRC_T`)
**Nothing in this repo can make a zip** — `exceljs` writes xlsx and is server-side, and the
browser's vendored `xlsx` build doesn't expose one. Adding JSZip for a single button was not
worth a new vendored dependency. Classic 32-bit layout: local header + data per entry, then the
central directory, then the EOCD. **No zip64**, so entries and the archive cap at 4GB — a set of
name-only PNGs is a few hundred KB, so that limit is unreachable here.

- **DEFLATE comes from the platform**, `CompressionStream('deflate-raw')` (Chrome 80+, Safari
  16.4+, Firefox 113+). Where it is absent — **or where deflating makes the entry BIGGER, which
  is the normal case for a PNG, since PNG is already deflated** — that entry falls back to STORE
  (method 0). A store-only zip is still a completely valid zip.
- ⚠ **The CRC and the uncompressed-size field always describe the ORIGINAL bytes**, never the
  deflated ones; only the compressed-size field is the deflated length. Getting that backwards
  produces an archive that looks fine until something tries to extract it.
- The central-directory entry's last field is the offset of that entry's **local** header, not
  its data.
- A real DOS date/time is written. A zero date is accepted by most tools but shows as an invalid
  timestamp in Windows Explorer.

**Verified, not assumed:** the real `_zipBlob` was run in node over two entries — one highly
compressible (exercising DEFLATE) and one of random bytes (exercising the STORE fallback, which
is what a PNG hits) — and the resulting archive was extracted by **Windows' own
`Expand-Archive`** with byte-identical SHA256 hashes on both entries. `_crc32` also matches the
standard `"123456789"` → `0xCBF43926` vector.

If the zip ever fails to build, `exportRegistrationZip` catches it and points the user at the
"Download images" button, which shares all the generation code and cannot be affected.

## Notices tile removed from the Admin console — deployed 2026-07-31

Owner request, SPA-only (`public/index.html`), no backend/schema change. `sw.js`
`camp-v58`→**`camp-v59`**. `npm run typecheck` clean, `npm run test` = 759 pass (unchanged —
nothing tested referenced this tile). SPA + `sw.js` `node --check` OK.

`RENDER.admin`'s Data group no longer renders `_adminTile('bell','Notices',…)`. Nothing else
changed: the five other `gotoTab('notifs')` call sites are notice-card taps and post-send
redirects, and the `notifs` screen, route and nav entries are all intact.

> ✅ **THE GAP THIS OPENED WAS CLOSED THE SAME DAY — see the 2026-07-31 section at the top.**
> Removing the tile left an admin on a PHONE in PRE-CAMP with no route to Notices at all: the
> 4-slot phone bottom nav gives Notices' old slot to Data Import (bug 6), and `navModel`'s
> `extras` — where Notices lives for admin — render **only in the ≥980px sidebar**. The tile is
> now **restored under "Camp setup", gated to pre-camp** (at camp the at-camp home grid already
> carries one, so a console entry would be a duplicate route). **Do not remove it again without
> re-opening that gap, and do not "fix" it by re-cutting the 4-slot bottom nav**, which was
> deliberately arranged.

The stale comment in `navModel` that pointed at this tile ("Notices is also reachable via a
button on Admin Settings (bug 5)") has been corrected in the same commit.

## Four-item owner batch — deployed 2026-07-31

Owner batch: Android install prompt, gender-narrowed hero accommodation, a new registration-list
PNG export, and a testimony-picker tidy. SPA + one DTO field. **No schema or migration change.**
`npm run typecheck` clean, `npm run test` = **759 pass / 49 files** (was 756; 3 new). SPA +
`sw.js` `node --check` OK. `sw.js` `camp-v57`→**`camp-v58`**.
Design: `docs/superpowers/specs/2026-07-31-four-item-owner-batch-design.md`.

### 1 — Android "install as web app" prompt (`_installBanner`)
`beforeinstallprompt` is a **Chromium** event — Safari/iOS never fires it, so **the iPhone path is
untouched by construction** and there is no "not iOS" test anywhere. `/install.html`, linked from
`_loginTips`, remains the iOS story and is unchanged.

New `#installBanner` div on the login screen (between the sign-in card and the help links),
`_installBanner()` called at boot beside `_loginTips()`. It `preventDefault()`s the event
(suppressing Chromium's mini-infobar), stashes it in `_deferredInstall`, and renders our own
Install / Not now strip.

⚠ **`prompt()` is called INSIDE the tap handler (`_installGo`), never from the event listener.**
Chromium refuses a gesture-less `prompt()` in some versions and **the refusal is silent** — the
user would get nothing at all and there'd be no fallback surface. Do not "simplify" this into an
auto-fire. The event is also **single-use**: `_installGo` nulls it and hides the banner regardless
of the user's choice; Chromium re-fires on a later visit if they dismissed the native dialog.

"Not now" and the `appinstalled` event both set `localStorage['ycp_installdismissed']`, which
suppresses the banner permanently on that device. Gated to **Android** UAs (desktop Chromium fires
the same event; the owner asked for phones). Every path is `try/catch`ed — this runs on the login
gate where a throw is maximally visible, and `localStorage` throws outright in some privacy modes.

### 2 — Church hero accommodation narrowed to the login's gender
`renderHomeAtCamp()` mapped **every** room from `/accommodation/church-rooms/:churchId`, which is
church-scoped but **not** gender-scoped — so a `b-`/`g-` account saw both teams' rooms. Now
filtered by `ACTOR.genderScope` (already on the client via `toSafeUser`, and via the restored
session). Two deliberate behaviours: **a `null` genderScope keeps both rooms** (an unsplit account
must not get a blank line), and an empty filter result falls through to the existing
"To be confirmed". Display-only — the endpoint was already access-gated, and narrowing a display
cannot widen access.

### 3 — Registration lists (PNG) — new export
New card on Admin → Records & Export (`RENDER.adminData`), **admin + director**. Church dropdown
(filled after paint by `_loadRegListChurches`, defaulting to *Citipointe Brisbane* **matched on
NAME, not a hard-coded id** — church rows are recreated by the new-year rollover and their ids do
not survive it) + a Split override. Symbols: `_rlSlug`/`_rlSortKey`/`_rlSort`/`_rlName`/`_rlFit`/
`_rlTier`/`_rlSheets`/`_rlDraw`/`exportRegistrationPngs`, and `RL_W`/`RL_PAD`/`RL_ROW`.

Tier from the **student** count only (leaders never move the threshold): `<50` one whole-church
image, `50–100` Guys + Girls, `>100` one per year level. **Plus a Leaders image at every tier**,
one per church (not per grade). Overridable from the Split dropdown. Verified by running the pure
helpers in node: all three splits list every person, with the boundaries exactly at 49/50/100/101.

- **⚠ NAMES ONLY on the image.** No payment status, no accommodation, no medical or contact data.
  These get forwarded to leaders over consumer messaging apps; this codebase encrypts most of that
  at rest and it must not be re-published on a shareable picture. Same reasoning as the push-payload
  rule in item 11 above.
- **Students with no grade recorded get their own "Grade not recorded" sheet.** Silently dropping a
  registered student from a roll-call export is the worst failure this feature can have.
- **`dateSubmitted` was added to `RegistrantDto`** — the only backend change in the batch, no
  schema change (`elvanto_meta` already round-trips). It is the Elvanto **form submission** date;
  `createdAt` only says when the IMPORT created the row, so a bulk import ties a whole batch and
  ordering by it is meaningless. Sort key falls back `dateSubmitted` → `createdAt` → name, and
  every step is needed. Order is oldest registration at top.
- **Drawn client-side on a `<canvas>`.** There is no image library in this repo (server `exceljs`,
  browser vendored `xlsx` — neither makes pictures) and doing this in a Vercel function would add
  a dependency and a memory cost for something the browser does natively. **Do not move it
  server-side.** Canvas does not wrap or clip text, hence `_rlFit`.
- **Downloads are staggered ~300ms.** Mobile Safari and Chrome throttle simultaneous downloads and
  **silently drop the tail** — an unstaggered loop loses most of a 7-image by-grade run. The
  object URL is revoked on a 20s timer for the same reason (immediate revoke cancels the download
  on some mobile browsers).

### 4 — Testimony picker no longer prints the church
`RENDER.testimonies`' `<option>` was `Name · Church`. Removed for **all** roles: a church login's
list is already church-scoped by `_scoped('/campers')` so the label was noise, and admin/director
losing a tiebreak between two identically-named students in different churches was accepted as
rare. `churchName` stays on the built `items` array.

## Schedule editor: copy / paste day — deployed 2026-07-30

Owner request. **SPA-only** (`public/index.html`) — no backend, schema or migration change.
`sw.js` `camp-v53`→`camp-v54`. Most camp days share a near-identical shape, so the admin was
retyping the same 10–15 rows for every day.

Each day's card in the At-Camp Info → Schedule editor now has **Copy day** and **Paste day**
beside "+ Add row" (Save moved to its own full-width row beneath, so the four actions don't
crowd on a phone). New symbols: **`_schedClip`** (module-level clipboard), **`_schedReadRows(d)`**,
**`copySchedDay(d)`**, **`pasteSchedDay(d)`**.

Two deliberate choices, both easy to "helpfully" break:
- **The clipboard holds the LIVE EDITOR rows, not what's saved on the server**, so a day can be
  copied mid-edit before it has ever been saved. `_schedReadRows` is now the single
  filled-rows-only reader, shared with `saveSchedDay` — so what you copy is exactly what that
  day would have saved.
- **Paste fills the target day's EDITOR only.** Nothing is written until the admin presses that
  day's Save, which keeps `PUT /schedule/day` as the one write path and makes a mis-paste
  recoverable by leaving the screen and coming back. **Do not auto-save on paste.**

Paste REPLACES the day and confirms first (`confirmSheet`) whenever the target already has rows;
pasting onto the day you copied from, or with an empty clipboard, just toasts. The clipboard is
module-level, so it survives `_rSched()`'s re-render and sub-tab navigation but not a page
reload — it's a scratch buffer, intentionally not persisted.

## Seven-item owner batch — deployed 2026-07-29

Owner-requested batch. SPA + backend + **migration `0017`** (`settings.discount_code_tags`,
`tent_price`, `classroom_price` — **applied to prod BEFORE the code push**, as
`supabase.settings` writes every column on every save). `npm run typecheck` clean,
`npm run test` = **688 pass** (was 670; 18 new), SPA `node --check` OK. `sw.js`
`camp-v52`→`camp-v53`. Design: `docs/superpowers/specs/2026-07-29-seven-item-batch-design.md`.
Symptom router: `debug.md`, section "2026-07-29 — seven-item owner batch".

### 1 — Schedule rows ~30% shorter, duration inline
The duration moved ONTO the time line (`9:00 · 30m`) instead of sitting on a second line under
it — `.sch-dur` lost `display:block` and the `.sch-item` time column widened `62px`→`92px` to
fit. `_schedHeight` was recut `min(190,max(54,40+mins*0.38))` → `min(133,max(38,28+mins*0.27))`,
a uniform ~30% reduction at every point of the curve (30m 54→38px, 1h 63→44px, cap 190→133px).
`.sch-list` gap 7→5px, `.sch-item` padding `10px 13px`→`7px 11px`. The compression (rather than
a linear scale) is still deliberate — a 30-minute item must stay tappable.

### 2 — Budget: TICKET CLASSIFICATION replaced the Full/Half/Part cost bands
The owner does not think in cost bands, and the tent/classroom split was invisible in the budget
entirely. A category is now a **`TicketClass`**: the accommodation kind crossed with a payment
**tag the admin sets on the DISCOUNT CODE**, plus one bucket for unrecorded accommodation.

| tag | tent | classroom |
|---|---|---|
| *(no code / untagged)* | Tent | Classroom |
| `inperson` | Tent — paid in person | Classroom — paid in person |
| `sponsor` | Tent full sponsor | Classroom full sponsor |
| `discount` | Discounted tent | Discounted classroom |

plus **Accommodation not recorded** (flagged with the warning triangle, never dropped — the
grand-total-equals-sum-of-rows invariant still holds and is still tested). Nine buckets, fixed
display order, **identical for campers and leaders**.

The tag lives on the CODE, not the person, because the codes already ARE the mechanism: a
no-code invoice is a plain full-price ticket and every concession, sponsorship and
pay-at-the-desk arrangement is expressed as a code against that baseline. One tag covers
everyone who used it — no per-person data entry.

- **`src/services/budget.ts`** — new `classifyTicket`/`personValue`/`labelForClass`/`labelForRow`;
  **`labelForAmount` and `applyDiscountOverrides` are DELETED**. `computeBudget`'s second
  argument is now an options object `{tags, prices, filterChurchId}`, not a bare church id.
  `CategoryRow.key` is a `TicketClass`; new `CategoryRow.valueMissingCount`; `amount` now means
  "the uniform per-person value, or null when the row's members paid different amounts" — which
  is NOT the same as `unrecorded` (true only for the `'unknown'` row). `budgetToCsv` writes a
  BLANK UnitPrice cell for a mixed row (a `0` there reads as "free" beside a non-zero LineTotal).
- **⚠ THE GRAND TOTAL NOW READS AS "MONEY RECEIVED", NOT "VALUE OF ALL PLACES".** `personValue`
  prefers `amountPaid` over `registrationCost`, and a `sponsor`-tagged code contributes `$0`.
  This follows directly from the owner's decision that a full sponsor counts as $0: a
  100%-discount invoice records `registrationCost: 180, amountPaid: 0`, so preferring
  `registrationCost` would count every sponsored place as revenue and contradict it. Precedent
  already existed in `_paidOrCostRow`. **To read it the other way, swap the last two lines of
  `personValue` AND its SPA mirror `_personValue` — nothing else changes.**
- **The Budget screen's per-code dollar field is gone.** "Mark paid in full" (shipped
  2026-07-27) is replaced by a classification dropdown — the tag implies the value, so there is
  nothing to type. `PATCH /settings/discount-overrides` → **`PATCH /settings/discount-tags`**;
  `SettingsService.updateDiscountCodeOverrides` → `updateDiscountCodeTags`. Same **`budget:manage`**
  gate (admin + director). Unknown tag values are silently dropped, not rejected — clearing a tag
  is a normal edit, and the dropdown's "plain" option submits an empty string.
- **`settings.tentPrice`/`classroomPrice` are BACK** (they were deliberately dropped by migration
  `0004`) with a **narrower job**: a reference full price, editable in Admin → Camp settings →
  **Ticket prices**. They value an `inperson` ticket and define what "discounted" is measured
  against. **They are NOT the source of any registrant's recorded cost — do not restore the old
  price × headcount behaviour.** Null = not set, which makes an `inperson` tag fall back to the
  person's recorded amount (the Budget screen warns when that is happening).
- **Migration `0017`** seeds `discount_code_tags` with `'inperson'` for every key that was in
  `discount_code_overrides` — that is exactly what that field meant (EFTPOS/cash collected at
  registration). The old column is left in place and still round-trips, unused, so a rollback is
  possible. `docs/PLANNED-IMPROVEMENTS.md`'s 2026-07-20 section is now marked BUILT-THEN-SUPERSEDED
  (it had been stale since the day it shipped).

### 3 — "Clear all notifications" removed from Data Export/Reset
Owner request. The backend route `DELETE /admin/notifications` is **left in place, unused** —
same precedent as the 2026-07-28 removal of the standalone sign-in/out CSV button. `adminClear()`
is deleted from the SPA. Notices are deleted individually on the Notices screen. Don't re-add a
bulk button without asking.

### 4 — Imported first/last names are capitalised
New `titleCaseName()` in `elvanto-mapping.ts`, applied at the name read sites in
`import.service`, `ticket-import.service` and `invoice-import.service`. It fixes **only** names
that are entirely upper-case or entirely lower-case; anything already mixed-case is returned
untouched, so `McDonald`, `O'Brien`, `de Silva` and `van Wyk` survive. Deliberately NOT inside
`field()` (that helper also reads church names, ticket types and emails) and NOT in
`offline-signin.service` (it matches, never stores). **Import path only — no backfill script
against prod**; the authoritative Form import re-reads every registrant on every run, so
existing bad names self-correct on the next import.

### 5 — iOS keyboard-dismiss scroll restore
`_fixViewportGap()`, ported verbatim from YS Connection: a same-position `scrollTo` on the next
frame, wired to `visualViewport.resize` with a delegated `focusout` fallback. On the phone
body-scroll shell, closing the keyboard restores the viewport but not the scroll position and
leaves the sticky header / fixed nav laid out against the stale keyboard-open height. **This is
NOT a replacement for the 2026-07-26/28 `html`+`body` background and `.tabs::after` rules** —
those paint over the exposed strip, this restores the scroll. Both are needed.

### 6 — Two login-screen help links
`public/install.html` (Add to Home Screen) and `public/save-password.html` (save the login to the
phone's password manager by hand, for when it never offers). **Standalone static pages, not
in-app overlays** — the SPA shell isn't up on the login screen, which is why YS does it this way
too. Rendered by `_loginTips()` on iOS/Android user agents only. Both derive the site address
from `location.host` so they are correct on any deployment, and **neither calls `/settings`** (the
camp app has no `ministryConfig.branding.appName`; that block was dropped in the port).

### 7 — Remember-password review
Applied: the last username is saved to `localStorage['ycp_lastuser']` and prefilled at boot
(**never the password**), which also gives the password manager a stable id to match on;
`doLogin` now `await`s ~150ms before hiding the form, because Safari's save-heuristic can miss a
credential whose password field is torn down in the same tick; `#mcpGate` is a real `<form>` with
a hidden `autocomplete="username"` field (that gate is dormant — `MUST_CHANGE_PASSWORD_ENFORCED`
is `false` — so this is pre-emptive). **Deliberately NOT applied** (owner declined): firing
`navigator.credentials.store()` on the change-password path as well as login.

## 28-item bug/improvement batch — deployed 2026-07-28

Owner-requested batch (25 numbered items + 3 folded in mid-session). SPA + backend +
**migration `0016`** (`settings.site_map_image`, **applied to prod BEFORE the code push** —
`supabase.settings` writes every column on every save, so the column must exist first).
`npm run typecheck` clean, `npm run test` = **670 pass** (was 634; 36 new), SPA `node --check` OK.
`sw.js` `camp-v50`→`camp-v51`. Full symptom router for everything below: `debug.md`, section
"2026-07-28 — 28-item bug/improvement batch".

### Schedule
- **1 — "+ Add row" inserts after the last-focused row** (`_schedLastRow`/`_schedFocus`/
  `addSchedRow`), falling back to append when nothing has been touched or the remembered row
  belongs to another day's table.
- **2 — The schedule plan view is now a proportional, colour-coded timeline.** `RENDER.schedule`
  + `SCHED_CATEGORIES`/`schedCategory()`/`_schedMinutes()`/`_schedHeight()` + `.sch-*` CSS.
  Colour comes from a keyword match on the activity TITLE (session → violet, zone battle → rose,
  pre show → teal, meal words → amber, everything else → grey). Each item's height is the time
  until the NEXT item starts; the last item of the day runs to 24:00 (what "Lights Out" wants).
  Heights are deliberately compressed (`40 + mins*0.38`, clamped 54–190px) so a 30-minute item
  stays tappable and an overnight block doesn't push the day off screen. The admin editor is
  visually unchanged but gained a `helpTip` quoting the keyword list via `_schedKeywordHelp()` —
  one source of truth with `SCHED_CATEGORIES`.
- **3 — Moving the camp dates now carries day-keyed content with it.** `remapDays()` +
  `applyDayMoves()` in `settings.service.ts` (wired with the devotional + schedule repos in
  `container.ts`). Devotionals and schedule items are stored against an absolute DATE but authored
  per day NUMBER, so shifting the start date used to strand every one of them on dates the app no
  longer reads — the data was intact but every screen went blank. They are now re-keyed by
  POSITION (old day 1 → new day 1). Rows are deleted then re-saved, because an overlapping shift
  means day 2's old date IS day 1's new date. **Shrinking the camp hides rather than deletes** the
  surplus day, so lengthening again (or fixing a mistyped date) recovers it. Applied to the
  schedule as well as devotionals — identical mechanism, identical silent-loss failure.

### Accommodation & budget
- **5 — Second-level classroom split.** A church×gender pool over `SPLIT_THRESHOLD` (50) still
  splits into `7-9`/`10-12`; a bracket that is ITSELF over 50 now splits again into single year
  levels `Y7`…`Y12` — up to 6 pools per gender, 12 per church, gender always honoured.
  `yearGroupsFor`/`spreadLeaders` (`accommodation-allocation.ts`, tested) + the SPA mirrors
  `_accomYearGroups`/`_spreadLeaders`. Leaders halve across brackets then spread evenly across
  that bracket's year levels (remainder to the earliest year); unknown-grade youth ride with the
  bracket's lowest year. `classroom_allocations.bracket` is unconstrained `text` — no migration.
- **4 — Budget category rows were blank.** `_budScopeRows` built rows with no `label` while
  `drawBudget`'s `catRow` renders `esc(r.label)`, so every line under a church's Campers/Leaders
  heading was empty (a null-cost row showed a bare warning triangle). `_budLabel(amount, full)`
  now fills it; `full` was already being passed in for exactly this purpose and was unused.
- **23 / B — Navigation to allocations and budget.** Admin → Accommodation setup gained a button
  straight to the allocations map. Budget & Costings gained an admin-console tile, a card on Data
  Export/Reset, and a sidebar entry for admin AND director in BOTH modes (it was pre-camp-only, so
  an admin on a laptop mid-camp had no route to it at all).

### Accounts, home, first aid
- **13 — The two gendered church logins are edited as ONE unit.** Previously both `b-`/`g-` tiles
  opened the same modal, which only ever found the FIRST account — so editing the girls' username
  silently rewrote the boys' one and the pair collided into an unusable state. Account Info and
  Bulk Church Update now take a single BASE username and re-apply the `b-`/`g-` prefix per account
  (`_churchUserBase`/`_churchAccts`/`_churchPrefix`); church name, zone and delete already applied
  to both. Passwords stay per account (owner's call). The accounts screen renders one joined
  `.ch-pair` card per church with a light-blue Boys half and a light-pink Girls half, so the UI
  matches how the pair actually behaves.
- **14 — A church login is greeted by its FULL name.** `dashboard.service.greetingName` no longer
  truncates to the first word for `role==='church'` (a personal leadership login still gets its
  first name). `_heroNameCls` drops names over 14 chars to half size and lets them wrap.
- **20 — First aid: "Signed in only" filter, ON by default** on both Search and All Students.
  Inert pre-camp (nobody has signed in yet). `_faSignedInOnly`/`_faSignedInFilter`.
- **21 — First aid: revealing a parent number no longer 404s.** `search.service.revealContact`
  required lifecycle ≥ arrived while `resolveContacts` deliberately did not, so the Student Info
  card would render a masked number for a not-yet-arrived student that could never be revealed.
  `canAccessPerson` is still the real gate.
- **22 — Cross-gender secondary contact.** `contactsForPerson()`: a person leads with their own
  gender's contacts, and if that gender has a primary but no backup, the OPPOSITE gender's primary
  becomes the secondary. A gender that already lists two leaders is untouched.
- **8 — Site map (NEW).** `settings.siteMapImage` (**migration `0016`**) holds a client-baked
  `data:image/...` URI; the server stores an opaque string and the Zod schema rejects anything that
  isn't a data-image URI (no remote URL → no SSRF/tracking-pixel surface).
  **The page CSP must keep `img-src 'self' data:`** — this is the app's only data-URI image, and a
  bare `img-src 'self'` blocks all three `<img>` sites (crop probe, settings preview, Map screen).
  The symptom is a misleading "Could not read that image file" toast on a valid PNG, because the
  block surfaces as the probe `Image`'s `onerror`. Missed in the original port (2026-07-28) and
  fixed 2026-07-29; YS Connection's CSP already allowed it, which is why the cropper worked there.
  A "Map" button sits on the Home hero for every role (firstAid has no home screen, so it gets one
  on its Search landing) and is hidden entirely until a map is uploaded. Upload + crop live in
  Admin → Camp settings → Camp details & dates. **The crop tool is a port of YS Connection's logo
  cropper** (`_openLogoCropModal`/`_cropRectFor`/`_cropClampPan` in `Project 7`) generalised from a
  fixed square to an arbitrary aspect ratio — `vp` became `vpW`/`vpH` throughout and the modal
  offers Portrait/Tall/Square/Landscape, defaulting to whichever is closest to the image's own
  shape. Output is ~1400px on the long edge (the sample map's building labels are unreadable
  below that), PNG first with a JPEG 0.92 → 0.8 fallback if it exceeds the 1.6M-char cap.

### Admin console, data & reset
- **9 — "Data reset" (was "Factory reset").** Three tools, least → most destructive: Clear all
  notifications (moved here, and no longer at-camp-only), **Reset logs** (NEW), Full reset.
- **`resetLogs` (NEW, `POST /admin/reset-logs`)** clears exactly what a compliance workbook
  contains — every person's check-in and sign-in/out history (returning them to "not signed in";
  `cancelled` people keep their lifecycle), all notes/testimonies/first-aid records, all incidents.
  Registrations, churches, accounts, accommodation, schedule, devotionals, FAQ and settings are all
  kept. Notifications are deliberately NOT included (their own button). Guarded by the same
  export-or-force gate as a full reset.
- **16 — Incidents survived a "full reset".** `makeAdminService` was never given the incident or
  push-subscription repos, so `reset()`'s wipe list was silently incomplete — no compiler or test
  covered it. Both are now constructor params and both are cleared. **Any new repository must be
  added to `reset()` in the same commit.**
- **Typed confirmations are case-insensitive** (`_CONFIRM_PHRASE`/`_confirmPhraseOk`) — a phone
  auto-capitalising "I understand…" no longer reads as a failed confirmation. The canonical string
  still goes over the wire; only the typed comparison is loosened.
- **10 — Notices + Scheduled notices merged** into one screen with Sent/Scheduled sub-tabs
  (`RENDER.notifs(sub)`, `NOTICE_SUB`), moved under the **Data** heading. The "Communications"
  group is gone; `RENDER.scheduled` survives as a redirecting alias.
- **11 — Every admin-console tile has an icon** (`_adminTile` is now the single tile builder, so a
  new entry can't miss its glyph). Three new `ICONS` keys: `swap`, `dollar`, `map`.
- **25 — The standalone "Sign-in/out log (.csv)" export button is gone** — that data is already a
  sheet in the workbook. The backend route is left in place, unused.
- **24 — Every audit sheet is newest-first.** The Sign-in & Sign-out timeline still folds its
  running totals CHRONOLOGICALLY and reverses afterwards, so each row's counts remain correct for
  the moment it happened and the top row carries the live totals.
- **6 — Tooltips clamp inside the `.screen`, not just the viewport**, so a bubble can't be clipped
  by the ≥980px `overflow:hidden` content column / run under the sidebar.
- **7 — The "accommodation override has moved…" note is removed** from Account Info.
- **15 — The light-purple strip under the bottom nav.** The 2026-07-26 `html{background:#fff}` fix
  only covered the CANVAS; the strip iOS exposes below the layout viewport is also painted by the
  BODY box, which still carried `--paper`. `body` is now white with `--paper` on `.app` alone, and
  **`.tabs::after`** extends the nav's white surface 120px below it (inside the nav's own stacking
  context, starting at `top:100%`, so it can never cover content).
- **17 — Incident high-severity toggle reads "High · alert zones"** (and the screen's infobox was
  reworded to match it rather than the reverse).
- **18 — The "Got it" banner is incident-only.** `_urgentAlerts` also requires
  `_isIncidentNotice(n)`; acknowledgement was only ever meant for incidents. Since `leadersOnly`
  notices are filtered server-side for church/firstAid, **those roles now never acknowledge
  anything** — the intended outcome. An ordinary urgent notice is read in the Notices list.
- **19 — "Validation failed" when adding a note from the Students screen.** The SPA posted
  `sessionId: SEL_SESSION`, which is genuinely `null` outside the check-in screen, and Zod's
  `.optional()` rejects `null`. `AddNoteSchema` now uses `.nullish()` and the SPA omits the key.
  **New optional fields on schemas the SPA posts to should be `.nullish()`, not `.optional()`.**

### Imports (items 12 + the three folded-in items)
- **12 — Spurious "Missing firstName or lastName" on a file that imports fine.** A trailing blank
  line is spreadsheet padding, not a defect: `isBlankRow()` (`elvanto-mapping.ts`) skips an
  entirely-blank row silently in all three importers. `field()` also gained a normalised header
  fallback (lowercase, non-alphanumerics stripped) so "First name" / "FIRST NAME" / "First  Name"
  resolve. A genuinely half-filled row still errors.
- **Ticket-type corrections + the accommodation override — verified, not rewritten.** The Ticket
  List update path already re-parses `Ticket Type` every run and applies `churchOverride` ahead of
  it; a regression test now pins that.
- **Multiple tickets / invoices for one person (the "bought the wrong ticket, pay the difference
  with a code" flow).** Tickets: the later row's type already won (the corrected ticket) — it now
  also warns naming the winning ticket and sets `needsReview`. Invoices: money fields ACCUMULATE
  across rows (`amountPaid`/`discountAmount`/`feesAmount`/`taxAmount` summed, `registrationCost`
  from the latest row), plus a warning and `needsReview`. ⚠ Accumulation starts from the rows in
  THIS file, never from the stored value, so **re-importing the same export is idempotent and
  cannot double-count** — covered by a test; don't "simplify" it to read the person's existing value.
- **Pending deletions are named.** The Form import is authoritative and deletes anyone absent from
  the file; the result carried only a COUNT, so a spelling change or wrong export could silently
  drop real registrants. Each absent person now gets a warning naming them and their church (capped
  at 50), visible in the DRY-RUN preview before anything is confirmed.
- **Ticket-difference discount codes are labelled honestly.** A code averaging ≥97% of the ticket
  price is the pay-the-difference correction, not a sponsored place. Still counted in the budget's
  discount breakdown (owner's decision) but labelled "Ticket difference — already paid" rather than
  reading as "100% Off".

### Copy pass (Sonnet sub-agent review, same session)
A consistency review of every `helpTip`, `.note-hint`, `.infobox`/`.warnbox`, `.sub` and
`emptyState` string. Applied: the detail-screen header said "Camper" (the only user-facing use of
that word — now "Student"); two notices strings omitted admin from who can send; the first-day
arrival tooltip and toast said "student" although the roster includes leaders; the wide-role search
placeholder said "camper"; the Churches and site-map tooltips were trimmed; the duplicated
sensitive-note explanation lost its redundant bubble (the always-visible `.sub` stayed, and the now
unused `_SENSITIVE_HELP` const was deleted); the incident infobox was reworded to match the
"alert zones" button. **Deliberately NOT applied:** the reviewer's proposal to rename every
"ministry" to "church" on the accommodation/budget screens — the owner uses both terms naturally
(their own bug list says "ministry"), so that is a vocabulary decision for them, not a cleanup.

## Improvement Initiative — Phases 1–7 deployed (2026-06-28)

A 7-phase improvement program (CMS engineering-maturity patterns onto this app's identity) was
completed and deployed to production on 2026-06-28. See `docs/PROGRAM-LOG.md`,
`docs/PROGRAM-SUMMARY.md`, `docs/CODE-QUALITY-LOG.md`, and the dated `CHANGELOG.txt` section.
Contract changes that supersede notes below:
- **Responsive system:** `:root` now has a fluid **type scale** (`--t-display`…`--t-micro`) and the
  `html` root font scales 16→17→18px at 768/1280. Continuous breakpoints (540/768/900/1280) sit
  before the 980px sidebar block; the content column widens 460→820px below 980. Use the `--t-*`
  tokens (and `--pad`, gender `--male/--female`, tint `--violet-d/--lav` etc.) — don't hardcode.
- **Icons:** SVG-only (no emoji). `ICONS` registry + `ic()` and new size helpers
  `icSm/icLg/icXl(n,cls)` + `emptyState(icon,msg)`. Adding a glyph = add to `ICONS`.
- **Navigation:** **single source** `navModel(role,mode)` → `{tabs,extras}`. `buildTabs` (bottom)
  and `_renderWideNav` (sidebar, via `navSidebar`) both derive from it — change nav in ONE place.
  Church/zoneLeader now have a populated desktop sidebar; admin at-camp sidebar = Home, Check In,
  Search, Notices, Accommodation Allocations, Admin Settings.
- **Budget:** REBUILT. Costs come from per-registrant `registrationCost` (NOT
  `CampSettings.tentPrice/classroomPrice`, which are now deprecated/unused — removed from the
  Settings UI, columns left in DB). Pure logic: `src/services/budget.ts` (`computeBudget`/
  `labelForAmount`/`budgetToCsv`). Categories = distinct cost per (church, camper|leader); null
  cost = "Cost not recorded" ($0, flagged, never dropped); grand total reconciles to the sum of all
  line totals. SPA `RENDER.budget`/`drawBudget` mirror it (collapsible church rows + client CSV).
- **Check-in sessions (AC-1):** `buildSessions` now makes the **first** camp day **PM-only**, the
  **last** day **AM-only**, interior days AM+PM (1-day camp = PM-only).
- **Accommodation (PC-10):** a church×gender classroom pool **>50** splits into `7-9`/`10-12`
  sub-pools (keys `${churchId}|${gender}|${bracket}`); leaders halved across brackets;
  `AllocationOccupant` gained `grade`. Single-gender/auto-fill/cascade unchanged. Tent City headings
  show total student/leader tents (PC-11).
- **Removed concepts:** "unpaid" is gone from the home DTO/UI (PC-3); FAQ/Help is pre-camp only
  (PC-7). `paymentStatus` field + reminders feature remain.
- **Service worker:** `sw.js` is now `camp-v7` (stepped v3→v4 P1 →v5 P4 →v6 P5 →v7 P6); `API_RE` includes `/export` (was missing).

### Phase 4 (first-aid login UX) — deployed 2026-06-28
- **firstAid nav** = **Search · Records · Schedule** (`navModel('firstAid')`). Search is the landing
  (no `home` tab — `gotoTab` redirects home→search for firstAid). **Medical Watch removed** (no Watch
  tab, no `/campers/medical` on the first-aid path).
- **First-aid records** = `StudentNote{category:'firstaid'}` (no migration). Body is 4 labelled lines
  `Problem:`/`Treatment:`/`First-aider:`/`Brought by:`. Written via `POST /notes` (category-scoped),
  read via **`GET /notes/firstaid`** (only firstaid category, `canAccessPerson`-scoped).
- **RBAC:** new `note:write:firstaid` (firstAid+director+admin) and `note:read:firstaid`
  (firstAid+zoneLeader+director+admin+**church**, the last own-church only). `note.service.add`
  asserts the firstaid capability **only** when `category==='firstaid'`; first-aiders can write/read
  ONLY first-aid records, never general notes/testimonies. **church can READ own-church first-aid
  records but not WRITE them** and has no general `note:read`.
- **Student Info** (renamed from "Casualty Card", `openStudentInfo`) leads with the student's
  **ministry leader** contacts (primary+secondary, via the existing `GET /search/contacts/:id`
  masked-contact path + audited reveal — no new permission); parent is the bottom fallback. Medical
  alert + consent are tone-softened; allergy-type dietary items are merged into the alert.
- **Admin Notes** (`RENDER.notes`/`drawNotes`): a **"First-aid"** Record-filter option + amber badge +
  Problem/Treatment body render; the notes CSV export already carries them (category column).
- **Tokens:** added `--ink-2` (darker secondary text) + softened `--alert-*`/`--consent-*` palette;
  all first-aid hardcoded hex tokenised (C1/C3 for these screens).

## UI/bugfix batch — deployed 2026-06-30

A small fix batch (admin-requested) shipped on 2026-06-30:
- **Account login locks (NEW).** `CampSettings` gained `churchLoginLocked` + `zoneLeaderLoginLocked`
  (both default `false`; migration `014`). Two **manual** toggles in admin **Settings**
  (`RENDER.adminSettings`/`saveSettings`, `.tgl` switch). When on, accounts of that role are
  blocked **at login only** — `auth.service.login` checks the lock *after* the password (so a
  locked account can't be probed) and throws `UnauthorizedError`. **Existing signed sessions keep
  working until their 12h TTL** (no per-request enforcement — stateless tokens carry the actor).
  admin/director/firstAid are never affected. `makeAuthService(users, settingsRepo?)` — the
  settings repo is optional (login lock is a no-op when absent, e.g. in unit tests). There is **no**
  automatic date-based trigger (deliberately dropped — the app is serverless with no scheduler).
- **Devotional editor:** the per-day **Save** button moved to the tile's **top-right**, inline with
  the day header (`RENDER.adminDevos`, `.rowsb` header row).
- **Tooltips (`helpTip`):** budget "Total registration fees" tip **removed**; long tips shortened;
  `_clampTip()` (called from `_toggleTip` on tap + a delegated `mouseover`) nudges the bubble so it
  never runs off either screen edge. Added brief at-camp tips to **first-day sign-in, daily
  check-in, My Youth, student search, testimonies**.
- **Accommodation allocations page** (`drawAccom`): heading **"Classroom rooms" → "Classrooms"**;
  **"Not in a classroom allocation" → "Classrooms (Pending Allocation)"**; the pending-allocation
  table now pads **every** column (not just the first) so it doesn't crowd on a phone, count
  right-aligned. (The separate Accommodation **setup** screen `RENDER.adminAccom` still says
  "Classroom rooms" — the rename was scoped to the allocations page only.)

## UI/UX fix batch — deployed 2026-07-01

Admin-requested batch (pre-camp). **SPA-only** (`public/index.html`) — no backend/schema change,
no migration. Verified: SPA `node --check` OK, `npm run typecheck` clean, `npm run test` = 270 pass.
- **Schedule-edit overlap (phone):** `_schedRow` grid is now `96px minmax(0,1fr) auto` (row **and**
  its header) + a `.sched-row input{min-width:0}` rule. Native `<input type="time">` keeps
  `min-width:auto` and was overflowing the fixed 92px Time track into the Activity field on narrow
  screens — the `minmax(0,1fr)` + `min-width:0` lets both inputs shrink to their tracks.
- **Setup wizard (`WIZARD_STEPS`) expanded + reordered** into a logical setup flow:
  Camp settings → Churches → Accounts → **Accommodation rooms** → **Accommodation allocation** →
  Schedule → **Devotionals** → **FAQ** → **Ministry contacts**. The four new steps (`accomAlloc`
  →`accom`, `devos`→`adminDevos`, `faq`→`adminFaq`, `contacts`→`adminContacts`) auto-detect "done"
  like the originals: allocation = any room in `/accommodation/allocations` has an occupant;
  devotionals = any `checkInDays` day has verse/reflection/prayer; FAQ = ≥1 `/faq` entry; contacts =
  any church has ≥1 named leader. ("Accommodation" → "Accommodation rooms" to distinguish it from
  the new allocation step.) Each step also carries a `tip` rendered as a `helpTip('…')` bubble beside
  its label (Bug 3 — a short tooltip per wizard item).
- **Global top loading bar (`#nprog`, NEW):** a thin accent bar under the top edge, driven from
  `_doFetch` via reference-counted `_npStart`/`_npDone` (creeps to 90%, snaps to 100% on completion,
  fades). Addresses the "screen sits still 1–1.5s after a button push" complaint (genuine serverless
  + Supabase round-trip latency; stale-while-revalidate revisits showed no loading hint). **Only real
  network requests drive it** — cached GETs bypass `_doFetch`, so instant navigations don't flash the
  bar. `#nprog` is the first child of `.app` (absolute `top:0`); tune colour/height in that one CSS rule.
- **Latency quick-win:** `_prefetch` now also warms `/accounts/churches` + `/accounts/users` for
  admin/director on login (the Accounts, Ministry-contacts and Wizard screens then open from cache).

## Feature batch — deployed 2026-07-02

Admin-requested batch (SPA + backend + **migration 016**, applied to prod):
- **Account Info (Accounts screen):** "Rename" + "Change username" are consolidated into one
  **Account Info** modal per tile (edit icon; key = password, trash = delete — the separate @
  username action is gone, `editUsername`/`saveUsername` deleted). Leadership modal = name +
  username + zone (zoneLeader) + status; church modal = church name + login username + zone +
  **accommodation override**.
- **Accommodation override (NEW):** `Church.accommodationOverride: 'tent'|'classroom'|null`
  (`churches.accommodation_override`, migration `016`). At **CSV import**, every **student** of a
  church with an override is forced to that kind (create + update paths, `churchOverrideById` map
  in `import.service`); leaders never overridden; a warning row is emitted when a CSV value is
  actually changed. Churches that deliberately split ticket types leave it unset. Set via Account
  Info; `UpdateChurchSchema.accommodationOverride`.
- **At-camp admin console:** Setup Wizard tile is **pre-camp only**; at-camp shows **"Individual
  Student Data Edit"** (`RENDER.adminStudents`, admin only): all students (merged
  `/registrants`+`/campers`), church/gender/grade filters + name search, row-tap edit of core
  fields (name, church, gender, grade, accommodation, medical, dietary) via
  `PATCH /registrants/:id`, and manual **Add student** (`POST /registrants`) created as
  `registered`/not-at-camp (signs in via First-day arrivals). Backend: registrant PATCH accepts
  `churchId/churchName/zone`; create accepts `medical`/`dietary`; **`CamperDto` gained
  `accommodationKind`**; SPA `_invalidate('/registrants')` now also clears `/campers`+`/checkin`.
- **Tooltips:** church auto-creation + override explained on the "Add a church" card and the
  wizard Churches step.

## UI/UX fix batch — deployed 2026-07-02 (at-camp bug list)

Admin-requested batch (at-camp, from "Admin Mode: at camp"). **SPA-only** (`public/index.html`) —
no backend/schema change, no migration. Verified: SPA `node --check` OK, `npm run typecheck`
clean, `npm run test` = 275 pass.
- **Daily check-in tile decluttered:** `rowHtml` (in `RENDER.checkin`) dropped the initials avatar,
  the "med" medical-flag badge, and the always-visible grey sync dot (per-row sync state is now a
  silent no-op — the existing top-of-list `ci-sync` banner is the only sync-status UI). The
  check-in button is now a primary solid pill labelled "Check in"/"Check out" (ghost once already
  checked in), sized larger than the ghost "Add note" button beside it.
- **`.pill` badges no longer wrap on phone:** ("View ›" on the Data/Budget/Accommodation nav cards
  was breaking onto two lines when squeezed by a long sibling in the same `.rowsb`) — `.pill` CSS
  gained `white-space:nowrap;flex-shrink:0`.
- **Phone-number display normalized (`fmtPhone`, NEW):** AU mobiles now always render as
  `0411 928 301` regardless of source formatting, including CSV imports that lost the leading 0 to
  spreadsheet numeric coercion upstream (a 9-digit `4xxxxxxxx` is re-prefixed with `0`). Applied
  everywhere a phone number is *displayed* (Data tab, `telLink`, first-aid leader/parent contacts,
  student search reveal, Student Info/camper detail) — editable phone `<input>` fields (ministry
  contacts editor) are untouched so admins can still type freely. Masked contact numbers
  (`0411****01`) pass through unchanged.
- **Data tab (`RENDER.data`) is sortable:** clicking a column header cycles
  unsorted→ascending→descending→unsorted (`dataSort`); unsorted is the **default import order**
  (`_dataCache` sorted by `createdAt` ascending client-side, since `/registrants` itself returns
  alphabetical order) rather than whatever order the last sort left it in.

## Bug-list batch — leader presence, sensitive notes, budget, log totals — deployed 2026-07-03

Admin-requested batch of 7 items. Design doc: `docs/superpowers/specs/2026-07-03-bug-batch-design.md`.
`npm run typecheck` clean, `npm run test` = 409 pass, SPA `node --check` OK. Migration `019`
applied to prod. `sw.js` `camp-v14`→`camp-v15`.

- **Leader at-camp presence (NEW).** `admin.service.ts` `setMode`: on the **pre-camp → at-camp**
  transition only, every non-cancelled `kind:'leader'` person not already `atCamp` is bulk
  sign-in'd (`withSignEvent` from `person-lifecycle.ts` — the same transition a normal sign-in
  uses, so `atCamp`/`lifecycle`/`signOutHistory` stay fully consistent with the presence
  invariants above) via a single `personRepo.saveMany` — **not** a per-leader round trip, so this
  can't reintroduce mode-switch latency. **(2026-07-06 addendum)** the reverse transition
  (**at-camp → pre-camp**) now also reverts everyone still `atCamp` — see "Follow-up — mode-switch
  revert" further down; the forward bulk-sign-in described here is unchanged. Leaders stay excluded from the twice-daily check-in
  roster (`checkin.service.getSessionStatus` now filters `kind !== 'leader'`) and from
  `dashboard.service`'s `checkInsDue` (same filter — a leader never gets a `checkInHistory` entry
  and would otherwise sit permanently "due"); `totalAtCamp`/`totalExpected` are **not** filtered —
  leaders count as physically at camp. SPA My Youth (`RENDER.myyouth`/`filterMyYouth`) gained a
  **"Leaders"** grade-filter option and its "Late arrivals" bucket now includes leaders (was
  student-only) — covers a leader added after the bulk sign-in already ran; they get the same
  existing "Sign in to camp" button on `openCamper`, no new UI. `signOutPrompt`/`signInPrompt` take
  an `isLeader` flag and adapt copy ("this leader" vs "this youth"; the parents-met question is
  skipped for leaders).
- **Sensitive notes/testimonies (NEW).** `StudentNote.sensitive` (migration `019`,
  `notes.sensitive boolean not null default false`). A "Mark as sensitive" toggle on both the "Add
  note" modal (`notePrompt`) and "Submit testimony" screen (`RENDER.testimonies`), default off.
  `note.service.forCamper` (the profile-notes read path) drops `sensitive:true` notes for
  `actor.role==='church'` only — zoneLeader/director/admin still see them (with a small
  "Sensitive" pill in `openCamper`'s notes list). The previously-false "Visible to zone leaders &
  directors only" subtitle on the note modal is gone, replaced by a `helpTip` describing the real
  rule.
- **Budget discount-code breakdown (NEW).** `src/services/budget.ts` `computeDiscountCodeSummary`
  (pure, tested) — each distinct `discountCode` used → count, against `totalInScope` (total
  registrants in the same scope as the rest of the budget table). SPA mirror
  `computeDiscountSummaryClient`; rendered as a new collapsible "Discount codes" card at the bottom
  of `RENDER.budget`/`drawBudget`, same collapse pattern (`_budToggle`) as the per-church rows.
- **Sign-in/out log running totals.** `audit-export.service.ts` `buildSignInOutTimeline`: the
  "Sign-in & Sign-out Log" (both the compliance workbook sheet and `exportSignInOutCsv`) is now
  **one chronological timeline** across every person (students AND leaders) instead of grouped
  per-person — two new columns, **Total Students Signed In** / **Total Leaders Signed In**, show
  the running per-kind count immediately after each row's event. Leader events from the new bulk
  sign-in flow feed into this exactly like any other event.
- **Mode-switch lag fix.** `switchMode()` (SPA) already applies the fresh `campMode` locally right
  after `POST /admin/mode` succeeds, but the `RENDER.home()` it called next unconditionally
  re-fetched `/settings` again — a 3rd sequential round-trip for no new information. `RENDER.home`
  now takes a `skipModeSync` flag; `switchMode` passes it (other already-open sessions still get
  the re-sync on their next home nav, unaffected). Also closed a related cache-correctness gap:
  `_invalidate` didn't clear `/settings` on an `/admin/mode` write, so a same-session cached read
  within the 30s TTL window could briefly see the stale pre-switch mode.
- **Review Data Import (audit, no behaviour change).** Confirmed the flow: Ticket List/Invoice rows
  that can't be confidently matched get `needsReview:true` → an amber badge on the Data tab
  (`reviewCell`) → `openReviewModal` → "Mark reviewed" (`_markReviewed`, clears the flag only,
  never auto-merges — by design). Added a `helpTip` inside `openReviewModal` explaining what to
  check (name/church spelling, accommodation/cost) before confirming.
- **Import row-order robustness (confirmed, no change).** All three importers match people by a
  name(+phone) key (`person-matching.ts` cross-church index; `import.service.ts`
  `nameChurchKey`) — never by CSV row position. Added a shuffled-row-order regression test to
  `multi-source-import.integration.test.ts`.

## Bug-list batch — audit columns, discount purpose, contacts save, Data Import nav — deployed 2026-07-03

Admin-requested batch of 6 items (from "Account: Admin, Mode: Pre-Camp"). SPA + backend
(`audit-export.service.ts`, `budget.ts`), **no schema/migration change**. `npm run typecheck`
clean, `npm run test` = 413 pass, SPA `node --check` OK. `sw.js` `camp-v16`→`camp-v17`.

- **Audit workbook columns.** Attendees sheet gained an **Accommodation** column
  (`accommodationDisplay(p.accommodationKind)` → "Tent"/"Classroom"/blank). Notes &
  Testimonies and First-Aid Records sheets both gained **Grade** + **Gender** columns.
- **Budget discount-code purpose (auto-derived, no manual entry).** Each discount code's
  card row now shows a pill like "25% Off" or "$20 Off" next to the code —
  `deriveDiscountPurpose` (`budget.ts`) averages `discountAmount/registrationCost` across
  everyone who used the code; snaps to 25/50/70/100% if within 3 points of a tier, else
  falls back to the average flat dollar amount (`purpose: null` when no one using the code
  has both fields recorded). SPA mirror `_deriveDiscountPurpose`. **`BudgetPerson` gained
  `discountAmount`** (already present on `RegistrantDto`, just not previously passed
  through to the budget calc). Also fixed a laptop-only layout complaint — the discount
  card read as a wide, mostly-empty table below the church cards — `RENDER.budget` now
  splits into a 2/3 summary + 1/3 discount-codes column at `≥980px` (`.bud-grid` CSS,
  inside the existing 980px block); stacks normally below that. The discount card still
  starts collapsed by default in both layouts (unchanged).
- **Ministry contacts save no longer blows away the whole screen.** `saveContacts(id)`
  used to call `_rContacts()` → a full `RENDER.adminContacts()` re-render (re-fetches every
  church, rebuilds every card) — which collapsed every other open card and dropped any
  unsaved edits an admin had typed into other churches while working down the list. It now
  just PATCHes and updates that one card's "N/4 Contacts" pill in place
  (`_updateContactPill`), leaving every other card exactly as the admin left it. The
  now-unused `_rContacts()` wrapper was deleted.
- **Data Import moved to its own admin console tile + nav entry.** The CSV/Excel upload
  card (`_importUploadCardHtml`) is gone from the admin **Data** screen — that screen is
  renamed **"Data Export/Reset"** (was "Data, Reset & Exports") and is export/reset-only
  now. Import lives at the previously-built-but-unreachable `RENDER.import` screen
  (`'import'` nav id), now wired up: a new **"Data Import"** tile on the admin console, and
  — **pre-camp only** — the admin bottom-nav Notices tab is replaced with a **Data Import**
  tab (new `upload` icon in `ICONS`). Notices is still reachable pre-camp via a new button
  at the top of **Admin Settings** (`RENDER.adminSettings`). **At-camp admin nav (desktop
  sidebar) is unchanged** — Notices stays there; this was a deliberate scope decision (the
  bug list didn't specify a mode, and the owner chose pre-camp-only for the swap).

## Elvanto export guide on the import screen — deployed 2026-07-03

**SPA-only** (`public/index.html` + static images), no backend/schema change. The import upload
card (`_importUploadCardHtml`, both `RENDER.adminData` and `RENDER.import`) gained a ghost button
**"How do I export these files from Elvanto?"** → `openImportGuide()`, a full-screen 3-step
screenshot walkthrough (`#impGuide` overlay in the shell; `IMPORT_GUIDE` data; `_igDraw`/`_igGo`/
`_igZoom`/`_igTs`/`_igTe`). One step per import file — Form / Ticket List / Billing Contacts —
each with a short caption + real Elvanto screenshots served from **`public/img/import-help/`**
(`form-export.png`, `events-export.png`, `ticket-export.png`, `billing-export.png`; the Ticket
List step shows two images: where the Events Export button is, then the export popup). Steps
flick via ‹/› buttons, dot indicators, or **touch swipe** (≥48px horizontal); screenshots are
wide Elvanto strips so **tap-to-zoom** toggles a 220%-width horizontally-scrollable view
(`.ig-imgwrap.zoom`) for phones. `sw.js` `camp-v15`→`camp-v16` (HTML changed; images ride the
normal cache-first static path).

## First-aid export + login-enumeration hardening — deployed 2026-07-03

- **First-aid Records CSV export (SPA):** `RENDER.records` gained an **Export** button →
  `exportFaRecords()`, which builds a CSV client-side from the already-loaded `window._faRecsAll`
  (via `_faParse`) — columns Student/Problem/Treatment/First-aider/Brought by/Logged by/Logged at,
  filename via `_exportName`. **No backend or permission change** (firstAid holds only
  `note:read:firstaid`). Exports the loaded records (`/notes/firstaid?limit=100`), not just the
  on-screen filter.
- **Login user-enumeration hardening (backend, `auth.service.login`):** a missing / inactive /
  passwordless account now runs an **equal-cost dummy scrypt** (`DUMMY_PASSWORD_HASH`) and returns
  the same `Invalid credentials` as a wrong password — previously an unknown username skipped
  scrypt (fast) and a passwordless account had a distinct message, which (with the login limiter
  keyed per ip+username) was a usable timing/message oracle. `auth.service.test.ts` +3 (395 pass).
  **Deliberately NOT changed:** the stateless-token trade-off where a deactivated user's existing
  token stays valid to its 12h TTL — closing it needs a per-request DB lookup (user-facing latency).
- **`sw.js` is now `camp-v13`** (v9→v10→v11 import/Excel →v12 security headers/CSP →v13 first-aid export).

## Bug-list + import redesign + Excel + security headers — deployed 2026-07-02 (late)

Large admin batch (SPA + backend + **migration 018**). `npm run typecheck` clean, `npm run test`
= 275→**392 pass**, SPA `node --check` OK. sw.js `camp-v9`→`camp-v12`.

- **Import UI REDESIGNED — SUPERSEDES the segmented-selector description in the multi-source
  section above.** The manual Form/Ticket/Invoice `.seg` picker is **gone**. One upload field
  (`_importUploadCardHtml`) takes **1–3 files at once**; each file's type is **auto-detected from
  its column headers** (`_detectImportType`/`_IMPORT_SIGNATURES`), so a file can't be sent to the
  wrong importer. Files run in dependency order **Form→Ticket→Invoice** in a single combined
  preview→confirm (`adminUpload`→`_renderImportPreview`→`_confirmImport`). Unknown files are
  rejected with their columns shown + a manual type/skip choice (`_renderImportUnknown`). No file
  is mandatory. Per-source **last-imported** timestamps show on the screen (`_loadImportStamps`).
  The three backend import endpoints/services are **unchanged**; the redesign is SPA-only plus a
  controller-layer timestamp stamp (`src/api/controllers/_import-stamp.ts`).
- **Excel (.xlsx/.xls) import:** vendored **SheetJS** at `public/vendor/xlsx.full.min.js`,
  **lazy-loaded** on first Excel use (`_ensureXlsx`; same-origin so CSP `script-src 'self'`
  allows it; no eval/Function). `_readImportFile` converts Excel→CSV (`_xlsxToCsv`, header-matched
  sheet selection) then the CSV pipeline is unchanged. (CMS + its Connection Audit already have
  Excel via their own dependency-free `readXlsx` — no CMS change was needed.)
- **Migration 018** (`018_defaults_and_import_timestamps.sql`, applied to prod) — 4 nullable
  `timestamptz` on `settings`: `defaults_saved_at` (bugs 6/10 — shown on the Data screen's Save
  Defaults card + the close-out checklist; stamped in `admin.service.saveDefaults`) and
  `form/tickets/invoices_imported_at` (the import last-upload lines). **`supabase.settings` writes
  ALL settings columns on every save**, so this HAD to be applied before/with deploy.
- **Audit workbook 500 FIXED** (`audit-export.service.ts`): worksheet name `'Sign-in/Sign-out Log'`
  had an illegal `/` → ExcelJS threw on `addWorksheet`, so the download had **never** worked.
  Renamed to `'Sign-in & Sign-out Log'`. Added a dedicated **First-Aid Records** sheet (parsed
  4-line body; excluded from Notes & Testimonies). Regression test: `audit-export.service.test.ts`.
- **Compliance filenames** now include camp year + export date (`_exportName`).
- **First-aid Search/All-Students → profile fix:** `openStudentInfo`/`openFirstAidLog` now paint
  the **active** first-aid screen (`_faScreen()`) instead of hard-coding `'search'` (which
  `paint()`'s stale-guard dropped when on the `allstudents` screen); Back is origin-aware.
- **Add-note button** on student profiles (`openCamper`, `stuEdit`), camper-only + note-writer-only.
- **Director at-camp home** hides the Notices tile (nav unchanged). **Phone overscroll/side-drag**
  fixed via `.screen{overflow-x:hidden;overscroll-behavior:contain}` + body `overscroll-behavior`.
  **Church tooltip** moved to the Churches list tile. **Laptop tooltip** flips up near the bottom
  edge (`_clampTip` + `.htip-pop.flip-up`).
- **Security headers (zero user friction):** `express-adapter` disables `X-Powered-By`; adds HSTS
  (prod), COOP+CORP `same-origin`, and `Cache-Control: no-store` on API/export responses (static
  stays cacheable); CSP meta gained `frame-ancestors 'none'`.

## App icon + home-hero brand mark — updated 2026-07-02

The Home Screen (PWA "Add to Home Screen") icon was a thin outlined triangle in an off-brand
navy/blue that didn't match the app's actual purple/violet palette and didn't read as a tent.
Replaced via a brainstormed multi-option review (4 SVG concepts sent to the user for comparison
at both full size and realistic 60/76px home-screen size before picking one).
- **`public/icons/icon.svg`** — new design: the app's real header gradient (`#7c3aed`→`#1e1b4b`,
  135deg, matching `.hero`/header exactly) on a rounded-square (`rx="96"`), with a proper white
  A-frame tent (sloped roof, mid-purple `#9333ea` triangular door flap for depth, a ground line,
  two guy-lines) and a simple white cross standing above the peak like a chapel-tent flag. Content
  is kept within the maskable-icon safe zone (roughly a centered 80%-diameter circle) so it
  survives OS circle/squircle cropping. `manifest.json` is unchanged (already `"sizes":"any"`,
  `"purpose":"any maskable"`, SVG-only — no PNG generated yet).
- **`public/sw.js` `CACHE` bumped `camp-v7`→`camp-v8`** — the service worker cache-firsts icons,
  so without a version bump, anyone who already added the app to their home screen would keep
  seeing the old icon indefinitely.
- **Gap closed (2026-07-04):** `public/icons/icon-180.png`/`icon-192.png`/`icon-512.png` exist,
  match the SVG design, and are referenced by both `index.html` (`apple-touch-icon` +
  `<link rel="icon">`) and `manifest.json`. The SVG stays the manifest's `sizes:"any"` entry.
- **`heroMark()` (NEW, `public/index.html`)** — a reduced-detail, 16%-opacity white version of the
  same tent+cross mark (no background square, just the line art), absolutely positioned on the
  right side of a `.hero` card. Added as the **first child** of both Home hero cards (pre-camp
  `RENDER.home` and at-camp `renderHomeAtCamp`) so it paints behind the greeting text, matching
  how `.hero`'s existing `:before`/`:after` decorative circles already behave (`.hero` already has
  `position:relative;overflow:hidden`, so the mark clips cleanly like those do). Not used anywhere
  else — if a fifth hero-style card gets added later (budget, devotional) and should also carry
  the mark, call `heroMark()` there too rather than duplicating the SVG markup.

## Security & perf hardening ported from CMS — 2026-07-02

- **CSP meta tag** (`public/index.html` `<head>`): defence-in-depth alongside the SPA's escaping
  discipline. `'unsafe-inline'` stays for script-src/style-src (required by the inline-script/
  onclick architecture); the policy blocks external script/resource loads it doesn't need.
  `style-src`/`font-src` allow Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com` — Plus
  Jakarta Sans, the app's only external resource); `connect-src 'self'` covers all API calls
  (relative paths only). **A CSP typo isn't caught by tsc/vitest** — after any change to the
  policy, hard-load the prod URL and check the browser console for CSP violations. `sw.js`
  `CACHE` bumped to `camp-v9` alongside this change (HTML changed).
- **Server-side response cache** (`src/utils/response-cache.ts` + `src/services/dashboard-cache.ts`,
  ported from CMS): a 30s-TTL in-memory cache wraps the `/home` dashboard DTO
  (`dashboard.service.ts`). Cache key is `${role}:${churchId ?? '_'}:${zone ?? '_'}` — **must**
  include actor scope, since the DTO is role/church/zone-scoped and a shared key would leak one
  church's data to another. `invalidateDashboardCache()` is called from every write that can
  change the DTO (person create/update/remove/checkIn/signEvent, all 4 import services,
  admin reset/newYear/clearNotifications, settings update/setMode, notification send/remove/
  clearAll, account church create/update/delete) — when in doubt the rule was invalidateAll,
  correctness over hit rate. **Lives in its own module** (`dashboard-cache.ts`, not inside
  `dashboard.service.ts`) to avoid a circular import: `dashboard.service.ts` already imports
  `canAccessPerson` from `person.service.ts`, so a writer-side import back from
  `dashboard.service.ts` would cycle. Deliberately **not** applied to
  `checkin.service.getSessionStatus` — the at-camp roster must stay live. Same serverless
  caveat as CMS: only helps within a warm instance.

## Admin bug batch + offline sign-in + director digest — deployed 2026-07-04

Large overnight admin-requested batch (8 numbered bugs + 2 new features), SPA + backend +
**no schema migration** (reused existing `amountPaid`/`formImportedAt` columns). `npm run
typecheck` clean, `npm run test` = **442 pass** (11 new), SPA `node --check` OK. `sw.js`
`camp-v18`→`camp-v20` (two HTML-changing pushes in the batch).

- **Director navigation restored.** Director had `import:run`+`allocation:manage`
  (`access-control.ts`) and `RENDER.import`/`RENDER.adminData` already accepted director, but
  `navModel` gave director no route to either in any mode — a regression. `RENDER.data` (the
  pre-camp "Data" tab, also reachable at-camp via the home tile "Student Data Table") now has
  two buttons: **Data Import** (`go('import')`) and **Records & Export** (`go('adminData')`).
  `RENDER.adminData`'s Close-out and Clear-notifications cards are now `isAdmin`-gated (same
  pattern as Save Defaults/Factory Reset) so a director viewing via this new route never sees an
  action the backend would 403 on.
- **Brisbane-anchored "today" (`localDateISO()`, NEW).** `new Date().toISOString().slice(0,10)`
  is UTC, so anywhere from midnight to 10am Brisbane it read yesterday's date. New helper
  mirrors the backend's `zonedNow()` via `Intl.DateTimeFormat('en-CA',{timeZone:'Australia/
  Brisbane'})`; takes an optional instant to convert (used to compare a server `createdAt`
  timestamp against "today" in Brisbane, not just slice its UTC date). Fixes `_realCampDayNumber()`
  (header Day badge + the home-tile First-Day/Testimonies switch, which reads it) and
  `drawFaRecords`'s "Today" filter on First-aid Records.
- **"Not Signed In" section on check-in (`RENDER.checkin`, NEW).** A collapsed `<details>` at
  the bottom of the daily check-in screen listing the viewer's scoped students with
  `atCamp!==true` — ANY lifecycle stage (never-arrived AND already-checked-out/departed), fetched
  via `/registrants`+`/campers` in parallel with the roster status (same dedup pattern as
  `RENDER.firstday`). Each row has a direct "Sign in to camp" button (`signInPrompt`). Does not
  touch `checkin.service`'s roster contract (still atCamp-only).
- **Zone-leader per-church pulse (`renderOversightPulse`).** zoneLeader's home pulse now groups
  by `r.church` instead of `r.zone` (their roster is already zone-scoped, so the old zone grouping
  produced one aggregate bar) — amber below **70%** (`PULSE_AMBER_PCT`, new `.bar7.amber` CSS).
  Tapping a church bar sets `FILTER.church` and jumps to Check-in (`_pulseGoToChurch`). Director/
  admin deliberately KEPT the existing per-zone bars (would be 10+ bars camp-wide otherwise).
- **Setup wizard + return chip + console regroup.**
  - `WIZARD_STEPS` gained an **"Import registrations"** step between Accounts and Accommodation
    rooms (done-check: any person exists OR `settings.formImportedAt` set) — **10 steps total**.
  - **"Back to setup (step N of 10)" chip**: a *persistent* banner (`_wizardChipHtml`, hooked into
    `paint()` itself) shown on any screen that's a `WIZARD_STEPS` target while a
    `sessionStorage['ycp_wizardReturn']` flag is set — set by `_wizardGo(i)` when a wizard row is
    tapped, cleared on returning to `RENDER.adminWizard` or on logout. Deliberately NOT wired into
    each individual save handler (~10 screens) — one shared hook instead.
  - **Admin console tiles regrouped** under three headings (`RENDER.admin`), **re-ordered again
    same day** per follow-up feedback — current final order:
    - **Camp setup**: Setup Wizard → Camp settings → Accommodation → At-Camp Info → Switch mode.
    - **People & churches**: Accounts & churches, Ministry contacts.
    - **Data**: Data Import, Data Export/Reset (Records & Export for director), + Individual
      Student Data Edit (at-camp only — not explicitly specified in the reorder request, kept
      here as the closest fit since it has no other home in this console).
- **Batch schedule saves.** New `PUT /schedule/day` (`schedule.service.ts` `replaceDay`,
  `IScheduleRepository.replaceDay` — in-memory does delete+re-set on the Map, Supabase does
  delete-then-multi-row-insert inside one `sql.begin` transaction) replaces `saveSchedDay`'s old
  N-deletes-then-N-creates loop. **`Route`/`BufferRoute` method unions and the Express adapter's
  method cast had no `'PUT'`** — added, since this was the first `PUT` route in the app (also
  added to `Access-Control-Allow-Methods`).
- **Copy/label/trust batch.**
  - `_paintPerson`'s "Paid" field showed `registrationCost` (ticket price, not what was actually
    paid). New `_paidOrCostRow(s)`: shows `amountPaid` labelled **"Paid"** when an Invoice import
    recorded one, else `registrationCost` labelled **"Cost"**.
  - Check-in screen's stale "Notes visible to zone leaders & directors only" hint corrected to
    match the real rule (church sees non-sensitive notes too).
  - `RENDER.notes` subtitle: **"Your zone: `<zone>`"** for zoneLeader (was hardcoded "All zones ·
    whole camp", never true for a zone-scoped read); director/admin unchanged. Also gained an
    optional `presetFilter` param (used by the new digest card below) that pre-selects a Record
    filter option.
  - `RENDER.adminAccom` (accommodation **setup** screen): "Classroom rooms" → **"Classrooms"**,
    matching the allocations page (the two screens had drifted).
  - `notePrompt`'s leader-name field already prefilled from `LAST_LEADER` — `reviewNote` no
    longer *requires* it (backend already attributes the note to the logged-in actor; the typed
    name is just folded into the body as a "logged by" annotation when present).
- **Schedule/FAQ/Devotionals condensed → "At-Camp Info" (`RENDER.atCampInfo`, NEW).** One admin
  screen with three sub-tab buttons (Schedule/FAQ/Devotionals, defaults to Schedule) replacing
  three separate console tiles/nav entries. Old `RENDER.adminFaq`/`adminDevos`/`adminSchedEdit`
  bodies became internal content-builders (`_acFaqBody`/`_acDevosBody`/`_acScheduleBody`) called
  by the merged screen; `_rFaq`/`_rSched` re-render helpers now call `RENDER.atCampInfo('faq'|
  'schedule')`. `WIZARD_STEPS`' schedule/devos/faq rows still route here, each pinned to its own
  sub-tab via `go('atCampInfo', arg)`. (`adminFaqEdit` — a pre-existing, already-unreachable
  at-camp FAQ screen with no nav path to it — was left alone, out of scope.)
- **Offline Sign-In (NEW, `src/services/offline-signin.service.ts`).** Fallback bulk sign-in for
  churches who prefer paper/bulk sign-in over the app, at the bottom of the Data Import screen.
  `GET /export/offline-signin` (exceljs) builds ONE workbook — every registered **student**
  (leaders excluded), all churches, sorted by church then surname — columns First/Last/Church/
  Gender/Grade + blank **"Signed In?"**, with an obviously-fake "Sample Student" row demonstrating
  `Y`. `POST /import/offline-signin` re-parses a filled sheet (`parseCsv`) and bulk-signs-in every
  row marked exactly `Y` that matches an existing student by **First+Last+Church text** (no id
  column) and isn't already `atCamp` — via the same `withSignEvent`+`saveMany` bulk pattern as the
  leader bulk sign-in in `admin.service.setMode`. The Sample row is matched by name and always
  skipped, regardless of what's typed in its Church cell. SPA reuses the existing client-side
  `_readImportFile` (CSV/Excel via lazy SheetJS) to parse the upload, then POSTs the raw CSV text
  — the backend does all matching (consistent with the Form/Ticket/Invoice import architecture,
  and testable with vitest). A plain `confirm()` gate precedes the POST (no separate dry-run mode
  — a lower-effort deliberate choice for this fallback feature). 9 new tests
  (`offline-signin.service.test.ts`).
- **Director + admin morning digest card (NEW, at-camp home hero).** "Day N · X/Y checked in
  this session · Z churches complete · K first-aid records today", each figure tappable
  (`_digestCardHtml`/`_renderDirectorDigest`, same paint-immediately-then-inject-async pattern as
  `renderOversightPulse`, called un-awaited from `renderHomeAtCamp`). Required one backend DTO
  addition: `AtCampDashboard.sessionExpected` (the atCamp-non-leader population subject to the
  CURRENT session — same population `checkInsDue` is computed against) so the SPA can derive
  "X/Y checked in" as `sessionExpected - checkInsDue` / `sessionExpected` with no extra fetch.
  "Churches complete" re-fetches `/checkin/sessions/current` + status independently of
  `renderOversightPulse` (harmless — both hit the SPA's 30s client `Cache`, so this is a cache hit
  in practice, not a second real network call) and groups by church (`done===total`, regardless
  of the per-role pulse-bar grouping above). "First-aid records today" fetches
  `/notes/firstaid?limit=100` and filters via `localDateISO()`. Tapping "churches complete" or the
  check-in ratio jumps to Check-in; tapping first-aid jumps to `RENDER.notes` pre-filtered
  (`go('notes','firstaid')`) — reachable for admin too via their existing "Testimonies & Notes"
  home tile even though admin has no permanent nav entry to Notes at-camp.
- **`icons-180/192/512.png` gap (CLAUDE.md correction only, no code change).** These PNGs already
  existed, matched the SVG design, and were already referenced in `index.html`+`manifest.json` —
  the "known gap, not yet fixed" note below was stale from an earlier session and has been
  corrected in place.

## Bug batch — Unallocated FK crash, at-camp Data tab, preview banner, Reg type — deployed 2026-07-06

Admin-requested 3-bug batch. `npm run typecheck` clean, `npm run test` = 442 pass, SPA
`node --check` OK. No migration.

- **Unallocated-import crash FIXED (Supabase-only, not caught by vitest).** `people.church_id`
  has a real FK to `churches(id)`, but the `__unallocated__` sentinel (church-allocation.ts,
  2026-07-03) was never a `churches` row — writing it threw a foreign-key violation, surfaced
  to the SPA as the generic "An unexpected error occurred". `src/repositories/supabase/
  supabase.people.ts` now maps the sentinel to/from SQL `NULL` at the I/O boundary
  (`personColumns`/`toPerson`/`findByChurch`) — `NULL` is already FK-legal (`on delete set
  null`) and the domain model never sees it; `Person.churchId` still always reads as either a
  real id or `__unallocated__`. **Prod data note:** 10 people already sat with `church_id
  NULL`/`church_name 'OTHER - please specify below'` from an old auto-created "OTHER" church
  that had since been deleted (its FK cascade nulled `church_id` but left the denormalized
  `church_name`/`zone` stale) — this is what made a re-import see them as "absent" (10
  flagged for deletion) while the replacement row crashed on save. One-off prod SQL
  corrected their `church_name`→`'Unallocated'`/`zone`→`''` in place (same ids, no data
  loss); the repo fix means they now round-trip correctly on every future import.
- **Data tab missing at-camp leaders FIXED.** `RENDER.data` (the Data/registrants table) only
  fetched `/registrants` (`lifecycle==='registered'`). At-camp, **every leader is bulk-signed-in
  on the mode switch** (2026-07-04 presence feature) — their lifecycle becomes `arrived`, which
  drops them out of `/registrants` permanently, since nothing ever demotes a camper back to
  registrant. Regular students don't show this since they're promoted individually as they
  physically arrive. `RENDER.data` now also fetches `/campers` and merges in any not already
  present by id (same dedup pattern as `RENDER.firstday`), so the table always shows the full
  roster regardless of lifecycle. `CamperDto` gained `registrationType` (was registrant-only)
  so the "Reg type" column doesn't go blank for a merged-in camper row.
- **"Reg type" column wired to real data.** It read a `Type`/`Registration Type` Form CSV
  column that doesn't exist in any real Elvanto export (Form/Ticket List/Invoice all lack it) —
  always blank. `ticket-import.service.ts` now stores the Ticket List's real `Ticket Type` text
  (e.g. `"EARLY BIRD | Tent Accomodation"`) as `registrationType` (added to the service's
  `OWNED_KEYS`, same never-clobber-with-blank rule as `ticketNumber`/`invoiceNumber`).
- **Preview banner code-spill fixed.** `${ic('preview')}` sat in static `<body>` HTML markup
  (not a JS template literal), so the browser printed it literally instead of rendering the
  SVG. `#previewBanner .pb-label` is now an empty span (`id="pbLabel"`) filled via
  `ic('preview')` at boot, once `ICONS`/`ic` are defined.

## Follow-up — mode-switch revert, Budget/Data leader visibility — deployed 2026-07-06

Same-day follow-up after the batch above: the admin flagged leaders were still missing from
Budget and Home, with Cost blank on the Data tab. Root cause (found by querying prod
directly): the camp had at some point been switched to at-camp (bulk-signing in leaders and
some students who then signed in for real testing) and back to pre-camp — but `setMode` only
ever handled the forward transition, so everyone who was `atCamp` stayed stuck at
`lifecycle:'arrived'`/`atCamp:true` even in pre-camp mode, invisible to every screen that reads
the registrants view (`lifecycle==='registered'`). `npm run typecheck` clean, `npm run test` =
444 pass (2 new), SPA `node --check` OK. No migration.

- **`admin.service.ts` `setMode` now reverts on at-camp -> pre-camp.** Mirrors the existing
  forward bulk-sign-in: anyone still `atCamp` (any kind, not just leaders — a student who
  individually signed in during at-camp testing has the same problem) is force-set back to
  `lifecycle:'registered'`/`atCamp:false` with an audit `SignOutEvent` appended (reason "Camp
  mode reverted to pre-camp"). This bypasses `withSignEvent`/`applyCheckIn` deliberately — the
  presence model has no normal transition back to `'registered'` (arrived/checked_out only
  cycle between each other), so a direct field assignment is the only way to undo the forward
  bulk transition. Already-cancelled or already-checked-out people are untouched. **One-off
  prod data correction** applied the same revert directly via SQL to the 10 leaders + 15
  students already stuck this way (same ids, `sign_out_history` audit rows added to match what
  the code now does automatically).
- **`switchMode()` (SPA) warns before reverting to pre-camp** — the confirm dialog now says
  anyone currently signed in at camp will be automatically signed out.
- **Budget now includes arrived leaders/students.** `RENDER.budget` only fetched
  `/registrants` — same gap as the Data tab fix above. Now merges `/campers` in (deduped by
  id, same pattern). `CamperDto` gained `registrationCost`/`discountCode`/`discountAmount` so
  a merged-in camper row prices and discount-codes correctly (`registrationType` was already
  added for the Data tab's "Reg type" column — `exportBudget()` and the discount-codes card
  get this for free since they both read the same merged `window._budgetRegs`).

## Church home screen simplification — deployed 2026-07-06 (SPA-only)

Admin request, church role only, both modes. No backend/schema change.

- **At-camp: Notices tile removed from church home.** `renderHomeAtCamp`'s tile-building now
  excludes `ACTOR.role==='church'` from the Notices quick-tile (mirrors the existing
  director exclusion) — church still reaches Notices via its bottom-nav tab, just not as a
  home tile.
- **Pre-camp: tent/classroom breakdown replaced with two simple tiles for church.** The
  "Registrations by accommodation" 4-tile band (Student/Leader × Tent/Classroom,
  `statband-4`) is now conditional on role — church instead gets a plain 2-tile
  `.statband` ("Students" / "Leaders", from the already-scoped `h.totalCampers`/
  `h.totalLeaders`); zoneLeader/director/admin are unchanged. The existing "Your
  registrations" total card just below (with its own "X campers · Y leaders" sub-line) was
  left as-is — not explicitly in scope.

## UI fix — Data Import "Confirm" button overwide on phone — deployed 2026-07-08

**SPA-only** (`public/index.html`), no backend/schema change. `_renderAllocCards` (Data Import →
"Unallocated registrants" card): the per-person church `<select>` (`style="flex:1"`) sat next to a
plain `<button class="btn">Confirm</button>` inside a `.rowsb` flex row. `.btn`'s base CSS is
`display:block;width:100%`, and inside a flex container an unconstrained `width:100%` becomes the
item's flex-basis — so the button claimed almost the whole row and squeezed the `<select>` down to
just its native dropdown arrows on a narrow phone screen. Fixed with an inline override on that one
button (`style="width:auto;flex:0 0 auto;margin-top:0"`) so it sizes to its own content and the
church picker gets the space. `sw.js` `camp-v20`→`camp-v21` (HTML changed).

## At-camp leader UX consolidation — deployed 2026-07-17

Collapsed the at-camp leader's three near-identical "find a person" surfaces into two, and
unified Day-1 arrival sign-in into the daily Check-in surface. Design:
`docs/superpowers/specs/2026-07-16-at-camp-leader-ux-consolidation-design.md`; plan:
`docs/superpowers/plans/2026-07-17-at-camp-leader-ux-consolidation.md`. `npm run typecheck`
clean, `npm run test` = **482 pass**. `sw.js` `camp-v24`→`camp-v25`. **Migration `0005`.**

- **Unified Sign-in/Check-in entry.** One nav id (`checkin`), phase-branched:
  `campPhase()` (new helper, near `_realCampDayNumber`) returns `'signin'` on Day 1 before a
  settable switchover time, else `'checkin'`. `RENDER.checkin` is now a thin wrapper that
  branches to `_renderArrival()` (the old `RENDER.firstday` arrival flow, redirected into the
  `checkin` screen via a module-level `_fdScreen` var so `fdDraw` can target either screen) or
  `_renderDailyCheckin()` (the original `RENDER.checkin` body, renamed). Nav tab label/icon
  ("Sign-in" vs "Check-in") derive from phase via a `_ci()` helper in `navModel`. New
  `CampSettings` fields: `checkinSwitchoverTime` (`'HH:MM'`, default `'14:00'`) and
  `checkinPhaseOverride` (`'auto'|'signin'|'checkin'`, default `'auto'`) — admin-editable in
  Camp Settings (`stSwitchover`/`stPhaseSeg`/`setPhaseOverride`, confirm-gated when forcing away
  from Auto since it flips every live session's entry).
- **Students tab** (`RENDER.students`, replaces the at-camp Search tab for
  church/zoneLeader/director/admin — **first-aid's own `search` screen is untouched**). A `.seg`
  control hosts **My group** (default — ex-`RENDER.myyouth`/`filterMyYouth`, now grouped by
  church for zoneLeader) and **Other churches** (ex-`RENDER.search`'s masked-contact lookup, now
  `_renderOtherChurches`). `TAB_OF` maps `camper`/`myyouth`→`students`, `firstday`→`checkin`.
  `RENDER.myyouth`/`_renderMyGroup` are kept (the legacy `myyouth` screen/home tile are gone, but
  the function is harmless dead code, same pattern as other superseded renderers in this file).
- **4-tile church-leader home.** `renderHomeAtCamp` caps the church role at exactly 4 tiles
  (unified entry, Submit Testimonies, Schedule, Devotional); "My Youth Details" tile removed
  (→ Students tab); "Your Accommodation" demoted to a one-line hero strip; "Testimonies & Notes"
  demoted to a bold slim link below the grid. Other roles keep their existing extra tiles
  (Notices/Data) — the 4-tile cap is church-specific, not global.
- **Double-tap-to-open-profile bug: investigated, does NOT reproduce, no fix applied.** The
  spec's hypothesis was that `openCamper` never claims `_navId`/`_navToken`, so a list screen's
  stale-while-revalidate refetch finishing after it calls `paint()`→`_showScreen(list)` and
  steals focus back. Confirmed half the hypothesis (`openCamper` genuinely never claims the nav
  token) but disproved the other half with a live repro harness (patched `api()` to delay the
  My-group list's background `/campers` refetch by 1.5s, called `openCamper` mid-delay, checked
  `document.querySelector('.screen.active')`): the profile stayed open throughout. Reason — the
  Students-tab refactor above (`_renderMyGroup`/`_renderStudentsBody`) writes the post-fetch list
  content via a direct `element.innerHTML=` assignment instead of a second `paint()` call, and
  `paint()` is the only thing that calls `_showScreen()`. No second paint → nothing left to steal
  focus. If this class of bug resurfaces (e.g. a future list refactor reintroduces a second
  `paint()` call), `openCamper` claiming `++_navToken; _navId='camper'` before painting is the
  known-good fix (same pattern as the earlier first-aid `_faScreen()` fix) — just not needed today.
- **Migration `0005` reconciliation (branch predated the 2026-07-16 consolidation).** This work
  started on a branch cut before "Migration files consolidated" (above) landed on `master` — its
  migration was originally authored as `024_...` against the old `001`-`023` numbering, and its
  backend changes (settings entity/repo/schema/seed/tests) were written before `master`'s
  `tentPrice`/`classroomPrice` removal. Reconciled by merging `origin/master` into the feature
  branch before merging to `master`: renumbered the migration file to `0005_...`, resolved 2 trivial
  test-fixture conflicts (both sides touching the same settings-literal line), verified
  `tentPrice`/`classroomPrice` fully gone and the new fields intact, then re-ran the full gate.
  **Applying the migration via the Supabase MCP tool records the history row under a generated
  timestamp version, not the file's `0005`** — breaks the clean sequence the consolidation
  established, so a follow-up `update supabase_migrations.schema_migrations set version='0005'
  where version='<generated timestamp>'` is required after every `apply_migration` call on this
  project until/unless the tooling is changed to accept an explicit version.
- **Deploy note:** the GitHub→Vercel webhook did not pick up this push for several minutes (no
  BUILDING deployment appeared); `vercel deploy --prod --yes` was used as a manual fallback and
  hit a transient `ECONNRESET` on the first two attempts (ended up moot — the git-triggered
  deployment eventually landed on its own, confirmed by `source:"git"` on the ready deployment,
  not `"cli"`). If this recurs, checking `mcp__plugin_vercel_vercel__get_deployment` on the
  `-git-master-` alias is the fastest way to tell whether it's actually stuck or just slow.

## Feature batch — gender accounts, incidents, initials, passwords + bug fixes — 2026-07-17

Large admin-requested batch (7 features + 3 bugs), built by parallel subagents then hardened by
three code-review passes. **Migrations `0006`/`0007`/`0008` applied to prod** (additive; history
reconciled to `0001`–`0008`). `sw.js` `camp-v25`→`camp-v26`. `npm run typecheck` clean, `npm run
test` = **533 pass**. Verified end-to-end against a running instance (incident isolation, export
RBAC, gender-account creation, password export, parent-mask, login-form attrs).

- **Feature 2 — gender-scoped church logins (`b-`/`g-`).** Every church now has **two** logins:
  `b-<slug>` (scoped to the church's **male** students **and** male leaders) and `g-<slug>`
  (female). `users.gender_scope` (`'male'|'female'|null`, migration `0006`) rides the session
  `Actor`; enforced in **one place** — `canAccessPerson` (`person.service.ts`) narrows by gender,
  and every read path (registrant list incl. the `?churchId` fast-path, roster, search,
  dashboard, accommodation) funnels through it. `createChurchWithAccount` creates BOTH accounts;
  `splitChurchAccounts` (idempotent) back-fills + retires the legacy combined login;
  `scripts/split-church-accounts.ts` + `POST /accounts/churches/split` expose it. **Scope rule:**
  only a person of the *concrete opposite* gender is denied — someone recorded `'other'` or with
  an unset gender is visible to **both** logins so no minor is left without a custodian (review
  Finding 3). A church login also **cannot reassign a person's church/gender/zone** via PATCH, and
  `update()` re-asserts scope on the patched result (fail-closed, Finding 4). Legacy accounts /
  non-church roles have `gender_scope=null` = see all genders.
- **Feature 6 — memorable randomised church passwords + export.** `src/utils/memorable-password.ts`
  → `Word.###` (capitalised noun + 3 digits, e.g. `Donkey.683`; ≥6 chars — widened from the
  original `Word.##` 2-digit form on 2026-07-31, ~11.7k → ~117k keyspace; existing hashed
  passwords stay valid, only NEW ones use the wider form). Auto-generated on
  church-account creation AND re-generated for ALL church logins by an admin **"Randomise & export
  church passwords"** button (`POST /accounts/churches/randomize-passwords`, **admin-only**) that
  also splits/retires legacy logins and returns `{username,church,gender,password}` rows the SPA
  downloads as CSV. `mustChangePassword` is deliberately **never** set (these are the real handed-
  out passwords). ⚠ Keyspace is small (~10k) — mitigated by the login rate-limiter; fine for a
  short-lived camp, revisit if longer-lived (review Finding 5).
- **Feature 3 — Incidents.** `Incident` entity + `incidents` table (migration `0007`); `summary`
  is **encrypted at rest** (AES-256-GCM envelope in `supabase.incidents.ts`, exactly like
  `notes.body` — child-safety data). New `incident:manage` capability = **zoneLeader + director +
  admin** (post AND view; delete = admin/director only). Home tile + `RENDER.incidents` (summary
  textarea + low/high toggle + newest-first list). **Low** = recorded only; **high** = also raises
  an **urgent notification carrying the summary** to all zone leaders/directors/admins. That
  notification is **leaders-only** (`Notification.leadersOnly`, migration `0008`): filtered out of
  church/firstAid feeds in `notification.service.getActorFeed` **and** the duplicate filter in
  `dashboard.service` `latestNotification` (Finding C), and its **body is encrypted at rest** in
  `supabase.notifications.ts` when `leadersOnly` (Finding B — the summary must not sit plaintext in
  `notifications.body`). Incidents also appear as an **"Incidents" option in the Notes-page
  Record-filter** (read-only, leadership only) and get their own **sheet in the audit workbook**.
- **Feature 4 — leader initials + audit capture (church accounts only).** After login a church
  account (incl. `b-`/`g-`) is prompted (skippable) for the leader's initials, stored per-account
  in `localStorage['ycp_initials_<username>']`, shown as a header `✎` badge, and used to seed the
  existing `LAST_LEADER` prefill (sign-in/out + note forms). Initials ride existing fields into the
  audit trail — `CheckInEntry.leaderId` (daily check-in), `SignOutEvent.leaderName` (sign-out) —
  and surface as a **"Leader Initials"** column in the export. **Reveals now log for real:**
  medicare + masked-contact reveals emit an `[audit]` log line with actor id + initials (Finding
  D — previously they returned `revealedBy` but recorded nothing; this app has no reveal-audit
  table, the log line IS the trail). **No migration** (reuses existing fields).
- **Feature 1 — preview auto check-in (SPA, client-side only).** In the 👁 at-camp preview overlay
  (`PREVIEW_MODE`) while the real mode is pre-camp, everyone-except-a-deterministic-5 shows as
  checked in so the roster + Students list look populated. Simulation lives at the read/render
  boundary — `_previewSimActive`/`_previewCanonicalPeople`/`_previewNotCheckedInIds` (last-5 by
  surname, floored to 0 for ≤5-person camps)/`_previewIsPresent`/`_previewLocalFlips` — and is
  applied consistently to the roster, the My-group/Students list, AND `openCamper`'s presence
  render (so drilling in doesn't contradict the row). Check-in taps flip **locally only** (no
  `CHECKIN_QUEUE`, no false "didn't save" banner). **Never fires a network write** (the `api()`
  `PREVIEW_MODE||ACCOUNT_PREVIEW` guard remains the backstop).
- **Feature 5 — iOS PWA login autofill.** The login card is a real `<form id="loginForm">`
  (submit → `doLogin()`), username has `autocomplete="username"`+`autocapitalize="none"`, password
  `autocomplete="current-password"`+`type="password"`, both with stable `name`. Enables iOS
  Keychain autofill of a saved credential (device-only to fully confirm).
- **Feature 7 — setup wizard.** The separate Schedule/FAQ/Devotionals steps are merged into ONE
  **"At Camp Info"** step (`go('atCampInfo')`, done = any of the three has content) — **8 steps**
  now. Each step's `helpTip` tooltip is replaced by a plain **one-sentence summary** line.
- **Bug 1 — first-aid contact masking swapped.** The **leader** number now shows **plainly**
  (`resolveContacts` returns it unmasked, no reveal); the **parent** number is masked behind the
  audited reveal (`revealContact(…, 'parent')`, gated `camper:read:sensitive`). Crucially the
  parent phone is also masked in the **`/campers` DTO for the firstAid role**
  (`camper.controller.maskParentForFirstAid`) so it isn't returned in cleartext at all (Finding 1
  from the SPA review — the reveal would otherwise be illusory). Other roles' parent contact is
  unchanged.
- **Bug 2 — accommodation override applies to leaders too.** The church accommodation override now
  forces **everyone** in the church (students AND leaders) on **all** paths — Form import
  (`import.service`), Ticket-List import (`ticket-import.service`), and manual allocation
  (`accommodationKindForChurch` in `church-allocation.ts`, used by `allocation.service`). The
  earlier commit only fixed the Form path (review Finding 3).
- **Bug 3 — bottom white bar.** `.tabs` reserved the full `env(safe-area-inset-bottom)`; reduced to
  `calc(2px + env(safe-area-inset-bottom) * 0.15)`. CSS-only — eyeball on a home-indicator phone.
- **New capability `export:compliance` (director+admin).** The camp-wide compliance exports (master
  audit workbook + sign-in/out + check-in CSV, `audit-export.service`) were gated on
  `camper:read:sensitive`/`camper:read`, which **church/zoneLeader hold** — so a church login could
  download the whole workbook (all-zone PII, notes, incidents, temp passwords). Now gated on the
  new `export:compliance` capability (review Finding A — a pre-existing hole the Incidents sheet
  widened).
- **Rollout note for existing prod churches — DONE.** The code + migrations deployed, and the
  admin ran **"Randomise & export church passwords"** on 2026-07-17/18: all 5 real prod churches
  are split into `b-`/`g-` logins (10 accounts, 0 unsplit), the legacy combined logins retired,
  and the CSV distributed.

## Follow-up fixes — 2026-07-17/18 (post-deploy)

Two admin-reported issues after the batch above went live, root-caused against real prod data
(Supabase `nwfafrgojqkxylbppywo` queries, not guesswork) and a live browser repro. `sw.js`
`camp-v26`→`camp-v27`→`camp-v28`. `npm run typecheck` clean, `npm run test` = 533 pass throughout.

- **"Randomise & export passwords" showed 'network error' after a successful export (commit
  `7660ad6`).** Root cause: the operation had actually **succeeded** — prod evidence at the time
  showed all churches already split with 0 unsplit accounts, and the admin's downloaded CSV was
  the real, valid output. The error came from `_rAccts()` (a cosmetic accounts-list refresh)
  running *inside the same `try`* as the export and failing transiently, making a fully
  successful randomise look broken. `randomizeChurchPasswords()` now downloads the CSV
  **first** — that response is the only copy of the new passwords, so nothing after it can mask
  or override a successful export — and the refresh failure is now swallowed separately.
- **Incidents screen was completely blank (commit `7660ad6`).** Root cause: the Feature 3 batch
  added `RENDER.incidents` + the home tiles but never added the screen's DOM container — the
  shell pre-declares a fixed set of `<section class="screen" id="…">` divs (see "Frontend files"
  below) and there was **no `id="incidents"`**. `paint`/`_showScreen`/`_spinner` all silently
  no-op when `getElementById(id)` is null, so the form/list/buttons rendered into nothing. Fixed
  by adding `<section class="screen" id="incidents">` to the shell. This had shipped undetected
  because unit tests don't touch the DOM — **caught only by a live browser check**, which is why
  a redeploy affecting the SPA should get at least one visual smoke pass when the Chrome
  extension is available, not typecheck/test alone.
- **Incidents access briefly restricted to at-camp only, then reverted (commits `7660ad6` →
  `756c7b1`).** The same commit that fixed the blank screen also added a `CAMP_MODE!=='at-camp'`
  gate to `RENDER.incidents` (an admin request: "the incidents menu shouldn't be available
  pre-camp mode") plus removed the pre-camp home card. This turned out to be **too broad**: the
  real prod camp was still pre-camp (camp dates are 2026-09-28–10-01), 2 real incidents had
  already been logged pre-camp before the gate landed, and **zoneLeader/director have no other
  console** to reach the Incidents screen from — so the gate made any pre-camp incident
  permanently unreviewable/undeletable until the mode switch, a safeguarding dead-end. Reverted:
  `RENDER.incidents` is **role-gated only** (`canManageIncident()`, unchanged from the original
  design) and the pre-camp home card is back. The literal "shouldn't be available pre-camp"
  request is not implemented as full lockout — flagged to the admin as a deliberate trade-off
  (declutter vs. safeguarding accessibility); revisit if a lighter-touch decluttering (e.g. a
  settings-page link, matching the Notices/Data-Import precedent below) is still wanted.
- **"Testimonies & Student Notes" renamed to "Testimonies & Notes"** (`RENDER.notes`'s `paint()`
  title, commit `756c7b1`) — admin-requested, cosmetic only.

## Testimonies & Notes — incident severity badge + zone accent — deployed 2026-07-18

Admin-requested 2-item batch (leadership screen only — admin/director/zoneLeader; church doesn't
reach this screen's incident view since `incident:manage` excludes church). **SPA-only**
(`public/index.html`), no backend/schema change (both `severity` on `Incident` and zone data were
already present, just not surfaced/joined here). `npm run typecheck` clean, `npm run test` = 533
pass. `sw.js` `camp-v28`→`camp-v29`.

- **Incident low/high badge.** `drawNotes`'s `badge()` (previously a flat `<span class="pill
  warn">Incident</span>` for every incident record) now reads `n.severity` — **"Incident · High"**
  keeps the alarming red `pill warn`, **"Incident · Low"** downgrades to the calmer amber `pill
  amb`. `severity` was already threaded onto the synthesised `incidentRecs` in `RENDER.notes`
  (`cat:'incident',severity:i.severity,...`) from `GET /incidents` — it just wasn't read in the
  badge. `badge()` now takes the whole record `n` instead of just the category string `c` (call
  site: `badge(n)`, not `badge(c)`).
- **Zone colour accent (left edge).** New `ZONE_COLORS` (mirrors `ZONES`/backend `ZONE_NAMES` —
  the zone names literally ARE colours: `Yellow #eab308`, `Blue #4f46e5`, `Black #1e1a3a`, `Red
  #e11d48`) + `zoneAccentStyle(z)` helper, both near the `ZONES` const (~line 804). Each record
  card in `drawNotes` gets an inline `style="${zoneAccentStyle(n.zone)}"` — a 4px `border-left`
  in the zone's colour, same visual pattern `.ncard` already uses for its urgent/zone accents.
  **Zone resolution, in order:** (1) the attached student's zone (`n.camperId` → `cmap` from the
  already-fetched `/campers` join — unchanged); (2) for a camper-less general note/testimony,
  the zone of the church that logged it — `RENDER.notes` now also fetches `GET
  /accounts/churches` (role-scoped, safe for every role that reaches this screen) and builds
  `churchZoneById`, looked up via the note's `authorChurchId` (only set when the author is a
  `church` role — `note.service.ts`'s `authorChurchId: actor.churchId`); (3) no student, no
  resolvable church (e.g. a general note logged by a director/admin/firstAid/zoneLeader, or an
  incident with no `zone` set) → **no accent**, plain card, "zone-agnostic" by design.
  `signedOut`/`incidentRecs` already carried their own `zone` field unchanged (student's zone /
  the incident's own `zone`, respectively) — only the general-note fallback path is new.
  **Gotcha avoided:** the new churches fetch in `RENDER.notes` must NOT be named `churches` — a
  local `const churches` (the distinct church-name list for the Ministry filter dropdown) is
  already declared later in the same function; the fetched array is named `churchRows` instead.

## Frontend fixes batch — two-pass UX review — deployed 2026-07-19

Two independent frontend reviews (own pass + a blind second-opinion subagent, combined into
one published artifact) produced 14 findings, prioritised Now/Next/Later. Plan written to
`docs/FRONTEND-FIXES-PLAN-2026-07-18.md` before implementation; owner pre-authorized the full
batch (all 3 tiers) including deploy, so this shipped in one session rather than the usual
review-then-approve cadence. **SPA-only** (`public/index.html`), no backend/schema change.
`npm run typecheck` clean, `npm run test` = 2132 pass. `sw.js` `camp-v29`→`camp-v30`.
Multiple pieces were built in parallel by isolated Sonnet subagents (git worktrees, merged
sequentially to avoid stomping each other in this single 4,800-line file) — see the commit
history on the (now-merged, deleted) `frontend-fixes` branch for the individual subagent
commits if you need the granular diffs.

- **Grade null bug.** `'Grade '+p.grade`/`'Grade '+s.grade` (Student Info + My Youth heroes,
  the two highest-traffic profile screens) now guard with `||'—'`, matching the pattern already
  used elsewhere in the file.
- **Check-in session picker overflow.** `#dayseg` (the twice-daily session picker — 8-13
  buttons on a normal 5-7 day camp, not the 4-day/6-session test camp this was originally
  missed on) now scrolls + snaps instead of squeezing labels unreadable past ~6 sessions.
- **First Aid alert-box severity was backwards.** "No medical conditions" (reassuring) used to
  render in the same loud amber `.fa-alert` box as a real medical flag; "no leader contact on
  file" (the actually actionable gap) rendered in the quiet `.fa-lead` card. Swapped: reassuring
  cases now use a new `.fa-neutral` shell (same box as `.fa-lead`, generic name since it's not
  leader-specific); "no leader contact" now uses `.fa-alert`.
- **3 highest-blast-radius `confirm()`/`prompt()` sites → in-page modal** (`switchMode`,
  `adminReset` full-wipe, `doNewYear` rollover) — the app's own `.sheet`/`#modal` system was
  already good where used (Account Preview), native dialogs block the JS thread and one was
  confirmed to freeze a tab solid during testing. `adminReset`'s type-to-confirm text ("I
  understand this cannot be undone") now lives in the modal with a disabled-until-exact-match
  button, mirroring the close-out screen's existing 3-checkbox pattern. `doNewYear`'s
  `confirm()` was **deleted outright, not modalised** — its only caller (`RENDER.adminCloseOut`)
  already gates the trigger button behind those same 3 checkboxes, so the native dialog was
  pure redundancy. The other 13 `confirm()`/`prompt()` call-sites in the file are unchanged
  (out of scope by design — see the plan doc for the full list).
- **First Aid "All Students" no longer requires picking a church first.** `RENDER.allstudents`
  renders the full camp-wide roster on open (church/zone[new]/gender/grade all optional
  filters now, church no longer a prerequisite). **No pagination/virtualization added** — this
  app has no lazy-render pattern anywhere else, and a flat `.map().join('')` of a few hundred
  simple rows is expected to be fine; flag it if a real 400+-person camp shows jank on-device,
  it's an easy follow-up if actually needed.
- **Design-token dedup pass.** ~35 of the ~200 hardcoded hex-color/font-size literals scattered
  through the JS template strings were tokenized onto existing `--root` tokens — deliberately
  conservative (pure 1:1 value substitution only; ambiguous near-matches were left alone rather
  than force-mapped, to guarantee zero rendering change). "Not on site" pill now uses the
  existing `.pill.warn` modifier instead of a hand-rolled inline style.
- **Mode-switch now announces itself.** `_applyModeChange()` (the function both the cross-tab
  `storage` listener and the on-refocus `visibilitychange` handler funnel through) used to
  update the UI silently; it now toasts "Camp switched to At Camp/Pre-Camp mode". The function's
  existing `mode===CAMP_MODE` guard already means it only ever runs on a genuine change, so no
  separate one-time/dedup flag was needed.
- **Two review findings turned out to be non-issues on investigation** (documented rather than
  silently dropped, since the original report is still published and shouldn't be treated as
  gospel by a future session): (1) the review's "unify the two day computations" concern —
  `_realCampDayNumber()` (real at-camp) vs `SETTINGS.campDay` (the `PREVIEW_MODE`-only manual
  toggle) are deliberately separate, already documented at their declaration, and never both
  active at once — no drift risk. (2) the review's "add optimistic UI to check-in" — check-in
  already has a full optimistic-update implementation (`CHECKIN_QUEUE`, `drainQueue`,
  `_optimisticState`, a failure-retry banner, a 4s undo window — see the `B-1`-tagged comments),
  added in an earlier batch after the review's source material was written.
- **Also fixed while auditing error states:** 4 genuine fetch-failure `catch` blocks (`_navTo`,
  `RENDER.allstudents`, `RENDER.records`, `offlineSignInUpload`) were using the muted
  `.note-hint` style instead of the alarm-styled `.err` class. **Correction to the original
  finding:** `.err` turned out to be used *only* by the two login-form errors before this,
  not an established general-error system app-wide — so this was a small, targeted extension of
  `.err`'s usage, not a "restore consistency" fix. `.err` defaults to `display:none` (built for
  the static login-error divs, toggled via JS) — the 4 new usages needed an explicit
  `style="display:block"` since they're freshly-created elements, not toggled ones.
- Admin console tile grouping and the check-in tab id/label drift were **documented, not
  changed** (both were explicit Now/Next-tier decisions to leave alone — see the plan doc).
- **Deliberately out of scope for this session:** live browser/device testing — the owner is
  doing a manual phone pass themselves afterward, specifically on the session picker at 8+
  sessions, the full unfiltered 400+-entry roster, the First Aid alert box, and the new
  confirm-modal flow (see `docs/FRONTEND-FIXES-PLAN-2026-07-18.md`'s checklist).

## UI/bug batch — incident alerts, overlay stacking, preview phases — deployed 2026-07-26

Admin-requested batch of 10 items from a phone pass. **SPA-only except one backend one-liner**
(`dashboard-cache.ts`) — no schema/migration change. `npm run typecheck` clean, `npm run test` =
**580 pass** (+1 new regression test), SPA `node --check` OK. `sw.js` `camp-v43`→`camp-v44`.
Two design/assessment docs were produced alongside and are NOT implemented — see the bottom of
this section.

- **Light-purple bar under the bottom nav / login card (screenshots 1, 2, 8).** The CANVAS
  background paints the strip below the body box that iOS briefly exposes when the dynamic toolbar
  retracts or the keyboard dismisses (it vanishes on the next scroll — exactly the reported
  symptom). `html` had no background, so the canvas inherited `body`'s `--paper` and that transient
  strip read as a light-purple bar under the near-white nav. **`html{background:#fff}`** stops the
  propagation; `body` keeps `--paper` for the app column. Accepted side effect: the letterbox
  either side of the capped `.app` column between ~540–980px is now white. At ≥980px `#app` is
  `max-width:none` so nothing changes there. Supersedes the 2026-07-24 Follow-up 3 reasoning (the
  light body background was necessary but addressed the *black* bar, not this one).
- **Deleted incident stayed on screen until reload.** `_invalidate()` had no `/incidents` branch,
  so a `DELETE /incidents/<id>` fell through to the generic `Cache.del(path)` — which only matches
  keys equal to or *under* `/incidents/<id>`, leaving the cached `/incidents` LIST key intact for
  the 30s TTL. Added `else if(path.startsWith('/incidents'))Cache.del('/incidents','/notifications')`.
  **Notices were checked and are fine** (`/notifications/<id>` already hits a prefix branch), but
  **`/faq/<id>` had the identical latent bug** and got the same treatment. ⚠️ GOTCHA for future
  endpoints: any write to `/<resource>/<id>` needs an explicit `_invalidate` branch naming the
  collection key — the fall-through does NOT clear the list.
- **Incident alerts: full-screen modal → compact Home banner.** The "Incident logged" bottom sheet
  fired on **every** app open and was disruptive. Now: **`leadersOnly`** (set by exactly one code
  path — `incident.service.log`; every other notification is created `leadersOnly:false` — so it is
  a reliable incident marker with no schema change) drives a new `_isIncidentNotice()`. New helpers
  `_noticeFeed()` / `_urgentAlerts()` / `_alertBannerHtml()` / `_ackAlert()` + `.inc-banner`
  CSS. A red, left-accented strip sits **above the hero on Home** (both pre-camp and at-camp — the
  pre-camp variant matters, incidents have been logged pre-camp), one row per unacknowledged high
  incident, tap the text to open Incidents, "Got it" to acknowledge. **Acknowledgement is per
  device** (`localStorage`, reusing the existing `_DISMISS_KEY` store) — owner chose this over a
  server-side per-user ack table; a leader on a second device or after clearing site data will be
  alerted again. **Incident notices no longer appear in ANY notice list** — filtered out of the Home
  notices AND `RENDER.notifs` (owner decision). The backend still creates the notification: it is
  what the banner reads, and the push design hangs off the same record. **Deliberately unchanged:**
  a genuine human-sent urgent notice still pops the modal (`_checkUrgentNoticesFromFeed` now
  excludes incidents only) — that is a director choosing to interrupt everyone.
  **↑ SUPERSEDED SAME DAY (`camp-v44`→`camp-v45`): the bottom sheet is GONE entirely.** Keeping the
  modal for human-sent urgent notices meant Home could show an alert banner at the TOP *and* a
  sheet at the BOTTOM at the same time (reported immediately on an at-camp preview: prod has both
  a `leadersOnly` "Incident logged" AND a non-incident urgent "Scheduled 1" live). There is now
  exactly **ONE alert surface**: `_urgentAlerts`/`_alertBannerHtml`/`_ackAlert` render EVERY
  unacknowledged urgent notice — incident or human-sent — in the top banner, with the row's tap
  target routing by kind (incident → Incidents screen, else → Notices). `_checkUrgentNoticesFromFeed`,
  `checkUrgentNotices` and `_ackUrgent` are **deleted**. ⚠️ Do NOT reintroduce a blocking dialog for
  notices — that is the exact complaint this replaced.
- **Home notices = the 3 most recent REAL notices** (`_noticeFeed(feed).slice(0,3)` on both home
  variants; both already sliced to 3, the bug was incidents eating the slots).
- **Bottom sheets were rendering UNDER the bottom nav** (screenshots 5 "Switch to At-Camp" and 7
  "Bulk Church Update" — both had their primary button hidden). `.tabs` is `z-index:100`; `.modal`
  was **50**, `.ig-wrap` 55, `#login`/`#mcpGate` 60 — all below it. New documented ladder:
  **nav 100 < modal/guide 120 < toast 130 < login/gate 140 < tooltip 200 < undo toast 9999.**
  ⚠️ GOTCHA (now recorded in the CSS): a full-viewport overlay must be `position:fixed` **AND**
  above 100. This is the companion rule to the 2026-07-24 Follow-up 7 `absolute`→`fixed` sweep.
- **Schedule editor rows compacted.** The 7 default empty rows per day inherited full-size `.fld`
  padding/type (sized for one-per-line form fields, not a dense repeating grid). `.sched-row .fld`
  now has its own tighter padding/font/radius; time column `86px`→`80px` (header grid updated to
  match — they must stay in sync).
- **Camp settings short fields capped.** `.setg input[type=time|date|number]{max-width:190px}` —
  a "6:00 am" value no longer sits in a phone-width box. Free-text fields (camp name) unchanged.
- **Notices subtitle showed a literal `&amp;`.** `_paint` sets the title/subtitle via
  **`.textContent`**, so an HTML entity is never decoded. `'Camp &amp; zone updates'` → `'Camp &
  zone updates'`. The other ~20 `&amp;` occurrences are inside `innerHTML` strings and are correct
  — only `paint()`'s 3rd/4th args must use a bare `&`.
- **Send-a-notice: Normal vs Urgent tooltip.** `helpTip` beside the Priority label explaining that
  Urgent additionally pops a full-screen alert on next open.
- **At-camp preview: Day 1 / Day 2 toggle → Sign-in / Through camp.** `SETTINGS.campDay` and
  `switchDay()` are **gone**, replaced by an in-memory `_previewPhase` + `switchPreviewPhase()`.
  Rationale: the two things worth rehearsing are the two FACES of the check-in surface, and "Day 2"
  was a misleading proxy (it still ran through the switchover-time rule, and implied testimonies
  only open on day 2 — they are always open). `campPhase()` now returns `_previewPhase` outright in
  preview, ahead of both the time rule and the admin's saved `checkinPhaseOverride` (which belongs
  to the real camp). The header badge reads "Sign-in ›" / "Through camp ›" and toggles on tap. On
  Home, `isDay1` is forced true in preview so the First-Day button and the Daily Check-in tile are
  **both always rendered, one live and one greyed**; greyed-tap copy is preview-aware ("Tap the
  … badge up top"). Testimonies screen subtitle "Day 2+" → **"Open all camp"**.
- **`dashboard-cache.ts` `_actorKey` was missing `genderScope`** (the ONE backend change). Found by
  the launch-readiness pass below, then confirmed with a test that fails without the fix. `b-victory`
  and `g-victory` are both `role:church` with the same `churchId`/`zone`, so they **collided in one
  30s cache slot** — whichever fetched first seeded the other gender's dashboard figures. Counts
  only (no names/PII crossed) but still one gender's roster reported to the other custodian. Latent
  since Feature 2 / migration `0006` (2026-07-17). +1 regression test in `dashboard.service.test.ts`.
  ⚠️ Any future scoping dimension must be added to that key too.

**Two docs produced, NOT implemented (owner reviews before anything ships):**
- **`docs/superpowers/specs/2026-07-26-web-push-design.md`** — Web Push (PWA) via Vercel Cron,
  covering three triggers only: high-severity incidents, scheduled notices firing at their real
  minute (replacing today's lazy-fire), and check-in-window-closing warnings (the deferred item 10).
  Supersedes/absorbs `2026-07-23-web-push-design.md`. Includes the privacy assessment. Headline
  recommendation: **title-only payloads — a server-stored `body` never enters a push payload**
  (`notifications.body` is encrypted at rest when `leadersOnly`; shipping it to Apple to render on
  a lock screen would defeat that). Notes a real blocker: `HttpRequest` (`src/api/http/types.ts`)
  has **no `headers` field**, so a `CRON_SECRET`-guarded route cannot read `Authorization` today.
  Would need migration `0013`.
- **`docs/LAUNCH-READINESS-2026-07-26.md`** — assessment for the ~2026-08-05 launch to ~100
  leaders. Biggest finding: prod is still on the **transaction-mode pooler (port 6543)** with
  `max: 5` — the exact configuration behind YS Connection's multi-day outage at 30–40 users —
  and `docs/SESSION-MODE-CUTOVER.md` is written but marked not-yet-done. Compounding it,
  `getSessionStatus`/`/home`/`/registrants`/`/campers`/search **all** call `personRepo.findAll()`,
  and the SPA never passes `?churchId`, so the indexed fast-path is dead code in practice. 8
  BLOCKING items, most of them owner-side dashboard checks.

## Accommodation fold-in fix + override relocation — deployed 2026-07-20

Admin-requested batch of 3 items, found while testing against a realistic sample data set
(`../Sample Data New/*-2026-07-16-v2.csv`) where **no church cleared the 75% classroom
threshold**. **SPA + backend** (`src/services/accommodation-allocation.ts`), no schema/migration
change. `npm run typecheck` clean, `npm run test` = 554 pass (3 new
`accommodation-allocation.test.ts` cases).

- **Root-cause bug (this is what broke "girls' leader counts"):** a church under the 75%
  classroom-eligibility threshold got **no classroom group** (correct, unchanged), but its
  classroom-*preference* people were never folded into Tent City either — `tentDistribution`
  only counted a literal `accommodationKind==='tent'`. With the realistic sample data (every
  church landed 31–67%, well under 75%), this meant every church's classroom-preference people —
  students **and leaders**, both genders — were invisible on the whole Accommodation Allocations
  screen. Confirmed against the real sample: 10 of 12 imported leaders were female, several
  classroom-kind, and they simply didn't appear anywhere until this fix.
  - Fix: `isEligible`/`tallyChurches` (backend) is now the single eligibility check shared by
    `computeGroups` (unchanged behaviour — still excludes ineligible churches from classroom
    groups) and `tentDistribution`, which now folds in anyone whose personal
    `accommodationKind==='classroom'` but whose church isn't eligible. SPA `tentDist` mirrors
    this exactly (calls `accomChurches` first for the eligibility check, same as
    `accomGroups` does). Verified end-to-end against the real sample data: every registered
    person now reconciles to either a classroom group or a tent count — zero silently dropped.
- **Pending-allocation table split.** The old single "Classrooms (Pending Allocation)" table
  mixed two different states (eligible groups still awaiting a room, and ineligible
  under-75% churches). `drawAccom` now renders two sections: **"Classrooms (Pending
  Allocation)"** (eligible-but-unplaced groups, plus anyone with no accommodation type
  recorded yet — also previously invisible) and a new **"Under 75% — Moved to Tents"**
  section beneath it, whose rows now say the person is counted in Tent City below rather than
  the old, inaccurate "not allocated". Tooltips on both headings (and the Tent City help
  tooltip) updated to match.
- **Ministry accommodation override relocated.** `Church.accommodationOverride` (tent/classroom/
  no override) used to be set inside the church's **Account Info** modal
  (`editChurchName`/`saveChurchName`). It's now a dedicated "Accommodation overrides" card on
  **Admin → Accommodation setup** (`RENDER.adminAccom`, `saveChurchOverride` — instant per-row
  save via the existing `PATCH /accounts/churches/:id` endpoint, no backend change). The Account
  Info modal shows a one-line pointer to the new location instead; the Accounts screen's
  Churches tooltip was updated to match.

## Overnight admin batch — items 1-9,11 — deployed 2026-07-23

Large admin-requested batch (SPA + backend + **migrations 0010 & 0011**, both applied to prod
before the code push). Design: `docs/superpowers/specs/2026-07-23-overnight-batch-design.md`.
`npm run typecheck` clean, `npm run test` = **577 pass**, SPA `node --check` OK. `sw.js`
`camp-v32`→`camp-v33`. **Item 10 (proactively warning churches ~1h before a check-in window
closes) + full Web Push are DEFERRED** to `docs/superpowers/specs/2026-07-23-web-push-design.md`
(a real scheduler + push infra this serverless app doesn't have yet).

- **Item 1 — iOS password save (best-effort).** `#loginForm` (already a real `<form>` submit with
  `autocomplete="username"`/`current-password`) gained an explicit `type="text"` username and, in
  `doLogin`, a feature-detected `navigator.credentials.store(new PasswordCredential(...))` (helps
  Chrome/Edge/Android SAVE the credential; **Safari/iOS has no Credential Management API** — there
  the native form-submit heuristic is the only lever, and autofill of an *existing* saved password
  is the reliable path). Not a guaranteed fix on old iOS.
- **Item 2 — session TTL 12h → 24h.** `auth.service.ts` `TOKEN_TTL_MS`. Comments updated in
  `auth.service.ts`/`rate-limiter.ts`/`express-adapter.ts`.
- **Item 3 — de-janked attendance workflow.** `signInConfirm`/`signOutConfirm`/`_doSignIn` now
  re-render the **originating list in place** (`_refreshAfterAttendance` — reads `STACK` top; only
  refreshes the profile when the action started ON the profile) instead of hopping to `openCamper`.
  A church leader signs a student in with **one tap** (`signInPrompt` → direct `_doSignIn`, no
  modal). `_invalidate('/attendance')` now also clears `/registrants`+`/campers` so the re-rendered
  list is fresh immediately (this is the "sign-in latency" item from PLANNED-IMPROVEMENTS).
- **Item 4 — flat grouped settings page.** `RENDER.adminSettings` rebuilt as collapsible `<details
  class="setg">` sections (Camp details & dates · Check-in & timing · Account access) with
  done-state pills; one Save button still writes everything (every input stays in the DOM). **The
  Notices card was removed from Camp Settings** (owner request) → Notices + Scheduled notices now
  live in a new **Communications** group on the admin console (`RENDER.admin`). The setup wizard is
  still reachable from the console but is no longer the primary settings surface.
- **Item 5 — no leader auto-check-in on mode switch.** `admin.service.setMode` no longer bulk-signs-
  in leaders on the pre-camp→at-camp transition. Leaders start `atCamp:false` and are signed in
  manually via My-group "Late arrivals" (existing path). The at-camp→pre-camp revert block and the
  practice-first-aid-note wipe are unchanged.
- **Item 6 — audit/exports sorted by date/time.** `audit-export.service.ts`: the Daily Check-in Log
  (workbook + `exportCheckInLogCsv`) is flattened across all people and sorted by `ci.timestamp`;
  Notes & Testimonies, First-Aid Records, and Incidents sheets sorted by `createdAt`. Sign-in/out
  timeline was already chronological.
- **Item 7 — enforced church initials.** `enforceInitials()` (non-dismissible, no Skip) runs at
  login + session restore for church accounts; `_ensureInitials()` guards the attributed writes
  (check-in, sign-in/out, first-day, note, testimony) as a backstop. Initials are **auto-applied**
  everywhere and **never requested per action** (the "Your name" fields on note/testimony/sign-out
  are hidden for church; sign-in is one-tap). The header ✎ badge (`promptInitials(true)`) is the
  quick-switch when a different leader takes the device. `LEADER_INITIALS` + per-account
  `localStorage['ycp_initials_<user>']` plumbing unchanged.
- **Item 8 — home First-Day Sign-In split from Daily Check-in.** `renderHomeAtCamp`: **First Day
  Sign In** is now a **wide button between the hero and the tiles** (Day-1 only; greyed once past
  the switchover), and **Daily Check-in** is the first **tile** (greyed during the sign-in phase).
  No more single tile that switches its own label. `openCheckinFace(face)` sets a one-shot
  `_forceCheckinFace` consumed by `RENDER.checkin` so an explicit tap opens the intended face while
  greying enforces the time gate. `.tile.tdis` / `.wide-signin` / `.btn.bdis` CSS; `_ampm()` helper.
- **Item 9 — scheduled notices (in-app, lazy-fire, NO cron).** `Notification.scheduledFor`
  (migration **`0010`**, `notifications.scheduled_for timestamptz`). A future-scheduled notice is
  withheld from **every** audience feed until `scheduledFor <= now` (`getActorFeed` filter) — it
  surfaces on the next feed fetch after that instant, no scheduler needed. New service methods
  `scheduled(actor)` (own if zoneLeader, all if director/admin) + `update(actor,id,input)`
  (`UpdateNotificationSchema`; creator or director/admin); `remove` widened so a creator can delete
  their own. Routes `GET /notifications/scheduled`, `PATCH /notifications/:id`. Supabase `save`
  on-conflict set list widened to persist edits. SPA: `RENDER.compose` gained a **When** (Send now /
  Schedule) segment + `datetime-local` (converted as **Brisbane UTC+10** via `_localInputToIso`);
  `RENDER.scheduled` lists/edits/deletes pending notices; reachable from Notices + the admin console.
- **Item 11 — church check-in hard AM/PM windows.** `CampSettings.checkinWindow{Am,Pm}{Start,End}`
  (**optional** fields, defaults 06:00/12:00/12:00/22:00; migration **`0011`** adds four `text`
  columns AND sets `church_checkin_time_restricted = true` for the existing prod row). Pure
  `allowedWindowSession(days,today,now,windows)` in `checkin-sessions.ts` returns the one session a
  church may write now, or **null** outside a window / on a non-camp day. `checkin.service`
  `assertSessionAllowed` rewritten to use it (church only; no-op unless restricted) with a clear
  `ForbiddenError`. `churchCheckinTimeRestricted` now **defaults ON** (seed.ts + the prod UPDATE);
  admin can edit the windows + toggle in the settings "Check-in & timing" section.

**Migration state:** prod now has `0010` + `0011` applied (verified: `notifications.scheduled_for`
present; four `settings.checkin_window_*` columns present; `church_checkin_time_restricted = true`).
The repo's `supabase/migrations/` holds `0001`–`0011`. Next future migration = `0012`.
(**Superseded — see the 2026-07-26 section below: the repo now holds `0001`–`0015`, prod is at
`0013`, and the next migration is `0016`.**)

## Small SPA fix batch + the web-push branch finally shipped — deployed 2026-07-27

**This is the release that actually put the 2026-07-26 web-push/launch-readiness work into prod.**
Everything described in the section above had been sitting unmerged on `feat/web-push-phase1-3`
(9 commits) while `origin/master` — and therefore production — was still at `369437c`. This release
applied migration `0015` to Supabase FIRST, then merged the branch plus four owner-requested SPA
fixes to `master`. `npm run typecheck` clean, `npm run test` = **634 pass / 48 files**, SPA
`node --check` OK. `sw.js` `camp-v48`→**`camp-v49`**. All four fixes are **SPA-only**
(`public/index.html`) — no backend, schema or migration change beyond applying `0015`.

> **Process lesson worth keeping:** CLAUDE.md described the 2026-07-26 batch in the past tense while
> none of it was on `master`. Prose in this file records what was *built*, which is not the same as
> what is *deployed* — when reloading context, check `git log origin/master..HEAD` before assuming
> a documented feature is live.

1. **Incidents is a menu TILE again; the ALERT BANNER is what moved.** The 2026-07-26 change
   (commit `6b454d6`, item 3) demoted the Incidents tile to a slim full-width link — a misread of
   the owner's request. Reverted: `canManageIncident()` pushes the tile back into the `.tiles` grid
   in `renderHomeAtCamp` and `incidentsLinkHtml` is deleted. What was actually meant to move is
   **`_alertBannerHtml(feed)`** — the red strip with the **"Got it"** acknowledgement button — which
   was at the very head of the Home markup and now renders **immediately above the "Notices"
   heading** near the bottom, on **both** home variants (at-camp `renderHomeAtCamp` and pre-camp
   `RENDER.home`). Note this moves *every* urgent alert, not just incident-raised ones — there is
   deliberately only one alert surface (see the 2026-07-26 notes), so human-sent urgent notices
   move with it.
2. **Testimony student picker = arrived students only.** `RENDER.testimonies` no longer merges
   `/registrants` into the dropdown — it reads `/campers` alone (which is `isCamper`, i.e.
   lifecycle ≥ `arrived`). **This deliberately reverses the earlier "CH-2" fix** that added
   pre-arrival youth because a church's list "looked empty". Someone who signed in and later
   signed out is still selectable (a testimony can be logged after they head home); someone who
   never arrived is not. The screen is only reachable from the at-camp home tile, so a
   sparse-looking list pre-camp is correct, not a bug. **Do not re-add the `/registrants` merge**
   without checking with the owner — it has now been flipped in both directions.
3. **All three Camp Settings sections start collapsed.** `RENDER.adminSettings`'s first
   `<details class="setg">` lost its hardcoded `open`. Cosmetic only — every input still lives in
   the DOM regardless of collapse state, which is exactly why the single `saveSettings()` PATCH
   still writes all of them (that invariant is load-bearing; don't "optimise" it by rendering
   section bodies lazily).
4. **The bottom-nav Check-in/Sign-in label now follows the phase.** `navModel._ci()` always
   computed the right label, but `buildTabs()` only ran at login and on a mode switch — so the tab
   froze at whatever phase was current when the session started and still read **"Sign-in"** after
   the app had moved into check-in. New **`_syncNavPhase()`** (declared beside `campPhase()`)
   caches the last-built phase in `_navPhase` and re-runs `buildTabs()` only on a real change.
   Called from `RENDER.home` (covers the Day-1 switchover time passing), `switchPreviewPhase()`
   (the preview toggle, which never rebuilt the nav at all) and `saveSettings()` (an admin pinning
   `checkinPhaseOverride`). `RENDER.home`'s `/settings` re-sync **also now adopts
   `checkinPhaseOverride` + `checkinSwitchoverTime`** — previously it copied only `campMode`, so an
   admin's phase change never reached an already-open session at all. The **desktop sidebar never
   had this bug** (`_renderWideNav` runs on every `paint()`); it was bottom-nav-only.

