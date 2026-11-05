import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { createCourse, createUser, loginAs, resetDb } from '../helpers/factories.js';

describe('enrollment', () => {
  beforeEach(async () => {
    await resetDb();
    await createUser({ email: 'learner@test.dev' });
  });

  it('enrolls with 201, and answers 200 on a repeat without duplicating', async () => {
    const { course } = await createCourse();
    const session = await loginAs('learner@test.dev');

    const first = await session.withCsrf(
      session.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe('ACTIVE');
    expect(first.body.data.progressPercentage).toBe(0);

    const second = await session.withCsrf(
      session.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    // Idempotent: the same enrollment comes back, with a 200 rather than a 409.
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(1);
  });

  it('survives concurrent enroll requests from a double-clicked button', async () => {
    const { course } = await createCourse();
    const session = await loginAs('learner@test.dev');

    const responses = await Promise.all([
      session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`)),
      session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`)),
      session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`)),
    ]);

    // The unique (userId, courseId) index is the thing that guarantees this.
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(1);
    for (const response of responses) {
      expect([200, 201, 409]).toContain(response.status);
    }
  });

  it('refuses a new enrollment on an archived course with 422', async () => {
    const { course } = await createCourse({ status: 'ARCHIVED' });
    const session = await loginAs('learner@test.dev');

    const response = await session.withCsrf(
      session.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('UNPROCESSABLE');
  });

  it('refuses a course with no lessons with 422', async () => {
    const { course } = await createCourse({ lessonCount: 0 });
    // The factory leaves an empty module behind; remove its lessons to be sure.
    await prisma.lesson.deleteMany({ where: { courseId: course.id } });
    const session = await loginAs('learner@test.dev');

    const response = await session.withCsrf(
      session.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(response.status).toBe(422);
  });

  it('hides a draft course behind a 404 rather than an enrollment error', async () => {
    const { course } = await createCourse({ status: 'DRAFT' });
    const session = await loginAs('learner@test.dev');

    const response = await session.withCsrf(
      session.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(response.status).toBe(404);
  });

  it('keeps an existing learner on a course that is archived afterwards', async () => {
    const { course } = await createCourse();
    const session = await loginAs('learner@test.dev');
    await session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`));

    await prisma.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });

    const enrollment = await session.agent.get(`/api/v1/courses/${course.id}/enrollment`);
    expect(enrollment.status).toBe(200);
    expect(enrollment.body.data.status).toBe('ACTIVE');
  });

  it('requires authentication to enroll', async () => {
    const { course } = await createCourse();
    const { api } = await import('../helpers/factories.js');
    const response = await api().post(`/api/v1/courses/${course.id}/enroll`);
    expect(response.status).toBe(401);
  });

  it('lists the caller enrollments with their courses and progress', async () => {
    const { course, lessons } = await createCourse({ lessonCount: 4, durationSeconds: 100 });
    const session = await loginAs('learner@test.dev');
    await session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`));
    await session
      .withCsrf(session.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
      .send({ positionSeconds: 100 });

    const response = await session.agent.get('/api/v1/enrollments/me');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].course.title).toBe(course.title);
    // 1 of 4 lessons complete, computed on the server.
    expect(response.body.data[0].progressPercentage).toBe(25);
    expect(response.body.data[0].completedLessons).toBe(1);
    expect(response.body.data[0].totalLessons).toBe(4);
  });

  it('does not list another learner enrollments', async () => {
    const { course } = await createCourse();
    const mine = await loginAs('learner@test.dev');
    await mine.withCsrf(mine.agent.post(`/api/v1/courses/${course.id}/enroll`));

    await createUser({ email: 'other@test.dev' });
    const other = await loginAs('other@test.dev');

    const response = await other.agent.get('/api/v1/enrollments/me');
    expect(response.body.data).toHaveLength(0);
  });

  it('leaving a course keeps the progress, and re-enrolling restores it', async () => {
    const { course, lessons } = await createCourse({ lessonCount: 2, durationSeconds: 100 });
    const session = await loginAs('learner@test.dev');
    await session.withCsrf(session.agent.post(`/api/v1/courses/${course.id}/enroll`));
    await session
      .withCsrf(session.agent.post(`/api/v1/lessons/${lessons[0]!.id}/complete`))
      .send({ positionSeconds: 100 });

    const left = await session.withCsrf(
      session.agent.delete(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(left.status).toBe(200);
    expect(left.body.data.status).toBe('CANCELLED');
    // Progress rows are not deleted.
    expect(await prisma.lessonProgress.count({ where: { lesson: { courseId: course.id } } })).toBe(1);

    const back = await session.withCsrf(
      session.agent.post(`/api/v1/courses/${course.id}/enroll`),
    );
    expect(back.status).toBe(200);
    expect(back.body.data.status).toBe('ACTIVE');
    expect(back.body.data.completedLessons).toBe(1);
  });
});
