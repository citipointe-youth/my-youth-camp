import express, { type Express, type Request, type Response } from 'express';
import { env } from '../../config/env';
import type { Route, BufferRoute, HttpRequest } from './types';
import type { AuthService } from '../../services/auth.service';
import { resolveContext } from '../middleware/auth.middleware';
import { sendError } from '../middleware/error.middleware';
import { UnauthorizedError, MustChangePasswordError } from '../../core/errors/app-error';
import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';
import { getSqlClient } from '../../repositories/supabase/client';

const logger = createLogger('http');

/**
 * Express's IncomingHttpHeaders values are `string | string[] | undefined`. Collapse
 * arrays to the first element so route handlers get a flat, predictable shape.
 */
function normaliseHeaders(
  h: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

// Temporarily disabled (2026-07-11, at the owner's request) — the flag-setting in
// account.service/admin.service, the self-service POST /accounts/me/password endpoint,
// and the frontend gate (public/index.html, its own matching constant) all stay wired up;
// this just stops the gate from actually blocking anyone. Flip back to true to re-enable
// (see CLAUDE.md "Forced password change" — do the same in public/index.html).
const MUST_CHANGE_PASSWORD_ENFORCED = false;

// Login throttle: 15 FAILED attempts per (IP + username) per 15-minute window.
// Keyed by ip+username (not bare IP) and counting failures only — at a camp venue all
// ~200 leaders share ONE public IP behind the WiFi NAT and re-log-in every morning
// (48h token TTL), so a bare-IP any-attempt bucket locked out the whole site.
//
// Raised 10 → 15 on 2026-08-05 (owner). A CHURCH LOGIN IS SHARED by several leaders, so the
// ip+username bucket is not one person's typos — it is the whole church's, and on a camp or
// church WiFi they all share the IP too. At 10 a handful of leaders fumbling the handed-out
// password locked their entire church out for 15 minutes. 15 keeps a real brute-force
// backstop (the keyspace is ~117k after the 2026-07-31 widening) while absorbing a shared
// login's normal fumbling.
const loginLimiter = new RateLimiter(15, 15 * 60 * 1000);

// /ready's DB probe timeout — well under the Vercel function's maxDuration:30 and the
// role-level statement_timeout of 15s, so a hung pooler still returns a fast 503.
const READY_DB_TIMEOUT_MS = 5000;

/** Rate-limit key for a login attempt: client IP + submitted username (lowercased). */
function loginKeyOf(req: Request): string {
  const body = req.body as { username?: unknown } | undefined;
  const uname = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  return `${req.ip ?? 'unknown'}|${uname}`;
}

export function createApp(routes: (Route | BufferRoute)[], authService: AuthService): Express {
  const app = express();
  app.set('trust proxy', true); // honour X-Forwarded-For behind a reverse proxy
  app.disable('x-powered-by');  // don't advertise the framework (minor info-leak reduction)

  const allowWildcard = env.CORS_ORIGINS.includes('*');
  if (allowWildcard && env.NODE_ENV === 'production') {
    logger.warn('[SECURITY] CORS_ORIGINS includes "*" in production — lock this to your domain.');
  }

  // CORS + security headers
  app.use((req, res, next) => {
    const origin = req.headers['origin'];
    if (!origin || env.CORS_ORIGINS.includes(origin) || allowWildcard) {
      res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Security headers (parity with connection-made-simple Phase 4).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Cross-origin isolation: this is a standalone same-origin PWA (no cross-origin popups or
    // embedders), so these are zero-friction hardening — they stop other sites opener-linking or
    // hot-linking our resources. Google Fonts are unaffected (CORP governs OUR responses).
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // HSTS: enforce HTTPS for a long window. Prod-only (localhost dev is plain HTTP); browsers
    // ignore it over HTTP anyway, but gating on NODE_ENV keeps the header honest.
    if (env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check — LIVENESS ONLY. Does not touch the database, so it stays green through a
  // total pooler outage. Left exactly as-is; see /ready below for a check that actually
  // exercises the DB. Do not add a DB check here — that would silently regress /ready's
  // whole reason for existing.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // Readiness check — 2026-08-05. An uptime monitor must be able to tell "the app process is
  // up" (/health) apart from "the app can actually reach the database" (/ready). This runs a
  // trivial `select 1` with a SHORT timeout, well under the Vercel function's maxDuration:30
  // and the role-level statement_timeout of 15s (see CLAUDE.md), so a hung pooler fails this
  // route fast instead of hanging the monitor's own request.
  //
  // ⚠ auth:false DELIBERATELY — an external uptime monitor cannot log in. And the response body
  // never carries a connection string, hostname or driver error — only a generic status; the
  // real detail goes to the server log via `logger`, never to the client.
  app.get('/ready', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');

    // memory/json persistence has no database at all — reporting "ready" here is honest, not
    // a fake pass: there is nothing to check, so there is nothing that can be down. Mirrors
    // how src/container.ts branches on PERSISTENCE.
    if (env.PERSISTENCE !== 'supabase') {
      res.status(200).json({ status: 'ready', db: 'n/a' });
      return;
    }

    const started = Date.now();
    try {
      const sql = getSqlClient();
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('readiness DB check timed out')), READY_DB_TIMEOUT_MS);
      });
      await Promise.race([sql`select 1`, timeout]);
      res.status(200).json({ status: 'ready', db: 'ok', ms: Date.now() - started });
    } catch (err) {
      // Log the real detail server-side only — never in the response body (no hostname,
      // connection string or driver error text reaches the client).
      logger.error('[ready] DB check failed', err);
      res.status(503).json({ status: 'degraded', db: 'error' });
    }
  });

  // Static public files
  app.use(express.static('public'));

  // Register routes
  for (const route of routes) {
    const expressPath = route.path.replace(/:([a-zA-Z]+)/g, ':$1');
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';

    app[method](expressPath, async (req: Request, res: Response) => {
      const isLogin = route.method === 'POST' && route.path === '/auth/login';
      // API + export responses can carry personal/medical data — never let a browser or proxy
      // cache them. Static assets are served by express.static above and stay cacheable.
      res.setHeader('Cache-Control', 'no-store');
      try {
        // Throttle FAILED login attempts per IP+username (brute-force backstop).
        if (isLogin) {
          const key = loginKeyOf(req);
          if (loginLimiter.isLimited(key)) {
            const retryAfter = loginLimiter.retryAfterSeconds(key);
            res.setHeader('Retry-After', String(retryAfter));
            res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' });
            return;
          }
        }
        const ctx = await resolveContext(req.headers['authorization'], authService, route.auth);
        if (route.auth && !ctx) {
          throw new UnauthorizedError();
        }
        if (MUST_CHANGE_PASSWORD_ENFORCED && ctx?.actor.mustChangePassword && !('allowMustChangePassword' in route && route.allowMustChangePassword)) {
          throw new MustChangePasswordError();
        }

        const httpReq: HttpRequest = {
          ctx,
          params: req.params as Record<string, string>,
          query: req.query as Record<string, string | undefined>,
          body: req.body,
          ip: req.ip,
          headers: normaliseHeaders(req.headers),
        };

        if ('bufferHandler' in route) {
          const buffer = await route.bufferHandler(httpReq);
          res.setHeader('Content-Type', route.contentType);
          res.setHeader('Content-Disposition', `attachment; filename="${route.filename}"`);
          res.send(buffer);
          return;
        }
        const result = await route.handler(httpReq);
        res.json(result);
      } catch (err) {
        // A login that threw (bad password, locked role, validation) consumes budget;
        // successful logins never do.
        if (isLogin) loginLimiter.recordFailure(loginKeyOf(req));
        sendError(res, err);
      }
    });
  }

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Endpoint not found' });
  });

  return app;
}
