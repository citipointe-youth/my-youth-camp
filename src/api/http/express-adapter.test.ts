import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './express-adapter';
import { env } from '../../config/env';
import type { AuthService } from '../../services/auth.service';
import type { Route } from './types';

// ---------------------------------------------------------------------------
// GET /ready — 2026-08-05. /health is a pure liveness probe (no DB touch); /ready
// is the readiness probe an uptime monitor should point at instead, since it is
// the only one of the two that can actually catch a Supabase pooler outage.
//
// No real Supabase connection is available in this test environment, so the
// "DB reachable" success path is covered indirectly: PERSISTENCE stays 'memory'
// (this suite's default), which exercises the honest "nothing to check" branch.
// The failure path is exercised by flipping PERSISTENCE to 'supabase' with no
// DATABASE_URL set — getSqlClient() then throws synchronously, which is exactly
// the shape of "the DB is unreachable" from this route's point of view.
// ---------------------------------------------------------------------------

// A stub authService — /health and /ready are registered directly on the Express
// app (not through the route table) and never call this, but createApp's second
// parameter is required.
const stubAuthService = {
  resolveToken: async () => null,
} as unknown as AuthService;

function startApp(routes: Route[] = []): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(routes, stubAuthService);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('GET /ready', () => {
  let server: Server;
  let baseUrl: string;
  const originalPersistence = env.PERSISTENCE;
  const originalDatabaseUrl = env.DATABASE_URL;

  beforeAll(async () => {
    const started = await startApp([]);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    // Every test that mutates env restores it — env is a shared module-level object.
    (env as { PERSISTENCE: string }).PERSISTENCE = originalPersistence;
    (env as { DATABASE_URL: string }).DATABASE_URL = originalDatabaseUrl;
  });

  it('does not require auth — no Authorization header, still answers (not 401)', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).not.toBe(401);
  });

  it('reports ready without pretending to have checked a DB when PERSISTENCE is not supabase', async () => {
    (env as { PERSISTENCE: string }).PERSISTENCE = 'memory';
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ready', db: 'n/a' });
  });

  it('sets Cache-Control: no-store', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 503 with a generic body when the DB is unreachable, never leaking connection detail', async () => {
    (env as { PERSISTENCE: string }).PERSISTENCE = 'supabase';
    (env as { DATABASE_URL: string }).DATABASE_URL = ''; // getSqlClient() throws synchronously
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ status: 'degraded', db: 'error' });
    // Never leak a connection string, hostname or driver error into the body.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/postgres|supabase|DATABASE_URL|localhost|\d+\.\d+\.\d+\.\d+/i);
  });

  it('GET /health is untouched — still a bare liveness response with no db field', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db?: unknown };
    expect(body.status).toBe('ok');
    expect(body).not.toHaveProperty('db');
  });
});
