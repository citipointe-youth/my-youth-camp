> Moved out of CLAUDE.md on 2026-10-02. Migration numbers, test counts and `camp-vNNN` labels inside dated sections are as of that date — `supabase/migrations/` and `git log` are the source of truth.

# Reference: auth and accounts

> Moved out of CLAUDE.md on 2026-10-02. Dated headings may be wrong: trust `git log`.

## Login activity: leadership first, one-line rows — 2026-09-22 (2nd)

Owner request against the 2026-09-20 screen below. **SPA-only** (`public/index.html`) — no
backend, DTO, schema or migration change. `npm run typecheck` clean, `npx vitest run` **1101 pass**
(unchanged — browser-only), `node --check` OK on the SPA body (range **994–10376**, re-derived) and
`sw.js`. New `scripts/login-activity-harness.js` (6 checks). `sw.js` `camp-v118`→**`camp-v119`**.

- **Order** is now `_loginActivityOrder(users)` (pure, extracted **by name** by the harness — never
  rename it): leadership/first-aid first (Admin → Director → Zone leader → First aid, then
  username), then church logins **by church name, then username**, so each church's
  `b-`/`g-`/`all-` logins sit together. ⚠️ This **replaces** the old worst-first
  (never-logged-in-first) sort; the "N of M church logins haven't logged in yet" line is kept.
- **Labels:** leadership rows read `<Role>: <username>` (`Admin: admin`, `First aid: firstaid`);
  church rows are the bare username — the church is in it, so the "Church · <church name>" line
  is gone. An inactive account gets a `· inactive` suffix (it used to be on that removed line).
  Display name (first/last) is no longer shown.
- **One line per account** (`.la-row`/`.la-line`, ~7px padding). A logged-in row is a
  `<details>` whose `<summary>` **is** the row — tap it to expand the timestamp list; the separate
  "History (n)" link is gone. A never-logged-in row is a plain, non-expandable div.
- **Not verified on a device** (repo convention). Owner to eyeball: row height, the ⌄/⌃ cue on the
  right, and that tapping a logged-in row expands it.

## Login activity tracking — migration `0026` — 2026-09-20

Admin-only screen showing per-church login activity ahead of camp. Backend records the last ~15
login timestamps per account into a new `users.login_history` JSONB column (migration `0026`,
additive/nullable, no backfill needed — **must be applied to prod before this code deploys**: `save()`
upserts `login_history` on every user write, so a pre-migration deploy 500s every account edit,
password reset and church creation (login itself stays up — the write is fail-open). Failures during
the write are fail-open and never
block a successful login. `npm run typecheck` clean, `npx vitest run` **1101 pass / 64 files**
(was 1097; **+4**, all in `auth.service.test.ts`). `node --check` OK on the SPA body and `sw.js`.
`sw.js` `camp-v113`→**`camp-v114`**.

### Who sees it and what it shows
The new "Login activity" screen is **admin-only**, reachable from the admin console's "People &
churches" group. It shows: a summary "N of M church logins haven't logged in yet" (rows were
sorted worst-first by days-since-last-login — **superseded 2026-09-22, see the section above**), and for each account, its last login time or "Never logged in",
with an expandable dropdown showing the last up-to-15 login timestamps (newest-first). Owner's
stated purpose: seeing which churches haven't logged in yet ahead of camp (2026-09-28) so they can
reach out and help.

### New tests in `auth.service.test.ts`
- A login records a timestamp
- History is capped at `MAX_LOGIN_HISTORY` (15) newest-first
- A failed login does not record anything
- A `save()` failure during the write never blocks a successful login

## Optional per-church dual-gender login (`all-<slug>`) — migration `0024` — 2026-09-14

Owner request: in addition to the existing `b-`/`g-` gender-scoped church logins, let an admin
add ONE optional third login per church that sees **both** genders — without touching the
existing pair's passwords, and without it surviving new-year rollover. Backend + SPA +
**migration `0024`**. `npm run typecheck` clean, `npx vitest run` **1089 pass / 64 files** (was
1083/64; **+6**). `node --check` OK on the SPA body and `sw.js`. `sw.js`
`camp-v111`→**`camp-v112`**.

> ⚠️ **NOT YET APPLIED TO PROD, NOT YET LIVE-TESTED — DELIBERATELY.** Camp starts 2026-09-28 and
> real leaders are already using their `b-`/`g-` logins pre-camp; the owner asked that nothing
> touching account rotation be exercised against the live system until after the current camp
> cycle finishes. Migration `0024` must be applied to prod BEFORE this code deploys (standing
> rule — see below), but do not run "Randomise & export passwords" against prod to verify the
> dual-login row until then.

