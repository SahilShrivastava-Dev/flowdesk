import { execSync } from 'node:child_process';

/**
 * Integration-test bootstrap.
 *
 * ⚠️  THE GUARD BELOW IS LOAD-BEARING. `prisma db push --force-reset` drops
 * every table in the target database. If DATABASE_URL happened to point at
 * production — a stale shell export, a copied .env, a misconfigured CI secret —
 * running the test suite would destroy it.
 *
 * Set up a throwaway database whose name contains "test", e.g.
 *   DATABASE_URL="postgresql://…/flowdesk_test" npm run test:int
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Integration tests need DATABASE_URL pointing at a throwaway test database.',
    );
  }

  // Check the database NAME, not the whole URL — a production host could
  // legitimately contain the substring "test" somewhere in its credentials.
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run integration tests.\n` +
      `  Database name: "${dbName}"\n` +
      `  It must contain "test" — this suite RESETS the schema and would ` +
      `otherwise destroy real data.`,
    );
  }

  console.log(`[tests] resetting schema on "${dbName}"…`);
  execSync('npx prisma db push --force-reset --skip-generate', {
    stdio: 'inherit',
    env: process.env,
  });

  // `db push` applies everything Prisma can describe; these are the two rules
  // it cannot. Without them the tests run against a schema that is subtly
  // LOOSER than production — a suite that never exercises the constraint can
  // pass on a write production would reject, which is the one kind of green
  // build that teaches you nothing.
  execSync('npm run db:constraints', { stdio: 'inherit', env: process.env });
}
