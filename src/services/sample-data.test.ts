import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPersonRepository, InMemoryChurchRepository } from '../repositories/in-memory';
import { ensureFirstAidSample, clearFirstAidSample, SAMPLE_CHURCH_NAME } from './sample-data';

describe('sample-data', () => {
  let personRepo: InMemoryPersonRepository;
  let churchRepo: InMemoryChurchRepository;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    churchRepo = new InMemoryChurchRepository();
    await personRepo.init();
    await churchRepo.init();
  });

  describe('ensureFirstAidSample', () => {
    it('creates one sample church and 25 sample students, never signed in', async () => {
      await ensureFirstAidSample(personRepo, churchRepo);

      const churches = await churchRepo.findAll();
      const sampleChurch = churches.find((c) => c.name === SAMPLE_CHURCH_NAME);
      expect(sampleChurch).toBeDefined();

      const people = await personRepo.findByChurch(sampleChurch!.id);
      expect(people).toHaveLength(25);
      for (const p of people) {
        expect(p.kind).toBe('youth');
        expect(p.lifecycle).toBe('registered');
        expect(p.atCamp).toBe(false);
        expect(p.churchName).toBe(SAMPLE_CHURCH_NAME);
      }
      // At least some sample students carry medical/dietary detail for first-aid testing.
      expect(people.some((p) => p.medicalConditions.length > 0)).toBe(true);
      expect(people.some((p) => p.dietaryRequirements.length > 0)).toBe(true);
    });

    it('is idempotent — a second call does not duplicate the church or students', async () => {
      await ensureFirstAidSample(personRepo, churchRepo);
      await ensureFirstAidSample(personRepo, churchRepo);

      const churches = await churchRepo.findAll();
      expect(churches.filter((c) => c.name === SAMPLE_CHURCH_NAME)).toHaveLength(1);

      const all = await personRepo.findAll();
      expect(all.filter((p) => p.churchName === SAMPLE_CHURCH_NAME)).toHaveLength(25);
    });

    it('does not touch unrelated existing churches/people', async () => {
      const now = '2026-01-01T00:00:00.000Z';
      await churchRepo.save({
        id: 'real-church', name: 'Real Church', zone: 'Blue',
        contacts: {
          male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
          female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
        },
        createdAt: now, updatedAt: now,
      });

      await ensureFirstAidSample(personRepo, churchRepo);

      const churches = await churchRepo.findAll();
      expect(churches.find((c) => c.id === 'real-church')).toBeDefined();
      expect(churches).toHaveLength(2);
    });
  });

  describe('clearFirstAidSample', () => {
    it('deletes the sample church and all 25 sample students', async () => {
      await ensureFirstAidSample(personRepo, churchRepo);

      const result = await clearFirstAidSample(personRepo, churchRepo);
      expect(result).toEqual({ deletedPeople: 25, deletedChurch: true });

      const churches = await churchRepo.findAll();
      expect(churches.find((c) => c.name === SAMPLE_CHURCH_NAME)).toBeUndefined();
      const all = await personRepo.findAll();
      expect(all.filter((p) => p.churchName === SAMPLE_CHURCH_NAME)).toHaveLength(0);
    });

    it('is a no-op when no sample church exists', async () => {
      const result = await clearFirstAidSample(personRepo, churchRepo);
      expect(result).toEqual({ deletedPeople: 0, deletedChurch: false });
    });

    it('never touches unrelated churches/people', async () => {
      const now = '2026-01-01T00:00:00.000Z';
      await churchRepo.save({
        id: 'real-church', name: 'Real Church', zone: 'Blue',
        contacts: {
          male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
          female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
        },
        createdAt: now, updatedAt: now,
      });
      await personRepo.save({
        id: 'real-person', firstName: 'Real', lastName: 'Student', gender: 'other',
        dateOfBirth: null, grade: 9, school: null, kind: 'youth',
        churchId: 'real-church', churchName: 'Real Church', zone: 'Blue', groupId: null,
        mobile: null, email: null, suburb: null, postcode: null, state: null,
        medicalConditions: [], dietaryRequirements: [], otherMedications: null,
        medicareNumber: null, churchUnlistedNote: null, parentGuardianName: null,
        parentPhone: null, parentRelation: null, blueCardNumber: null, blueCardExpiry: null,
        consents: {
          medical: { granted: false, timestamp: null },
          media: { granted: false, timestamp: null },
          supervision: { granted: false, timestamp: null },
        },
        paymentStatus: 'unpaid', accommodationKind: null, accommodationLabel: null,
        registrationType: null, registrationCost: null, discountCode: null,
        ticketNumber: null, invoiceNumber: null, accommodationKindConfidence: null,
        discountAmount: null, amountPaid: null, feesAmount: null, taxAmount: null,
        needsReview: false, needsReviewReason: null, lifecycle: 'registered', atCamp: false,
        checkInHistory: [], signOutHistory: [], elvantoMeta: null,
        createdAt: now, updatedAt: now,
      });

      await ensureFirstAidSample(personRepo, churchRepo);
      await clearFirstAidSample(personRepo, churchRepo);

      const churches = await churchRepo.findAll();
      expect(churches).toEqual([expect.objectContaining({ id: 'real-church' })]);
      const people = await personRepo.findAll();
      expect(people).toEqual([expect.objectContaining({ id: 'real-person' })]);
    });
  });
});
