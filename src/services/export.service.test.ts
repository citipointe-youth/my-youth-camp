import { describe, it, expect, beforeEach } from 'vitest';
import { makeExportService, EXPORT_EXTRA_HEADERS } from './export.service';
import { makeImportService } from './import.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import { parseCsv } from '../utils/csv';
import { ELVANTO_HEADERS } from './elvanto-mapping';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';

function actor(role: Actor['role']): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role };
}
function church(over: Partial<Church>): Church {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'c1', name: 'Victory', zone: 'Yellow',
    contacts: { male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } }, female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } } },
    createdAt: now, updatedAt: now, ...over,
  };
}
async function build() {
  const personRepo = new InMemoryPersonRepository();
  const churchRepo = new InMemoryChurchRepository();
  await personRepo.init();
  await churchRepo.init();
  await churchRepo.save(church({ id: 'c1', name: 'Victory' }));
  return { personRepo, churchRepo };
}

const HEADER =
  'Date Submitted,Submission Status,Person,Person Status,First Name,Last Name,Gender,Date of Birth,School Grade,Mobile Number,Email Address,Suburb,Postcode,State,Medicare Number,Medical Conditions,Dietary Requirements,List Other Medical Conditions or Medication Taken,Attendee\'s Church,"If from a church not listed, please specify church name & Youth Pastor",Blue Card/Working with Children Card Number,Blue Card/Working with Children Card Expiry,I give medical consent for my child as listed above.,I give photography and video consent for my child as listed above.,I understand and agree to the Supervision policy.,Parent/Guardian Name,Relation to Child,Parent/Guardian Phone Number,Today\'s Date';
const LIAM =
  '21/06/2026,Pending,"Est, Liam",Pending,Liam,Est,Male,30/09/2009,11,0402113441,liam@x.com,Carindale,4152,QLD,4148431533,"Anaphylaxis, Dairy Intolerance",No dairy no nuts,,Victory,,,,Yes,Yes,Yes,Penny Est,Mother,0413510011,21/06/2026';

describe('export.service', () => {
  let h: Awaited<ReturnType<typeof build>>;
  beforeEach(async () => { h = await build(); });

  it('produces a header row + the filtered persons', async () => {
    const imp = makeImportService(h.personRepo, h.churchRepo, new InMemoryAllocationOverrideRepository());
    await imp.importCsv(actor('admin'), { csvData: `${HEADER}\n${LIAM}` });
    const exp = makeExportService(h.personRepo, h.churchRepo);
    const csv = await exp.exportRegistrants(actor('admin'), {});
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!['First Name']).toBe('Liam');
    expect(parsed[0]!['School Grade']).toBe('11');
    expect(parsed[0]!['Date of Birth']).toBe('30/09/2009');
    expect(parsed[0]!['Gender']).toBe('Male');
    expect(parsed[0]!["Attendee's Church"]).toBe('Victory');
    expect(parsed[0]!['Person']).toBe('Est, Liam');
    expect(parsed[0]!['Medical Conditions']).toBe('Anaphylaxis, Dairy Intolerance');
  });

  it('round-trips: import → export → re-import yields identical modelled fields', async () => {
    const imp = makeImportService(h.personRepo, h.churchRepo, new InMemoryAllocationOverrideRepository());
    await imp.importCsv(actor('admin'), { csvData: `${HEADER}\n${LIAM}` });
    const original = (await h.personRepo.findAll())[0]!;
    const exp = makeExportService(h.personRepo, h.churchRepo);
    const csv = await exp.exportRegistrants(actor('admin'), {});

    const fresh = await build();
    const imp2 = makeImportService(fresh.personRepo, fresh.churchRepo, new InMemoryAllocationOverrideRepository());
    await imp2.importCsv(actor('admin'), { csvData: csv });
    const reimported = (await fresh.personRepo.findAll())[0]!;

    const fields = ['firstName','lastName','gender','grade','kind','dateOfBirth','mobile','email','suburb','postcode','state','medicareNumber','medicalConditions','dietaryRequirements','otherMedications','blueCardNumber','blueCardExpiry','parentGuardianName','parentRelation','parentPhone'] as const;
    for (const f of fields) {
      expect(reimported[f]).toEqual(original[f]);
    }
    expect(reimported.consents.medical.granted).toBe(original.consents.medical.granted);

    // Byte-for-byte idempotence: exporting the re-imported data reproduces the same CSV.
    const exp2 = makeExportService(fresh.personRepo, fresh.churchRepo);
    const csv2 = await exp2.exportRegistrants(actor('admin'), {});
    expect(csv2).toBe(csv);
  });

  it('respects the gender filter', async () => {
    const exp = makeExportService(h.personRepo, h.churchRepo);
    const csv = await exp.exportRegistrants(actor('admin'), { gender: 'female' });
    expect(parseCsv(csv)).toHaveLength(0);
    expect(csv.split('\n')[0]).toContain('First Name'); // header still present
  });
});

