import { beforeEach, describe, expect, it } from 'vitest';
import { api, createUser, loginAs, registerAndLogin, resetDb, TEST_PASSWORD } from '../helpers/factories.js';

/**
 * The three end-to-end workflows from the spec, exercised through the HTTP
 * API against a real database — no fixtures injected mid-flow, so each step
 * depends on the previous one having genuinely worked.
 */
describe('workflows', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('A: register, browse, enroll, watch, resume, complete, progress updates', async () => {
    // An admin is needed to author a course for the learner to find.
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    const admin = await loginAs('admin@test.dev');

    const course = (
      await admin.withCsrf(admin.agent.post('/api/v1/admin/courses')).send({
        title: 'Workflow A Course',
        // 80+ characters, and a short description: both are publish
        // checklist requirements since the instructor feature landed.
        description:
          'A course used by the end-to-end workflow test suite, written long enough to satisfy the publish checklist.',
        shortDescription: 'The course workflow A publishes and enrolls in.',
        category: 'Engineering',
        thumbnailUrl: '/thumbnails/test.svg',
        difficulty: 'BEGINNER',
      })
    ).body.data as { id: string; slug: string };

    const module = (
      await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/courses/${course.id}/modules`))
        .send({ title: 'Module 1' })
    ).body.data as { id: string };

    const lessonIds: string[] = [];
    for (const title of ['Lesson one', 'Lesson two']) {
      const lesson = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/modules/${module.id}/lessons`))
        .send({
          title,
          description: 'Body',
          videoUrl: 'https://example.test/v.mp4',
          durationSeconds: 100,
        });
      lessonIds.push(lesson.body.data.id as string);
    }

    const publishedA = await admin
      .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${course.id}/status`))
      .send({ status: 'PUBLISHED' });
    expect(publishedA.status).toBe(200);

    // --- the learner's journey ------------------------------------------
    const learner = await registerAndLogin('workflow-a@test.dev');

    // Browse: the course is in the catalog, not yet enrolled.
    const catalog = await learner.agent.get('/api/v1/courses?search=Workflow A');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data).toHaveLength(1);
    expect(catalog.body.data[0].enrollment).toBeNull();

    // Enroll.
    const enrolled = await learner.withCsrf(
      learner.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(enrolled.status).toBe(201);

    // Open the lesson: now permitted, and tracked.
    const lesson = await learner.agent.get(`/api/v1/lessons/${lessonIds[0]}`);
    expect(lesson.status).toBe(200);
    expect(lesson.body.data.isTracked).toBe(true);
    expect(lesson.body.data.nextLessonId).toBe(lessonIds[1]);

    // Watch part of it.
    const saved = await learner
      .withCsrf(learner.agent.put(`/api/v1/lessons/${lessonIds[0]}/progress`))
      .send({ positionSeconds: 42, event: 'pause' });
    expect(saved.status).toBe(200);

    // Resume: the saved position comes back.
    const resumed = await learner.agent.get(`/api/v1/lessons/${lessonIds[0]}/progress`);
    expect(resumed.body.data.progress.lastPositionSeconds).toBe(42);

    // Finish lesson one.
    const completed = await learner
      .withCsrf(learner.agent.post(`/api/v1/lessons/${lessonIds[0]}/complete`))
      .send({ positionSeconds: 100 });
    expect(completed.status).toBe(200);
    expect(completed.body.data.course.progressPercentage).toBe(50);

    // The course percentage is visible everywhere it should be.
    const detail = await learner.agent.get(`/api/v1/courses/${course.slug}`);
    expect(detail.body.data.enrollment.progressPercentage).toBe(50);
    expect(detail.body.data.modules[0].lessons[0].status).toBe('COMPLETED');

    const dashboard = await learner.agent.get('/api/v1/dashboard/learner');
    expect(dashboard.body.data.stats.completedLessons).toBe(1);
    expect(dashboard.body.data.stats.enrolledCourses).toBe(1);
    expect(dashboard.body.data.continueLearning?.lessonId).toBe(lessonIds[0]);

    // Finish the course.
    await learner
      .withCsrf(learner.agent.post(`/api/v1/lessons/${lessonIds[1]}/complete`))
      .send({ positionSeconds: 100 });

    const finished = await learner.agent.get('/api/v1/enrollments/me');
    expect(finished.body.data[0].status).toBe('COMPLETED');
    expect(finished.body.data[0].progressPercentage).toBe(100);
  });

  it('B: admin creates a course, publishes it, and a learner can see it', async () => {
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    await createUser({ email: 'learner@test.dev' });
    const admin = await loginAs('admin@test.dev');
    const learner = await loginAs('learner@test.dev');

    const created = await admin.withCsrf(admin.agent.post('/api/v1/admin/courses')).send({
      title: 'Workflow B Course',
      description:
        'Created by workflow B to prove the publish pipeline works, at a length that clears the checklist minimum.',
      shortDescription: 'The course workflow B publishes.',
      category: 'Data',
      thumbnailUrl: '/thumbnails/test.svg',
      difficulty: 'INTERMEDIATE',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    const courseId = created.body.data.id as string;

    // A draft is invisible to the learner.
    expect((await learner.agent.get('/api/v1/courses?search=Workflow B')).body.data).toHaveLength(0);

    // Publishing without lessons is refused, and the refusal names every
    // failing rule rather than only the first one.
    const tooEarly = await admin
      .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${courseId}/status`))
      .send({ status: 'PUBLISHED' });
    expect(tooEarly.status).toBe(422);
    expect(Object.keys(tooEarly.body.errors as Record<string, string[]>)).toEqual(
      expect.arrayContaining(['has-lessons', 'lesson-videos']),
    );

    const module = (
      await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/courses/${courseId}/modules`))
        .send({ title: 'Module 1' })
    ).body.data as { id: string };

    await admin
      .withCsrf(admin.agent.post(`/api/v1/admin/modules/${module.id}/lessons`))
      .send({
        title: 'First lesson',
        description: 'Body',
        videoUrl: 'https://example.test/v.mp4',
        durationSeconds: 600,
      });

    const published = await admin
      .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${courseId}/status`))
      .send({ status: 'PUBLISHED' });
    expect(published.status).toBe(200);

    // Now the learner sees it, with its derived duration and lesson count.
    const catalog = await learner.agent.get('/api/v1/courses?search=Workflow B');
    expect(catalog.body.data).toHaveLength(1);
    expect(catalog.body.data[0].lessonCount).toBe(1);
    expect(catalog.body.data[0].estimatedDuration).toBe(600);

    // And the admin dashboard counts it.
    const adminDashboard = await admin.agent.get('/api/v1/dashboard/admin');
    expect(adminDashboard.body.data.stats.publishedCourses).toBeGreaterThanOrEqual(1);
  });

  it('C: a learner calling an admin endpoint is refused with 403', async () => {
    await createUser({ email: 'learner@test.dev' });
    const learner = await loginAs('learner@test.dev');

    const read = await learner.agent.get('/api/v1/admin/courses');
    expect(read.status).toBe(403);
    expect(read.body.code).toBe('FORBIDDEN');

    const write = await learner
      .withCsrf(learner.agent.post('/api/v1/admin/courses'))
      .send({
        title: 'Should never exist',
        description: 'A learner must not be able to create a course.',
        category: 'Engineering',
        thumbnailUrl: '/thumbnails/test.svg',
        difficulty: 'BEGINNER',
      });
    expect(write.status).toBe(403);

    // Nothing was created.
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    const admin = await loginAs('admin@test.dev');
    expect((await admin.agent.get('/api/v1/admin/courses')).body.data).toHaveLength(0);
  });

  it('a session survives an access-token expiry via refresh', async () => {
    await createUser({ email: 'learner@test.dev' });
    const session = await loginAs('learner@test.dev');

    // Refresh, then keep using the same agent: the rotated cookies must work.
    expect((await session.agent.post('/api/v1/auth/refresh')).status).toBe(200);
    expect((await session.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('a deactivated learner cannot sign in again or use a live session', async () => {
    const user = await createUser({ email: 'learner@test.dev' });
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    const learner = await loginAs('learner@test.dev');
    const admin = await loginAs('admin@test.dev');

    const deactivated = await admin
      .withCsrf(admin.agent.patch(`/api/v1/admin/users/${user.id}`))
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);

    // The live session stops working...
    expect((await learner.agent.get('/api/v1/auth/me')).status).toBe(403);
    // ...the refresh token was revoked...
    expect((await learner.agent.post('/api/v1/auth/refresh')).status).toBe(401);
    // ...and a fresh login is refused.
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'learner@test.dev', password: TEST_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('ACCOUNT_INACTIVE');
  });
});
