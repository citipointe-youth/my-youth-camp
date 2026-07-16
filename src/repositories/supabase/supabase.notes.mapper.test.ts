import { describe, it, expect, beforeAll } from 'vitest';
import { toNote, noteColumns } from './supabase.notes';
import type { StudentNote } from '../../core/entities/note';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function sampleNote(): StudentNote {
  return {
    id: 'n_1', camperId: 'p_1', body: 'Pastoral: struggling with anxiety, prayed together.',
    authorId: 'u_1', authorName: 'Leader', authorChurchId: 'ch_1', sessionId: null,
    category: 'testimony', sensitive: true, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('notes mapper encryption', () => {
  it('encrypts body on write', () => {
    const cols = noteColumns(sampleNote());
    expect(String(cols['body']).startsWith('v1.')).toBe(true);
    expect(cols['category']).toBe('testimony'); // non-sensitive column untouched
  });

  it('round-trips body through toNote', () => {
    const cols = noteColumns(sampleNote());
    const row = { ...cols, created_at: new Date(cols['created_at'] as string) };
    const n = toNote(row);
    expect(n.body).toBe('Pastoral: struggling with anxiety, prayed together.');
    expect(n.sensitive).toBe(true);
  });

  it('reads a legacy plaintext body (rollout tolerance)', () => {
    const row: Record<string, unknown> = {
      id: 'n_legacy', camper_id: 'p_1', body: 'legacy plaintext note',
      author_id: 'u_1', author_name: 'L', author_church_id: null, session_id: null,
      category: 'note', sensitive: false, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toNote(row).body).toBe('legacy plaintext note');
  });
});
