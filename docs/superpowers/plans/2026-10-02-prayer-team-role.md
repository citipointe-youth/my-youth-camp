# Prayer Team Account Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `prayer` account type that finds a student, sees the leader to contact and every note on that student, and records a prayer or disclosure as an always-sensitive note, laid out like the first-aid login.

**Architecture:** A new role in the existing single-file RBAC (`access-control.ts`). A prayer record is a `StudentNote` with `category:'prayer'`, and the server forces `sensitive:true`. This reuses the first-aid pattern (category-scoped permissions, no migration). The SPA reuses the first-aid screens (`search`, `allstudents`, `records`, `schedule` screen ids) with role dispatch at four entry points, plus new sibling functions for the Prayer student card, record form and Records tab. Existing first-aid behaviour must not change.

**Tech Stack:** TypeScript/Express backend (`src/`), vitest, single-file vanilla-JS SPA `public/index.html` + `public/sw.js`, Supabase Postgres (no schema change).

**Spec:** the "Design (approved 2026-10-02)" section below. It was agreed in conversation; there is no separate spec file.

**Project dir:** `C:\Users\thoma\OneDrive\Claude Programs\Project 9 - Camp Platform\youth-camp-platform-masterv2` (all paths are relative to it). Read `CLAUDE.md` and `debug.md` first.

## Design (approved 2026-10-02)

Owner decisions, verbatim intent:
- **Hiding Medicare and parent contact in the UI only is acceptable.** No DTO masking change. The prayer role still does NOT get `camper:read:sensitive`, so the Medicare and parent-number reveal endpoints refuse it.
- **Prayer notes are sensitive.** The server forces `sensitive:true` on every `category:'prayer'` note, whatever the client sends. Church logins never see them (existing `forCamper` church filter).
- **Zone leaders see prayer records.** They already hold `note:read` and see sensitive notes, zone-scoped via `canAccessPerson`, in the Notes tab and on the student profile. No filtering is added. Director and admin see everything.
- **The prayer team sees every note on a specific student**: first-aid logs, other leaders' notes, sensitive notes and prayer records. This is only on a student it opens. It gets no camp-wide notes feed (`/notes/recent`) and no export (`/notes/export`).
- **Record format:** a required "Who's filling this out?" field plus one free-form box. It is stored as `Recorded by: <name>\n<text>`.
- **Student card shows:** the leader to contact first, then notes on the student, a "Record prayer / disclosure" button, then a muted medical and dietary card. It does NOT show the consents, Medicare or parent/guardian contact.
- **Nav:** Search · All Students · Records · Schedule (same as first aid). Its landing screen is Search.
- **Out of scope:** amendments, CSV export of prayer records, director notifications on submit, and migrating this year's `PRAYER: ` director notes (they stay untouched).
- **Modular:** no DB migration (`users.role` is plain text; `notes.category`/`notes.sensitive` already exist). It is inert until an admin creates a prayer account.

## Global Constraints

