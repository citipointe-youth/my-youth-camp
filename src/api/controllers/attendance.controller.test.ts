import { describe, it, expect } from 'vitest';
import { makeAttendanceController } from './attendance.controller';
import type { PersonService } from '../../services/person.service';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';
import { BadRequestError } from '../../core/errors/app-error';

/**
 * A-Q8 (ruling Q8 + ORCH override of IA OQ-18, 7 Nov 2026): `leaderName` stays client-supplied,
 * but the server requires a non-empty string of at most 60 characters (after trim). Blank,
 * missing, non-string and over-long values are a 400. There is NO displayName fallback.
 * /attendance is a live call (not the offline queue), so the leader sees the error.
 */

const admin: Actor = { id: 'a1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Alice Admin' };

function setup() {
  const events: Array<Record<string, unknown>> = [];
  const person = {
    signEvent: async (_a: Actor, _id: string, e: Record<string, unknown>) => { events.push(e); },
  } as unknown as PersonService;
  return { ctrl: makeAttendanceController({ person }), events };
}
const req = (body: unknown): HttpRequest => ({ ctx: { actor: admin, token: 't' }, params: {}, query: {}, body });

for (const route of ['signIn', 'signOut'] as const) {
  describe(`POST /attendance/${route === 'signIn' ? 'sign-in' : 'sign-out'}: leaderName`, () => {
    const bad: Array<[string, unknown]> = [
      ['missing', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['null', null],
      ['a number', 123],
      ['an object', { x: 1 }],
      ['61 characters', 'x'.repeat(61)],
      ['10,000 characters', 'x'.repeat(10_000)],
      ['61 characters after a trim that leaves 61', ` ${'x'.repeat(61)} `],
    ];
    for (const [name, v] of bad) {
      it(`${name}: 400, nothing stored, no displayName fallback`, async () => {
        const { ctrl, events } = setup();
        const body = v === undefined ? { camperId: 'p1' } : { camperId: 'p1', leaderName: v };
        await expect(ctrl[route](req(body))).rejects.toBeInstanceOf(BadRequestError);
        expect(events).toHaveLength(0);
      });
    }

    it('60 characters is accepted', async () => {
      const { ctrl, events } = setup();
      await ctrl[route](req({ camperId: 'p1', leaderName: 'x'.repeat(60) }));
      expect(events[0]?.['leaderName']).toBe('x'.repeat(60));
    });

    it('is trimmed before it is stored', async () => {
      const { ctrl, events } = setup();
      await ctrl[route](req({ camperId: 'p1', leaderName: '  SD ' }));
      expect(events[0]?.['leaderName']).toBe('SD');
    });
  });
}
