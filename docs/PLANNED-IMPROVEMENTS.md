# Planned Improvements

Running log of designed-but-not-yet-built features and open topics to revisit. Each dated
section below is either (a) an approved design ready to turn into an implementation plan, or
(b) a topic flagged for a future brainstorming session — not yet scoped, don't build from these
without going through clarifying questions first.

---

## 2026-07-31 — Owner answers to web-push §12 q9–12 (ANSWERED — record of record)

The last four open questions on web push. All organisational; none blocked the build. With these
answered **nothing gates rollout to real leaders**, and the tick + check-in warning went live the
same day (see CLAUDE.md's 2026-07-31 section).

| # | Question | Owner's answer |
|---|---|---|
| 9 | Posture on Apple/Google/Mozilla receiving push **metadata** (endpoint, timing, size — never camper data)? | **Accepted.** Proceed in this form. |
| 10 | Is any account holder under 18? | **No.** Every login holder is a trusted leader who has been through compliance training. |
| 11 | Who owns and publishes the privacy notice? | **The youth team**, as part of updating the compliance data. |
| 12 | Who delivers the iOS "Add to Home Screen" comms, and when? | **At the pre-camp training day**, ahead of camp. |

### What still matters despite these being answered

- **⚠ Q10 is a statement about TODAY's accounts, not a permanent property.** If a login is ever
  issued to someone under 18, that device registration becomes a minor's personal data and the
  org's consent posture for minors applies. Re-ask then; do not treat this row as settled forever.
- **Q12's answer avoids a specific trap, and that is why the timing matters.** Installing to the
  Home Screen puts the app in a **separate storage partition**, so the leader is logged out and must
  sign in again — with a randomised `Word.###` password from the distributed CSV, plus an initials
  re-prompt. Doing that at a training day is supported; doing it mid-camp is the failure the
  question was raised about. **If the training day slips, this cost comes back.**
- **iOS still gives no notification permission prompt until the app is installed to the Home
  Screen.** The design names this as the single biggest adoption risk to the whole feature. The
  answer to q12 is a plan to mitigate it, not a removal of it: **assume alerts reach roughly the
  fraction of leaders who actually complete the install, and keep nothing safety-critical dependent
  on a push alone.** The in-app notice remains the guaranteed channel.

## 2026-07-30 — Owner decisions on the notification/incident review (ANSWERED — record of record)

Seven questions were put to the owner before any dependent code was written. These are their
answers **and the reasoning**, so a future session doesn't re-litigate them or quietly build
something that was declined.

| # | Question | Owner's answer |
|---|---|---|
| 1 | Incidents workflow: review state, server-side acknowledgement, `occurredAt`, alert expiry? | **`occurredAt` (optional) and 12-hour alert expiry ONLY.** Review state and server-side acknowledgement **declined**. |
| 2 | Should a zone leader see other zones' incidents? | **Keep camp-wide.** Confirmed intended, not an oversight. |
| 3 | Soft-delete incidents? | **No — hard delete stays.** |
| 4 | Should a zone leader be able to file against another zone? | **Keep allowed.** The existing test pinning this (`incident.service.test.ts:51`) stands. Zone was still constrained to the four `ZONE_NAMES` so a typo can't mis-file a record. |
| 5 | Is web push actually shipping, or is the in-app notice the whole feature? | **Web push IS shipping for this camp.** Phases 4–6 built and deployed 2026-07-30, inert until the VAPID keys are set. |
| 6 | The four organisational questions in the web-push design §12 | **ANSWERED 2026-07-31** — see the 2026-07-31 section below. Nothing organisational gates rollout now. |
| 7 | Turn the tick on this session? | **No** — the owner is doing the Supabase/Vercel configuration themselves. See `docs/DEPLOY-NEXT-STEPS-2026-07-30.md`. |

### ⚠ Declined — do NOT build these without asking again

Each was designed and costed during the review and each was consciously turned down. They are
recorded here because "nobody thought of it" and "the owner said no" look identical six months later.

- **Incident review state** (`reviewedAt`/`reviewedBy`/outcome note). The gap is real and was
  explained: low-severity incidents are meant for an end-of-day review, but an incident carries no
  state, so a director re-reads the same undifferentiated list every evening with no record of what
  has been actioned. Declined anyway.
- **Server-side acknowledgement of high-severity alerts.** "Got it" still writes only to
  `localStorage['cp_dismissed_notices']` on one device: there is **no server record that the
  director ever saw a safeguarding alert**, the same person on a second device sees it again, and
  the audit workbook has no acknowledgement column. Declined.
- **Zone-scoping `incident.list()`.** Every `zoneLeader` reads every zone's incident summaries,
  including ones naming minors they have no relationship to. This remains the one place the app
  departs from the `canAccessPerson`/`canAccessChurch` discipline it applies everywhere else, on its
  most sensitive record type — **by explicit decision**, not by accident.
- **Soft-delete incidents.** An append-only safeguarding record can be hard-deleted by admin or
  director with nothing recording that it existed, and the workbook export silently loses it.

### Still open

- ~~**Web-push design §12's four organisational questions are UNANSWERED**~~ → **ANSWERED
  2026-07-31, see the section below.** Rollout is no longer gated on anything organisational.
- **Incidents are still unreachable pre-camp** (item 4.7 from the review, never put to the owner).
  `RENDER.incidents` was deliberately made mode-independent on 2026-07-18, but the only route to it
  is the at-camp home tile, so that revert's intent still isn't delivered (`public/index.html`
  admits this in a comment). Not built; worth one question next session.
- **Migration history drift now covers `0009`–`0012` AND `0016`–`0017`.** Six rows recorded under
  generated timestamps. Schema is correct; a `supabase db push` would try to re-run all six.

---

## 2026-07-20 — Discount codes: classify as "paid in full" (BUILT, THEN SUPERSEDED — CLOSED)

> **Status correction, 2026-07-29.** This design was BUILT (migration `0015`, `applyDiscountOverrides`,
> the `budget:manage` capability, `PATCH /settings/discount-overrides`) and shipped to prod on
> 2026-07-27 — the "not yet planned/implemented" line at the bottom of this section was stale from
> the moment it shipped. It has since been **superseded** by the 2026-07-29 ticket-classification
> rework: a per-code dollar amount became a per-code TAG (`inperson` / `sponsor` / `discount`), and
> migration `0017` carried every existing override key across as `'inperson'`. `settings.discount_code_overrides`
> still exists in the DB and still round-trips, but nothing reads it. Design:
> `docs/superpowers/specs/2026-07-29-seven-item-batch-design.md`. Kept below for history only —
> **do not build from it.**

### Original design (historical)



**Problem:** Some registrants show `registrationCost: 0` on their ticket because a discount code
was used to represent a manual EFTPOS/cash payment made at registration time (not a real
sponsorship). Today the Budget & Costings total ignores this — the money was actually collected,
but the app buckets these registrants as "Sponsored $0" and the grand total undercounts what's
actually available.

**Goal:** Let an admin/director mark a discount code as "paid in full" so the registrants who
used it (and whose ticket currently shows $0/unrecorded) count toward the budget total at the
right dollar value — either auto-filled when the value is inferable, or typed in manually when
it isn't.

### Decisions (confirmed via clarifying questions)

| Question | Decision |
|---|---|
| Classify per discount code or per registrant? | **Per discount code** (global — applies to everyone who used that code) |
| Where does the "known" value come from? | **Dataset's "Full" price** — the highest recorded positive `registrationCost` in scope |
| Flat amount per code, or per-registrant amount? | **One flat amount per code** |
| Who can edit it? | **Admin + Director** (both already see Budget & Costings) |
| Re-bucket into a normal cost category, or a separate lump-sum add-on? | **Re-bucket** — becomes a normal category row (e.g. "Full — $180"), flows through existing budget/CSV logic unchanged |
| Apply to every registrant with that code, or only $0/null ones? | **Only $0/null** — never overwrite a genuinely-recorded nonzero cost |

### Design

1. **Storage.** New JSONB column `discount_code_overrides` on the `settings` table, default
   `{}` — `Record<string, number>` mapping discount code → override dollar amount. Mirrors the
   existing `last_temp_passwords` JSONB-array pattern already on `CampSettings`; no new table.
2. **One field, two use cases.** The "toggle" (known value) and "manual entry" (unknown value)
   collapse into a single editable amount field per code:
   - Clicking "Mark paid in full" pre-fills the field with the dataset's `fullAmount` (one click,
     no typing) when a `fullAmount` exists.
   - If there's nothing to pre-fill, or the admin wants a different figure, they type the amount
     directly — same field.
   - Clearing the field removes the override (code reverts to normal behavior).