### It needed almost no new RBAC — `genderScope: null` already means "see both"
`canAccessPerson` (`person.service.ts`) only narrows by gender when `actor.genderScope` is
truthy; capabilities (`checkin:write`, `note:write`, …) are granted by `role:'church'` alone,
never by gender scope. So the dual login is just a normal `role:'church'` user with
`genderScope: null` — every read/write path already does the right thing for it with **zero**
RBAC code change. The only genuinely new piece is telling it apart from a genuine legacy
pre-split combined login, which is `role:'church'` + `genderScope: null` too.

### `is_dual_gender_login` — one boolean, and two existing functions had to learn about it
`retireLegacyChurchLogins()` deletes any `role:'church'` account with a null `genderScope` for a
church, on the theory that it's the old un-split combined login (2026-07-17). **The dual login
matches that exact shape.** Without excluding it, the FIRST "Randomise & export passwords" or
"Split church accounts" run after creating one would have silently deleted it as "legacy" — found
by reading `retireLegacyChurchLogins` before writing to it, not by a test failing after the fact.
`rotateChurchLogins()` (shared by both randomise endpoints) now also rotates an existing dual
login's password and includes it in the CSV, per the owner's explicit choice — it is never
*created* there, only refreshed if already present.

### New-year rollover — the guard is ONE line, at the snapshot, not at the restore
`newYear()` already deletes every non-admin account and restores only from the `saveDefaults()`
scaffold snapshot. So excluding `isDualGenderLogin` users from that snapshot is the *entire*
guarantee — the dual login cannot survive rollover regardless of when in the year it was
created relative to the last Save Defaults, because `newYear()` never sees it at all. `reset()`
needed no change (it wipes every non-admin account unconditionally already).

### SPA — deliberately kept OUT of the b-/g- pair-rename machinery
`_churchAccts()`/`editChurchName`/`bulkChurchUpdate` treat a church's login(s) as a base username
with a `b-`/`g-` prefix re-applied on save (`_churchPrefix`). The dual login's username has an
`all-` "prefix" that `_churchPrefix` doesn't know about (it returns `''` for a non-gender-scoped
account) — leaving it inside `_churchAccts()` would have meant the very next church rename
silently rewrote `all-<slug>` down to bare `<slug>`, losing the prefix. It's excluded from
`_churchAccts()` and rendered as its own `.ch-dual` row underneath the `.ch-halves` pair (an
"Add dual-gender login" ghost button when absent; username + change-password/preview/delete when
present) — reusing the existing generic `changePassword`/`confirmEnterAccountPreview`/`delAcct`
functions, so removal is just the ordinary `DELETE /accounts/users/:id`, no dedicated route.
Deleting the whole church (`deleteChurch`) still removes every login for it, dual included, since
that loop is keyed on `churchId` alone.

## 48h sessions + a session KILL SWITCH, church-only password reset, `/ready`, throttle 10→15 — 2026-08-05 (2nd)

Pre-launch batch. The churches get their passwords on **Sat 2026-08-08** (~100 leaders log in
and browse; camp itself is 2026-09-28). Backend + SPA + **migration `0021`**. `npm run
typecheck` clean, `npx vitest run` **1013 pass / 62 files** (was 990/61; **+23**, **+1 file**).
`node --check` OK on the SPA body (range **967–9518**, re-derived) and `sw.js`. `sw.js`
`camp-v92`→**`camp-v93`**. Built by three parallel Sonnet subagents on disjoint file sets
(auth / accounts+http / SPA), each verified independently afterwards.

> ⚠️ **DEPLOY ORDER IS NOT FREE CHOICE. Apply `0021` to prod BEFORE pushing the code.**
> `supabase.settings` writes **every column on every save**, so until the columns exist every
> settings save, mode switch and new-year **fails in prod**. Same standing rule as `0015`–`0020`.

### 1 — 🔴 LOCKING A ROLE DIDN'T LOG ANYONE OUT, AND THE TTL DOUBLING MADE THAT WORSE

`churchLoginLocked` / `zoneLeaderLoginLocked` only ever blocked **new logins** — the comment
block in `auth.service.ts` said so outright. Sessions are stateless HMAC (`signSession`) with no
revocation, so an admin who locked the churches after camp left **every leader already holding a
token signed in until it expired** — a live session into minors' PII after the admin believes
it is closed. Doubling the TTL to 48h doubles that window, which is why the two ship together
and must not be separated.

- **`TOKEN_TTL_MS` 24h → 48h.** *Why:* leaders run this as an **installed PWA on iPhones**, and
  iOS AutoFill is unreliable inside the installed app (it works in Safari). Every expiry means
  hand-typing a password on a phone at camp.
