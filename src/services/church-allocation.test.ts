import { describe, it, expect } from 'vitest';
import type { AllocationOverride } from '../core/entities/allocation-override';
import {
  UNALLOCATED_CHURCH_ID,
  isUnlistedChurchCell,
  overrideNameKey,
  overrideMobileKey,
  matchOverride,
  accommodationKindForChurch,
} from './church-allocation';

function ov(partial: Partial<AllocationOverride>): AllocationOverride {
  return {
    id: 'o1', personId: 'p1', firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '',
    assignedChurchId: 'c1', assignedChurchName: 'Grace', formChurch: 'OTHER - please specify below',
    kind: 'unallocated', note: null, createdBy: 'admin', createdAt: 'x', updatedAt: 'x', ...partial,
  };
}

describe('church-allocation helpers', () => {
  it('detects the OTHER literal case-insensitively and blank cells', () => {
    expect(isUnlistedChurchCell('OTHER - please specify below')).toBe(true);
    expect(isUnlistedChurchCell('  other - PLEASE specify below ')).toBe(true);
    expect(isUnlistedChurchCell('')).toBe(true);
    expect(isUnlistedChurchCell('Grace Point Church')).toBe(false);
  });

  it('normalizes identity keys', () => {
    expect(overrideNameKey(' John ', 'SMITH')).toBe('john::smith');
    expect(overrideMobileKey('0411 928 301')).toBe('0411928301');
    expect(overrideMobileKey(null)).toBe('');
  });

  it('matches a single candidate by name when mobiles are absent', () => {
    const c = [ov({ mobileKey: '' })];
    expect(matchOverride(c, '')).toBe(c[0]);
    expect(matchOverride([], '0411928301')).toBeNull();
  });

  it('disambiguates same-name candidates by mobile', () => {
    const a = ov({ id: 'a', mobileKey: '0411928301' });
    const b = ov({ id: 'b', mobileKey: '0422000000' });
    expect(matchOverride([a, b], '0411928301')).toBe(a);
    expect(matchOverride([a, b], '0399999999')).toBeNull();
  });

  it('returns "ambiguous" when identical name+mobile candidates collide', () => {
    const a = ov({ id: 'a', mobileKey: '' });
    const b = ov({ id: 'b', mobileKey: '' });
    expect(matchOverride([a, b], '')).toBe('ambiguous');
  });

  it('applies a church accommodation override to everyone — students AND leaders (Bug 2)', () => {
    expect(accommodationKindForChurch('youth', 'tent', 'classroom')).toBe('classroom');
    // Bug 2 (2026-07-17): a leader in an override church is now forced too (was 'tent').
    expect(accommodationKindForChurch('leader', 'tent', 'classroom')).toBe('classroom');
    expect(accommodationKindForChurch('youth', 'tent', null)).toBe('tent');
    expect(accommodationKindForChurch('leader', 'tent', null)).toBe('tent'); // no override → keep own kind
    expect(accommodationKindForChurch('youth', null, null)).toBeNull();
  });

  it('exposes the sentinel constant', () => {
    expect(UNALLOCATED_CHURCH_ID).toBe('__unallocated__');
  });
});
