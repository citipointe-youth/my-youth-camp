import { describe, it, expect, beforeEach } from 'vitest';
import { makeImportService } from './import.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';
import { ForbiddenError, BadRequestError } from '../core/errors/app-error';
import { UNALLOCATED_CHURCH_ID } from './church-allocation';

// ---------------------------------------------------------------------------
// ImportService tests — focus on the C1 fix: church/camper indexing, in-file
// dedup (last row wins), batched write, and correct created/updated/skipped counts.
// ---------------------------------------------------------------------------

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

function church(over: Partial<Church>): Church {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'c1', name: 'Victory', zone: 'Yellow',
    contacts: { male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } }, female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } } },
    createdAt: now, updatedAt: now, ...over,
  };
}

async function build(churches: Church[] = [church({ id: 'c1', name: 'Victory' })]) {
  const personRepo = new InMemoryPersonRepository();
  const churchRepo = new InMemoryChurchRepository();
  const overrideRepo = new InMemoryAllocationOverrideRepository();
  await personRepo.init();
  await churchRepo.init();
  await overrideRepo.init();
  for (const c of churches) await churchRepo.save(c);
  const svc = makeImportService(personRepo, churchRepo, overrideRepo);
  return { svc, personRepo, churchRepo, overrideRepo };
}

describe('ImportService.importCsv — RBAC + validation', () => {
  it('forbids roles without import:run (church, zoneLeader)', async () => {
    const { svc } = await build();
    for (const role of ['church', 'zoneLeader'] as const) {
      await expect(svc.importCsv(actor(role), { csvData: 'First Name,Last Name\nA,B' })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('throws BadRequest when there are no data rows', async () => {
    const { svc } = await build();
    await expect(svc.importCsv(actor('admin'), { csvData: 'First Name,Last Name' })).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('ImportService.importCsv — create / counts', () => {
  let h: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { h = await build(); });

  it('creates new campers and resolves churchId by church name', async () => {
    const csv = 'First Name,Last Name,Church,Zone,Grade\nAda,Lovelace,Victory,Yellow,9\nGrace,Hopper,Victory,Yellow,8';
    const res = await h.svc.importCsv(actor('admin'), { csvData: csv });
    expect(res).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    const all = await h.personRepo.findAll();
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.churchId === 'c1')).toBe(true);
  });

  it('records an error + skip for a row missing a name', async () => {
    const csv = 'First Name,Last Name,Church\nAda,,Victory\nGrace,Hopper,Victory';
    const res = await h.svc.importCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.row).toBe(2);
  });

  it('C1: de-duplicates rows for the same person in one file (last row wins, one create)', async () => {
    const csv = 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,9\nAda,Lovelace,Victory,11';
    const res = await h.svc.importCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(1); // not 2 — same person de-duped
    const all = await h.personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.grade).toBe(11); // last row wins
  });

  it('title-cases an ALL-CAPS name on import (JOHN SMITH -> John/Smith)', async () => {
    const csv = 'First Name,Last Name,Church,Grade\nJOHN,SMITH,Victory,9';
    const res = await h.svc.importCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(1);
    const all = await h.personRepo.findAll();
    expect(all[0]!.firstName).toBe('John');
    expect(all[0]!.lastName).toBe('Smith');
  });
});

describe('ImportService.importCsv — same-name disambiguation by phone', () => {
  let h: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { h = await build(); });

  it('creates TWO people with the same name in the same church when phones differ', async () => {
    const csv =
      'First Name,Last Name,Church,Mobile,Grade\n' +
      'Sam,Lee,Victory,0400 111 111,9\n' +
      'Sam,Lee,Victory,0400 222 222,11';
    const res = await h.svc.importCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(2); // distinct phones => two distinct people
    expect((await h.personRepo.findAll())).toHaveLength(2);
  });

  it('treats same name + same church + same phone as ONE person (collapsed)', async () => {
    const csv =
      'First Name,Last Name,Church,Mobile,Grade\n' +
      'Sam,Lee,Victory,0400 111 111,9\n' +
      'Sam,Lee,Victory,0400111111,11'; // same digits, different formatting
    const res = await h.svc.importCsv(actor('admin'), { csvData: csv });
    expect(res.created).toBe(1);
    const all = await h.personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.grade).toBe(11);
  });

  it('a single existing person updates even when the re-import omits the phone', async () => {
    await h.svc.importCsv(actor('admin'), { csvData: 'First Name,Last Name,Church,Mobile,Grade\nAda,Lovelace,Victory,0400 999 999,9' });
    const res = await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,12', // no Mobile column
      updateExisting: true,
    });
    expect(res).toMatchObject({ created: 0, updated: 1 });
    const all = await h.personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.grade).toBe(12);
  });

  it('updates the phone-matching twin and deletes the absent twin on re-import', async () => {
    await h.svc.importCsv(actor('admin'), {
      csvData:
        'First Name,Last Name,Church,Mobile,Grade\n' +
        'Sam,Lee,Victory,0400 111 111,9\n' +
        'Sam,Lee,Victory,0400 222 222,9',
    });
    const res = await h.svc.importCsv(actor('admin'), {
      // Only 0400 222 222 in the CSV — 0400 111 111 is absent and should be deleted
      csvData: 'First Name,Last Name,Church,Mobile,Grade\nSam,Lee,Victory,0400 222 222,12',
      updateExisting: true,
    });
    // The absent twin (0400 111 111) is deleted; deleted count reflects it
    expect(res).toMatchObject({ created: 0, updated: 1, deleted: 1 });
    const all = await h.personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.grade).toBe(12); // the phone-matched twin updated
  });
});

