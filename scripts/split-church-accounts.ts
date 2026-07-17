/**
 * One-off (Feature 2): split every existing church into two gender-scoped logins —
 * `b-<slug>` (boys / male scope) and `g-<slug>` (girls / female scope) — creating any that
 * are missing with a memorable password, and retiring the legacy combined church login.
 *
 * Idempotent: re-running only creates accounts that don't exist yet (existing b-/g- accounts
 * and their passwords are left untouched) and retires any remaining legacy logins. The printed
 * credentials are ONLY the newly-created accounts. To (re)issue passwords for ALL church
 * accounts, use the admin "Randomise & export church passwords" button instead.
 *
 * Run (bash):
 *   PERSISTENCE=supabase DATABASE_URL='<pooler url>' npx tsx scripts/split-church-accounts.ts
 *
 * Run (PowerShell):
 *   $env:PERSISTENCE='supabase'; $env:DATABASE_URL='<pooler url>';
 *   npx tsx scripts/split-church-accounts.ts
 */
import { buildContainer } from '../src/container';
import type { Actor } from '../src/core/entities/user';

const SCRIPT_ADMIN: Actor = {
  id: 'script-admin',
  role: 'admin',
  churchId: null,
  churchName: null,
  zone: null,
  displayName: 'split-church-accounts script',
};

async function main(): Promise<void> {
  if (process.env['PERSISTENCE'] !== 'supabase') {
    throw new Error('Refusing to run: set PERSISTENCE=supabase (this splits accounts on the live DB).');
  }
  const { services } = await buildContainer();
  const result = await services.account.splitChurchAccounts(SCRIPT_ADMIN);

  console.log(`Churches processed: ${result.churches}`);
  console.log(`Legacy combined logins retired: ${result.retired}`);
  console.log(`New gender accounts created: ${result.created.length}`);
  if (result.created.length > 0) {
    console.log('\nusername,church,gender,password');
    for (const c of result.created) {
      console.log(`${c.username},"${c.church.replace(/"/g, '""')}",${c.gender},${c.password}`);
    }
  }
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('split-church-accounts failed:', err);
  process.exit(1);
});
