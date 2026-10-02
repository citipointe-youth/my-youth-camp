import type { INoteRepository, IPersonRepository } from '../repositories/interfaces/entity-repositories';
import type { StudentNote } from '../core/entities/note';
import type { Actor } from '../core/entities/user';
import { assertCan, can } from './access-control';
import { isCamper, isRegistrant } from '../core/entities/person';
import type { Person } from '../core/entities/person';
import { canAccessPerson } from './person.service';
import { NotFoundError, BadRequestError, ForbiddenError } from '../core/errors/app-error';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { toCsvString } from '../utils/csv';
import { z } from 'zod';

/* Bug 19 (2026-07-28) — "Validation failed" when adding a note from the Students screen.
   The SPA posts `sessionId: SEL_SESSION`, and `SEL_SESSION` is genuinely `null` anywhere outside
   the daily check-in screen (it is only set when a session is picked there). Zod's `.optional()`
   accepts `undefined` but NOT `null`, so every note added from a student's profile / the Students
   list was rejected before it reached the service — while the same modal opened from check-in
   worked, which is why it looked intermittent. `.nullish()` accepts both; `?? null` downstream
   already handled the null case. The SPA was fixed to omit the key too — either alone is
   sufficient, both together mean neither side can reintroduce it. */
const AddNoteSchema = z.object({
  // Optional: a testimony may be "general" (no specific student). Empty string is
  // treated as absent.
  camperId: z.string().nullish(),
  body: z.string().min(1).max(2000),
  sessionId: z.string().nullish(),
  category: z.string().max(40).nullish(),
  sensitive: z.boolean().nullish(),
});

export interface NoteService {
  add(actor: Actor, input: unknown): Promise<StudentNote>;
  forCamper(actor: Actor, camperId: string): Promise<StudentNote[]>;
  recent(actor: Actor, limit?: number): Promise<StudentNote[]>;
  /**
   * First-aid records only (category 'firstaid'), newest first, scoped by canAccessPerson.
   * Authorised by note:read:firstaid (firstAid/zoneLeader/director/admin/church). NEVER returns
   * testimonies or general notes — the first-aid Records tab and the church own-church view use this.
   */
  recentFirstAid(actor: Actor, limit?: number): Promise<StudentNote[]>;
  /** Prayer records only (category 'prayer'), newest first, scoped by canAccessPerson. note:read:prayer. */
  recentPrayer(actor: Actor, limit?: number): Promise<StudentNote[]>;
  exportRows(actor: Actor): Promise<string>;
}

const FIRSTAID_CATEGORY = 'firstaid';
const PRAYER_CATEGORY = 'prayer';

// First aid and the prayer team must be able to log/read records against real registrants during
// pre-camp testing too — nobody is a "camper" until the Day-1 sign-in. Every other role keeps the
// arrived-only scope (mirrors search.service.ts).
function preCampEligible(actor: Actor, person: Person): boolean {
  return isCamper(person) || ((actor.role === 'firstAid' || actor.role === 'prayer') && isRegistrant(person));
}

