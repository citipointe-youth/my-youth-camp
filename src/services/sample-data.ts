import type { IPersonRepository, IChurchRepository } from '../repositories/interfaces/entity-repositories';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';

// ---------------------------------------------------------------------------
// sample-data.ts — first-aid pre-camp test roster.
//
// A first-aid login has nothing real to search/log against before the real roster
// arrives, so logging in during pre-camp seeds one clearly-labelled sample church
// with 25 sample students (never signed in) to test search, medical details and
// first-aid record-keeping against. Fully isolated from real churches — identified
// purely by the sample church's name, no schema change needed. `ensureFirstAidSample`
// is idempotent (a no-op if the sample church already exists); `clearFirstAidSample`
// removes the church and everyone in it, called from `admin.service.ts` on the real
// pre-camp -> at-camp transition so sample data never reaches the live camp.
// ---------------------------------------------------------------------------

export const SAMPLE_CHURCH_NAME = 'Sample Data (Pre-Camp Testing)';

interface SampleStudentSeed {
  firstName: string;
  lastName: string;
  gender: Person['gender'];
  grade: Person['grade'];
  medicalConditions?: string[];
  dietaryRequirements?: string[];
  otherMedications?: string | null;
}

// 25 students, mixed gender/grade, a handful with medical/dietary detail so
// first-aid has realistic conditions/allergies to search and log against.
const SAMPLE_STUDENTS: readonly SampleStudentSeed[] = [
  { firstName: 'Ava', lastName: 'Sample01', gender: 'female', grade: 7 },
  { firstName: 'Noah', lastName: 'Sample02', gender: 'male', grade: 7,
    medicalConditions: ['Asthma'] },
  { firstName: 'Olivia', lastName: 'Sample03', gender: 'female', grade: 7 },
  { firstName: 'Liam', lastName: 'Sample04', gender: 'male', grade: 8 },
  { firstName: 'Isla', lastName: 'Sample05', gender: 'female', grade: 8,
    medicalConditions: ['Peanut allergy'], dietaryRequirements: ['Nut-free'] },
  { firstName: 'Jack', lastName: 'Sample06', gender: 'male', grade: 8 },
  { firstName: 'Mia', lastName: 'Sample07', gender: 'female', grade: 8 },
  { firstName: 'Oliver', lastName: 'Sample08', gender: 'male', grade: 9,
    medicalConditions: ['Epilepsy'], otherMedications: 'Takes Epilim daily, 8am and 8pm' },
  { firstName: 'Charlotte', lastName: 'Sample09', gender: 'female', grade: 9 },
  { firstName: 'Lucas', lastName: 'Sample10', gender: 'male', grade: 9 },
  { firstName: 'Amelia', lastName: 'Sample11', gender: 'female', grade: 9,
    dietaryRequirements: ['Vegetarian'] },
  { firstName: 'Henry', lastName: 'Sample12', gender: 'male', grade: 10 },
  { firstName: 'Grace', lastName: 'Sample13', gender: 'female', grade: 10,
    medicalConditions: ['Type 1 diabetes'], otherMedications: 'Insulin pump — check before/after meals' },
  { firstName: 'Ethan', lastName: 'Sample14', gender: 'male', grade: 10 },
  { firstName: 'Chloe', lastName: 'Sample15', gender: 'female', grade: 10 },
  { firstName: 'James', lastName: 'Sample16', gender: 'male', grade: 11 },
  { firstName: 'Zoe', lastName: 'Sample17', gender: 'female', grade: 11,
    medicalConditions: ['Bee sting allergy — carries EpiPen'] },
  { firstName: 'Benjamin', lastName: 'Sample18', gender: 'male', grade: 11 },
  { firstName: 'Ruby', lastName: 'Sample19', gender: 'female', grade: 11 },
  { firstName: 'Samuel', lastName: 'Sample20', gender: 'male', grade: 12 },
  { firstName: 'Ella', lastName: 'Sample21', gender: 'female', grade: 12,
    dietaryRequirements: ['Gluten-free'] },
  { firstName: 'Daniel', lastName: 'Sample22', gender: 'male', grade: 12 },
  { firstName: 'Sophia', lastName: 'Sample23', gender: 'female', grade: 12 },
  { firstName: 'Alex', lastName: 'Sample24', gender: 'other', grade: 9 },
  { firstName: 'Jordan', lastName: 'Sample25', gender: 'other', grade: 11 },
];

function blankConsents(): Person['consents'] {
  const mk = (): { granted: boolean; timestamp: null } => ({ granted: false, timestamp: null });
  return { medical: mk(), media: mk(), supervision: mk() } as Person['consents'];
}

async function findSampleChurch(churchRepo: IChurchRepository): Promise<Church | null> {
  const churches = await churchRepo.findAll();
  return churches.find((c) => c.name === SAMPLE_CHURCH_NAME) ?? null;
}

/** Idempotent — a no-op once the sample church already exists. */
export async function ensureFirstAidSample(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
): Promise<void> {
  const existing = await findSampleChurch(churchRepo);
  if (existing) return;

  const now = nowISO();
  const church: Church = {
    id: newId('church'),
    name: SAMPLE_CHURCH_NAME,
    zone: 'Yellow',
    contacts: {
      male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
      female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
    },
    createdAt: now,
    updatedAt: now,
  };
  await churchRepo.save(church);

  const people: Person[] = SAMPLE_STUDENTS.map((s) => ({
    id: newId('person'),
    firstName: s.firstName,
    lastName: s.lastName,
    gender: s.gender,
    dateOfBirth: null,
    grade: s.grade,
    school: null,
    kind: 'youth',
    churchId: church.id,
    churchName: church.name,
    zone: church.zone,
    groupId: null,
    mobile: null,
    email: null,
    suburb: null,
    postcode: null,
    state: null,
    medicalConditions: s.medicalConditions ?? [],
    dietaryRequirements: s.dietaryRequirements ?? [],
    otherMedications: s.otherMedications ?? null,
    medicareNumber: null,
    churchUnlistedNote: null,
    parentGuardianName: null,
    parentPhone: null,
    parentRelation: null,
    blueCardNumber: null,
    blueCardExpiry: null,
    consents: blankConsents(),
    paymentStatus: 'unpaid',
    accommodationKind: null,
    accommodationLabel: null,
    registrationType: null,
    registrationCost: null,
    discountCode: null,
    ticketNumber: null,
    invoiceNumber: null,
    accommodationKindConfidence: null,
    discountAmount: null,
    amountPaid: null,
    feesAmount: null,
    taxAmount: null,
    needsReview: false,
    needsReviewReason: null,
    lifecycle: 'registered',
    atCamp: false,
    checkInHistory: [],
    signOutHistory: [],
    elvantoMeta: null,
    createdAt: now,
    updatedAt: now,
  }));

  await personRepo.saveMany(people);
}

/** Idempotent — a no-op when there's no sample church to clear. */
export async function clearFirstAidSample(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
): Promise<{ deletedPeople: number; deletedChurch: boolean }> {
  const church = await findSampleChurch(churchRepo);
  if (!church) return { deletedPeople: 0, deletedChurch: false };

  const people = await personRepo.findByChurch(church.id);
  for (const p of people) await personRepo.delete(p.id);
  await churchRepo.delete(church.id);

  return { deletedPeople: people.length, deletedChurch: true };
}
