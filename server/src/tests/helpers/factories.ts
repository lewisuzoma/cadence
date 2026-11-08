import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../app.js';
import { CSRF_COOKIE } from '../../lib/cookies.js';
import { hashPassword } from '../../lib/password.js';
import type { InstructorApplicationStatus, Role } from '@cadence/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * Test fixtures and a cookie-aware API client.
 *
 * `resetDb` truncates instead of dropping: it is far faster than re-running
 * migrations between files, and `RESTART IDENTITY CASCADE` leaves the schema
 * (and therefore every constraint under test) intact.
 */

let app: Express | undefined;
export function testApp(): Express {
  app ??= createApp();
  return app;
}

export async function resetDb(): Promise<void> {
  // Every table, so a row left behind by one file cannot make the next one's
  // assertions pass or fail for the wrong reason.  CASCADE handles the
  // foreign keys; listing the tables explicitly means a new one added to the
  // schema and forgotten here shows up as a test that pollutes its
  // neighbours, which is easier to diagnose than a silent truncation gap.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "notifications", "course_events", "instructor_application_events",
                   "instructor_applications", "instructor_profiles",
                   "course_version_lessons", "course_versions",
                   "lesson_progress", "enrollments", "lessons", "modules",
                   "courses", "media_assets", "refresh_tokens",
                   "password_reset_tokens", "users"
    RESTART IDENTITY CASCADE
  `);
}

export const TEST_PASSWORD = 'Password123';

export async function createUser(overrides?: {
  email?: string;
  role?: Role;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  password?: string;
}) {
  const email = overrides?.email ?? `user-${Math.random().toString(36).slice(2, 10)}@test.dev`;
  return prisma.user.create({
    data: {
      firstName: overrides?.firstName ?? 'Test',
      lastName: overrides?.lastName ?? 'User',
      email,
      passwordHash: await hashPassword(overrides?.password ?? TEST_PASSWORD),
      role: overrides?.role ?? 'LEARNER',
      isActive: overrides?.isActive ?? true,
    },
  });
}

/**
 * An approved instructor: the INSTRUCTOR role *and* the profile that grants
 * the status, created together because one without the other is a state the
 * approval transaction never produces.
 */
export async function createInstructor(overrides?: {
  email?: string;
  firstName?: string;
  lastName?: string;
  suspended?: boolean;
  suspensionReason?: string;
  title?: string;
}) {
  const user = await createUser({
    ...(overrides?.email ? { email: overrides.email } : {}),
    ...(overrides?.firstName ? { firstName: overrides.firstName } : {}),
    ...(overrides?.lastName ? { lastName: overrides.lastName } : {}),
    role: 'INSTRUCTOR',
  });

  const suspended = overrides?.suspended ?? false;
  const profile = await prisma.instructorProfile.create({
    data: {
      userId: user.id,
      displayName: `${user.firstName} ${user.lastName}`,
      title: overrides?.title ?? 'Senior engineer',
      bio: 'A test instructor created by the suite, with a biography long enough to satisfy the schema minimum of eighty characters.',
      status: suspended ? 'SUSPENDED' : 'ACTIVE',
      ...(suspended
        ? {
            suspendedAt: new Date(),
            suspensionReason:
              overrides?.suspensionReason ?? 'Suspended by the test suite for assertions.',
          }
        : {}),
    },
  });

  return { user, profile };
}

/** A PENDING application for an existing learner. */
export async function createApplication(
  userId: string,
  overrides?: { status?: InstructorApplicationStatus; title?: string },
) {
  return prisma.instructorApplication.create({
    data: {
      userId,
      professionalTitle: overrides?.title ?? 'Senior backend engineer',
      expertise: ['TypeScript', 'Node.js'],
      experience:
        'Four years running internal workshops and mentoring new hires through their first production API.',
      biography:
        'I build and maintain payment APIs. I care about boring, reliable systems: typed boundaries, good error messages and tests that catch real bugs.',
      motivation:
        'I want to teach the whole loop, from typed boundaries through to running the thing in production.',
      status: overrides?.status ?? 'PENDING',
      ...(overrides?.status === 'REJECTED'
        ? { decisionReason: 'Rejected by the test suite.', decidedAt: new Date() }
        : {}),
    },
  });
}

/**
 * A signed-in client.  Supertest's agent keeps the cookie jar, and the CSRF
 * token is lifted out of the Set-Cookie header and echoed on every mutation,
 * exactly as the browser client does.
 */
export type ApiAgent = {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
  userId: string;
  withCsrf: <T extends { set: (field: string, value: string) => T }>(req: T) => T;
};

function extractCsrf(setCookie: string[] | undefined): string {
  const header = (setCookie ?? []).find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`));
  if (!header) throw new Error('No csrf_token cookie was set');
  return decodeURIComponent(header.split('=')[1]!.split(';')[0]!);
}

