import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { makeAuthService, toActor, assertSessionSecret } from './auth.service';
import { InMemoryUserRepository } from '../repositories/in-memory';
import { hashPassword } from '../utils/crypto';
import type { User } from '../core/entities/user';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import { UnauthorizedError } from '../core/errors/app-error';

// Minimal settings repo stub for the login-lock checks. Only getSingleton is exercised.
function fakeSettings(over: Partial<CampSettings> = {}): ISettingsRepository {
  const now = '2026-01-01T00:00:00.000Z';
  const settings: CampSettings = {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-07-01', endDate: '2026-07-05',
    timezone: 'Australia/Brisbane', checkInDays: [], accommodationLocked: false,
    churchLoginLocked: false, zoneLeaderLoginLocked: false,
    churchCheckinTimeRestricted: false,
    checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto',
    campMode: 'pre-camp', createdAt: now, updatedAt: now, ...over,
  };
  return {
    async init() {},
    async getSingleton() { return settings; },
    async saveSingleton(s: CampSettings) { return s; },
  };
}

async function seedUser(repo: InMemoryUserRepository, over: Partial<User> = {}): Promise<User> {
  const now = new Date().toISOString();
  const user: User = {
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Admin',
    username: 'admin',
    role: 'admin',
    churchId: null,
    churchName: null,
    zone: null,
    status: 'active',
    passwordHash: await hashPassword('demo1234'),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  await repo.save(user);
  return user;
}

describe('AuthService.login', () => {
  let repo: InMemoryUserRepository;
  beforeEach(async () => {
    repo = new InMemoryUserRepository();
    await repo.init();
  });

  // User-enumeration hardening: a wrong username, an inactive account and a passwordless account
  // must all fail identically to a wrong password ("Invalid credentials"), so neither the message
  // nor (via the equal-cost dummy scrypt) the timing reveals whether a username exists.
  it('unknown username fails with the same "Invalid credentials" as a wrong password', async () => {
    await seedUser(repo);
    const svc = makeAuthService(repo);
    await expect(svc.login({ username: 'nope', password: 'demo1234' })).rejects.toThrow(/Invalid credentials/);
  });

  it('inactive account fails with "Invalid credentials" (no distinct message)', async () => {
    await seedUser(repo, { username: 'off', status: 'inactive' });
    const svc = makeAuthService(repo);
    await expect(svc.login({ username: 'off', password: 'demo1234' })).rejects.toThrow(/Invalid credentials/);
  });

  it('passwordless account fails with "Invalid credentials" (not a distinct "no password set")', async () => {
    await seedUser(repo, { username: 'nopw', passwordHash: null as unknown as string });
    const svc = makeAuthService(repo);
    await expect(svc.login({ username: 'nopw', password: 'anything' })).rejects.toThrow(/Invalid credentials/);
  });

  it('issues a signed stateless token for valid credentials and never returns the password hash', async () => {
    await seedUser(repo);
    const svc = makeAuthService(repo);
    const res = await svc.login({ username: 'admin', password: 'demo1234' });
    // Stateless HMAC session: "<base64url payload>.<base64url sig>" (was a 64-hex
    // opaque token backed by an in-memory Map).
    expect(res.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.user.username).toBe('admin');
    expect((res.user as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('is case-insensitive on username', async () => {
    await seedUser(repo);
    const svc = makeAuthService(repo);
    const res = await svc.login({ username: 'ADMIN', password: 'demo1234' });
    expect(res.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    await seedUser(repo);
    const svc = makeAuthService(repo);
    await expect(svc.login({ username: 'admin', password: 'nope' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects inactive accounts', async () => {
    await seedUser(repo, { status: 'inactive' });
    const svc = makeAuthService(repo);
    await expect(
      svc.login({ username: 'admin', password: 'demo1234' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects malformed input without throwing a non-auth error', async () => {
    const svc = makeAuthService(repo);
    await expect(svc.login({ username: '' })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('AuthService.login — admin login locks', () => {
  let repo: InMemoryUserRepository;
  beforeEach(async () => {
    repo = new InMemoryUserRepository();
    await repo.init();
  });

  it('blocks a church login when churchLoginLocked is true', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const svc = makeAuthService(repo, fakeSettings({ churchLoginLocked: true }));
    await expect(
      svc.login({ username: 'victory', password: 'demo1234' }),
    ).rejects.toThrow(/disabled by the camp administrator/);
  });

  it('allows a church login when churchLoginLocked is false', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const svc = makeAuthService(repo, fakeSettings({ churchLoginLocked: false }));
    const res = await svc.login({ username: 'victory', password: 'demo1234' });
    expect(res.token).toBeTruthy();
  });

  it('blocks a zoneLeader login when zoneLeaderLoginLocked is true', async () => {
    await seedUser(repo, { id: 'z1', username: 'yellowzone', role: 'zoneLeader', zone: 'Yellow' });
    const svc = makeAuthService(repo, fakeSettings({ zoneLeaderLoginLocked: true }));
    await expect(
      svc.login({ username: 'yellowzone', password: 'demo1234' }),
    ).rejects.toThrow(/disabled by the camp administrator/);
  });

  it('does NOT block a church login when only the zoneLeader lock is on (and vice-versa)', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const svc = makeAuthService(repo, fakeSettings({ zoneLeaderLoginLocked: true }));
    expect((await svc.login({ username: 'victory', password: 'demo1234' })).token).toBeTruthy();
  });

  it('never blocks admin/director/firstAid even when both locks are on', async () => {
    await seedUser(repo, { id: 'd1', username: 'director', role: 'director' });
    const svc = makeAuthService(repo, fakeSettings({ churchLoginLocked: true, zoneLeaderLoginLocked: true }));
    expect((await svc.login({ username: 'director', password: 'demo1234' })).token).toBeTruthy();
  });

  it('checks the lock AFTER the password — a locked account with a wrong password still gets the generic error', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const svc = makeAuthService(repo, fakeSettings({ churchLoginLocked: true }));
    await expect(
      svc.login({ username: 'victory', password: 'wrong' }),
    ).rejects.toThrow(/Invalid credentials/);
  });
});

describe('AuthService token lifecycle (stateless HMAC sessions)', () => {
  it('resolveToken round-trips to the embedded Actor without a DB lookup', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo);
    const svc = makeAuthService(repo);

    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });
    const actor = await svc.resolveToken(token);
    expect(actor?.role).toBe('admin');
    expect(actor?.displayName).toBe('Ada Admin');
  });

  it('logout is a client-side no-op: stateless tokens remain valid until expiry', async () => {
    // Stateless tokens cannot be server-revoked (the trade-off for serverless
    // survivability); logout just discards the token client-side.
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo);
    const svc = makeAuthService(repo);

    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });
    await svc.logout(token);
    expect(await svc.resolveToken(token)).not.toBeNull();
  });

  it('embeds mustChangePassword: true in the token for a flagged account', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { mustChangePassword: true });
    const svc = makeAuthService(repo);
    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });
    const actor = await svc.resolveToken(token);
    expect(actor?.mustChangePassword).toBe(true);
  });

  it('embeds mustChangePassword: false for a normal account', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo);
    const svc = makeAuthService(repo);
    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });
    const actor = await svc.resolveToken(token);
    expect(actor?.mustChangePassword).toBe(false);
  });

  it('resolveToken returns null for a malformed / unsigned token', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    const svc = makeAuthService(repo);
    expect(await svc.resolveToken('deadbeef')).toBeNull();
  });

  it('resolveToken returns null when the HMAC signature does not match', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo);
    const svc = makeAuthService(repo);
    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });
    // Tamper with the payload but keep the original signature.
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ userId: 'u1', expiresAt: Date.now() + 1e6, actor: { id: 'u1', role: 'admin' } })).toString('base64url') + '.' + sig;
    expect(await svc.resolveToken(forged)).toBeNull();
  });
});

