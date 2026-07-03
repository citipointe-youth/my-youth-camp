import { describe, it, expect } from 'vitest';
import { InMemoryAllocationOverrideRepository } from './in-memory.repositories';
import type { AllocationOverride } from '../../core/entities/allocation-override';

function mk(id: string, personId: string): AllocationOverride {
  return {
    id, personId, firstNameKey: 'john', lastNameKey: 'smith', mobileKey: '',
    assignedChurchId: 'c1', assignedChurchName: 'Grace', formChurch: 'OTHER - please specify below',
    kind: 'unallocated', note: null, createdBy: 'admin', createdAt: 'x', updatedAt: 'x',
  };
}

describe('InMemoryAllocationOverrideRepository', () => {
  it('finds an override by person id and deletes all', async () => {
    const repo = new InMemoryAllocationOverrideRepository();
    await repo.init();
    await repo.save(mk('o1', 'p1'));
    await repo.save(mk('o2', 'p2'));
    expect((await repo.findByPersonId('p2'))?.id).toBe('o2');
    expect(await repo.findByPersonId('nope')).toBeNull();
    expect(await repo.deleteAll()).toBe(2);
    expect(await repo.findAll()).toEqual([]);
  });
});
