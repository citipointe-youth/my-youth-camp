import type { Person, CheckInEntry, SignOutEvent } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import type { CampMode, PersonLifecycle } from '../core/types/enums';
import { newId } from '../utils/id';
import { isOversight } from './access-control';
import type { PresenceWrite, PresenceDecide } from '../repositories/interfaces/entity-repositories';
import { BadRequestError } from '../core/errors/app-error';
import { lastEntryFor } from './session-roster';

/**
 * Presence transitions (P1+I4). The ONE place that decides how a person's presence
 * (`atCamp`, `lifecycle`, `cancelledAt`) and presence history (check-in rows, sign events)
 * move. Pure: no I/O. Since P3 callers hand it to the repository seam: `repo.transition(id,
 * decideOrRefuse(intent, ctx))` decides on the LOCKED stored row (`writeOf` for bulk sweeps).
 *
 * Invariants owned here:
 * - `atCamp`/`lifecycle` are orthogonal; only sign events, cancel/uncancel and the mode revert
 *   move them. A `checkIn` NEVER moves them (it is the daily session log).
 * - every applied outcome that changes `atCamp` appends exactly one sign event;
 * - `noop` appends nothing and bumps nothing (B-2, N5);
 * - a sign event's `authorId` is always `ctx.actor.id`;
 * - `checkIn` has exactly two refusals with frozen messages — the offline queue drains to it and
 *   drops a tap on any app 4xx, so NEVER add a refusal to the `checkIn` intent (IMPACT-SUMMARY §2.1);
 * - pre-camp `signIn` is refused except for director/admin (QA item 21). The offline SHEET refuses
 *   every role pre-camp before it gets here (A-3, IA OQ-3: a bulk Y-sheet is a whole-request rule).
 *
 * `leaderName` is validated at the HTTP edge (attendance.controller, A-Q8) because only that input
 * is client-supplied; events built here use `actor.displayName`.
 */
export type PresenceIntent =
  | { kind: 'checkIn'; entry: CheckInEntry }
  | { kind: 'signIn' | 'signOut'; event: SignOutEvent }
  | { kind: 'cancel' }
  | { kind: 'uncancel' }
  | { kind: 'modeRevert'; event: SignOutEvent };

export interface PresenceCtx {
  actor: Actor;
  /**
   * REQUIRED so a caller can't silently skip the pre-camp rule. Read only by `signIn`; `null` = no
   * settings row. Callers that never run the rule (signOut, oversight actors) may pass `null`.
   */
  campMode: CampMode | null;
  now: string;
}

export type Outcome =
  | { result: 'applied'; next: Person; appended: { checkIn?: CheckInEntry; signEvent?: SignOutEvent } }
  | { result: 'noop' }
  | { result: 'refused'; reason: string };

export const CHECKIN_REFUSAL_CANCELLED = 'Cannot check in a cancelled person';
export const CHECKIN_REFUSAL_NOT_AT_CAMP = 'Cannot check in a person who is not currently at camp';
const SIGNIN_REFUSAL_PRECAMP = 'Camp has not started yet, so nobody can be signed in.';
const SIGNIN_REFUSAL_CANCELLED = 'Cannot sign in a cancelled person';

/**
 * The sign-event state rule (design D2): an 'in' promotes registered/checked_out -> arrived and
 * sets atCamp; an 'out' moves arrived -> checked_out. Registered and cancelled people never move
 * on an 'out'; cancelled people never move on an 'in'.
 */
function move(p: Pick<Person, 'lifecycle' | 'atCamp'>, type: 'in' | 'out'): { lifecycle: PersonLifecycle; atCamp: boolean } {
  if (p.lifecycle === 'cancelled') return { lifecycle: 'cancelled', atCamp: p.atCamp };
  if (type === 'in') return { lifecycle: 'arrived', atCamp: true };
  if (p.lifecycle === 'registered') return { lifecycle: 'registered', atCamp: p.atCamp };
  return { lifecycle: 'checked_out', atCamp: false };
}

/** Apply a sign event if it moves presence; otherwise null (B-2: a state no-op writes nothing). */
function signed(p: Person, event: SignOutEvent, now: string): Person | null {
  const n = move(p, event.type);
  if (n.lifecycle === p.lifecycle && n.atCamp === p.atCamp) return null;
  return { ...p, ...n, signOutHistory: [...p.signOutHistory, event], updatedAt: now };
}

