import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../app.js';
import { CSRF_COOKIE } from '../../lib/cookies.js';
import { hashPassword } from '../../lib/password.js';
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
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "lesson_progress", "enrollments", "lessons", "modules",
                   "courses", "refresh_tokens", "password_reset_tokens", "users"
    RESTART IDENTITY CASCADE
  `);
}

export const TEST_PASSWORD = 'Password123';

export async function createUser(overrides?: {
  email?: string;
  role?: 'LEARNER' | 'ADMIN';
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
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  lessonCount?: number;
  durationSeconds?: number;
  slug?: string;
  title?: string;
  previewFirst?: boolean;
  category?: string;
  difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}) {
  const adminId = options?.adminId ?? (await createUser({ role: 'ADMIN' })).id;
  const suffix = Math.random().toString(36).slice(2, 8);
  const title = options?.title ?? `Test Course ${suffix}`;
  const lessonCount = options?.lessonCount ?? 3;
  const durationSeconds = options?.durationSeconds ?? 100;

  const course = await prisma.course.create({
    data: {
      title,
      slug: options?.slug ?? `test-course-${suffix}`,
      description: 'A course created by the test suite for assertions.',
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

  return { course, module, lessons, adminId };
}

export const api = () => request(testApp());
