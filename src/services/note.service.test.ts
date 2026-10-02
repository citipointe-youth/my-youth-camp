import { describe, it, expect, beforeEach } from 'vitest';
import { makeNoteService } from './note.service';
import { InMemoryNoteRepository, InMemoryPersonRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import { ForbiddenError, BadRequestError, NotFoundError } from '../core/errors/app-error';

// ---------------------------------------------------------------------------
// NoteService — Phase 4 first-aid records.
// Pins the RBAC matrix that is the whole point of the feature:
//   * firstAid can WRITE category 'firstaid' notes, but NOT general notes/testimonies.
//   * firstAid/zoneLeader/director/admin/church can READ first-aid records via recentFirstAid,
//     each scoped by canAccessPerson; the path NEVER returns testimonies or general notes.
//   * church reads ONLY its own church's first-aid records, and cannot write them.
// ---------------------------------------------------------------------------

function person(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'p',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    medicalConditions: [],
    dietaryRequirements: [],
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid',
    needsReview: false,
    lifecycle: 'arrived', // a camper (at camp) by default so notes attach
    atCamp: true,
    checkInHistory: [],
    signOutHistory: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

let notes: InMemoryNoteRepository;
let people: InMemoryPersonRepository;
let svc: ReturnType<typeof makeNoteService>;

beforeEach(async () => {
  notes = new InMemoryNoteRepository();
  await notes.init();
  people = new InMemoryPersonRepository();
  await people.init();
  // c1 (Yellow) and c2 (Blue) campers.
  await people.save(person({ id: 'cam1', churchId: 'c1', zone: 'Yellow' }));
  await people.save(person({ id: 'cam2', churchId: 'c2', churchName: 'Grace', zone: 'Blue' }));
  svc = makeNoteService(notes, people);
});

describe('note.service: first-aid write authorization (category-scoped)', () => {
  it('firstAid CAN create a category:firstaid note about a camper', async () => {
    const note = await svc.add(actor('firstAid'), {
      camperId: 'cam1',
      category: 'firstaid',
      body: 'Problem: grazed knee\nTreatment: cleaned & dressed',
    });
    expect(note.category).toBe('firstaid');
    expect(note.camperId).toBe('cam1');
    expect(note.authorId).toBe('u'); // server-attributed
  });

  it('firstAid CANNOT create a general note (category note) — ForbiddenError', async () => {
    await expect(
      svc.add(actor('firstAid'), { camperId: 'cam1', category: 'note', body: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('firstAid CANNOT create a testimony — ForbiddenError', async () => {
    await expect(
      svc.add(actor('firstAid'), { camperId: 'cam1', category: 'testimony', body: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('firstAid CANNOT create a note with no category (defaults to note) — ForbiddenError', async () => {
    await expect(
      svc.add(actor('firstAid'), { camperId: 'cam1', body: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('a first-aid record REQUIRES a camper — BadRequestError when missing', async () => {
    await expect(
      svc.add(actor('firstAid'), { category: 'firstaid', body: 'x' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('church CANNOT write a first-aid record (read-only on first-aid) — ForbiddenError', async () => {
    await expect(
      svc.add(actor('church', { churchId: 'c1' }), { camperId: 'cam1', category: 'firstaid', body: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('admin and director CAN write a first-aid record', async () => {
    await expect(
      svc.add(actor('admin'), { camperId: 'cam1', category: 'firstaid', body: 'x' }),
    ).resolves.toMatchObject({ category: 'firstaid' });
    await expect(
      svc.add(actor('director'), { camperId: 'cam1', category: 'firstaid', body: 'y' }),
    ).resolves.toMatchObject({ category: 'firstaid' });
  });

  it('firstAid writing about a camper still respects canAccessPerson (all access) but rejects unknown camper', async () => {
    await expect(
      svc.add(actor('firstAid'), { camperId: 'nope', category: 'firstaid', body: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('note.service: pre-camp first-aid testing (registered, not-yet-arrived)', () => {
  beforeEach(async () => {
    await people.save(person({ id: 'reg1', churchId: 'c1', zone: 'Yellow', lifecycle: 'registered', atCamp: false }));
  });

  it('firstAid CAN create a first-aid record about a registered (not-yet-arrived) person', async () => {
    const note = await svc.add(actor('firstAid'), {
      camperId: 'reg1',
      category: 'firstaid',
      body: 'Problem: test run\nTreatment: n/a',
    });
    expect(note.category).toBe('firstaid');
    expect(note.camperId).toBe('reg1');
  });

  it('firstAid then sees that record via recentFirstAid', async () => {
    await svc.add(actor('firstAid'), { camperId: 'reg1', category: 'firstaid', body: 'x' });
    const recs = await svc.recentFirstAid(actor('firstAid'));
    expect(recs.map((n) => n.camperId)).toContain('reg1');
  });

  it('admin/director CANNOT create any note about a not-yet-arrived person — NotFoundError', async () => {
    await expect(
      svc.add(actor('admin'), { camperId: 'reg1', category: 'firstaid', body: 'x' }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      svc.add(actor('director'), { camperId: 'reg1', category: 'firstaid', body: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('admin does NOT see a firstAid-only pre-camp record via recentFirstAid (not a camper for them)', async () => {
    await svc.add(actor('firstAid'), { camperId: 'reg1', category: 'firstaid', body: 'x' });
    const recs = await svc.recentFirstAid(actor('admin'));
    expect(recs.map((n) => n.camperId)).not.toContain('reg1');
  });

  it('a cancelled person is still never eligible, even for firstAid', async () => {
    await people.save(person({ id: 'cancelled1', churchId: 'c1', zone: 'Yellow', lifecycle: 'cancelled', atCamp: false }));
    await expect(
      svc.add(actor('firstAid'), { camperId: 'cancelled1', category: 'firstaid', body: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('note.service: recentFirstAid read scoping', () => {
  beforeEach(async () => {
    // Seed a mix of categories across two churches.
    await svc.add(actor('firstAid'), { camperId: 'cam1', category: 'firstaid', body: 'Problem: A\nTreatment: a' });
    await svc.add(actor('firstAid'), { camperId: 'cam2', category: 'firstaid', body: 'Problem: B\nTreatment: b' });
    await svc.add(actor('admin'), { camperId: 'cam1', category: 'testimony', body: 'a testimony' });
    await svc.add(actor('admin'), { camperId: 'cam2', category: 'note', body: 'a general note' });
  });

  it('firstAid sees ALL first-aid records and NO testimonies/general notes', async () => {
    const recs = await svc.recentFirstAid(actor('firstAid'));
    expect(recs).toHaveLength(2);
    expect(recs.every((n) => n.category === 'firstaid')).toBe(true);
  });

  it('admin sees all first-aid records (and only first-aid via this path)', async () => {
    const recs = await svc.recentFirstAid(actor('admin'));
    expect(recs).toHaveLength(2);
    expect(recs.every((n) => n.category === 'firstaid')).toBe(true);
  });

  it('church sees ONLY its own church\'s first-aid records', async () => {
    const recs = await svc.recentFirstAid(actor('church', { churchId: 'c1' }));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.camperId).toBe('cam1');
  });

  it('church does NOT see another church\'s first-aid records', async () => {
    const recs = await svc.recentFirstAid(actor('church', { churchId: 'c2' }));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.camperId).toBe('cam2');
  });

  it('zoneLeader is zone-scoped', async () => {
    const yellow = await svc.recentFirstAid(actor('zoneLeader', { zone: 'Yellow' }));
    expect(yellow.map((n) => n.camperId)).toEqual(['cam1']);
    const blue = await svc.recentFirstAid(actor('zoneLeader', { zone: 'Blue' }));
    expect(blue.map((n) => n.camperId)).toEqual(['cam2']);
  });
});

describe('note.service: forCamper sensitive-note filtering (profile view)', () => {
  beforeEach(async () => {
    await svc.add(actor('church', { churchId: 'c1' }), { camperId: 'cam1', category: 'note', body: 'ordinary note' });
    await svc.add(actor('director'), { camperId: 'cam1', category: 'note', body: 'sensitive note', sensitive: true });
    await svc.add(actor('director'), { camperId: 'cam1', category: 'testimony', body: 'sensitive testimony', sensitive: true });
  });

  it('a new note defaults to sensitive:false', async () => {
    const notesForCam1 = await svc.forCamper(actor('admin'), 'cam1');
    const ordinary = notesForCam1.find((n) => n.body === 'ordinary note');
    expect(ordinary?.sensitive).toBe(false);
  });

  it('church does NOT see sensitive notes/testimonies on the profile', async () => {
    const recs = await svc.forCamper(actor('church', { churchId: 'c1' }), 'cam1');
    expect(recs).toHaveLength(1);
    expect(recs[0]?.body).toBe('ordinary note');
  });

  it('zoneLeader, director and admin DO see sensitive notes on the profile', async () => {
    for (const role of ['zoneLeader', 'director', 'admin'] as const) {
      const a = role === 'zoneLeader' ? actor(role, { zone: 'Yellow' }) : actor(role);
      const recs = await svc.forCamper(a, 'cam1');
      expect(recs).toHaveLength(3);
    }
  });
});

describe('note.service: prayer records (write)', () => {
  it('prayer creates a category:prayer note and it is ALWAYS sensitive, even if the client says false', async () => {
    const a = await svc.add(actor('prayer'), { camperId: 'cam1', category: 'prayer', body: 'Recorded by: Sam\nprayed for x', sensitive: false });
    const b = await svc.add(actor('prayer'), { camperId: 'cam1', category: 'prayer', body: 'Recorded by: Sam\nprayed for y' });
    expect(a.category).toBe('prayer');
    expect(a.sensitive).toBe(true);
    expect(b.sensitive).toBe(true);
  });

  it('a prayer record requires a student', async () => {
    await expect(svc.add(actor('prayer'), { category: 'prayer', body: 'x' })).rejects.toThrow(BadRequestError);
  });

  it('prayer cannot create general notes, testimonies or first-aid records', async () => {
    for (const category of ['note', 'testimony', 'firstaid']) {
      await expect(svc.add(actor('prayer'), { camperId: 'cam1', category, body: 'x' })).rejects.toThrow(ForbiddenError);
    }
  });

  it('director can create a prayer record; zoneLeader and church cannot', async () => {
    const n = await svc.add(actor('director'), { camperId: 'cam1', category: 'prayer', body: 'x' });
    expect(n.sensitive).toBe(true);
    await expect(svc.add(actor('zoneLeader', { zone: 'Yellow' }), { camperId: 'cam1', category: 'prayer', body: 'x' })).rejects.toThrow(ForbiddenError);
    await expect(svc.add(actor('church', { churchId: 'c1' }), { camperId: 'cam1', category: 'prayer', body: 'x' })).rejects.toThrow(ForbiddenError);
  });
});

describe('note.service: prayer records (read)', () => {
  beforeEach(async () => {
    await svc.add(actor('church', { churchId: 'c1' }), { camperId: 'cam1', category: 'note', body: 'leader note' });
    await svc.add(actor('director'), { camperId: 'cam1', category: 'note', body: 'sensitive note', sensitive: true });
    await svc.add(actor('firstAid'), { camperId: 'cam1', category: 'firstaid', body: 'Problem: graze\nTreatment: plaster' });
    await svc.add(actor('prayer'), { camperId: 'cam1', category: 'prayer', body: 'Recorded by: Sam\nprayer 1' });
    await svc.add(actor('prayer'), { camperId: 'cam2', category: 'prayer', body: 'Recorded by: Sam\nprayer 2' });
  });

  it('prayer sees EVERY note on the student it opens (leader, sensitive, first-aid, prayer)', async () => {
    const recs = await svc.forCamper(actor('prayer'), 'cam1');
    expect(recs.map((n) => n.body).sort()).toEqual(
      ['Problem: graze\nTreatment: plaster', 'Recorded by: Sam\nprayer 1', 'leader note', 'sensitive note'].sort(),
    );
  });

  it('church does NOT see the prayer record on its own student profile', async () => {
    const recs = await svc.forCamper(actor('church', { churchId: 'c1' }), 'cam1');
    expect(recs.some((n) => n.category === 'prayer')).toBe(false);
  });

  it('zoneLeader sees prayer records for its own zone only (profile + Notes feed)', async () => {
    const yellow = actor('zoneLeader', { zone: 'Yellow' });
    expect((await svc.forCamper(yellow, 'cam1')).some((n) => n.category === 'prayer')).toBe(true);
    const feed = await svc.recent(yellow, 50);
    expect(feed.filter((n) => n.category === 'prayer').map((n) => n.camperId)).toEqual(['cam1']);
  });

  it('prayer cannot read the camp-wide notes feed or the notes export', async () => {
    await expect(svc.recent(actor('prayer'))).rejects.toThrow(ForbiddenError);
    await expect(svc.exportRows(actor('prayer'))).rejects.toThrow(ForbiddenError);
  });

  it('firstAid still cannot read a student profile notes list (regression on the forCamper gate)', async () => {
    await expect(svc.forCamper(actor('firstAid'), 'cam1')).rejects.toThrow(ForbiddenError);
  });

  it('recentPrayer returns ONLY prayer records (all students for prayer), newest first', async () => {
    const recs = await svc.recentPrayer(actor('prayer'));
    expect(recs.every((n) => n.category === 'prayer')).toBe(true);
    expect(recs.map((n) => n.camperId).sort()).toEqual(['cam1', 'cam2']);
  });

  it('recentPrayer is refused for firstAid, church and zoneLeader', async () => {
    await expect(svc.recentPrayer(actor('firstAid'))).rejects.toThrow(ForbiddenError);
    await expect(svc.recentPrayer(actor('church', { churchId: 'c1' }))).rejects.toThrow(ForbiddenError);
    await expect(svc.recentPrayer(actor('zoneLeader', { zone: 'Yellow' }))).rejects.toThrow(ForbiddenError);
  });

  it('recentFirstAid is unchanged: still only first-aid records', async () => {
    const recs = await svc.recentFirstAid(actor('admin'));
    expect(recs.every((n) => n.category === 'firstaid')).toBe(true);
    expect(recs).toHaveLength(1);
  });
});

describe('note.service: prayer pre-camp testing (registered, not-yet-arrived)', () => {
  beforeEach(async () => {
    await people.save(person({ id: 'reg1', churchId: 'c1', zone: 'Yellow', lifecycle: 'registered', atCamp: false }));
  });

  it('prayer can record against, and read notes for, a registered person', async () => {
    await svc.add(actor('prayer'), { camperId: 'reg1', category: 'prayer', body: 'Recorded by: Sam\ntest' });
    const recs = await svc.forCamper(actor('prayer'), 'reg1');
    expect(recs).toHaveLength(1);
  });

  it('other roles keep the arrived-only rule on the profile notes list', async () => {
    await expect(svc.forCamper(actor('zoneLeader', { zone: 'Yellow' }), 'reg1')).rejects.toThrow(NotFoundError);
  });
});