const applied = (next: Person, appended: { checkIn?: CheckInEntry; signEvent?: SignOutEvent } = {}): Outcome =>
  ({ result: 'applied', next, appended });
const NOOP: Outcome = { result: 'noop' };

export function transition(p: Person, intent: PresenceIntent, ctx: PresenceCtx): Outcome {
  const { actor, now } = ctx;
  switch (intent.kind) {
    case 'checkIn': {
      if (p.lifecycle === 'cancelled') return { result: 'refused', reason: CHECKIN_REFUSAL_CANCELLED };
      if (!p.atCamp) return { result: 'refused', reason: CHECKIN_REFUSAL_NOT_AT_CAMP };
      // N5: idempotent per (session, person, type) against the LAST entry for that session only
      // "checked in" is last-entry-wins, so a real in -> out -> in is three entries.
      if (lastEntryFor(p, intent.entry.sessionId)?.type === intent.entry.type) return NOOP;
      return applied({ ...p, checkInHistory: [...p.checkInHistory, intent.entry], updatedAt: now }, { checkIn: intent.entry });
    }
    case 'signIn':
    case 'signOut': {
      if (intent.kind === 'signIn') {
        if (ctx.campMode === 'pre-camp' && !isOversight(actor)) {
          return { result: 'refused', reason: SIGNIN_REFUSAL_PRECAMP };
        }
        if (p.lifecycle === 'cancelled') return { result: 'refused', reason: SIGNIN_REFUSAL_CANCELLED };
      }
      const event: SignOutEvent = { ...intent.event, type: intent.kind === 'signIn' ? 'in' : 'out', authorId: actor.id };
      const next = signed(p, event, now);
      return next ? applied(next, { signEvent: event }) : NOOP;
    }
    case 'cancel': {
      if (p.lifecycle === 'cancelled') return NOOP;
      // B-3: someone at camp is signed out first (one 'out' event), then cancelled.
      const event: SignOutEvent = { id: newId('so'), type: 'out', leaderName: actor.displayName || 'Staff',
        reason: 'Registration cancelled', authorId: actor.id, timestamp: now };
      const out = p.atCamp ? signed(p, event, now) : null;
      return applied(
        { ...(out ?? p), lifecycle: 'cancelled', atCamp: false, cancelledAt: now, updatedAt: now },
        out ? { signEvent: event } : {},
      );
    }
    case 'uncancel':
      if (p.lifecycle !== 'cancelled') return NOOP;
      return applied({ ...p, lifecycle: 'registered', cancelledAt: null, updatedAt: now });
    case 'modeRevert': {
      // at-camp -> pre-camp sweep: arrived people go back to registered with an audit 'out'.
      // B-X3 / Q10: only atCamp people; checked_out and cancelled are left alone.
      if (!p.atCamp || p.lifecycle === 'cancelled') return NOOP;
      const event: SignOutEvent = { ...intent.event, type: 'out', authorId: actor.id };
      return applied(
        { ...p, lifecycle: 'registered', atCamp: false, signOutHistory: [...p.signOutHistory, event], updatedAt: now },
        { signEvent: event },
      );
    }
  }
}

/**
 * P3 adapter: the repository write an outcome implies (null = noop). `refused` is not a write;
 * use `decideOrRefuse` when a refusal must surface as the caller's 400.
 */
export function writeOf(p: Person, o: Outcome): PresenceWrite | null {
  if (o.result !== 'applied') return null;
  const { next, appended } = o;
  return {
    atCamp: next.atCamp,
    lifecycle: next.lifecycle,
    ...(next.cancelledAt !== p.cancelledAt ? { cancelledAt: next.cancelledAt ?? null } : {}),
    ...(appended.checkIn ? { appendCheckIn: appended.checkIn } : {}),
    ...(appended.signEvent ? { appendSignEvent: appended.signEvent } : {}),
    updatedAt: next.updatedAt,
  };
}

/** A `PresenceDecide` for `repo.transition`: decides on the locked row, throws the refusal as a
 *  BadRequestError (rolls the transaction back), and returns the write or null. */
export function decideOrRefuse(intent: PresenceIntent, ctx: PresenceCtx): PresenceDecide {
  return (current) => {
    const o = transition(current, intent, ctx);
    if (o.result === 'refused') throw new BadRequestError(o.reason);
    return writeOf(current, o);
  };
}