- **`issuedAt` (epoch ms) now travels in the signed payload** (`signSession`/`parseSession`).
- **Two nullable ISO columns on `CampSettings`** — `churchSessionsValidFrom`,
  `zoneLeaderSessionsValidFrom` (migration `0021`). `resolveToken` revokes a `church`/`zoneLeader`
  token whose `issuedAt` predates the matching epoch.
- ⚠️ **PER-ROLE, NOT ONE GLOBAL EPOCH.** A global epoch would sign the **admin** out at the
  exact moment they lock the churches — i.e. the one action that most needs an admin still
  logged in. Per-role mirrors the existing per-role toggles and leaves admin/director/firstAid
  unaffected **by construction** (there is no epoch field for them to read).
- **Wired to the existing toggle, no new admin control.** `settings.service.update()` stamps the
  epoch on a **false→true transition only**.
  - ⚠️ **Turning the lock back OFF must NOT clear the stamp.** A fresh login mints a newer
    `issuedAt` and works fine; old tokens stay dead. Clearing it would resurrect them.
  - ⚠️ **A redundant true→true save must NOT re-stamp** (found by the subagent, not in the
    spec). Otherwise an admin renaming the camp minutes after locking the churches would kill a
    session that logged in one second earlier. There is a test pinning this.

### 1b — The cost is bounded to 60s, and it FAILS OPEN on purpose

`resolveToken` did **zero I/O** and that was deliberate. It still does for every role except
church/zoneLeader — `isSessionRevoked` returns `false` immediately for anyone else. When it does
read settings it goes through `response-cache.ts` at a **60s** TTL, so lock-to-logout latency is
up to 60s (owner-accepted).

- ⚠️ **A SETTINGS-READ FAILURE ALLOWS THE REQUEST.** A transient DB blip must never lock the
  whole camp out mid-check-in. The failure direction is deliberate — do not "harden" it to deny.
- ⚠️ **The failure is deliberately NOT cached**, so the next call retries rather than pinning
  "nothing is revoked" for a full 60s on one transient error.
- ⚠️ **The cache is instance-scoped (inside `makeAuthService`), not module-scoped.** Module scope
  leaks one test's settings fixture into the next test in the same process and makes the
  revocation tests non-deterministic.
- **Legacy tokens** (minted before `issuedAt` existed): **missing `issuedAt` + epoch set →
  REVOKE**. At deploy no epoch is set, so nothing breaks; the rule only bites once a role is
  actually locked, which is the intent.
- `makeAuthService(users, settings?)` takes settings **optionally** (many unit tests build it
  without one) — undefined is treated as "no epoch on record". **Both real composition paths
  (`container.ts:212` and `:367`) pass it**, verified; if a third is ever added and forgets, the
  kill switch silently does nothing.

### 2 — A CHURCH-ONLY "randomise & export", beside the existing all-accounts one

Since 2026-08-03 the one button rotated church logins **and** all leadership accounts
(director/zoneLeader/firstAid/secondary admins, never the original admin). The owner needs to
re-issue **church** passwords after Saturday without invalidating the leadership logins.

- New `randomizeChurchOnlyPasswords(actor)` (`admin:manage`), route
  **`POST /accounts/churches/randomize-church-passwords`**, same `ChurchCredential[]` shape.
- ⚠️ **REFACTORED, NOT COPY-PASTED.** The church loop is now the single private
  **`rotateChurchLogins()`** (`account.service.ts:248`); `randomizeChurchPasswords` calls it and
  then adds the leadership loop. Two divergent copies of credential rotation is exactly how the
  wrong accounts get rotated.
- The load-bearing test asserts every **non-church password hash is byte-identical before and
  after**, and that no leadership row leaks into the CSV. A test that only checked the returned
  rows would pass while silently rotating passwords.
- SPA: one shared **`_pwRandomiseExport(endpoint, filenamePrefix, noneMsg, toastVerb)`** backs
  both buttons — do not write a second exporter. Church-only downloads as
  `church-passwords-<date>.csv` vs `camp-passwords-<date>.csv` so they don't collide in
  Downloads. (The upload path matches on the **`Username` column, not the filename**, so both
  round-trip.)
- ⚠️ **FIFTH BRUSH WITH THE FLEX BUG — the row now has THREE buttons.** `.btn` is
  `display:block;width:100%`, which becomes the flex-basis. The row is `flex-wrap:wrap`, the two
  randomise buttons are `flex:1;min-width:150px`, Upload stays `flex:0 0 auto;width:auto;
  min-width:92px`. Previously fixed 2026-07-08, twice on 2026-08-02, and 2026-08-05.

### 3 — `GET /ready` — because `/health` stays GREEN through a total DB outage

