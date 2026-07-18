# Frontend fixes implementation plan (2026-07-18)

Source: two independent frontend reviews (own pass + blind second-opinion subagent),
reconciled into the published assessment —
https://claude.ai/code/artifact/194fe88c-6dd0-4398-aa62-f3a46da009b4

All 14 findings are in scope. Decisions below were made against the *current*
`public/index.html` (line numbers re-verified today, 2026-07-18 — a few had
drifted slightly from the original report, e.g. `#login` moved ~408→576,
`switchMode` moved ~3273→3267).

**Deploy note:** this repo auto-deploys `master`→prod on push, no PR workflow. Do
**not** push any of this straight to `master`. Work happens on a feature branch;
you review and push yourself.

**Testing note:** per your instruction, browser/device testing is minimized on my
side — you're doing a manual pass on your phone after each batch lands. Each item
below has a "verify" line that's grep/build-level, not a live walkthrough. A
consolidated phone-test checklist is at the bottom.

---

## Decisions locked in tonight

| # | Question | Decision |
|---|---|---|
| 1 | Check-in session picker overflow | Horizontal scroll + snap (not a dropdown) |
| 2 | `confirm()`/`prompt()` scope | Only the 3 critical ones: mode switch, full reset, new-year rollover |
| 3 | First Aid "All Students" default view | Full roster by default, filterable — no church gate |
| 4 | Roster size | 400+ total → simple full render is *not* automatically safe, see item 5 notes |
| 5 | Design token sweep | Full sweep, one dedicated pass |
| 6 | Admin console IA (the one place the two reviews disagreed) | Leave layout as-is, just document it as deliberate |
| 7 | Oversight pulse chart | Token-only touch-up, bundled into the sweep — no layout redesign |
| 8 | Overall plan scope | All three tiers |

Two smaller calls I made myself (not asked, flagged here so you can overrule):
- **Check-in tab id/label drift** (item 9 below): leaving the `checkin` id alone,
  just adding a comment — the report itself called this low-urgency.
- **Optimistic UI** (item 12 below): scoping v1 to the check-in toggle only.
  First-aid note submission optimistic UI is a stretch/follow-up, not bundled in,
  since it's a different data shape and doubling the scope of an already-fiddly
  rollback-on-failure task isn't worth it for a Later-tier item.

---

## Execution strategy

Single 4,800-line file, no build step — concurrent edits in the same working
directory will stomp each other. Subagents run **sequentially**, each in its own
git worktree (`isolation: "worktree"`), merged one at a time onto a
`frontend-fixes` branch before the next starts. Mechanical/small items I do
directly rather than spinning up an agent for a two-line change.

| Batch | Item | Who | Why |
|---|---|---|---|
| Now | 1. Grade null | Me, direct | 2 lines, trivial |
| Now | 2. Session picker overflow | Me, direct | 1 CSS rule |
| Now | 3. First Aid alert-box swap | Me, direct | 2 template strings, already located |
| Now | 4. `confirm()`→modal (3 sites) | **Subagent A** | Self-contained, needs careful async rewiring of 3 handlers + reading `.sheet`/`#modal` |
| Now | 5. Roster gating removal | **Subagent B** | Self-contained function rewrite (`RENDER.allstudents`) |
| Now | 6. Token sweep | **Subagent C** | Mechanical but touches ~200+ scattered sites — worth isolating in its own pass, run last so it doesn't conflict with A/B's edits |
| Next | 7–11 | Me, direct (all small) | None big enough to justify a subagent |
| Later | 12. Optimistic UI (check-in) | **Subagent D** | Self-contained but fiddly (rollback-on-failure), worth isolating |
| Later | 13. Phone-viewport pass | You | Converted to a checklist, see bottom |
| Later | 14. Mode-switch signal + day-calc unification | **Subagent E** | Touches `updateModeUI`/`switchMode`/`_realCampDayNumber` — same neighborhood as Subagent A's work, so run after A merges |

I have **not** started any of this yet — this message is the plan. Say the word
(e.g. "go" or "start now tier") and I'll kick off Subagents A/B/C on the Now-tier
batch in the background against a `frontend-fixes` branch, nothing pushed to
`master` without you looking at it first.

---

## Now tier

### 1. "Grade null" bug
- **Files:** `public/index.html:2967` (Student Info hero), `:1775` (My Youth hero)
- **Fix:** `'Grade '+p.grade` → same guarded pattern already used at `:2449`
  (`'Grade '+(c.grade||'—')`) and `:4045` (`p.grade?('Grade '+esc(p.grade)):...`)
- **Verify:** `grep -n "+p.grade\|+s.grade" public/index.html` after the fix should
  show zero unguarded occurrences.