describe('assertSessionSecret() — B-2 production fail-fast', () => {
  const saved = { ...process.env };
  afterEach(() => {
    // Restore the env between cases so one test can't leak into another.
    process.env['NODE_ENV'] = saved['NODE_ENV'];
    if (saved['SESSION_SECRET'] === undefined) delete process.env['SESSION_SECRET'];
    else process.env['SESSION_SECRET'] = saved['SESSION_SECRET'];
  });

  it('throws in production when SESSION_SECRET is unset', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['SESSION_SECRET'];
    expect(() => assertSessionSecret()).toThrow(/SESSION_SECRET/);
  });

  it('throws in production when SESSION_SECRET equals the insecure fallback', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['SESSION_SECRET'] = 'camp-platform-dev-secret-change-in-production';
    expect(() => assertSessionSecret()).toThrow(/SESSION_SECRET/);
  });

  it('does NOT throw in production when a real SESSION_SECRET is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['SESSION_SECRET'] = 'a-genuinely-random-32-plus-byte-secret-value-xyz';
    expect(() => assertSessionSecret()).not.toThrow();
  });

  it('does NOT throw outside production even with no SESSION_SECRET', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['SESSION_SECRET'];
    expect(() => assertSessionSecret()).not.toThrow();
  });
});

describe('toActor()', () => {
  it('derives displayName and normalises optional fields to null', () => {
    const now = new Date().toISOString();
    const actor = toActor({
      id: 'u2',
      firstName: 'Zoe',
      lastName: 'Zone',
      username: 'zoe',
      role: 'zoneLeader',
      zone: 'Yellow',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    } as User);
    expect(actor.displayName).toBe('Zoe Zone');
    expect(actor.zone).toBe('Yellow');
    expect(actor.churchId).toBeNull();
  });
});

