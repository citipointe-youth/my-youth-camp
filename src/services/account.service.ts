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
} from '../core/validation/account.schema';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { toSafeUser } from './auth.service';
import { invalidateDashboardCache } from './dashboard-cache';
import { memorablePassword } from '../utils/memorable-password';

/** A church login credential row for the Feature 6 password export. */
export interface ChurchCredential {
  username: string;
  church: string;
  gender: GenderScope;
  password: string;
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
  listChurches(actor: Actor): Promise<Church[]>;
  updateChurch(actor: Actor, id: string, input: unknown): Promise<Church>;
  deleteUser(actor: Actor, id: string): Promise<{ deleted: string }>;
  deleteChurch(actor: Actor, id: string): Promise<{ deleted: string }>;
  /** Admin-only: validate a target account for read-only preview; returns its SafeUser. */
  previewAccount(actor: Actor, id: string): Promise<SafeUser>;
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

  return {
    async listUsers(actor) {
      assertCan(actor, 'admin:manage');
      const users = await userRepo.findAll();
      return users.map(toSafeUser);
    },

    async createUser(actor, input) {
      assertCan(actor, 'admin:manage');
      const data = CreateUserSchema.parse(input);
      // Never allow creating another admin through this method (only seeding)
      if (data.role === 'admin') {
        throw new ForbiddenError('Cannot create admin accounts via API');
      }
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
      if (data.role === 'admin') {
        throw new ForbiddenError('Cannot promote to admin via API');
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
      if (user.role === 'admin') throw new ForbiddenError('Cannot deactivate the admin account');
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

      invalidateDashboardCache();
      rows.sort((a, b) => a.church.localeCompare(b.church) || a.gender.localeCompare(b.gender));
      return rows;
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

    async deleteUser(actor, id) {
      assertCan(actor, 'admin:manage');
      const user = await userRepo.findById(id);
      if (!user) throw new NotFoundError('Account not found');
      if (user.role === 'admin') throw new ForbiddenError('Cannot delete the admin account');
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
