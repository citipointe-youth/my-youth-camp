# Accommodation "Left to per-registration" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a director/admin mark one ministry as "Left to per-registration", so it is exempt from the 75% classroom rule. That ministry's classroom-kind people become placeable classroom groups and its tent-kind people stay in Tent City, instead of everyone being moved to tents.

**Architecture:** A new boolean on `churches` (`accommodation_per_registration`, migration `0029`). The pure eligibility check `isEligible` in `src/services/accommodation-allocation.ts` takes an optional set of flagged church ids. `computeGroups` and `tentDistribution` pass it through, and the service builds it from the church repo. A dedicated director+admin endpoint `PATCH /accommodation/per-registration/:churchId` toggles the flag. When the flag is turned off, the endpoint also deletes that church's room placements whose group no longer exists. The SPA replaces its four hardcoded `0.75` checks with one helper `_accomEligible(c)` that reads the flags, and turns the Status cell of the "Under 75% — Moved to Tents" table into a dropdown.

**Tech Stack:** TypeScript backend (zod, vitest, in-memory + Supabase repositories), vanilla-JS SPA (`public/index.html`, no build step), Node harness `scripts/accom-export-harness.js` (vitest cannot reach SPA code), Supabase Postgres migration.

**Spec:** Design agreed in chat on 2026-09-24 (no separate spec file). Reproduced:

