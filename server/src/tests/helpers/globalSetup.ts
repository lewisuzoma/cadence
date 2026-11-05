import { execSync } from 'node:child_process';

/**
 * Runs once before the whole suite: point Prisma at the test database and
 * reset it to a clean, migrated schema.  `--skip-seed` matters — tests build
 * their own fixtures, and seeded demo rows would make assertions ambiguous.
 */
export default function globalSetup(): void {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set DATABASE_URL_TEST (or DATABASE_URL) to a Postgres test database before running the server tests.',
    );
  }
  if (!/test/i.test(url)) {
    // A guard against pointing the suite at a development database and
    // wiping it: `prisma migrate reset` is destructive by design.
    throw new Error(
      `Refusing to run tests against "${url}": the database name must contain "test".`,
    );
  }

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';

  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
