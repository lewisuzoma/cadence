import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * All Prisma access for authentication.  Nothing above this file writes a
 * query, and nothing in this file makes a decision.
 */

export const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export const authRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findPublicById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  },

  createUser(data: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
  }) {
    // `role` is intentionally not accepted here: registration always creates a
    // LEARNER, and the schema default is the only thing that sets it.
    return prisma.user.create({ data, select: publicUserSelect });
  },

  updateProfile(id: string, data: { firstName: string; lastName: string }) {
    return prisma.user.update({ where: { id }, data, select: publicUserSelect });
  },

  updatePasswordHash(id: string, passwordHash: string) {
    return prisma.user.update({ where: { id }, data: { passwordHash }, select: { id: true } });
  },

  // --- refresh tokens ----------------------------------------------------

  createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }) {
    return prisma.refreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  revokeToken(id: string, client: Prisma.TransactionClient | PrismaClient = prisma) {
    return client.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  },

  /** Stolen-token response: kill every token in the rotation chain. */
  revokeFamily(familyId: string, client: Prisma.TransactionClient | PrismaClient = prisma) {
    return client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllForUser(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /** Rotation is atomic: the old token dies exactly when the new one is born. */
  rotate(params: {
    oldTokenId: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: params.oldTokenId },
        data: { revokedAt: new Date() },
      });
      return tx.refreshToken.create({
        data: {
          userId: params.userId,
          tokenHash: params.tokenHash,
          familyId: params.familyId,
          expiresAt: params.expiresAt,
        },
      });
    });
  },
};
