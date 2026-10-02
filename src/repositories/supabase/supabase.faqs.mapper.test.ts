import { describe, it, expect } from 'vitest';
import { toFaq, faqCols } from './supabase.faqs';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'f1', question: 'What time?', answer: '8am', order: 3,
  created_at: created, updated_at: updated, ...over,
});

describe('faqs mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const f = toFaq(row());
    expect(f.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(f.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('maps question/answer/order straight through', () => {
    const f = toFaq(row());
    expect(f.question).toBe('What time?');
    expect(f.answer).toBe('8am');
    expect(f.order).toBe(3);
  });
  it('order survives round-trip', () => {
    const cols = faqCols(toFaq(row({ order: 0 })));
    expect(cols['order']).toBe(0);
  });
});
