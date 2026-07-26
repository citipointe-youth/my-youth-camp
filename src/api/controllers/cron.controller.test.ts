import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCronController } from './cron.controller';
import { UnauthorizedError } from '../../core/errors/app-error';
import type { HttpRequest } from '../http/types';

function reqOf(headers?: Record<string, string | undefined>): HttpRequest {
  return { ctx: null, params: {}, query: {}, body: {}, headers };
}

describe('cron controller secret guard', () => {
  const OLD = process.env['CRON_SECRET'];

  beforeEach(() => { process.env['CRON_SECRET'] = 'super-secret-value'; });
  afterEach(() => {
    if (OLD === undefined) delete process.env['CRON_SECRET'];
    else process.env['CRON_SECRET'] = OLD;
  });

  it('runs the tick when the bearer secret matches', async () => {
    const tick = vi.fn().mockResolvedValue({ ok: true, created: 0, pushed: 0 });
    const ctrl = makeCronController({ tick: { run: tick } });
    const out = await ctrl.tick(reqOf({ authorization: 'Bearer super-secret-value' }));
    expect(tick).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ ok: true });
  });

  it('rejects a wrong secret without running the tick', async () => {
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({ authorization: 'Bearer wrong' }))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(tick).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({}))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(tick).not.toHaveBeenCalled();
  });

  it('rejects when headers are absent entirely', async () => {
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf(undefined))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a secret of a different length without throwing', async () => {
    // timingSafeEqual throws on length mismatch — the guard must handle that itself.
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({ authorization: 'Bearer short' }))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses to run when CRON_SECRET is unset, even with no header', async () => {
    delete process.env['CRON_SECRET'];
    const tick = vi.fn();
    const ctrl = makeCronController({ tick: { run: tick } });
    await expect(ctrl.tick(reqOf({ authorization: 'Bearer ' }))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(tick).not.toHaveBeenCalled();
  });
});