describe('ImportService.importCsv — updateExisting', () => {
  it('skips an existing camper when updateExisting is false', async () => {
    const h = await build();
    await h.svc.importCsv(actor('admin'), { csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,9' });
    const res = await h.svc.importCsv(actor('admin'), { csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,12' });
    expect(res).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    const all = await h.personRepo.findAll();
    expect(all[0]!.grade).toBe(9); // unchanged
  });

  it('updates an existing camper when updateExisting is true', async () => {
    const h = await build();
    await h.svc.importCsv(actor('admin'), { csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,9' });
    const res = await h.svc.importCsv(actor('admin'), { csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,12', updateExisting: true });
    expect(res).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const all = await h.personRepo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.grade).toBe(12);
  });
});

describe('ImportService.importCsv — dryRun', () => {
  it('dryRun:true returns counts but does NOT persist any persons', async () => {
    const { svc, personRepo } = await build();
    const res = await svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,9',
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.created).toBe(1);
    const all = await personRepo.findAll();
    expect(all).toHaveLength(0); // nothing written
  });

  it('dryRun:true flags unrecognised church names as phantomChurches with a warning', async () => {
    const { svc, churchRepo } = await build([]);
    const res = await svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,New Church,9',
      dryRun: true,
    });
    expect(res.phantomChurches).toContain('New Church');
    expect(res.warnings.length).toBeGreaterThan(0);
    const churches = await churchRepo.findAll();
    expect(churches).toHaveLength(0); // not created in dry-run
  });

  it('dryRun result has dryRun:true in the returned object', async () => {
    const { svc } = await build();
    const res = await svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church\nAda,Lovelace,Victory',
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
  });
});

describe('ImportService.importCsv — church accommodation override', () => {
  const HDR = 'First Name,Last Name,Church,Gender,School Grade,Type';

  it('forces a STUDENT to the church override when the CSV kind differs (with a warning)', async () => {
    const h = await build([church({ id: 'c1', name: 'Victory', accommodationOverride: 'classroom' })]);
    const res = await h.svc.importCsv(actor('admin'), { csvData: `${HDR}\nAda,Lovelace,Victory,Female,9,Tent` });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.accommodationKind).toBe('classroom');
    expect(res.warnings.some((w) => w.message.includes('overridden'))).toBe(true);
  });

  it('applies the override even when the CSV has no Type value (no warning)', async () => {
    const h = await build([church({ id: 'c1', name: 'Victory', accommodationOverride: 'tent' })]);
    const res = await h.svc.importCsv(actor('admin'), { csvData: `${HDR}\nAda,Lovelace,Victory,Female,9,` });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.accommodationKind).toBe('tent');
    expect(res.warnings.some((w) => w.message.includes('overridden'))).toBe(false);
  });

  it('Bug 2 (2026-07-17): also forces a LEADER to the church override (with a warning) — was students-only', async () => {
    const h = await build([church({ id: 'c1', name: 'Victory', accommodationOverride: 'classroom' })]);
    const res = await h.svc.importCsv(actor('admin'), { csvData: `${HDR}\nAlelia,Ino,Victory,Female,18+ Leader,Tent` });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.kind).toBe('leader');
    expect(p.accommodationKind).toBe('classroom');
    expect(res.warnings.some((w) => w.message.includes('overridden'))).toBe(true);
  });

  it('keeps the CSV kind when the church has no override', async () => {
    const h = await build(); // default church, no override
    await h.svc.importCsv(actor('admin'), { csvData: `${HDR}\nAda,Lovelace,Victory,Female,9,Tent` });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.accommodationKind).toBe('tent');
  });

  it('applies the override on a re-import update (updateExisting:true)', async () => {
    const h = await build([church({ id: 'c1', name: 'Victory', accommodationOverride: 'classroom' })]);
    await h.svc.importCsv(actor('admin'), { csvData: `${HDR}\nAda,Lovelace,Victory,Female,9,Tent` });
    await h.svc.importCsv(actor('admin'), { csvData: `${HDR}\nAda,Lovelace,Victory,Female,9,Tent`, updateExisting: true });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.accommodationKind).toBe('classroom');
  });
});

