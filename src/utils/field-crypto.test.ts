import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  isEncrypted, encryptField, decryptField, maybeEncrypt, maybeDecrypt, assertFieldEncryptionKey,
} from './field-crypto';

// Deterministic 32-byte keys for the test process.
const KEY = Buffer.alloc(32, 1).toString('base64');
const KEY2 = Buffer.alloc(32, 2).toString('base64');

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = KEY;
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

describe('field-crypto', () => {
  it('round-trips a value under matching AAD', () => {
    const ct = encryptField('Asthma; peanut allergy', 'people:other_medications:p_1');
    expect(isEncrypted(ct)).toBe(true);
    expect(ct.startsWith('v1.k1.')).toBe(true);
    expect(decryptField(ct, 'people:other_medications:p_1')).toBe('Asthma; peanut allergy');
  });

  it('produces a fresh IV each call (ciphertexts differ)', () => {
    const a = encryptField('x', 'people:medicare_number:p_1');
    const b = encryptField('x', 'people:medicare_number:p_1');
    expect(a).not.toBe(b);
  });

  it('rejects decryption under the wrong AAD (bound to row+column)', () => {
    const ct = encryptField('secret', 'people:medicare_number:p_1');
    expect(() => decryptField(ct, 'people:medicare_number:p_2')).toThrow();
  });

  it('rejects a tampered ciphertext (auth tag fails)', () => {
    const ct = encryptField('secret', 'notes:body:n_1');
    const parts = ct.split('.');
    const flipped = parts[4]!.slice(0, -2) + (parts[4]!.endsWith('A') ? 'B' : 'A');
    const bad = [parts[0], parts[1], parts[2], parts[3], flipped].join('.');
    expect(() => decryptField(bad, 'notes:body:n_1')).toThrow();
  });

  it('maybeEncrypt passes null/empty through as null', () => {
    expect(maybeEncrypt(null, 'a')).toBeNull();
    expect(maybeEncrypt(undefined, 'a')).toBeNull();
    expect(maybeEncrypt('', 'a')).toBeNull();
  });

  it('maybeDecrypt passes null and legacy plaintext through unchanged', () => {
    expect(maybeDecrypt(null, 'a')).toBeNull();
    expect(maybeDecrypt('plain legacy value', 'a')).toBe('plain legacy value');
  });

  it('decrypts ciphertext written under a now-PREV key', () => {
    // Simulate rotation: value encrypted under k1, then k2 becomes active and k1 becomes prev.
    const ct = encryptField('rotate me', 'people:parent_phone:p_9');
    process.env['FIELD_ENCRYPTION_KEY'] = KEY2;
    process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k2';
    process.env['FIELD_ENCRYPTION_KEY_PREV'] = KEY;
    process.env['FIELD_ENCRYPTION_KEY_PREV_ID'] = 'k1';
    expect(decryptField(ct, 'people:parent_phone:p_9')).toBe('rotate me');
    // restore active for later tests
    process.env['FIELD_ENCRYPTION_KEY'] = KEY;
    process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
    delete process.env['FIELD_ENCRYPTION_KEY_PREV'];
    delete process.env['FIELD_ENCRYPTION_KEY_PREV_ID'];
  });
});

describe('assertFieldEncryptionKey', () => {
  const OLD = process.env['FIELD_ENCRYPTION_KEY'];
  afterEach(() => {
    if (OLD === undefined) delete process.env['FIELD_ENCRYPTION_KEY'];
    else process.env['FIELD_ENCRYPTION_KEY'] = OLD;
  });

  it('throws when the key is absent', () => {
    delete process.env['FIELD_ENCRYPTION_KEY'];
    expect(() => assertFieldEncryptionKey()).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('throws when the key is not 32 bytes of base64', () => {
    process.env['FIELD_ENCRYPTION_KEY'] = 'too-short';
    expect(() => assertFieldEncryptionKey()).toThrow(/32/);
  });

  it('passes for a valid 32-byte base64 key', () => {
    process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertFieldEncryptionKey()).not.toThrow();
  });
});
