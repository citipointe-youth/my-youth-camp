import type { Person, CheckInEntry } from '../core/entities/person';

/**
 * The session-roster rule (P2). One copy of "who is on a session's roster" and "is this person
 * checked in for it", shared by the roster DTO (`toRosterEntry`), the push warnings
 * (`churchesBehindFor`), the dashboard's `checkInsDue` and the presence module's N5 dedupe.
 * Diverging copies make the push count disagree with the roster the leader is reading.
 */

/** The LAST check-in entry for this session, or null. "Checked in" is last-entry-wins. */
export function lastEntryFor(p: Person, sessionId: string): CheckInEntry | null {
  for (let i = p.checkInHistory.length - 1; i >= 0; i--) {
    const e = p.checkInHistory[i];
    if (e && e.sessionId === sessionId) return e;
  }
  return null;
}

/** Checked in for the session: its last entry is an 'in' (in -> out reads as not checked in). */
export function isCheckedInFor(p: Person, sessionId: string): boolean {
  return lastEntryFor(p, sessionId)?.type === 'in';
}

/**
 * On the roster for `sessionId`: never a leader (they're presence-tracked by sign-in/out, not
 * this flow); anyone at camp; and, for a PAST session only, someone no longer at camp who has an
 * entry for it (they keep their real roster and counts). In the CURRENT session a signed-out
 * person is off the list (QA item 13). `currentId` is the current session's id, or null.
 */
export function onSessionRoster(p: Person, sessionId: string, currentId: string | null): boolean {
  if (p.kind === 'leader') return false;
  return p.atCamp || (sessionId !== currentId && p.checkInHistory.some((e) => e.sessionId === sessionId));
}
