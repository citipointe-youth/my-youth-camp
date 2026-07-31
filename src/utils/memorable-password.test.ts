import { describe, it, expect } from 'vitest';
import { memorablePassword } from './memorable-password';

describe('memorablePassword', () => {
  it('matches the Word.### format (Capitalised word + dot + 3 digits)', () => {
    for (let i = 0; i < 200; i++) {
      const pw = memorablePassword();
      expect(pw).toMatch(/^[A-Z][a-z]+\.\d{3}$/);
    }
  });

  it('always zero-pads to exactly three digits', () => {
    // Sample heavily so a low draw (0-99, which must render as e.g. `.007`) is hit.
    for (let i = 0; i < 2000; i++) {
      const pw = memorablePassword();
      const digits = pw.slice(pw.indexOf('.') + 1);
      expect(digits).toHaveLength(3);
    }
  });

  it('always meets the 6-char minimum (account schema min)', () => {
    for (let i = 0; i < 200; i++) {
      expect(memorablePassword().length).toBeGreaterThanOrEqual(6);
    }
  });

  it('meets a higher requested minimum length by lengthening the word', () => {
    for (let i = 0; i < 200; i++) {
      const pw = memorablePassword(12);
      expect(pw.length).toBeGreaterThanOrEqual(12);
      expect(pw).toMatch(/^[A-Z][a-z]+\.\d{3}$/);
    }
  });

  it('produces varied output (not a constant)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(memorablePassword());
    expect(seen.size).toBeGreaterThan(1);
  });
});
