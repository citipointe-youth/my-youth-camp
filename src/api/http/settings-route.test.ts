import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildContainer } from '../../container';
import { seedAll } from '../../data/seed';
import { env } from '../../config/env';
import { createApp } from './express-adapter';
import { buildRoutes } from './router';
import type { AuthService } from '../../services/auth.service';
import type { Actor } from '../../core/entities/user';

/**
 * A-Q11 (ruling Q11, IA OQ-14, 7 Nov 2026): GET /settings needs a login. The SPA reads no settings
 * field before login, so the pre-login allow-list is empty and the route is simply auth:true. An
 * anonymous caller used to get the whole row (site map, discount tags, prices, epochs).
 */

// Memory only. Never run this against a real database.
if (env.PERSISTENCE !== 'memory' || env.DATABASE_URL) {
  throw new Error('settings-route.test.ts must run with PERSISTENCE=memory and no DATABASE_URL');
}

const admin: Actor = { id: 'a1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' };
// 'good' is a live session; anything else (including a dead token) resolves to null.
const stubAuth = { resolveToken: async (t: string) => (t === 'good' ? admin : null) } as unknown as AuthService;

let server: Server;
let base: string;
beforeAll(async () => {
  const container = await buildContainer();
  await seedAll(container);
  const app = createApp(buildRoutes(container.services), stubAuth);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});
afterAll(() => { server.close(); });

describe('GET /settings requires a login', () => {
  it('no Authorization header: 401, and no settings field in the body', async () => {
    const res = await fetch(`${base}/settings`);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/campMode|discountCodeTags|siteMapImage|tentPrice/);
  });

  it('a dead token: 401 (never a 200 the SPA would cache over ycp_settings)', async () => {
    const res = await fetch(`${base}/settings`, { headers: { authorization: 'Bearer dead' } });
    expect(res.status).toBe(401);
  });

  it('a live token: the full row, as before', async () => {
    const res = await fetch(`${base}/settings`, { headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['campMode']).toBeDefined();
    expect(body['lastTempPasswords']).toBeUndefined();
  });
});
