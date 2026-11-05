import { beforeEach, describe, expect, it } from 'vitest';
import { createCourse, createUser, loginAs, resetDb } from '../helpers/factories.js';

/**
 * Dashboard aggregates.
 *
 * Every assertion compares the API's numbers against fixtures built in the
 * test, so a hardcoded or miscounted aggregate fails here. The spec is
 * explicit that dashboard numbers must never be invented.
 */
describe('dashboards', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('learner', () => {
    it('counts courses, lessons and watch time from real rows', async () => {
      await createUser({ email: 'learner@test.dev' });
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;

      // Course A: 4 lessons, two completed, one part-watched.
      const a = await createCourse({ adminId, lessonCount: 4, durationSeconds: 100 });
      // Course B: 2 lessons, both completed, so the course is COMPLETED.
      const b = await createCourse({ adminId, lessonCount: 2, durationSeconds: 100 });

      const session = await loginAs('learner@test.dev');
      await session.withCsrf(session.agent.post(`/api/v1/courses/${a.course.id}/enroll`));
      await session.withCsrf(session.agent.post(`/api/v1/courses/${b.course.id}/enroll`));

      for (const lessonId of [a.lessons[0]!.id, a.lessons[1]!.id]) {
        await session
          .withCsrf(session.agent.post(`/api/v1/lessons/${lessonId}/complete`))
          .send({ positionSeconds: 100 });
      }
      await session
        .withCsrf(session.agent.put(`/api/v1/lessons/${a.lessons[2]!.id}/progress`))
        .send({ positionSeconds: 30 });

      for (const lessonId of b.lessons) {
        await session
          .withCsrf(session.agent.post(`/api/v1/lessons/${lessonId.id}/complete`))
          .send({ positionSeconds: 100 });
      }

      const response = await session.agent.get('/api/v1/dashboard/learner');
      expect(response.status).toBe(200);
      const { stats, continueLearning, courses } = response.body.data;

      expect(stats.enrolledCourses).toBe(2);
      expect(stats.completedCourses).toBe(1); // course B
      expect(stats.inProgressCourses).toBe(1); // course A
      expect(stats.completedLessons).toBe(4); // 2 from A + 2 from B
      expect(stats.totalLessons).toBe(6); // 4 + 2
      expect(stats.overallProgressPercentage).toBe(67); // 4/6
      // 100 + 100 + 30 + 100 + 100
      expect(stats.watchedSeconds).toBe(430);

      // "Continue learning" points at the most recently touched lesson.
      expect(continueLearning).not.toBeNull();
      expect(continueLearning.lessonId).toBe(a.lessons[2]!.id);
      expect(continueLearning.lastPositionSeconds).toBe(30);

      expect(courses).toHaveLength(2);
    });

    it('is all zeroes with an empty state for a new learner', async () => {
      await createUser({ email: 'new@test.dev' });
      const session = await loginAs('new@test.dev');

      const response = await session.agent.get('/api/v1/dashboard/learner');
      expect(response.body.data.stats).toMatchObject({
        enrolledCourses: 0,
        completedCourses: 0,
        completedLessons: 0,
        totalLessons: 0,
        overallProgressPercentage: 0,
        watchedSeconds: 0,
      });
      expect(response.body.data.continueLearning).toBeNull();
      expect(response.body.data.courses).toHaveLength(0);
      expect(response.body.data.recentActivity).toHaveLength(0);
    });

    it('never mixes one learner numbers into another dashboard', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      const { course, lessons } = await createCourse({ adminId, lessonCount: 2, durationSeconds: 100 });

      await createUser({ email: 'busy@test.dev' });
      const busy = await loginAs('busy@test.dev');
      await busy.withCsrf(busy.agent.post(`/api/v1/courses/${course.id}/enroll`));
      await busy
        .withCsrf(busy.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
        .send({ positionSeconds: 100 });

      await createUser({ email: 'idle@test.dev' });
      const idle = await loginAs('idle@test.dev');

      const response = await idle.agent.get('/api/v1/dashboard/learner');
      expect(response.body.data.stats.completedLessons).toBe(0);
      expect(response.body.data.stats.enrolledCourses).toBe(0);
    });

    it('builds an activity feed from enrollments and completions', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      const { course, lessons } = await createCourse({ adminId, lessonCount: 2, durationSeconds: 100 });
      await createUser({ email: 'learner@test.dev' });
      const session = await loginAs('learner@test.dev');

      await session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`));
      await session
        .withCsrf(session.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
        .send({ positionSeconds: 100 });

      const response = await session.agent.get('/api/v1/activity/me');
      expect(response.status).toBe(200);
      const types = (response.body.data as { type: string }[]).map((item) => item.type);
      expect(types).toContain('ENROLLED');
      expect(types).toContain('LESSON_COMPLETED');
      // A learner's own feed does not expose other users.
      expect(response.body.data[0].user).toBeNull();
    });
  });

  describe('admin', () => {
    it('counts platform totals from real rows', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      await createUser({ email: 'l1@test.dev' });
      await createUser({ email: 'l2@test.dev' });
      await createUser({ email: 'l3@test.dev', isActive: false });

      const published = await createCourse({ adminId, lessonCount: 3, status: 'PUBLISHED' });
      await createCourse({ adminId, lessonCount: 2, status: 'DRAFT' });
      await createCourse({ adminId, lessonCount: 1, status: 'ARCHIVED' });

      const learner = await loginAs('l1@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${published.course.id}/enroll`));
      await learner
        .withCsrf(learner.agent.post(`/api/v1/lessons/${published.lessons[0]!.id}/complete`))
        .send({ positionSeconds: 100 });

      const admin = await loginAs('admin@test.dev');
      const response = await admin.agent.get('/api/v1/dashboard/admin');
      expect(response.status).toBe(200);
      const { stats, coursePerformance } = response.body.data;

      expect(stats.learners).toBe(3); // admins are not learners
      expect(stats.activeLearners).toBe(2); // l3 is deactivated
      expect(stats.courses).toBe(3);
      expect(stats.publishedCourses).toBe(1);
      expect(stats.draftCourses).toBe(1);
      expect(stats.archivedCourses).toBe(1);
      expect(stats.lessons).toBe(6); // 3 + 2 + 1
      expect(stats.enrollments).toBe(1);
      expect(stats.completedLessons).toBe(1);

      // Course performance covers published courses, with a real rate.
      expect(coursePerformance).toHaveLength(1);
      expect(coursePerformance[0]).toMatchObject({
        courseId: published.course.id,
        enrollments: 1,
        completions: 0,
        completionRate: 0,
      });
    });

    it('reports a 100% completion rate once every learner finishes', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      const { course, lessons } = await createCourse({ adminId, lessonCount: 1, durationSeconds: 100 });
      await createUser({ email: 'l1@test.dev' });

      const learner = await loginAs('l1@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));
      await learner
        .withCsrf(learner.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
        .send({ positionSeconds: 100 });

      const admin = await loginAs('admin@test.dev');
      const response = await admin.agent.get('/api/v1/dashboard/admin');
      expect(response.body.data.coursePerformance[0]).toMatchObject({
        enrollments: 1,
        completions: 1,
        completionRate: 100,
      });
      expect(response.body.data.stats.completedCourses).toBe(1);
    });

    it('lists learners with their aggregated progress', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      const { course, lessons } = await createCourse({ adminId, lessonCount: 4, durationSeconds: 100 });
      const learnerRow = await createUser({ email: 'l1@test.dev', firstName: 'Ada' });

      const learner = await loginAs('l1@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));
      await learner
        .withCsrf(learner.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
        .send({ positionSeconds: 100 });

      const admin = await loginAs('admin@test.dev');
      const list = await admin.agent.get('/api/v1/admin/users?search=Ada');
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        email: 'l1@test.dev',
        enrolledCourses: 1,
        completedLessons: 1,
        overallProgressPercentage: 25,
      });

      const detail = await admin.agent.get(`/api/v1/admin/users/${learnerRow.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.courses).toHaveLength(1);
      expect(detail.body.data.courses[0]).toMatchObject({
        completedLessons: 1,
        totalLessons: 4,
        progressPercentage: 25,
      });
      expect(detail.body.data.lessons).toHaveLength(1);
    });

    it('lists the learners enrolled on one course', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      const { course, lessons } = await createCourse({ adminId, lessonCount: 2, durationSeconds: 100 });
      await createUser({ email: 'l1@test.dev' });
      await createUser({ email: 'l2@test.dev' });

      for (const email of ['l1@test.dev', 'l2@test.dev']) {
        const session = await loginAs(email);
        await session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`));
      }
      const first = await loginAs('l1@test.dev');
      await first
        .withCsrf(first.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
        .send({ positionSeconds: 100 });

      const admin = await loginAs('admin@test.dev');
      const response = await admin.agent.get(`/api/v1/admin/courses/${course.id}/learners`);
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      const l1 = (response.body.data as { email: string; progressPercentage: number }[]).find(
        (row) => row.email === 'l1@test.dev',
      );
      expect(l1?.progressPercentage).toBe(50);
    });

    it('shows every user in the platform-wide activity feed', async () => {
      const adminId = (await createUser({ email: 'admin@test.dev', role: 'ADMIN' })).id;
      const { course } = await createCourse({ adminId, lessonCount: 1 });
      await createUser({ email: 'l1@test.dev' });
      const learner = await loginAs('l1@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));

      const admin = await loginAs('admin@test.dev');
      const response = await admin.agent.get('/api/v1/admin/activity');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].user.email).toBe('l1@test.dev');
      expect(response.body.meta.total).toBeGreaterThan(0);
    });

    it('refuses to let an admin deactivate their own account', async () => {
      const admin = await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const session = await loginAs('admin@test.dev');

      const response = await session
        .withCsrf(session.agent.patch(`/api/v1/admin/users/${admin.id}`))
        .send({ isActive: false });

      expect(response.status).toBe(422);
      expect((await session.agent.get('/api/v1/auth/me')).status).toBe(200);
    });
  });
});
