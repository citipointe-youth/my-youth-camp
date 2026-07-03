# 2026-07-03 bug batch — design

Admin-requested batch of 7 items. Account: admin. Investigated against `CLAUDE.md`/`debug.md`
before design; clarifying questions answered inline below.

## 1. Import row-order robustness (confirm-only)

Confirmed already correct. Form/Ticket/Invoice importers all match people by a **name key**:
`person-matching.ts`'s cross-church `normalizedFullName` index (Ticket/Invoice), and
`import.service.ts`'s `nameChurchKey` (Form) — both church/name keyed, disambiguated by phone,
never positional. Add one regression test asserting a shuffled-row-order CSV produces the same
matches as the original order. No behaviour change.

## 2. Budget: discount-code breakdown

New pure function in `src/services/budget.ts`: `computeDiscountCodeSummary(people)` → grouped by
`discountCode` (non-blank only), each row `{code, count}`, plus `totalInScope` (count of all
registrants in scope — the agreed denominator). Rendered as a new collapsible section at the
bottom of `RENDER.budget`/`drawBudget` (SPA), same collapsible-row visual pattern as the
per-church rows already there. Scoped identically to the rest of the budget table (own church /
own zone / all, per actor role).

## 3. Leaders: default at-camp presence + My Youth visibility

Decisions (from Q&A): trigger = **mode switch pre-camp→at-camp** (bulk); sensitive-note-style
"only church excluded" pattern does NOT apply here — this is presence, not visibility.

- `settings.service.ts` `setMode` (or its `admin.service.ts` wrapper): when the mode is actually
  changing to `'at-camp'`, bulk-apply the existing `withSignEvent` transition (from
  `person-lifecycle.ts`) to every `kind==='leader'` person not already `atCamp` and not
  `cancelled`, with a `SignOutEvent{type:'in', authorId: actor.id, leaderName: actor.displayName,
  reason: 'Camp started'}`. This reuses the exact same pure transition function Day-1 arrivals use
  — no new invariant, no separate code path, full audit trail (`signOutHistory`). Runs in-process
  (no extra client round-trips), so it must not reintroduce bug 5's lag.
- `checkin.service.ts` `getSessionStatus`: roster filter gains `p.kind !== 'leader'` — leaders
  must never appear on the twice-daily check-in screen even though they're `atCamp`.
- `dashboard.service.ts`: the at-camp `checkInsDue` calc (`atCampNow` → session-check filter)
  excludes `kind==='leader'` too, or leaders would permanently inflate "still due to check in"
  (they never get a `checkInHistory` entry since they're not on the roster). `totalAtCamp`/
  `totalExpected` are NOT filtered — leaders should count toward "who's physically at camp".
- SPA `RENDER.myyouth`/`filterMyYouth`: add a **"Leaders"** option to the grade filter dropdown
  (filters `kind==='leader'`). Relax the "Late arrivals" bucket (`notArrived`) to include leaders
  (drop the `kind==='student'` restriction) — covers the edge case of a leader added after the
  bulk sign-in already ran (e.g. a late CSV import): they appear here and get the same existing
  "Sign in to camp (late arrival)" button already in `openCamper`, no new UI required.
- `signOutPrompt`/`signInPrompt` modal copy: branch wording for `kind==='leader'` ("this leader"
  vs "this youth"); skip the "were parents met at pickup" question for leaders (doesn't apply).

## 4. Review Data Import (audit + tooltip)

Confirmed behaviour: `needsReview:true` is set by Ticket List/Invoice import when a row can't be
confidently matched (`person-matching.ts`); surfaces as an amber "Needs review" pill on the Data
tab (`reviewCell`); tapping opens `openReviewModal` showing `needsReviewReason` + a "Mark
reviewed" button (`_markReviewed`, PATCHes `needsReview:false` only — by design, never
auto-merges). The one-tap confirm itself is already easy; the gap is no in-modal guidance on what
to check first. Fix: add a `helpTip` inside `openReviewModal` explaining what triggered the flag
and what to verify (name/church spelling, accommodation, cost) before clearing it. No backend
change.

## 5. At-camp mode-switch lag

Root cause found: `switchMode()` (SPA) already applies the fresh `campMode` locally after
`POST /admin/mode` succeeds, but the `RENDER.home()` it calls immediately afterward
unconditionally re-fetches `/settings` again (needed for *other* already-open sessions to pick up
a remote change, but redundant for the session that just made the change) — 3 sequential
round-trips (write, re-fetch settings, fetch home) where 1–2 would do. Fix: `RENDER.home` accepts
a flag (or `switchMode` calls a variant) to skip the settings re-sync when the caller already has
fresh settings. Remaining latency is attributed to inherent serverless/Supabase round-trip
characteristics (already covered by the `#nprog` loading bar) — not further addressed here.

## 6. Sensitive notes/testimonies

Migration `019_notes_sensitive.sql`: `notes.sensitive boolean not null default false`.
`StudentNote.sensitive?: boolean`. `AddNoteSchema` (note.service.ts) gains optional `sensitive:
z.boolean().optional()`, defaults false on create. `note.service.forCamper` (the profile-notes
read path used by `openCamper`) drops any note where `sensitive===true` when `actor.role ===
'church'` — zoneLeader/director/admin unaffected, per Q&A answer. SPA: toggle switch (`.tgl`
pattern already used in Admin Settings) added to both the "Add note" modal (`notePrompt`) and the
"Submit testimony" screen (`RENDER.testimonies`), default off. The false subtitle text "Visible to
zone leaders & directors only" is deleted from `notePrompt` and replaced with a `helpTip`
describing the real rule (visible on profile to everyone unless marked sensitive; sensitive hides
it from church logins only). Supabase repo (`supabase.notes.ts`) gains the `sensitive` column
mapping in `toNote`/`save`.

## 7. Sign-in/out log running totals

Per Q&A: the "Sign-in & Sign-out Log" (both the compliance workbook sheet and
`exportSignInOutCsv`) is restructured from grouped-per-person to **one chronological timeline**:
collect every `SignOutEvent` across all people (each tagged with its owning person's kind/name/
church/etc.), sort by timestamp ascending, replay in order maintaining two running counters
(`studentsSignedIn`, `leadersSignedIn`: `+1` on `type:'in'`, `-1` on `type:'out'`, keyed by the
event owner's `kind`), and emit two new columns — Total Students Signed In / Total Leaders Signed
In — showing the counters' state immediately after each row's event. The existing "Registered —
Did Not Attend" rows (zero-history registrants) keep their place at the top with blank
running-total columns (no event occurred). Once #3 ships, leader bulk-sign-in events flow through
this the same way as any other event — no special-casing needed.

## Verification

`npm run typecheck` + `npm run test` (per this repo's convention — no local dev server / browser
driving). New/updated tests: person-matching row-order regression (#1), `budget.test.ts` discount
summary (#2), `admin`/`settings` service bulk-leader-signin + `checkin.service`/
`dashboard.service` leader-exclusion tests (#3), `note.service.test.ts` sensitive filtering (#6),
`audit-export.service.test.ts` running-totals (#7). Push to `master` deploys (GitHub → Vercel
auto-deploy, per CLAUDE.md).