export async function loginAs(email: string, password = TEST_PASSWORD): Promise<ApiAgent> {
  const agent = request.agent(testApp());
  const response = await agent.post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${response.text}`);
  }
  const csrfToken = extractCsrf(response.headers['set-cookie'] as string[] | undefined);
  return {
    agent,
    csrfToken,
    userId: response.body.data.user.id as string,
    withCsrf: (req) => req.set('X-CSRF-Token', csrfToken),
  };
}

export async function registerAndLogin(email: string): Promise<ApiAgent> {
  const agent = request.agent(testApp());
  const response = await agent.post('/api/v1/auth/register').send({
    firstName: 'New',
    lastName: 'Learner',
    email,
    password: TEST_PASSWORD,
    confirmPassword: TEST_PASSWORD,
  });
  if (response.status !== 201) {
    throw new Error(`Register failed: ${response.status} ${response.text}`);
  }
  const csrfToken = extractCsrf(response.headers['set-cookie'] as string[] | undefined);
  return {
    agent,
    csrfToken,
    userId: response.body.data.user.id as string,
    withCsrf: (req) => req.set('X-CSRF-Token', csrfToken),
  };
}

/**
 * A complete course: 1 module, N lessons, published by default.  Durations
 * default to 100 seconds so the 90% threshold lands on a round 90.
 */
export async function createCourse(options?: {
  adminId?: string;
  /** Alias for `adminId`, for tests where the owner is an instructor. */
  ownerId?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  lessonCount?: number;
  durationSeconds?: number;
  slug?: string;
  title?: string;
  previewFirst?: boolean;
  category?: string;
  difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}) {
  const adminId =
    options?.ownerId ?? options?.adminId ?? (await createUser({ role: 'ADMIN' })).id;
  const suffix = Math.random().toString(36).slice(2, 8);
  const title = options?.title ?? `Test Course ${suffix}`;
  const lessonCount = options?.lessonCount ?? 3;
  const durationSeconds = options?.durationSeconds ?? 100;

  const course = await prisma.course.create({
    data: {
      title,
      slug: options?.slug ?? `test-course-${suffix}`,
      description:
        'A course created by the test suite for assertions. It is deliberately long enough to clear the eighty-character minimum the publish checklist applies to the full description.',
      shortDescription: 'A course created by the test suite.',
      category: options?.category ?? 'Engineering',
      thumbnailUrl: '/thumbnails/test.svg',
      difficulty: options?.difficulty ?? 'BEGINNER',
      status: options?.status ?? 'PUBLISHED',
      createdById: adminId,
      publishedAt: (options?.status ?? 'PUBLISHED') === 'PUBLISHED' ? new Date() : null,
    },
  });

  const module = await prisma.module.create({
    data: { courseId: course.id, title: 'Module 1', order: 1 },
  });

  const lessons = [];
  for (let index = 0; index < lessonCount; index++) {
    lessons.push(
      await prisma.lesson.create({
        data: {
          moduleId: module.id,
          courseId: course.id,
          title: `Lesson ${index + 1}`,
          description: 'Lesson body',
          videoUrl: 'https://example.test/video.mp4',
          durationSeconds,
          order: index + 1,
          isPreview: index === 0 ? (options?.previewFirst ?? false) : false,
        },
      }),
    );
  }

  /*
   * A published course must have a live version, because that is what
   * learners read. Creating one here keeps the factory faithful to what
   * the publish flow actually produces — without it, a fixture would be
   * in a state the application can never reach, and the tests would be
   * exercising a course the catalogue cannot show.
   *
   * ARCHIVED courses get one too: they were published once, and their
   * enrolled learners still read that version.
   */
  const status = options?.status ?? 'PUBLISHED';
  if (status === 'PUBLISHED' || status === 'ARCHIVED') {
    const version = await prisma.courseVersion.create({
      data: {
        courseId: course.id,
        version: 1,
        title: course.title,
        shortDescription: course.shortDescription,
        description: course.description,
        category: course.category,
        difficulty: course.difficulty,
        thumbnailUrl: course.thumbnailUrl,
        learningObjectives: course.learningObjectives,
        prerequisites: course.prerequisites,
        targetAudience: course.targetAudience,
        publishedById: adminId,
      },
    });

    if (lessons.length > 0) {
      await prisma.courseVersionLesson.createMany({
        data: lessons.map((lesson) => ({
          versionId: version.id,
          lessonId: lesson.id,
          moduleTitle: module.title,
          moduleOrder: module.order,
          title: lesson.title,
          description: lesson.description,
          durationSeconds: lesson.durationSeconds,
          order: lesson.order,
          isPreview: lesson.isPreview,
        })),
      });
    }

    await prisma.course.update({
      where: { id: course.id },
      data: { liveVersionId: version.id },
    });
  }

  return { course, module, lessons, adminId };
}

export const api = () => request(testApp());
