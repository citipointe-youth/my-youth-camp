import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyPassword } from '../utils/crypto';
import type { IUserRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor, User, SafeUser } from '../core/entities/user';
import type { ZoneName } from '../core/types/enums';
import { UnauthorizedError } from '../core/errors/app-error';
import { LoginInputSchema } from '../core/validation/auth.schema';
import type { LoginInput } from '../core/validation/auth.schema';
import { ResponseCache } from '../utils/response-cache';

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours — church leaders use this as an installed
// PWA at camp, where iOS AutoFill is unreliable, so every expiry means hand-typing a password.
// Doubled from 24h on 2026-08-05. Because a locked-out role could otherwise keep a live session
// for up to this long, the doubling ships together with the per-role revocation epoch below
// (`SESSION_REVOCATION_CACHE_TTL_MS` / `isSessionRevoked`), which kills a locked role's tokens
// within seconds of the lock, independent of the TTL.

// A well-formed but unmatchable scrypt hash (salt:key). Used to run an equal-cost password
// verification when the account doesn't exist / has no password, so login response time and
// error message don't reveal whether a username is real (user-enumeration backstop — the login
// limiter is keyed per ip+username, so an attacker CAN probe many usernames otherwise).
const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

// Stateless HMAC-signed sessions (replaces the old in-memory token Map, which was
// fatal on serverless / multi-instance hosting: each cold start began with an empty
// Map, logging every user out, and a token minted on instance A was unknown to
// instance B). The signed token carries the full actor so authenticated requests
// need no DB lookup; the HMAC guarantees it wasn't tampered with. Trade-off: a
// role/zone change only takes effect on the user's next login (within the 24h TTL).
const INSECURE_FALLBACK = 'camp-platform-dev-secret-change-in-production';
const SESSION_SECRET = process.env['SESSION_SECRET'] ?? INSECURE_FALLBACK;

if (process.env['NODE_ENV'] === 'production' && SESSION_SECRET === INSECURE_FALLBACK) {
  // eslint-disable-next-line no-console
  console.error(
    '[SECURITY] SESSION_SECRET env var is not set. Session tokens can be forged. ' +
    'Set SESSION_SECRET in your deployment environment immediately.',
  );
}

/**
 * B-2 (Phase 5): fail-fast on an insecure production secret. Called from the single
 * composition path `createAppInstance()` so a misconfigured deploy refuses to start
 * (server → exit 1; serverless → cold-start init rejects → 500) instead of serving with
 * forgeable tokens. No-op outside production, and a no-op when a real secret is set — so a
 * correct deploy (which already sets SESSION_SECRET) is unaffected. Re-reads the env at call
 * time so tests can set/unset it around startup.
 */
export function assertSessionSecret(): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  const secret = process.env['SESSION_SECRET'];
  if (!secret || secret === INSECURE_FALLBACK) {
    throw new Error(
      '[SECURITY] Refusing to start: SESSION_SECRET is not set (or equals the insecure dev fallback) ' +
      'in production. Session tokens would be forgeable. Set a 32+ byte SESSION_SECRET and redeploy.',
    );
  }
}

function signSession(actor: Actor, expiresAt: number): string {
  // `issuedAt` (2026-08-05) is what the per-role revocation epoch compares against — see
  // `isSessionRevoked` below. A token minted before this field existed simply lacks it; that is
  // the deliberate "legacy token" case handled there, not a bug.
  const payload = Buffer.from(
    JSON.stringify({ userId: actor.id, expiresAt, issuedAt: Date.now(), actor }),
  ).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

interface ParsedSession {
  userId: string;
  expiresAt: number;
  issuedAt?: number;
  actor?: Actor;
}

function parseSession(token: string): ParsedSession | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as ParsedSession;
  } catch {
    return null;
  }
}

