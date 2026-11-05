import { defineConfig } from 'vitest/config';

/**
 * Server tests run against a REAL Postgres (the `db-test` Compose service),
 * never a mocked Prisma client: the point of these tests is that the schema,
 * the constraints and the transactions behave, which a mock cannot tell us.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/tests/**/*.test.ts'],
    globalSetup: ['./src/tests/helpers/globalSetup.ts'],
    setupFiles: ['./src/tests/helpers/setup.ts'],
    // Integration tests share one database, so they run serially. Parallel
    // files would truncate each other's fixtures mid-test.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/openapi.ts', 'src/server.ts'],
    },
  },
});
