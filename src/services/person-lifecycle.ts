import type { Person } from '../core/entities/person';
import type { CheckInEntry, SignOutEvent } from '../core/entities/person';
import type { PersonLifecycle } from '../core/types/enums';

/**
 * Pure lifecycle transitions for the unified Person (design D2).
 *
 * The defining rule: a person is a pre-camp *registrant* until their **Day-1 first
 * check-in**, at which point they are promoted to a *camper* (`registered → arrived`).
 * Subsequent sign-out/sign-in toggle `arrived ⇄ checked_out`. These functions are pure
 * (no I/O) so the promotion semantics can be unit-tested in isolation; the check-in /
 * attendance services apply them and persist the result.
 */

/** Apply a check-in entry, returning the lifecycle/atCamp the person should move to. */
export function applyCheckIn(
  person: Pick<Person, 'lifecycle' | 'atCamp'>,
  type: 'in' | 'out',
): { lifecycle: PersonLifecycle; atCamp: boolean } {
  if (type === 'in') {
    // First sign-in promotes a registrant to a camper (registered → arrived).
    // Cancelled people are never auto-promoted by a check-in.
    if (person.lifecycle === 'cancelled') {
      return { lifecycle: 'cancelled', atCamp: person.atCamp };
    }
    return { lifecycle: 'arrived', atCamp: true };
  }
  // type === 'out': leaving a session. Only meaningful for someone at camp.
  if (person.lifecycle === 'cancelled' || person.lifecycle === 'registered') {
    return { lifecycle: person.lifecycle, atCamp: person.atCamp };
  }
  return { lifecycle: 'checked_out', atCamp: false };
}

/** Apply a sign-out event (attendance), returning the next lifecycle/atCamp. */
export function applySignOut(
  person: Pick<Person, 'lifecycle' | 'atCamp'>,
): { lifecycle: PersonLifecycle; atCamp: boolean } {
  return applyCheckIn(person, 'out');
}

/** Apply a sign-in event (attendance return), returning the next lifecycle/atCamp. */
export function applySignIn(
  person: Pick<Person, 'lifecycle' | 'atCamp'>,
): { lifecycle: PersonLifecycle; atCamp: boolean } {
  return applyCheckIn(person, 'in');
}

/**
 * Append a check-in entry only — never mutates lifecycle or atCamp.
 *
 * **Idempotent per (session, person, type) against the LAST entry only (N5).** The SPA persists
 * its check-in queue to localStorage, and a crash between `drainQueue`'s `await` resolving and
 * the queue being re-persisted replays the entry on reboot — which used to write a duplicate row
 * into the compliance export. If the most recent entry for this person in the SAME session
 * already has the same `type`, the write is a no-op and the person is returned unchanged
 * (`updatedAt` is not bumped either — nothing changed).
 *
 * ⚠ It compares against the LAST entry for that session ONLY, never the whole history, because
 * "checked in" is **last-entry-wins** for a session (`toRosterEntry` in `src/api/dto/person.dto.ts`
 * and `checkin-warnings.ts` both depend on this). A genuine in → out → in sequence is three real
 * entries and must keep working; only an immediate repeat of the same type collapses. Entries for
 * other sessions are irrelevant and are skipped when finding "the last entry for this session".
 */
export function withCheckIn(person: Person, entry: CheckInEntry, now: string): Person {
  for (let i = person.checkInHistory.length - 1; i >= 0; i--) {
    const prev = person.checkInHistory[i];
    if (!prev || prev.sessionId !== entry.sessionId) continue;
    // Last entry for this session — collapse only if it is the same type.
    if (prev.type === entry.type) return person;
    break;
  }
  return {
    ...person,
    checkInHistory: [...person.checkInHistory, entry],
    updatedAt: now,
  };
}

/** Append a sign-out/sign-in event and apply the resulting transition immutably. */
export function withSignEvent(person: Person, event: SignOutEvent, now: string): Person {
  const next = applyCheckIn(person, event.type === 'in' ? 'in' : 'out');
  return {
    ...person,
    signOutHistory: [...person.signOutHistory, event],
    lifecycle: next.lifecycle,
    atCamp: next.atCamp,
    updatedAt: now,
  };
}
