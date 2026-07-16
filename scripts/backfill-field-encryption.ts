/**
 * One-off backfill: re-save every person + note through the encryption-aware Supabase
 * repos so all sensitive fields become ciphertext. Idempotent (already-encrypted values
 * decrypt then re-encrypt to the same plaintext), resumable (re-run after any interruption),
 * order-independent (keyed by id). updated_at is preserved (personColumns writes the
 * existing value, not now()).
 *
 * Run (bash):
 *   PERSISTENCE=supabase DATABASE_URL='<pooler url>' \
 *     FIELD_ENCRYPTION_KEY='<base64 32 bytes>' \
 *     npx tsx scripts/backfill-field-encryption.ts
 *
 * Run (PowerShell):
 *   $env:PERSISTENCE='supabase'; $env:DATABASE_URL='<pooler url>';
 *   $env:FIELD_ENCRYPTION_KEY='<base64 32 bytes>';
 *   npx tsx scripts/backfill-field-encryption.ts
 */
import { buildContainer } from '../src/container';

const BATCH = 200;

async function main(): Promise<void> {
  if (process.env['PERSISTENCE'] !== 'supabase') {
    throw new Error('Refusing to run: set PERSISTENCE=supabase (this backfill targets the live DB).');
  }
  if (!process.env['FIELD_ENCRYPTION_KEY']) {
    throw new Error('FIELD_ENCRYPTION_KEY is required.');
  }
  const { repos } = await buildContainer();

  const people = await repos.people.findAll();
  console.log(`people: ${people.length} rows`);
  for (let i = 0; i < people.length; i += BATCH) {
    const batch = people.slice(i, i + BATCH);
    await repos.people.saveMany(batch);
    console.log(`  people ${Math.min(i + BATCH, people.length)}/${people.length}`);
  }

  const notes = await repos.notes.findAll();
  console.log(`notes: ${notes.length} rows`);
  for (let i = 0; i < notes.length; i += BATCH) {
    const batch = notes.slice(i, i + BATCH);
    await repos.notes.saveMany(batch);
    console.log(`  notes ${Math.min(i + BATCH, notes.length)}/${notes.length}`);
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
