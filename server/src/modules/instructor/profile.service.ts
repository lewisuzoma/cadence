import type { InstructorProfile, InstructorProfileUpdateInput } from '@cadence/shared';
import { NotFoundError } from '../../lib/errors.js';
import { mediaUrlForKey } from '../../lib/media-url.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthUser } from '../../middlewares/types.js';

/**
 * The instructor's public face.
 *
 * Always the caller's own: there is no id parameter, so an instructor
 * cannot read or edit anyone else's profile, and an admin wanting to see
 * one uses the instructor-management list instead.
 */

type ProfileRow = {
  userId: string;
  displayName: string;
  title: string;
  bio: string;
  photoKey: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  approvedAt: Date;
  suspendedAt: Date | null;
  suspensionReason: string | null;
};

function toProfile(row: ProfileRow): InstructorProfile {
  return {
    userId: row.userId,
    displayName: row.displayName,
    title: row.title,
    bio: row.bio,
    photoUrl: mediaUrlForKey(row.photoKey),
    status: row.status,
    approvedAt: row.approvedAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
  };
}

export const instructorProfileService = {
  async getMine(actor: AuthUser): Promise<InstructorProfile> {
    const row = await prisma.instructorProfile.findUnique({ where: { userId: actor.id } });
    if (!row) throw new NotFoundError('Instructor profile');
    return toProfile(row);
  },

  /**
   * Updates the profile.
   *
   * `status`, `suspendedAt` and `suspensionReason` are absent from the input
   * schema, so an instructor cannot lift their own suspension by PATCHing
   * their profile — that is an admin action and lives in a different
   * service entirely.
   */
  async updateMine(
    input: InstructorProfileUpdateInput,
    actor: AuthUser,
  ): Promise<InstructorProfile> {
    const existing = await prisma.instructorProfile.findUnique({
      where: { userId: actor.id },
    });
    if (!existing) throw new NotFoundError('Instructor profile');

    const row = await prisma.instructorProfile.update({
      where: { userId: actor.id },
      data: {
        displayName: input.displayName,
        title: input.title,
        bio: input.bio,
        ...(input.photoKey !== undefined ? { photoKey: input.photoKey ?? null } : {}),
      },
    });
    return toProfile(row);
  },
};
