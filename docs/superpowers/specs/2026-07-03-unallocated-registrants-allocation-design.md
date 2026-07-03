# Unallocated registrants & church-allocation overrides — design

**Date:** 2026-07-03
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** SPA (`RENDER.import`) + backend (new `allocation.service.ts`, `import.service.ts` hook, new entity/repo) + one migration.

## Problem

Most registrants have a real church pre-selected in the Elvanto form (`Attendee's Church`) and
are allocated to it at CSV import. Some pick the **"OTHER – please specify below"** option, whose
`Attendee's Church` cell holds a literal like `"Other - please specify below"` (exact string to be
confirmed against a real submission — see Detection). Today, `import.service.resolveChurch()` takes
whatever is in that cell and **auto-creates a junk church** from the literal string, silently
lumping every OTHER registrant into a fake church.

Three things are wanted:

1. A proper **"unallocated"** holding state for OTHER registrants, surfaced at the bottom of the
   Data Import screen with each person's ticket type, gender, grade, phone, and the free-text
   `"If from a church not listed, please specify church name & Youth Pastor"` note — each with a
   church dropdown + a confirm button to allocate them.
2. The ability to **override any registrant's church** via a search on the same page (in case
   someone signed up under the wrong church).
3. Forced allocations from both (1) and (2) **tracked and persisted across data imports**, so the
   admin retains awareness of who differs from the forms.

## Key facts established during brainstorming

- **Detection is by the church cell, NOT the note.** In real sample data (`Camp Sample Data.csv`),
  registrants selected a *real* church (`REDACTED Church`) **and** filled the free-text note
  (`Josh Gazzard`, a youth pastor). So a filled note is **not** an unallocated signal — using it
  would wrongly flag people who have a proper church. Detection keys off `Attendee's Church` being
  the "Other" literal (or blank). The note is display-only supporting info.
- **The free-text is already imported.** `Attendee's Church`'s companion column maps to
  `Person.churchUnlistedNote` (`elvanto-mapping.ts:24`, stored `import.service.ts:173`). No new
  field is needed to display it.
- **Manual allocation must win, persistently.** Decision: a manual allocation is authoritative and
  silently overrides the form on every future re-import, until the admin changes it.
- **The importer deletes anyone absent from the file** (`import.service.ts:376`) and matches rows
  by `(churchId, name)`. So an allocation stored only on the person record would be destroyed on
  the next re-import: the CSV row still resolves to "Other", won't match the moved person → the
  moved person is **deleted as absent** and a **duplicate** is created under "Other". The allocation
  must be re-applied **during** import, at church-resolution time.
- **Allocation target = existing churches only.** If a registrant's real church isn't in the system
  yet, the admin adds it via the normal Accounts screen first, then allocates.
- **Access = admin + director** (matches `import:run`).
- **Undo is required** on the tracked list.

## Design

### 1. Data model

**Unallocated sentinel church (constant, not a table row).**
`UNALLOCATED_CHURCH_ID` (e.g. `'__unallocated__'`) with `churchName = "Unallocated"`. A registrant
whose church cell is the "Other" literal/blank (and who has no override) is assigned this sentinel
instead of a junk church.

- `Person.churchId` stays non-nullable — no type changes, no scattered null-guards.
- RBAC auto-hides them: church/zone logins are scoped to their own `churchId`, so they never see
  sentinel people. Only admin/director see them (same effect the `needsReview` ticket orphans rely
  on).
- The sentinel is **not** returned by `churchRepo.findAll()`, so Accounts, budget per-church, and
  accommodation grouping never treat it as a real church. Unallocated people are excluded from
  accommodation eligibility (they have no real church).
- Minor: budget groups people by `churchId`, so unallocated people surface as an "Unallocated"
  bucket. Acceptable/informative; flagged, low priority.

**Allocation override store (new entity `AllocationOverride`, new repo + table).**

| Field | Purpose |
|---|---|
| `id` | PK |
| `firstNameKey` / `lastNameKey` | normalized name — re-match identity on import |
| `mobileKey` | normalized digits — disambiguates duplicate names |
| `assignedChurchId` / `assignedChurchName` | where the admin put them |
| `formChurch` | what the form said (the "Other" literal, or the wrong church) — powers the "differs from forms" list and defines undo-revert for `kind:'override'` |
| `kind` | `'unallocated'` (was OTHER) or `'override'` (reassigned from a real church) |
| `note` | `churchUnlistedNote` snapshot for display |
| `createdBy`, `createdAt`, `updatedAt` | audit |

Persistence mirrors the existing repo pattern (in-memory + JSON + Supabase). New migration adds the
table. **Purged by reset and new-year** — it references this season's registrants (transient data,
same lifecycle as people).

### 2. Import integration (satisfies part 3)

Only the **Form** importer changes (church is Form-owned; the delete-absent sweep is Form-only).

1. At import start, load all overrides and build an index keyed by `(firstNameKey, lastNameKey,
   mobileKey)`.
