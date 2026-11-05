import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env.js';
import { logger } from './logger.js';

/**
 * One PrismaClient for the process.  In development `tsx watch` re-imports
 * this module on every change, so the instance is cached on globalThis to
 * avoid exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) globalForPrisma.prisma = prisma;

/** Used by the health check: a real query, not just a live TCP socket. */
export async function assertDatabaseReachable(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (error) {
    logger.warn({ err: error }, 'Error while disconnecting Prisma');
  }
}
