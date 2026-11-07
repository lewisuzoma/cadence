import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  createCourse,
  createInstructor,
  createUser,
  loginAs,
  resetDb,
} from '../helpers/factories.js';

/**
 * Course analytics and learner monitoring.
 *
 * The aggregates are checked against a fixture whose numbers are worked
 * out by hand below, so a wrong SQL change shows up as a wrong number
 * rather than as a different-but-plausible one.
 */

/**
 * The fixture.
 *
 * One course, 4 lessons, 5 learners:
 *
 *   | learner | completed | progress | band   | status      |
 *   |---------|-----------|----------|--------|-------------|
 *   | Alpha   | 4 of 4    | 100%     | 100    | COMPLETED   |
 *   | Bravo   | 3 of 4    |  75%     | 75-99  | IN_PROGRESS |
 *   | Charlie | 2 of 4    |  50%     | 50-75  | IN_PROGRESS |
 *   | Delta   | 1 of 4    |  25%     | 25-50  | INACTIVE    |
 *   | Echo    | 0 of 4    |   0%     | 0-25   | NOT_STARTED |
 *
 * Plus two people who must NOT be counted: the owner and an admin, each
 * holding an enrollment.
 *
 * Expected:
 *   enrolled          5
 *   completed         1
 *   completion rate   1/5 = 20%
 *   average progress  (100+75+50+25+0)/5 = 50%
 *   lessons completed 4+3+2+1+0 = 10
 *   active            4  (Delta is outside the 14-day window)
 */
const EXPECTED = {
  enrolled: 5,
  completed: 1,
  completionRate: 20,
  averageProgress: 50,
  lessonsCompleted: 10,
  active: 4,
  inactive: 1,
};

async function buildFixture() {
  const { user: owner } = await createInstructor({ email: 'analytics-owner@test.dev' });
  const { course, lessons } = await createCourse({
    ownerId: owner.id,
    status: 'PUBLISHED',
    lessonCount: 4,
    durationSeconds: 600,
    title: 'Production Node.js APIs with TypeScript',
  });

  const plan: { name: string; completed: number; daysSinceActivity: number }[] = [
    { name: 'Alpha', completed: 4, daysSinceActivity: 1 },
    { name: 'Bravo', completed: 3, daysSinceActivity: 2 },
    { name: 'Charlie', completed: 2, daysSinceActivity: 3 },
    { name: 'Delta', completed: 1, daysSinceActivity: 90 },
    { name: 'Echo', completed: 0, daysSinceActivity: 0 },
  ];

  const learners: { id: string; name: string }[] = [];

  for (const entry of plan) {
    const learner = await createUser({
      email: `${entry.name.toLowerCase()}@test.dev`,
      firstName: entry.name,
      lastName: 'Learner',
    });
    learners.push({ id: learner.id, name: entry.name });

    const activity = new Date(Date.now() - entry.daysSinceActivity * 24 * 60 * 60 * 1000);

    await prisma.enrollment.create({
      data: {
        userId: learner.id,
        courseId: course.id,
        // Spread across weeks so the time series has more than one point.
        enrolledAt: new Date(Date.now() - (40 - plan.indexOf(entry) * 7) * 24 * 60 * 60 * 1000),
        status: entry.completed === 4 ? 'COMPLETED' : 'ACTIVE',
        ...(entry.completed === 4
          ? { completedAt: activity, firstCompletedAt: activity }
          : {}),
        // Echo has never opened the course.
        ...(entry.completed > 0 || entry.name !== 'Echo'
          ? { lastAccessedAt: activity }
          : {}),
      },
    });

    for (let index = 0; index < entry.completed; index++) {
      await prisma.lessonProgress.create({
        data: {
          userId: learner.id,
          lessonId: lessons[index]!.id,
          maxWatchedSeconds: 600,
          lastPositionSeconds: 600,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: activity,
          updatedAt: activity,
        },
      });
    }
  }

  // Echo: enrolled but never touched anything, so no lastAccessedAt.
  await prisma.enrollment.update({
    where: {
      userId_courseId: {
        userId: learners.find((l) => l.name === 'Echo')!.id,
        courseId: course.id,
      },
    },
    data: { lastAccessedAt: null },
  });

  // The two who must not be counted.
  const admin = await createUser({ email: 'analytics-admin@test.dev', role: 'ADMIN' });
  await prisma.enrollment.create({
    data: { userId: admin.id, courseId: course.id },
  });
  await prisma.lessonProgress.create({
    data: {
      userId: admin.id,
      lessonId: lessons[0]!.id,
      maxWatchedSeconds: 600,
      completionPercentage: 100,
      isCompleted: true,
      completedAt: new Date(),
    },
  });
  // The owner, enrolled directly (the API refuses this, but a historical
  // row must still be excluded rather than counted).
  await prisma.enrollment.create({
    data: { userId: owner.id, courseId: course.id },
  });

  return { owner, course, lessons, learners, admin };
}