describe('ImportService.importCsv — Elvanto export shape', () => {
  const ELVANTO_HEADER =
    'Date Submitted,Submission Status,Person,Person Status,First Name,Last Name,Gender,Date of Birth,School Grade,Mobile Number,Email Address,Suburb,Postcode,State,Medicare Number,Medical Conditions,Dietary Requirements,List Other Medical Conditions or Medication Taken,Attendee\'s Church,"If from a church not listed, please specify church name & Youth Pastor",Blue Card/Working with Children Card Number,Blue Card/Working with Children Card Expiry,I give medical consent for my child as listed above.,I give photography and video consent for my child as listed above.,I understand and agree to the Supervision policy.,Parent/Guardian Name,Relation to Child,Parent/Guardian Phone Number,Today\'s Date';

  // Liam: youth, grade 11, medical list + dietary sentence, consents all Yes, known church.
  const LIAM =
    '21/06/2026,Pending,"Est, Liam",Pending,Liam,Est,Male,30/09/2009,11,0402113441,liam@x.com,Carindale,4152,QLD,4148431533,"Anaphylaxis, Dairy Intolerance, Egg Allergy, Nut Allergy",No dairy no eggs no nuts no fish no sesame,,Victory,,,,Yes,Yes,Yes,Penny Est,Mother,0413510011,21/06/2026';
  // Alelia: LEADER (18+ Leader), blank Person cell, church NOT in system, blue card, dietary blank.
  const ALELIA =
    '21/06/2026,Pending,,Pending,Alelia,Ino,Female,31/12/2006,18+ Leader,0434998611,ale@x.com,Woodhill,4285,QLD,4285242212,"Gluten Intolerance, Lactose Intolerance",,,REDACTED Church,Josh Gazzard,2532285 / 2,30/04/2029,Yes,Yes,Yes,Nyree Ino,Mother,0481092411,21/06/2026';
  // Cooper: dietary "NA" (junk), multi-line Other meds. Quoted field spans two lines.
  const COOPER =
    '21/06/2026,Pending,"Haw, Cooper",Pending,Cooper,Haw,Male,24/03/2010,11,0499 259 222,coop@x.com,Morayfield,4506,Queensland,2582677511,,NA,"Ritalin\nFluexotine",Victory,,,,Yes,Yes,Yes,Tracy-Lee Ba,Mother,0448835711,21/06/2026';

  it('imports a youth with all fields normalized', async () => {
    const { svc, personRepo } = await build();
    const res = await svc.importCsv(actor('admin'), { csvData: `${ELVANTO_HEADER}\n${LIAM}` });
    expect(res.created).toBe(1);
    const p = (await personRepo.findAll())[0]!;
    expect(p.kind).toBe('youth');
    expect(p.grade).toBe(11);
    expect(p.dateOfBirth).toBe('2009-09-30');
    expect(p.gender).toBe('male');
    expect(p.churchId).toBe('c1');
    expect(p.suburb).toBe('Carindale');
    expect(p.postcode).toBe('4152');
    expect(p.state).toBe('QLD');
    expect(p.medicareNumber).toBe('4148431533');
    expect(p.medicalConditions).toEqual(['Anaphylaxis, Dairy Intolerance, Egg Allergy, Nut Allergy']);
    expect(p.dietaryRequirements).toEqual(['No dairy no eggs no nuts no fish no sesame']);
    expect(p.parentRelation).toBe('Mother');
    expect(p.parentPhone).toBe('0413510011');
    expect(p.consents.medical.granted).toBe(true);
    expect(p.consents.media.granted).toBe(true);
    expect(p.consents.supervision.granted).toBe(true);
  });

  it('detects a leader and auto-creates an unknown church', async () => {
    const { svc, personRepo, churchRepo } = await build();
    const res = await svc.importCsv(actor('admin'), { csvData: `${ELVANTO_HEADER}\n${ALELIA}` });
    expect(res.created).toBe(1);
    expect(res.churchesCreated).toContain('REDACTED Church');
    expect(res.warnings.length).toBeGreaterThan(0);
    const p = (await personRepo.findAll())[0]!;
    expect(p.kind).toBe('leader');
    expect(p.grade).toBeNull();
    expect(p.blueCardNumber).toBe('2532285 / 2');
    expect(p.blueCardExpiry).toBe('2029-04-30');
    expect(p.churchUnlistedNote).toBe('Josh Gazzard');
    const created = await churchRepo.findAll();
    const kh = created.find((c) => c.name === 'REDACTED Church')!;
    expect(kh).toBeTruthy();
    expect(p.churchId).toBe(kh.id);
    // The "unlisted church / youth pastor" free-text note is preserved on the PERSON
    // (asserted above); the auto-created church no longer stores a youth-pastor field.
  });

  it('strips junk dietary and preserves multi-line medication text', async () => {
    const { svc, personRepo } = await build();
    await svc.importCsv(actor('admin'), { csvData: `${ELVANTO_HEADER}\n${COOPER}` });
    const p = (await personRepo.findAll())[0]!;
    expect(p.dietaryRequirements).toEqual([]); // "NA" → empty
    expect(p.medicalConditions).toEqual([]);   // blank
    expect(p.otherMedications).toBe('Ritalin\nFluexotine');
    expect(p.mobile).toBe('0499 259 222');
  });
});