/**
 * Per-role session revocation epoch (2026-08-05). `resolveToken` does ZERO I/O for every other
 * role, deliberately (see its own comment) — this is the one exception, and it is bounded: a
 * settings read only ever happens for a `church`/`zoneLeader` actor, and the result is cached
 * for `SESSION_REVOCATION_CACHE_TTL_MS` so a check-in-window burst of requests from the same
 * role costs at most one DB read per minute, not one per request. Lock-to-logout latency of up
 * to this TTL is accepted (owner-approved).
 */
const SESSION_REVOCATION_CACHE_TTL_MS = 60_000;

interface RevocationEpochs {
  church: string | null;
  zoneLeader: string | null;
}

const REVOCATION_CACHE_KEY = 'epochs';

/**
 * Reads the two epoch columns off the settings singleton, through a 60s cache.
 *
 * ⚠️ IF THE SETTINGS READ THROWS, THE CALLER MUST TREAT THE ROLE AS NOT REVOKED. A transient DB
 * blip must never lock the whole camp out of check-in mid-camp — that failure direction is
 * deliberate, not an oversight, so this returns `null` epochs (nothing revoked) on error rather
 * than propagating the throw. It is intentionally NOT this function's job to decide "allow the
 * request" — that decision belongs to `isSessionRevoked`, which is what actually reasons about
 * fail-open; this just hands back "nothing is known to be revoked" as the safe default.
 */
async function readRevocationEpochs(
  settingsRepo: ISettingsRepository,
  cache: ResponseCache<RevocationEpochs>,
): Promise<RevocationEpochs> {
  const cached = cache.get(REVOCATION_CACHE_KEY);
  if (cached) return cached;
  try {
    const s = await settingsRepo.getSingleton();
    const epochs: RevocationEpochs = {
      church: s?.churchSessionsValidFrom ?? null,
      zoneLeader: s?.zoneLeaderSessionsValidFrom ?? null,
    };
    cache.set(REVOCATION_CACHE_KEY, epochs);
    return epochs;
  } catch {
    // Fail OPEN: a settings-read failure must never lock the camp out. Deliberately not cached,
    // so the very next call retries against the DB rather than pinning "nothing is revoked" for
    // a full 60s on the strength of one transient error.
    return { church: null, zoneLeader: null };
  }
}

/**
 * Is this token dead because its role was locked out after (or without) it being issued?
 *
 * Rules (all deliberate — see the 2026-08-05 CLAUDE.md entry for the full reasoning):
 * - Only `church`/`zoneLeader` are ever checked; admin/director/firstAid are unaffected by
 *   construction (there is no admin/firstAid epoch field to read).
 * - No epoch set for the role -> never revoked (the common case: nobody has been locked).
 * - Epoch set AND `issuedAt` missing (a legacy pre-epoch token) -> REVOKED. A token with no
 *   `issuedAt` cannot prove it postdates the epoch, so it fails closed once the role has
 *   actually been locked (never before — see `readRevocationEpochs`, epochs start null).
 * - Epoch set AND `issuedAt` predates it -> REVOKED.
 */
async function isSessionRevoked(
  role: Actor['role'],
  issuedAt: number | undefined,
  settingsRepo: ISettingsRepository,
  cache: ResponseCache<RevocationEpochs>,
): Promise<boolean> {
  if (role !== 'church' && role !== 'zoneLeader') return false;
  const epochs = await readRevocationEpochs(settingsRepo, cache);
  const epochIso = role === 'church' ? epochs.church : epochs.zoneLeader;
  if (!epochIso) return false;
  if (issuedAt === undefined) return true; // legacy token, epoch now set -> revoke
  return issuedAt < Date.parse(epochIso);
}

export function toActor(user: User): Actor {
  return {
    id: user.id,
    role: user.role,
    churchId: user.churchId ?? null,
    churchName: user.churchName ?? null,
    zone: (user.zone ?? null) as ZoneName | null,
    displayName: `${user.firstName} ${user.lastName}`,
    genderScope: user.genderScope ?? null,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _pw, ...safe } = user;
  return safe as SafeUser;
}

