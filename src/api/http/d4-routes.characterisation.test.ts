import { describe, it, expect, beforeEach } from 'vitest';
import { buildContainer, type Container } from '../../container';
import { seedAll } from '../../data/seed';
import { env } from '../../config/env';
import { buildRoutes } from './router';
import { isAppError } from '../../core/errors/app-error';
import { verifyPassword } from '../../utils/crypto';
import type { HttpRequest, Route } from './types';
import type { Actor } from '../../core/entities/user';

/**
 * D4 (Phase C, 7 Nov 2026): characterisation of the routes whose handlers used raw repos off
 * `Services` (/setup, /auth/me, the import stamps). Written against the pre-D4 code; must stay
 * green after the logic moves into AuthService / SettingsService.
 */

if (env.PERSISTENCE !== 'memory' || env.DATABASE_URL) {
  throw new Error('d4-routes.characterisation.test.ts must run with PERSISTENCE=memory and no DATABASE_URL');
}

let container: Container;
let routes: Route[];
const find = (method: string, path: string) => {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`no route ${method} ${path}`);
  return r;
};
const call = async (method: string, path: string, req: Partial<HttpRequest>) =>
  find(method, path).handler({ params: {}, query: {}, body: {}, ...req } as HttpRequest);
const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { return isAppError(e) ? `${e.statusCode} ${e.message}` : `throw ${(e as Error).message}`; }
};

beforeEach(async () => {
  container = await buildContainer();
  await seedAll(container);
  routes = buildRoutes(container.services) as Route[];
});

async function seededAdmin() {
  const [admin] = await container.repos.users.findByRole('admin');
  return admin!;
}

describe('POST /setup', () => {
  it('400s on a missing field or short password', async () => {
    expect(await status(call('POST', '/setup', { body: { username: 'x' } }))).toBe('400 username and password required');
    expect(await status(call('POST', '/setup', { body: { username: 'x', password: 'short' } })))
      .toBe('400 Password must be at least 8 characters');
  });

  it('403s once the admin has a password', async () => {
    expect(await status(call('POST', '/setup', { body: { username: 'x', password: 'longenough' } })))
      .toBe('403 Admin password already set');
  });

  it('sets username + password on the first admin when it has none', async () => {
    const admin = await seededAdmin();
    await container.repos.users.save({ ...admin, passwordHash: undefined as unknown as string });
    expect(await call('POST', '/setup', { body: { username: 'boss', password: 'longenough' } })).toEqual({ ok: true });
    const after = (await container.repos.users.findById(admin.id))!;
    expect(after.username).toBe('boss');
    expect(await verifyPassword('longenough', after.passwordHash!)).toBe(true);
  });

  it('404s when no admin exists', async () => {
    for (const a of await container.repos.users.findByRole('admin')) await container.repos.users.delete(a.id);
    expect(await status(call('POST', '/setup', { body: { username: 'x', password: 'longenough' } })))
      .toBe('404 No admin account found — run migrations first');
  });
});

describe('GET /auth/me', () => {
  it('returns the safe user (no hash) and the session actor', async () => {
    const admin = await seededAdmin();
    const actor = { id: admin.id, role: 'admin', displayName: 'X' } as Actor;
    const res = (await call('GET', '/auth/me', { ctx: { actor, token: 't' } })) as { user: Record<string, unknown>; actor: Actor };
    expect(res.user.id).toBe(admin.id);
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.actor).toBe(actor);
  });

  it('401s for an unknown user or no session', async () => {
    const actor = { id: 'nobody', role: 'admin' } as Actor;
    expect((await status(call('GET', '/auth/me', { ctx: { actor, token: 't' } }))).startsWith('401')).toBe(true);
    expect((await status(call('GET', '/auth/me', {}))).startsWith('401')).toBe(true);
  });
});