- Branch: do all work on local branch `feature/prayer-team-role` created from `master` at `a7b8666` (or later clean `master`). Commit per task on that branch. **Never push, and never merge to `master`, without explicit user go-ahead.** A push to `master` auto-deploys to production (`https://my-youth-camp.vercel.app`), which is currently in at-camp mode.
- Run subagents in the main checkout, sequentially. Do NOT use `isolation:"worktree"` (known to base on the wrong commit on this machine).
- Before any commit: `git status`, then stage named files only (never `git add -A`). Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01G66tatZRXiY4qB4EvoUU3e`
- Verify with `npm run typecheck` + `npm run test` (+ `npm run harness` and the SPA `node --check` for SPA tasks). **Do NOT start a dev server or drive a browser.** Baseline at `a7b8666`: 80 files / 1219 tests pass, harness "All checks passed".
- SPA syntax check (derive the range, never hard-code it):
  `S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1); E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1); sed -n "$((S+1)),$((E-1))p" public/index.html > "$TEMP/spa.js" && node --check "$TEMP/spa.js" && echo SPA_OK`
- Never rename existing SPA functions (harnesses extract them BY NAME). Line numbers below are approximate as of `a7b8666`. Grep the symbol before editing.
- SPA: no hardcoded hex colours in new markup; use existing classes (`fa-*`, `pill`, `card`, `noteitem`) and CSS variables. Any text inside a JS template literal must not contain a backtick.
- Role id is exactly `prayer`. The display label is exactly `Prayer team`, or `Prayer Team` as a screen subtitle.
- Do not change first-aid behaviour. The only first-aid-function edits allowed are the role-dispatch lines and the `_teamLabel()` subtitle swap named in Task 4.

## Review Focus

1. **A client posts a prayer note with `sensitive:false` or omits it.** It must still be stored `sensitive:true`. (Task 2 test.)
2. **A church login opens a student who has a prayer record.** It must not appear on the profile. (Task 2 test.)
3. **A prayer login calls camp-wide endpoints directly** (`/notes/recent`, `/notes/export`, the parent-number reveal, or a leaders-only incident notice). Each must be refused or filtered. (Tasks 1 and 2 tests.)
4. **A long record**: a 1,900-character body plus the `Recorded by:` line must stay under the server's 2,000-char `body` limit. The SPA caps the textarea at `maxlength="1900"` and the name at `maxlength="80"`. (Task 4 step.)
5. **Pre-camp testing before next camp**: a prayer login must find a registered, not-yet-arrived student, open their notes and save a record, as first aid can today. (Tasks 1 and 2 tests.)

---

### Task 1: `prayer` role — RBAC, scoping, labels, seed

**Files:**
- Modify: `src/core/types/enums.ts:11`
- Modify: `src/services/access-control.ts` (Action union ~L5-39, `ROLE_PERMISSIONS` ~L41-128, `canAccessChurch` ~L146-160)
- Modify: `src/services/person.service.ts` (`canAccessByChurchZone` ~L79-92)
- Modify: `src/services/search.service.ts` (~L197, `search()` visibility)
- Modify: `src/services/account.service.ts` (`ROLE_LABELS` ~L43-48)
- Modify: `src/data/seed.ts` (users array, after the `firstaid` user ~L118-123)
- Test: `src/services/access-control.test.ts`, `src/services/search.service.test.ts`, `src/services/notification-visibility.test.ts`

**Interfaces:**
- Produces: `UserRole` includes `'prayer'`. New `Action`s: `'note:write:prayer'`, `'note:read:prayer'`, `'note:read:student'`. `prayer` holds exactly `camper:read`, `note:write:prayer`, `note:read:prayer`, `note:read:student`. `director` and `admin` additionally hold `note:write:prayer` and `note:read:prayer`. `canAccessPerson`/`canAccessChurch` return true for `prayer` for any church/zone.

- [ ] **Step 0: Branch**

```bash
git status            # must show no tracked changes
git checkout -b feature/prayer-team-role
```

- [ ] **Step 1: Write the failing tests**

Append to `src/services/access-control.test.ts` (it already has `actor()`, `can`, `canAccessChurch`, `canSendNotification`, `canAccessPerson` imported):

```ts
describe('access-control: prayer role', () => {
  const p = actor('prayer');

  it('can read campers, write/read prayer records, and read notes on one student', () => {
    expect(can(p, 'camper:read')).toBe(true);
    expect(can(p, 'note:write:prayer')).toBe(true);
    expect(can(p, 'note:read:prayer')).toBe(true);
    expect(can(p, 'note:read:student')).toBe(true);
  });

  it('cannot reveal sensitive data, sign in/check in, read camp-wide notes, or manage anything', () => {
    for (const a of [
      'camper:read:sensitive', 'attendance:write', 'checkin:write', 'note:write', 'note:read',
      'note:write:firstaid', 'note:read:firstaid', 'registrant:read', 'registrant:write',
      'incident:manage', 'export:compliance', 'admin:manage', 'camper:write',
      'notification:send:zone', 'notification:send:camp',
    ] as const) {
      expect(can(p, a)).toBe(false);
    }
  });

  it('director and admin can write/read prayer records; zoneLeader, church and firstAid cannot write them', () => {
    expect(can(actor('director'), 'note:write:prayer')).toBe(true);
    expect(can(actor('admin'), 'note:write:prayer')).toBe(true);
    expect(can(actor('director'), 'note:read:prayer')).toBe(true);
    expect(can(actor('zoneLeader'), 'note:write:prayer')).toBe(false);
    expect(can(actor('church'), 'note:write:prayer')).toBe(false);
    expect(can(actor('firstAid'), 'note:write:prayer')).toBe(false);
    expect(can(actor('firstAid'), 'note:read:student')).toBe(false);
  });

  it('canAccessPerson / canAccessChurch: prayer sees every church and zone', () => {
    expect(canAccessPerson(p, { churchId: 'any', zone: 'Red' })).toBe(true);
    expect(canAccessPerson(p, { churchId: 'other', zone: 'Blue', gender: 'female' })).toBe(true);
    expect(canAccessChurch(p, 'any-church')).toBe(true);
    expect(canAccessChurch(p, 'other-church', 'Red')).toBe(true);
  });

  it('cannot send notifications at any scope', () => {
    expect(canSendNotification(p, 'camp')).toBe(false);
    expect(canSendNotification(p, 'zone', 'Red')).toBe(false);
    expect(canSendNotification(p, 'church')).toBe(false);
  });
});
```

Append to `src/services/notification-visibility.test.ts` (inside the existing `describe('canSeeNotification', …)` block or as a new `describe`):

```ts
describe('canSeeNotification: prayer role', () => {
  it('prayer never sees a leadersOnly (incident) notice, but does see an ordinary camp notice', () => {
    const prayer = actor({ role: 'prayer', churchId: null, zone: null });
    expect(canSeeNotification(prayer, notif({ leadersOnly: true }), NOW)).toBe(false);
    expect(canSeeNotification(prayer, notif(), NOW)).toBe(true);
  });
});
```

Append to `src/services/search.service.test.ts` (it has `person()`, `actor()`, `people`, `svc`; add `ForbiddenError` to its `app-error` import if it is not already imported):

```ts
describe('search.service: prayer role', () => {
  it('prayer finds a registered (not-yet-arrived) person, like first aid (pre-camp testing)', async () => {
    await people.save(person({ id: 'reg1', firstName: 'Ada', lifecycle: 'registered', atCamp: false }));
    const results = await svc.search(actor('prayer'), 'Ada');
    expect(results.map((r) => r.camper.id)).toContain('reg1');
  });

  it('prayer gets the leader contacts but cannot reveal the parent number', async () => {
    const contacts = await svc.resolveContacts(actor('prayer'), 'p1');
    expect(contacts.some((c) => c.role !== 'parent')).toBe(true);
    await expect(svc.revealContact(actor('prayer'), 'p1', 'parent')).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/services/access-control.test.ts src/services/search.service.test.ts src/services/notification-visibility.test.ts`
Expected: FAIL. `npm run typecheck` also fails with `'"prayer"' is not assignable to …` (role not in `USER_ROLES`).

- [ ] **Step 3: Implement**

`src/core/types/enums.ts`:
```ts
export const USER_ROLES = ['church', 'zoneLeader', 'director', 'admin', 'firstAid', 'prayer'] as const;
```

`src/services/access-control.ts`: add to the `Action` union directly after `'note:read:firstaid'`:
```ts
  // Prayer team (2026-10). A prayer record is a StudentNote with category 'prayer' and is ALWAYS
  // sensitive (forced in note.service). Own capabilities, like first aid, so the prayer team gets
  // prayer access without general note read/write.
  | 'note:write:prayer'
  | 'note:read:prayer'
  // Read every note on ONE student the actor opens (GET /notes/camper/:id) — no camp-wide feed or
  // export. Held by the prayer team only; church/zoneLeader/director/admin reach that endpoint via note:write.
  | 'note:read:student'
```
In `ROLE_PERMISSIONS`, add `'note:write:prayer', 'note:read:prayer',` to both `director` and `admin` (after their `'note:read:firstaid'`), and add a new entry after `firstAid`:
```ts
  // prayer: find a student, see the leader to contact and every note on that student, and record a
  // prayer/disclosure (category 'prayer', forced sensitive). No camper:read:sensitive (no Medicare/
  // parent reveal), no attendance/check-in, no camp-wide notes feed, no notifications.
  prayer: new Set<Action>([
    'camper:read',
    'note:write:prayer',
    'note:read:prayer',
    'note:read:student',
  ]),
```
In `canAccessChurch`, add `case 'prayer':` under `case 'firstAid':` (falls through to `return true`), and update its doc comment line to `director/admin/firstAid/prayer: all`.

`src/services/person.service.ts`, `canAccessByChurchZone`: add `case 'prayer':` under `case 'firstAid':`.

`src/services/search.service.ts` ~L197:
```ts
          visible = isCamper(person) || ((actor.role === 'firstAid' || actor.role === 'prayer') && isRegistrant(person));
```

`src/services/account.service.ts` `ROLE_LABELS`: add `prayer: 'Prayer team',`.

`src/data/seed.ts`: after the `firstaid` user add:
```ts
    makeUser({
      firstName: 'Prayer',
      lastName: 'Team',
      username: 'prayer',
      role: 'prayer',
    }),
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; all tests pass (1219 + the new ones).

- [ ] **Step 5: Commit**

```bash
git status
git add src/core/types/enums.ts src/services/access-control.ts src/services/person.service.ts src/services/search.service.ts src/services/account.service.ts src/data/seed.ts src/services/access-control.test.ts src/services/search.service.test.ts src/services/notification-visibility.test.ts
git commit -m "feat(rbac): add prayer team role (camper:read + prayer-note permissions, camp-wide scope)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G66tatZRXiY4qB4EvoUU3e"
```

---

### Task 2: Prayer records in `note.service` + `GET /notes/prayer`

**Files:**
- Modify: `src/services/note.service.ts` (whole file is ~170 lines; read it first)
- Modify: `src/api/controllers/note.controller.ts`
- Modify: `src/api/http/router.ts` (Notes block ~L132-140)
- Test: `src/services/note.service.test.ts`

**Interfaces:**
- Consumes (Task 1): role `'prayer'`; actions `'note:write:prayer'`, `'note:read:prayer'`, `'note:read:student'`; `can()` from `./access-control`.
- Produces: `NoteService.recentPrayer(actor: Actor, limit?: number): Promise<StudentNote[]>`. `GET /notes/prayer?limit=N` returns prayer-category notes, newest first, scoped by `canAccessPerson`. `POST /notes {camperId, category:'prayer', body}` stores `sensitive:true`. `GET /notes/camper/:id` is readable by `prayer` and returns all categories, including sensitive.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/note.service.test.ts` (it has `person()`, `actor()`, `svc`, `people`, campers `cam1` (c1/Yellow) and `cam2` (c2/Blue); imports `ForbiddenError`, `BadRequestError`, `NotFoundError`):

```ts
describe('note.service: prayer records (write)', () => {
  it('prayer creates a category:prayer note and it is ALWAYS sensitive, even if the client says false', async () => {
    const a = await svc.add(actor('prayer'), { camperId: 'cam1', category: 'prayer', body: 'Recorded by: Sam\nprayed for x', sensitive: false });
    const b = await svc.add(actor('prayer'), { camperId: 'cam1', category: 'prayer', body: 'Recorded by: Sam\nprayed for y' });
    expect(a.category).toBe('prayer');
    expect(a.sensitive).toBe(true);
    expect(b.sensitive).toBe(true);
  });

  it('a prayer record requires a student', async () => {
    await expect(svc.add(actor('prayer'), { category: 'prayer', body: 'x' })).rejects.toThrow(BadRequestError);
  });

  it('prayer cannot create general notes, testimonies or first-aid records', async () => {
    for (const category of ['note', 'testimony', 'firstaid']) {
      await expect(svc.add(actor('prayer'), { camperId: 'cam1', category, body: 'x' })).rejects.toThrow(ForbiddenError);
    }
  });

  it('director can create a prayer record; zoneLeader and church cannot', async () => {
    const n = await svc.add(actor('director'), { camperId: 'cam1', category: 'prayer', body: 'x' });
    expect(n.sensitive).toBe(true);
    await expect(svc.add(actor('zoneLeader', { zone: 'Yellow' }), { camperId: 'cam1', category: 'prayer', body: 'x' })).rejects.toThrow(ForbiddenError);
    await expect(svc.add(actor('church', { churchId: 'c1' }), { camperId: 'cam1', category: 'prayer', body: 'x' })).rejects.toThrow(ForbiddenError);
  });
});

describe('note.service: prayer records (read)', () => {
  beforeEach(async () => {
    await svc.add(actor('church', { churchId: 'c1' }), { camperId: 'cam1', category: 'note', body: 'leader note' });
    await svc.add(actor('director'), { camperId: 'cam1', category: 'note', body: 'sensitive note', sensitive: true });
    await svc.add(actor('firstAid'), { camperId: 'cam1', category: 'firstaid', body: 'Problem: graze\nTreatment: plaster' });
    await svc.add(actor('prayer'), { camperId: 'cam1', category: 'prayer', body: 'Recorded by: Sam\nprayer 1' });
    await svc.add(actor('prayer'), { camperId: 'cam2', category: 'prayer', body: 'Recorded by: Sam\nprayer 2' });
  });

  it('prayer sees EVERY note on the student it opens (leader, sensitive, first-aid, prayer)', async () => {
    const recs = await svc.forCamper(actor('prayer'), 'cam1');
    expect(recs.map((n) => n.body).sort()).toEqual(
      ['Problem: graze\nTreatment: plaster', 'Recorded by: Sam\nprayer 1', 'leader note', 'sensitive note'].sort(),
    );
  });

  it('church does NOT see the prayer record on its own student profile', async () => {
    const recs = await svc.forCamper(actor('church', { churchId: 'c1' }), 'cam1');
    expect(recs.some((n) => n.category === 'prayer')).toBe(false);
  });

  it('zoneLeader sees prayer records for its own zone only (profile + Notes feed)', async () => {
    const yellow = actor('zoneLeader', { zone: 'Yellow' });
    expect((await svc.forCamper(yellow, 'cam1')).some((n) => n.category === 'prayer')).toBe(true);
    const feed = await svc.recent(yellow, 50);
    expect(feed.filter((n) => n.category === 'prayer').map((n) => n.camperId)).toEqual(['cam1']);
  });

  it('prayer cannot read the camp-wide notes feed or the notes export', async () => {
    await expect(svc.recent(actor('prayer'))).rejects.toThrow(ForbiddenError);
    await expect(svc.exportRows(actor('prayer'))).rejects.toThrow(ForbiddenError);
  });

  it('firstAid still cannot read a student profile notes list (regression on the forCamper gate)', async () => {
    await expect(svc.forCamper(actor('firstAid'), 'cam1')).rejects.toThrow(ForbiddenError);
  });

  it('recentPrayer returns ONLY prayer records (all students for prayer), newest first', async () => {
    const recs = await svc.recentPrayer(actor('prayer'));
    expect(recs.every((n) => n.category === 'prayer')).toBe(true);
    expect(recs.map((n) => n.camperId).sort()).toEqual(['cam1', 'cam2']);
  });

  it('recentPrayer is refused for firstAid, church and zoneLeader', async () => {
    await expect(svc.recentPrayer(actor('firstAid'))).rejects.toThrow(ForbiddenError);
    await expect(svc.recentPrayer(actor('church', { churchId: 'c1' }))).rejects.toThrow(ForbiddenError);
    await expect(svc.recentPrayer(actor('zoneLeader', { zone: 'Yellow' }))).rejects.toThrow(ForbiddenError);
  });

  it('recentFirstAid is unchanged: still only first-aid records', async () => {
    const recs = await svc.recentFirstAid(actor('admin'));
    expect(recs.every((n) => n.category === 'firstaid')).toBe(true);
    expect(recs).toHaveLength(1);
  });
});

describe('note.service: prayer pre-camp testing (registered, not-yet-arrived)', () => {
  beforeEach(async () => {
    await people.save(person({ id: 'reg1', churchId: 'c1', zone: 'Yellow', lifecycle: 'registered', atCamp: false }));
  });

  it('prayer can record against, and read notes for, a registered person', async () => {
    await svc.add(actor('prayer'), { camperId: 'reg1', category: 'prayer', body: 'Recorded by: Sam\ntest' });
    const recs = await svc.forCamper(actor('prayer'), 'reg1');
    expect(recs).toHaveLength(1);
  });

  it('other roles keep the arrived-only rule on the profile notes list', async () => {
    await expect(svc.forCamper(actor('zoneLeader', { zone: 'Yellow' }), 'reg1')).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/services/note.service.test.ts`
Expected: FAIL (`recentPrayer` is not a function; prayer `add` throws ForbiddenError, because it currently asserts `note:write`).

- [ ] **Step 3: Implement `note.service.ts`**

Imports: change `import { assertCan } from './access-control';` to `import { assertCan, can } from './access-control';` and add `ForbiddenError` to the `app-error` import.

Interface: add after `recentFirstAid`:
```ts
  /** Prayer records only (category 'prayer'), newest first, scoped by canAccessPerson. note:read:prayer. */
  recentPrayer(actor: Actor, limit?: number): Promise<StudentNote[]>;
```

Replace `firstAidEligible` (and its two call sites) with:
```ts
const FIRSTAID_CATEGORY = 'firstaid';
const PRAYER_CATEGORY = 'prayer';

// First aid and the prayer team must be able to log/read records against real registrants during
// pre-camp testing too — nobody is a "camper" until the Day-1 sign-in. Every other role keeps the
// arrived-only scope (mirrors search.service.ts).
function preCampEligible(actor: Actor, person: Person): boolean {
  return isCamper(person) || ((actor.role === 'firstAid' || actor.role === 'prayer') && isRegistrant(person));
}
```

In `add`:
```ts
      const category = data.category ?? 'note';
      const isFirstAid = category === FIRSTAID_CATEGORY;
      const isPrayer = category === PRAYER_CATEGORY;
      assertCan(actor, isFirstAid ? 'note:write:firstaid' : isPrayer ? 'note:write:prayer' : 'note:write');
      const camperId = data.camperId && data.camperId.length > 0 ? data.camperId : null;
      if (isFirstAid && !camperId) throw new BadRequestError('A first-aid record requires a camper');
      if (isPrayer && !camperId) throw new BadRequestError('A prayer record requires a student');
      if (camperId) {
        const camper = await personRepo.findById(camperId);
        if (!camper || !preCampEligible(actor, camper)) throw new NotFoundError('Student not found');
        if (!canAccessPerson(actor, camper)) throw new NotFoundError('Student not found');
      }
```
and in the note literal:
```ts
        // A prayer record is ALWAYS sensitive (owner decision 2026-10-02) — never trust the client.
        sensitive: isPrayer ? true : data.sensitive ?? false,
```

Replace the start of `forCamper`:
```ts
    async forCamper(actor, camperId) {
      // church/zoneLeader/director/admin reach the profile notes list via note:write (unchanged);
      // the prayer team via note:read:student (read-only, one student at a time).
      if (!can(actor, 'note:write') && !can(actor, 'note:read:student')) {
        throw new ForbiddenError(`Role '${actor.role}' cannot read student notes`);
      }
      const camper = await personRepo.findById(camperId);
      if (!camper || !preCampEligible(actor, camper)) throw new NotFoundError('Student not found');
```
Keep the rest of `forCamper` (the `canAccessPerson` check and the church sensitive filter) as is.

Replace `recentFirstAid` with a shared helper inside `makeNoteService` plus two thin methods:
```ts
  // Category-only read (first aid / prayer): fetch a wide window, keep ONLY that category, scoped by
  // canAccessPerson. Both categories always carry a camperId. Can never leak another category.
  async function recentInCategory(actor: Actor, category: string, limit: number): Promise<StudentNote[]> {
    const notes = await noteRepo.findRecent(Math.max(limit, 50) * 4);
    const result: StudentNote[] = [];
    for (const note of notes) {
      if ((note.category ?? 'note') !== category) continue;
      if (!note.camperId) continue;
      const camper = await personRepo.findById(note.camperId);
      if (!camper || !preCampEligible(actor, camper)) continue;
      if (!canAccessPerson(actor, camper)) continue;
      result.push(note);
      if (result.length >= limit) break;
    }
    return result;
  }
```
(declare it just before the `return {`), and:
```ts
    async recentFirstAid(actor, limit = 50) {
      assertCan(actor, 'note:read:firstaid');
      return recentInCategory(actor, FIRSTAID_CATEGORY, limit);
    },

    async recentPrayer(actor, limit = 50) {
      assertCan(actor, 'note:read:prayer');
      return recentInCategory(actor, PRAYER_CATEGORY, limit);
    },
```

- [ ] **Step 4: Controller + route**

`src/api/controllers/note.controller.ts`, after `recentFirstAid`:
```ts
    async recentPrayer(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const limit = req.query['limit'] ? parseInt(req.query['limit'], 10) : 50;
      return services.note.recentPrayer(req.ctx.actor, limit);
    },
```
`src/api/http/router.ts`, directly after the `/notes/firstaid` route:
```ts
    // Prayer records only (2026-10) — category 'prayer', scoped by canAccessPerson. note:read:prayer.
    { method: 'GET', path: '/notes/prayer', auth: true, handler: (r) => note.recentPrayer(r) },
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm run typecheck && npm run test`
Expected: clean; all pass. (`admin.service.ts` ~L363 mentions `firstAidEligible` in a comment only. Update that comment to `preCampEligible`.)

- [ ] **Step 6: Commit**

```bash
git status
git add src/services/note.service.ts src/services/note.service.test.ts src/api/controllers/note.controller.ts src/api/http/router.ts src/services/admin.service.ts
git commit -m "feat(notes): prayer records (always sensitive), per-student notes read for prayer, GET /notes/prayer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G66tatZRXiY4qB4EvoUU3e"
```

---

### Task 3: SPA role plumbing (labels, nav, landing, account admin, Notes filter)

**Files:**
- Modify: `public/index.html` only. Grep each symbol and edit only the listed expression.

**Interfaces:**
- Consumes: role id `'prayer'`; backend from Tasks 1–2.
- Produces: `navModel('prayer', mode)` → tabs `search, allstudents, records, schedule`; prayer lands on `search`; admin can create a "Prayer team" account; the Notes screen can filter and badge `prayer`.

- [ ] **Step 1: Header role badge** (`r.textContent=ACTOR.role===`, ~L1922). Insert `ACTOR.role==='prayer'?'Prayer team':` immediately before `ACTOR.role==='zoneLeader'`.

- [ ] **Step 2: Account-preview label** (`const _previewRoleLabel`, ~L1962). Insert `r==='prayer'?'Prayer team':` immediately before `r==='church'`.

- [ ] **Step 3: Landing redirect, two places.**
`gotoTab` (~L2577):
```js
  if(id==='home'&&ACTOR&&(ACTOR.role==='firstAid'||ACTOR.role==='prayer'))id='search';
```
`RENDER.home` (~L2724):
```js
  if(ACTOR&&(ACTOR.role==='firstAid'||ACTOR.role==='prayer')){await gotoTab('search');return;}
```

- [ ] **Step 4: `navModel`** (~L2625). Directly after the `if(role==='firstAid'){…}` block:
```js
  if(role==='prayer'){
    // Prayer team (2026-10): same shape as first aid — find a student, see their notes, record a prayer.
    return {tabs:[T('search','search','Search'),T('allstudents','users','All Students'),T('records','note','Records'),T('schedule','clock','Schedule')],extras:[]};
  }
```

- [ ] **Step 5: Accounts admin screen, four spots.**
- `const leaderRoles=[…]` (~L7237) → `['zoneLeader','director','firstAid','prayer','admin']`
- `const roleLabel=r=>…` in the same function (~L7242) → insert `r==='prayer'?'Prayer team':` before `r==='director'`
- `const roleOpts=` (~L7319) → add `<option value="prayer">Prayer team</option>` immediately after the First aid option
- `_loginActivityOrder` (~L7365-7366) → `RANK={admin:0,director:1,zoneLeader:2,firstAid:3,prayer:4}` and add `prayer:'Prayer team'` to `LBL`
- Credentials CSV `const roleLabel={admin:…}` (~L7656) → add `prayer:'Prayer team'`

- [ ] **Step 6: Notes screen filter and badge.**
`NOTE_CAT_OPTIONS` (~L6898): add `{v:'prayer',label:'Prayer'},` directly after the `firstaid` entry.
`drawNotes` badge (~L7031): insert before the `if(c==='sensitive')` line:
```js
    if(c==='prayer')return `<span class="pill warn">${icSm('alert')} Prayer</span>`;
```
(`_noteCat` already returns `'prayer'` for `category:'prayer'`, so no change there.)

- [ ] **Step 7: Sweep for anything missed.**
Run: `grep -n "firstAid" public/index.html`. For each hit not covered above, decide whether prayer needs the same treatment. Expected answer for each: comments (no change); `_faAmendBtn`/`openFaAmend` (first-aid only, no change); `RENDER.search` and `openStudentInfo`/`RENDER.records` (Task 4). Report the list of hits and the decision for each in your summary.

- [ ] **Step 8: Verify**

Run the SPA syntax check from Global Constraints → `SPA_OK`. Run `npm run harness` → "All checks passed" (the login-activity harness exercises `_loginActivityOrder`). Run `npm run test` → still green.

- [ ] **Step 9: Commit**

```bash
git status
git add public/index.html
git commit -m "feat(spa): prayer team role plumbing — nav, landing, labels, account admin, Notes filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G66tatZRXiY4qB4EvoUU3e"
```

---

### Task 4: SPA prayer screens (student card, record form, Records tab)

**Files:**
- Modify: `public/index.html` only.

**Interfaces:**
- Consumes: `GET /campers/:id`, `GET /search/contacts/:id`, `GET /notes/camper/:id`, `POST /notes {camperId, category:'prayer', body}`, `GET /notes/prayer?limit=`, `GET /campers?scope=all`; existing helpers `paint`, `api`, `esc`, `val` (trims), `toast`, `ic`, `icSm`, `fmtPhone`, `dtFmt`, `emptyState`, `_faBubble`, `_faScreen`, `_faBackExpr`, `_faDayOpts`, `_faKeep`, `localDateISO`, `LAST_LEADER`, `CAMP_MODE`, `_currentStudent`.
- Produces: `_teamLabel()`, `openPrayerInfo(id)`, `_loadPrayerNotes(id)`, `openPrayerLog(id)`, `savePrayerLog(id)`, `renderPrayerRecords()`, `drawPrayerRecords()`.

- [ ] **Step 1: Shared subtitle + dispatch (the only first-aid-function edits allowed).**
Directly above `function renderSearchFirstAid(){` add:
```js
// Screen subtitle for the logins that share the first-aid screens (first aid + prayer team).
const _teamLabel=()=>ACTOR&&ACTOR.role==='prayer'?'Prayer Team':'First Aid';
```
In `renderSearchFirstAid`, change the final paint argument `'First Aid'` → `_teamLabel()`. In `RENDER.allstudents`, change both `'First Aid'` paint arguments → `_teamLabel()`.
`RENDER.search` (~L4278):
```js
  if(ACTOR&&(ACTOR.role==='firstAid'||ACTOR.role==='prayer')){renderSearchFirstAid();return;}
```
First line inside `async function openStudentInfo(id){`:
```js
  if(ACTOR&&ACTOR.role==='prayer')return openPrayerInfo(id);
```
First line inside `RENDER.records=async function(){`:
```js
  if(ACTOR&&ACTOR.role==='prayer'){await renderPrayerRecords();return;}
```

- [ ] **Step 2: Add the prayer functions.** Insert this block directly after the end of `drawFaRecords` (before `/* ===== SEARCH ===== */`):

```js
/* ── Prayer team (2026-10) ──────────────────────────────────────────────────────
   Shares the first-aid screens (search / allstudents / records). Student card = leader to contact
   first, then EVERY note on the student (first-aid logs, leaders' notes, sensitive notes, prayer
   records), then a muted medical/dietary card. Deliberately NO consents, Medicare or parent/guardian
   contact (owner decision: UI-only hiding). A prayer record is POST /notes category 'prayer'; the
   server forces it sensitive. Body = "Recorded by: <name>\n<text>". */
async function openPrayerInfo(id){
  const scr=_faScreen();
  let c;try{c=await api('/campers/'+id);}catch(e){toast(e.message);return;}
  _currentStudent=c;
  let contacts=[];try{contacts=await api('/search/contacts/'+id);}catch(e){contacts=[];}
  const leaders=contacts.filter(x=>x.role!=='parent');
  const prim=leaders.find(x=>x.type==='primary'),back=leaders.find(x=>x.type==='backup');
  const leadBtn=(ct,sec)=>ct?`<div class="who"><span class="nm">${esc(ct.name)}</span><span class="ptag${sec?' sec':''}">${sec?'Secondary':'Primary'}</span></div>
      <div class="sub">${esc(c.churchName)} · ${ct.gender==='female'?'Female':'Male'} ${ct.type==='backup'?'backup':'leader'}</div>
      <a class="btn fa-call" href="tel:${esc(ct.phone)}">${icSm('phone')} ${esc(fmtPhone(ct.phone))}</a>`:'';
  const leadCard=(prim||back)
    ? `<div class="fa-lead"><div class="lh">${icSm('phone')} Leader to contact</div>${leadBtn(prim,false)}${back?`<div style="margin-top:14px">${leadBtn(back,true)}</div>`:''}</div>`
    : `<div class="fa-alert"><div class="ah">${icSm('phone')} No leader contact on file</div><div class="fa-calm" style="color:var(--alert-ink)">Ask a director or admin who to contact.</div></div>`;
  const med=[...(c.medicalConditions||[]),...(c.otherMedications?[c.otherMedications]:[])];
  const diet=c.dietaryRequirements||[];
  const medCard=(med.length||diet.length)?`<div class="card"><div class="lbl" style="margin-top:0">Medical &amp; dietary</div>
    ${med.map(m=>`<div class="sub" style="color:var(--ink-2)">${esc(m)}</div>`).join('')}
    ${diet.map(d=>`<span class="fa-diet">${esc(d)}</span>`).join('')}</div>`:'';
  paint(scr,`<div style="padding:12px 0 4px 0"><button class="btn ghost sm" onclick="${_faBackExpr(scr)}">${icSm('arrowl')} Back</button></div>
    <div class="fa-id">${_faBubble(c)}<div><h2>${esc(c.firstName+' '+c.lastName)}</h2>
      <div class="meta">${c.kind==='leader'?'Leader':'Student'+(c.grade?' · Grade '+c.grade:'')} · ${esc(c.churchName)} · ${esc(c.zone)} Zone</div>
      ${CAMP_MODE==='at-camp'?`<span class="fa-status ${c.atCamp?'on':'off'}">${c.atCamp?'On site':'Not on site'}</span>`:''}</div></div>
    ${leadCard}
    <button class="btn" onclick="openPrayerLog('${c.id}')">${icSm('plus')} Record prayer / disclosure</button>
    <div id="prNotes"></div>
    ${medCard}`,'Student Info','');
  _loadPrayerNotes(id);
}
async function _loadPrayerNotes(id){
  const box=document.getElementById('prNotes');if(!box)return;
  let notes=[];try{notes=await api('/notes/camper/'+id);}catch(e){box.innerHTML='<p class="note-hint">Could not load notes.</p>';return;}
  notes=(notes||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const tag=n=>{const c=n.category||'note';
    if(c==='prayer')return `<span class="pill warn">${icSm('alert')} Prayer</span>`;
    if(c==='firstaid')return '<span class="pill amb">First-aid</span>';
    if(c==='testimony')return '<span class="pill info">Testimony</span>';
    return n.sensitive?`<span class="pill warn">${icSm('alert')} Sensitive note</span>`:'<span class="pill ok">Leader note</span>';};
  box.innerHTML=`<div class="lbl" style="margin-top:18px">Notes on this student (${notes.length})</div>`+
    (notes.length?`<div class="card">${notes.map(n=>`<div class="noteitem">${tag(n)}<div style="white-space:pre-wrap;margin-top:4px">${esc(n.body)}</div><div class="meta">${esc(n.authorName||'')} · ${dtFmt(n.createdAt)}</div></div>`).join('')}</div>`
      :'<p class="note-hint">No notes recorded for this student yet.</p>');
}
function openPrayerLog(id){
  const c=_currentStudent&&_currentStudent.id===id?_currentStudent:null;
  paint(_faScreen(),`<div style="padding:12px 0 4px 0"><button class="btn ghost sm" onclick="openStudentInfo('${id}')">${icSm('arrowl')} Back</button></div>
    <div class="card">
      ${c?`<div class="fa-id" style="margin-bottom:8px">${_faBubble(c)}<div><h2 style="font-size:var(--t-h3)">${esc(c.firstName+' '+c.lastName)}</h2><div class="meta">${esc(c.churchName)}</div></div></div>`:''}
      <label class="lbl" style="margin-top:4px">Who's filling this out? <span style="color:var(--danger)">*</span></label>
      <input id="prWho" class="fld" maxlength="80" value="${esc(LAST_LEADER||'')}" placeholder="Your name">
      <label class="lbl" style="margin-top:12px">What was shared / prayed for <span style="color:var(--danger)">*</span></label>
      <textarea id="prBody" class="fld" style="min-height:140px" maxlength="1900" placeholder="What was disclosed or prayed for, and anything that may need a child-safety follow-up…"></textarea>
      <p class="sub" style="font-size:var(--t-2xs);color:var(--ink-2);margin-top:6px">Saved as a sensitive record — hidden from church logins; zone leaders, directors and admins can see it. Time and login account are recorded automatically.</p>
    </div>
    <button class="btn" id="prSave" onclick="savePrayerLog('${id}')">${icSm('check')} Save record</button>`,'Record prayer','');
}
async function savePrayerLog(id){
  const who=val('prWho'),text=val('prBody');
  if(!who){toast("Enter who's filling this out");return;}
  if(!text){toast('Write what was shared or prayed for');return;}
  LAST_LEADER=who;
  const body='Recorded by: '+who+'\n'+text;
  const btn=document.getElementById('prSave');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await api('/notes',{method:'POST',body:{camperId:id,category:'prayer',body}});
    toast('Record saved');
    await openStudentInfo(id);
  }catch(e){toast(e.message);if(btn){btn.disabled=false;btn.innerHTML=`${icSm('check')} Save record`;}}
}
let _prRecFilter='today';
async function renderPrayerRecords(){
  let recs=[],page=[];
  try{[recs,page]=await Promise.all([api('/notes/prayer?limit=1000'),api('/campers?scope=all').catch(()=>[])]);}
  catch(e){paint('records','<p class="err" style="display:block">'+esc(e.message)+'</p>','Prayer records','');return;}
  window._prRecsAll=recs||[];
  const cmap={};(Array.isArray(page)?page:page.items||[]).forEach(c=>{cmap[c.id]=c.firstName+' '+c.lastName;});window._prCamperMap=cmap;
  paint('records',`<div class="search" style="padding:9px 14px"><span>${ic('search')}</span><input id="prRecQ" placeholder="Filter by student…" oninput="drawPrayerRecords()" aria-label="Filter records"></div>
    <select class="fld" id="prRecDay" style="margin:0 0 12px 0" onchange="_prRecFilter=this.value;drawPrayerRecords()" aria-label="Show records from">${_faDayOpts().map(o=>`<option value="${o.v}"${o.v===_prRecFilter?' selected':''}>${esc(o.l)}</option>`).join('')}</select>
    <div id="prRecList"></div>`,'Prayer records','Sensitive');
  drawPrayerRecords();
}
function drawPrayerRecords(){
  const box=document.getElementById('prRecList');if(!box)return;
  if(!_faDayOpts().some(o=>o.v===_prRecFilter))_prRecFilter='today';
  const cmap=window._prCamperMap||{};
  const q=(val('prRecQ')||'').toLowerCase();
  const list=(window._prRecsAll||[])
    .filter(n=>_faKeep({n,amends:[]},_prRecFilter,localDateISO(),localDateISO))
    .map(n=>({n,name:cmap[n.camperId]||'Student'}))
    .filter(x=>!q||x.name.toLowerCase().includes(q));
  box.innerHTML=list.length?`<div class="card">${list.map(x=>`<div class="fa-rec">
    <div class="top"><span class="nm">${esc(x.name)}</span><span class="pill warn">Prayer</span><span class="tm">${dtFmt(x.n.createdAt)}</span></div>
    <div class="ln" style="white-space:pre-wrap">${esc(x.n.body)}</div></div>`).join('')}</div>`
    :emptyState('note',_prRecFilter==='today'?'No prayer records today.':'No prayer records for this filter.');
}
```

Records rows are deliberately NOT tappable. `openStudentInfo` paints onto `_faScreen()` (`search`/`allstudents`), and `paint()`'s stale-guard would drop a render from the `records` screen. This is the same reason first-aid Records rows aren't tappable.

- [ ] **Step 3: Verify**

1. SPA syntax check (Global Constraints) → `SPA_OK`.
2. `npm run harness` → "All checks passed". `npm run test` → green.
3. Self-check by grep:
   - `grep -n "renderPrayerRecords\|openPrayerInfo\|savePrayerLog\|_teamLabel" public/index.html`: each is defined once and referenced where Step 1 says.
   - Confirm no backtick appears inside an HTML comment in the new block.
   - Confirm `openStudentInfo` for `firstAid` is unchanged apart from the one dispatch line: `git diff -U0 public/index.html | grep -n "^[-+]" | head -80`. The only `-` lines are the replaced `'First Aid'` paint args and the three dispatch conditions.

- [ ] **Step 4: Commit**

```bash
git status
git add public/index.html
git commit -m "feat(spa): prayer team screens — student card with notes + leader contact, record form, Records tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G66tatZRXiY4qB4EvoUU3e"
```

---

### Task 5: Cache bump, docs, final verification, then STOP for push approval

**Files:**
- Modify: `public/sw.js:1` (`camp-v143` → `camp-v144`; if it is already higher, increment from whatever it is)
- Modify: `CLAUDE.md` (Roles table: add a `prayer` row after `firstAid`)
- Modify: `debug.md` (symptom router: add rows; role × mode table: add prayer)
- Modify: `docs/reference/auth-and-accounts.md` (append a short "Prayer team role (2026-10-02)" section)
- Modify: `CHANGELOG.txt` (new top entry)

- [ ] **Step 1: `sw.js`.** Change the `CACHE` constant to the next version.

- [ ] **Step 2: CLAUDE.md Roles row** (after the `firstAid` row):
```markdown
| `prayer` | All | `camper:read`, **`note:write:prayer`** + **`note:read:prayer`** (category `'prayer'` records, server-forced `sensitive:true`), **`note:read:student`** (every note on ONE opened student via `GET /notes/camper/:id`; no `/notes/recent`, no export). No `camper:read:sensitive` (no Medicare/parent reveal), no attendance/check-in, no notifications. SPA = first-aid screens (Search · All Students · Records · Schedule) with role dispatch; Medicare/consents/parent contact hidden in the UI only (owner decision 2026-10-02). Director/admin also hold the two prayer-note permissions; zone leaders read prayer records through `note:read` (zone-scoped); church never sees them (sensitive). |
```
Also add `prayer` to the scope line of `canAccessChurch`'s description, if CLAUDE.md quotes it.

- [ ] **Step 3: debug.md.** Add `prayer` to the per-set template's role list (`church | zoneLeader | director | admin | firstAid | prayer`). Add `prayer` beside `firstAid` in the role × mode nav table (`Search · All Students · Records · Schedule`, same in both modes). Add these symptom-router rows:
```markdown
| **Prayer team: tapping a student shows the FIRST-AID card (consents/Medicare)** | `openStudentInfo`'s first line must dispatch `prayer` → `openPrayerInfo`. Card = `openPrayerInfo` / `_loadPrayerNotes`; form = `openPrayerLog` / `savePrayerLog`. |
| **Prayer record visible to a church login** | Server forces `sensitive:true` for `category:'prayer'` in `note.service.add`; `forCamper` hides sensitive notes from `church`. Check the row's `notes.sensitive`. |
| **Prayer team can't see a student's notes / "cannot read student notes"** | `note.service.forCamper` gate = `note:write` OR `note:read:student`; pre-camp registrants allowed via `preCampEligible` (firstAid + prayer only). |
| **Prayer Records tab empty / shows first-aid logs** | `RENDER.records` dispatches `prayer` → `renderPrayerRecords` (`GET /notes/prayer`, `recentPrayer` → `recentInCategory`). Day filter reuses `_faDayOpts`/`_faKeep`. |
```

- [ ] **Step 4: `docs/reference/auth-and-accounts.md` section and CHANGELOG entry.** Each is 5–10 lines covering what the role can and cannot do, the decisions in the Design section, and "no migration; inert until an admin creates a Prayer team account; this year's `PRAYER: ` director notes untouched". Add the test count after Step 5.

- [ ] **Step 5: Final verification (run all and read the output)**

```bash
npm run typecheck
npm run test
npm run harness
S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1); E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1); sed -n "$((S+1)),$((E-1))p" public/index.html > "$TEMP/spa.js" && node --check "$TEMP/spa.js" && node --check public/sw.js && echo SPA_OK
git log --oneline master..HEAD
```
Expected: typecheck clean; tests 1219 + new, all pass; harness "All checks passed"; `SPA_OK`; 5 commits on the branch.

- [ ] **Step 6: Commit**

```bash
git status
git add public/sw.js CLAUDE.md debug.md docs/reference/auth-and-accounts.md CHANGELOG.txt
git commit -m "docs+sw: prayer team role (camp-v144)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G66tatZRXiY4qB4EvoUU3e"
```

- [ ] **Step 7: STOP — ask the user before deploying.** Report the commit list, the test count, and the manual on-device checks below. Then ask: "Merge `feature/prayer-team-role` into `master` and push (this deploys to production)?" Only on an explicit yes:
```bash
git checkout master && git pull --ff-only origin master && git merge --ff-only feature/prayer-team-role && git push origin master
```
Then confirm the deploy actually landed (per debug.md's 2026-07-31 exception) before asking the user to test on a device: `curl -s https://my-youth-camp.vercel.app/sw.js | head -1` must show the new `camp-vNNN`. If not, push an empty commit to re-trigger.

**On-device checks for the owner** (cannot be proven by tests):
1. Admin → Accounts: create a "Prayer team" login.
2. Log in as it: lands on Search; nav = Search · All Students · Records · Schedule; header badge "Prayer team".
3. Open a student: leader contact first, notes list, muted medical/dietary; no consents, Medicare or parent contact.
4. Record a prayer: it appears on the card and in Records (Today).
5. As a zone leader for that student's zone: Notes tab "Prayer" filter shows it, and the student profile shows it with the Sensitive pill.
6. As that student's church login: the record does NOT appear.
7. As first aid: the screens look exactly as before.