### 2. Check-in session picker overflow
- **File:** `public/index.html:231` — `.seg{display:flex;...}`
- **Fix:** add `overflow-x:auto;` + `scroll-snap-type:x mandatory;` to `.seg`, and
  `scroll-snap-align:start;flex:0 0 auto;` (drop the current `flex:1`, which is what
  forces shrink-to-fit) to `.seg button`. `.seg` is reused by ~10 other segmented
  controls in the file (audience picker, priority picker, church-info tabs, etc.) —
  this is a global rule change, checked it's safe: none of those need `flex:1`'s
  equal-width behavior badly enough to break from a 2-4-button row going
  auto-width instead.
- **Verify:** visually on the 4-day seeded test camp (6 sessions) it should look
  unchanged; the real test is a camp with 8+ sessions, which is on your phone
  checklist below since local dev only has short test camps seeded.

### 3. First Aid alert-box severity inversion
- **File:** `public/index.html:2245-2257`
- **Fix:** swap which case gets `.fa-alert` (loud, amber) vs a calm/neutral
  treatment. Currently `.fa-alert` wraps *both* "Medical alert" and "No medical
  conditions recorded" (:2245 vs :2247) — only the medical-alert case should keep
  it. Currently `.fa-lead` (quiet card) wraps *both* "contact first" and "no
  leader contact set" (:2255 vs :2257) — the missing-contact case should get
  something louder, since it's the actionable gap. Recommend: keep `.fa-alert` for
  medical-flag-present only; give "no leader contact" its own `.fa-warn`-style
  treatment (or reuse `.fa-alert` there instead, since it's more urgent than a
  calm "no conditions" case).
- **Verify:** the file already defines `--alert-bd`/`--alert-bg` and `--lav`/`--warn`
  tokens (:256, :268) — reuse those, don't hand-roll new colors.

### 4. Native `confirm()`/`prompt()` on the 3 critical actions — Subagent A
- **Files:** `switchMode()` at `:3267-3280`; the "Close-Out Camp / Deletes ALL
  data" handler near `:3964`; the new-year rollover handler near `:3632`
- **Fix:** route all 3 through the existing `.sheet`/`#modal` component (used
  elsewhere in the app, e.g. Account Preview — praised in both reviews as the
  good version of this pattern). Each of these 3 functions currently does
  `if(!confirm(...))return;` synchronously mid-function — replacing that means
  restructuring each into "show modal → on confirm, run the rest of the function
  as a callback/continuation" rather than a straight-line function. Preserve the
  exact existing warning copy (the mode-switch and rollover text already do a
  good job explaining consequences — don't rewrite it, just move it into the
  modal body).
