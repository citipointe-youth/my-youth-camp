> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: at camp screens

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## Pulse Unallocated bar + session stepping, first-aid day filter, Student Edit overrides — `camp-v142` — 2026-10-01

SPA only (`public/index.html`), no route/permission/DTO/migration change, **no data change**. Owner
batch on the last camp day. Spec `docs/superpowers/specs/2026-10-01-pulse-firstaid-studentedit-design.md`,
plan `docs/superpowers/plans/2026-10-01-pulse-firstaid-studentedit.md`. New
`scripts/pulse-fa-harness.js` (22 checks) extracts **`_pulseGroups`, `_faKeep`, `_stuSavePlan` BY
NAME — never rename them.** vitest 1178 pass (unchanged — browser-only).
- **Pulse "5th zone 0/1"** = an at-camp student with no church (form church "OTHER", never
  allocated → `zone=''`). `_pulseGroups` now labels zone-less rows **"Unallocated"**, sorted last;
  director/admin tap → `_pulseGoUnalloc` → Data Import with the Unallocated card opened (one-shot
  `_openAllocCard`, consumed in `_renderAllocCards`). It flags a real gap: **no church login can
  check such a student in.**
- **Pulse ‹ › stepping** through `/checkin/sessions` (`_pulseSess`, `_pulseStep`); re-renders only
  `#homePulse` (the card itself now carries that id). Home resets to the current session on every
  render. A zoneLeader church-bar tap opens Check-in on the session being viewed.
- **First-aid Records**: Today/All seg → `<select id="faRecDay">` (Today · `Day N · Mon 28 Sep` per
  `checkInDays` · All, `_faDayOpts`/`faRecDay`). ⚠ **`limit=100` → `limit=1000`**: prod held 195
  first-aid records, so All + the CSV export had been silently missing the oldest ~95 (all of day 1).
  The director digest's own `limit=100` (today-only count) was left alone on purpose.
- **Individual Student Data Edit** now writes the SAME records as the Data Import cards: a church
  change → `POST /import/allocate` (an `allocation_overrides` row the Form import re-applies — the
  old raw PATCH was reverted by the next import), accommodation → `accommodationOverride` (the old
  `accommodationKind` PATCH hit the RAW column, so it was overwritten on import and **did nothing
  at all when an override already existed**). Order: plain PATCH → allocate → override, so the
  church accommodation rule can't clobber the chosen override. An Unallocated student's church
  select starts blank instead of silently defaulting to the first church. **Add student unchanged.**
- Known, not fixed: a hand-added, never-signed-in student is unprotected from the Form-import delete
  sweep; overrides key on name+mobile, so renaming here breaks re-matching on the next import.
  Not verified on a device.

## First-aid records no longer cut off after a Return — `camp-v141` — 2026-09-29

Camp LIVE, owner bug: *"when a first aider adds a record it sometimes truncates after a return."*
**Display-only bug, no data lost.** "Log action" (`saveFirstAidLog`) stores the textareas verbatim
inside the labelled body, so a Return put an UNLABELLED line in it — and both parsers (SPA
`_faParse`, server `audit-export.service.parseFirstAidBody`) dropped every line without a label.
Both now append an unlabelled line to the field above (a leading one is still ignored); trailing
whitespace trimmed. Retroactive: every stored record re-displays in full. `.fa-rec .ln` /
`.fa-amend .ln` + the Notes-view first-aid lines are `white-space:pre-line` so the break shows
(⚠ never on a wrapper — the template's own newlines would render). CSV/workbook get the full
multi-line text. `parseFirstAidBody` is now exported; +3 tests (1178 pass). Edge case accepted: a
typed line beginning `Treatment:` inside "What happened?" is still read as a label. The amendment
form still flattens Returns on save (unchanged). Not verified on a device.

## First-aid record AMENDMENTS — `camp-v140` — 2026-09-29

Camp LIVE. Owner chose **amend, not edit** (a medical record about a minor must keep its original).
An amendment is its **own `category:'firstaid'` note** via the existing `POST /notes` (same
`note:write:firstaid`, same scoping — **no route, permission or migration change**). Body:
`Amends: <original note id>` / `Amendment: <one line>` / `First-aider: <name>`; the original is never
touched. **No cap** — owner asked for "at least 5"; any number nest (oldest first, "Amendment N").
- SPA: `_faParse` reads `Amends`/`Amendment`; `_faIsAmend`, `_faGroup` (nests under the original;
  an amendment whose original is outside the loaded `/notes/firstaid` window renders alone as an
  "orphan"), `_faAmendsHtml`, `_faAmendBtn`, `openFaAmend`/`saveFaAmend`. "Add amendment" on every
  record in **Student Info** and the **Records** tab — **firstAid login only** (`_faAmendBtn`/`openFaAmend` check `ACTOR.role`; owner requirement). Records "Today" keeps a record if it OR any
  amendment is today. Director digest "first-aid today" excludes amendments. Leaders' Notes feed
  shows them as "First-aid · Amendment". Records CSV + audit workbook `First-Aid Records` sheet gain
  **Amendment** and **Amends record logged at** columns (`parseFirstAidBody`, test covers 5).
- **Other logins: read-only effects only, owner-approved 2026-09-29** — digest count, Notes-feed
  tile, workbook columns (above). Without them an amendment would inflate the count / show a blank
  tile / blank workbook row. Leaders' `openCamper` Notes list is untouched (shows the raw body, as
  it already does for every first-aid note).