describe('course analytics', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // =========================================================================
  describe('aggregates', () => {
    it('matches the hand-calculated fixture', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      expect(response.status).toBe(200);

      const { stats } = response.body.data as {
        stats: Record<string, number | null>;
      };
      expect(stats.enrolled).toBe(EXPECTED.enrolled);
      expect(stats.completed).toBe(EXPECTED.completed);
      expect(stats.completionRate).toBe(EXPECTED.completionRate);
      expect(stats.averageProgress).toBe(EXPECTED.averageProgress);
      expect(stats.lessonsCompleted).toBe(EXPECTED.lessonsCompleted);
      expect(stats.active).toBe(EXPECTED.active);
      expect(stats.inactive).toBe(EXPECTED.inactive);
    });

    it('excludes the owner and admins from every figure', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      // 7 enrollment rows exist; 5 are learners.
      expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(7);
      expect(response.body.data.stats.enrolled).toBe(5);
      // The admin's completed lesson is not in the total either.
      expect(response.body.data.stats.lessonsCompleted).toBe(10);
    });

    it('returns every progress band, including the empty ones', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      const distribution = response.body.data.progressDistribution as {
        band: string;
        count: number;
      }[];

      expect(distribution.map((row) => row.band)).toEqual([
        '0-25',
        '25-50',
        '50-75',
        '75-99',
        '100',
      ]);
      // One learner in each band, by construction.
      expect(distribution.every((row) => row.count === 1)).toBe(true);
    });

    it('reports completion per lesson in course order, showing the drop-off', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      const perLesson = response.body.data.lessonCompletion as {
        order: number;
        completed: number;
        percentage: number;
      }[];

      expect(perLesson).toHaveLength(4);
      // Lesson 1 done by 4 learners, 2 by 3, 3 by 2, 4 by 1 — a clean
      // descending curve, which is what the drop-off chart draws.
      expect(perLesson.map((row) => row.completed)).toEqual([4, 3, 2, 1]);
      expect(perLesson.map((row) => row.percentage)).toEqual([80, 60, 40, 20]);
    });

    it('groups enrollments into UTC weeks', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      const series = response.body.data.enrollmentsOverTime as {
        weekStart: string;
        count: number;
      }[];

      expect(series.length).toBeGreaterThan(1);
      expect(series.reduce((sum, row) => sum + row.count, 0)).toBe(5);
      // Ascending, and each point is a Monday in UTC.
      const times = series.map((row) => row.weekStart);
      expect([...times].sort()).toEqual(times);
      for (const point of series) {
        expect(new Date(point.weekStart).getUTCDay()).toBe(1);
      }
    });

    it('reports zeroes and empty series for a course with no learners', async () => {
      const { user } = await createInstructor({ email: 'empty@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('empty@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.stats).toMatchObject({
        enrolled: 0,
        active: 0,
        completed: 0,
        completionRate: 0,
        averageProgress: 0,
        lessonsCompleted: 0,
      });
      expect(response.body.data.enrollmentsOverTime).toEqual([]);
      // The lessons are still listed, at zero: a lesson nobody reached is
      // exactly what the drop-off chart is for.
      expect(response.body.data.lessonCompletion).toHaveLength(2);
      expect(response.body.data.progressDistribution).toHaveLength(5);
    });

    it('states the active window it used', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');
      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      expect(response.body.data.activeDays).toBe(14);
    });
  });

  // =========================================================================
  describe('the enrolled-learners table', () => {
    it('lists learners with their progress in this course', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?pageSize=50`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(5);
      expect(response.body.meta.total).toBe(5);

      const alpha = (response.body.data as { firstName: string }[]).find(
        (row) => row.firstName === 'Alpha',
      ) as unknown as { progressPercentage: number; displayStatus: string };
      expect(alpha.progressPercentage).toBe(100);
      expect(alpha.displayStatus).toBe('COMPLETED');
    });

    it('searches by name and by email, server-side', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const byName = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?search=Bravo`,
      );
      expect(byName.body.data).toHaveLength(1);
      expect(byName.body.data[0].firstName).toBe('Bravo');

      const byEmail = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?search=charlie@test.dev`,
      );
      expect(byEmail.body.data).toHaveLength(1);
      expect(byEmail.body.data[0].firstName).toBe('Charlie');
    });

    it('filters by status and by progress band', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const completed = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?status=COMPLETED`,
      );
      expect(completed.body.data).toHaveLength(1);
      expect(completed.body.data[0].firstName).toBe('Alpha');

      const inactive = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?status=INACTIVE`,
      );
      expect(inactive.body.data).toHaveLength(1);
      expect(inactive.body.data[0].firstName).toBe('Delta');

      const band = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?band=50-75`,
      );
      expect(band.body.data).toHaveLength(1);
      expect(band.body.data[0].firstName).toBe('Charlie');
    });

    it('sorts and paginates', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const sorted = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?sort=progress&direction=desc&pageSize=50`,
      );
      expect(
        (sorted.body.data as { progressPercentage: number }[]).map(
          (row) => row.progressPercentage,
        ),
      ).toEqual([100, 75, 50, 25, 0]);

      const page = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners?sort=progress&direction=desc&page=2&pageSize=2`,
      );
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta.total).toBe(5);
      expect(
        (page.body.data as { progressPercentage: number }[]).map(
          (row) => row.progressPercentage,
        ),
      ).toEqual([50, 25]);
    });

    it('exposes only name, email and progress in this course', async () => {
      const { course } = await buildFixture();
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners`,
      );
      const row = response.body.data[0] as Record<string, unknown>;

      expect(Object.keys(row).sort()).toEqual(
        [
          'completedLessons',
          'displayStatus',
          'email',
          'enrolledAt',
          'enrollmentStatus',
          'firstName',
          'lastActivityAt',
          'lastName',
          'progressPercentage',
          'totalLessons',
          'userId',
        ].sort(),
      );
      // Nothing about the learner's account leaks through.
      expect(row).not.toHaveProperty('role');
      expect(row).not.toHaveProperty('isActive');
      expect(row).not.toHaveProperty('passwordHash');
      expect(row).not.toHaveProperty('createdAt');
    });
  });

  // =========================================================================
  describe('individual learner progress', () => {
    it('shows lesson-by-lesson progress and the last watched position', async () => {
      const { course, learners } = await buildFixture();
      const bravo = learners.find((l) => l.name === 'Bravo')!;
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners/${bravo.id}/progress`,
      );
      expect(response.status).toBe(200);

      const data = response.body.data as {
        progressPercentage: number;
        completedLessons: number;
        lessons: { status: string }[];
        lastWatched: { title: string } | null;
        course: { averageProgress: number };
      };
      expect(data.progressPercentage).toBe(75);
      expect(data.completedLessons).toBe(3);
      expect(data.lessons.map((l) => l.status)).toEqual([
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
        'NOT_STARTED',
      ]);
      expect(data.lastWatched).not.toBeNull();
      // The course average is shown for comparison, as the artifact does.
      expect(data.course.averageProgress).toBe(EXPECTED.averageProgress);
    });

    it('answers 404 for a learner who is not enrolled in this course', async () => {
      const { course } = await buildFixture();
      const stranger = await createUser({ email: 'stranger@test.dev' });
      const agent = await loginAs('analytics-owner@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners/${stranger.id}/progress`,
      );
      expect(response.status).toBe(404);
    });

    it('answers 404 for a learner enrolled only in someone else’s course', async () => {
      const { course: mine } = await buildFixture();
      const other = await createInstructor({ email: 'otherowner@test.dev' });
      const { course: theirs } = await createCourse({
        ownerId: other.user.id,
        status: 'PUBLISHED',
      });
      const theirLearner = await createUser({ email: 'theirlearner@test.dev' });
      await prisma.enrollment.create({
        data: { userId: theirLearner.id, courseId: theirs.id },
      });

      const agent = await loginAs('analytics-owner@test.dev');
      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${mine.id}/learners/${theirLearner.id}/progress`,
      );
      expect(response.status).toBe(404);
    });

    it('exposes nothing about the learner beyond this course', async () => {
      const { course, learners } = await buildFixture();
      const alpha = learners.find((l) => l.name === 'Alpha')!;

      // Alpha is also studying elsewhere; none of it may appear.
      const other = await createInstructor({ email: 'elsewhere@test.dev' });
      const { course: secret } = await createCourse({
        ownerId: other.user.id,
        status: 'PUBLISHED',
        title: 'A Totally Unrelated Course',
      });
      await prisma.enrollment.create({
        data: { userId: alpha.id, courseId: secret.id },
      });

      const agent = await loginAs('analytics-owner@test.dev');
      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/learners/${alpha.id}/progress`,
      );
      expect(response.status).toBe(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('A Totally Unrelated Course');
      expect(body).not.toContain(secret.id);
      expect(response.body.data.learner).not.toHaveProperty('role');
      expect(response.body.data.learner).not.toHaveProperty('isActive');
    });
  });

  // =========================================================================
  describe('scope', () => {
    it('refuses analytics for another instructor’s course with 404', async () => {
      const alice = await createInstructor({ email: 'alice8@test.dev' });
      await createInstructor({ email: 'bob8@test.dev' });
      const { course } = await createCourse({
        ownerId: alice.user.id,
        status: 'PUBLISHED',
      });
      const bob = await loginAs('bob8@test.dev');

      expect(
        (await bob.agent.get(`/api/v1/instructor/courses/${course.id}/analytics`)).status,
      ).toBe(404);
      expect(
        (await bob.agent.get(`/api/v1/instructor/courses/${course.id}/learners`)).status,
      ).toBe(404);
    });

    it('lets an admin see analytics for any course', async () => {
      const { course } = await buildFixture();
      await createUser({ email: 'superadmin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('superadmin@test.dev');

      const response = await admin.agent.get(
        `/api/v1/instructor/courses/${course.id}/analytics`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.stats.enrolled).toBe(EXPECTED.enrolled);
    });

    it('refuses analytics to a learner', async () => {
      const { course } = await buildFixture();
      await createUser({ email: 'nosyparker@test.dev' });
      const agent = await loginAs('nosyparker@test.dev');

      expect(
        (await agent.agent.get(`/api/v1/instructor/courses/${course.id}/analytics`)).status,
      ).toBe(403);
    });
  });
});
