import type {
  AdminApplicationDetail,
  AdminApplicationQuery,
  AdminInstructorQuery,
  ApplicationEvent,
  ApproveApplicationInput,
  InstructorApplicationInput,
  InstructorApplicationUpdateInput,
  MyApplication,
  RejectApplicationInput,
  SuspendInstructorInput,
} from '@cadence/shared';
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import { env } from '../../config/env.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../lib/errors.js';
import { mediaUrlForKey } from '../../lib/media-url.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthUser } from '../../middlewares/types.js';
import { notificationsService, type Tx } from '../notifications/notifications.service.js';

/**
 * Becoming an instructor.
 *
 * Three rules shape almost everything here:
 *
 *  1. **History is append-only.** Every decision is an event row; nothing
 *     overwrites a single `reviewNotes` field. A rejected applicant reapplies
 *     with a *new* application, and the old one stays.
 *  2. **Decisions are idempotent under concurrency.** Every state change is
 *     `updateMany ... WHERE status = 'PENDING'` and checks the affected-row
 *     count. Two admins clicking Approve at the same moment produce one
 *     success and one 409 — never two approvals, and never a lost one.
 *  3. **Approval is one transaction.** The application, the user's role, the
 *     instructor profile, the event and the notifications all land together
 *     or not at all. A half-approved user — role changed, no profile — would
 *     be a user the permission map cannot describe.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres's unique-violation code; the partial index raises it. */
const UNIQUE_VIOLATION = 'P2002';

type EventRow = Prisma.InstructorApplicationEventGetPayload<{
  include: { actor: { select: { id: true; firstName: true; lastName: true } } };
}>;

/**
 * Projects an event for a reader.
 *
 * `forAdmin` is the only thing that decides whether the internal note is
 * included. Defaulting it to `false` means forgetting the argument hides the
 * note rather than leaking it.
 */
