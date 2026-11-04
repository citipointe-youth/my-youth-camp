import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeRegistrantController } from './registrant.controller';
import { makePersonService, type PersonService } from '../../services/person.service';
import { InMemoryPersonRepository } from '../../repositories/in-memory';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';
import { BadRequestError, ForbiddenError } from '../../core/errors/app-error';

/**
 * Final-review fix (2026-09-03): `PATCH /registrants/:id` validated
 * `amountPaidOverride`/`refundAmount` with `Number.isFinite` alone, so a negative value was
 * accepted. A negative `refundAmount` *adds* money in `amountPaidBase - refundAmount`, and a
 * negative `amountPaidOverride` shows as owed-money-below-zero — both silently corrupt the
 * budget figure. `null` (clear the field) and `0` (a real, meaningful value) must both still
 * be accepted; only a genuine negative number is now rejected. `accommodationOverride` is a
 * separate enum check and is untouched.
 */

function actor(): Actor {
  return {
    id: 'a1',
    role: 'admin',
    churchId: null,
    churchName: null,
    zone: null,
    displayName: 'Admin',
  };
}

function person(): Person {
  return {
    id: 'p1',
    firstName: 'Ivy',
    lastName: 'Thompson',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    gender: 'female',
    grade: '10',
    lifecycle: 'registered',
    atCamp: false,
    medicalConditions: [],
    dietaryRequirements: [],
    consents: {},
    checkInHistory: [],
    signOutHistory: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as Person;
}

function controller() {
  const p = person();
  const personSvc = {
    get: async () => p,
    update: async (_actor: Actor, _id: string, patch: Partial<Person>) => ({ ...p, ...patch }),
  } as unknown as PersonService;
  return makeRegistrantController({ person: personSvc });
}

function req(body: Record<string, unknown>): HttpRequest {
  return { ctx: { actor: actor(), token: 't' }, params: { id: 'p1' }, query: {}, body };
}

describe('PATCH /registrants/:id — amountPaidOverride/refundAmount bounds', () => {
  it('rejects a negative amountPaidOverride', async () => {
    await expect(controller().update(req({ amountPaidOverride: -5 }))).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it('rejects a negative refundAmount', async () => {
    await expect(controller().update(req({ refundAmount: -1 }))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('accepts 0 for amountPaidOverride', async () => {
    const out = (await controller().update(req({ amountPaidOverride: 0 }))) as {
      amountPaidOverride?: number | null;
    };
    expect(out.amountPaidOverride).toBe(0);
  });

  it('accepts 0 for refundAmount', async () => {
    const out = (await controller().update(req({ refundAmount: 0 }))) as { refundAmount?: number | null };
    expect(out.refundAmount).toBe(0);
  });

  it('accepts null for amountPaidOverride (clears the override)', async () => {
    const out = (await controller().update(req({ amountPaidOverride: null }))) as {
      amountPaidOverride?: number | null;
    };
    expect(out.amountPaidOverride).toBeNull();
  });

  it('accepts null for refundAmount (clears the refund)', async () => {
    const out = (await controller().update(req({ refundAmount: null }))) as { refundAmount?: number | null };
    expect(out.refundAmount).toBeNull();
  });

  it('still rejects a non-numeric value (pre-existing finiteness check)', async () => {
    await expect(controller().update(req({ amountPaidOverride: 'abc' }))).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});

describe('GET /registrants/:id — payment and email need registrant:read', () => {
  const paid = () => ({ ...person(), email: 'ivy@example.test', amountPaid: 250, invoiceNumber: 'INV-1' }) as unknown as Person;
  const call = (role: Actor['role']) =>
    makeRegistrantController({ person: { get: async () => paid() } as unknown as PersonService }).get({
      ctx: { actor: { ...actor(), role }, token: 't' }, params: { id: 'p1' }, query: {}, body: {},
    });

  for (const role of ['prayer', 'firstAid'] as const) {
    it(`${role} is refused, so no payment or email field is returned`, async () => {
      await expect(call(role)).rejects.toMatchObject({ statusCode: 403 });
    });
  }

  it('a role with registrant:read still gets amountPaid, invoice and email', async () => {
    expect(await call('church')).toMatchObject({ amountPaid: 250, invoiceNumber: 'INV-1', email: 'ivy@example.test' });
  });
});

describe('Undo cancel on the Data Import card', () => {
  it('sends what the real controller and service need, with no wider rights than cancel', async () => {
    const html = readFileSync(resolve(__dirname, '../../../public/index.html'), 'utf8');
    expect(html).toMatch(/\$\{cancelled\?`<button[^`]*crUndoCancel\('\$\{esc\(p\.id\)\}'\)/);

    // The SPA has no build step, so run the real handler from its source with stubs.
    const src = html.slice(html.indexOf('async function crUndoCancel('), html.indexOf('async function crRefund('));
    const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    const api = async (path: string, o: { method: string; body: Record<string, unknown> }) => {
      calls.push({ path, method: o.method, body: o.body });
    };
    const noop = () => undefined;
    await new Function('api', 'toast', '_invalidate', '_loadAllocation', `${src}; return crUndoCancel('p1');`)(
      api, noop, noop, noop,
    );
    expect(calls).toEqual([{ path: '/registrants/p1', method: 'PATCH', body: { status: 'registered' } }]);

    const repo = new InMemoryPersonRepository();
    await repo.init();
    await repo.save({ ...person(), lifecycle: 'cancelled', cancelledAt: '2026-11-01T00:00:00.000Z' });
    const ctl = makeRegistrantController({ person: makePersonService(repo) });

    const firstAid: Actor = { ...actor(), role: 'firstAid' };
    await expect(ctl.update({ ...req(calls[0]!.body), ctx: { actor: firstAid, token: 't' } })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await repo.findById('p1'))!.lifecycle).toBe('cancelled');

    const out = (await ctl.update(req(calls[0]!.body))) as { status: string; cancelledAt: string | null };
    expect(out.status).toBe('registered');
    expect(out.cancelledAt).toBeNull();
  });
});
