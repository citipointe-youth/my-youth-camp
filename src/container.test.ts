import { describe, it, expect } from 'vitest';
import { buildServices, buildMemoryContainer, initRepos, memoryRepos, supabaseRepos } from './container';
import type { SqlClient } from './repositories/supabase/client';

// D1 interface tests. Under Q13 c the Supabase set is built with a stub client and never queried.
const stubSql = (() => { throw new Error('stub sql must not be queried'); }) as unknown as SqlClient;

describe('container (D1)', () => {
  it('the Supabase and memory adapters expose the same Repositories keys', () => {
    expect(Object.keys(supabaseRepos(stubSql)).sort()).toEqual(Object.keys(memoryRepos()).sort());
  });

  it('buildServices wires every Services key', () => {
    const services = buildServices(memoryRepos());
    const missing = Object.entries(services).filter(([, v]) => v == null).map(([k]) => k);
    expect(missing).toEqual([]);
    expect(Object.keys(services).length).toBe(27);
  });

  it('buildServices is synchronous and does not touch the Supabase client', () => {
    expect(() => buildServices(supabaseRepos(stubSql))).not.toThrow();
  });

  it('initRepos inits every repo', async () => {
    const repos = memoryRepos();
    const called: string[] = [];
    for (const [k, r] of Object.entries(repos)) {
      const orig = r.init.bind(r);
      r.init = async () => { called.push(k); return orig(); };
    }
    await initRepos(repos);
    expect(called.sort()).toEqual(Object.keys(repos).sort());
  });

  it('buildMemoryContainer gives each caller fresh state', async () => {
    const a = await buildMemoryContainer();
    const b = await buildMemoryContainer();
    await a.repos.churches.save({ id: 'c1', name: 'One', zone: 'Yellow', createdAt: 'x', updatedAt: 'x' } as never);
    expect(await a.repos.churches.findById('c1')).not.toBeNull();
    expect(await b.repos.churches.findById('c1')).toBeNull();
  });
});
