import { timingSafeEqual } from 'node:crypto';
import type { HttpRequest } from '../http/types';
import { UnauthorizedError } from '../../core/errors/app-error';

/** Minimal shape the controller needs — keeps the controller testable without the container. */
export interface CronTickRunner {
  run(): Promise<unknown>;
}

export interface CronControllerServices {
  tick: CronTickRunner;
}

/**
 * Constant-time compare that tolerates length mismatch. `timingSafeEqual` THROWS when the
 * two buffers differ in length, so a naive call leaks length via a 500 instead of a 401.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function makeCronController(services: CronControllerServices) {
  return {
    /**
     * GET /internal/cron/tick — called by Supabase pg_cron via pg_net, NOT by the SPA.
     * Sits outside the app's auth layer (auth:false) and is guarded by a shared secret
     * instead. Throws UnauthorizedError so the adapter's sendError maps it to a 401;
     * returning an error object would come back as a 200.
     */
    async tick(req: HttpRequest) {
      const expected = process.env['CRON_SECRET'] ?? '';
      // An unset secret must fail closed. Otherwise a misconfigured deploy would let
      // anyone fire the tick with `Authorization: Bearer `.
      if (expected.length === 0) throw new UnauthorizedError();

      const header = req.headers?.['authorization'] ?? '';
      const prefix = 'Bearer ';
      if (!header.startsWith(prefix)) throw new UnauthorizedError();

      if (!secretMatches(header.slice(prefix.length), expected)) throw new UnauthorizedError();

      return services.tick.run();
    },
  };
}