`/health` returns `{status:'ok'}` **without touching the database**. It is a liveness probe, so
an uptime monitor pointed at it reports healthy while every screen 503s — the exact failure it
looks like it is watching for.

- New **`GET /ready`**: `select 1` via the existing `getSqlClient()` singleton, raced against a
  **5s `READY_DB_TIMEOUT_MS`** (well under `maxDuration:30` and the role-level 15s
  `statement_timeout`), so a hung pooler fails fast instead of hanging the monitor.
- **200 `{status:'ready',db:'ok',ms}` / 503 `{status:'degraded',db:'error'}`.** The **status
  code** is the contract — monitors alert on non-2xx.
- ⚠️ **Unauthenticated on purpose** (a monitor can't log in) and the body **never** carries a
  connection string, hostname or driver error — that detail goes to `logger` only.
- `PERSISTENCE !== 'supabase'` returns `{status:'ready',db:'n/a'}` — honest, not a fake pass:
  there is no DB to check.
- ⚠️ **Do NOT add a DB check to `/health`.** The pair is the point. **An external monitor must
  be repointed at `/ready` to actually catch a pooler outage.**

### 4 — Login throttle 10 → 15 failures (owner)

`express-adapter.ts`. **A church login is SHARED by several leaders**, so the ip+username bucket
is not one person's typos — it is the whole church's, and on a church/camp WiFi they share the
IP too. At 10, a handful of leaders fumbling the handed-out password locked their **entire
church** out for 15 minutes on the very day the passwords go out. 15 keeps a real brute-force
backstop (keyspace ~117k since 2026-07-31) while absorbing normal fumbling. Window and
failures-only keying unchanged.

### 5 — ~~iOS: tell people about the 🔑 key~~ — SHIPPED THEN REMOVED THE NEXT DAY (`camp-v95`)

iOS 18 **does** support AutoFill in an installed web app, but the saved credential sits behind
the key (🔑) button in the QuickType bar rather than being offered prominently as in Safari — so
leaders hand-type. `_loginTips()` gained one line when `_isIOS() && _isStandalone()`.

⚠️ **Removed 2026-08-06 at the owner's request: it was one line of small print too many.** The
login screen is back to its two links. **The PREMISE IS STILL TRUE and still worth knowing** when
someone reports "AutoFill doesn't work in the installed app" — it just doesn't belong on the
login screen, where a third line competed with the two links that actually go somewhere. If it
is ever needed again, put it in `/save-password.html`, not `_loginTips()`. A `DON'T RE-ADD`
comment sits at the removal site.

Still true and load-bearing for whatever *does* live in `_loginTips()`: `_isIOS`/`_isStandalone`
are declared *after* it runs but **hoist** (function declarations) and both self-wrap in
try/catch — **don't "fix" that by moving things.** The UA gate (phones only) and the
can't-throw-on-the-login-gate property must both be preserved. Both helpers remain in use by the
push card, so neither is dead code. `#mcpGate` deliberately untouched throughout.

### 6 — "Send a test" is admin-only (follow-up push, `camp-v94`)

The push card on the Notices screen showed **Send a test** to every account with alerts on. It
was clutter for the ~100 church/leader logins. Now gated on `ACTOR.role === 'admin'`.

- ⚠️ **UI-ONLY HIDE — `POST /push/test` stays open to any authenticated account, deliberately.**
  `sendTestToUser(actor.id, …)` only ever pushes to the **caller's own** devices, so there is
  nothing to escalate and no security reason to lock the route. Read the 2026-07-31 push section
  before "hardening" it: the route exists so a device can be *proven working*, and an admin
  diagnosing a leader's phone may still want it reachable.
- **Trade-off accepted by the owner:** a leader can no longer self-test that alerts reach their
  phone — that diagnosis now goes through an admin. Zero cost at the time of the change
  (`push_subscriptions` was empty), but it will matter once leaders opt in at the training day.

### Needs on-device eyeballing (tsc/vitest cannot prove any of it)
The **three-button** password row at ~360px · an end-to-end run of the church-only button
against the live endpoint · the login screen back at **two** tip lines (`camp-v95`).

### Verified live in prod after the push
`sw.js` served `camp-v93`; **`GET /ready` → `200 {"status":"ready","db":"ok","ms":2}`** — first
end-to-end proof the readiness probe reaches Postgres through the session-mode pooler from
`syd1`. Migration `0021` applied to prod **before** the code push, and its history row
reconciled from the generated `20260805100813` back to **`0021`** (the N6 label drift), so prod
now reads a clean `0001`–`0021`.

**An external uptime monitor is live against `/ready` as of 2026-08-05** (owner). ⚠️ Keep it
pointed there, **never at `/health`** — `/health` never touches the DB and stays 200 through a
total pooler outage, which is the whole reason `/ready` exists.

## Password UPLOAD — the reverse of the credentials export — 2026-08-05

Owner request: *"a small button to the right of it for 'upload' that does the exact reverse (sets
the passwords for account names found that match)"*, with resilience for blank passwords and for
a file covering only a subset of churches. Backend + SPA. **No schema or migration change** —
next migration is still `0021`. `npm run typecheck` clean, `npx vitest run` **981 pass / 61 files**
(was 950/60; **+31**, and **+1 FILE** — a new test file), `node --check` OK on the SPA body
(range **966–9477**, re-derived) and `sw.js`. `sw.js` `camp-v90`→**`camp-v91`**.
Built by two parallel Sonnet subagents (backend / SPA — disjoint files), then independently
reviewed by a third, which found the race in "The dry run is not a nicety" below.