- ⚠ Amendments use up the `limit=100/250` windows like any record. Not verified on a device.

## Testimonies & Notes: "Sensitive note" record type — `camp-v139` — 2026-09-28

SPA only, camp LIVE. Owner request: the **Records** filter on Testimonies & Notes (zoneLeader /
director / admin) separates **Student note** from **Sensitive note**. `_noteCat(n)` maps a
`category:'note'` record with `sensitive:true` to cat `'sensitive'` (red `pill warn` badge). A
sensitive **testimony** keeps cat `'testimony'` but ALSO matches the Sensitive note filter (owner
asked for it in both); its tile shows Testimony + a red "Sensitive" pill. No server change
(`/notes/recent` already returns `sensitive`); the server-side CSV export is unchanged.

## Name search now drives the collapsed sections' counts — `camp-v136` — 2026-09-28

SPA only, camp LIVE. Owner bug: Student Search → My group, name search typed, **"Not signed in ·
323" opened onto an empty list** — the searched person wasn't in that section (arrived, signed
out, or a leader) but the header kept its full count. `_applyNameFilter` now, while a search is
active, sets each `details[data-nmopen]`'s `.nm-cnt` span to the match count and **hides a
section with no matches**; clearing restores `data-total`. Supersedes camp-v133's "counts ignore
the search" for these dropdowns (the `At camp (N)` heading and `_filterBanner` still ignore it).
Any new `details[data-nmopen]` should wrap its count in `<span class="nm-cnt" data-total="N">`.

## First-aid Student Info shows full logs; All Students grade buttons → name search — `camp-v135` — 2026-09-28

