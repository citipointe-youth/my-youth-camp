import type {
  IUserRepository,
  IChurchRepository,
  IPersonRepository,
} from '../repositories/interfaces/entity-repositories';
import type { User, SafeUser, GenderScope } from '../core/entities/user';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';
import { assertCan, canAccessChurch } from './access-control';
import { NotFoundError, BadRequestError, ForbiddenError, UnauthorizedError } from '../core/errors/app-error';
import {
  CreateUserSchema,
  UpdateUserSchema,
  SetPasswordSchema,
  ChangeOwnPasswordSchema,
  CreateChurchWithAccountSchema,
  UpdateChurchSchema,
  UpdateChurchContactsSchema,
  ImportPasswordsSchema,
} from '../core/validation/account.schema';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { toSafeUser } from './auth.service';
import { invalidateDashboardCache } from './dashboard-cache';
import { memorablePassword } from '../utils/memorable-password';
import type { UserRole } from '../core/types/enums';
import { parseCsv } from '../utils/csv';
import {
  parsePasswordRows,
  planPasswordImport,
  missingPasswordColumns,
  PASSWORD_IMPORT_COLUMNS,
} from './password-import';

/**
 * Human-readable role names for the credentials export (2026-08-03).
 *
 * A leadership account has no church to print in the CSV's Church column, so its role goes
 * there instead — `first-aid` in a spreadsheet cell is not a useful label for the person
 * handing these out.
 */
const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  admin: 'Admin',
  director: 'Director',
  zoneLeader: 'Zone leader',
  firstAid: 'First aid',
};

/** A church login credential row for the Feature 6 password export. */
export interface ChurchCredential {
  username: string;
  church: string;
  /**
   * Null for a leadership account (2026-08-03). Only church logins are gender-scoped; a
   * director/zoneLeader/firstAid/admin account has no gender half, and reporting one would
   * be inventing a distinction that does not exist.
   */
  gender: GenderScope | null;
  password: string;
  /**
   * The account's role (2026-08-03). Added when the rotation was widened beyond church
   * logins — with leadership accounts in the same CSV, "which of these is the director?" is
   * otherwise unanswerable from the username alone.
   */
  role?: UserRole;
}

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

/** Turn a church name into a stable, username-safe slug base ('Victory Church' → 'victory-church'). */
function slugifyUsername(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return s || 'church';
}

/** `b-<slug>` for male, `g-<slug>` for female. */
function genderUsername(base: string, gender: GenderScope): string {
  return `${gender === 'male' ? 'b' : 'g'}-${base}`;
}

