import type { ID, ISODateString } from '../types/common';
import type { UserRole, ZoneName } from '../types/enums';

export interface User {
  id: ID;
  firstName: string;
  lastName: string;
  /**
   * Login identifier — a plain USERNAME (not an email address), e.g. "victory",
   * "grade7g", "director". Case-insensitive on login. Renamed from `email`
   * 2026-06-18; this is an account credential, distinct from a person's real
   * contact email (which lives on Person/Church, unchanged).
   */
  username: string;
  mobile?: string;
  role: UserRole;
  churchId?: string | null;
  churchName?: string | null;
  zone?: ZoneName | null;
  status: 'active' | 'inactive';
  passwordHash?: string;
  /**
   * True for accounts whose current password was set by someone/something other
   * than the account holder (admin `setPassword`, new-year rollover temp passwords)
   * and hasn't been changed since. The holder is blocked from everything except
   * changing their own password until this clears.
   */
  mustChangePassword?: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface Actor {
  id: ID;
  role: UserRole;
  churchId: string | null;
  churchName: string | null;
  zone: ZoneName | null;
  displayName: string;
  /** See User.mustChangePassword. Embedded in the signed session token. */
  mustChangePassword?: boolean;
}
