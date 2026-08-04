import type postgres from 'postgres';
import type { SqlClient } from './client';
import type { ISnapshotRepository } from '../interfaces/entity-repositories';
import type { CampDefaults } from '../../core/entities/settings';

export function toDefaults(r: Record<string, unknown>): CampDefaults {
  const raw = r['snapshot'];
  // ⚠️ FAIL LOUDLY ON A MALFORMED SNAPSHOT — DO NOT SOFTEN THIS BACK TO `as Record<…>`.
  // Until 2026-08-04 saveDefaults double-encoded the payload (JSON.stringify + a ::jsonb
  // cast, so postgres.js JSON-encoded the string a second time) and the column held a jsonb
  // STRING. This cast compiled fine, every `snap['churches']` read undefined, and the `?? []`
  // below turned the whole baseline into six empty arrays with no error anywhere — so
  // admin.service.newYear's `if (!defaults)` guard passed and it restored NOTHING over the
  // live camp, deleting 29 churches, 32 accounts, 34 classrooms and 48 schedule items in
  // production. An unreadable snapshot must stop the rollover, never silently empty it.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(
      `Defaults snapshot is malformed (expected an object, got ${Array.isArray(raw) ? 'array' : typeof raw}) — refusing to restore from it. Re-run Save Defaults.`,
    );
  }
  const snap = raw as Record<string, unknown>;
  return {
    id: 'defaults',
    churches: (snap['churches'] as unknown[]) ?? [],
    users: (snap['users'] as unknown[]) ?? [],
    classrooms: (snap['classrooms'] as unknown[]) ?? [],
    faqs: (snap['faqs'] as unknown[]) ?? [],
    schedule: (snap['schedule'] as unknown[]) ?? [],
    devotionals: (snap['devotionals'] as unknown[]) ?? [],
    createdAt: (r['created_at'] as Date).toISOString(),
  };
}

export class SupabaseDefaultsRepository implements ISnapshotRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async getDefaults(): Promise<CampDefaults | null> {
    const rows = await this.sql`select * from defaults where id = 'defaults'`;
    return rows[0] ? toDefaults(rows[0]) : null;
  }

  async saveDefaults(defaults: CampDefaults): Promise<CampDefaults> {
    // ⚠️ USE `sql.json()`. DO NOT go back to `JSON.stringify(...)` + `::jsonb`.
    // The cast declares the parameter type as jsonb, so postgres.js runs its own jsonb
    // serializer over the value it is given — and over an ALREADY-stringified string that
    // means a second JSON encoding. The column then holds a jsonb string rather than an
    // object, which is what silently emptied the baseline on 2026-08-04 (see toDefaults).
    // Every other repo in this folder hands postgres.js the object and lets it serialize;
    // this file was the only one hand-rolling the cast, and the only one with no test.
    //
    // The `as unknown as JSONValue` is what the stringify was really working around: the
    // CampDefaults collections are typed `unknown[]`, which postgres.js's JSONValue rejects.
    // A cast is the right answer — these are plain entity rows and are JSON-serializable —
    // and it keeps the serialization in postgres.js's hands where it belongs. Reaching for
    // JSON.stringify to satisfy the type-checker is what produced the double encoding.
    // `created_at` is now updated on conflict too: it is the snapshot's own timestamp, and
    // leaving it at the FIRST save's value made an old baseline read as older than it was.
    const snapshot = {
      churches: defaults.churches,
      users: defaults.users,
      classrooms: defaults.classrooms,
      faqs: defaults.faqs,
      schedule: defaults.schedule,
      devotionals: defaults.devotionals,
    };
    await this.sql`
      insert into defaults (id, snapshot, created_at)
      values ('defaults', ${this.sql.json(snapshot as unknown as postgres.JSONValue)}, ${defaults.createdAt})
      on conflict (id) do update set snapshot = excluded.snapshot, created_at = excluded.created_at
    `;
    return defaults;
  }
}