SPA only, camp LIVE. **First-aid Student Info** (`_loadStudentRecent`): was the 4 newest logs,
time + problem only, taken from a 50-record camp-wide `/notes/firstaid` window (so a student's older
log silently vanished once the camp passed 50 first-aid logs). Now lists **every** log for the
student as `.fa-rec` rows — time, **What happened**, **Treatment**, **By** (first-aider, else the
login's authorName, + "brought by"); a body that doesn't parse shows raw under "What happened".
Window is `limit=250` (server scans 1000 notes — every body decrypted, so don't raise it casually;
a per-camper firstaid endpoint is the real fix if a camp ever exceeds 250 logs).
**First-aid All Students**: the Yr grade buttons (`_asGrade`, `_asSetGrade`, `#asGradeBtns`) are
gone, replaced by a slim name search (`#asQ`, `_asQ`, same style as `_nameSearchHtml(…,true)`),
matched with `_nmKey` on "first last" inside `drawAllStudents` and counted as a filter for the
empty-state text. `sw.js` → `camp-v135`. Not verified on a device.

## "Not signed in" rows open the profile — `camp-v134` — 2026-09-28

SPA only, camp LIVE. Student Search → My group → **Not signed in** (`nsRow` in `filterMyYouth`):
the row now `openCamper(id)` so church logins can reach phone numbers for someone who hasn't
arrived without signing them in; the "Sign in to camp" button `stopPropagation`s. `/campers/:id`
is scope-checked only (no lifecycle gate), same path `leaderRow` already used; church still gets
the masked, audited parent-phone reveal. Profile status reads "Signed out" for a never-arrived
person (pre-existing wording).

## Dietary icon on First Day Sign In + name search on Student Search — `camp-v133` — 2026-09-28

SPA only, camp LIVE. **First Day Sign In** (`fdDraw`/`fdRow`): a small pink fork & knife
(`ICONS.diet`, `.dietic` #db2777) after the Yr/Leader badge for anyone (students AND leaders) with a
non-empty `dietaryRequirements`; `title` lists them. Both feeds (/campers, /registrants) already
carried the field; Nil/None answers are stripped at import by `cleanCareText`. **Student Search →
My group** gains the display-only name search (`_nameSearchHtml('students',true)`, thinner box);
`filterMyYouth` rows get `data-nm` and re-apply `_ciQ` after each render; `details[data-nmopen]`
now auto-open only when they contain a match. Counts/church headers ignore the search by design.

## Student Search: Data table button + church filter replaces zone — `camp-v130` — 2026-09-28

SPA only, camp is LIVE (at-camp mode). **Student Search → My group** (`RENDER.students`, and the
legacy `_renderMyGroup`/`myyouth` that shares it): admin + director get a small right-aligned
**"Data table"** button under the My group / All churches seg → `go('data')` (the full
medical/dietary/etc. `RENDER.data` table; back returns to Student Search). The **zone** dropdown
(`myZoneF`) is replaced by a **church** dropdown (`myChurchF`, built by `_myChurchFilterHtml` from
campers + not-signed-in + leaders). `MY_FILTER.zone` → `MY_FILTER.church`, matched on
**`churchName`** (not id) so `_filterBanner` prints it as-is, same as the check-in `FILTER.church`.
A phone's saved `zone` value is silently dropped by `_restoreFilters` (it only copies known keys).
Still shown to zoneLeader/director/admin (`isWide`), as the zone filter was. Tiles still show
"X Zone · Church" — only the filter changed.

## Data table scrolls in its own box; individual overrides list is data-driven — `camp-v129` — 2026-09-25

SPA only. **Data screen**: the table wrapper is now `overflow:auto;max-height:calc(100vh - 220px)`
with a sticky header row, so the horizontal scrollbar sits at the bottom of the visible box instead
of the bottom of a 600-row page. **Data Import → Individual accommodation override**: the card
listed only `_indivIds` (people searched in during THIS page session), so any reload/re-upload
emptied it although the overrides were still saved (and protected from import deletes). It now
lists every active registrant with `accommodationOverride` or `amountPaidOverride` set, plus unsaved
session additions; saved rows show "Saved override" instead of "Remove from list" (there is still no
UI to CLEAR a saved override — the PATCH accepts `null`, the dropdown just doesn't offer it). No
import/API change, so the Elvanto console (Project 11.1) is unaffected.

**Same day, backend:** `importCsv`'s delete sweep now also protects anyone who has checked in
(`lifecycle !== 'registered'` or a non-empty `checkInHistory`), so a mid-camp upload (11.1's daily
camp job or a manual late-registration run) can't hard-delete a camper whose Elvanto form was edited
or removed. Reported with the existing `absent-but-retained` code (11.1 maps it by code; only the
message text gained "or check-in"). vitest 1170 pass.

## My Youth: "Export student contact" — 2026-09-22

Owner request. A button in the top-middle of the My Youth snapshot card (`buildPeopleSnap`,
between the Students count and the accommodation badge; wraps to its own centred row ≤480px)
downloads `youth-camp-<year>-contacts-<date>.xlsx`, one sheet `Contacts`. **SPA-only** — no
backend/DTO/schema change; `RegistrantDto` already carried every field and none is masked for
any role. `sw.js` → **`camp-v118`**.

- **Who:** `scopeRegs()` (login scope + director/admin Church dropdown; Gender/Grade/search
  ignored), **cancelled excluded**, **students AND leaders** despite the button label — owner's
  explicit choice, don't "fix" the label or drop leaders.
- **Pre-camp only in practice:** My Youth (`people` tab) exists only in pre-camp mode — at camp, `navModel` swaps it for Students — and `/registrants` holds people not yet at camp. Don't go looking for the button at camp.
- **Columns:** `Type, First name, Last name, Grade (blank for leaders), Email, Phone` +
  a leading `Church` column when `_isWideRole()` (director/admin/zoneLeader).
- **Phone** goes through `fmtPhone` and is written as a TEXT cell so the leading 0 survives.
- `_contactExportRows` is pure and extracted **BY NAME** by `scripts/contact-export-harness.js`
  (also round-trips through vendored SheetJS to prove phones stay text). Never rename it without
  updating the harness. Run: `node scripts/contact-export-harness.js`.
- **Not verified in a browser** (repo convention — no dev server). Owner to eyeball on-device:
  button centred between the count and the badge (and with no badge) — with no badge it centres in the space right of the count, not on the card; on a phone ≤480px it drops
  to its own centred row; tapping it downloads the .xlsx, including from the installed iOS PWA
  (same `_rlSaveBlob` path as the accommodation export).

## Pre-camp student profile: mobile + parent phone — 2026-09-21

Owner: the at-camp profile (`openCamper`, `/campers`) already shows the student's own mobile and
a parent phone row, but the pre-camp profile (`_paintPerson`, `/registrants`) showed neither.
**SPA-only** (`public/index.html`) — no backend, DTO, schema or migration change. `npm run
typecheck` clean, `npx vitest run` **1101 pass / 64 files** (unchanged — this is browser-only).
`node --check` OK on the SPA body and `sw.js`. `sw.js` `camp-v114`→`camp-v115`→(labels)
`camp-v116`→(email row, below) **`camp-v117`**.

### The data was already on the wire — this was a display gap, not an access gap
`RegistrantDto` has always carried `mobile` and `parentPhone` (`person.dto.ts`), and both routes
funnel through the same `canAccessPerson()` — church scope + the `b-`/`g-` gender scope — so
there is **no** gating divergence between the pre-camp and at-camp views to reconcile. Two rows
added to `_paintPerson`, both mirroring `openCamper`'s existing markup exactly:
- **`${isL?'Mobile':'Student mobile'}`** — plain `tel:` link, unmasked. Matches at-camp: the
  student's own mobile has never been masked for any role, in either view.
- **`Phone`** (parent/guardian) — reuses **`_parentPhoneCell(s,s.id)`** verbatim, the same helper
  `openCamper` calls. It decides plain-link vs. masked-Reveal-button by looking for `*` in the
  value, not by role — so if the DTO's masking ever changes (see the gap below), this row needs
  **no further edit** to pick up the Reveal flow.

### ⚠️ `parentPhone` is UNMASKED in `/registrants` and `/registrants/:id` — a pre-existing gap, left open on purpose
Unlike `camper.controller.ts` (which applies `maskParentPhone` for `firstAid`/`church` via
`PARENT_PHONE_MASKED_ROLES`), **`registrant.controller.ts`'s `list`/`get` apply no masking at
all.** The parent's phone number has always travelled in cleartext in the pre-camp JSON to every
church/first-aid login — this was true before today's change and is unchanged by it; today's
change only makes it *visible on screen* where it was previously sitting unrendered in the
response body. **The owner was asked and explicitly declined closing this for now** — do not
"fix" it unasked; check with the owner first if it resurfaces (e.g. in a security review).
- The reveal audit infrastructure would need **no backend change** to close this if asked:
  `search.service.ts`'s `resolveContacts`/`revealContact` already gate on `canAccessPerson`
  alone (not `isCamper`/lifecycle — fixed 2026-07-28, bug 21), so `GET /search/contact/:id/parent`
  already works for a pre-camp registrant today. Closing the gap would be: apply the same
  `maskParentPhone`-shaped boundary function to `registrant.controller.ts`'s `list`/`get` (best
  extracted to a shared helper rather than duplicated) — the SPA needs no change at all, since
  `_parentPhoneCell` already branches on the mask character.

### Follow-ups, same day
- **Labels relabelled** on the two new pre-camp rows: `Parent`→**`Parent name`**,
  `Phone`→**`Parent number`** — disambiguates from the new mobile/email rows added alongside them.
  The at-camp profile's `Name`/`Phone` pair (under its own "Parent / guardian" card heading) was
  deliberately left as-is; that heading already disambiguates, so relabelling there would be
  redundant. `sw.js` → `camp-v116`.
- **Student email added, same pattern as mobile** (`${isL?'Email':'Student email'}`, `mailto:`
  link, unmasked). ⚠️ **Confirmed which email this is before adding it — it is the REGISTRANT'S
  OWN email, not a parent email.** `import.service.ts` parses it from the canonical Elvanto
  column `Email Address` (`ELVANTO_HEADERS` in `elvanto-mapping.ts`), which sits between `Mobile
  Number` and `Suburb`/`Postcode`/`State` — i.e. in the block of columns describing the person
  being registered, not the `Parent/Guardian Name`/`Relation to Child`/`Parent/Guardian Phone
  Number` block that follows it. **There is no parent-email column in the Elvanto export at
  all** — only one `email` field exists on `Person`, and it is the student's (or the leader's,
  for an 18+ registrant). Like `mobile`, it has never been masked for any role in either the
  pre-camp or at-camp DTO, and the at-camp `/campers` DTO doesn't carry `email` at all (it's
  `RegistrantDto`-only) — so this row is pre-camp-only by definition, not a gap to port to
  `openCamper`. `sw.js` → **`camp-v117`**.

