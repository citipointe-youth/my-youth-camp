import { randomInt } from 'node:crypto';

/**
 * Memorable church-login passwords (Feature 6, 2026-07-17).
 *
 * Format: `Word.###` — a Capitalised common noun + `.` + three digits (e.g. `Cat.009`,
 * `Donkey.683`). The digits are always zero-padded to exactly three, so the shape is uniform when
 * a password is read aloud off a printed CSV.
 * These are the real passwords handed to churches, so they must be easy to read aloud and type.
 * The wordlist is curated (simple, unambiguous animals/nouns; no offensive or easily-confused
 * words). `mustChangePassword` is deliberately NOT set on accounts using these — they are the
 * account holder's password, not a temporary one.
 */

// Curated safe wordlist. All entries are 3–8 letters, lowercase, alphabetic only, and avoid
// visually ambiguous or awkward-to-spell words. Length variety lets the generator satisfy a
// higher min-length rule by preferring a longer word.
const WORDS: readonly string[] = [
  'ant', 'bat', 'bee', 'cat', 'cod', 'cow', 'dog', 'eel', 'elk', 'fox',
  'hen', 'jay', 'owl', 'pig', 'ram', 'ray', 'yak',
  'bear', 'crab', 'deer', 'dove', 'duck', 'fawn', 'foal', 'frog', 'goat', 'hare',
  'ibis', 'joey', 'lamb', 'lion', 'lynx', 'mole', 'moth', 'mule', 'newt', 'pony',
  'seal', 'swan', 'toad', 'wolf', 'wren',
  'bison', 'camel', 'chick', 'crane', 'eagle', 'egret', 'finch', 'gecko', 'goose', 'heron',
  'horse', 'koala', 'lemur', 'llama', 'moose', 'mouse', 'otter', 'panda', 'quail', 'raven',
  'robin', 'shark', 'sheep', 'skink', 'snail', 'stork', 'tiger', 'zebra',
  'badger', 'beaver', 'cheeta', 'donkey', 'ferret', 'gibbon', 'hornet', 'iguana', 'jaguar', 'kitten',
  'magpie', 'monkey', 'ocelot', 'oriole', 'parrot', 'puffin', 'rabbit', 'salmon', 'turtle', 'walrus',
  'wombat', 'dolphin', 'gosling', 'leopard', 'meerkat', 'panther', 'peacock', 'pelican', 'penguin', 'raccoon',
  'rooster', 'sparrow', 'buffalo', 'antelope', 'flamingo', 'kangaroo', 'squirrel',
];

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Generate a memorable password of the form `Word.###`.
 *
 * @param minLength minimum total length the result must satisfy (the account schema min is 6;
 *   `Word.###` is at least `3 + 1 + 3 = 7` chars for the shortest word, so the default already
 *   passes). If a higher minimum is requested the word is chosen (and, if the wordlist can't
 *   reach it, padded) so the result always meets it.
 */
export function memorablePassword(minLength = 6): string {
  // A `Word.###` result is `word.length + 4` chars. Prefer words long enough to hit minLength.
  const neededWordLen = Math.max(0, minLength - 4);
  const candidates = WORDS.filter((w) => w.length >= neededWordLen);
  const pool = candidates.length > 0 ? candidates : WORDS;
  const word = pool[randomInt(pool.length)] as string;

  const digits = String(randomInt(1000)).padStart(3, '0');
  let result = `${capitalise(word)}.${digits}`;

  // Backstop: if the (unusually high) min-length still isn't met, lengthen the word with more
  // letters from the same pool so the result is still pronounceable.
  while (result.length < minLength) {
    const extra = pool[randomInt(pool.length)] as string;
    result = `${capitalise(word)}${extra}.${digits}`;
  }
  return result;
}
