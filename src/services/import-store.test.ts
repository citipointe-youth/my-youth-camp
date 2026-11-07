import { describe, it, expect } from 'vitest';
import { stage } from './import-store';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { AllocationOverride } from '../core/entities/allocation-override';

// Interface tests for the I2 staging adapter: reads see staged writes, the real store sees
// nothing until flush(), flush applies saves then deletes.

async function real() {
  const people = new InMemoryPersonRepository();
  const churches = new InMemoryChurchRepository();
  const overrides = new InMemoryAllocationOverrideRepository();
  await people.init(); await churches.init(); await overrides.init();
  return { people, churches, overrides };
}
const person = (id: string, firstName: string) => ({ id, firstName, checkInHistory: [] } as unknown as Person);
const church = (id: string) => ({ id, name: id } as unknown as Church);
const label = (p: Person) => p.id + ':' + p.firstName;

describe('stage() overlay', () => {
  it('buffers writes: reads see them, the real store does not until flush', async () => {
    const r = await real();
    await r.people.save(person('p1', 'Ada'));
    await r.people.save(person('p2', 'Bob'));
    const s = stage(r);
    await s.people.saveMany([person('p1', 'Ada2'), person('p3', 'Cy')]);
    await s.people.delete('p2');
    await s.churches.save(church('c9'));
    expect((await s.people.findAll()).map(label)).toEqual(['p1:Ada2', 'p3:Cy']);
    expect((await s.churches.findAll()).map((c) => c.id)).toEqual(['c9']);
    expect((await r.people.findAll()).map((p) => p.firstName)).toEqual(['Ada', 'Bob']);
    expect(await r.churches.findAll()).toHaveLength(0);

    await s.flush();
    expect((await r.people.findAll()).map(label).sort()).toEqual(['p1:Ada2', 'p3:Cy']);
    expect((await r.churches.findAll()).map((c) => c.id)).toEqual(['c9']);
  });

  it('returns copies: mutating a read or a written object does not change the stage', async () => {
    const r = await real();
    const s = stage(r);
    const p = person('p1', 'Ada');
    await s.people.saveMany([p]);
    p.firstName = 'Mutated';
    const [read] = await s.people.findAll();
    read!.firstName = 'Also';
    expect((await s.people.findAll())[0]!.firstName).toBe('Ada');
  });

  it('a save after a delete revives the row; override deletes flush', async () => {
    const r = await real();
    await r.people.save(person('p1', 'Ada'));
    await r.overrides.save({ id: 'o1', personId: 'p1' } as unknown as AllocationOverride);
    const s = stage(r);
    await s.people.delete('p1');
    await s.people.saveMany([person('p1', 'Back')]);
    await s.overrides.delete('o1');
    expect(await s.overrides.findAll()).toHaveLength(0);
    await s.flush();
    expect((await r.people.findAll()).map((x) => x.firstName)).toEqual(['Back']);
    expect(await r.overrides.findAll()).toHaveLength(0);
  });

  it('reads the real store once, even for concurrent first reads', async () => {
    const r = await real();
    let calls = 0;
    const s = stage({
      ...r,
      people: {
        findAll: () => { calls++; return r.people.findAll(); },
        saveMany: (l) => r.people.saveMany(l),
        delete: (id) => r.people.delete(id),
      },
    });
    await Promise.all([s.people.findAll(), s.people.findAll()]);
    await s.people.findAll();
    expect(calls).toBe(1);
  });

  it('flush with nothing staged writes nothing', async () => {
    const r = await real();
    let writes = 0;
    const s = stage({
      ...r,
      people: { findAll: () => r.people.findAll(), saveMany: async (l) => { writes++; return l; }, delete: async () => { writes++; return true; } },
    });
    await s.people.findAll();
    await s.flush();
    expect(writes).toBe(0);
  });
});