describe('ImportService.importCsv — blank-cell guard on update (no clobbering)', () => {
  let h: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { h = await build(); });

  it('a blank Gender cell on re-import preserves the existing gender (does not reset to "other")', async () => {
    await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Gender,Grade\nAda,Lovelace,Victory,Female,9',
    });
    const res = await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,10', // no Gender column
      updateExisting: true,
    });
    expect(res).toMatchObject({ created: 0, updated: 1 });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.gender).toBe('female'); // preserved, not reset to 'other'
    expect(p.grade).toBe(10); // the field that WAS present still updates
  });

  it('a brand-new person with a blank Gender cell still defaults to "other"', async () => {
    const res = await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nGrace,Hopper,Victory,8', // no Gender column
    });
    expect(res.created).toBe(1);
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.gender).toBe('other');
  });

  it('a non-blank Gender cell on re-import still overwrites as before', async () => {
    await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Gender,Grade\nAda,Lovelace,Victory,Female,9',
    });
    const res = await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Gender,Grade\nAda,Lovelace,Victory,Male,10',
      updateExisting: true,
    });
    expect(res).toMatchObject({ created: 0, updated: 1 });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.gender).toBe('male');
  });

  it('blank Mobile/Email/Suburb/State cells on re-import preserve existing values', async () => {
    await h.svc.importCsv(actor('admin'), {
      csvData:
        'First Name,Last Name,Church,Mobile,Email Address,Suburb,State,Grade\n' +
        'Ada,Lovelace,Victory,0400 111 111,ada@example.com,Newtown,QLD,9',
    });
    const res = await h.svc.importCsv(actor('admin'), {
      // Same phone (so the same-name pool still resolves to this one person), but
      // Email/Suburb/State columns are missing entirely from this re-upload.
      csvData: 'First Name,Last Name,Church,Mobile,Grade\nAda,Lovelace,Victory,0400 111 111,11',
      updateExisting: true,
    });
    expect(res).toMatchObject({ created: 0, updated: 1 });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.mobile).toBe('0400 111 111');
    expect(p.email).toBe('ada@example.com');
    expect(p.suburb).toBe('Newtown');
    expect(p.state).toBe('QLD');
    expect(p.grade).toBe(11);
  });

  it('a blank School Grade cell on re-import preserves the existing grade and kind', async () => {
    await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nAda,Lovelace,Victory,9',
    });
    const res = await h.svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Mobile\nAda,Lovelace,Victory,0400 555 555', // no Grade column
      updateExisting: true,
    });
    expect(res).toMatchObject({ created: 0, updated: 1 });
    const p = (await h.personRepo.findAll())[0]!;
    expect(p.grade).toBe(9);
    expect(p.kind).toBe('youth');
    expect(p.mobile).toBe('0400 555 555'); // the field that WAS present still updates
  });
});