Export the credentials CSV, edit the Password column, upload it back. Same card, same columns,
so the round trip is exact. Reads `.xlsx` too, free, via the existing `_readImportFile`.

### The decision logic is a PURE module, and that is the point
New **`src/services/password-import.ts`** — `parsePasswordRows` / `planPasswordImport` /
`missingPasswordColumns` / `PASSWORD_IMPORT_COLUMNS` / `MIN_IMPORT_PASSWORD_LENGTH`. No repo, no
hashing, no clock. `account.service.importPasswords` only does the three things a pure function
cannot: read the users, hash, save.

> **Almost every rule in this feature is a FAILURE path** — a blank cell, an unknown username, a
> half-filled sheet, the same login listed twice. Those are exactly the cases nobody exercises by
> hand before camp, so they had to be testable without fixtures. 19 tests on the planner, 6 on the
> service.

### The rules, and why each one is what it is
- ⚠️ **A BLANK PASSWORD CELL SKIPS THE ROW. It must NEVER clear a password.** The natural way to
  say "don't change this one" in a spreadsheet is to empty the cell, and the natural (wrong)
  reading of that is "set it to nothing" — which would lock a church out with no error at all.
  `parsePasswordRows` deliberately KEEPS a username-with-no-password row so the planner can count
  it as a deliberate skip rather than silently losing it.
- **Accounts absent from the file are untouched by construction** — they are simply never in
  `plan.apply`. That is what makes a one-church or a few-leaders list safe, and it needs no
  special case.
- ⚠️ **Matching is the `Username` column ONLY, lowercased.** Usernames are stored lowercased and
  unique, so it is exact. **Do not add a church/gender fallback** — a church-name typo would then
  set the *wrong account's* password, and it would reconcile perfectly to whoever read the sheet.
  An unrecognised username is reported by name, never guessed at.
- ⚠️ **The original admin is refused even when listed** (`findOriginalAdmin`), same reasoning as
  `randomizeChurchPasswords`: it is the recovery account, and a typo there is how a camp ends up
  with no way into the back office at all.
- ⚠️ **INACTIVE ACCOUNTS ARE SET — deliberately, and this DIFFERS from
  `randomizeChurchPasswords`, which skips them.** The owner chose it explicitly. The two are not
  inconsistent: randomise *distributes* a CSV, and putting a working credential for a deactivated
  login into a distributed file is the opposite of deactivating it; this direction *consumes* a
  curated file, where pre-staging an account you are about to reactivate is a real thing to want.
  Every inactive username is reported back — "set, but the account is deactivated and still cannot
  log in" — because a password that works on a login that doesn't is otherwise a silent trap.
- ⚠️ **A missing `Username`/`Password` column is a HARD ERROR naming the columns actually found.**
  `field()` returns `''` both for an empty column and for one it cannot find, so without this the
  wrong file parses as "every row blank" and the import reports a clean, successful, entirely
  empty run. Same silent-success shape as the renamed care column (2026-08-04) and the
  double-encoded snapshot. `missingColumns()` is reused, so ordinary case/spacing drift still
  does not trip it.
- **Same username twice with DIFFERENT passwords → both rejected**, named. Picking one would set a
  password the admin cannot predict. An identical duplicate is a copy-paste and applies once.
