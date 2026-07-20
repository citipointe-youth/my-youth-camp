# Planned Improvements

Running log of designed-but-not-yet-built features and open topics to revisit. Each dated
section below is either (a) an approved design ready to turn into an implementation plan, or
(b) a topic flagged for a future brainstorming session — not yet scoped, don't build from these
without going through clarifying questions first.

---

## 2026-07-20 — Discount codes: classify as "paid in full" (APPROVED DESIGN)

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

## Future topics to question (not yet scoped)

Flagged by the owner for a future session — each needs its own clarifying-question pass before
any design work starts. Do not build against these bullets as-is.

- **Editor initials requirement.** Require someone to enter their initials before the app allows
  an editing action (which actions? all writes, or a specific subset? where do initials get
  stored/shown — audit trail?).
- **Split first-day sign-in from daily check-in.** Currently discussed together in places
  (`checkin.service`, SPA check-in screen) — owner wants these separated into distinct UI/logic
  boxes. Needs scoping: what's shared vs. what actually needs to diverge.
- **Time-based lock behavior outside camp dates.** Audit `checkinSwitchoverTime` /
  `checkinPhaseOverride` / `churchCheckinTimeRestricted` (see `settings.ts`) — what happens when
  "today" isn't between `CampSettings.startDate` and `endDate`? Needs a walkthrough of current
  behavior before deciding what *should* happen.
- **Sign-in workflow & late sign-ins.** Full user-workflow review of the sign-in process,
  specifically how late arrivals are handled — needs a walkthrough with the owner of the current
  flow before identifying gaps.
- **Sign-in/out UI latency.** Students take a while to visually show up as signed in/out after
  the action completes — investigate root cause (client cache TTL? `_invalidate` gaps? re-render
  timing?) before proposing a fix. Related: the SPA's 30s client cache / `_prefetch` /
  stale-while-revalidate nav pattern noted in `CLAUDE.md` "SPA perf" section — worth checking
  first since it's the most likely culprit.