describe('import: unallocated + overrides', () => {
  // The multi-word note column is quoted, exactly as a real Elvanto export has it.
  const HEADER = 'First Name,Last Name,Gender,School Grade,Mobile Number,Attendee\'s Church,"If from a church not listed, please specify church name & Youth Pastor"';

  function savedOverride(personId: string) {
    return {
      id: 'o1', personId, firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '0411928301',
      assignedChurchId: 'c1', assignedChurchName: 'Grace Point', formChurch: 'OTHER - please specify below',
      kind: 'unallocated' as const, note: null, createdBy: 'Admin', createdAt: 't', updatedAt: 't',
    };
  }

  it('routes an OTHER registrant to the unallocated sentinel instead of creating a junk church', async () => {
    const { svc, personRepo, churchRepo } = await build();
    const csv = `${HEADER}\nJohn,Smith,Male,9,0411928301,OTHER - please specify below,Hope Church Ps Josh`;
    await svc.importCsv(actor('admin'), { csvData: csv, updateExisting: true });
    const john = (await personRepo.findAll()).find((p) => p.firstName === 'John')!;
    expect(john.churchId).toBe(UNALLOCATED_CHURCH_ID);
    expect(john.zone).toBe('');
    expect(john.churchUnlistedNote).toContain('Hope');
    expect((await churchRepo.findAll()).some((c) => c.name.toLowerCase().includes('other'))).toBe(false);
  });

  it('re-applies a saved override on re-import: person keeps their church, is not deleted or duplicated', async () => {
    const { svc, personRepo, overrideRepo } = await build([church({ id: 'c1', name: 'Grace Point', zone: 'Blue' })]);
    const csv = `${HEADER}\nJohn,Smith,Male,9,0411928301,OTHER - please specify below,Hope`;
    await svc.importCsv(actor('admin'), { csvData: csv, updateExisting: true });
    const john = (await personRepo.findAll()).find((p) => p.firstName === 'John')!;
    expect(john.churchId).toBe(UNALLOCATED_CHURCH_ID);

    // Admin allocates John to Grace Point (person move + override store).
    await personRepo.save({ ...john, churchId: 'c1', churchName: 'Grace Point', zone: 'Blue' });
    await overrideRepo.save(savedOverride(john.id));

    // Re-import the SAME form (John's row still says OTHER).
    await svc.importCsv(actor('admin'), { csvData: csv, updateExisting: true });

    const after = await personRepo.findAll();
    expect(after).toHaveLength(1);                 // no duplicate
    expect(after[0]!.id).toBe(john.id);            // same person, updated in place
    expect(after[0]!.churchId).toBe('c1');         // manual church retained
    expect(after[0]!.zone).toBe('Blue');
    expect(await overrideRepo.findAll()).toHaveLength(1); // not pruned — person still present
  });

  it('prunes an override when its person withdraws (absent from the re-imported file)', async () => {
    const { svc, personRepo, overrideRepo } = await build([church({ id: 'c1', name: 'Grace Point', zone: 'Blue' })]);
    const csv1 = `${HEADER}\nJohn,Smith,Male,9,0411928301,OTHER - please specify below,Hope`;
    await svc.importCsv(actor('admin'), { csvData: csv1, updateExisting: true });
    const john = (await personRepo.findAll()).find((p) => p.firstName === 'John')!;
    await overrideRepo.save(savedOverride(john.id));

    // Re-import with John absent (a different registrant only).
    const csv2 = `${HEADER}\nMary,Jones,Female,10,0422000000,Grace Point,`;
    await svc.importCsv(actor('admin'), { csvData: csv2, updateExisting: true });
    expect(await overrideRepo.findAll()).toHaveLength(0);
  });
});