- **Under 6 chars → that row rejected, every other row still applies** (matches
  `SetPasswordSchema`'s `z.string().min(6)`; keep the two in step).
- **`mustChangePassword: false`**, matching the randomise path. These ARE the real passwords the
  admin chose and is handing out, not admin-set temporaries.
- ⚠️ **No plaintext password is ever in the response.** `PasswordImportResult` carries counts and
  usernames only. The request already carried them; echoing them into a response a browser caches
  and logs widens the exposure for free. There is a test asserting the password string appears
  nowhere in the serialised result.

### The dry run is not a nicety
`POST /accounts/passwords/import {csvData, dryRun}` (`admin:manage`). The SPA previews first, then
confirms.

> **The two mistakes this feature invites are both SILENT: a mistyped username sets nothing, and
> the wrong file entirely matches nothing.** Without a preview both are indistinguishable from
> success. When `willSet` is 0 the preview says so in a warnbox and **renders no Confirm button
> at all** — a button that would "succeed" at doing nothing is worse than none.

Every skipped row is **named, not just counted**. "3 not matched" sends an admin back to a 30-row
spreadsheet with no idea which three, which is how a genuinely wrong file gets confirmed anyway.
`dryRun` runs the identical code path and stops before the writes, so the preview cannot disagree
with what the confirm then does **on the server**. The client was a different story:

> ⚠️ **THE PREVIEW AND THE CONFIRM COULD DESCRIBE DIFFERENT FILES — found in independent review,
> fixed same day.** `_pwUpCsv` was armed synchronously after the file read but the box was
> painted after the *network* await, so two overlapping uploads could split them: pick a file,
> realise mid-request it is the wrong one, tap Upload again and pick another; if the FIRST
> request's response lands last it repaints the box with the OLD file's preview and filename
> while the confirm button holds the NEW file's text. You would then confirm a file you never
> reviewed — on the one screen in the app that rewrites credentials, and the preview is this
> feature's entire safety net.
>
> Fixed with `_pwUpSeq`: bump on entry, blank `_pwUpCsv` immediately (a superseded upload must
> never leave a live confirm behind), and bail after **every** await if another upload started.
> **The armed text is assigned last, beside the paint** — that pairing is the actual fix; the
> sequence alone would not guarantee it. `_pwUpConfirm` likewise **captures the csv and the
> sequence BEFORE awaiting `confirmSheet`**, or a new upload started while that sheet is open
> would blank it (posting nothing) or replace it (posting a file the confirmation never
> described). **Do not "simplify" either half back into a bare module variable read after an
> await.**

### The parser and the column guard must accept the SAME headers
Also from the review: `parsePasswordRows` accepted a `Login` column that `missingPasswordColumns`
knew nothing about, so a `Login,Password` file was **rejected up front with a message claiming
`Username` was missing** while the parser would have read it perfectly. Resolved by DELETING the
speculative aliases rather than teaching the guard about them — `field()` already normalises, so
the single `'Username'` alias resolves `User name` / `USERNAME` / `user_name`, exactly matching
what `missingColumns()` accepts. ⚠️ **Add an alias to BOTH or NEITHER**: a guard stricter than the
parser rejects good files, a guard looser than it lets a silently-empty run through. There is a
`describe` block asserting the two agree across five header spellings and disagree on none.

### Round-trip test — the one that proves the feature works
`describe('round trip from the real credentials export')` rebuilds the exporter's output
byte-for-byte (BOM + CRLF + quoted fields, including a church name containing a comma) and feeds
it back through the real parser. Its value is **pinning the column names and quoting across the
two sides** — rename a column on either end and this fails instead of the feature silently
no-opping. ⚠️ It does *not* prove BOM handling: that is double-covered anyway (`parseCsv` strips
the BOM **and** `field()`/`missingColumns()` normalise it away), so removing either one alone
would not fail a test.

### SPA
`uploadPasswords` / `_pwUpPreview` / `_pwUpNote` / `_pwUpConfirm` / `_pwUpCsv`, immediately after
`randomizeChurchPasswords`. The button sits in a flex row beside it.

- ⚠️ **FOURTH OCCURRENCE OF THE SAME FLEX BUG, pre-empted this time.** `.btn`'s base CSS is
  `display:block;width:100%`, and inside a flex row that `width:100%` becomes the **flex-basis**,
  so a bare `.btn` claims the row and squeezes its sibling to nothing. The Upload button is
  `btn ghost sm` + `flex:0 0 auto;width:auto;min-width:92px`, and Randomise is `flex:1;min-width:0`.
  Previously fixed 2026-07-08 and twice on 2026-08-02.

## Forced password change for admin-set/temp passwords — deployed 2026-07-11 (public-repo privacy audit)

> **⚠️ DISABLED 2026-07-11, at the owner's request** (same day it shipped). The gate is a no-op:
> `MUST_CHANGE_PASSWORD_ENFORCED = false` in both `src/api/http/express-adapter.ts` and
> `public/index.html` (two separate constants that must be flipped together — bump `sw.js`'s
> `CACHE` when you touch the HTML one). Everything else described below — the flag-setting in
> `account.service`/`admin.service`, the `must_change_password` column, the self-service
> `POST /accounts/me/password` endpoint, the frontend gate screen — is still fully wired up and
> dormant. Flipping both constants back to `true` re-enables it immediately, retroactively
> covering any account flagged while it was off (an admin password reset or new-year rollover
> still sets the flag even while enforcement is disabled).

A privacy audit of the public GitHub repo (`citipointe-youth/my-youth-camp`) found two issues:
`src/services/multi-source-import.integration.test.ts` (plus two comments referencing it) carried
real PII from an actual 2026-07-02 Elvanto export (names, DOB, mobile numbers, emails, Medicare
numbers, a medical condition, addresses) — replaced with fictional sample data (the tests only
ever asserted on structural values — names-as-lookup-keys, grades, ticket/invoice numbers, amounts
— never on the PII fields themselves, so nothing else needed to change). And, mirroring the CMS
audit finding, `CLAUDE.md`'s seed-account table sat directly under a documented shared default
password, and `public/index.html`'s demo quick-login button ships that literal password (plus the
real username list) in the production JS bundle regardless of the `_isDemoHost()` UI gate — unlike
CMS, no migration seeds named production accounts with it, so this closes the gap for good rather
than reacting to one already-leaked list.

