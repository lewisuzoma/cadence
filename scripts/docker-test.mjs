#!/usr/bin/env node
/**
 * `npm run docker:test`
 *
 * Runs both suites inside Compose and exits non-zero if either fails:
 *   1. test-server against the disposable `db-test` Postgres
 *   2. test-client (jsdom + MSW)
 *
 * Kept as a script rather than a shell one-liner so it works the same on
 * Windows, macOS and Linux, and so the db-test service is always torn down.
 */
import { spawnSync } from 'node:child_process';

const compose = (args) => {
  console.log(`\n$ docker compose ${args.join(' ')}\n`);
  return spawnSync('docker', ['compose', ...args], { stdio: 'inherit', shell: false });
};

const steps = [
  {
    name: 'server tests (real Postgres)',
    args: [
      '--profile',
      'test',
      'up',
      '--build',
      '--abort-on-container-exit',
      '--exit-code-from',
      'test-server',
      'test-server',
      'db-test',
    ],
  },
  {
    name: 'client tests (jsdom + MSW)',
    args: [
      '--profile',
      'test',
      'up',
      '--build',
      '--abort-on-container-exit',
      '--exit-code-from',
      'test-client',
      'test-client',
    ],
  },
];

let failed = null;
for (const step of steps) {
  const result = compose(step.args);
  if (result.status !== 0) {
    failed = { step: step.name, code: result.status ?? 1 };
    break;
  }
}

// Always clean up the test containers, pass or fail.
compose(['--profile', 'test', 'rm', '-fsv', 'test-server', 'test-client', 'db-test']);

if (failed) {
  console.error(`\n✗ ${failed.step} failed (exit ${failed.code})`);
  process.exit(failed.code);
}
console.log('\n✓ server and client suites passed inside Compose');