/* Item A follow-up (2026-07-28) — NAME who is about to be deleted.
   The Form import is authoritative: anyone absent from the file is removed. The result carried
   only a `deleted` COUNT, so a spelling change or a wrong export could silently drop real
   registrants and the admin would only find out afterwards. Each absent person now gets its own
   warning row, visible in the dry-run preview BEFORE anything is confirmed. */
describe('ImportService.importCsv — warns by name about pending deletions', () => {
  const seed = 'First Name,Last Name,Church,Grade\nSam,Lee,Victory,9\nJo,Kim,Victory,10';

  it('names each absent person in a warning, and does so on a DRY RUN before any deletion', async () => {
    const { svc, personRepo } = await build();
    await svc.importCsv(actor('admin'), { csvData: seed });

    const res = await svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nSam,Lee,Victory,9',
      dryRun: true,
    });
    expect(res.deleted).toBe(1);
    expect(res.warnings.some((w) => /Jo Kim/.test(w.message) && /DELETED/.test(w.message))).toBe(true);
    // Dry run: nobody was actually removed.
    expect(await personRepo.findAll()).toHaveLength(2);
  });

  it('raises no deletion warning when everyone in the DB is still in the file', async () => {
    const { svc } = await build();
    await svc.importCsv(actor('admin'), { csvData: seed });
    const res = await svc.importCsv(actor('admin'), { csvData: seed, updateExisting: true });
    expect(res.deleted).toBe(0);
    expect(res.warnings.filter((w) => /will be DELETED/.test(w.message))).toEqual([]);
  });
});

/* Item 12 (2026-07-28): a trailing blank line is spreadsheet padding, not a defect. It used to
   report "Missing firstName or lastName" on a file that otherwise imported perfectly — the
   reported "throws first/last name not detected but then imports successfully" symptom. */
describe('ImportService.importCsv — blank padding rows (item 12)', () => {
  it('skips an entirely-blank row without an error', async () => {
    const { svc } = await build();
    const res = await svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nSam,Lee,Victory,9\n,,,',
    });
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('still reports a genuinely half-filled row as an error', async () => {
    const { svc } = await build();
    const res = await svc.importCsv(actor('admin'), {
      csvData: 'First Name,Last Name,Church,Grade\nSam,,Victory,9',
    });
    expect(res.errors.some((e) => /Missing firstName or lastName/.test(e.message))).toBe(true);
  });
});