## Panadol/Ibuprofen/Antihistamine "as needed" consent — migration `0025` — 2026-09-16

Elvanto added a late Form-export column, `"Do you consent to your child being given these
medications as needed?"` — after most registrants had already been imported, so the great
majority of existing people have no answer at all. Backend + SPA + **migration `0025`**
(`people.medication_consent text`, additive/nullable, encrypted at rest like `other_medications`
— **must be applied to prod before this code deploys**, same standing rule as every prior
`people` column addition). `npm run typecheck` clean, `npx vitest run` **1097 pass / 64 files**
(was 1089; **+8**). `node --check` OK on the SPA body and `sw.js`. `sw.js`
`camp-v112`→**`camp-v113`**.

### `null` means "not specified", and is NOT "no" — the whole design turns on that
`Person.medicationConsent: 'yes' | 'no' | null`. A blank cell is the expected state for every
registrant imported before this question existed (and for anyone the question genuinely wasn't
answered for) — it is not a refusal, and must never be presented or treated as one.
`parseMedicationConsent()` (`elvanto-mapping.ts`) parses the two real Elvanto sentences by
leading word (`'yes'`/`'no'`), case-insensitive; anything else, including blank, is `null`.
Follows the same blank-never-clobbers rule as every other care field in `import.service.ts`: a
re-import missing the column (or with a blank cell) preserves a previously-recorded yes/no rather
than resetting it to "not specified".