function toEvent(row: EventRow, viewerId: string, forAdmin = false): ApplicationEvent {
  return {
    id: row.id,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    ...(forAdmin ? { internalNote: row.internalNote } : {}),
    actor: {
      id: row.actor.id,
      name: `${row.actor.firstName} ${row.actor.lastName}`,
      isSelf: row.actor.id === viewerId,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

/** Events an applicant may see: the admin's private notes are filtered out. */
function applicantVisibleEvents(rows: EventRow[], viewerId: string): ApplicationEvent[] {
  return rows
    .filter((row) => row.action !== 'NOTE_ADDED')
    .map((row) => toEvent(row, viewerId, false));
}

function toApplication(row: {
  id: string;
  professionalTitle: string;
  expertise: string[];
  experience: string;
  biography: string;
  motivation: string;
  profilePhotoKey: string | null;
  portfolioUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  submittedAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    professionalTitle: row.professionalTitle,
    expertise: row.expertise,
    experience: row.experience,
    biography: row.biography,
    motivation: row.motivation,
    profilePhotoUrl: mediaUrlForKey(row.profilePhotoKey),
    portfolioUrl: row.portfolioUrl,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** When a rejected applicant may try again. `null` means "now". */
function reapplyDate(decidedAt: Date | null): Date | null {
  if (env.INSTRUCTOR_REAPPLY_COOLDOWN_DAYS === 0 || !decidedAt) return null;
  return new Date(decidedAt.getTime() + env.INSTRUCTOR_REAPPLY_COOLDOWN_DAYS * DAY_MS);
}

export const applicationsService = {
  // =========================================================================
  // Applicant
  // =========================================================================

  /**
   * The applicant's own view of where they stand.
   *
   * The status returned is *derived*: it folds "no row at all" and "an
   * instructor whose profile is suspended" into the same field the four
   * stored statuses use, so the status page is one switch rather than a
   * decision tree over three sources.
   */
  async getMine(actor: AuthUser): Promise<MyApplication> {
    const [latest, profile, enrolledCourseCount] = await Promise.all([
      prisma.instructorApplication.findFirst({
        where: { userId: actor.id },
        orderBy: { createdAt: 'desc' },
        include: {
          events: {
            orderBy: { createdAt: 'desc' },
            include: { actor: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      }),
      prisma.instructorProfile.findUnique({ where: { userId: actor.id } }),
      prisma.enrollment.count({
        where: { userId: actor.id, status: { not: 'CANCELLED' } },
      }),
    ]);

    const suspended = profile?.status === 'SUSPENDED';
    const status: MyApplication['status'] = suspended
      ? 'SUSPENDED'
      : (latest?.status ?? 'NOT_APPLIED');

    const canReapplyAt =
      latest?.status === 'REJECTED' ? reapplyDate(latest.decidedAt) : null;

    return {
      status,
      application: latest ? toApplication(latest) : null,
      history: latest ? applicantVisibleEvents(latest.events, actor.id) : [],
      canReapplyAt: canReapplyAt?.toISOString() ?? null,
      canReapplyNow:
        latest?.status === 'REJECTED' ? !canReapplyAt || canReapplyAt <= new Date() : false,
      suspension:
        suspended && profile
          ? {
              reason: profile.suspensionReason,
              since: (profile.suspendedAt ?? profile.updatedAt).toISOString(),
            }
          : null,
      instructorSince: profile?.approvedAt.toISOString() ?? null,
      enrolledCourseCount,
    };
  },

  /**
   * Submits an application.
   *
   * Name and email are never read from the body — they come from the
   * session, which is why `InstructorApplicationInput` has no field for
   * them. The duplicate check is belt and braces: the service's read
   * catches the common case with a good message, and the partial unique
   * index catches the race the read cannot.
   */
  async apply(input: InstructorApplicationInput, actor: AuthUser) {
    if (actor.role !== 'LEARNER') {
      throw new UnprocessableError(
        actor.role === 'ADMIN'
          ? 'Administrators already have every instructor capability.'
          : 'You are already an instructor.',
      );
    }

    const previous = await prisma.instructorApplication.findFirst({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
    });

    if (previous?.status === 'PENDING') {
      throw new ConflictError(
        'You already have an application under review. Edit or withdraw it first.',
      );
    }

    if (previous?.status === 'REJECTED') {
      const available = reapplyDate(previous.decidedAt);
      if (available && available > new Date()) {
        throw new UnprocessableError(
          `You can reapply on ${available.toISOString().slice(0, 10)}.`,
        );
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const application = await tx.instructorApplication.create({
          data: {
            userId: actor.id,
            professionalTitle: input.professionalTitle,
            expertise: input.expertise,
            experience: input.experience,
            biography: input.biography,
            motivation: input.motivation,
            ...(input.profilePhotoKey ? { profilePhotoKey: input.profilePhotoKey } : {}),
            ...(input.portfolioUrl ? { portfolioUrl: input.portfolioUrl } : {}),
            status: 'PENDING',
          },
        });

        await tx.instructorApplicationEvent.create({
          data: {
            applicationId: application.id,
            userId: actor.id,
            actorId: actor.id,
            action: 'SUBMITTED',
            toStatus: 'PENDING',
          },
        });

        const admins = await notificationsService.adminIds(tx);
        await notificationsService.notify(
          [
            {
              userId: actor.id,
              type: 'APPLICATION_SUBMITTED',
              title: 'Application submitted',
              body: 'We have your application to teach on Cadence. An admin usually decides within 3 business days.',
              link: '/instructor-application',
            },
            ...admins.map((adminId) => ({
              userId: adminId,
              type: 'APPLICATION_RECEIVED' as const,
              title: 'New instructor application',
              body: `${actor.firstName} ${actor.lastName} applied to teach. Review it in Applications.`,
              link: `/admin/instructor-applications/${application.id}`,
            })),
          ],
          tx,
        );

        return application;
      });
    } catch (error) {
      /*
       * The partial unique index fired, which means another request for this
       * user created a PENDING application between our read and our write.
       * Answering 409 makes the two concurrent submissions indistinguishable
       * from a user who simply clicked twice — which is what they are.
       */
      if (
        error instanceof PrismaNS.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new ConflictError('You already have an application under review.');
      }
      throw error;
    }
  },

  /** Edits a pending application. Anything already decided is immutable. */
  async updateMine(input: InstructorApplicationUpdateInput, actor: AuthUser) {
    const existing = await prisma.instructorApplication.findFirst({
      where: { userId: actor.id, status: 'PENDING' },
    });
    if (!existing) {
      throw new NotFoundError('Pending application');
    }

    return prisma.$transaction(async (tx) => {
      /*
       * Guarded by status in the `where`: if an admin decided the
       * application between the read above and this write, the update
       * matches nothing and we answer 409 rather than silently editing a
       * decision that has already been communicated.
       */
      const result = await tx.instructorApplication.updateMany({
        where: { id: existing.id, status: 'PENDING' },
        data: {
          ...(input.professionalTitle !== undefined
            ? { professionalTitle: input.professionalTitle }
            : {}),
          ...(input.expertise !== undefined ? { expertise: input.expertise } : {}),
          ...(input.experience !== undefined ? { experience: input.experience } : {}),
          ...(input.biography !== undefined ? { biography: input.biography } : {}),
          ...(input.motivation !== undefined ? { motivation: input.motivation } : {}),
          ...(input.profilePhotoKey !== undefined
            ? { profilePhotoKey: input.profilePhotoKey }
            : {}),
          ...(input.portfolioUrl !== undefined ? { portfolioUrl: input.portfolioUrl } : {}),
        },
      });

      if (result.count === 0) {
        throw new ConflictError(
          'This application has already been decided and can no longer be edited.',
        );
      }

      await tx.instructorApplicationEvent.create({
        data: {
          applicationId: existing.id,
          userId: actor.id,
          actorId: actor.id,
          action: 'UPDATED',
          fromStatus: 'PENDING',
          toStatus: 'PENDING',
        },
      });

      return tx.instructorApplication.findUniqueOrThrow({ where: { id: existing.id } });
    });
  },

  /** Withdraws a pending application. The row is kept, as history. */
  async withdrawMine(actor: AuthUser) {
    const existing = await prisma.instructorApplication.findFirst({
      where: { userId: actor.id, status: 'PENDING' },
    });
    if (!existing) throw new NotFoundError('Pending application');

    return prisma.$transaction(async (tx) => {
      const result = await tx.instructorApplication.updateMany({
        where: { id: existing.id, status: 'PENDING' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictError('This application has already been decided.');
      }

      await tx.instructorApplicationEvent.create({
        data: {
          applicationId: existing.id,
          userId: actor.id,
          actorId: actor.id,
          action: 'WITHDRAWN',
          fromStatus: 'PENDING',
          toStatus: 'WITHDRAWN',
        },
      });

      const admins = await notificationsService.adminIds(tx);
      await notificationsService.notify(
        admins.map((adminId) => ({
          userId: adminId,
          type: 'APPLICATION_WITHDRAWN' as const,
          title: 'Application withdrawn',
          body: `${actor.firstName} ${actor.lastName} withdrew their application.`,
          link: '/admin/instructor-applications',
        })),
        tx,
      );

      return tx.instructorApplication.findUniqueOrThrow({ where: { id: existing.id } });
    });
  },

  // =========================================================================
  // Admin review
  // =========================================================================

  async listForAdmin(query: AdminApplicationQuery) {
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const where: Prisma.InstructorApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { professionalTitle: { contains: query.search, mode: 'insensitive' } },
              { expertise: { has: query.search } },
              { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.InstructorApplicationOrderByWithRelationInput[] =
      query.sort === 'newest'
        ? [{ createdAt: 'desc' }]
        : query.sort === 'applicant'
          ? [{ user: { firstName: 'asc' } }]
          : // The queue's default: oldest pending first, so nobody is left waiting.
            [{ createdAt: 'asc' }];

    const [rows, total, grouped] = await Promise.all([
      prisma.instructorApplication.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.instructorApplication.count({ where }),
      prisma.instructorApplication.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, WITHDRAWN: 0, ALL: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        applicant: {
          id: row.user.id,
          firstName: row.user.firstName,
          lastName: row.user.lastName,
          email: row.user.email,
        },
        professionalTitle: row.professionalTitle,
        expertise: row.expertise,
        status: row.status,
        submittedAt: row.submittedAt.toISOString(),
      })),
      meta: buildMeta(query.page, query.pageSize, total),
      counts,
    };
  },

  /** The review screen: the application, the applicant's account, the history. */
  async getForAdmin(id: string, actor: AuthUser): Promise<AdminApplicationDetail> {
    const row = await prisma.instructorApplication.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
        decidedBy: { select: { id: true, firstName: true, lastName: true } },
        events: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!row) throw new NotFoundError('Application');

    const [enrolled, completed, past] = await Promise.all([
      prisma.enrollment.count({
        where: { userId: row.userId, status: { not: 'CANCELLED' } },
      }),
      prisma.enrollment.count({ where: { userId: row.userId, status: 'COMPLETED' } }),
      prisma.instructorApplication.count({
        where: { userId: row.userId, id: { not: id } },
      }),
    ]);

    return {
      ...toApplication(row),
      applicant: {
        id: row.user.id,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        email: row.user.email,
        role: row.user.role,
        memberSince: row.user.createdAt.toISOString(),
        enrolledCourses: enrolled,
        completedCourses: completed,
        pastApplications: past,
      },
      // Admins see the whole trail, internal notes included.
      history: row.events.map((event) => toEvent(event, actor.id, true)),
      decidedBy: row.decidedBy
        ? {
            id: row.decidedBy.id,
            name: `${row.decidedBy.firstName} ${row.decidedBy.lastName}`,
          }
        : null,
    };
  },

  /**
   * Approves an application: role, profile, event and notifications in one
   * transaction, plus the applicant's refresh-token family revoked.
   *
   * Revoking the family is belt and braces. `authenticate` re-reads the role
   * every request, so the new permissions are live immediately regardless;
   * cutting the refresh chain additionally means a token stolen before the
   * decision cannot be rotated into a session carrying the new capability.
   */
  async approve(id: string, input: ApproveApplicationInput, actor: AuthUser) {
    const application = await this.loadPending(id);

    // An admin reviewing their own application would be able to grant
    // themselves a capability unilaterally; the four-eyes rule is cheap.
    if (application.userId === actor.id) {
      throw new ForbiddenError('You cannot decide your own application.');
    }

    return prisma.$transaction(async (tx) => {
      await this.transition(tx, id, 'APPROVED', actor, input.reason ?? null);

      const applicant = await tx.user.update({
        where: { id: application.userId },
        data: { role: 'INSTRUCTOR' },
        select: { id: true, firstName: true, lastName: true },
      });

      /*
       * Upsert, not create: a previously suspended instructor who somehow
       * reaches approval again must be reinstated rather than collide with
       * their existing profile row.
       */
      await tx.instructorProfile.upsert({
        where: { userId: application.userId },
        create: {
          userId: application.userId,
          displayName: `${applicant.firstName} ${applicant.lastName}`,
          title: application.professionalTitle,
          bio: application.biography,
          ...(application.profilePhotoKey ? { photoKey: application.profilePhotoKey } : {}),
          status: 'ACTIVE',
        },
        update: {
          status: 'ACTIVE',
          suspendedAt: null,
          suspendedById: null,
          suspensionReason: null,
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId: application.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await notificationsService.notify(
        [
          {
            userId: application.userId,
            type: 'APPLICATION_APPROVED',
            title: 'Application approved',
            body: "You're now an instructor. Your Teaching workspace is ready.",
            link: '/instructor',
          },
        ],
        tx,
      );

      return tx.instructorApplication.findUniqueOrThrow({ where: { id } });
    });
  },

  /** Rejects an application. The role is untouched; the reason is recorded. */
  async reject(id: string, input: RejectApplicationInput, actor: AuthUser) {
    const application = await this.loadPending(id);
    if (application.userId === actor.id) {
      throw new ForbiddenError('You cannot decide your own application.');
    }

    return prisma.$transaction(async (tx) => {
      await this.transition(tx, id, 'REJECTED', actor, input.reason);

      const available = reapplyDate(new Date());
      await notificationsService.notify(
        [
          {
            userId: application.userId,
            type: 'APPLICATION_REJECTED',
            title: 'Application not approved',
            body: available
              ? `${input.reason} You can reapply on ${available.toISOString().slice(0, 10)}.`
              : input.reason,
            link: '/instructor-application',
          },
        ],
        tx,
      );

      return tx.instructorApplication.findUniqueOrThrow({ where: { id } });
    });
  },

  /** Adds an internal note. Visible to admins only, and never to the applicant. */
  async addNote(id: string, note: string, actor: AuthUser) {
    const application = await prisma.instructorApplication.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!application) throw new NotFoundError('Application');

    // Notes are allowed at any status: an admin may well want to record why
    // something was rejected after the fact.
    return prisma.instructorApplicationEvent.create({
      data: {
        applicationId: id,
        userId: application.userId,
        actorId: actor.id,
        action: 'NOTE_ADDED',
        internalNote: note,
      },
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });
  },

  // =========================================================================
  // Instructor management
  // =========================================================================

  async listInstructors(query: AdminInstructorQuery) {
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const where: Prisma.InstructorProfileWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
              { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      prisma.instructorProfile.findMany({
        where,
        orderBy: [{ approvedAt: 'desc' }],
        skip,
        take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.instructorProfile.count({ where }),
      prisma.instructorProfile.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts = { ACTIVE: 0, SUSPENDED: 0, ALL: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }

    const userIds = rows.map((row) => row.userId);
    const [courseCounts, learnerCounts] = await Promise.all([
      userIds.length
        ? prisma.course.groupBy({
            by: ['createdById', 'status'],
            where: { createdById: { in: userIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.$queryRaw<{ ownerId: string; learners: bigint }[]>`
            SELECT c."createdById" AS "ownerId", COUNT(DISTINCT e."userId") AS "learners"
            FROM "courses" c
            JOIN "enrollments" e ON e."courseId" = c."id" AND e."status" <> 'CANCELLED'
            WHERE c."createdById" = ANY(${userIds}::uuid[])
            GROUP BY c."createdById"
          `
        : Promise.resolve([]),
    ]);

    const published = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const row of courseCounts) {
      totals.set(row.createdById, (totals.get(row.createdById) ?? 0) + row._count._all);
      if (row.status === 'PUBLISHED') {
        published.set(row.createdById, (published.get(row.createdById) ?? 0) + row._count._all);
      }
    }
    const learners = new Map(learnerCounts.map((row) => [row.ownerId, Number(row.learners)]));

    return {
      items: rows.map((row) => ({
        userId: row.userId,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        email: row.user.email,
        displayName: row.displayName,
        title: row.title,
        photoUrl: mediaUrlForKey(row.photoKey),
        status: row.status,
        publishedCourses: published.get(row.userId) ?? 0,
        totalCourses: totals.get(row.userId) ?? 0,
        learners: learners.get(row.userId) ?? 0,
        instructorSince: row.approvedAt.toISOString(),
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
        suspensionReason: row.suspensionReason,
      })),
      meta: buildMeta(query.page, query.pageSize, total),
      counts,
    };
  },

  /**
   * Suspends an instructor.
   *
   * Teaching stops; learning does not. The role stays INSTRUCTOR and no
   * course, enrollment or progress row is touched — the permission map reads
   * the profile status and withholds the teaching permissions, which is the
   * whole mechanism.
   */
  async suspend(userId: string, input: SuspendInstructorInput, actor: AuthUser) {
    const profile = await prisma.instructorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError('Instructor');
    if (profile.status === 'SUSPENDED') {
      throw new ConflictError('This instructor is already suspended.');
    }

    return prisma.$transaction(async (tx) => {
      const result = await tx.instructorProfile.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspendedById: actor.id,
          suspensionReason: input.reason,
        },
      });
      if (result.count === 0) {
        throw new ConflictError('This instructor is already suspended.');
      }

      await tx.instructorApplicationEvent.create({
        data: {
          userId,
          actorId: actor.id,
          action: 'SUSPENDED',
          reason: input.reason,
        },
      });

      // Cut the refresh chain, as on approval: the access check is live
      // either way, but a rotated token must not outlive the decision.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await notificationsService.notify(
        [
          {
            userId,
            type: 'INSTRUCTOR_SUSPENDED',
            title: 'Instructor access suspended',
            body: input.reason,
            link: '/instructor-application',
          },
        ],
        tx,
      );

      return tx.instructorProfile.findUniqueOrThrow({ where: { userId } });
    });
  },

  async reinstate(userId: string, reason: string | undefined, actor: AuthUser) {
    const profile = await prisma.instructorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError('Instructor');
    if (profile.status === 'ACTIVE') {
      throw new ConflictError('This instructor is already active.');
    }

    return prisma.$transaction(async (tx) => {
      const result = await tx.instructorProfile.updateMany({
        where: { userId, status: 'SUSPENDED' },
        data: {
          status: 'ACTIVE',
          suspendedAt: null,
          suspendedById: null,
          suspensionReason: null,
        },
      });
      if (result.count === 0) throw new ConflictError('This instructor is already active.');

      await tx.instructorApplicationEvent.create({
        data: {
          userId,
          actorId: actor.id,
          action: 'REINSTATED',
          ...(reason ? { reason } : {}),
        },
      });

      await notificationsService.notify(
        [
          {
            userId,
            type: 'INSTRUCTOR_REINSTATED',
            title: 'Instructor access restored',
            body: reason ?? 'Your Teaching workspace is available again.',
            link: '/instructor',
          },
        ],
        tx,
      );

      return tx.instructorProfile.findUniqueOrThrow({ where: { userId } });
    });
  },

  // =========================================================================
  // Shared internals
  // =========================================================================

  /** Loads an application that is still open for a decision. */
  async loadPending(id: string) {
    const application = await prisma.instructorApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundError('Application');
    if (application.status !== 'PENDING') {
      throw new ConflictError(
        `This application was already ${application.status.toLowerCase()}.`,
      );
    }
    return application;
  },

  /**
   * The guarded state change every decision goes through.
   *
   * `WHERE status = 'PENDING'` plus the affected-row count is what makes two
   * simultaneous decisions safe: whichever transaction commits second
   * matches no rows and raises 409, so the loser is told rather than
   * silently overwriting the winner.
   */
  async transition(
    tx: Tx,
    id: string,
    to: 'APPROVED' | 'REJECTED',
    actor: AuthUser,
    reason: string | null,
  ): Promise<void> {
    const result = await tx.instructorApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: to,
        decidedAt: new Date(),
        decidedById: actor.id,
        decisionReason: reason,
      },
    });

    if (result.count === 0) {
      throw new ConflictError('This application has already been decided by someone else.');
    }

    const application = await tx.instructorApplication.findUniqueOrThrow({
      where: { id },
      select: { userId: true },
    });

    await tx.instructorApplicationEvent.create({
      data: {
        applicationId: id,
        userId: application.userId,
        actorId: actor.id,
        action: to,
        fromStatus: 'PENDING',
        toStatus: to,
        ...(reason ? { reason } : {}),
      },
    });
  },
};