export interface AccountService {
  listUsers(actor: Actor): Promise<SafeUser[]>;
  createUser(actor: Actor, input: unknown): Promise<SafeUser>;
  updateUser(actor: Actor, id: string, input: unknown): Promise<SafeUser>;
  setPassword(actor: Actor, input: unknown): Promise<void>;
  /** Self-service — proving the current password is what clears mustChangePassword. */
  changeOwnPassword(actor: Actor, input: unknown): Promise<void>;
  /** Flip an account between active/inactive (CMS parity). The admin can't be deactivated. */
  toggleStatus(actor: Actor, id: string): Promise<SafeUser>;
  /**
   * Create a church PLUS its two gender-scoped logins (Feature 2): `b-<slug>` (male) and
   * `g-<slug>` (female). Each account gets an auto-generated memorable password (Feature 6),
   * returned in `credentials` so the admin can hand them out.
   */
  createChurchWithAccount(
    actor: Actor,
    input: unknown,
  ): Promise<{ church: Church; users: SafeUser[]; credentials: ChurchCredential[] }>;
  /**
   * Idempotent one-off (Feature 2): ensure every existing church has both gender-scoped logins,
   * creating any that are missing (with a memorable password), and retire the legacy combined
   * church login. Safe to re-run — existing gender accounts are left untouched.
   */
  splitChurchAccounts(actor: Actor): Promise<{ created: ChurchCredential[]; retired: number; churches: number }>;
  /**
   * Feature 6: re-randomise EVERY church login's password (creating any missing gender account
   * and retiring legacy combined logins first) and return the full list for CSV export. Does NOT
   * set mustChangePassword — these are the churches' real passwords.
   */
  randomizeChurchPasswords(actor: Actor): Promise<ChurchCredential[]>;
  /**
   * 2026-08-05 owner request: rotate CHURCH logins ONLY, leaving every leadership password
   * (director / zoneLeader / firstAid / secondary admins) untouched. For re-issuing church
   * passwords after the Saturday handout without invalidating leadership logins. Shares every
   * invariant of the church branch of `randomizeChurchPasswords` — see `rotateChurchLogins`.
   */
  randomizeChurchOnlyPasswords(actor: Actor): Promise<ChurchCredential[]>;
  /** Set passwords from an uploaded credentials sheet — the reverse of the export above. */
  importPasswords(actor: Actor, input: unknown): Promise<PasswordImportResult>;
  listChurches(actor: Actor): Promise<Church[]>;
  updateChurch(actor: Actor, id: string, input: unknown): Promise<Church>;
  /**
   * Set a church's four ministry leader contacts. Reachable by the CHURCH ITSELF (2026-07-31)
   * as well as director/admin — see `church:contacts:write`. A church may only edit its own.
   */
  updateChurchContacts(actor: Actor, id: string, input: unknown): Promise<Church>;
  deleteUser(actor: Actor, id: string): Promise<{ deleted: string }>;
  deleteChurch(actor: Actor, id: string): Promise<{ deleted: string }>;
  /** Admin-only: validate a target account for read-only preview; returns its SafeUser. */
  previewAccount(actor: Actor, id: string): Promise<SafeUser>;
}

/**
 * The ORIGINAL admin — the account the platform was bootstrapped with (2026-07-31).
 *
 * Since additional admins can now be created, "is this the admin?" is no longer the same
 * question as "is this role === 'admin'?". The original is defined as the **earliest-created**
 * admin, with the id as a deterministic tiebreak for the (practically impossible) case of two
 * admins sharing a `createdAt` to the millisecond. Deliberately NOT hard-coded to the seed id
 * `user_seed_admin`: a new-year rollover and a fresh deployment both produce a working camp
 * whose first admin may have a different id, and a hard-coded constant would leave those
 * installations with no protected account at all.
 *
 * The original cannot be deleted, deactivated, or demoted — by anyone, INCLUDING ITSELF. That
 * last part is the point: it is the recovery account, and an admin who demotes themselves by
 * mistake would leave the camp with no way back in.
 */
export function findOriginalAdmin(users: User[]): User | null {
  const admins = users.filter((u) => u.role === 'admin');
  if (admins.length === 0) return null;
  return admins.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )[0]!;
}

