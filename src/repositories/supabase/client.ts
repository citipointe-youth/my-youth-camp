import postgres from 'postgres';
import { env } from '../../config/env';

export type SqlClient = ReturnType<typeof postgres>;
/** Type for the transaction-scoped client passed to sql.begin() callbacks. */
export type TxClient = postgres.TransactionSql<{}>;

let _client: SqlClient | undefined;

export function getSqlClient(): SqlClient {
  if (!_client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required when PERSISTENCE=supabase');
    _client = postgres(env.DATABASE_URL, {
      // Pool size PER VERCEL INSTANCE. Lowered 5 -> 3 on 2026-08-07.
      //
      // ⚠️ THIS NUMBER IS HALF OF A PAIR — the other half is the Supavisor **Pool Size** in the
      // Supabase dashboard (Database -> Connection pooling), currently **30**. Prod runs the
      // SESSION-mode pooler (`DATABASE_URL` on :5432), where a connection holds a dedicated
      // Postgres backend for its whole life instead of being multiplexed. So the ceiling is:
      //
      //     concurrent Vercel instances served  =  Supavisor pool size / this number
      //
      // At 15/5 that was THREE instances before the rest queue — nowhere near a camp AM
      // check-in burst (100-200 leaders). At 30/3 it is TEN. Changing either number without
      // the other silently moves that ceiling, so redo this arithmetic if you touch it.
      //
      // Why 3 is safe: queries here run in 2-40ms (a live /ready probe measured 21ms), so 3
      // concurrent queries per instance is well over a hundred queries/sec per instance —
      // parallelism is not the constraint, connection slots are. CMS ran healthy on max:2.
      // ⚠️ Do NOT go to 1: that caused head-of-line blocking in CMS, where one slow query held
      // the ONLY connection and froze every other request on the instance, including login.
      //
      // Compute is **Micro** (60 max_connections — the SAME as the free Nano; only Small and
      // above raise it, to 90). 30 backends + ~15 used by Supabase's own services sits inside
      // the 57 usable, but it is near the practical ceiling for Micro. Revisit at the
      // September load test (`docs/SESSION-MODE-CUTOVER.md` Window 2): if it says more headroom
      // is needed, the move is Small + pool 50, not a smaller number here.
      max: 3,
      prepare: false,
      idle_timeout: 10, // close idle connections after 10s (stale TCP in serverless)
      max_lifetime: 60, // never keep a connection longer than 60s
      connect_timeout: 10, // fail fast if the DB doesn't respond
      connection: {
        statement_timeout: 15000, // kill any query running > 15s
      },
    });
  }
  return _client;
}