describe('AuthService.issueTokenFor', () => {
  it('mints a token resolveToken accepts, carrying the target actor', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1', churchName: 'Victory' });
    const svc = makeAuthService(repo);
    const token = await svc.issueTokenFor('c1');
    expect(token).toBeTruthy();
    const actor = await svc.resolveToken(token!);
    expect(actor?.id).toBe('c1');
    expect(actor?.role).toBe('church');
    expect(actor?.churchId).toBe('ch1');
  });

  it('applies actorOverrides (mustChangePassword:false wins over the user record)', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', mustChangePassword: true });
    const svc = makeAuthService(repo);
    const token = await svc.issueTokenFor('c1', { mustChangePassword: false });
    const actor = await svc.resolveToken(token!);
    expect(actor?.mustChangePassword).toBe(false);
  });

  it('returns null for a missing or inactive user', async () => {
    const repo = new InMemoryUserRepository();
    await repo.init();
    await seedUser(repo, { id: 'x1', username: 'off', status: 'inactive' });
    const svc = makeAuthService(repo);
    expect(await svc.issueTokenFor('nope')).toBeNull();
    expect(await svc.issueTokenFor('x1')).toBeNull();
  });
});

// ── 48h TTL + per-role session revocation epoch (2026-08-05) ──────────────────────────────────
//
// The TTL doubling (24h -> 48h) and the revocation epoch ship together deliberately: doubling
// the TTL doubles how long a token from a locked-out role could otherwise keep working, so a
// kill switch has to exist alongside it. See the CLAUDE.md entry for the full reasoning.

// Mirrors auth.service.ts's INSECURE_FALLBACK — this is what SESSION_SECRET resolves to
// whenever process.env.SESSION_SECRET is unset, which is the case throughout this test run
// (nothing in this suite sets it). Used only to hand-construct a "legacy" token below that omits
// `issuedAt`, simulating one minted before this feature existed.
const DEV_FALLBACK_SECRET = 'camp-platform-dev-secret-change-in-production';

function signLegacyToken(userId: string, expiresAt: number, actor: unknown): string {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt, actor })).toString('base64url');
  const sig = createHmac('sha256', DEV_FALLBACK_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

describe('AuthService — 48h TTL', () => {
  let repo: InMemoryUserRepository;
  beforeEach(async () => {
    repo = new InMemoryUserRepository();
    await repo.init();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('still resolves 47 hours after login', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    await seedUser(repo);
    const svc = makeAuthService(repo);
    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });

    vi.setSystemTime(new Date('2026-08-02T23:00:00.000Z')); // +47h
    expect(await svc.resolveToken(token)).not.toBeNull();
  });

  it('is null 49 hours after login', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    await seedUser(repo);
    const svc = makeAuthService(repo);
    const { token } = await svc.login({ username: 'admin', password: 'demo1234' });

    vi.setSystemTime(new Date('2026-08-03T01:00:00.000Z')); // +49h
    expect(await svc.resolveToken(token)).toBeNull();
  });
});