**Deliberately NOT added to `CARE_COLUMNS`** (the row-1 "missing column" warning list) — unlike
Medical Conditions, a blank/absent cell here is the *expected* majority state, not a data-quality
error, so warning about it on every import would be a permanent false positive.

### This is a SEPARATE question from the pre-existing "medical consent" field
The app already had a field from a different Elvanto question — *"I give medical consent for my
child as listed above"* (`consents.medical` / `consentMedical` on the DTOs) — covering emergency
medical/hospital treatment. That field is unchanged in substance but **relabeled "Emergency
medical consent"** everywhere it renders (`_medConsentRow`, the first-aid Student Info card), to
stop it reading as if it were about these specific medications. The two consent rows now render
side by side on every screen that shows either.

### Where it shows
- **Data table** (`RENDER.data`): new sortable "Panadol/Ibuprofen/Antihistamine" column
  (`DATA_COLS`/`_dataSortVal`/`_medsConsentLabel`), Yes/No/Not specified.
- **Student profile**, students only (leaders never see it — same convention as the emergency
  consent row, since the Elvanto question is a parent answering about a minor): `_paintPerson`
  (pre-camp) and `openCamper` (at-camp), via new `_medicationConsentRow`.
- **First-aid Student Info card** (`openStudentInfo`): a new consent block beside the (relabeled)
  emergency-consent block. `'no'` and `null` ("not specified") both render with the same
  cautionary styling — a first-aider must check before giving these medications either way — but
  the pill text still says "Not specified" rather than misrepresenting a missing answer as a
  refusal.
- **Deliberately NOT added** to the registrant CSV export, the compliance audit workbook, or the
  Data table's free-text search box — owner's explicit call, out of scope for this change.

### `redactSensitive()` needed a line too — found by an independent review pass
`search.service.ts`'s `redactSensitive()` blanks every sensitive field on a cross-scope "All
churches" search hit (medical, dietary, parent contact, etc.) before it reaches a church/
zoneLeader login outside that person's `canAccessPerson` scope. `medicationConsent` was missed on
the first pass — it round-tripped in plaintext through that one path. Fixed same day, before
deploy. **Any new sensitive `Person` field must be added here too** — this is the second time a
field has needed adding to this specific function's blank-list; it does not happen automatically.

## Church previews see DAY 1 ONLY of the devotional — 2026-08-07 (3rd)

Owner request on launch eve. **SPA-only** — no backend, DTO, schema or migration change.
`npm run typecheck` clean, `npx vitest run` **1013 pass / 62 files** (unchanged — browser-only),
`node --check` OK on the SPA body (range **967–9558**, re-derived) and `sw.js`. `sw.js`
`camp-v96`→**`camp-v97`**. New `scripts/devotional-preview-harness.js` (**19 checks**).

