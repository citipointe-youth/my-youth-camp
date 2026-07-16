import type { SqlClient } from './client';
import type { INoteRepository } from '../interfaces/entity-repositories';
import type { StudentNote } from '../../core/entities/note';
import { encryptField, maybeDecrypt } from '../../utils/field-crypto';

export function toNote(r: Record<string, unknown>): StudentNote {
  return {
    id: r['id'] as string,
    camperId: (r['camper_id'] as string | null) ?? null,
    body: maybeDecrypt(r['body'] as string, `notes:body:${r['id'] as string}`) ?? '',
    authorId: r['author_id'] as string,
    authorName: r['author_name'] as string,
    authorChurchId: (r['author_church_id'] as string | null) ?? undefined,
    sessionId: (r['session_id'] as string | null) ?? undefined,
    category: (r['category'] as StudentNote['category']) ?? undefined,
    sensitive: (r['sensitive'] as boolean | null) ?? false,
    createdAt: (r['created_at'] as Date).toISOString(),
  };
}

export function noteColumns(note: StudentNote): Record<string, unknown> {
  return {
    id: note.id,
    camper_id: note.camperId ?? null,
    // body is `not null`; encrypt when present, keep '' as '' (never null).
    body: note.body ? encryptField(note.body, `notes:body:${note.id}`) : note.body,
    author_id: note.authorId,
    author_name: note.authorName,
    author_church_id: note.authorChurchId ?? null,
    session_id: note.sessionId ?? null,
    category: note.category ?? null,
    sensitive: note.sensitive ?? false,
    created_at: note.createdAt,
  };
}

export class SupabaseNoteRepository implements INoteRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findAll(): Promise<StudentNote[]> {
    return (await this.sql`select * from notes order by created_at desc`).map(toNote);
  }

  async findById(id: string): Promise<StudentNote | null> {
    const rows = await this.sql`select * from notes where id = ${id}`;
    return rows[0] ? toNote(rows[0]) : null;
  }

  async findByCamper(camperId: string): Promise<StudentNote[]> {
    return (await this.sql`select * from notes where camper_id = ${camperId} order by created_at desc`).map(toNote);
  }

  async findByAuthor(authorId: string): Promise<StudentNote[]> {
    return (await this.sql`select * from notes where author_id = ${authorId} order by created_at desc`).map(toNote);
  }

  async findByZone(zone: string, limit?: number): Promise<StudentNote[]> {
    // Join with people to filter by zone (notes have no direct zone column).
    if (limit != null) {
      return (await this.sql`
        select n.* from notes n
        join people p on p.id = n.camper_id
        where p.zone = ${zone}
        order by n.created_at desc
        limit ${limit}
      `).map(toNote);
    }
    return (await this.sql`
      select n.* from notes n
      join people p on p.id = n.camper_id
      where p.zone = ${zone}
      order by n.created_at desc
    `).map(toNote);
  }

  async findRecent(limit: number): Promise<StudentNote[]> {
    return (await this.sql`select * from notes order by created_at desc limit ${limit}`).map(toNote);
  }

  async save(note: StudentNote): Promise<StudentNote> {
    await this.sql`
      insert into notes ${this.sql(noteColumns(note))}
      on conflict (id) do update set body = excluded.body, category = excluded.category, sensitive = excluded.sensitive
    `;
    return note;
  }

  async saveMany(notes: StudentNote[]): Promise<StudentNote[]> {
    for (const n of notes) await this.save(n);
    return notes;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from notes where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.sql`delete from notes returning id`;
    return rows.length;
  }
}
