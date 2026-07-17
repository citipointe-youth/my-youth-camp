import { describe, it, expect } from 'vitest';
import { makeCheckInController } from './checkin.controller';
import { makeCamperController } from './camper.controller';
import { makeSearchController } from './search.controller';
import type { CheckInService } from '../../services/checkin.service';
import type { PersonService } from '../../services/person.service';
import type { SearchService } from '../../services/search.service';
import type { CheckInEntry } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';

// ---------------------------------------------------------------------------
// Feature 4 — leader initials threaded into the audit/event write paths.
//   * Daily check-in captures the initials in CheckInEntry.leaderId (reused field),
//     falling back to the account id when none are supplied.
//   * Medicare + masked-contact reveals attribute the reveal to the initials
//     (revealedBy), falling back to the actor's display name — the app persists no
//     reveal-audit table, so the authenticated request IS the audit trail.
// ---------------------------------------------------------------------------

const churchActor: Actor = {
  id: 'acct-b-victory', role: 'church', churchId: 'c1', churchName: 'Victory',
  zone: 'Yellow', displayName: 'Victory Boys', genderScope: 'male',
};
const adminActor: Actor = {
  id: 'admin-1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin User',
};

function reqOf(over: Partial<HttpRequest>, actor: Actor): HttpRequest {
  return { ctx: { actor, token: 't' }, params: {}, query: {}, body: {}, ...over };
}

describe('Feature 4: daily check-in threads leader initials into CheckInEntry.leaderId', () => {
  function controllerCapturing(captured: { entry?: Omit<CheckInEntry, 'id'> }) {
    const checkIn = {
      assertSessionAllowed: async () => {},
      getSessions: async () => [{ id: '2026-07-02~am', label: 'Wed AM', day: '2026-07-02', startTime: '08:00', location: null }],
    } as unknown as CheckInService;
    const person = {
      checkIn: async (_actor: Actor, _id: string, entry: Omit<CheckInEntry, 'id'>) => { captured.entry = entry; return {} as never; },
    } as unknown as PersonService;
    return makeCheckInController({ checkIn, person });
  }

  it('stores the supplied initials in leaderId', async () => {
    const captured: { entry?: Omit<CheckInEntry, 'id'> } = {};
    const ctrl = controllerCapturing(captured);
    await ctrl.checkIn(reqOf({ body: { camperId: 'p1', sessionId: '2026-07-02~am', type: 'in', initials: 'SD' } }, churchActor));
    expect(captured.entry?.leaderId).toBe('SD');
  });

  it('trims whitespace-only initials and falls back to the account id', async () => {
    const captured: { entry?: Omit<CheckInEntry, 'id'> } = {};
    const ctrl = controllerCapturing(captured);
    await ctrl.checkIn(reqOf({ body: { camperId: 'p1', sessionId: '2026-07-02~am', type: 'in', initials: '   ' } }, churchActor));
    expect(captured.entry?.leaderId).toBe('acct-b-victory');
  });

  it('falls back to the account id when no initials field is present', async () => {
    const captured: { entry?: Omit<CheckInEntry, 'id'> } = {};
    const ctrl = controllerCapturing(captured);
    await ctrl.checkIn(reqOf({ body: { camperId: 'p1', sessionId: '2026-07-02~am', type: 'in' } }, churchActor));
    expect(captured.entry?.leaderId).toBe('acct-b-victory');
  });
});

describe('Feature 4: reveals attribute to the leader initials', () => {
  it('revealMedicare returns revealedBy = supplied initials', async () => {
    const ctrl = makeCamperController({ person: {} as unknown as PersonService });
    const res = await ctrl.revealMedicare(reqOf({ params: { id: 'p1' }, body: { initials: 'SD' } }, adminActor)) as { ok: boolean; revealedBy: string };
    expect(res.ok).toBe(true);
    expect(res.revealedBy).toBe('SD');
  });

  it('revealMedicare falls back to the actor display name when no initials given', async () => {
    const ctrl = makeCamperController({ person: {} as unknown as PersonService });
    const res = await ctrl.revealMedicare(reqOf({ params: { id: 'p1' }, body: {} }, adminActor)) as { revealedBy: string };
    expect(res.revealedBy).toBe('Admin User');
  });

  it('revealContact attaches revealedBy from the initials query param', async () => {
    const search = {
      revealContact: async () => ({ role: 'male-primary', name: 'Leader', phone: '0411 000 000', gender: 'male', type: 'primary', churchId: 'c1' }),
    } as unknown as SearchService;
    const ctrl = makeSearchController({ search });
    const res = await ctrl.revealContact(reqOf({ params: { camperId: 'p1', role: 'male-primary' }, query: { initials: 'SD' } }, adminActor)) as { name: string; revealedBy: string };
    expect(res.name).toBe('Leader');
    expect(res.revealedBy).toBe('SD');
  });
});