- **`User`/`Actor.mustChangePassword`** (`src/core/entities/user.ts`), embedded in the signed
  session token (`toActor()` in `auth.service.ts`) and enforced in `express-adapter.ts` right
  after `resolveContext`: any route without `allowMustChangePassword: true` on its `Route` entry
  throws `MustChangePasswordError` (403, code `MUST_CHANGE_PASSWORD`) for a flagged actor. Only
  `GET /auth/me`, `POST /auth/logout`, and the new `POST /accounts/me/password` are allowlisted.
- **New self-service endpoint**, `POST /accounts/me/password` (`account.service.changeOwnPassword`)
  — this app previously had no way for an account holder to change their own password, only
  `POST /accounts/users/password` (admin resetting someone else). Verifies the current password
  server-side, then clears the flag; the only path that ever clears it.
- **Who gets flagged:** `account.service.setPassword` (admin resets an existing account's
  password) and the new-year rollover's generated temp passwords (`admin.service.ts` `newYear`) —
  both were previously admin-chosen/generated passwords trusted with no enforcement (temp
  passwords were advisory-only: "should set their own password"). Deliberately **NOT** flagged:
  `createUser`/`createChurchWithAccount` (initial account creation, admin present) — narrower
  scope, matching the equivalent CMS decision, to avoid extra friction on accounts an admin just
  walked someone through setting up.
- **Frontend** (`public/index.html`): `doLogin()`/`_tryRestoreSession()` check
  `ACTOR.mustChangePassword` and route to `_showChangePasswordGate()` (a full-page gate reusing
  the `#login` card styles) instead of the normal app shell. `_doFetch` also catches a
  `MUST_CHANGE_PASSWORD` response code defensively (a stale cached `ACTOR` without the flag hitting
  a gated route) and shows the same gate. `sw.js` `camp-v21`→`camp-v22` (HTML changed; →`v23` for
  the disable toggle above).
- **Migration `021_must_change_password.sql`** — adds `users.must_change_password` (default
  `false` — does not retroactively flag any existing row; no email-list backfill was needed since,
  unlike CMS, no migration here ever seeded named production accounts with a known password).

## Account preview (read-only impersonation) — deployed 2026-07-15

Admin → Accounts (`RENDER.adminAccounts`) gets a **Preview** (eye) button on every **active
non-admin** account tile (church / zoneLeader / director / firstAid; never admin). It drops the
admin into a real, RBAC-scoped session as that account, but **read-only** — every write is blocked
client-side, so sign-in/out logs, notes, and audited reveals are never touched. Distinct from the
same-user "At-camp preview" section below, which this composes with. Design + rejected alternatives:
`docs/superpowers/specs/2026-07-15-account-preview-design.md`; plan:
`docs/superpowers/plans/2026-07-15-account-preview.md`. `npm run typecheck` clean, `npm run test`
= **465 pass**, SPA `node --check` OK. `sw.js` `camp-v23`→`camp-v24`. **No migration.**

- **Backend:** `POST /accounts/users/:id/preview` (admin-only) → `AccountService.previewAccount`
  (validates active + non-admin) then `AuthService.issueTokenFor(id,{mustChangePassword:false})`
  mints a real scoped token. **`issueTokenFor(userId, actorOverrides?)` is NEW** on `AuthService`
  (the app had no token-minting-for-another-user path before; `signSession` is module-private); all
  existing call sites are unaffected. The account controller gained an `auth` dependency (wired in
  `router.ts`). **No preview flag on the `Actor`** — read-only is enforced entirely client-side
  (deliberate scope decision: admin-only feature; the client guard reliably prevents the accidental
  writes that would pollute the audit; the minted token is fully capable server-side).
