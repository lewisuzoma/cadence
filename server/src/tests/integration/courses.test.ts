import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  api,
  createCourse,
  createUser,
  loginAs,
  resetDb,
  type ApiAgent,
} from '../helpers/factories.js';

describe('courses', () => {
  let admin: ApiAgent;

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    admin = await loginAs('admin@test.dev');
  });

  const validCourse = {
    title: 'A Brand New Course',
    description: 'A description that is comfortably longer than twenty characters.',
    category: 'Engineering',
    thumbnailUrl: '/thumbnails/new.svg',
    difficulty: 'INTERMEDIATE' as const,
  };

  describe('catalog visibility', () => {
    it('lists published courses to anonymous visitors, without enrollment state', async () => {
      await createCourse({ status: 'PUBLISHED', title: 'Published One' });
      await createCourse({ status: 'DRAFT', title: 'Draft One' });
      await createCourse({ status: 'ARCHIVED', title: 'Archived One' });

      const response = await api().get('/api/v1/courses');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Published One');
      expect(response.body.data[0].enrollment).toBeNull();
      expect(response.body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 });
    });

    it('derives lesson count and total duration rather than storing them', async () => {
      await createCourse({ lessonCount: 4, durationSeconds: 300 });
      const response = await api().get('/api/v1/courses');

      expect(response.body.data[0].lessonCount).toBe(4);
      expect(response.body.data[0].estimatedDuration).toBe(1200);
    });

    it('filters by search, category and difficulty', async () => {
      await createCourse({ title: 'Postgres Deep Dive', category: 'Data', difficulty: 'ADVANCED' });
      await createCourse({ title: 'React Basics', category: 'Engineering', difficulty: 'BEGINNER' });

      expect((await api().get('/api/v1/courses?search=postgres')).body.data).toHaveLength(1);
      expect((await api().get('/api/v1/courses?category=Data')).body.data).toHaveLength(1);
      expect((await api().get('/api/v1/courses?difficulty=BEGINNER')).body.data).toHaveLength(1);
      expect((await api().get('/api/v1/courses?search=nothingmatches')).body.data).toHaveLength(0);
    });

    it('paginates', async () => {
      for (let index = 0; index < 5; index++) {
        await createCourse({ title: `Course ${index}` });
      }
      const response = await api().get('/api/v1/courses?page=2&pageSize=2');

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    });

    it('includes the caller enrollment state when signed in', async () => {
      const { course } = await createCourse();
      await createUser({ email: 'learner@test.dev' });
      const learner = await loginAs('learner@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));

      const response = await learner.agent.get('/api/v1/courses');
      expect(response.body.data[0].enrollment).toMatchObject({
        isEnrolled: true,
        status: 'ACTIVE',
        progressPercentage: 0,
      });
    });

    it('serves course detail by slug and by id', async () => {
      const { course } = await createCourse({ slug: 'by-slug-course' });

      expect((await api().get('/api/v1/courses/by-slug-course')).status).toBe(200);
      expect((await api().get(`/api/v1/courses/${course.id}`)).status).toBe(200);
      expect((await api().get('/api/v1/courses/no-such-course')).status).toBe(404);
    });

    it('returns modules with ordered lessons on the detail payload', async () => {
      const { course } = await createCourse({ lessonCount: 3 });
      const response = await api().get(`/api/v1/courses/${course.slug}`);

      expect(response.body.data.modules).toHaveLength(1);
      const lessons = response.body.data.modules[0].lessons;
      expect(lessons.map((lesson: { order: number }) => lesson.order)).toEqual([1, 2, 3]);
      // Not enrolled, not a preview: locked for display, and the detail
      // payload carries no video URL at all.
      expect(lessons[0].status).toBe('LOCKED');
      expect(lessons[0]).not.toHaveProperty('videoUrl');
    });

    it('keeps an archived course readable for someone already enrolled', async () => {
      const { course } = await createCourse({ status: 'PUBLISHED' });
      await createUser({ email: 'learner@test.dev' });
      const learner = await loginAs('learner@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));

      await prisma.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });

      // Gone from the catalog...
      expect((await learner.agent.get('/api/v1/courses')).body.data).toHaveLength(0);
      // ...but still open to them.
      expect((await learner.agent.get(`/api/v1/courses/${course.slug}`)).status).toBe(200);
      // And invisible to everyone else.
      await createUser({ email: 'stranger@test.dev' });
      const stranger = await loginAs('stranger@test.dev');
      expect((await stranger.agent.get(`/api/v1/courses/${course.slug}`)).status).toBe(404);
    });

    it('lists the categories in the catalog', async () => {
      await createCourse({ category: 'Data' });
      await createCourse({ category: 'Design' });
      await createCourse({ category: 'Data' });

      const response = await api().get('/api/v1/courses/categories');
      expect(response.body.data).toEqual(['Data', 'Design']);
    });
  });

  describe('admin CRUD', () => {
    it('creates a course as a DRAFT with a generated slug', async () => {
      const response = await admin
        .withCsrf(admin.agent.post('/api/v1/admin/courses'))
        .send(validCourse);

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('DRAFT');
      expect(response.body.data.slug).toBe('a-brand-new-course');
      expect(response.body.data.publishedAt).toBeNull();
    });

    it('rejects an invalid course with field errors', async () => {
      const response = await admin
        .withCsrf(admin.agent.post('/api/v1/admin/courses'))
        .send({ ...validCourse, title: 'ab', description: 'too short' });

      expect(response.status).toBe(400);
      expect(response.body.errors.title).toBeDefined();
      expect(response.body.errors.description).toBeDefined();
    });

    it('disambiguates a duplicate generated slug instead of failing', async () => {
      await admin.withCsrf(admin.agent.post('/api/v1/admin/courses')).send(validCourse);
      const second = await admin
        .withCsrf(admin.agent.post('/api/v1/admin/courses'))
        .send(validCourse);

      expect(second.status).toBe(201);
      expect(second.body.data.slug).toBe('a-brand-new-course-2');
    });

    it('updates a course without changing its live slug', async () => {
      const { course } = await createCourse({ slug: 'stable-slug' });
      const response = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${course.id}`))
        .send({ title: 'A Totally Different Title' });

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('A Totally Different Title');
      // Inbound links must keep working.
      expect(response.body.data.slug).toBe('stable-slug');
    });

    it('lists every status for an admin', async () => {
      await createCourse({ status: 'PUBLISHED' });
      await createCourse({ status: 'DRAFT' });
      await createCourse({ status: 'ARCHIVED' });

      const all = await admin.agent.get('/api/v1/admin/courses');
      expect(all.body.data).toHaveLength(3);

      const drafts = await admin.agent.get('/api/v1/admin/courses?status=DRAFT');
      expect(drafts.body.data).toHaveLength(1);
    });
  });

  describe('publishing rules', () => {
    it('refuses to publish a course with no lessons (422)', async () => {
      const created = await admin
        .withCsrf(admin.agent.post('/api/v1/admin/courses'))
        .send(validCourse);

      const response = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${created.body.data.id}/status`))
        .send({ status: 'PUBLISHED' });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('UNPROCESSABLE');
    });

    it('publishes a course that has lessons, and stamps publishedAt once', async () => {
      const { course } = await createCourse({ status: 'DRAFT', lessonCount: 2 });

      const published = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${course.id}/status`))
        .send({ status: 'PUBLISHED' });
      expect(published.status).toBe(200);
      const firstPublishedAt = published.body.data.publishedAt;
      expect(firstPublishedAt).not.toBeNull();

      await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${course.id}/status`))
        .send({ status: 'DRAFT' });
      const republished = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${course.id}/status`))
        .send({ status: 'PUBLISHED' });

      // Re-publishing does not rewrite the original date.
      expect(republished.body.data.publishedAt).toBe(firstPublishedAt);
    });

    it('makes a published course appear in the learner catalog', async () => {
      const { course } = await createCourse({ status: 'DRAFT', lessonCount: 1 });
      expect((await api().get('/api/v1/courses')).body.data).toHaveLength(0);

      await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/courses/${course.id}/status`))
        .send({ status: 'PUBLISHED' });

      expect((await api().get('/api/v1/courses')).body.data).toHaveLength(1);
    });
  });

  describe('deletion', () => {
    it('deletes a course with no enrollments', async () => {
      const { course } = await createCourse();
      const response = await admin.withCsrf(
        admin.agent.delete(`/api/v1/admin/courses/${course.id}`),
      );

      expect(response.status).toBe(204);
      expect(await prisma.course.findUnique({ where: { id: course.id } })).toBeNull();
    });

    it('refuses to delete a course with learners, telling the admin to archive', async () => {
      const { course } = await createCourse();
      await createUser({ email: 'learner@test.dev' });
      const learner = await loginAs('learner@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));

      const response = await admin.withCsrf(
        admin.agent.delete(`/api/v1/admin/courses/${course.id}`),
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
      expect(response.body.message).toMatch(/archive/i);
      // The course and the learner's progress both survive.
      expect(await prisma.course.findUnique({ where: { id: course.id } })).not.toBeNull();
    });
  });

  describe('modules and lessons', () => {
    it('creates a module and a lesson, appending positions', async () => {
      // Built through the API so the course really is empty: the test factory
      // always adds a module, which would make "appends at position 1"
      // impossible to assert.
      const created = await admin
        .withCsrf(admin.agent.post('/api/v1/admin/courses'))
        .send(validCourse);
      const course = created.body.data as { id: string };

      const module = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/courses/${course.id}/modules`))
        .send({ title: 'Module One' });
      expect(module.status).toBe(201);
      expect(module.body.data.order).toBe(1);

      const lesson = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/modules/${module.body.data.id}/lessons`))
        .send({
          title: 'First lesson',
          description: 'Body',
          videoUrl: 'https://example.test/v.mp4',
          durationSeconds: 600,
        });
      expect(lesson.status).toBe(201);
      expect(lesson.body.data.order).toBe(1);
      // courseId is denormalised from the module, never from the request.
      expect(lesson.body.data.courseId).toBe(course.id);
    });

    it('rejects a lesson with a zero duration', async () => {
      const { module } = await createCourse();
      const response = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/modules/${module.id}/lessons`))
        .send({
          title: 'Bad lesson',
          description: 'Body',
          videoUrl: 'https://example.test/v.mp4',
          durationSeconds: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body.errors.durationSeconds).toBeDefined();
    });

    it('reorders lessons transactionally without touching progress', async () => {
      const { course, module, lessons } = await createCourse({ lessonCount: 3 });
      await createUser({ email: 'learner@test.dev' });
      const learner = await loginAs('learner@test.dev');
      await learner.withCsrf(learner.agent.post(`/api/v1/courses/${course.id}/enroll`));
      await learner
        .withCsrf(learner.agent.post(`/api/v1/lessons/${lessons[2]!.id}/complete`))
        .send({ positionSeconds: 100 });

      const reversed = [lessons[2]!.id, lessons[1]!.id, lessons[0]!.id];
      const response = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/modules/${module.id}/lessons/reorder`))
        .send({ lessonIds: reversed });

      expect(response.status).toBe(200);
      expect(response.body.data.map((lesson: { id: string }) => lesson.id)).toEqual(reversed);

      // Progress is keyed by lessonId, so it followed the lesson, not the slot.
      const progress = await prisma.lessonProgress.findFirst({
        where: { lessonId: lessons[2]!.id },
      });
      expect(progress?.isCompleted).toBe(true);
      expect(await prisma.lessonProgress.count()).toBe(1);
    });

    it('rejects a partial reorder rather than silently dropping lessons', async () => {
      const { module, lessons } = await createCourse({ lessonCount: 3 });
      const response = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/modules/${module.id}/lessons/reorder`))
        .send({ lessonIds: [lessons[0]!.id] });

      expect(response.status).toBe(422);
      const orders = await prisma.lesson.findMany({
        where: { moduleId: module.id },
        orderBy: { order: 'asc' },
        select: { order: true },
      });
      expect(orders.map((row) => row.order)).toEqual([1, 2, 3]);
    });

    it('updates and deletes a lesson', async () => {
      const { lessons } = await createCourse({ lessonCount: 2 });

      const updated = await admin
        .withCsrf(admin.agent.patch(`/api/v1/admin/lessons/${lessons[0]!.id}`))
        .send({ title: 'Renamed lesson', isPreview: true });
      expect(updated.status).toBe(200);
      expect(updated.body.data.title).toBe('Renamed lesson');
      expect(updated.body.data.isPreview).toBe(true);

      const deleted = await admin.withCsrf(
        admin.agent.delete(`/api/v1/admin/lessons/${lessons[1]!.id}`),
      );
      expect(deleted.status).toBe(204);
      expect(await prisma.lesson.count()).toBe(1);
    });
  });
});
