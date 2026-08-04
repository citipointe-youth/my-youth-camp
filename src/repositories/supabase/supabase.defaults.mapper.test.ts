import { describe, it, expect } from 'vitest';
import { toDefaults } from './supabase.defaults';

/**
 * These pin the bug that emptied the production camp on 2026-08-04.
 *
 * `saveDefaults` wrote the snapshot as `JSON.stringify(obj)` cast `::jsonb`. The cast declares
 * the parameter type as jsonb, so postgres.js JSON-encoded the already-stringified value a
 * SECOND time and the column ended up holding a jsonb **string**. `toDefaults` cast that string
 * `as Record<string, unknown>`, every `snap['churches']` read `undefined`, and the `?? []`
 * fallbacks turned a complete baseline into six empty arrays — with no error, no throw, nothing
 * in any log. `admin.service.newYear`'s `if (!defaults)` guard passed (the row existed), and the
 * rollover restored those empty arrays over the live camp: 29 churches, 32 accounts, 34
 * classrooms, 6 FAQs, 48 schedule items and 1 devotional deleted from production.
 *
 * ⚠ The malformed fixture MUST be the double-encoded STRING form. An object fixture passes
 * against the broken mapper and proves nothing — which is precisely how this shipped.
 */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    churches: [{ id: 'church_1', name: 'Citipointe Brisbane (Carindale)', zone: 'Black' }],
    users: [{ id: 'user_1', username: 'b-citipointe-brisbane', role: 'church' }],
    classrooms: [{ id: 'room_1', name: 'A1', capacity: 12 }],
    faqs: [{ id: 'faq_1', question: 'What do I bring?', answer: 'A sleeping bag.' }],
    schedule: [{ id: 'sch_1', day: '2026-09-28', time: '18:00', activity: 'Session 1' }],
    devotionals: [{ id: 'dev_1', day: '2026-09-29', verse: 'Psalm 1' }],
    ...overrides,
  };
}

function sqlRow(snap: unknown): Record<string, unknown> {
  return { id: 'defaults', snapshot: snap, created_at: new Date('2026-08-02T19:12:26.195Z') };
}

describe('toDefaults', () => {
  it('reads every scaffold collection out of a well-formed snapshot', () => {
    const d = toDefaults(sqlRow(snapshot()));
    expect(d.churches).toHaveLength(1);
    expect(d.users).toHaveLength(1);
    expect(d.classrooms).toHaveLength(1);
    expect(d.faqs).toHaveLength(1);
    expect(d.schedule).toHaveLength(1);
    expect(d.devotionals).toHaveLength(1);
    expect(d.createdAt).toBe('2026-08-02T19:12:26.195Z');
  });

  it('THROWS on a double-encoded snapshot instead of returning six empty arrays', () => {
    // Exactly what production held: the payload JSON-encoded twice, so postgres.js hands
    // back a string rather than an object.
    const doubleEncoded = JSON.stringify(snapshot());
    expect(() => toDefaults(sqlRow(doubleEncoded))).toThrow(/malformed/i);
  });

  it('names the type it got, so the failure is diagnosable from the message alone', () => {
    expect(() => toDefaults(sqlRow(JSON.stringify(snapshot())))).toThrow(/got string/);
    expect(() => toDefaults(sqlRow(null))).toThrow(/got object/);
    expect(() => toDefaults(sqlRow([]))).toThrow(/got array/);
  });

  it('still defaults a genuinely absent collection to an empty array', () => {
    // A snapshot taken before a collection existed is legitimate — only a non-object
    // snapshot is a corruption. Do not tighten this into a per-key requirement.
    const d = toDefaults(sqlRow(snapshot({ devotionals: undefined })));
    expect(d.devotionals).toEqual([]);
    expect(d.churches).toHaveLength(1);
  });
});