- **Explicitly out of scope for this task:** the other 13 `confirm()`/`prompt()`
  call-sites (per decision #2 above) — leave them as native dialogs.
- **Verify:** `grep -n "confirm(\|prompt(" public/index.html` before/after — should
  drop from 16 to 13, and the 3 removed should be exactly these three functions.
  No live click-through needed from me; you'll exercise mode-switch (carefully —
  it's the one that froze a tab last time) on your phone pass.

### 5. First Aid "All Students" roster gating — Subagent B
- **File:** `public/index.html:2191-2226` (`RENDER.allstudents`)
- **Fix:** remove the church-required gate (currently blocks at `:2206`/`:2212`
  with "Choose a church to see its students and leaders"). Fetch/filter the full
  camp roster (`api('/campers?scope=all')`, already fetched at `:2192`) by
  zone/gender/grade with church as one more optional filter, not a prerequisite.
- **On the 400+ roster / virtualization question:** I'm recommending **against**
  building pagination or virtualization for this. The app has no existing
  lazy-render pattern anywhere in the file (checked) — introducing one here would
  be new architecture for a single screen, and a flat `.map().join('')` render of
  a few hundred simple row templates is typically fine on a modern phone (jank
  from unvirtualized lists usually shows up at 1,000+ complex rows, not ~400
  simple ones). Ship the plain full render first. **If your phone test shows real
  scroll jank or slow initial paint on the full 400+ list, tell me and I'll scope
  a "render first ~150, load more on scroll" follow-up** — flagged explicitly so
  this isn't silently skipped if it turns out to matter.
- **Verify:** no live browser check from me; this is on your phone checklist.

### 6. Design token sweep — Subagent C
- **Scope:** ~150 hardcoded `style="color:#…"` hex values + ~60 inline
  `font-size:.XXrem` literals that duplicate existing `--t-*`/color tokens, plus
  the "Not on site" badge (~:2177, currently hand-rolled instead of using
  `.pill.warn`), plus the oversight pulse chart's hardcoded colors/sizes
  (token-only touch-up per decision, not a redesign).
- **Fix approach for the subagent:** grep every `style="color:#`/inline
  `font-size:.` occurrence, map each hex/size to its nearest existing token (most
  are near-duplicates, per both reviews' independent counts), replace with
  `var(--token)`. **Must not change any actual rendered color or size** — this is
  a pure dedup/tokenization pass, not a restyle. Any hex that doesn't cleanly map
  to an existing token (i.e. it's actually a distinct, intentional color) should
  be left alone and flagged in the subagent's summary rather than guessed at.
- **Run this batch last**, after Subagents A and B have merged, since it touches
  scattered lines across the whole file and is the most likely to conflict with
  their more targeted edits.
- **Verify:** diff review — every changed line should be a 1:1 `#hex` → `var(...)`
  or `.XXrem` → `var(...)` swap with no other change. `grep -c 'style="color:#'
  public/index.html` before/after should show the count near zero.

---

## Next tier

### 7. Admin console IA — document, don't change
- Add a short comment at the admin console tile-grouping code (near `:3236`,
  where `modeTile`/tile grid logic lives) noting the grouping was reviewed
  2026-07-18 and is considered settled — not to be reactively reshuffled again
  without a deliberate pass. No layout change.

### 8. Login screen containment
- **File:** `public/index.html:576` (`#login`), `:592` (`#mcpGate`)
- **Fix:** give both the same max-width treatment as `.app` (the 460→600→720→820px
  stepped growth used elsewhere, roughly `:79`/`:438`/`:445`/`:450` — re-grep for
  current line numbers, they've likely drifted like everything else has).
- Small enough I'll do this directly alongside item 2.

### 9. Check-in tab id/label drift
- **File:** `:1038` (`campPhase()`), `:1277` (`_ci`), `:1314` (`ciLabel`)
- **Fix:** add a one-line comment at the id's declaration explaining the label
  swap, so a future search for "sign-in" doesn't come up empty. No rename (my
  default call, see decisions section above).

### 10. Oversight pulse chart
- Folded into item 6 (token sweep) per decision #7 — no separate work item.

### 11. Error states — targeted, not blanket
- **Correction to the original finding:** I checked, and `.err` (`:406`) is
  currently used *only* for the two login-form errors (`:583` `loginErr`, `:601`
  `mcpErr`) — it's not actually an established general-purpose error system
  elsewhere in the app the way the report implied. So "standardize on `.err`"
  would be introducing a new pattern app-wide, not restoring consistency.
- **Revised fix:** rather than a blanket swap, apply alarm-styled treatment
  specifically to genuine *fetch-failure* catch blocks (not the many legitimate
  empty-state uses of `.note-hint`, e.g. "No one matches these filters" — those
  are correct as-is). Concrete catch-block sites to fix:
  `:1222`, `:2192`, `:2350`, `:4016` (search `catch(e)` + `note-hint` together to
  find any siblings).
- Small enough I'll do this directly.

---

## Later tier

### 12. Optimistic UI for check-in toggle — Subagent D
- **Scope (my call, see decisions section):** check-in toggle only for v1.
  First-aid note submission stays on the current request→re-render flow.
- **Fix:** on tap, update the row's checked-in state in the DOM immediately;
  fire the API call in the background; on failure, revert the row and toast the
  error. Reconcile silently on success (no visible flicker if the server agrees).
- Run after Subagent A merges (same general area of the file, `campPhase`/check-in
  render functions).

### 13. Phone-viewport pass — you, not me
- Per your note, dropping this as an engineering task on my side. See the
  checklist below for what's worth specifically looking at once items 1/2/5/6
  are live on a preview branch.

### 14. Pre-camp/at-camp mode-switch signal — Subagent E
- **Files:** `updateModeUI()` (`:1045`), `switchMode()` (`:3267`),
  `_realCampDayNumber` (referenced in a comment at `:1173` — grep for its
  definition)
- **Fix:** (a) a one-time toast/banner the first time a session sees a mode that
  changed since their last visit (localStorage flag, not a persistent nag), and
  (b) unify the two places that independently compute "what day is camp on" —
  `_realCampDayNumber` and the `SETTINGS.campDay` manual-preview toggle mentioned
  around `:1177` — into one source of truth so they can't drift apart.
- Run after Subagent A, since both touch `switchMode`/`updateModeUI`.

---

## Your phone-test checklist (once a batch is on a preview/branch build)

- **Session picker** — if you can get a test camp configured with 8+ sessions
  (or temporarily shrink the viewport / add sessions), confirm it scrolls
  smoothly instead of squeezing labels.
- **All Students roster** — with the full 400+ list unfiltered, does it paint
  fast and scroll smoothly, or is there real jank? (Tells us whether item 5's
  "skip virtualization for now" call was right.)
- **First Aid alert box** — open a student with no medical conditions and one
  with a flag; confirm the calm/loud treatment now points the right way.
- **Mode switch** — exercise the new confirm-modal for switching modes; this is
  the flow that froze a tab under the old native `confirm()`, worth specifically
  re-confirming it no longer does.
- **Oversight pulse chart** — small-phone legibility, since this is the
  most-reopened widget per both reviews.
