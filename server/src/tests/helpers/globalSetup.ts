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

  try {
    execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });
  } catch (error) {
    /*
     * Much the most common cause is that the database itself does not exist
     * yet: Prisma creates the schema, not the database. Say so with the exact
     * command, rather than leaving Prisma's generic connection error as the
     * only clue.
     */
    const name = url.split('/').pop()?.split('?')[0] ?? 'cadence_test';
    throw new Error(
      [
        `Could not reset the test database "${name}".`,
        '',
        'If it does not exist yet, create it first:',
        `    docker compose exec db psql -U cadence -d cadence -c "CREATE DATABASE ${name}"`,
        '',
        'If the server is not reachable at all, start it with:  docker compose up -d db',
        '',
        String(error instanceof Error ? error.message : error),
      ].join('\n'),
    );
  }
}
