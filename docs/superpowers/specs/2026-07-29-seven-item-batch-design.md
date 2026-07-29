# 2026-07-29 — seven-item owner batch (schedule, budget classification, imports, login UX)

Owner-requested batch. Decisions below were confirmed via clarifying questions before
implementation; where the owner went to bed mid-session, the remaining call is marked
**[assumed]** with its reasoning so it can be reversed cheaply.

---

## 1. Schedule plan view — shorter rows, duration inline

**Symptom:** rows are too tall; the duration sits on its own line under the time.

**Change (SPA only, `public/index.html`):**

- `.sch-item` grid `62px minmax(0,1fr)` → `92px minmax(0,1fr)`; the time cell becomes one
  line reading `9:00 · 30m`.
- `.sch-dur` loses `display:block` (was forcing the second line) and becomes an inline span
  with a leading `·` separator.
- `_schedHeight(mins)`: `min(190, max(54, 40 + mins*0.38))` → `min(133, max(38, 28 + mins*0.27))`.
  That is a uniform ~30% reduction at every point of the curve — a 30-minute slot goes
  54px → 38px, an hour 63px → 44px, the overnight cap 190px → 133px.
- `.sch-list` gap 7px → 5px; `.sch-item` padding `10px 13px` → `7px 11px`.

Rationale for keeping the compressed (non-linear) curve: unchanged from the 2026-07-28 note —
a 30-minute item must stay tappable and an 8-hour overnight block must not push the day off
screen.

---

## 2. Budget — ticket classification replaces Full/Half/Part

**Problem with what shipped 2026-07-28:** the per-church category rows label a cost band
("Full — $180", "Part — $120"). The owner does not think in cost bands; they think in ticket
types, and the tent/classroom split is invisible in the budget entirely.

### The nine buckets

`accommodationKind` supplies tent vs classroom. The payment half comes from an admin-set tag
on the **discount code**:

| Tag | tent | classroom |
|---|---|---|
| *(no code, or untagged code)* | Tent | Classroom |
| `inperson` | Tent — paid in person | Classroom — paid in person |
| `sponsor` | Tent full sponsor | Classroom full sponsor |
| `discount` | Discounted tent | Discounted classroom |

Plus a ninth, **Accommodation not recorded**, for anyone with `accommodationKind == null`
(Ticket List never imported, or a needs-review orphan). It carries the existing warning
triangle, exactly like today's "Cost not recorded". It is never silently dropped — the budget's
grand-total-equals-sum-of-rows invariant is tested and must hold.

Leaders get the same nine buckets as campers (they buy tickets through the same Elvanto flow
and can equally be sponsored). The per-church Campers / Leaders split is unchanged.

### Where the tag is set

The Budget screen already has a "Discount codes" card listing each code with a count. The
per-code **dollar amount field** ("Mark paid in full", shipped 2026-07-27) is **replaced** by a
classification dropdown: *Plain / Paid in person / Full sponsor / Discounted*. Blank = plain.

Permission is unchanged: the existing `budget:manage` capability (admin + director).

### Base prices

`settings.tentPrice` and `settings.classroomPrice` are **re-added** (they existed and were
deliberately dropped in migration `0004`). Editable in Admin → Camp settings. They are the
reference full price: they value a paid-in-person ticket, and they are what "discounted" is
measured against.

### Dollar value per person **[assumed]**

```
if code tagged 'inperson'  -> basePrice(accommodationKind)   // money collected offline, no invoice shows it
if code tagged 'sponsor'   -> $0                             // no money received
else if amountPaid != null -> amountPaid
else if registrationCost != null -> registrationCost
else                       -> $0, flagged "not recorded"
```

**This changes the grand total** and the change is deliberate. `registrationCost` is the ticket
*total*, `amountPaid` is what actually arrived; a 100%-discount invoice records
`registrationCost: 180, amountPaid: 0`. The owner chose "full sponsor contributes $0", which
only holds if the budget is read as *money received*. Precedent already exists in the SPA:
`_paidOrCostRow` shows `amountPaid` labelled "Paid" and falls back to `registrationCost`
labelled "Cost". If the owner wanted *value of all places* instead, flip the third line to
prefer `registrationCost` — one line in `budget.ts` and one in its SPA mirror.

The owner explicitly declined a separate "sponsored value given away" figure.

### `applyDiscountOverrides` is retired

The 2026-07-27 amount-override mechanism is superseded: a tag now implies the value, so no
typing. Migration `0017` seeds `discount_code_tags` with `'inperson'` for every key already
present in `discount_code_overrides` — that was literally what the field meant (EFTPOS/cash
collected at registration). The old column is **left in place, unused**, same precedent as the
retired sign-in/out CSV route.

### Migration `0017` — MUST be applied to prod BEFORE the code push

`supabase.settings` writes every column on every save, so the columns must exist first or every
settings save (and mode switch, and new-year) fails.

```sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tent_price numeric;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS classroom_price numeric;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS discount_code_tags jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE settings SET discount_code_tags = (
  SELECT COALESCE(jsonb_object_agg(k, '"inperson"'::jsonb), '{}'::jsonb)
  FROM jsonb_object_keys(COALESCE(discount_code_overrides, '{}'::jsonb)) AS k
) WHERE discount_code_overrides IS NOT NULL AND discount_code_overrides <> '{}'::jsonb;
```

### Files

- `supabase/migrations/0017_ticket_classification.sql` (new)
- `src/core/entities/settings.ts` — `tentPrice`, `classroomPrice`, `discountCodeTags`
- `src/repositories/supabase/supabase.settings.ts` — mapper both ways + `UPDATE_COLS`
- `src/services/budget.ts` — `classifyTicket()`, `personValue()`, `computeBudget` re-keyed;
  `labelForAmount`/`applyDiscountOverrides` deleted
- `src/services/settings.service.ts` — `updateDiscountCodeTags` (replaces
  `updateDiscountCodeOverrides`), still `budget:manage`
- `src/api/controllers/settings.controller.ts` + `router.ts` — `PATCH /settings/discount-tags`
- `public/index.html` — `_budScopeRows`/`_budLabel`/`computeBudgetClient`/`drawBudget`/
  `exportBudget` mirrors; the tag dropdown; tent/classroom price inputs in `RENDER.adminSettings`
- `src/services/budget.test.ts` — rewritten around the nine buckets + the invariant

---

## 3. Remove "Clear all notifications"

Delete the button and its hint from the Data reset card in `RENDER.adminData`, and the now
unreferenced `adminClear()`. The backend route `DELETE /admin/notifications` is **left in
place, unused** — same precedent as the 2026-07-28 removal of the standalone sign-in/out CSV
export button.

---

## 4. Import name capitalisation

Fix only names that are entirely upper-case or entirely lower-case. Anything already mixed-case
is untouched, so `McDonald`, `O'Brien`, `de Silva`, `van Wyk` survive. New exported helper
`titleCaseName()` in `elvanto-mapping.ts`, applied at the first/last-name read sites in
`import.service.ts`, `ticket-import.service.ts`, `invoice-import.service.ts`. Not inside
`field()` itself (that helper also reads church names, ticket types, emails). Not in
`offline-signin.service.ts` (matches only, never stores).

Import-path only — no backfill script against prod. The authoritative Form import re-reads
every registrant on every run, so existing bad names self-correct on the next import.

---

## 5. iOS keyboard-dismiss scroll restore

Port YS Connection's `_fixViewportGap()` verbatim: a same-position `scrollTo` nudge on the next
frame, wired to `visualViewport.resize` with a delegated `focusout` fallback. WebKit leaves
fixed elements laid out against the stale keyboard-open viewport; the nudge forces a relayout.

The camp app has *no* `visualViewport`/`focusin`/`focusout`/`scrollIntoView` code at all today —
the 2026-07-26/28 purple-strip fixes addressed the same family of symptom with CSS only
(`html`/`body` background + `.tabs::after`), which paints over the gap but does not restore the
scroll position. Both are needed; neither replaces the other.

---

## 6. Login-screen tip links

Two static pages, matching YS's pattern (a plain link under the login card to a standalone
page, not an in-app modal — the SPA shell isn't fully up on the login screen):

- `public/install.html` — Add to Home Screen (iPhone/Safari, Android/Chrome)
- `public/save-password.html` — how to add the site to the phone's password manager **manually**,
  for when it never offers

Both are camp-branded (violet `#7c3aed`, tent+cross mark) and derive the site address from
`location.host` so they are correct on any deployment. Neither calls `/settings` (the camp app
has no `ministryConfig.branding` field).

Links render under the login card on iOS/Android user agents only, same UA test as YS.

---

## 7. Remember-password review

Three gaps against YS were confirmed and approved for fixing (a fourth — firing
`navigator.credentials.store()` on the change-password path too — was reviewed and
**declined** by the owner):

- **Prefill the last username.** Saved to `localStorage['ycp_lastuser']` on successful login,
  written into `#username` at boot. Gives the password manager a stable id to match on and
  saves typing.
- **Delay the screen swap.** `doLogin()` currently hides the login form synchronously the
  instant auth succeeds; Safari's save-heuristic can miss the credential when the password
  field is torn down that fast. Wait ~150ms, as YS does.
- **Wrap `#mcpGate` in a real `<form>`.** It is a bare `<div>` with buttons, so there is no
  submit event — the main signal password managers watch for. Pre-emptive: that gate is
  currently disabled in prod (`MUST_CHANGE_PASSWORD_ENFORCED = false`).

---

## Verification

`npm run typecheck` clean, `npm run test` green, `node --check` on the extracted SPA script.
Per this repo's conventions: no localhost dev server, no browser driving, no polling Vercel.
CSS/layout changes are eyeballed on-device by the owner. `sw.js` `camp-v52` → `camp-v53`.

**Deploy order is not optional:** migration `0017` to prod **first**, then push to `master`.