### ⚠️ The existing day lock is INERT PRE-CAMP, which is the whole reason this was needed
`RENDER.devotional`'s original rule is `isCampToday && dy !== today` — it only bites when TODAY is
a camp day. Camp is 2026-09-28, so from the leaders' handout day a church login could tap
**"Preview at-camp view"** on the home screen (that card is shown in pre-camp to *all* roles) and
read **all four days** of devotional content weeks early. Day 1 is the only one meant to be
visible as a sample.

- New **`_devoDay1Only()`** — church role AND (`PREVIEW_MODE` || `ACCOUNT_PREVIEW`). Covers both
  preview kinds: the church's own at-camp preview and an admin previewing a church login (whose
  stated promise is "exactly as they see it").
- ⚠️ **`DEVO_DAY` is forced on EVERY render, not just when unset.** It is module-level and survives
  navigation, so a day picked before the preview was entered — or before the at-camp overlay was
  toggled on — would otherwise persist straight into the locked view.
- `selDevoDay` carries the same gate. The locked buttons already don't call it; this is
  belt-and-braces against a stale inline handler in an already-rendered screen.
- ⚠️ **Deliberately does NOT touch a real at-camp session** — there `isCampToday` already pins the
  view to today, which is stricter and correct — **nor any non-church role**. Harness cases 5–7
  pin all three no-regression paths.

> ⚠️ **CLIENT-SIDE BY NECESSITY, NOT BY OVERSIGHT — and NOT a privacy boundary.** `PREVIEW_MODE` is
> a purely client-side construct and the bearer token is the church's **real** token, so the server
> cannot distinguish a preview read of `/devotional/:day` from a genuine at-camp one. Proportionate
> because the content is a spoiler, not private data. **Do not "harden" this server-side** without
> first giving preview a real server-visible representation.

**`scripts/devotional-preview-harness.js`** runs the REAL extracted functions against stubs and
**self-extracts the block by its `/* ===== DEVOTIONAL ===== */` comment markers rather than a line
range** — the ranges quoted in this file have drifted repeatedly. **Proven to catch a regression,
not merely to pass:** replacing `_devoDay1Only`'s body with `return false` fails **8 of the 19**
checks.

## First-aid pre-camp testing — deployed 2026-07-06

Admin request. Superseded an earlier same-day approach (a dedicated sample church + 25 fake
students, fully reverted — see git history around commit `6c3bf3d` if it ever needs
resurrecting) once a cleaner fix was found: first-aid can already **search** any real
registrant regardless of arrival status (`search.service.ts` already lets `firstAid` see
`isRegistrant` people, not just `isCamper` ones — pre-existing, not new). The actual gap was
`note.service.ts`, which required `isCamper()` before a first-aid record could be
created/read at all — meaning first-aid record-keeping was completely untestable pre-camp
(nobody is a "camper" until the real Day-1 sign-in), and would have stayed broken even
against fake sample data seeded as `lifecycle:'registered'`. `npm run typecheck` clean,
`npm run test` = 450 pass (10 new). No schema change, no fake data.

- **`note.service.ts` `firstAidEligible(actor, person)`** — `isCamper(person) ||
  (actor.role==='firstAid' && isRegistrant(person))`. Used in place of the bare `isCamper`
  check in both `add()` (creating a record) and `recentFirstAid()` (reading them back).
  Every other role's note-eligibility is unchanged — only firstAid gets the pre-camp
  allowance, and only for people it can otherwise already access. A cancelled person is
  still never eligible for anyone.
- **`admin.service.ts` `setMode`** — on the real pre-camp → at-camp transition (same branch
  as the existing leader bulk-sign-in), every `category:'firstaid'` note is deleted. Safe and
  unambiguous: a real first-aid incident cannot happen before the camp is physically live, so
  every first-aid record that exists while still in pre-camp mode is by definition a test one.
  Testimonies and general notes are untouched.
- **"Not on site" flag suppressed pre-camp (SPA-only follow-up).** `faResultRow` (shared by
  Search and All Students — both already listed pre-camp registrants via the existing
  `scope=all`/`isRegistrant` fallback, no change needed there) and `openStudentInfo`'s header
  badge only show the red "Not on site"/"signed out / not on site" flag when
  `CAMP_MODE==='at-camp'`. Pre-camp, being "not on site" is the universal expected state, not
  an exception worth flagging on every single row — the flag returns as soon as the camp goes
  live.