describe('AuthService — per-role session revocation epoch', () => {
  let repo: InMemoryUserRepository;
  beforeEach(async () => {
    repo = new InMemoryUserRepository();
    await repo.init();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('revokes a church token issued BEFORE the epoch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const settings = fakeSettings({ churchSessionsValidFrom: '2026-08-01T11:00:00.000Z' });
    const svc = makeAuthService(repo, settings);

    const { token } = await svc.login({ username: 'victory', password: 'demo1234' });
    expect(await svc.resolveToken(token)).toBeNull();
  });

  it('accepts a church token issued AFTER the epoch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const settings = fakeSettings({ churchSessionsValidFrom: '2026-08-01T11:00:00.000Z' });
    const svc = makeAuthService(repo, settings);

    const { token } = await svc.login({ username: 'victory', password: 'demo1234' });
    const actor = await svc.resolveToken(token);
    expect(actor?.role).toBe('church');
  });

  it('revokes a zoneLeader token issued BEFORE the epoch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    await seedUser(repo, { id: 'z1', username: 'yellowzone', role: 'zoneLeader', zone: 'Yellow' });
    const settings = fakeSettings({ zoneLeaderSessionsValidFrom: '2026-08-01T11:00:00.000Z' });
    const svc = makeAuthService(repo, settings);

    const { token } = await svc.login({ username: 'yellowzone', password: 'demo1234' });
    expect(await svc.resolveToken(token)).toBeNull();
  });

  it('accepts a zoneLeader token issued AFTER the epoch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    await seedUser(repo, { id: 'z1', username: 'yellowzone', role: 'zoneLeader', zone: 'Yellow' });
    const settings = fakeSettings({ zoneLeaderSessionsValidFrom: '2026-08-01T11:00:00.000Z' });
    const svc = makeAuthService(repo, settings);

    const { token } = await svc.login({ username: 'yellowzone', password: 'demo1234' });
    const actor = await svc.resolveToken(token);
    expect(actor?.role).toBe('zoneLeader');
  });

  it('never checks the epoch for admin/director/firstAid — a church epoch does not affect them', async () => {
    await seedUser(repo, { id: 'd1', username: 'director', role: 'director' });
    // Epoch is in the far future — if it were (wrongly) applied to every role, this token
    // would be revoked no matter when it was issued.
    const settings = fakeSettings({ churchSessionsValidFrom: '2099-01-01T00:00:00.000Z' });
    const svc = makeAuthService(repo, settings);

    const { token } = await svc.login({ username: 'director', password: 'demo1234' });
    const actor = await svc.resolveToken(token);
    expect(actor?.role).toBe('director');
  });

  it('a legacy token (no issuedAt) is REVOKED once the role epoch is set', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const settings = fakeSettings({ churchSessionsValidFrom: '2026-08-01T00:00:00.000Z' });
    const svc = makeAuthService(repo, settings);

    const legacyActor = toActor({
      id: 'c1', firstName: 'Vic', lastName: 'Tory', username: 'victory', role: 'church',
      churchId: 'ch1', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as User);
    const token = signLegacyToken('c1', Date.now() + 1000 * 60 * 60, legacyActor);

    expect(await svc.resolveToken(token)).toBeNull();
  });

  it('a legacy token (no issuedAt) resolves fine when no epoch is set', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    const settings = fakeSettings({ churchSessionsValidFrom: null });
    const svc = makeAuthService(repo, settings);

    const legacyActor = toActor({
      id: 'c1', firstName: 'Vic', lastName: 'Tory', username: 'victory', role: 'church',
      churchId: 'ch1', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as User);
    const token = signLegacyToken('c1', Date.now() + 1000 * 60 * 60, legacyActor);

    const actor = await svc.resolveToken(token);
    expect(actor?.role).toBe('church');
  });

  it('ALLOWS the request when the settings read throws, rather than locking the camp out', async () => {
    await seedUser(repo, { id: 'c1', username: 'victory', role: 'church', churchId: 'ch1' });
    // Mint the token against a healthy settings stub (login itself must succeed)...
    const healthy = fakeSettings({});
    const mintingSvc = makeAuthService(repo, healthy);
    const { token } = await mintingSvc.login({ username: 'victory', password: 'demo1234' });

    // ...then resolve it against a service whose settings read always throws.
    const throwing: ISettingsRepository = {
      async init() {},
      async getSingleton(): Promise<CampSettings | null> {
        throw new Error('DB blip');
      },
      async saveSingleton(s: CampSettings) { return s; },
    };
    const resolvingSvc = makeAuthService(repo, throwing);
    const actor = await resolvingSvc.resolveToken(token);
    expect(actor?.role).toBe('church');
  });
});
