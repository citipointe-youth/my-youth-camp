import type { IPersonRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { canAccessPerson } from './person.service';
import { toRosterEntry, type RosterEntry } from '../api/dto/person.dto';
import { NotFoundError, ForbiddenError } from '../core/errors/app-error';
import { zonedNow } from '../utils/date';
import {
  allowedWindowSession,
  buildSessions,
  currentSession as pickCurrentSession,
  parseSessionId,
  sessionFor,
  type CheckInSession,
} from './checkin-sessions';

export type { CheckInSession } from './checkin-sessions';

const DEFAULT_TZ = 'Australia/Brisbane';

export interface SessionStatus {
  session: CheckInSession;
  roster: RosterEntry[];
  checkedInCount: number;
  totalCount: number;
}

/** What `assertSessionAllowed` would decide right now, without throwing — so the UI can grey
 * out controls a write would reject instead of letting a leader tap into a 403. */
export interface AllowedSession {
  /** The one session this actor may write to right now, or null if none. */
  session: CheckInSession | null;
  /** False = the window rule doesn't apply to this actor at all (any session is writable). */
  restricted: boolean;
  /** Why `session` is null, phrased for a leader. Null whenever a session is allowed. */
  reason: string | null;
}

export interface CheckInService {
  getSessions(): Promise<CheckInSession[]>;
  /** ⚠ NAVIGATION ONLY — "which session should the screen open on". Once camp dates exist this
   * NEVER returns null (it falls back to the nearest past/upcoming session), so it must NOT be
   * used to decide whether a check-in is permitted. Use `getAllowedSession` for that. */
  getCurrentSession(): Promise<CheckInSession | null>;
  getSessionStatus(actor: Actor, sessionId: string): Promise<SessionStatus>;
  /** The write rule, as data. Same code path as `assertSessionAllowed` — never a second copy. */
  getAllowedSession(actor: Actor): Promise<AllowedSession>;
  /** Throws if a church account is submitting a check-in outside its permitted window while
   * the "restrict church check-in" setting is on. No-op for every other role, and a no-op
   * when the setting is off. */
  assertSessionAllowed(actor: Actor, sessionId: string): Promise<void>;
}

// Sessions come from the camp's check-in days (settings), NOT the schedule — two per
// day (Morning / Afternoon). See checkin-sessions.ts for the rationale.
export function makeCheckInService(
  personRepo: IPersonRepository,
  settingsRepo: ISettingsRepository,
): CheckInService {
  async function ctx(): Promise<{ days: string[]; tz: string }> {
    const settings = await settingsRepo.getSingleton();
    return { days: settings?.checkInDays ?? [], tz: settings?.timezone || DEFAULT_TZ };
  }

  const UNRESTRICTED: AllowedSession = { session: null, restricted: false, reason: null };

  // The single implementation of the item-11 window rule. `assertSessionAllowed` (the server-side
  // gate) and `GET /checkin/sessions/allowed` (what the SPA greys its roster on) both come through
  // here, so the button a leader sees can never disagree with the write that follows it.
  async function allowedSession(actor: Actor): Promise<AllowedSession> {
    if (actor.role !== 'church') return UNRESTRICTED;
    const settings = await settingsRepo.getSingleton();
    if (!settings?.churchCheckinTimeRestricted) return UNRESTRICTED;
    const { days, tz } = await ctx();
    const { date, time } = zonedNow(tz);
    const windows = {
      amStart: settings.checkinWindowAmStart ?? '06:00',
      amEnd: settings.checkinWindowAmEnd ?? '12:00',
      pmStart: settings.checkinWindowPmStart ?? '12:00',
      pmEnd: settings.checkinWindowPmEnd ?? '22:00',
    };
    const session = allowedWindowSession(days, date, time, windows);
    return {
      session,
      restricted: true,
      reason: session
        ? null
        : `Check-in is closed right now — the morning window is ${windows.amStart}–${windows.amEnd} and the afternoon window is ${windows.pmStart}–${windows.pmEnd}, on camp days only.`,
    };
  }

  return {
    getAllowedSession: allowedSession,

    async getSessions() {
      const { days } = await ctx();
      return buildSessions(days);
    },

    async getCurrentSession() {
      const { days, tz } = await ctx();
      const { date, time } = zonedNow(tz);
      return pickCurrentSession(days, date, time);
    },

    async getSessionStatus(actor, sessionId) {
      assertCan(actor, 'checkin:write');
      const parsed = parseSessionId(sessionId);
      const { days } = await ctx();
      if (!parsed || !days.includes(parsed.day)) throw new NotFoundError('Session not found');

      const session = sessionFor(parsed.day, parsed.sfx);
      const allPeople = await personRepo.findAll();
      // Leaders are never on the twice-daily check-in roster (they're presence-tracked via
      // attendance sign-in/out on My Youth instead, not this session-based flow) — even
      // though they may well be atCamp (bulk-signed-in when the mode switches to at-camp).
      const scoped = allPeople.filter((p) => p.atCamp && p.kind !== 'leader' && canAccessPerson(actor, p));
      const roster: RosterEntry[] = scoped.map((p) => toRosterEntry(p, sessionId));
      const checkedInCount = roster.filter((r) => r.checkedIn).length;

      return { session, roster, checkedInCount, totalCount: roster.length };
    },

    async assertSessionAllowed(actor, sessionId) {
      const { session, restricted, reason } = await allowedSession(actor);
      if (!restricted) return;
      if (!session) throw new ForbiddenError(reason as string);
      if (sessionId !== session.id) {
        throw new ForbiddenError(`Check-in is currently limited to the ${session.label} session.`);
      }
    },
  };
}