- **Problem:** one ministry sends juniors to classrooms and seniors to tents. It sits under 75% classroom, so the allocations screen moves all its classroom-kind people to Tent City.
- **Control:** the **Status** column of the "Under 75% — Moved to Tents" table becomes a dropdown: **"Counted in Tent City below"** (default, today's behaviour) / **"Left to per-registration"**.
- **Per-registration meaning:** the church skips the 75% bar. Classroom-kind people form normal classroom groups (same church×gender pooling, same >50 splits). Tent-kind people stay in Tent City. People with no accommodation type stay in "Pending". Every other church is unchanged.
- **The row stays visible while flagged,** so it can be switched back.
- **Switching back** removes that church's classroom placements for groups that no longer exist. The SPA asks first when anyone from that church is placed.
- **Who can change it:** director + admin (the same people who place groups in rooms), subject to the existing accommodation lock (`assertNotLocked`: admin bypasses, director blocked when locked). ⚠ **Owner decision point.** If the owner wants admin-only, change `assertDirectorOrAdmin` to `assertCan(actor, 'admin:manage')` in Task 3 and flip the matching test. Nothing else changes.
- **New-year rollover:** the flag lives on the church row, so it rides the Save Defaults snapshot like `accommodationOverride` does. That's deliberate: this is a standing arrangement of the ministry, and the row is visible on the screen whenever it applies.

## Global Constraints

- Repo: `C:\Users\thoma\OneDrive\Claude Programs\Project 9 - Camp Platform\youth-camp-platform-masterv2`, branch `master`.
- `master` auto-deploys to production (https://my-youth-camp.vercel.app). **Do not push.** Commit locally only; the owner decides when to push.
- **Migration `0029` must be applied to prod BEFORE this code deploys.** `supabase.churches.ts` `save()` names the new column in its insert and on-conflict list, so a pre-migration deploy 500s every church write. Do not apply it yourself; the owner applies it.
- The SPA mirrors the backend rules. After this change the 75% ratio must exist in exactly **two** places: `ELIGIBLE_RATIO` (backend) and `ACCOM_ELIGIBLE_RATIO` (SPA). No literal `0.75` may remain in `public/index.html` accommodation code.
- The accommodation export stays client-side (CLAUDE.md "Accommodation export": **do not move it server-side**).
- Bump `public/sw.js` `CACHE` `'camp-v123'` → `'camp-v124'`. `/accommodation` is already in `API_RE`, so no route-list edit.
- No new dependency.
- Stage files by name, never `git add -A`. Use `git -c core.autocrlf=true` if CRLF noise appears. Never amend; fix-ups are new commits.
- Commit messages end with the executing session's attribution lines (from its system reminder).
- User-facing copy is exactly **"Counted in Tent City below"** and **"Left to per-registration"**.

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/services/accommodation-allocation.ts` | Modify `isEligible` (~79), `computeGroups` (~172), `tentDistribution` (~226); add `EligibilityOptions` | Pure rule |
| `src/services/accommodation-allocation.test.ts` | Add a `describe` block | Pure-rule tests |
| `supabase/migrations/0029_church_accommodation_per_registration.sql` | Create | Column |
| `src/core/entities/church.ts` | Add field | Entity |
| `src/repositories/supabase/supabase.churches.ts` | Mapper, columns, `UPDATE_COLS` | Persistence |
| `src/core/validation/accommodation.schema.ts` | Add `SetPerRegistrationSchema` | Validation |
| `src/services/accommodation.service.ts` | `eligibilityOptions()`, `keyOf()`, `setPerRegistration`; pass options in `listGroups`/`setAllocations` | Service |
| `src/services/accommodation.characterisation.test.ts` | Add a `describe` block | Service tests |
| `src/api/controllers/accommodation.controller.ts` | Add `setPerRegistration` | HTTP |
| `src/api/http/router.ts` | One route line after line 116 | HTTP |
| `public/index.html` | Helper + 4 call sites, `RENDER.accom` load, `accomTable`, `drawAccom` tentedOut, export summary, `setAccomPerReg`, `_invalidate` | SPA |
| `scripts/accom-export-harness.js` | Add helper to `PARTS`, scenario 12 | SPA verification |
| `public/sw.js` | Line 1 | Cache bump |
| `CLAUDE.md`, `debug.md` | Top entry + table rows | Project docs |

## Execution routing

Tasks 1–3 are backend TDD and suit a Sonnet subagent each. Task 4 is SPA work in a 10k-line file, which also suits a subagent, but its diff must be read in full before Task 5. Each subagent prompt must include this plan's path, the task number, the repo path, and "do not push". Verify each task's diff (`git show --stat HEAD` + read the hunk) before starting the next. Agent summaries describe intent, not results.

---

### Task 1: Pure eligibility rule accepts per-registration churches

**Files:**
- Modify: `src/services/accommodation-allocation.ts` (~56–81, ~172–180, ~226–250)
- Test: `src/services/accommodation-allocation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EligibilityOptions { perRegistration?: ReadonlySet<string> }
  export function computeGroups(occupants: readonly AllocationOccupant[], opts?: EligibilityOptions): AllocationGroup[];
  export function tentDistribution(occupants: readonly AllocationOccupant[], opts?: EligibilityOptions): TentChurch[];
  ```
  Omitting `opts` must give exactly today's behaviour (every existing caller and test is unchanged).

- [ ] **Step 1: Write the failing tests.** Append to `src/services/accommodation-allocation.test.ts`:

```ts
describe('per-registration churches (bypass the 75% bar)', () => {
  // c9: 2 classroom juniors (1 male, 1 female) + 3 male tent seniors = 40% classroom.
  const split = [
    occ({ churchId: 'c9', churchName: 'Hope', gender: 'male', grade: 8 }),
    occ({ churchId: 'c9', churchName: 'Hope', gender: 'female', grade: 8 }),
    occ({ churchId: 'c9', churchName: 'Hope', gender: 'male', grade: 11, accommodationKind: 'tent' }),
    occ({ churchId: 'c9', churchName: 'Hope', gender: 'male', grade: 11, accommodationKind: 'tent' }),
    occ({ churchId: 'c9', churchName: 'Hope', gender: 'male', grade: 11, accommodationKind: 'tent' }),
  ];
  const flagged = { perRegistration: new Set(['c9']) };

  it('without the flag, an under-75% church still gets no classroom groups', () => {
    expect(computeGroups(split)).toEqual([]);
  });

  it('with the flag, its classroom-kind people form normal per-gender groups', () => {
    const groups = computeGroups(split, flagged);
    expect(groups.map((g) => g.key).sort()).toEqual(['c9|female', 'c9|male']);
    expect(groups.find((g) => g.key === 'c9|male')!.n).toBe(1);
  });

  it('with the flag, only tent-kind people are counted in tents', () => {
    const [t] = tentDistribution(split, flagged);
    expect(t.m).toEqual({ stu: 3, ld: 0 });
    expect(t.f).toEqual({ stu: 0, ld: 0 });
  });

  it('without the flag, classroom-kind people still fold into tents (unchanged)', () => {
    const [t] = tentDistribution(split);
    expect(t.m).toEqual({ stu: 4, ld: 0 });
    expect(t.f).toEqual({ stu: 1, ld: 0 });
  });

  it('flagging one church does not lift another under-75% church', () => {
    const other = [
      occ({ churchId: 'c8', accommodationKind: 'classroom' }),
      occ({ churchId: 'c8', accommodationKind: 'tent' }),
      occ({ churchId: 'c8', accommodationKind: 'tent' }),
    ];
    const keys = computeGroups([...split, ...other], flagged).map((g) => g.key);
    expect(keys.some((k) => k.startsWith('c8|'))).toBe(false);
  });

  it('a flagged church with no classroom-kind people emits no groups', () => {
    const allTent = [occ({ churchId: 'c7', accommodationKind: 'tent' })];
    expect(computeGroups(allTent, { perRegistration: new Set(['c7']) })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
  Run: `npx vitest run src/services/accommodation-allocation.test.ts`
  Expected: the "with the flag" tests FAIL (groups `[]`, tent counts 4/1). `tsc` may also flag the extra argument. Both count as the expected failure.

- [ ] **Step 3: Implement.** In `src/services/accommodation-allocation.ts`:

After `export const TENT_SIZE = 7;` add:
```ts
// Churches whose accommodation is "left to per-registration" (owner, 2026-09-24): they skip the
// 75% bar, so each person sleeps where they registered — classroom-kind people get classroom
// groups, tent-kind people stay in tents. Omit it and the rule is exactly the 75% bar.
export interface EligibilityOptions { perRegistration?: ReadonlySet<string> }
```

Replace `isEligible`:
```ts
function isEligible(c: Pick<ChurchTally, 'id' | 'total' | 'classroom'>, opts?: EligibilityOptions): boolean {
  if (opts?.perRegistration?.has(c.id)) return true;
  return c.total > 0 && c.classroom / c.total >= ELIGIBLE_RATIO;
}
```

`computeGroups`: change the signature to `(occupants: readonly AllocationOccupant[], opts?: EligibilityOptions)` and the check to `if (!isEligible(c, opts)) continue;`.

`tentDistribution`: change the signature the same way, and the line to `const churchEligible = tally != null && isEligible(tally, opts);`. (A flagged church with zero classroom people is "eligible" but emits no groups, because `groupsForGender` returns `[]` when `g.cls === 0`. Its tent people are unaffected because only `classroom`-kind people are folded.)

Update the comment above `isEligible` to mention that a per-registration church skips the bar.

- [ ] **Step 4: Run to verify pass.**
  Run: `npx vitest run src/services/accommodation-allocation.test.ts && npm run typecheck`
  Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit.**
```bash
git add src/services/accommodation-allocation.ts src/services/accommodation-allocation.test.ts
git commit -m "Accommodation: eligibility accepts per-registration churches (pure rule)"
```

---

### Task 2: Persist the flag on churches

**Files:**
- Create: `supabase/migrations/0029_church_accommodation_per_registration.sql`
- Modify: `src/core/entities/church.ts`, `src/repositories/supabase/supabase.churches.ts`

**Interfaces:**
- Produces: `Church.accommodationPerRegistration?: boolean` (absent/false = the 75% rule applies).

- [ ] **Step 1: Migration.** Create `supabase/migrations/0029_church_accommodation_per_registration.sql`:
```sql
-- Accommodation "Left to per-registration" (owner, 2026-09-24). A ministry that sends juniors to
-- classrooms and seniors to tents sits under the 75% classroom bar, which moved ALL its
-- classroom-kind people to tents. When true, the church skips the bar: each person sleeps where
-- they registered. Set from the Accommodation allocations screen (PATCH
-- /accommodation/per-registration/:churchId).
--
-- Additive, default false (= today's behaviour for every church), no backfill. Must be applied to
-- prod BEFORE the code deploys — supabase.churches names it in its insert and on-conflict list.
alter table churches add column if not exists accommodation_per_registration boolean not null default false;
```

- [ ] **Step 2: Entity.** In `src/core/entities/church.ts`, after `accommodationOverride?: AccommodationKind | null;` add:
```ts
  /**
   * "Left to per-registration" (2026-09-24): when true this church skips the 75% classroom
   * eligibility bar in accommodation allocation — classroom-kind people get classroom groups,
   * tent-kind people stay in tents. Unlike `accommodationOverride` it changes no one's
   * accommodationKind; it only changes whether the church's classroom people are placeable.
   */
  accommodationPerRegistration?: boolean;
```

- [ ] **Step 3: Mapper.** In `src/repositories/supabase/supabase.churches.ts`:
  - `toChurch`: after the `accommodationOverride` line add `accommodationPerRegistration: row['accommodation_per_registration'] === true,`
  - `churchColumns`: after `accommodation_override` add `accommodation_per_registration: c.accommodationPerRegistration ?? false,`
  - `UPDATE_COLS`: add `'accommodation_per_registration',` after `'accommodation_override',`

- [ ] **Step 4: Verify.**
  Run: `npm run typecheck && npx vitest run`
  Expected: clean, all pass (no behaviour change yet).

- [ ] **Step 5: Commit.**
```bash
git add supabase/migrations/0029_church_accommodation_per_registration.sql src/core/entities/church.ts src/repositories/supabase/supabase.churches.ts
git commit -m "Churches: accommodation_per_registration column (migration 0029)"
```

---

### Task 3: Service + endpoint — honour and toggle the flag

**Files:**
- Modify: `src/core/validation/accommodation.schema.ts`, `src/services/accommodation.service.ts`, `src/api/controllers/accommodation.controller.ts`, `src/api/http/router.ts` (after line 116)
- Test: `src/services/accommodation.characterisation.test.ts`

**Interfaces:**
- Consumes: `EligibilityOptions`, `computeGroups(occ, opts)` (Task 1); `Church.accommodationPerRegistration` (Task 2).
- Produces:
  - `AccommodationService.setPerRegistration(actor: Actor, churchId: string, input: unknown): Promise<Church>`
  - HTTP `PATCH /accommodation/per-registration/:churchId`, body `{ perRegistration: boolean }`, returns the updated `Church`.

- [ ] **Step 1: Write the failing tests.** Append to `src/services/accommodation.characterisation.test.ts` (reuses the file's `actor`/`room`/`church`/`reg`/`settings`/`build` builders):

```ts
describe('per-registration churches (2026-09-24)', () => {
  // Hope (c9): 1 classroom junior + 3 tent seniors, all male = 25% classroom.
  const hopeRegs = [
    reg({ id: 'h1', churchId: 'c9', churchName: 'Hope', grade: 8 }),
    reg({ id: 'h2', churchId: 'c9', churchName: 'Hope', grade: 11, accommodationKind: 'tent' }),
    reg({ id: 'h3', churchId: 'c9', churchName: 'Hope', grade: 11, accommodationKind: 'tent' }),
    reg({ id: 'h4', churchId: 'c9', churchName: 'Hope', grade: 11, accommodationKind: 'tent' }),
  ];
  const hope = (flag: boolean) => church({ id: 'c9', name: 'Hope', accommodationPerRegistration: flag });

  it('listGroups omits an unflagged under-75% church', async () => {
    const { svc } = await build({ churches: [hope(false)], registrants: hopeRegs });
    expect(await svc.listGroups(actor('director'))).toEqual([]);
  });

  it('listGroups includes a flagged church, and setAllocations accepts its group', async () => {
    const { svc } = await build({ churches: [hope(true)], registrants: hopeRegs, rooms: [room({ id: 'rm' })] });
    expect((await svc.listGroups(actor('director'))).map((g) => g.key)).toEqual(['c9|male']);
    const map = await svc.setAllocations(actor('director'), { allocations: { rm: [{ key: 'c9|male', n: 1 }] } });
    expect(map).toEqual({ rm: [{ key: 'c9|male', n: 1 }] });
  });

  it('setPerRegistration persists the flag', async () => {
    const { svc, churchRepo } = await build({ churches: [hope(false)], registrants: hopeRegs });
    await svc.setPerRegistration(actor('director'), 'c9', { perRegistration: true });
    expect((await churchRepo.findById('c9'))!.accommodationPerRegistration).toBe(true);
  });

  it('turning it off removes that church\'s now-orphaned placements, and only those', async () => {
    const { svc, allocationRepo } = await build({
      churches: [hope(true), church({ id: 'c1' })],
      registrants: [...hopeRegs, ...victoryClassroomRegs],
      rooms: [room({ id: 'rm', capacity: 10 })],
    });
    await svc.setAllocations(actor('admin'), { allocations: { rm: [{ key: 'c9|male', n: 1 }, { key: 'c1|male', n: 3 }] } });
    await svc.setPerRegistration(actor('admin'), 'c9', { perRegistration: false });
    const left = (await allocationRepo.findAll()).map((r) => `${r.churchId}|${r.gender}`);
    expect(left).toEqual(['c1|male']);
  });

  it('turning it off keeps placements for a church that clears 75% on its own', async () => {
    const { svc, allocationRepo } = await build({
      churches: [church({ id: 'c1', accommodationPerRegistration: true })],
      registrants: victoryClassroomRegs,
      rooms: [room({ id: 'rm', capacity: 10 })],
    });
    await svc.setAllocations(actor('admin'), { allocations: { rm: [{ key: 'c1|male', n: 3 }] } });
    await svc.setPerRegistration(actor('admin'), 'c1', { perRegistration: false });
    expect((await allocationRepo.findAll()).length).toBe(1);
  });

  it('church logins are refused', async () => {
    const { svc } = await build({ churches: [hope(false)] });
    await expect(svc.setPerRegistration(actor('church', { churchId: 'c9' }), 'c9', { perRegistration: true }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a director is refused while accommodation is locked; admin is not', async () => {
    const { svc } = await build({ churches: [hope(false)], settings: settings({ accommodationLocked: true }) });
    await expect(svc.setPerRegistration(actor('director'), 'c9', { perRegistration: true }))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.setPerRegistration(actor('admin'), 'c9', { perRegistration: true })).resolves.toBeTruthy();
  });

  it('unknown church is NotFound; a non-boolean body is rejected', async () => {
    const { svc } = await build({ churches: [hope(false)] });
    await expect(svc.setPerRegistration(actor('admin'), 'nope', { perRegistration: true }))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setPerRegistration(actor('admin'), 'c9', { perRegistration: 'yes' })).rejects.toThrow();
  });
});
```
(Check that `victoryClassroomRegs` is declared at module scope above this block. It is, at ~line 116. If `reg` doesn't accept `grade` via `Partial<Person>`, drop the `grade` fields; they don't affect these assertions.)

- [ ] **Step 2: Run to verify failure.**
  Run: `npx vitest run src/services/accommodation.characterisation.test.ts`
  Expected: FAIL (`setPerRegistration is not a function`; the flagged `listGroups` returns `[]`).

- [ ] **Step 3: Schema.** Append to `src/core/validation/accommodation.schema.ts`:
```ts
// PATCH /accommodation/per-registration/:churchId — "Left to per-registration" toggle (2026-09-24).
export const SetPerRegistrationSchema = z.object({ perRegistration: z.boolean() });
export type SetPerRegistrationInput = z.infer<typeof SetPerRegistrationSchema>;
```

- [ ] **Step 4: Service.** In `src/services/accommodation.service.ts`:
  - Imports: add `SetPerRegistrationSchema` to the schema import; add `type EligibilityOptions` to the `./accommodation-allocation` import; add `import type { Church } from '../core/entities/church';`.
  - Interface: add `setPerRegistration(actor: Actor, churchId: string, input: unknown): Promise<Church>;`
  - Inside `makeAccommodationService`, after `occupants()` add:
    ```ts
    async function eligibilityOptions(): Promise<EligibilityOptions> {
      const churches = await churchRepo.findAll();
      return { perRegistration: new Set(churches.filter((c) => c.accommodationPerRegistration).map((c) => c.id)) };
    }

    // The group key a stored row belongs to (C-1: split sub-pools carry a bracket → 3-part key).
    function keyOf(r: RoomAllocation): string {
      return r.bracket ? `${r.churchId}|${r.gender}|${r.bracket}` : `${r.churchId}|${r.gender}`;
    }
    ```
  - `rowsToMap`: replace the inline key expression with `const key = keyOf(r);` (keep the C-1 comment on `keyOf`).
  - `listGroups`: `return computeGroups(await occupants(), await eligibilityOptions());`
  - `setAllocations`: `const groups = computeGroups(await occupants(), await eligibilityOptions());`
  - Add the method (after `setAllocations`):
    ```ts
    async setPerRegistration(actor, churchId, input) {
      assertDirectorOrAdmin(actor);
      await assertNotLocked(actor);
      const { perRegistration } = SetPerRegistrationSchema.parse(input);
      const church = await churchRepo.findById(churchId);
      if (!church) throw new NotFoundError('Church not found');
      const saved = await churchRepo.save({ ...church, accommodationPerRegistration: perRegistration, updatedAt: nowISO() });
      if (!perRegistration) {
        // Switching back can make this church's classroom groups disappear. setAllocations
        // replaces the WHOLE map and rejects any unknown group key, so an orphaned row left
        // here would make every later save on the screen fail. Drop only rows whose group no
        // longer exists — a church that clears 75% on its own keeps its placements.
        const live = new Set(computeGroups(await occupants(), await eligibilityOptions()).map((g) => g.key));
        for (const r of await allocationRepo.findAll()) {
          if (r.churchId === churchId && !live.has(keyOf(r))) await allocationRepo.delete(r.id);
        }
      }
      return saved;
    },
    ```

- [ ] **Step 5: Controller + route.**
  In `src/api/controllers/accommodation.controller.ts`, after `setAllocations` add:
  ```ts
    async setPerRegistration(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const churchId = req.params['churchId'];
      if (!churchId) throw new BadRequestError('Missing churchId');
      return services.accommodation.setPerRegistration(req.ctx.actor, churchId, req.body);
    },
  ```
  In `src/api/http/router.ts`, after the `PATCH /accommodation/allocations` line (116) add:
  ```ts
    { method: 'PATCH', path: '/accommodation/per-registration/:churchId', auth: true, handler: (r) => accommodation.setPerRegistration(r) },
  ```

- [ ] **Step 6: Run to verify pass.**
  Run: `npm run typecheck && npx vitest run`
  Expected: clean. All pass, count = previous + 6 (Task 1) + 8 (this task). Record the number for the docs.

- [ ] **Step 7: Commit.**
```bash
git add src/core/validation/accommodation.schema.ts src/services/accommodation.service.ts src/services/accommodation.characterisation.test.ts src/api/controllers/accommodation.controller.ts src/api/http/router.ts
git commit -m "Accommodation: PATCH /accommodation/per-registration/:churchId, honoured by groups + validation"
```

---

### Task 4: SPA — one eligibility helper, the Status dropdown, export + harness

**Files:**
- Modify: `public/index.html` (line numbers approximate; locate by name), `public/sw.js` line 1
- Test: `scripts/accom-export-harness.js`

**Interfaces:**
- Consumes: `GET /accounts/churches` now returns `accommodationPerRegistration` on each church (Task 2); `PATCH /accommodation/per-registration/:churchId` (Task 3).
- Produces (SPA globals): `ACCOM_ELIGIBLE_RATIO`, `_accomEligible(c)`, `_accomUnderBar(c)`, `window._accomPerReg` (`{[churchId]: true}`), `setAccomPerReg(churchId, on, sel)`.

- [ ] **Step 1: Write the failing harness scenario.** In `scripts/accom-export-harness.js`:
  - In `PARTS`, insert after `'function accomChurches(regs)',`:
    ```js
      'const ACCOM_ELIGIBLE_RATIO=0.75;',
      'function _accomEligible(c)',
      'function _accomUnderBar(c)',
    ```
  - Before the final `console.log('\n' + (failures ...` line, add:
    ```js
    // ── 12. "Left to per-registration" (2026-09-24): a flagged under-75% ministry keeps its
    //        classroom people in classroom cohorts and ONLY its tent people in tents ───────────
    ctx.window._accomPerReg = { c1: true };
    run('12. Per-registration ministry under 75% — juniors to classrooms, seniors to tents',
      [...many(4, { accommodationKind: 'classroom', grade: 8 }),
       ...many(16, { accommodationKind: 'tent', grade: 11 })],
      [], {},
      (d) => {
        check('one classroom cohort of the 4 juniors', d.cohortRows.length, 2);
        check('cohort size', d.cohortRows[1][5], 4);
        check('only the 16 tent-kind in tents', d.tentRows[1][2], 16);
        check('not listed as moved to tents',
          d.sumRows.find((r) => r[0] === 'Ministries under the 75% classroom threshold')[1], 0);
        check('listed as per-registration',
          d.sumRows.find((r) => r[0] === 'Ministries left to per-registration')[1], 1);
      });
    ctx.window._accomPerReg = {};

    // ── 13. No hardcoded 0.75 left in the SPA's accommodation code ─────────────────────────
    console.log('\n13. The 75% ratio lives only in ACCOM_ELIGIBLE_RATIO');
    ['function accomGroups(regs)', 'function tentDist(regs)', 'function _accomExportRows()', 'function drawAccom()']
      .forEach((n) => checkTrue(n + ' has no literal 0.75', !extract(n).includes('0.75')));
    ```
  Run: `node scripts/accom-export-harness.js`
  Expected: FAIL. `not found in index.html: const ACCOM_ELIGIBLE_RATIO=0.75;` is the expected first failure.

- [ ] **Step 2: Helper.** In `public/index.html`, directly after `function accomChurches(regs){…}` (~5557–5570) insert:
  ```js
  // The 75% classroom bar — the ONE SPA copy (mirrors backend ELIGIBLE_RATIO / isEligible in
  // src/services/accommodation-allocation.ts). A ministry flagged "Left to per-registration"
  // (window._accomPerReg, from churches.accommodationPerRegistration) skips the bar: its
  // classroom-kind people get classroom groups, its tent-kind people stay in tents.
  const ACCOM_ELIGIBLE_RATIO=0.75;
  function _accomEligible(c){if(!c)return false;if((window._accomPerReg||{})[c.id])return true;
    return c.total>0&&c.classroom/c.total>=ACCOM_ELIGIBLE_RATIO;}
  // Under the bar on the numbers alone, flag or not — the rows of "Under 75% — Moved to Tents".
  function _accomUnderBar(c){return c.total>0&&c.classroom>0&&c.classroom/c.total<ACCOM_ELIGIBLE_RATIO;}
  ```

- [ ] **Step 3: Replace the four literals.**
  - `accomGroups` (~5609): `const elig=c.total>0&&c.classroom/c.total>=0.75;` → `const elig=_accomEligible(c);`
  - `tentDist` (~5635): `const elig=!!cc&&cc.total>0&&cc.classroom/cc.total>=0.75;` → `const elig=_accomEligible(cc);`
  - `_accomExportRows` (~5724): replace the `underThreshold` line with:
    ```js
    const underThreshold=Object.values(by).filter(c=>_accomUnderBar(c)&&!_accomEligible(c));
    const perRegMinistries=Object.values(by).filter(c=>_accomUnderBar(c)&&_accomEligible(c));
    ```
    Leave the `sumRows` literal alone. The under-threshold ministry names are pushed **after** it (the existing `underThreshold.slice().sort(…).forEach(c=>{sumRows.push(…)})`), so add the new section directly after that loop. That way each list sits under its own heading:
    ```js
    sumRows.push(['Ministries left to per-registration',perRegMinistries.length],
      ['','Under 75%, but each person sleeps where they registered (classroom or tent).']);
    perRegMinistries.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{
      sumRows.push(['  '+c.name,c.classroom+' of '+c.total+' chose classroom (per registration)']);
    });
    ```
  - `drawAccom` (~5832): replace the `tentedOut` block with:
    ```js
    const tentedOut=[];
    Object.values(by).forEach(c=>{if(!_accomUnderBar(c))return;
      // Stays listed while flagged, so it can be switched back.
      const on=!!(window._accomPerReg||{})[c.id];
      tentedOut.push([c.name,'Classroom',c.classroom,'',
        `<select aria-label="Accommodation for ${esc(c.name)}" onchange="setAccomPerReg('${c.id}',this.value==='1',this)" style="font-size:.82rem;max-width:100%">`
        +`<option value="0"${on?'':' selected'}>Counted in Tent City below</option>`
        +`<option value="1"${on?' selected':''}>Left to per-registration</option></select>`]);});
    ```
  - `accomTable` status cell: change
    `<td style="padding:7px 4px 7px 12px"><span class="sub">${esc(r[3])}</span></td>`
    to
    `<td style="padding:7px 4px 7px 12px">${r[4]!=null?r[4]:`<span class="sub">${esc(r[3])}</span>`}</td>`
    (`r[4]` is pre-built HTML; only `drawAccom` supplies it, and every dynamic part is `esc()`'d or a church id.)
  - Update the heading tooltip for the "Under 75% — Moved to Tents" section (find `Under 75%` in `drawAccom`) and append: *"Choose 'Left to per-registration' for a ministry that deliberately splits (e.g. juniors in classrooms, seniors in tents) — its classroom people then appear above to place in rooms."*

- [ ] **Step 4: Load the flags.** In `RENDER.accom` (~5518):
  - Change `api('/accounts/churches').catch(()=>[])` → `api('/accounts/churches')`. The screen is director/admin only and both can list churches. A swallowed failure here would silently show a flagged ministry as tents while the server treats it as placeable (the 2026-08-01 `.catch(()=>[])` lesson).
  - After `window._accomRegs=…;` add:
    ```js
    window._accomPerReg=Object.fromEntries((churches||[]).filter(c=>c.accommodationPerRegistration).map(c=>[c.id,true]));
    ```

- [ ] **Step 5: Toggle handler.** Directly after `removeAlloc` (~5630) add:
  ```js
  // "Left to per-registration" toggle (2026-09-24). Switching BACK drops this ministry's classroom
  // placements server-side (their groups stop existing), so confirm first when any are placed.
  async function setAccomPerReg(churchId,on,sel){
    if(!on){
      let placed=0;Object.values(window._accomAlloc||{}).forEach(arr=>(arr||[]).forEach(e=>{if(e.key.split('|')[0]===churchId)placed+=e.n;}));
      if(placed>0&&!await confirmSheet({title:'Move them back to Tent City?',body:placed+' from this ministry '+(placed===1?'is':'are')+' placed in classrooms. Switching back removes them from those rooms.',confirmLabel:'Move to tents',danger:true})){if(sel)sel.value='1';return;}
    }
    try{await api('/accommodation/per-registration/'+churchId,{method:'PATCH',body:{perRegistration:on}});
      window._accomPerReg=Object.assign({},window._accomPerReg,{[churchId]:on||undefined});
      window._accomAlloc=await api('/accommodation/allocations');drawAccom();toast('Saved');}
    catch(e){if(sel)sel.value=on?'0':'1';toast(e.message);}}
  ```
  (`{[churchId]:undefined}` is falsy, which is all `_accomEligible` checks.)

- [ ] **Step 6: Cache invalidation.** In `_invalidate` (~1076), directly **above** `else if(path.startsWith('/accommodation'))Cache.del('/accommodation');` add:
  ```js
  // The per-registration flag lives on the church row, so /accounts/churches is stale too — without
  // this, reopening the allocations screen within 30s would load the old flag.
  else if(path.startsWith('/accommodation/per-registration'))Cache.del('/accommodation','/accounts');
  ```

- [ ] **Step 7: sw.js.** Line 1: `const CACHE = 'camp-v123';` → `const CACHE = 'camp-v124';`

- [ ] **Step 8: Verify.**
  ```bash
  node scripts/accom-export-harness.js
  S=$(grep -n '^<script>$' public/index.html|head -1|cut -d: -f1); E=$(grep -n '^</script>$' public/index.html|tail -1|cut -d: -f1); sed -n "$((S+1)),$((E-1))p" public/index.html > "$TMPDIR/spa.js" && node --check "$TMPDIR/spa.js" && node --check public/sw.js && echo SPA-OK
  grep -n "0\.75" public/index.html
  ```
  Expected: harness "All checks passed." (including scenarios 6, 12, 13); `SPA-OK`; the grep shows only the `ACCOM_ELIGIBLE_RATIO` line plus any prose/tooltip text (no comparisons).

- [ ] **Step 9: Commit.**
```bash
git add public/index.html public/sw.js scripts/accom-export-harness.js
git commit -m "Accommodation screen: 'Left to per-registration' dropdown; one SPA copy of the 75% rule"
```

---

### Task 5: Docs, full verification, hand-off

**Files:** `CLAUDE.md`, `debug.md`

- [ ] **Step 1: Full verification.**
  ```bash
  npm run typecheck && npx vitest run && node scripts/accom-export-harness.js
  ```
  Expected: clean / all pass / all checks passed. Record the counts.

- [ ] **Step 2: CLAUDE.md.** Add a new top entry `## Accommodation: "Left to per-registration" per ministry — 2026-09-24` covering: the problem (juniors→classrooms, seniors→tents ministry under 75%), the dropdown, `churches.accommodation_per_registration` + **migration `0029` must be applied to prod before deploy**, the endpoint and its director+admin + lock rule, the switch-back cleanup and why (whole-map replace rejects unknown keys), the single SPA helper `_accomEligible` / `ACCOM_ELIGIBLE_RATIO` (**no literal 0.75 elsewhere; harness scenario 13 enforces it**), the `/accounts` cache invalidation, the removed `.catch(()=>[])`, rollover carry-over, and the verification counts + `camp-v124`. Also update the Accommodation line in the Architecture section (~6263) with one clause: *"a church flagged `accommodationPerRegistration` skips the 75% bar (2026-09-24)."*

- [ ] **Step 3: debug.md.** Update the `RENDER.accom` row (~483) and the Accommodation service row (~596) to mention `_accomEligible` / `EligibilityOptions`. Add a symptom row near ~1037:
  > **A ministry under 75% has classroom groups / its juniors aren't in Tent City** — Working as designed if it is flagged "Left to per-registration" (`churches.accommodation_per_registration`, 2026-09-24). Check the dropdown in "Under 75% — Moved to Tents". Backend `isEligible(c, opts)` / SPA `_accomEligible(c)`.

  And:
  > **Saving room placements fails with `Unknown group: <churchId>|…`** — a stored placement points at a group that no longer exists (the church dropped under 75%, or a flag was cleared outside `setPerRegistration`). `setAllocations` replaces the whole map, so one orphan blocks every save. Delete the orphaned `classroom_allocations` rows for that church.

- [ ] **Step 4: Commit.**
```bash
git add CLAUDE.md debug.md
git commit -m "Docs: accommodation per-registration flag"
```

- [ ] **Step 5: Stop and report.** Report the commits, test counts, and these owner actions, in order:
  1. Apply `supabase/migrations/0029_church_accommodation_per_registration.sql` to prod.
  2. Push `master` (this deploys).
  3. On Accommodation allocations, set the ministry to **Left to per-registration** and place its juniors in rooms.

  **Do not push.**

---

## Known limitation (out of scope, noted for the owner)

A church that was placed while at 75%+ and then **naturally** drops under 75% (for example after a re-import) leaves orphaned placements, and every later room save fails with `Unknown group`. That can already happen today and this plan doesn't change it. Only the flag's own switch-back is cleaned up. Task 5's debug.md row documents the recovery. A general fix (dropping orphans automatically on read or save) is a separate decision.