- **Frontend (`public/index.html`):** `enterAccountPreview(id)`/`exitAccountPreview()` swap the API
  token + `ACTOR`, `Cache.clear()`, and rebuild nav/tabs from the swapped actor (real RBAC, no
  client-side scoping duplication). The admin's own session is stashed in `_previewStash`, mirrored
  to `localStorage['ycp_preview_stash']` so a mid-preview refresh restores into the preview
  (restored in `_tryRestoreSession`). The write-guard in `api()` now blocks non-GET when
  `PREVIEW_MODE || ACCOUNT_PREVIEW`. The preview POST uses `_doFetch` (not `api`) so it isn't
  self-blocked. `confirmEnterAccountPreview(id)` shows a confirm modal first (looks the account up
  from `window._allUsers`, not via the `onclick` string).
- **Mode composition:** `ACCOUNT_PREVIEW` is orthogonal to `PREVIEW_MODE` (both can be true). A
  generalized banner (`_updatePreviewBanner`, driven by `updateModeUI`) shows "Previewing: NAME
  (role) — mode · read-only"; when the real global mode is pre-camp it offers a **Switch to at-camp
  view** toggle (`_togglePreviewMode`) that flips the `PREVIEW_MODE` overlay, giving the pre-camp /
  at-camp / at-camp-preview views of that account. The existing same-user at-camp preview home card
  is unchanged.
- **Also:** `updateModeUI` role badge gained a `firstAid` → "First aid" case (previously fell
  through to "Church"), now visible because firstAid accounts are previewable.

## Session-restore auth fix — deployed 2026-07-27

Reported symptom: *"I loaded in and saw a 'Missing bearer token' error; on refresh it had fixed."*
Confirmed from the Vercel runtime logs (five 401s in one tick — `/home`, `/notifications`,
`/checkin/sessions`, `/accounts/churches`, `/accounts/users`, i.e. exactly `_prefetch()`'s set,
with **`/settings` conspicuously absent**). Two independent defects, both in `public/index.html`,
both fixed. `sw.js` → `camp-v50`.

1. **`_tryRestoreSession()` validated nothing.** `GET /settings` is deliberately **`auth: false`**
   (`router.ts:82` — the login screen renders camp name/branding before anyone has a token), and it
   was the only call the restore path made before hiding the login screen. So an **expired token
   passed the gate**: the app rendered as if signed in and only collapsed a tick later when
   `_prefetch()`'s authenticated calls 401'd. Restore now does **`await api('/auth/me',{noCache:true})`**
   — an `auth: true` route — before touching `/settings`. On failure `_doFetch` already runs
   `sessionExpired()` and the existing `catch` clears `localStorage`, so the next load is a clean
   login screen. **Never use an `auth:false` route as a session probe**; `/settings` and `/setup`
   are the two that look tempting.
2. **The 401 handler was guarded on `&& TOKEN`.** `_prefetch()` issues five requests in the same
   tick. The first 401 called `sessionExpired()`, which nulls `TOKEN` — so the remaining four fell
   *past* the guard and threw the server's raw message, `Missing bearer token`, into a toast. That
   is the string the owner saw. The guard is now `path.indexOf('/auth/login')!==0`:
   `sessionExpired()` is idempotent so a cascade collapses into one banner, and `/auth/login` stays
   excluded because **its** 401 means *wrong password* and must keep its own message on the form.

Not a bug, worth knowing: sessions are **stateless HMAC, 24h TTL, no sliding refresh**
(`TOKEN_TTL_MS`, `auth.service.ts:10`). Everyone re-logs in daily; the fix just makes that land as
"Session expired — please sign in again." instead of a raw error.

### Still outstanding (owner decision)

- **Migration `0014` (pg_cron push tick) is applied to nothing.** Prerequisite 1 is now satisfied —
  `GET /internal/cron/tick` is live in prod (verified: returns 401 without the bearer, so the route
  is registered). Prerequisite 2 is not: it needs `CRON_SECRET` set in Vercel **and** the same value
  in Supabase Vault as `cron_secret`. **The Vercel MCP server has no env-var tool**, so the Vercel
  half must be done by hand (dashboard, or `vercel env add` once the CLI is installed); the Supabase
  half can be done over MCP. Note this is a **Supabase pg_cron** schedule, not a Vercel cron —
  `vercel.json` has no `crons` key on purpose, because Hobby-plan Vercel crons are daily-only and
  the check-in-window warning needs `*/5`.
- **Migration history drift on `0009`–`0012`** (recorded under generated timestamp versions), so a
  `supabase db push` would try to re-run them. Unchanged.

