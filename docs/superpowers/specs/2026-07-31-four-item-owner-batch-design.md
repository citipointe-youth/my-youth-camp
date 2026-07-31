# Four-item owner batch — design (2026-07-31)

Owner-requested batch of four independent changes. Three are small and local; one (the
registration-list PNG export) is a genuine new feature.

Scope decisions recorded here were made by the owner in the brainstorming session on
2026-07-31. Where an alternative was rejected, the reason is stated so it is not silently
reintroduced later.

---

## 1 — Android "install as web app" prompt

**Ask:** on Android, opening the site for the first time should trigger the install-as-web-app
flow. iPhone must be unaffected.

**Key fact that makes this safe:** `beforeinstallprompt` is a Chromium event. **Safari/iOS never
fires it.** So no "not iOS" condition is needed anywhere — the iPhone path is untouched by
construction, and the existing `/install.html` Add-to-Home-Screen guide remains the iOS story.

**Chosen approach: custom in-app banner on the login screen.** Rejected: calling
`deferredPrompt.prompt()` automatically the instant the event fires. Chromium refuses a
gesture-less `prompt()` in some versions and the failure is silent — the user would get nothing
at all, with no fallback surface.

Implementation (`public/index.html`, SPA-only):

- `_installBanner()`, called at boot alongside `_loginTips()`.
- Listens for `beforeinstallprompt`; calls `preventDefault()` (suppressing Chromium's own mini
  infobar) and stashes the event in a module-level `_deferredInstall`.
- Renders a dismissible strip into a new `#installBanner` div under `#loginTips` on the login
  screen: *"Install this app on your phone"* + **Install** / **Not now**.
- **Install** calls `_deferredInstall.prompt()` **inside the tap handler** — the gesture-safe
  path. The event is single-use: it is nulled after `prompt()` and the banner is hidden.
- **Not now** sets `localStorage['ycp_installdismissed']='1'`; the banner never returns on that
  device. The `appinstalled` event sets the same flag.
- Gated on an **Android** user-agent test so desktop Chromium (which also fires the event) is
  unaffected. The owner asked for Android specifically.

Everything is inside a `try/catch` — `localStorage` throws in some privacy modes, and this code
runs on the login gate, where a throw would be maximally visible.

---

## 2 — Church home hero: accommodation narrowed to the login's gender

**Ask:** a church login's Home hero card lists **both** genders' accommodation; it should show
only that login's gender.

**Root cause:** `renderHomeAtCamp()` fetches `/accommodation/church-rooms/:churchId`, which
returns every room allocated to the church, and maps all of them into the hero strip. The
endpoint is church-scoped but not gender-scoped.

**Fix (SPA-only, no backend change):** `ACTOR.genderScope` is already on the client — church
logins are split `b-`/`g-` accounts and `toSafeUser()` carries `genderScope` (`'male'` |
`'female'` | `null`) through login and through the restored session. Filter the returned rooms
by it before formatting the line.

Two deliberate behaviours:

- **A `null` genderScope keeps both rooms.** A church account without a gender split (should not
  exist today, but the field is nullable) must not get a blank line. Null = no narrowing.
- **An empty filter result falls through to the existing "To be confirmed"**, the same string
  already used when the fetch fails or returns nothing.

Narrowing a *display* here cannot widen access — the endpoint was already church-gated.

---

## 3 — Registration list PNG export (new feature)

**Ask:** an admin-facing export that produces a PNG per grade of who is registered from a given
church, used in the lead-up to camp so each grade's leaders can be told who they have. Targeted
at Citipointe Brisbane (who run the app) but the church should be selectable.

### Placement and access

A new **"Registration lists (PNG)"** card on Admin → Records & Export (`RENDER.adminData`),
available to **admin and director** — the same reach as the Student data table card already on
that screen. Not admin-only: a director is the person most likely to be briefing grade leaders.

### Controls

- **Church** — dropdown from `/accounts/churches`, defaulting to the entry named
  *Citipointe Brisbane* (case-insensitive substring match), falling back to the first church.
