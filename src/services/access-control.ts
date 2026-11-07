import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import { isCamper, isRegistrant } from '../core/entities/person';
import type { NotificationScope, UserRole } from '../core/types/enums';
import { ForbiddenError } from '../core/errors/app-error';

export type Action =
  | 'registrant:read'
  | 'registrant:write'
  // Erase a person and their history. Held apart from registrant:write because a church login,
  // which needs that for edits, must not be able to delete anyone (operator ruling 2026-11-03).
  | 'person:delete'
  | 'reminder:send'
  | 'camper:read'
  | 'camper:read:sensitive'
  | 'checkin:write'
  | 'attendance:write'
  | 'note:write'
  | 'note:read'
  // First-aid records (Phase 4). A first-aid record is a StudentNote with category 'firstaid'.
  // Kept as their own capabilities so firstAid gets first-aid access WITHOUT gaining
  // general note read/write. note.service asserts note:write:firstaid only when category==='firstaid'.
  | 'note:write:firstaid'
  | 'note:read:firstaid'
  // Prayer team (2026-10). A prayer record is a StudentNote with category 'prayer' and is ALWAYS
  // sensitive (forced in note.service). Own capabilities, like first aid, so the prayer team gets
  // prayer access without general note read/write.
  | 'note:write:prayer'
  | 'note:read:prayer'
  // Read every note on ONE student the actor opens (GET /notes/camper/:id) — no camp-wide feed or
  // export. Held by the prayer team only; church/zoneLeader/director/admin reach that endpoint via note:write.
  | 'note:read:student'
  | 'notification:send:zone'
  | 'notification:send:camp'
  | 'import:run'
  | 'allocation:manage'
  // Incidents (Feature 3). Holders can BOTH log and view incidents — zoneLeader + director + admin.
  | 'incident:manage'
  // Camp-wide compliance exports (master audit workbook, sign-in/out + check-in CSV). These bundle
  // every person's sensitive data (medical, contacts, notes, incidents, temp passwords) across the
  // whole camp, so they are director + admin ONLY — NOT church/zoneLeader, who hold camper:read*.
  | 'export:compliance'
  | 'admin:manage'
  // Discount-code "paid in full" override amounts (budget). Narrowly scoped — director should be
  // able to manage these without gaining general settings editing (admin:manage).
  | 'budget:manage'
  // A church setting its OWN ministry leader contacts (2026-07-31, owner request). Deliberately
  // its own capability rather than widening admin:manage: it grants ONLY the `contacts` field of
  // ONE church, and account.service.updateChurchContacts re-checks that the church is the
  // actor's own. Holding it must never imply any other church-record editing.
  | 'church:contacts:write';

const ROLE_PERMISSIONS: Record<UserRole, Set<Action>> = {
  // church is the shared per-church login — handles both pre-camp registrations and at-camp check-in
  church: new Set<Action>([
    'registrant:read',
    'registrant:write',
    'reminder:send',
    'camper:read',
    'camper:read:sensitive',
    'checkin:write',
    'attendance:write',
    'note:write',
    // No first-aid read or write (operator ruling 2026-11-03, reversing Phase 4 decision Q3).
    // note.service.forCamper filters first-aid records from the profile notes this role can read.
    'church:contacts:write',
  ]),
  zoneLeader: new Set<Action>([
    'registrant:read',
    'camper:read',
    'camper:read:sensitive',
    'checkin:write',
    'attendance:write',
    'note:write',
    'note:read',
    'note:read:firstaid',
    'notification:send:zone',
    'incident:manage',
  ]),
  director: new Set<Action>([
    'registrant:read',
    'registrant:write',
    'person:delete',
    'reminder:send',
    'camper:read',
    'camper:read:sensitive',
    'checkin:write',
    'attendance:write',
    'note:write',
    'note:write:firstaid',
    'note:read',
    'note:read:firstaid',
    'note:write:prayer',
    'note:read:prayer',
    'notification:send:zone',
    'notification:send:camp',
    'import:run',
    'allocation:manage',
    'incident:manage',
    'church:contacts:write',
    'export:compliance',
    'budget:manage',
  ]),
  admin: new Set<Action>([
    'registrant:read',
    'registrant:write',
    'person:delete',
    'reminder:send',
    'camper:read',
    'camper:read:sensitive',
    'checkin:write',
    'attendance:write',
    'note:write',
    'note:write:firstaid',
    'note:read',
    'note:read:firstaid',
    'note:write:prayer',
    'note:read:prayer',
    'notification:send:zone',
    'notification:send:camp',
    'import:run',
    'allocation:manage',
    'incident:manage',
    'export:compliance',
    'admin:manage',
    'budget:manage',
    'church:contacts:write',
  ]),
  // firstAid: read-only at-camp access PLUS first-aid record logging (Phase 4).
  // No registrant:read (pre-camp hub is not accessible). attendance:write allows attendance
  // sign-in/out only. checkin:write is intentionally withheld — firstAid must not record daily
  // session entries, only physical presence events. note:write:firstaid lets it log first-aid
  // records (category 'firstaid' only — enforced in note.service); note:read:firstaid lets it
  // read them. firstAid does NOT get general note:write/note:read (no testimonies/general notes).
  // Cannot send notifications — canSendNotification() returns false via default paths (intentional).
  firstAid: new Set<Action>([
    'camper:read',
    'camper:read:sensitive',
    'attendance:write',
    'note:write:firstaid',
    'note:read:firstaid',
  ]),
  // prayer: find a student, see the leader to contact and every note on that student, and record a
  // prayer/disclosure (category 'prayer', forced sensitive). No camper:read:sensitive (no Medicare/
  // parent reveal), no attendance/check-in, no camp-wide notes feed, no notifications.
  prayer: new Set<Action>([
    'camper:read',
    'note:write:prayer',
    'note:read:prayer',
    'note:read:student',
  ]),
};

