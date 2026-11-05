import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  createCourse,
  createUser,
  loginAs,
  resetDb,
  type ApiAgent,
} from '../helpers/factories.js';

/**
 * Progress, resume and completion through the API, against a real database.
 * Lessons are 100 seconds long so the 90% threshold is exactly 90.
 */
describe('progress', () => {
  let learner: ApiAgent;
  let lessonIds: string[];
  let courseId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: 'learner@test.dev' });
    const fixture = await createCourse({ lessonCount: 3, durationSeconds: 100 });
    courseId = fixture.course.id;
    lessonIds = fixture.lessons.map((lesson) => lesson.id);

    learner = await loginAs('learner@test.dev');
    await learner.withCsrf(learner.agent.post(`/api/v1/courses/${courseId}/enroll`));
  });

  const save = (session: ApiAgent, lessonId: string, positionSeconds: number, event = 'heartbeat') =>
    session
      .withCsrf(session.agent.put(`/api/v1/lessons/${lessonId}/progress`))
      .send({ positionSeconds, event });

  const complete = (session: ApiAgent, lessonId: string, positionSeconds: number) =>
    session
      .withCsrf(session.agent.post(`/api/v1/lessons/${lessonId}/complete`))
      .send({ positionSeconds });

  it('saves a position and reports the course roll-up', async () => {
    const response = await save(learner, lessonIds[0]!, 42);

    expect(response.status).toBe(200);
    expect(response.body.data.progress.lastPositionSeconds).toBe(42);
    expect(response.body.data.progress.maxWatchedSeconds).toBe(42);
    expect(response.body.data.progress.completionPercentage).toBe(42);
    expect(response.body.data.progress.isCompleted).toBe(false);
    expect(response.body.data.course.totalLessons).toBe(3);
    expect(response.body.data.course.completedLessons).toBe(0);
  });

  it('returns the saved position so the player can resume', async () => {
    await save(learner, lessonIds[0]!, 42, 'pause');
    const response = await learner.agent.get(`/api/v1/lessons/${lessonIds[0]}/progress`);

    expect(response.status).toBe(200);
    expect(response.body.data.progress.lastPositionSeconds).toBe(42);
    expect(response.body.data.durationSeconds).toBe(100);
  });

  it('clamps a position past the end of the video', async () => {
    const response = await save(learner, lessonIds[0]!, 5000);
    expect(response.body.data.progress.lastPositionSeconds).toBe(100);
  });

  it('keeps maxWatched when the learner rewinds', async () => {
    await save(learner, lessonIds[0]!, 80);
    const response = await save(learner, lessonIds[0]!, 10, 'seeked');

    expect(response.body.data.progress.lastPositionSeconds).toBe(10);
    expect(response.body.data.progress.maxWatchedSeconds).toBe(80);
  });

  it('auto-completes at the 90% threshold', async () => {
    const response = await save(learner, lessonIds[0]!, 90);

    expect(response.body.data.progress.isCompleted).toBe(true);
    expect(response.body.data.progress.completionPercentage).toBe(100);
    expect(response.body.data.course.completedLessons).toBe(1);
    expect(response.body.data.course.progressPercentage).toBe(33);
  });

  it('does not complete a lesson that was merely opened', async () => {
    const response = await save(learner, lessonIds[0]!, 0);
    expect(response.body.data.progress.isCompleted).toBe(false);

    const stored = await prisma.lessonProgress.findFirst({
      where: { lessonId: lessonIds[0]! },
    });
    expect(stored?.isCompleted).toBe(false);
  });

  it('accepts a completion at the real end of the video', async () => {
    const response = await complete(learner, lessonIds[0]!, 100);
    expect(response.status).toBe(200);
    expect(response.body.data.progress.isCompleted).toBe(true);
  });

  it('refuses a completion that has not been earned with 422', async () => {
    const response = await complete(learner, lessonIds[0]!, 5);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('UNPROCESSABLE');
    const stored = await prisma.lessonProgress.findFirst({
      where: { lessonId: lessonIds[0]! },
    });
    expect(stored?.isCompleted ?? false).toBe(false);
  });

  it('is idempotent and keeps the original completedAt', async () => {
    const first = await complete(learner, lessonIds[0]!, 100);
    const completedAt = first.body.data.progress.completedAt as string;

    const second = await complete(learner, lessonIds[0]!, 100);
    expect(second.status).toBe(200);
    expect(second.body.data.progress.completedAt).toBe(completedAt);

    expect(await prisma.lessonProgress.count({ where: { lessonId: lessonIds[0]! } })).toBe(1);
  });

  it('keeps completion sticky when the lesson is rewatched from the start', async () => {
    await complete(learner, lessonIds[0]!, 100);
    const response = await save(learner, lessonIds[0]!, 3);

    expect(response.body.data.progress.lastPositionSeconds).toBe(3);
    expect(response.body.data.progress.isCompleted).toBe(true);
    expect(response.body.data.progress.completionPercentage).toBe(100);
  });

  it('marks the enrollment COMPLETED when every lesson is done', async () => {
    for (const lessonId of lessonIds) {
      await complete(learner, lessonId, 100);
    }

    const enrollment = await prisma.enrollment.findFirst({ where: { courseId } });
    expect(enrollment?.status).toBe('COMPLETED');
    expect(enrollment?.completedAt).not.toBeNull();

    const course = await learner.agent.get(`/api/v1/courses/${courseId}`);
    expect(course.body.data.enrollment.progressPercentage).toBe(100);
  });

  it('tracks the last lesson on the enrollment, for resume', async () => {
    await save(learner, lessonIds[1]!, 30);
    const enrollment = await prisma.enrollment.findFirst({ where: { courseId } });
    expect(enrollment?.lastLessonId).toBe(lessonIds[1]);
    expect(enrollment?.lastAccessedAt).not.toBeNull();
  });

  it('handles concurrent heartbeats without creating duplicate rows', async () => {
    await Promise.all([
      save(learner, lessonIds[0]!, 10),
      save(learner, lessonIds[0]!, 20),
      save(learner, lessonIds[0]!, 30),
    ]);

    // The unique (userId, lessonId) upsert makes this safe.
    expect(await prisma.lessonProgress.count({ where: { lessonId: lessonIds[0]! } })).toBe(1);
  });

  describe('object-level authorization (IDOR)', () => {
    it('does not let learner B read learner A progress', async () => {
      await save(learner, lessonIds[0]!, 55);

      await createUser({ email: 'other@test.dev' });
      const other = await loginAs('other@test.dev');
      await other.withCsrf(other.agent.post(`/api/v1/courses/${courseId}/enroll`));

      const response = await other.agent.get(`/api/v1/lessons/${lessonIds[0]}/progress`);
      expect(response.status).toBe(200);
      // Their own (absent) progress, never A's 55 seconds.
      expect(response.body.data.progress).toBeNull();
    });

    it('does not let learner B write onto learner A progress', async () => {
      await save(learner, lessonIds[0]!, 55);

      await createUser({ email: 'other@test.dev' });
      const other = await loginAs('other@test.dev');
      await other.withCsrf(other.agent.post(`/api/v1/courses/${courseId}/enroll`));
      await save(other, lessonIds[0]!, 90);

      const rows = await prisma.lessonProgress.findMany({
        where: { lessonId: lessonIds[0]! },
        orderBy: { maxWatchedSeconds: 'asc' },
      });
      // Two independent rows: A untouched at 55, B at 90.
      expect(rows).toHaveLength(2);
      expect(rows[0]?.maxWatchedSeconds).toBe(55);
      expect(rows[0]?.isCompleted).toBe(false);
      expect(rows[1]?.maxWatchedSeconds).toBe(90);
    });

    it('requires an enrollment to save progress', async () => {
      await createUser({ email: 'nosub@test.dev' });
      const stranger = await loginAs('nosub@test.dev');

      const response = await save(stranger, lessonIds[0]!, 10);
      expect(response.status).toBe(403);
    });

    it('is 401 for an anonymous progress write', async () => {
      const { api } = await import('../helpers/factories.js');
      const response = await api()
        .put(`/api/v1/lessons/${lessonIds[0]}/progress`)
        .send({ positionSeconds: 10 });
      expect(response.status).toBe(401);
    });
  });

  it('404s for a lesson that does not exist', async () => {
    const response = await save(learner, '00000000-0000-0000-0000-000000000000', 10);
    expect(response.status).toBe(404);
  });

  it('lists the caller own progress only', async () => {
    await save(learner, lessonIds[0]!, 40);
    await createUser({ email: 'other@test.dev' });
    const other = await loginAs('other@test.dev');
    await other.withCsrf(other.agent.post(`/api/v1/courses/${courseId}/enroll`));
    await save(other, lessonIds[1]!, 60);

    const response = await learner.agent.get('/api/v1/progress/me');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].lessonId).toBe(lessonIds[0]);
  });
});
