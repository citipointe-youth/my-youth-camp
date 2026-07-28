import type { INoteRepository, IPersonRepository } from '../repositories/interfaces/entity-repositories';
import type { StudentNote } from '../core/entities/note';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { isCamper, isRegistrant } from '../core/entities/person';
import type { Person } from '../core/entities/person';
import { canAccessPerson } from './person.service';
import { NotFoundError, BadRequestError } from '../core/errors/app-error';
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
  exportRows(actor: Actor): Promise<string>;
}

const FIRSTAID_CATEGORY = 'firstaid';

// A first-aider needs to be able to log/read records against real registrants during
// pre-camp testing too — nobody is a "camper" yet (nothing arrives until the real
// Day-1 sign-in), so the normal isCamper() gate would make first-aid record-keeping
// untestable before the camp actually goes live. Every other role keeps the existing
// arrived-only scope (mirrors the same fallback already used in search.service.ts).
function firstAidEligible(actor: Actor, person: Person): boolean {
  return isCamper(person) || (actor.role === 'firstAid' && isRegistrant(person));
}

export function makeNoteService(
  noteRepo: INoteRepository,
  personRepo: IPersonRepository,
): NoteService {
  return {
    async add(actor, input) {
      const data = AddNoteSchema.parse(input);
      const category = data.category ?? 'note';
      const isFirstAid = category === FIRSTAID_CATEGORY;
      // Category-scoped authorization (Phase 4): a first-aid record needs note:write:firstaid
      // (which firstAid holds WITHOUT general note:write); every other category needs note:write.
      // So a first-aider can ONLY ever create category 'firstaid' notes — never testimonies/notes.
      assertCan(actor, isFirstAid ? 'note:write:firstaid' : 'note:write');
      // A general testimony has no student; only validate/scope when one is given. A first-aid
      // record is ALWAYS about a specific student.
      const camperId = data.camperId && data.camperId.length > 0 ? data.camperId : null;
      if (isFirstAid && !camperId) throw new BadRequestError('A first-aid record requires a camper');
      if (camperId) {
        const camper = await personRepo.findById(camperId);
        if (!camper || !firstAidEligible(actor, camper)) throw new NotFoundError('Camper not found');
        if (!canAccessPerson(actor, camper)) throw new NotFoundError('Camper not found');
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
        sensitive: data.sensitive ?? false,
        createdAt: nowISO(),
      };
      return noteRepo.save(note);
    },

    async forCamper(actor, camperId) {
      assertCan(actor, 'note:write');
      const camper = await personRepo.findById(camperId);
      if (!camper || !isCamper(camper)) throw new NotFoundError('Camper not found');
      if (!canAccessPerson(actor, camper)) throw new NotFoundError('Camper not found');
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
      // Fetch a wide window, then keep ONLY first-aid records the actor may see. Because a
      // first-aid record always has a camperId, canAccessPerson does the per-role scoping
      // (church→own church, zoneLeader→own zone, firstAid/director/admin→all). This path can
      // never leak a testimony or general note: the category filter is applied first.
      const notes = await noteRepo.findRecent(Math.max(limit, 50) * 4);
      const result: StudentNote[] = [];
      for (const note of notes) {
        if ((note.category ?? 'note') !== FIRSTAID_CATEGORY) continue;
        if (!note.camperId) continue; // first-aid records are always about a camper
        const camper = await personRepo.findById(note.camperId);
        if (!camper || !firstAidEligible(actor, camper)) continue;
        if (!canAccessPerson(actor, camper)) continue;
        result.push(note);
        if (result.length >= limit) break;
      }
      return result;
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