export interface AuthService {
  login(input: unknown): Promise<{ token: string; user: SafeUser }>;
  resolveToken(token: string): Promise<Actor | null>;
  logout(token: string): Promise<void>;
  /** Mint a real signed session token for an arbitrary active user (admin account preview).
   *  actorOverrides let the caller force fields on the embedded actor (e.g. mustChangePassword:false). */
  issueTokenFor(userId: string, actorOverrides?: Partial<Actor>): Promise<string | null>;
}

export function makeAuthService(users: IUserRepository, settings?: ISettingsRepository): AuthService {
  // Instance-scoped (not module-scoped) deliberately: this is created once at composition-root
  // wiring for the real app (so the 60s bound applies exactly once, camp-wide), but tests build
  // many short-lived services against many different settings fixtures in the same process — a
  // module-level cache would leak an earlier test's epoch into a later one.
  const revocationCache = new ResponseCache<RevocationEpochs>(SESSION_REVOCATION_CACHE_TTL_MS);

  return {
    async login(input: unknown) {
      const parsed = LoginInputSchema.safeParse(input);
      if (!parsed.success) throw new UnauthorizedError('Invalid credentials');

      const { username, password } = parsed.data as LoginInput;
      const user = await users.findByUsername(username);
      if (!user || user.status !== 'active' || !user.passwordHash) {
        // Equal-cost dummy verify so a missing / inactive / passwordless account can't be told
        // apart — by timing OR message — from a wrong password (user-enumeration backstop).
        await verifyPassword(password, DUMMY_PASSWORD_HASH);
        throw new UnauthorizedError('Invalid credentials');
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) throw new UnauthorizedError('Invalid credentials');

      // Admin-controlled login locks (manual toggles in Settings). Blocks ONLY at login —
      // existing sessions keep working until their token TTL. Credentials are verified first
      // so a locked account can't be probed for valid passwords via the lock message.
      if (settings && (user.role === 'church' || user.role === 'zoneLeader')) {
        const s = await settings.getSingleton();
        const locked =
          (user.role === 'church' && s?.churchLoginLocked) ||
          (user.role === 'zoneLeader' && s?.zoneLeaderLoginLocked);
        if (locked) {
          throw new UnauthorizedError(
            user.role === 'church'
              ? 'Church logins are currently disabled by the camp administrator.'
              : 'Zone leader logins are currently disabled by the camp administrator.',
          );
        }
      }

      const token = signSession(toActor(user), Date.now() + TOKEN_TTL_MS);
      return { token, user: toSafeUser(user) };
    },

    async resolveToken(token: string) {
      const session = parseSession(token);
      if (!session) return null;
      if (Date.now() > session.expiresAt) return null;
      // Trusted actor embedded in the signed token — no DB round-trip needed for the actor
      // itself. Legacy token without an embedded actor: fall back to a lookup.
      const actor = session.actor ?? await (async () => {
        const user = await users.findById(session.userId);
        if (!user || user.status !== 'active') return null;
        return toActor(user);
      })();
      if (!actor) return null;
      // Per-role session revocation epoch (2026-08-05). ZERO I/O for every role except
      // church/zoneLeader — `isSessionRevoked` returns false immediately for anyone else, so
      // admin/director/firstAid stay exactly as cheap as before this feature. When it does read
      // settings, `settings` may be undefined (e.g. many unit tests construct this service
      // without one) — treat that the same as "no epoch on record", i.e. never revoked.
      if (settings) {
        const revoked = await isSessionRevoked(actor.role, session.issuedAt, settings, revocationCache);
        if (revoked) return null;
      }
      return actor;
    },

    async logout(_token: string) {
      // Stateless tokens — logout is handled client-side by discarding the token.
    },

    async issueTokenFor(userId, actorOverrides) {
      const user = await users.findById(userId);
      if (!user || user.status !== 'active') return null;
      return signSession({ ...toActor(user), ...(actorOverrides ?? {}) }, Date.now() + TOKEN_TTL_MS);
    },
  };
}