export function makeNoteService(
  noteRepo: INoteRepository,
  personRepo: IPersonRepository,
): NoteService {
  // Category-only read (first aid / prayer): fetch a wide window, keep ONLY that category, scoped by
  // canAccessPerson. Both categories always carry a camperId. Can never leak another category.
  async function recentInCategory(actor: Actor, category: string, limit: number): Promise<StudentNote[]> {
    const notes = await noteRepo.findRecent(Math.max(limit, 50) * 4);
    const result: StudentNote[] = [];
    for (const note of notes) {
      if ((note.category ?? 'note') !== category) continue;
      if (!note.camperId) continue;
      const camper = await personRepo.findById(note.camperId);
      if (!camper || !preCampEligible(actor, camper)) continue;
      if (!canAccessPerson(actor, camper)) continue;
      result.push(note);
      if (result.length >= limit) break;
    }
    return result;
  }

  return {
    async add(actor, input) {
      const data = AddNoteSchema.parse(input);
      const category = data.category ?? 'note';
      const isFirstAid = category === FIRSTAID_CATEGORY;
      const isPrayer = category === PRAYER_CATEGORY;
      // Category-scoped authorization (Phase 4 + prayer): a first-aid record needs
      // note:write:firstaid (which firstAid holds WITHOUT general note:write), a prayer record
      // needs note:write:prayer; every other category needs note:write. So a first-aider/prayer
      // team member can ONLY ever create their own category of notes — never testimonies/notes.
      assertCan(actor, isFirstAid ? 'note:write:firstaid' : isPrayer ? 'note:write:prayer' : 'note:write');
      // A general testimony has no student; only validate/scope when one is given. A first-aid
      // or prayer record is ALWAYS about a specific student.
      const camperId = data.camperId && data.camperId.length > 0 ? data.camperId : null;
      if (isFirstAid && !camperId) throw new BadRequestError('A first-aid record requires a camper');
      if (isPrayer && !camperId) throw new BadRequestError('A prayer record requires a student');
      if (camperId) {
        const camper = await personRepo.findById(camperId);
        if (!camper || !preCampEligible(actor, camper)) throw new NotFoundError('Student not found');
        if (!canAccessPerson(actor, camper)) throw new NotFoundError('Student not found');
      }

      const note: StudentNote = {
        id: newId('note'),
        camperId,
        body: data.body,
        authorId: actor.id,
        authorName: actor.displayName,
        authorChurchId: actor.churchId,
        sessionId: data.sessionId ?? null,
        category,
        // A prayer record is ALWAYS sensitive (owner decision 2026-10-02) — never trust the client.
        sensitive: isPrayer ? true : data.sensitive ?? false,
        createdAt: nowISO(),
      };
      return noteRepo.save(note);
    },

    async forCamper(actor, camperId) {
      // church/zoneLeader/director/admin reach the profile notes list via note:write (unchanged);
      // the prayer team via note:read:student (read-only, one student at a time).
      if (!can(actor, 'note:write') && !can(actor, 'note:read:student')) {
        throw new ForbiddenError(`Role '${actor.role}' cannot read student notes`);
      }
      const camper = await personRepo.findById(camperId);
      if (!camper || !preCampEligible(actor, camper)) throw new NotFoundError('Student not found');
      if (!canAccessPerson(actor, camper)) throw new NotFoundError('Student not found');
      const notes = await noteRepo.findByCamper(camperId);
      // A sensitive note is hidden from the individual student-profile view for church
      // logins only — zoneLeader/director/admin (who also reach this via openCamper) still
      // see it. This is the only surface a church login can read notes on (church holds
      // note:write but not the broader note:read used by the Notes tab/export).
      return actor.role === 'church' ? notes.filter((n) => !n.sensitive) : notes;
    },

    async recent(actor, limit = 20) {
      assertCan(actor, 'note:read');
      const notes = await noteRepo.findRecent(limit * 3); // fetch more, then filter
      const result: StudentNote[] = [];
      for (const note of notes) {
        if (note.camperId) {
          const camper = await personRepo.findById(note.camperId);
          if (!camper || !isCamper(camper)) continue;
          if (!canAccessPerson(actor, camper)) continue;
        }
        // General (camper-less) testimonies have no church to scope to — visible to
        // anyone with note:read (zoneLeader/director/admin).
        result.push(note);
        if (result.length >= limit) break;
      }
      return result;
    },

    async recentFirstAid(actor, limit = 50) {
      assertCan(actor, 'note:read:firstaid');
      return recentInCategory(actor, FIRSTAID_CATEGORY, limit);
    },

    async recentPrayer(actor, limit = 50) {
      assertCan(actor, 'note:read:prayer');
      return recentInCategory(actor, PRAYER_CATEGORY, limit);
    },

    async exportRows(actor) {
      assertCan(actor, 'note:read');
      const notes = await noteRepo.findAll();
      const headers = ['Time', 'Student', 'Logged by', 'Church', 'Gender', 'Grade', 'Category', 'Note'];
      const rows: string[][] = [];
      for (const note of notes) {
        let camper = null;
        if (note.camperId) {
          camper = await personRepo.findById(note.camperId);
          if (!camper || !isCamper(camper)) continue;
          if (!canAccessPerson(actor, camper)) continue;
        }
        rows.push([
          note.createdAt,
          camper ? `${camper.firstName} ${camper.lastName}` : 'No specific student',
          note.authorName,
          camper?.churchName ?? '',
          camper?.gender ?? '',
          camper?.grade != null ? String(camper.grade) : '',
          note.category ?? 'note',
          note.body,
        ]);
      }
      return toCsvString(headers, rows);
    },
  };
}
