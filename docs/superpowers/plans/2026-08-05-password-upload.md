# Password Upload (reverse of "Randomise & export passwords") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Upload** button beside "Randomise & export passwords" that takes the exported CSV (or an .xlsx) with the Password column edited and SETS those passwords on the matching accounts — the exact reverse of the export.

**Architecture:** All the decision logic lives in a new **pure** module `src/services/password-import.ts` (no repos, no hashing) so every resilience rule is unit-testable without fixtures. `account.service.importPasswords` is a thin wrapper that parses the CSV, calls the pure planner, and — only when `dryRun` is false — hashes and saves. The SPA reuses the existing `_readImportFile()` (CSV **and** .xlsx via lazy SheetJS) and runs dry-run → preview → confirm, the same shape as `offlineSignInUpload()`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Zod validation inside services, vitest, vanilla-JS SPA in `public/index.html`.

## Global Constraints

- **No schema or migration change.** Next migration stays `0021`. Do not create one.
- **Matching is on `Username`, lowercased, only.** Usernames are stored lowercased and unique. Never resolve a row from Church/Gender — a church-name typo must never set the wrong account's password.
- **`mustChangePassword` is set to `false`**, matching `randomizeChurchPasswords`. These are real handed-out passwords, not temporary ones.
- **The original admin (`findOriginalAdmin`) is never touched**, even if listed. It is the recovery account.
- **Inactive accounts ARE set** (owner's explicit call, a deliberate departure from `randomizeChurchPasswords` which skips them) — but every inactive username must be reported back so it is visible that the login still cannot be used until reactivated.
- **A blank password cell never clears a password.** Skip and count.
- **A plaintext password must NEVER appear in the response DTO.** The response carries counts and usernames only.
- Minimum password length is **6**, matching `SetPasswordSchema` (`z.string().min(6)`).
- Verify with `npm run typecheck` + `npx vitest run` + `node --check` on the extracted SPA body. **Do NOT start a dev server or drive a browser.**
- Baseline before this work: `npx vitest run` = **950 pass / 60 files**.

---

### Task 1: The pure planner — `src/services/password-import.ts`

**Files:**
- Create: `src/services/password-import.ts`
- Test: `src/services/password-import.test.ts`

**Interfaces:**
- Consumes: `User` from `../core/entities/user`; `field` and `missingColumns` from `./elvanto-mapping`.
- Produces (Task 2 depends on these exact names):
  - `PASSWORD_IMPORT_COLUMNS: readonly ['Username','Password']`
  - `MIN_IMPORT_PASSWORD_LENGTH: 6`
  - `parsePasswordRows(rows: Record<string,string>[]): ParsedPasswordRow[]`
  - `planPasswordImport(parsed: ParsedPasswordRow[], users: User[], originalAdminId: string | null): PasswordImportPlan`
  - types `ParsedPasswordRow`, `PasswordImportPlan`, `PasswordImportApply`

- [ ] **Step 1: Write the failing test**

Create `src/services/password-import.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parsePasswordRows,
  planPasswordImport,
  PASSWORD_IMPORT_COLUMNS,
  MIN_IMPORT_PASSWORD_LENGTH,
} from './password-import';
import type { User } from '../core/entities/user';

function user(over: Partial<User> & { id: string; username: string }): User {
  return {
    firstName: 'A',
    lastName: 'B',
    role: 'church',
    status: 'active',
    passwordHash: 'x',
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as User;
}

const users = [
  user({ id: 'u1', username: 'b-victory' }),
  user({ id: 'u2', username: 'g-victory' }),
  user({ id: 'u3', username: 'director', role: 'director' }),
  user({ id: 'u4', username: 'oldchurch', status: 'inactive' }),
  user({ id: 'admin1', username: 'admin', role: 'admin' }),
];

describe('parsePasswordRows', () => {
  it('reads Username and Password, keeping the original row number', () => {
    const out = parsePasswordRows([
      { Username: 'b-victory', Password: 'Donkey.683' },
      { Username: 'g-victory', Password: 'Kettle.221' },
    ]);
    expect(out).toEqual([
      { username: 'b-victory', password: 'Donkey.683', rowNum: 2 },
      { username: 'g-victory', password: 'Kettle.221', rowNum: 3 },
    ]);
  });

  it('lowercases the username and trims both fields', () => {
    const out = parsePasswordRows([{ Username: '  B-Victory ', Password: ' Donkey.683 ' }]);
    expect(out[0]).toMatchObject({ username: 'b-victory', password: 'Donkey.683' });
  });

  it('resolves headers whose case and spacing drifted', () => {
    const out = parsePasswordRows([{ 'user name': 'b-victory', PASSWORD: 'Donkey.683' }]);
    expect(out[0]).toMatchObject({ username: 'b-victory', password: 'Donkey.683' });
  });

  it('ignores the extra export columns and entirely blank rows', () => {
    const out = parsePasswordRows([
      { Username: 'b-victory', 'Church / Role': 'Victory', Gender: 'Boys', Role: 'Church', Password: 'Donkey.683' },
      { Username: '', 'Church / Role': '', Gender: '', Role: '', Password: '' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ username: 'b-victory', password: 'Donkey.683' });
  });

  it('keeps a row whose password is blank but whose username is not', () => {
    // Load-bearing: the planner must SEE this row to count it as skipped-blank.
    const out = parsePasswordRows([{ Username: 'b-victory', Password: '' }]);
    expect(out).toEqual([{ username: 'b-victory', password: '', rowNum: 2 }]);
  });
});

describe('planPasswordImport', () => {
  it('plans a password for each matched username', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'Donkey.683' },
        { Username: 'director', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply).toEqual([
      { userId: 'u1', username: 'b-victory', password: 'Donkey.683', inactive: false },
      { userId: 'u3', username: 'director', password: 'Kettle.221', inactive: false },
    ]);
    expect(plan.blank).toBe(0);
    expect(plan.unmatched).toEqual([]);
  });

  it('leaves every account absent from the file completely alone', () => {
    // "only a subset of churches" — the whole point.
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'b-victory', Password: 'Donkey.683' }]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['b-victory']);
  });

  it('SKIPS a blank password and never clears the existing one', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: '' },
        { Username: 'g-victory', Password: '   ' },
        { Username: 'director', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['director']);
    expect(plan.blank).toBe(2);
    expect(plan.unmatched).toEqual([]);
  });

  it('reports an unknown username instead of guessing', () => {
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'b-nowhere', Password: 'Donkey.683' }]),
      users,
      'admin1',
    );
    expect(plan.apply).toEqual([]);
    expect(plan.unmatched).toEqual(['b-nowhere']);
  });

  it('refuses the original admin and names it', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'admin', Password: 'Donkey.683' },
        { Username: 'b-victory', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['b-victory']);
    expect(plan.protectedSkipped).toEqual(['admin']);
  });

  it('APPLIES to an inactive account but flags it', () => {
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'oldchurch', Password: 'Donkey.683' }]),
      users,
      'admin1',
    );
    expect(plan.apply).toEqual([
      { userId: 'u4', username: 'oldchurch', password: 'Donkey.683', inactive: true },
    ]);
    expect(plan.inactive).toEqual(['oldchurch']);
  });

  it('rejects a too-short password and still applies every other row', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'ab1' },
        { Username: 'g-victory', Password: 'Kettle.221' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['g-victory']);
    expect(plan.invalid).toEqual([
      { username: 'b-victory', reason: `shorter than ${MIN_IMPORT_PASSWORD_LENGTH} characters` },
    ]);
  });

  it('rejects BOTH halves of a username listed twice with different passwords', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'Donkey.683' },
        { Username: 'B-Victory', Password: 'Kettle.221' },
        { Username: 'g-victory', Password: 'Saucer.404' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['g-victory']);
    expect(plan.duplicates).toEqual(['b-victory']);
  });

  it('accepts a username listed twice with the SAME password, applying it once', () => {
    const plan = planPasswordImport(
      parsePasswordRows([
        { Username: 'b-victory', Password: 'Donkey.683' },
        { Username: 'b-victory', Password: 'Donkey.683' },
      ]),
      users,
      'admin1',
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['b-victory']);
    expect(plan.duplicates).toEqual([]);
  });

  it('tolerates a null original admin id (no admin resolvable)', () => {
    const plan = planPasswordImport(
      parsePasswordRows([{ Username: 'admin', Password: 'Donkey.683' }]),
      users,
      null,
    );
    expect(plan.apply.map((a) => a.username)).toEqual(['admin']);
    expect(plan.protectedSkipped).toEqual([]);
  });

  it('exports the columns the importer requires', () => {
    expect(PASSWORD_IMPORT_COLUMNS).toEqual(['Username', 'Password']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/password-import.test.ts`
Expected: FAIL — `Failed to resolve import "./password-import"`.

- [ ] **Step 3: Write the implementation**

Create `src/services/password-import.ts`:

```ts
import type { User } from '../core/entities/user';
import { field, missingColumns } from './elvanto-mapping';

/**
 * Password upload — the exact reverse of `randomizeChurchPasswords`.
 *
 * The admin exports the credentials CSV, edits the Password column, and uploads it back;
 * every listed account gets that password. This module holds ALL of the decision-making and
 * is deliberately PURE — no repository, no hashing, no clock. Every resilience rule below is
 * therefore testable without fixtures, which matters because most of them are about the
 * failure paths (blank cells, unknown usernames, a partial list), and those are exactly the
 * cases nobody exercises by hand before camp.
 */

/**
 * The two columns the upload cannot work without. The credentials export writes
 * `Username, Church / Role, Gender, Role, Password` — the middle three are informational and
 * are ignored here, so a hand-built two-column sheet is equally valid.
 */
export const PASSWORD_IMPORT_COLUMNS = ['Username', 'Password'] as const;

/** Matches `SetPasswordSchema`'s `z.string().min(6)`. Keep the two in step. */
export const MIN_IMPORT_PASSWORD_LENGTH = 6;

export interface ParsedPasswordRow {
  /** Lowercased — usernames are stored lowercased and compared case-insensitively. */
  username: string;
  /** Trimmed. May be `''`, which means "leave this account alone" (never "clear it"). */
  password: string;
  /** 1-based line number in the uploaded file, header included, for error messages. */
  rowNum: number;
}

export interface PasswordImportApply {
  userId: string;
  username: string;
  password: string;
  /** True when the account is deactivated — applied, but reported so it is not a surprise. */
  inactive: boolean;
}

export interface PasswordImportPlan {
  /** ⚠ Carries PLAINTEXT passwords. Never serialise this to a client. */
  apply: PasswordImportApply[];
  /** Rows with a username but an empty password — skipped, existing password untouched. */
  blank: number;
  unmatched: string[];
  protectedSkipped: string[];
  invalid: { username: string; reason: string }[];
  duplicates: string[];
  inactive: string[];
}

/**
 * Which of the required columns are absent from the uploaded file.
 *
 * ⚠️ THIS IS WHY IT EXISTS: `field()` returns `''` both for a column that is empty and for one
 * it cannot find. Without this check, a file with a renamed or missing Password column parses
 * as "every row blank" and the import reports a clean, successful, entirely-empty run — the
 * same silent-success shape as the 2026-08-04 snapshot wipe and the renamed care column.
 */
export function missingPasswordColumns(rows: Record<string, string>[]): string[] {
  return missingColumns(rows[0], PASSWORD_IMPORT_COLUMNS);
}

/**
 * CSV rows → `{username, password, rowNum}`.
 *
 * A row with no username at all is dropped (trailing spreadsheet padding). A row WITH a
 * username but no password is KEPT, because the planner has to count it as a deliberate skip
 * rather than silently losing it.
 */
export function parsePasswordRows(rows: Record<string, string>[]): ParsedPasswordRow[] {
  const out: ParsedPasswordRow[] = [];
  rows.forEach((row, i) => {
    const username = field(row, 'Username', 'User name', 'Login').toLowerCase();
    if (!username) return;
    out.push({ username, password: field(row, 'Password'), rowNum: i + 2 });
  });
  return out;
}

/**
 * Decide what the upload will do, without doing any of it.
 *
 * Rules, in order of application per row:
 *  1. blank password        → skipped, counted (NEVER clears a password)
 *  2. username unknown      → reported by name, nothing set (never resolved by church/gender)
 *  3. username is the original admin → refused; it is the recovery account
 *  4. password too short    → that row rejected, every other row still applies
 *  5. same username twice with DIFFERENT passwords → both rejected (we cannot know which was
 *     meant, and picking one would set a password the admin cannot predict). An identical
 *     duplicate is applied once — that is a copy-paste, not a contradiction.
 *
 * Accounts absent from the file are simply never in `apply`, which is what makes a partial
 * list — one church, a handful of leaders — safe by construction.
 */
export function planPasswordImport(
  parsed: ParsedPasswordRow[],
  users: User[],
  originalAdminId: string | null,
): PasswordImportPlan {
  const byUsername = new Map<string, User>();
  for (const u of users) byUsername.set(u.username.toLowerCase(), u);

  // Pass 1 — find usernames that appear more than once with conflicting passwords.
  const seen = new Map<string, Set<string>>();
  for (const r of parsed) {
    if (!r.password) continue;
    const set = seen.get(r.username) ?? new Set<string>();
    set.add(r.password);
    seen.set(r.username, set);
  }
  const conflicting = new Set<string>();
  for (const [username, passwords] of seen) {
    if (passwords.size > 1) conflicting.add(username);
  }

  const plan: PasswordImportPlan = {
    apply: [],
    blank: 0,
    unmatched: [],
    protectedSkipped: [],
    invalid: [],
    duplicates: [],
    inactive: [],
  };
  const applied = new Set<string>();
  const reported = new Set<string>();
  const once = (list: string[], username: string) => {
    if (reported.has(username)) return;
    reported.add(username);
    list.push(username);
  };

  for (const r of parsed) {
    if (!r.password) {
      plan.blank++;
      continue;
    }
    if (conflicting.has(r.username)) {
      once(plan.duplicates, r.username);
      continue;
    }
    const user = byUsername.get(r.username);
    if (!user) {
      once(plan.unmatched, r.username);
      continue;
    }
    if (originalAdminId && user.id === originalAdminId) {
      once(plan.protectedSkipped, r.username);
      continue;
    }
    if (r.password.length < MIN_IMPORT_PASSWORD_LENGTH) {
      if (!reported.has(r.username)) {
        reported.add(r.username);
        plan.invalid.push({
          username: r.username,
          reason: `shorter than ${MIN_IMPORT_PASSWORD_LENGTH} characters`,
        });
      }
      continue;
    }
    if (applied.has(r.username)) continue; // identical duplicate — apply once
    applied.add(r.username);
    const inactive = user.status !== 'active';
    plan.apply.push({ userId: user.id, username: r.username, password: r.password, inactive });
    if (inactive) plan.inactive.push(r.username);
  }

  return plan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/password-import.test.ts`
Expected: PASS, 16 tests.

Then run `npm run typecheck` — expected: clean, no output.

- [ ] **Step 5: Commit**

```bash
git add src/services/password-import.ts src/services/password-import.test.ts
git commit -m "Password upload: the pure planner and its resilience rules"
```

---

### Task 2: Service method, schema, controller, route

**Files:**
- Modify: `src/core/validation/account.schema.ts` (append after `ChangeOwnPasswordSchema`, ~line 55)
- Modify: `src/services/account.service.ts` (add to the `AccountService` interface near `randomizeChurchPasswords` at ~line 105, and the implementation after `randomizeChurchPasswords` ends at ~line 453)
- Modify: `src/api/controllers/account.controller.ts` (add beside `randomizeChurchPasswords`, ~line 64)
- Modify: `src/api/http/router.ts` (add after the `/accounts/churches/randomize-passwords` line, ~line 226)
- Test: `src/services/account.service.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `parsePasswordRows`, `planPasswordImport`, `missingPasswordColumns` from `./password-import` (Task 1); `parseCsv` from `../utils/csv`; `hashPassword` from `../utils/crypto`; `findOriginalAdmin` (already exported from `account.service.ts:134`).
- Produces: `POST /accounts/passwords/import` with body `{csvData: string, dryRun?: boolean}` returning `PasswordImportResult` — the SPA (Task 3) is built against exactly this shape.

- [ ] **Step 1: Write the failing test**

Append to `src/services/account.service.test.ts` (match the existing file's import style and its helper for building a service — read the top of that file first and reuse whatever repo/fixture helper the existing `randomizeChurchPasswords` tests use rather than inventing a second one):

```ts
describe('importPasswords', () => {
  const csv = (body: string) => `Username,Church / Role,Gender,Role,Password\n${body}`;

  it('sets the password on every listed account and reports the count', async () => {
    const { service, admin, userRepo } = await setup(); // reuse the file's existing helper
    const target = await userRepo.findByUsername('b-victory');
    const res = await service.importPasswords(admin, {
      csvData: csv('b-victory,Victory,Boys,Church,Donkey.683\n'),
    });
    expect(res.dryRun).toBe(false);
    expect(res.applied).toBe(1);
    const after = await userRepo.findById(target!.id);
    expect(after!.passwordHash).not.toBe(target!.passwordHash);
    expect(after!.mustChangePassword).toBe(false);
  });

  it('a dry run changes NOTHING but reports what would happen', async () => {
    const { service, admin, userRepo } = await setup();
    const before = await userRepo.findByUsername('b-victory');
    const res = await service.importPasswords(admin, {
      csvData: csv('b-victory,Victory,Boys,Church,Donkey.683\nb-nowhere,?,?,?,Kettle.221\n'),
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.willSet).toBe(1);
    expect(res.applied).toBe(0);
    expect(res.unmatched).toEqual(['b-nowhere']);
    const after = await userRepo.findByUsername('b-victory');
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('NEVER returns a plaintext password in the response', async () => {
    const { service, admin } = await setup();
    const res = await service.importPasswords(admin, {
      csvData: csv('b-victory,Victory,Boys,Church,Donkey.683\n'),
    });
    expect(JSON.stringify(res)).not.toContain('Donkey.683');
  });

  it('rejects a file missing the Password column instead of reporting an empty success', async () => {
    const { service, admin } = await setup();
    await expect(
      service.importPasswords(admin, { csvData: 'Username,Church / Role\nb-victory,Victory\n' }),
    ).rejects.toThrow(/Password/);
  });

  it('rejects a file with no data rows', async () => {
    const { service, admin } = await setup();
    await expect(
      service.importPasswords(admin, { csvData: 'Username,Password\n' }),
    ).rejects.toThrow(/no rows/i);
  });

  it('requires admin:manage', async () => {
    const { service, churchActor } = await setup();
    await expect(
      service.importPasswords(churchActor, { csvData: csv('b-victory,V,Boys,Church,Donkey.683\n') }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/account.service.test.ts -t importPasswords`
Expected: FAIL — `service.importPasswords is not a function`.

- [ ] **Step 3: Write the implementation**

**3a.** In `src/core/validation/account.schema.ts`, after `ChangeOwnPasswordSchema`'s type export:

```ts
export const ImportPasswordsSchema = z.object({
  csvData: z.string().min(1),
  /** True = report what WOULD happen and write nothing. */
  dryRun: z.boolean().optional().default(false),
});

export type ImportPasswordsInput = z.infer<typeof ImportPasswordsSchema>;
```

**3b.** In `src/services/account.service.ts`, add to the imports:

```ts
import { parseCsv } from '../utils/csv';
import {
  parsePasswordRows,
  planPasswordImport,
  missingPasswordColumns,
  PASSWORD_IMPORT_COLUMNS,
} from './password-import';
```

and add `ImportPasswordsSchema` to the existing `../core/validation/account.schema` import list.

Add the result type near `ChurchCredential` (~line 43):

```ts
/**
 * The upload's report. Counts and usernames ONLY — ⚠ a plaintext password must never travel
 * back to the client. The request already carried them; echoing them into a response that a
 * browser will cache and log serves no purpose and widens the exposure for free.
 */
export interface PasswordImportResult {
  dryRun: boolean;
  /** Rows that will be (dry run) or were (real run) applied. */
  willSet: number;
  /** 0 on a dry run. */
  applied: number;
  blank: number;
  unmatched: string[];
  protectedSkipped: string[];
  invalid: { username: string; reason: string }[];
  duplicates: string[];
  inactive: string[];
}
```

Add to the `AccountService` interface, immediately after `randomizeChurchPasswords`:

```ts
  /** Set passwords from an uploaded credentials sheet — the reverse of the export above. */
  importPasswords(actor: Actor, input: unknown): Promise<PasswordImportResult>;
```

Add the implementation immediately after the `randomizeChurchPasswords` method's closing `},`:

```ts
    /**
     * The reverse of `randomizeChurchPasswords`: take the exported credentials sheet with the
     * Password column filled in, and set those passwords.
     *
     * Every decision lives in the pure planner (`password-import.ts`); this method only does
     * the three things a pure function cannot — read the users, hash, and save. `dryRun` runs
     * the identical code path and stops before the writes, so the preview cannot disagree with
     * what the confirm then does.
     *
     * ⚠ `mustChangePassword: false`, matching the randomise path. These ARE the real passwords
     * the admin has chosen and is handing out, not admin-set temporaries.
     */
    async importPasswords(actor, input) {
      assertCan(actor, 'admin:manage');
      const data = ImportPasswordsSchema.parse(input);
      const rows = parseCsv(data.csvData);
      if (rows.length === 0) throw new BadRequestError('That file has no rows.');

      // A renamed/absent column must be said out loud — see `missingPasswordColumns`.
      const missing = missingPasswordColumns(rows);
      if (missing.length > 0) {
        const found = Object.keys(rows[0] ?? {}).join(', ');
        throw new BadRequestError(
          `That file is missing the ${missing.join(' and ')} column${missing.length > 1 ? 's' : ''}. ` +
            `It needs ${PASSWORD_IMPORT_COLUMNS.join(' and ')}. Columns found: ${found}`,
        );
      }

      const users = await userRepo.findAll();
      const original = findOriginalAdmin(users);
      const plan = planPasswordImport(parsePasswordRows(rows), users, original?.id ?? null);

      let applied = 0;
      if (!data.dryRun) {
        for (const item of plan.apply) {
          const user = users.find((u) => u.id === item.userId);
          if (!user) continue; // read and write are one request apart; skip rather than throw
          await userRepo.save({
            ...user,
            passwordHash: await hashPassword(item.password),
            mustChangePassword: false,
            updatedAt: nowISO(),
          });
          applied++;
        }
        if (applied > 0) invalidateDashboardCache();
      }

      return {
        dryRun: data.dryRun,
        willSet: plan.apply.length,
        applied,
        blank: plan.blank,
        unmatched: plan.unmatched,
        protectedSkipped: plan.protectedSkipped,
        invalid: plan.invalid,
        duplicates: plan.duplicates,
        inactive: plan.inactive,
      };
    },
```

**3c.** In `src/api/controllers/account.controller.ts`, after the `randomizeChurchPasswords` method:

```ts
    async importPasswords(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.importPasswords(req.ctx.actor, req.body);
    },
```

**3d.** In `src/api/http/router.ts`, immediately after the `randomize-passwords` route:

```ts
    { method: 'POST', path: '/accounts/passwords/import', auth: true, handler: (r) => account.importPasswords(r) },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/account.service.test.ts`
Expected: PASS including the 6 new `importPasswords` tests.

Run: `npm run typecheck` — expected: clean.

Run: `npx vitest run` — expected: **972 pass / 60 files** (950 baseline + 16 from Task 1 + 6 here). If the total differs, reconcile before committing; do not adjust the number in a doc to match a wrong run.

- [ ] **Step 5: Commit**

```bash
git add src/core/validation/account.schema.ts src/services/account.service.ts src/services/account.service.test.ts src/api/controllers/account.controller.ts src/api/http/router.ts
git commit -m "Password upload: POST /accounts/passwords/import with a dry-run preview"
```

---

### Task 3: The SPA button, preview and confirm

**Files:**
- Modify: `public/index.html` — the "All login passwords" card in `RENDER.adminAccounts` (~line 6392-6395), and the JS block after `randomizeChurchPasswords()` (~line 6546)
- Modify: `public/sw.js` line 1

**Interfaces:**
- Consumes: `POST /accounts/passwords/import` `{csvData, dryRun}` → `{dryRun, willSet, applied, blank, unmatched[], protectedSkipped[], invalid[{username,reason}], duplicates[], inactive[]}` (Task 2). Existing SPA helpers: `_readImportFile(file)`, `api()`, `confirmSheet()`, `toast()`, `esc()`, `icSm()`, `_rAccts()`.
- Produces: nothing consumed by another task.

- [ ] **Step 1: Replace the card markup**

In `RENDER.adminAccounts`, replace the single-button line (currently
`<button class="btn ghost" onclick="randomizeChurchPasswords()" style="width:100%">${icSm('key')} Randomise &amp; export passwords</button></div>`)
with:

```js
      <div style="display:flex;gap:8px;align-items:stretch">
        <button class="btn ghost" onclick="randomizeChurchPasswords()" style="flex:1;min-width:0;margin-top:0">${icSm('key')} Randomise &amp; export passwords</button>
        <button class="btn ghost sm" onclick="document.getElementById('pwUpIn').click()" style="flex:0 0 auto;width:auto;margin-top:0;min-width:92px">${icSm('upload')} Upload</button>
        <input type="file" id="pwUpIn" accept=".csv,.xlsx,.xls" style="display:none" onchange="uploadPasswords()">
      </div>
      <p class="note-hint" style="margin:8px 0 0">Upload takes this same CSV back with the Password column filled in and sets those passwords. Accounts you leave out are untouched, and a blank password never changes anything.</p>
      <div id="pwUpResult" style="display:none;margin-top:10px"></div></div>
```

⚠️ **The `flex:0 0 auto;width:auto` on the Upload button is load-bearing, not styling taste.** `.btn`'s base CSS is `display:block;width:100%`, and inside a flex row that `width:100%` becomes the flex-basis — the button then claims most of the row and squeezes its sibling to nothing. That exact bug has now been fixed three separate times in this file (2026-07-08, 2026-08-02). `.btn.sm` sets `width:auto`, which is why the class is on there too.

- [ ] **Step 2: Add the upload functions**

Insert immediately after the closing `}` of `randomizeChurchPasswords()`:

```js
/* ===== PASSWORD UPLOAD — the reverse of "Randomise & export passwords" =====
   Takes the exported CSV back with the Password column edited (or an .xlsx) and sets those
   passwords. Runs the server's DRY RUN first and shows what it would do, because the two
   mistakes this feature invites are silent: a mistyped username sets nothing at all, and the
   wrong file entirely matches nothing at all. Both look identical to success without a preview.

   File reading goes through _readImportFile, so .xlsx works for free via the lazy SheetJS
   path — the same helper the Form/Ticket/Invoice and Offline Sign-In uploads use. */
let _pwUpCsv=null;
async function uploadPasswords(){
  const input=document.getElementById('pwUpIn');
  const file=input&&input.files&&input.files[0];
  if(!file)return;
  const box=document.getElementById('pwUpResult');
  if(box){box.style.display='block';box.innerHTML='<div class="loading"><div class="spin"></div><div class="lt">Reading sheet…</div></div>';}
  try{
    const rd=await _readImportFile(file);
    _pwUpCsv=rd.text;
    const r=await api('/accounts/passwords/import',{method:'POST',body:{csvData:_pwUpCsv,dryRun:true}});
    if(box)box.innerHTML=_pwUpPreview(r,file.name);
  }catch(e){
    _pwUpCsv=null;
    if(box)box.innerHTML='<p class="err" style="display:block">'+esc(e.message||'Could not read that file')+'</p>';
    else toast(e.message||'Could not read that file');
  }finally{ input.value=''; }
}
// Shared renderer for the dry-run preview and the applied result. Every skipped row is NAMED,
// not just counted — "3 not matched" sends an admin back to a 30-row spreadsheet with no idea
// which three, which is how a genuinely wrong file gets confirmed anyway.
function _pwUpNote(icon,label,names){
  if(!names||!names.length)return '';
  return `<p class="note-hint" style="text-align:left;margin:6px 0 0">${icSm(icon)} <b>${names.length}</b> ${label}: ${names.map(esc).join(', ')}</p>`;
}
function _pwUpPreview(r,fileName){
  const bits=[];
  if(r.blank)bits.push(`${r.blank} blank password${r.blank===1?'':'s'} skipped`);
  const head=r.willSet
    ? `<div class="callbox">${icSm('check')} <b>${r.willSet}</b> password${r.willSet===1?'':'s'} will be set from <b>${esc(fileName)}</b>.${bits.length?' '+esc(bits.join(' · '))+'.':''}</div>`
    // Nothing matched = almost always the wrong file. Say that, rather than showing a Confirm
    // button that would do nothing and report success.
    : `<div class="warnbox">${icSm('alert')} Nothing in <b>${esc(fileName)}</b> matches an account, so there is nothing to set. Check it is the passwords export, with usernames in the <b>Username</b> column.</div>`;
  const detail=_pwUpNote('alert','not matched to any account',r.unmatched)
    +_pwUpNote('alert','rejected as too short',(r.invalid||[]).map(i=>i.username))
    +_pwUpNote('alert','listed twice with different passwords, so left alone',r.duplicates)
    +_pwUpNote('alert','skipped — the original admin is never changed this way',r.protectedSkipped)
    +_pwUpNote('alert','set, but the account is deactivated and still cannot log in',r.inactive);
  const confirm=r.willSet
    ? `<button class="btn" onclick="_pwUpConfirm()" style="margin-top:10px;width:100%">Set ${r.willSet} password${r.willSet===1?'':'s'}</button>`
    : '';
  return head+detail+confirm;
}
async function _pwUpConfirm(){
  if(!_pwUpCsv){toast('Choose the file again');return;}
  if(!await confirmSheet({title:'Set these passwords?',body:'Each listed account’s current password stops working immediately. Accounts not in the file are unchanged.',confirmLabel:'Set passwords',danger:true}))return;
  const box=document.getElementById('pwUpResult');
  if(box)box.innerHTML='<div class="loading"><div class="spin"></div><div class="lt">Setting passwords…</div></div>';
  try{
    const r=await api('/accounts/passwords/import',{method:'POST',body:{csvData:_pwUpCsv,dryRun:false}});
    _pwUpCsv=null;
    const detail=_pwUpNote('alert','not matched to any account',r.unmatched)
      +_pwUpNote('alert','rejected as too short',(r.invalid||[]).map(i=>i.username))
      +_pwUpNote('alert','listed twice with different passwords, so left alone',r.duplicates)
      +_pwUpNote('alert','skipped — the original admin is never changed this way',r.protectedSkipped)
      +_pwUpNote('alert','set, but the account is deactivated and still cannot log in',r.inactive);
    if(box)box.innerHTML=`<div class="callbox">${icSm('check')} <b>${r.applied}</b> password${r.applied===1?'':'s'} set.</div>`+detail;
    toast('Passwords set ('+r.applied+')');
    try{await _rAccts();}catch(_){/* UI refresh only — the passwords are already set */}
  }catch(e){
    if(box)box.innerHTML='<p class="err" style="display:block">'+esc(e.message||'Could not set passwords')+'</p>';
    else toast(e.message||'Could not set passwords');
  }
}
```

- [ ] **Step 3: Verify the icon keys exist**

Run: `grep -o "upload:\|check:\|alert:\|key:" public/index.html | sort -u`
Expected: all four appear. A key missing from `ICONS` renders a blank SVG (a documented recurring bug in this file). If `upload` or `check` is absent, use `key` and `alert` instead — do not add a new glyph for this.

- [ ] **Step 4: Syntax-check the SPA and bump the service worker**

Derive the script body range and check it (the naive `<script>…</script>` regex fails — the file contains a literal `</script>` inside a string):

```bash
S=$(grep -n '^<script>$' public/index.html | head -1 | cut -d: -f1)
E=$(grep -n '^</script>$' public/index.html | tail -1 | cut -d: -f1)
sed -n "$((S+1)),$((E-1))p" public/index.html > /tmp/spa-body.js
node --check /tmp/spa-body.js && echo "SPA OK (range $S-$E)"
node --check public/sw.js && echo "sw OK"
```

Expected: both OK. Record the range — it goes in the CLAUDE.md entry.

Then in `public/sw.js` line 1, change `const CACHE = 'camp-v90';` to `const CACHE = 'camp-v91';`. **This is mandatory whenever `public/index.html` changes** — iOS standalone PWAs are documented as lazy about picking up a new worker.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "Password upload: Upload button, dry-run preview and confirm on Accounts & churches"
```

---

### Task 4: Documentation (done by the orchestrating session, not a subagent)

**Files:**
- Modify: `CLAUDE.md` (new dated section at the top)
- Modify: `debug.md` (symptom-router entry)

- [ ] **Step 1:** Add a `## Password upload — the reverse of the credentials export — 2026-08-05` section at the very top of `CLAUDE.md`, recording: the new `src/services/password-import.ts` and why it is pure; the `POST /accounts/passwords/import` route + `admin:manage`; the four owner decisions (dry-run preview, `mustChangePassword:false`, original admin protected, **inactive accounts deliberately NOT protected** and why that differs from `randomizeChurchPasswords`); the missing-column hard failure and its link to the `CARE_COLUMNS` lesson; that no plaintext password is in the response; the verified test count; the re-derived `node --check` range; and `sw.js` `camp-v90`→`camp-v91`.
- [ ] **Step 2:** Add to `debug.md`'s symptom router: "Uploaded passwords didn't apply / wrong account changed" → `planPasswordImport` (pure, `password-import.ts`) first, then `account.service.importPasswords`; "Upload button squashes the Randomise button" → the flex rule in the card markup; "Preview says nothing matched" → the file's `Username` column.
- [ ] **Step 3:** Commit both.