describe('export.service — appended override / accommodation columns (2026-09-23)', () => {
  it('appends the six extra headers after the Elvanto block, which is unchanged', async () => {
    const h = await build();
    const imp = makeImportService(h.personRepo, h.churchRepo, new InMemoryAllocationOverrideRepository());
    await imp.importCsv(actor('admin'), { csvData: `${HEADER}\n${LIAM}` });
    const csv = await makeExportService(h.personRepo, h.churchRepo).exportRegistrants(actor('admin'), {});
    const cols = Object.keys(parseCsv(csv)[0]!);
    expect(cols.slice(0, ELVANTO_HEADERS.length)).toEqual([...ELVANTO_HEADERS]);
    expect(cols.slice(ELVANTO_HEADERS.length)).toEqual([...EXPORT_EXTRA_HEADERS]);
    // The Form importer must never read an extra column back in.
    expect(EXPORT_EXTRA_HEADERS).not.toContain('Discount Code');
  });

  it('fills individual church, individual + church accommodation overrides, registered, final and code', async () => {
    const h = await build();
    await h.churchRepo.save(church({ id: 'c1', name: 'Victory', accommodationOverride: 'tent' }));
    const allocRepo = new InMemoryAllocationOverrideRepository();
    const imp = makeImportService(h.personRepo, h.churchRepo, allocRepo);
    await imp.importCsv(actor('admin'), { csvData: `${HEADER}\n${LIAM}` });
    const p = (await h.personRepo.findAll())[0]!;
    await h.personRepo.save({ ...p, accommodationKindRaw: 'tent', accommodationOverride: 'classroom', accommodationKind: 'classroom', discountCode: 'EARLY10' });
    const now = '2026-01-01T00:00:00.000Z';
    await allocRepo.save({
      id: 'a1', personId: p.id, firstNameKey: 'liam', lastNameKey: 'est', mobileKey: '0402113441',
      assignedChurchId: 'c1', assignedChurchName: 'Victory', formChurch: 'OTHER', kind: 'unallocated',
      note: null, createdBy: 'admin', createdAt: now, updatedAt: now,
    });
    const csv = await makeExportService(h.personRepo, h.churchRepo, allocRepo).exportRegistrants(actor('admin'), {});
    const row = parseCsv(csv)[0]!;
    expect(row['Church Override (individual)']).toBe('OTHER');
    expect(row['Accommodation Override (individual)']).toBe('Classroom');
    expect(row['Accommodation Override (church)']).toBe('Tent');
    expect(row['Registered Accommodation']).toBe('Tent');
    expect(row['Accommodation (final)']).toBe('Classroom');
    expect(row['Discount Code (export)']).toBe('EARLY10');
  });

  it('leaves the extra columns blank when nothing is overridden', async () => {
    const h = await build();
    const imp = makeImportService(h.personRepo, h.churchRepo, new InMemoryAllocationOverrideRepository());
    await imp.importCsv(actor('admin'), { csvData: `${HEADER}\n${LIAM}` });
    const row = parseCsv(await makeExportService(h.personRepo, h.churchRepo, new InMemoryAllocationOverrideRepository()).exportRegistrants(actor('admin'), {}))[0]!;
    for (const col of ['Church Override (individual)', 'Accommodation Override (individual)', 'Accommodation Override (church)', 'Discount Code (export)']) {
      expect(row[col]).toBe('');
    }
  });
});
