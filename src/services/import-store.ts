import type {
  IPersonRepository, IChurchRepository, IAllocationOverrideRepository,
} from '../repositories/interfaces/entity-repositories';

// ---------------------------------------------------------------------------
// import-store.ts — the seam the three CSV importers write through (I2, 2026-11-07).
//
// The importers no longer branch on `dryRun`. They always read and write an ImportStore, and
// that store is always a STAGED overlay over the real repos:
//   - preview (dryRun) = run the importer on a stage, then throw the stage away;
//   - commit           = run the importer on a stage, then `flush()` it to the real repos.
// So a preview computes exactly what a commit would write. `POST /import/batch` (preview only,
// IA OQ-22) runs Form -> Ticket -> Invoice over ONE stage, so the later files see the earlier
// files' people.
//
// Two adapters sit at this port: the real repositories (Supabase / in-memory) and `stage()`.
// The port is only what the importers use: findAll + saveMany/delete (people), findAll + save
// (churches), findAll + delete (allocation overrides).
// ---------------------------------------------------------------------------

export interface ImportStore {
  people: Pick<IPersonRepository, 'findAll' | 'saveMany' | 'delete'>;
  churches: Pick<IChurchRepository, 'findAll' | 'save'>;
  overrides: Pick<IAllocationOverrideRepository, 'findAll' | 'delete'>;
}

export interface StagedStore extends ImportStore {
  /** Write everything staged to the real store, in the order the importers used to:
   *  new churches, then one people saveMany, then person deletes, then override deletes.
   *  Not atomic (no cross-table transaction here, D5 out of scope). */
  flush(): Promise<void>;
}

/** For importers that never read or write allocation overrides (Ticket, Invoice). */
export const NO_OVERRIDES: ImportStore['overrides'] = {
  findAll: async () => [],
  delete: async () => false,
};

const clone = <T>(v: T): T => structuredClone(v);

function layer<T extends { id: string }>(load: () => Promise<T[]>) {
  let view: Promise<Map<string, T>> | null = null;
  const written = new Map<string, T>();
  const deleted = new Set<string>();
  // One read of the real store per stage, memoised as a promise so concurrent first calls share it.
  const rows = (): Promise<Map<string, T>> =>
    (view ??= load().then((all) => new Map(all.map((r) => [r.id, clone(r)]))));
  return {
    written,
    deleted,
    async findAll(): Promise<T[]> {
      return [...(await rows()).values()].map(clone);
    },
    async put(r: T): Promise<T> {
      (await rows()).set(r.id, clone(r));
      written.set(r.id, clone(r));
      deleted.delete(r.id);
      return clone(r);
    },
    async remove(id: string): Promise<boolean> {
      const had = (await rows()).delete(id);
      written.delete(id);
      deleted.add(id);
      return had;
    },
  };
}

/** The staging (overlay) adapter: reads fall through to `real` once, writes are buffered. */
export function stage(real: ImportStore): StagedStore {
  const people = layer(() => real.people.findAll());
  const churches = layer(() => real.churches.findAll());
  const overrides = layer(() => real.overrides.findAll());
  return {
    people: {
      findAll: () => people.findAll(),
      saveMany: async (list) => {
        const out = [];
        for (const p of list) out.push(await people.put(p));
        return out;
      },
      delete: (id) => people.remove(id),
    },
    churches: {
      findAll: () => churches.findAll(),
      save: (c) => churches.put(c),
    },
    overrides: {
      findAll: () => overrides.findAll(),
      delete: (id) => overrides.remove(id),
    },
    async flush() {
      for (const c of churches.written.values()) await real.churches.save(c);
      if (people.written.size > 0) await real.people.saveMany([...people.written.values()]);
      for (const id of people.deleted) await real.people.delete(id);
      for (const id of overrides.deleted) await real.overrides.delete(id);
    },
  };
}
