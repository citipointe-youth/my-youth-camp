# Supabase repository layer (production)

This folder is the live production adapter (`PERSISTENCE=supabase`, built by `supabaseRepos(sql)` in
`src/container.ts`). Every repo shares one pooled `postgres` client (`client.ts`; read its pool-size
note before changing `max`).

## How it is checked

Ruling Q13 c (camp arch round, 2026-11-07): there is no Supabase branch or Docker Postgres in the test
run. So:

- **Behaviour** is pinned by the repository contract in `src/repositories/contract/`, which runs
  against the in-memory adapter. Every case there is something this adapter owes too.
- **This adapter** is checked by reading its SQL against those cases, plus the recording-fake
  statement tests (`*.save.test.ts`, `*.mapper.test.ts`). New SQL should be validated on prod with
  read-only SELECTs before ship.

## Rules that are easy to break

- **People presence** (`at_camp`, `lifecycle`, `cancelled_at`, both history tables) is written only by
  `transition` / `transitionMany` / `clearPresence`. `save`/`saveMany` never put presence in the
  UPDATE set and write history rows only on a real INSERT (`returning (xmax = 0) as inserted`).
- **Inside `sql.begin`, use the `tx` you were given** for every statement, reads included. Calling
  `this.sql` there takes a second pool connection while the first holds a lock.
- `where x in ${sql(ids)}` throws on an empty array; guard first.
- `users.deleteAll` keeps admin accounts.
