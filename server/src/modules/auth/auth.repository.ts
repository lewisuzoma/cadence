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
  /*
   * The instructor profile's status travels with the user everywhere the
   * public shape does, so the client can answer "may I?" with the same
   * `can()` the server uses rather than a second, drifting rule.  Only the
   * status is selected — the bio, photo and suspension reason are the
   * instructor-profile endpoint's business, not every /me response's.
   */
  instructorProfile: { select: { status: true } },
} satisfies Prisma.UserSelect;

export type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export const authRepository = {
  /*
   * Sign-in needs the password hash, so these two return the whole row plus
   * the instructor status — the status travels with every projection of a
   * user, and omitting it here would make the response to a fresh login
   * differ from the response to the /me that follows it.
   */
  findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: { instructorProfile: { select: { status: true } } },
    });
  },

  findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: { instructorProfile: { select: { status: true } } },
    });
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

  // --- password reset ----------------------------------------------------

  createPasswordResetToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return prisma.passwordResetToken.create({ data });
  },

  /** The user comes with the token: the service needs both and this is one trip. */
  findPasswordResetToken(tokenHash: string) {
    return prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  },

  /**
   * Spends the token and sets the new password in one transaction, so a
   * failure cannot leave a used token beside an unchanged password (or the
   * reverse: a changed password with a link still live).
   *
   * `updateMany` with `usedAt: null` in the filter is what makes redemption
   * atomic: two concurrent requests race on the same row and exactly one sees
   * a count of 1. The caller treats 0 as "already used".
   */
  async redeemPasswordReset(params: {
    tokenId: string;
    userId: string;
    passwordHash: string;
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const spent = await tx.passwordResetToken.updateMany({
        where: { id: params.tokenId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (spent.count === 0) return false;

      await tx.user.update({
        where: { id: params.userId },
        data: { passwordHash: params.passwordHash },
      });
      // Every other outstanding link for this user dies with it.
      await tx.passwordResetToken.updateMany({
        where: { userId: params.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: params.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
  },

  /** Supersedes any link already outstanding when a new one is requested. */
  invalidatePasswordResets(userId: string) {
    return prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
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