export function can(actor: Actor, action: Action): boolean {
  return ROLE_PERMISSIONS[actor.role]?.has(action) ?? false;
}

export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) {
    throw new ForbiddenError(`Role '${actor.role}' cannot perform '${action}'`);
  }
}

/** admin or director: the camp-wide oversight roles. */
export function isOversight(actor: Pick<Actor, 'role'>): boolean {
  return actor.role === 'admin' || actor.role === 'director';
}

/**
 * THE scope switch (A1): may this actor see data belonging to this church / zone / gender?
 * - admin, director, firstAid, prayer: everything.
 * - zoneLeader: only its own zone (an actor or target with no zone is out of scope).
 * - church: only its own church.
 * - Then, for a gender-scoped church login (b-/g-, Feature 2): denied only for a person of the
 *   CONCRETE opposite gender. Someone recorded as 'other' (or with an unset gender, e.g. a blank
 *   Elvanto import) stays visible to BOTH of a church's logins so no minor is left without a
 *   church-level custodian. A target with no `gender` key (a church, a pre-create check) skips it.
 */
export function inScope(
  actor: Actor,
  target: { churchId: string; zone?: string | null; gender?: Person['gender'] },
): boolean {
  let ok: boolean;
  switch (actor.role) {
    case 'admin':
    case 'director':
    case 'firstAid':
    case 'prayer':
      ok = true; break;
    case 'zoneLeader':
      ok = !!actor.zone && actor.zone === target.zone; break;
    case 'church':
      ok = actor.churchId === target.churchId; break;
    default:
      ok = false;
  }
  if (!ok) return false;
  const g = target.gender;
  return !(actor.genderScope && (g === 'male' || g === 'female') && g !== actor.genderScope);
}

/**
 * True if the actor may access a person, by role + church/zone + gender (see `inScope`).
 * The single chokepoint for person scoping: list/get/roster (checkin.service), the queued
 * check-in and sign events, search, notes and the dashboards all filter through here.
 */
export function canAccessPerson(
  actor: Actor,
  person: Pick<Person, 'churchId' | 'zone'> & Partial<Pick<Person, 'gender'>>,
): boolean {
  return inScope(actor, person);
}

/** True if the actor can access data for the given church (zoneLeader needs the church's zone). */
export function canAccessChurch(actor: Actor, churchId: string, churchZone?: string): boolean {
  return inScope(actor, { churchId, zone: churchZone });
}

/**
 * How far an actor reaches a person on the at-camp lookup surfaces (search, notes, contacts):
 * - 'full': in scope, AND the person has arrived — or is a registrant and the actor is firstAid
 *   or prayer (they log and read records during pre-camp testing too; nobody is a camper until
 *   the Day-1 sign-in).
 * - 'locate': out of scope, but a church or zone leader may find any arrived camper to reach that
 *   camper's church leaders (items 6/7/10). Sensitive fields are redacted; no parent number.
 * - 'none': otherwise.
 */
export function reach(actor: Actor, person: Person): 'full' | 'locate' | 'none' {
  if (inScope(actor, person)) {
    const eligible = isCamper(person) || ((actor.role === 'firstAid' || actor.role === 'prayer') && isRegistrant(person));
    return eligible ? 'full' : 'none';
  }
  return (actor.role === 'church' || actor.role === 'zoneLeader') && isCamper(person) ? 'locate' : 'none';
}

export function assertCanAccessChurch(actor: Actor, churchId: string, churchZone?: string): void {
  if (!canAccessChurch(actor, churchId, churchZone)) {
    throw new ForbiddenError('Access denied to this church');
  }
}

/**
 * Returns true if actor can send a notification with the given scope/zone.
 */
export function canSendNotification(actor: Actor, scope: NotificationScope, zone?: string | null): boolean {
  if (scope === 'camp') {
    return can(actor, 'notification:send:camp');
  }
  if (scope === 'zone') {
    if (!can(actor, 'notification:send:zone')) return false;
    if (actor.role === 'zoneLeader') {
      return !zone || actor.zone === zone;
    }
    return true;
  }
  if (scope === 'church') {
    // Church-scoped notifications: church to own church, director/admin to any
    if (isOversight(actor)) return true;
    return false;
  }
  return false;
}

export function assertCanSendNotification(actor: Actor, scope: NotificationScope, zone?: string | null): void {
  if (!canSendNotification(actor, scope, zone)) {
    throw new ForbiddenError(`Cannot send '${scope}' notification`);
  }
}
