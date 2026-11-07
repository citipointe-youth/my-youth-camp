import { personRepositoryContract, userRepositoryContract } from './person.contract';
import { InMemoryPersonRepository, InMemoryUserRepository } from '../in-memory';

// Q13 c: the contract runs against the in-memory adapter only (see person.contract.ts).
personRepositoryContract('in-memory', async () => {
  const r = new InMemoryPersonRepository();
  await r.init();
  return r;
});

userRepositoryContract('in-memory', async () => {
  const r = new InMemoryUserRepository();
  await r.init();
  return r;
});
