import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';
import { allowedWindowSession } from './checkin-sessions';
import { canAccessPerson } from './person.service';
import { toActor } from './auth.service';
import { zonedNow } from '../utils/date';

/** Mirrors checkin.service.ts — must stay byte-identical or reminder and enforcement disagree. */
const DEFAULT_TZ = 'Australia/Brisbane';
/** How long before a window closes to warn. Design D4. */
export const WARN_LEAD_MINUTES = 60;

export interface ChurchBehind {
  userId: string;
  churchId: string;
  sessionId: string;
  sessionLabel: string;
  remaining: number;
  /** 'HH:MM' — the closing time, for the notice copy. */
  windowEnd: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Checked-in for a session, matching `toRosterEntry` in src/api/dto/person.dto.ts EXACTLY:
 * the LAST entry for that session wins. A student checked in and then out is NOT checked in.
 * Diverging from this makes the push count disagree with the roster the leader is reading.
 */
function isCheckedIn(p: Person, sessionId: string): boolean {
  const entries = p.checkInHistory.filter((e) => e.sessionId === sessionId);
  const last = entries[entries.length - 1];
  return last?.type === 'in';
}

/**
 * Which church LOGINS still have students unchecked for a session whose window closes within
 * WARN_LEAD_MINUTES?
 *
 * Per LOGIN, not per church: church accounts are gender-scoped (`b-`/`g-`), so `b-victory`
 * must only ever be told about students it can actually see and act on.
 *
 * Pure — no repositories, no `new Date()`. `now` is injected so the timezone boundary is
 * testable, which matters: this codebase has been bitten by UTC-vs-Brisbane twice.
 */
export function churchesBehind(
  settings: CampSettings,
  people: Person[],
  users: User[],
  now: Date,
): ChurchBehind[] {
  // D4 condition 1: with the restriction off, the window times exist but are not a real
  // deadline, so "closing soon" would be misleading.
  if (!settings.churchCheckinTimeRestricted) return [];

  const tz = settings.timezone || DEFAULT_TZ;
  const days = settings.checkInDays ?? [];
  const { date, time } = zonedNow(tz, now);

  // Resolve windows IDENTICALLY to checkin.service.assertSessionAllowed.
  const windows = {
    amStart: settings.checkinWindowAmStart ?? '06:00',
    amEnd: settings.checkinWindowAmEnd ?? '12:00',
    pmStart: settings.checkinWindowPmStart ?? '12:00',
    pmEnd: settings.checkinWindowPmEnd ?? '22:00',
  };

  // The one session currently open. Returns null off a camp day, outside both windows, or —
  // via buildSessions/AC-1 — when the day simply has no session of that half (first camp day
  // is PM-only, last day is AM-only). That null is what stops us inventing a phantom session.
  const session = allowedWindowSession(days, date, time, windows);
  if (!session) return [];

  const windowEnd = session.id.endsWith('~am') ? windows.amEnd : windows.pmEnd;
  const minutesLeft = toMinutes(windowEnd) - toMinutes(time);
  if (minutesLeft <= 0 || minutesLeft > WARN_LEAD_MINUTES) return [];

  // Same roster population as checkin.service.getSessionStatus: present, non-leader.
  const roster = people.filter((p) => p.atCamp && p.kind !== 'leader');

  const out: ChurchBehind[] = [];
  for (const u of users) {
    if (u.role !== 'church') continue;
    if (u.status !== 'active') continue;
    if (!u.churchId) continue;

    const actor = toActor(u);
    const remaining = roster.filter(
      (p) => canAccessPerson(actor, p) && !isCheckedIn(p, session.id),
    ).length;

    // D4 condition 4: never send "0 students still to check in".
    if (remaining === 0) continue;

    out.push({
      userId: u.id,
      churchId: u.churchId,
      sessionId: session.id,
      sessionLabel: session.label,
      remaining,
      windowEnd,
    });
  }
  return out;
}
