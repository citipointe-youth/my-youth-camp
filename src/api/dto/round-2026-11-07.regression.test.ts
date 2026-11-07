import { describe, it, expect } from 'vitest';
import { toCamperDto, toCamperDetailDto, toRegistrantDto, toCrossScopeHitDto } from './person.dto';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';

/* Camp arch round 2026-11-07, regression lane `access`: C3 (A2) viewer-aware person view. */

const NOW = '2026-09-01T00:00:00.000Z';
const PARENT = '0499111222';
const actor = (role: Actor['role']): Actor => ({
  id: 'u', role, churchId: role === 'church' ? 'c1' : null, churchName: null, zone: null, displayName: role,
});
const p = {
  id: 'p1', firstName: 'Ivy', lastName: 'T', kind: 'youth', churchId: 'c1', churchName: 'Victory', zone: 'Yellow',
  gender: 'female', grade: 10, lifecycle: 'arrived', atCamp: true, medicalConditions: [], dietaryRequirements: [],
  consents: {}, parentPhone: PARENT, discountCode: 'SECRETCODE', checkInHistory: [], signOutHistory: [],
  createdAt: NOW, updatedAt: NOW,
} as unknown as Person;

describe('access regression: C3 (A2) view(actor, person) masks inside the DTO', () => {
  it('[C3][T-1] church and firstAid get the parent number masked on camper + registrant DTOs', () => {
    for (const role of ['church', 'firstAid'] as const) {
      for (const dto of [toCamperDto(p, actor(role)), toCamperDetailDto(p, actor(role)), toRegistrantDto(p, actor(role))]) {
        expect(dto.parentPhone, role).toBe('0499****22');
      }
    }
  });
  it('[C3][T-1] prayer: no parent number on camper DTOs, masked on the registrant DTO', () => {
    expect(toCamperDto(p, actor('prayer')).parentPhone).toBeNull();
    expect(toCamperDetailDto(p, actor('prayer')).parentPhone).toBeNull();
    expect(toRegistrantDto(p, actor('prayer')).parentPhone).toBe('0499****22');
  });
  it('[C3][T-1] zoneLeader, director and admin keep the plain parent number', () => {
    for (const role of ['zoneLeader', 'director', 'admin'] as const) {
      expect(toCamperDto(p, actor(role)).parentPhone, role).toBe(PARENT);
    }
  });
  it('[C3][A-6] the money strip lives in the same view: prayer nulls discountCode, church keeps it', () => {
    expect(toCamperDto(p, actor('prayer')).discountCode).toBeNull();
    expect(toCamperDto(p, actor('church')).discountCode).toBe('SECRETCODE');
  });
  it('[C3] a cross-scope hit carries no parent phone or money at all', () => {
    expect(JSON.stringify(toCrossScopeHitDto(p))).not.toMatch(/0499|SECRETCODE/);
  });
});