- **Split** — `Automatic` (default) | `Whole church` | `By gender` | `By grade`. The owner asked
  for an override so the automatic tier can never be the wrong answer for a given moment.

### Tiering

Driven by the selected church's **student** count. Leaders never affect the tier.

| students | output |
|---|---|
| < 50 | 1 PNG — whole church |
| 50–100 | 2 PNGs — Guys, Girls |
| > 100 | 1 PNG per year level that has anyone in it |

**Plus one "Leaders" PNG for the church at every tier.** Leaders are one image per church, not
per grade — a church's leader team is small and is briefed as a unit.

Students whose `grade` is null get a **"Grade not recorded"** sheet in the by-grade tier rather
than being dropped. Silently omitting a registered student from a roll-call export is the worst
possible failure for this feature.

### Image content

- Fixed **1080px** width; height grows to fit the longest column.
- Header: church name · scope label (e.g. "Year 9", "Guys", "Leaders") · counts · generated date.
- Body: **two columns — guys left, girls right**. Single-gender images (the by-gender tier and
  the leaders sheet when one gender is empty) use one wide column.
- **Name only.** No payment status, no accommodation, no medical or contact data. These images
  are forwarded to multiple leaders over consumer messaging apps; this codebase encrypts most of
  that data at rest, and it must not be re-published on a shareable image.
- Order within a column: **oldest registration at top → newest at bottom**, so a leader re-reading
  the sheet sees new names appear at the bottom.

### Sort data — the one backend change in this batch

The true registration date is `elvantoMeta.dateSubmitted` (the Elvanto form submission date) and
it is **not currently exposed to the browser**. `createdAt` is, but it records when the import
first created the row, so a bulk import ties an entire batch at one timestamp and the order
within it is arbitrary.

`dateSubmitted` is therefore added to `RegistrantDto` / `toRegistrantDto`. Sort key, in order:
`dateSubmitted` → `createdAt` → `lastName`. Every step of the fallback is needed: pre-Elvanto
records have no meta, and equal timestamps must still produce a stable, sensible order.

No schema change — `elvanto_meta` is already persisted and already round-trips. This is a DTO
field only.

### Rendering and delivery

Client-side `<canvas>` → `toBlob()` → object-URL download. **No new dependency and no serverless
work**: the repo has `exceljs` on the server and a vendored `xlsx` in the browser, but nothing
that produces images, and generating PNGs in a Vercel function would add both a dependency and a
memory cost for something the browser does natively.

Filenames: `<church-slug>-<scope-slug>-<YYYY-MM-DD>.png`.

All images download immediately on click (owner's choice over a preview modal), **staggered
~300ms apart** — mobile Safari and Chrome throttle simultaneous downloads and silently drop the
tail, so an unstaggered loop would lose most of a 7-image by-grade run.

---

## 4 — Testimony picker: drop the church label

**Ask:** the student dropdown on Submit Testimonies lists `Name · Church`; remove the church.

`RENDER.testimonies` builds the `<option>` text as `${first} ${last} · ${churchName}`. Remove the
church for **all roles** (owner's choice). A church login's list is already church-scoped via
`_scoped('/campers')`, so the label was pure noise for them; admin/director lose a tiebreak
between two identically-named students in different churches, which is rare enough to accept.

The `churchName` field stays in the built `items` array — it costs nothing and the mapping is
shared shape with other pickers.

---

## Verification and deploy

- `npm run typecheck` clean.
- `npm run test` — 756 passing before this batch; the DTO change adds coverage for
  `dateSubmitted` (present, and null when there is no Elvanto meta).
- `node --check` on the extracted SPA script body and on `sw.js`.
- `public/sw.js` `camp-v57` → **`camp-v58`**.
- **No migration.** Nothing in this batch touches the schema.
- Push to `master` — that is the deploy (GitHub → Vercel auto-deploy).

Canvas layout and the Android install banner cannot be proven by typecheck or vitest; the owner
verifies both on-device. This is the repo's standing convention for CSS/layout and
browser-API work (see `debug.md`, "Verify & deploy conventions").