3. **Budget calculation (`src/services/budget.ts`).** New pure function
   `applyDiscountOverrides(people, overrides)` runs before `computeBudget`: for each person whose
   `discountCode` matches an override key **and** whose `registrationCost` is `null`/`0`, returns
   a copy with `registrationCost` set to the override amount. Untouched for anyone with a real
   nonzero cost already recorded. Output flows through the existing `computeBudget` unchanged —
   category bucketing, per-church totals, grand total, and CSV export all pick it up for free.
4. **API & permissions.** Settings writes currently require the `admin:manage` capability, which
   director doesn't hold. Add a new narrowly-scoped capability `budget:manage` (granted to
   `admin` and `director`, same pattern as `export:compliance`) and a dedicated
   `SettingsService.updateDiscountCodeOverrides` method — don't widen general settings-editing to
   director.
5. **UI.** Inline editable amount field added to each row of the existing "Discount codes" card
   on the Budget & Costings screen — no new screen. SPA mirror (`computeDiscountSummaryClient`)
   gets the same `applyDiscountOverrides` logic ported to JS.
6. **Tests.** Unit tests in `budget.test.ts` for `applyDiscountOverrides` (only overrides
   $0/null, ignores nonzero, feeds correctly into `computeBudget`'s grand-total invariant), plus a
   settings-service test for the new `budget:manage` permission gate.

**Status:** design approved, not yet planned/implemented. Next step when picked up: write an
implementation plan (superpowers writing-plans) and execute.

---

## Deferred — full Web Push + proactive check-in-window warnings (item 10)

Split out of the 2026-07-23 batch by owner decision: build everything else first, then design
Web Push properly with risk analysis. Spec to be written at
`docs/superpowers/specs/2026-07-23-web-push-design.md`. Covers (a) **item 10** — automatically
notify a church ~1h before its check-in window closes if daily check-ins aren't done, with the
count remaining — which needs a real server-side scheduler (the app is serverless with no cron
today) AND a delivery channel that reaches a closed app; and (b) **full Web Push** (VAPID keys,
push subscription storage, service-worker `push`/`notificationclick` handlers) as that channel.
Must analyse privacy (subscription + PII storage, opt-in consent, minors), performance (fan-out
cost on serverless, cron cadence, Vercel Cron), and pros/cons vs the lazy in-app model that
item 9's scheduled notices already use. **Design only until approved — do not implement.**

## Delivered 2026-07-23 (was "future topics")

These were the owner's queued topics; all shipped in the 2026-07-23 batch (see CLAUDE.md):
- ~~Editor/church initials requirement~~ → **item 7** (enforced at login, auto-applied, quick-switch).
- ~~Split first-day sign-in from daily check-in~~ → **item 8** (wide button + greying, distinct faces).
- ~~Time-based lock behavior~~ → **item 11** (hard AM/PM windows, blocked outside windows/camp days).
- ~~Sign-in workflow & late sign-ins~~ → **item 3** (in-place list re-render, one-tap church sign-in).
- ~~Sign-in/out UI latency~~ → **item 3** (`_invalidate('/attendance')` now clears
  `/registrants`+`/campers`, so the in-place re-render shows the change immediately).