export function makeAccountService(
  userRepo: IUserRepository,
  churchRepo: IChurchRepository,
  personRepo: IPersonRepository,
): AccountService {
  // ----- Feature 2/6 helpers (gender-scoped church logins) -------------------------------

  /** Ensure a username is globally unique, appending -2/-3… on collision with a different user. */
  async function uniqueUsername(desired: string, allUsers: User[]): Promise<string> {
    const taken = new Set(allUsers.map((u) => u.username.toLowerCase()));
    if (!taken.has(desired.toLowerCase())) return desired;
    for (let n = 2; n < 100; n++) {
      const candidate = `${desired}-${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${desired}-${newId('u').slice(-4)}`;
  }

  /** Create one gender-scoped church login with a fresh memorable password. */
  async function createGenderAccount(
    church: Church,
    gender: GenderScope,
    slugBase: string,
    allUsers: User[],
  ): Promise<{ user: User; credential: ChurchCredential }> {
    const now = nowISO();
    const username = await uniqueUsername(genderUsername(slugBase, gender), allUsers);
    const password = memorablePassword();
    const user: User = {
      id: newId('user'),
      firstName: church.name,
      lastName: gender === 'male' ? 'Boys' : 'Girls',
      username,
      role: 'church',
      churchId: church.id,
      churchName: church.name,
      zone: church.zone,
      genderScope: gender,
      status: 'active',
      passwordHash: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    };
    await userRepo.save(user);
    allUsers.push(user);
    return { user, credential: { username, church: church.name, gender, password } };
  }

  /** Delete any legacy combined (non-gender-scoped) church login for a church. Returns count removed. */
  async function retireLegacyChurchLogins(churchId: string, allUsers: User[]): Promise<number> {
    let removed = 0;
    for (const u of allUsers) {
      if (u.role === 'church' && u.churchId === churchId && (u.genderScope === null || u.genderScope === undefined)) {
        await userRepo.delete(u.id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * THE SHARED CHURCH-LOGIN ROTATION LOOP — 2026-08-05.
   *
   * Extracted so `randomizeChurchPasswords` (church + leadership) and
   * `randomizeChurchOnlyPasswords` (church only) call ONE implementation of "rotate every
   * church login". Two copies of this loop is exactly the class of bug this codebase keeps
   * recording — a copy that drifts is how the wrong accounts get rotated. Preserves every
   * existing invariant: creates the gender account if missing, retires legacy combined logins,
   * does NOT set `mustChangePassword` (these are the real handed-out passwords).
   */
  async function rotateChurchLogins(): Promise<ChurchCredential[]> {
    const churches = await churchRepo.findAll();
    const allUsers = await userRepo.findAll();
    const rows: ChurchCredential[] = [];

    for (const church of churches) {
      const slugBase = slugifyUsername(church.name);
      for (const gender of ['male', 'female'] as const) {
        const existing = allUsers.find(
          (u) => u.role === 'church' && u.churchId === church.id && u.genderScope === gender,
        );
        if (existing) {
          // Reset to a fresh memorable password. Do NOT set mustChangePassword — this IS the
          // church's real password.
          const password = memorablePassword();
          await userRepo.save({
            ...existing,
            passwordHash: await hashPassword(password),
            mustChangePassword: false,
            updatedAt: nowISO(),
          });
          rows.push({ username: existing.username, church: church.name, gender, password });
        } else {
          const { credential } = await createGenderAccount(church, gender, slugBase, allUsers);
          rows.push(credential);
        }
      }
      await retireLegacyChurchLogins(church.id, allUsers);
    }

    return rows;
  }

  return {
    async listUsers(actor) {
      assertCan(actor, 'admin:manage');
      const users = await userRepo.findAll();
      return users.map(toSafeUser);
    },

    async createUser(actor, input) {
      assertCan(actor, 'admin:manage');
      const data = CreateUserSchema.parse(input);
      // 2026-07-31: creating additional admins IS allowed now (owner request). A secondary
      // admin is a full peer — it can do everything, including creating further admins. The
      // only thing it can never do is remove, deactivate or demote the ORIGINAL admin, which
      // is enforced in updateUser/toggleStatus/deleteUser below rather than here.
      const existing = await userRepo.findByUsername(data.username);
      if (existing) throw new BadRequestError('Username already in use');
      const passwordHash = await hashPassword(data.password);
      const now = nowISO();
      const user: User = {
        id: newId('user'),
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username.toLowerCase(),
        mobile: data.mobile,
        role: data.role,
        churchId: data.churchId ?? null,
        churchName: data.churchName ?? null,
        zone: data.zone ?? null,
        genderScope: data.genderScope ?? null,
        status: data.status ?? 'active',
        passwordHash,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await userRepo.save(user);
      return toSafeUser(saved);
    },

    async updateUser(actor, id, input) {
      assertCan(actor, 'admin:manage');
      const existing = await userRepo.findById(id);
      if (!existing) throw new NotFoundError('User not found');
      const data = UpdateUserSchema.parse(input);
      // Promotion to admin is allowed (2026-07-31). Demotion of the ORIGINAL admin is not:
      // it is the recovery account, and losing it locks everyone out of the back office.
      if (existing.role === 'admin' && data.role && data.role !== 'admin') {
        const original = findOriginalAdmin(await userRepo.findAll());
        if (original?.id === existing.id) {
          throw new ForbiddenError('The original admin account cannot be changed to another role');
        }
      }
      // Enforce username uniqueness when it changes.
      if (data.username && data.username.toLowerCase() !== existing.username.toLowerCase()) {
        const clash = await userRepo.findByUsername(data.username);
        if (clash && clash.id !== existing.id) throw new BadRequestError('Username already in use');
      }
      const updated: User = {
        ...existing,
        ...data,
        id: existing.id,
        username: data.username ? data.username.toLowerCase() : existing.username,
        updatedAt: nowISO(),
      };
      const saved = await userRepo.save(updated);
      return toSafeUser(saved);
    },

    async setPassword(actor, input) {
      assertCan(actor, 'admin:manage');
      const data = SetPasswordSchema.parse(input);
      const user = await userRepo.findById(data.userId);
      if (!user) throw new NotFoundError('User not found');
      const passwordHash = await hashPassword(data.password);
      // An admin-chosen password is never trusted as the account holder's own — flag it so
      // the holder must set their own password before anything else is reachable (closes the
      // gap where a reused/guessable/documented default password grants a same-day login).
      await userRepo.save({ ...user, passwordHash, mustChangePassword: true, updatedAt: nowISO() });
    },

    async changeOwnPassword(actor, input) {
      const data = ChangeOwnPasswordSchema.parse(input);
      const user = await userRepo.findById(actor.id);
      if (!user || !user.passwordHash) throw new UnauthorizedError('Invalid credentials');
      const valid = await verifyPassword(data.currentPassword, user.passwordHash);
      if (!valid) throw new UnauthorizedError('Current password is incorrect');
      const passwordHash = await hashPassword(data.newPassword);
      await userRepo.save({ ...user, passwordHash, mustChangePassword: false, updatedAt: nowISO() });
    },

    async toggleStatus(actor, id) {
      assertCan(actor, 'admin:manage');
      const user = await userRepo.findById(id);
      if (!user) throw new NotFoundError('User not found');
      if (user.role === 'admin') {
        const original = findOriginalAdmin(await userRepo.findAll());
        if (original?.id === user.id) {
          throw new ForbiddenError('The original admin account cannot be deactivated');
        }
      }
      const next = user.status === 'active' ? 'inactive' : 'active';
      const saved = await userRepo.save({ ...user, status: next, updatedAt: nowISO() });
      return toSafeUser(saved);
    },

    async previewAccount(actor, id) {
      assertCan(actor, 'admin:manage');
      const user = await userRepo.findById(id);
      if (!user) throw new NotFoundError('Account not found');
      if (user.status !== 'active') throw new BadRequestError('Account is not active');
      if (user.role === 'admin') throw new BadRequestError('Admin accounts cannot be previewed');
      return toSafeUser(user);
    },

    async createChurchWithAccount(actor, input) {
      assertCan(actor, 'admin:manage');
      const data = CreateChurchWithAccountSchema.parse(input);

      const allUsers = await userRepo.findAll();
      // Slug base for the two gender usernames: the supplied username (legacy field) or the name.
      const slugBase = slugifyUsername(data.accountUsername ?? data.churchName);

      const now = nowISO();
      const churchId = newId('church');
      const church: Church = {
        id: churchId,
        name: data.churchName,
        zone: data.zone,
        contactPhone: data.contactPhone,
        contacts: {
          male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
          female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
        },
        createdAt: now,
        updatedAt: now,
      };
      await churchRepo.save(church);

      // Feature 2: a church always gets BOTH gender-scoped logins.
      const boys = await createGenderAccount(church, 'male', slugBase, allUsers);
      const girls = await createGenderAccount(church, 'female', slugBase, allUsers);

      invalidateDashboardCache(); // new church affects PreCampDashboard.perChurchBreakdown
      return {
        church,
        users: [toSafeUser(boys.user), toSafeUser(girls.user)],
        credentials: [boys.credential, girls.credential],
      };
    },

    async splitChurchAccounts(actor) {
      assertCan(actor, 'admin:manage');
      const churches = await churchRepo.findAll();
      const allUsers = await userRepo.findAll();
      const created: ChurchCredential[] = [];
      let retired = 0;

      for (const church of churches) {
        const slugBase = slugifyUsername(church.name);
        for (const gender of ['male', 'female'] as const) {
          const existing = allUsers.find(
            (u) => u.role === 'church' && u.churchId === church.id && u.genderScope === gender,
          );
          if (!existing) {
            const { credential } = await createGenderAccount(church, gender, slugBase, allUsers);
            created.push(credential);
          }
        }
        retired += await retireLegacyChurchLogins(church.id, allUsers);
      }

      invalidateDashboardCache();
      return { created, retired, churches: churches.length };
    },

    async randomizeChurchPasswords(actor) {
      assertCan(actor, 'admin:manage');
      const rows: ChurchCredential[] = await rotateChurchLogins();
      const allUsers = await userRepo.findAll();

      /* ── Leadership accounts (2026-08-03, owner request) ──
         Before this the button rotated church logins ONLY, so director / zone leader /
         first-aid / secondary-admin passwords were whatever they had been set to, possibly
         since the account was created, and there was no way to roll them as a set before
         camp. They are now rotated in the same operation and land in the same CSV.

         ⚠ THE ORIGINAL ADMIN IS EXCLUDED, and this is load-bearing, not a nicety. It is the
         recovery account — the one login that cannot be deleted, deactivated or demoted by
         anyone including itself (see `findOriginalAdmin`). An admin who taps this button is
         very often already locked out of something; rotating the password out from under
         their own live session, and handing them a new one only via a CSV download that
         could fail, is how a camp ends up with no way in at all. Secondary admins ARE
         rotated — they are full peers and the original remains as the fallback.

         Inactive accounts are skipped: rotating a deactivated login puts a working
         credential for it into a distributed CSV, which is the opposite of deactivating it.

         `mustChangePassword` is deliberately NOT set, matching the church branch above —
         these ARE the real handed-out passwords, not temporary ones. */
      const original = findOriginalAdmin(allUsers);
      const leadership = allUsers.filter(
        (u) => u.role !== 'church' && u.status === 'active' && u.id !== original?.id,
      );
      for (const u of leadership) {
        const password = memorablePassword();
        await userRepo.save({
          ...u,
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
          updatedAt: nowISO(),
        });
        rows.push({
          username: u.username,
          // No church for a leadership account — label by role so the CSV is readable.
          church: ROLE_LABELS[u.role] ?? u.role,
          gender: null,
          password,
          role: u.role,
        });
      }

      invalidateDashboardCache();
      rows.sort(
        (a, b) => a.church.localeCompare(b.church) || (a.gender ?? '').localeCompare(b.gender ?? ''),
      );
      return rows;
    },

    /**
     * 2026-08-05 owner request: rotate CHURCH LOGINS ONLY — no leadership account is touched.
     * Reason: after the Saturday handout the admin may need to re-issue church passwords
     * without invalidating director/zone/first-aid logins that are still in use.
     *
     * Calls the SAME `rotateChurchLogins` loop as `randomizeChurchPasswords` above — do not
     * duplicate it. Every invariant of the church branch carries over unchanged: gender accounts
     * are created if missing, legacy combined logins are retired, `mustChangePassword` is NOT
     * set (these are the real handed-out passwords), and the result is sorted identically.
     */
    async randomizeChurchOnlyPasswords(actor) {
      assertCan(actor, 'admin:manage');
      const rows = await rotateChurchLogins();
      invalidateDashboardCache();
      rows.sort(
        (a, b) => a.church.localeCompare(b.church) || (a.gender ?? '').localeCompare(b.gender ?? ''),
      );
      return rows;
    },

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

    async listChurches(actor) {
      const churches = await churchRepo.findAll();
      // Delegates to the canonical rule instead of re-deriving it. This WAS a hand-rolled
      // copy of `canAccessChurch`, and it had already drifted: it special-cased admin,
      // director and zoneLeader, then fell through to `c.id === actor.churchId` for
      // "everyone else". `firstAid` is in that fall-through and has no `churchId`, so the
      // comparison was always false and first aid received an EMPTY church list — while the
      // canonical rule grants firstAid every church, as it does for person data, notifications
      // and accommodation. Latent today (no first-aid screen calls this endpoint yet), which
      // is exactly why it survived: no test covered it and nothing visibly broke.
      // Do not re-inline these rules.
      return churches.filter((c) => canAccessChurch(actor, c.id, c.zone));
    },

    async updateChurch(actor, id, input) {
      assertCan(actor, 'admin:manage');
      const existing = await churchRepo.findById(id);
      if (!existing) throw new NotFoundError('Church not found');
      const data = UpdateChurchSchema.parse(input);
      const updated: Church = { ...existing, ...data, id: existing.id, updatedAt: nowISO() };
      const saved = await churchRepo.save(updated);
      // Person carries a denormalized `churchName` snapshot (person.ts) alongside
      // `churchId`. A rename must re-stamp it on every attached person, or rosters
      // and exports keep showing the old name. (Edge case — names are normally
      // settled before any people/allocations exist — but cheap to keep consistent.)
      if (data.name !== undefined && data.name !== existing.name) {
        const attached = await personRepo.findByChurch(id);
        if (attached.length > 0) {
          const stamp = nowISO();
          await personRepo.saveMany(
            attached.map((p) => ({ ...p, churchName: saved.name, updatedAt: stamp })),
          );
        }
      }
      invalidateDashboardCache();
      return saved;
    },

    async updateChurchContacts(actor, id, input) {
      assertCan(actor, 'church:contacts:write');
      const existing = await churchRepo.findById(id);
      if (!existing) throw new NotFoundError('Church not found');
      // The capability alone is not the gate. A church login holds it for its OWN church only;
      // without this check any church could rewrite every other church's emergency contacts,
      // which are exactly the numbers first aid calls at 2am. Oversight roles are camp-wide.
      const isOversight = actor.role === 'admin' || actor.role === 'director';
      if (!isOversight && actor.churchId !== id) {
        throw new ForbiddenError('You can only edit your own church’s contacts');
      }
      const data = UpdateChurchContactsSchema.parse(input);
      // Only `contacts` is written. Spreading `data` wholesale is how a narrow endpoint quietly
      // becomes a wide one later; keep this explicit.
      const saved = await churchRepo.save({
        ...existing,
        contacts: data.contacts,
        updatedAt: nowISO(),
      });
      invalidateDashboardCache();
      return saved;
    },

    async deleteUser(actor, id) {
      assertCan(actor, 'admin:manage');
      const user = await userRepo.findById(id);
      if (!user) throw new NotFoundError('Account not found');
      if (user.role === 'admin') {
        const original = findOriginalAdmin(await userRepo.findAll());
        if (original?.id === user.id) {
          throw new ForbiddenError('The original admin account cannot be deleted');
        }
      }
      await userRepo.delete(id);
      return { deleted: id };
    },

    async deleteChurch(actor, id) {
      assertCan(actor, 'admin:manage');
      const church = await churchRepo.findById(id);
      if (!church) throw new NotFoundError('Church not found');
      // Also remove the church's shared account
      const users = await userRepo.findAll();
      for (const u of users.filter((u) => u.churchId === id)) {
        await userRepo.delete(u.id);
      }
      await churchRepo.delete(id);
      invalidateDashboardCache();
      return { deleted: id };
    },
  };
}
