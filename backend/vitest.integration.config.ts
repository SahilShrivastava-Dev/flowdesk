import { defineConfig } from 'vitest/config';

/**
 * Integration tests — these RESET a real database.
 *
 * tests/globalSetup.ts refuses to run unless DATABASE_URL names a test
 * database. Do not remove that guard: `prisma db push --force-reset` against
 * the production URL would drop every table.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // Shared database — tests must not race each other.
    fileParallelism: false,
    // Generous, because these talk to a REMOTE database. Re-seeding costs
    // ~15s of round trips before a test does anything of its own, so 30s left
    // no headroom and failed tests that were merely slow — which is the worst
    // kind of flake, since it looks like a real defect.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
