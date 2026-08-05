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
 * CSV rows → `{username, password}`.
 *
 * A row with no username at all is dropped (trailing spreadsheet padding). A row WITH a
 * username but no password is KEPT, because the planner has to count it as a deliberate skip
 * rather than silently losing it.
 */
export function parsePasswordRows(rows: Record<string, string>[]): ParsedPasswordRow[] {
  const out: ParsedPasswordRow[] = [];
  for (const row of rows) {
    // ⚠️ EXACTLY the aliases `missingPasswordColumns` accepts — one name, matched through
    // `field()`'s normalisation, which already resolves `User name` / `USERNAME` / `user_name`.
    // An extra alias here that the column guard does not know (this had `'Login'`, found in
    // review) makes the two disagree: the parser would read the file happily while the guard
    // rejected it up front for a missing `Username` column. Add an alias to BOTH or NEITHER.
    const username = field(row, 'Username').toLowerCase();
    if (!username) continue;
    out.push({ username, password: field(row, 'Password') });
  }
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
