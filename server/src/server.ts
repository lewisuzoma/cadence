import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { assertDatabaseReachable, disconnectPrisma } from './lib/prisma.js';

/**
 * Process entry point.  Boot order matters: prove the database is reachable
 * before announcing readiness, so an unhealthy container is reported as
 * unhealthy instead of accepting traffic it cannot serve.
 */
async function main(): Promise<void> {
  try {
    await assertDatabaseReachable();
    logger.info('Database connection established');
  } catch (error) {
    logger.error({ err: error }, 'Could not reach the database — exiting');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `Cadence API listening on :${env.PORT} (docs at /api/docs)`,
    );
  });

  // Graceful shutdown: stop accepting connections, drain, release the pool.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      // server.close expects a void callback, so the promise is chained
      // rather than awaited: an async callback would float the rejection.
      void disconnectPrisma().finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

void main();