2. In the row loop, **right after `resolvedChurchId` is computed and after `mobile` is parsed, but
   before line ~208** (where `zone` and the accommodation override read `resolvedChurchId`): if the
   row's person matches an override, rewrite `resolvedChurchId` / `churchName` from it and emit a
   warning row *"Church forced to <church> by manual allocation"*.
3. Downstream is unchanged, which is the point: the row now resolves to the correct church, so it
   **matches the existing person** (`nameChurchKey` at line ~254), **updates in place**, stays in
   `seenIds`, and is **never deleted or duplicated**.
4. Rows with no override whose church cell is the "Other" literal/blank → assigned the
   **unallocated sentinel** (replaces junk-church creation).

**Composition with the existing accommodation-type override — verified, seamless.**
`zone` (`import.service.ts:208`) and `Church.accommodationOverride` (line 220) both key off
`resolvedChurchId`. Because the church-override redirect rewrites `resolvedChurchId` *before* those
lines, an allocated registrant automatically inherits **both** the assigned church's zone **and**
its accommodation override on re-import, in the correct order, with no special-casing. The
unallocated sentinel is not a real church, so no accommodation override applies to it (correct — the
person keeps their CSV/ticket accommodation until allocated). The two features are orthogonal: this
feature only writes `person.churchId/zone` and the override store; it never touches
`Church.accommodationOverride`.

**Duplicate-name safety.** Re-application matches by name + mobile. If ambiguous (same name, blank
mobile, >1 candidate) it **skips** re-applying with a warning rather than risk mis-assigning.

**Stale prune.** An override whose registrant no longer appears after an import (they withdrew) is
pruned as stale.

### 3. Backend API

New capability `allocation:manage` (admin + director) in `access-control.ts`. New
`allocation.service.ts` + a controller; routes in `router.ts`.

| Route | Behaviour |
|---|---|
| `GET /import/unallocated` | Unallocated people (sentinel churchId) with `registrationType` (ticket type), gender, grade, mobile, `churchUnlistedNote`. |
| `GET /import/allocations` | The tracked override list, enriched with current person + church names. |
| `POST /import/allocate` `{ personId, churchId }` | Upsert an override (keyed by the person's identity) **and** immediately set `person.churchId/churchName/zone`. Handles both cases; `kind` derived from whether the person is currently on the sentinel. **Also applies the target church's accommodation override immediately (students only)** via a shared helper reused by the importer, so allocation and import can't diverge. Re-allocating updates the same override (no duplicates). |
| `DELETE /import/allocations/:id` | Remove the override and revert the person — to the sentinel if `kind:'unallocated'`, or to the recorded `formChurch` if `kind:'override'`. Accommodation is left to be authoritatively recomputed on the next Form/Ticket import. |

Override-by-search reuses the already-loaded `/registrants` (admin sees all), filtered client-side —
no new search endpoint.

### 4. Frontend — bottom of the Data Import screen (`RENDER.import`)

- **Card A — "Unallocated registrants (N)"** (collapsible): each row shows name · ticket type ·
  gender · grade · phone · free-text note, with a **churches dropdown + Confirm** button (Confirm is
  the mistake-guard). On confirm → `POST /import/allocate`; the row moves to Card B; toast.
- **Card B — "Church overrides / forced allocations (N)"** (the tracked list): each override shows
  person · *form said X* → *assigned Y* · who/when · **Undo**. This is the "who differs from the
  forms" awareness list. It also hosts the **override-by-search** control: a name search over
  registrants → pick person → churches dropdown → Confirm, gated behind a **confirm modal** (moving
  someone off a real church is the riskier action).
- `sw.js` `CACHE` bump (HTML changed).

### 5. Testing

- `Other`/blank → sentinel, not a junk church.
- `allocate` persists an override and sets the church + accommodation override immediately.
- **Key regression:** allocate a person, then re-import the Form → the person keeps their assigned
  church, is **not** deleted, and **no** duplicate is created; zone + accommodation override of the
  assigned church are applied.
- Override wins on form conflict (form later names a different real church → manual still wins).
- Undo reverts correctly for both `kind`s.
- Duplicate-name ambiguity is skipped safely with a warning.
- Files: extend `import.service.test.ts`, new `allocation.service.test.ts`, extend
  `multi-source-import.integration.test.ts`.

### 6. Verification

`npm run typecheck` clean · `npm run test` green · SPA `node --check` OK. Migration applied to prod
before/with deploy (Supabase settings/writes constraint noted in CLAUDE.md). No localhost/browser
testing per repo convention; flag the new cards for on-device eyeballing. Push to `master` deploys.

## Out of scope (YAGNI)

- Editing any registrant field other than church from these cards (name/medical/etc. stay on the
  existing Individual Student Data Edit screen).
- Creating a new church from the allocation UI (admin adds it via Accounts first — explicit
  decision).
- Auto-parsing the free-text note to guess a church (display-only).
