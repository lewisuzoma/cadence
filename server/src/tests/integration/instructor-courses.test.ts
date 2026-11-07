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
 * Instructor course, module and lesson management.
 *
 * The parts worth testing hardest are the ones where a course's shape
 * changes under learners who are already on it: deleting a lesson, adding
 * one, and archiving. Each of those has to leave every enrollment
 * describing a course that actually exists.
 */

/** A course whose every lesson is playable, so it can be published. */
async function publishableCourse(ownerId: string, lessonCount = 2) {
  const { course, module, lessons } = await createCourse({
    ownerId,
    status: 'DRAFT',
    lessonCount,
  });
  return { course, module, lessons };
}

/** Completes every lesson of a course for one learner. */
async function completeCourse(userId: string, courseId: string) {
  const lessons = await prisma.lesson.findMany({ where: { courseId } });
  for (const lesson of lessons) {
    await prisma.lessonProgress.create({
      data: {
        userId,
        lessonId: lesson.id,
        maxWatchedSeconds: lesson.durationSeconds,
        lastPositionSeconds: lesson.durationSeconds,
        completionPercentage: 100,
        isCompleted: true,
        completedAt: new Date(),
      },
    });
  }
  await prisma.enrollment.update({
    where: { userId_courseId: { userId, courseId } },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      firstCompletedAt: new Date(),
    },
  });
}

describe('instructor course management', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // =========================================================================
  describe('creating and listing', () => {
    it('creates a DRAFT owned by the caller and records a CREATED event', async () => {
      await createInstructor({ email: 'creator@test.dev' });
      const agent = await loginAs('creator@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor/courses'))
        .send({
          title: 'Observability for Backend Engineers',
          description:
            'Most outages are slow to fix because nobody can see what the system is doing. This course instruments a Node.js API.',
          shortDescription:
            'Logs, metrics and traces that help you find production bugs in minutes.',
          category: 'Engineering',
          thumbnailUrl: '/thumbnails/test.svg',
          difficulty: 'INTERMEDIATE',
          learningObjectives: ['Add structured logs to an Express API'],
          prerequisites: ['Comfortable with Node.js and HTTP'],
          targetAudience: 'Backend engineers who run their own services.',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('DRAFT');

      const row = await prisma.course.findUniqueOrThrow({
        where: { id: response.body.data.id as string },
      });
      expect(row.createdById).toBe(agent.userId);
      expect(row.learningObjectives).toEqual(['Add structured logs to an Express API']);

      await prisma.courseEvent.findFirstOrThrow({
        where: { courseId: row.id, type: 'CREATED', actorId: agent.userId },
      });
    });

    it('lists only the caller’s own courses, with tab counts', async () => {
      const mine = await createInstructor({ email: 'mine@test.dev' });
      const theirs = await createInstructor({ email: 'theirs@test.dev' });
      await createCourse({ ownerId: mine.user.id, status: 'PUBLISHED', title: 'Mine A' });
      await createCourse({ ownerId: mine.user.id, status: 'DRAFT', title: 'Mine B' });
      await createCourse({ ownerId: theirs.user.id, status: 'PUBLISHED', title: 'Theirs' });

      const agent = await loginAs('mine@test.dev');
      const response = await agent.agent.get('/api/v1/instructor/courses');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect((response.body.data as { title: string }[]).map((c) => c.title).sort()).toEqual([
        'Mine A',
        'Mine B',
      ]);
      expect(response.body.meta.counts).toMatchObject({ PUBLISHED: 1, DRAFT: 1, ALL: 2 });
      expect(JSON.stringify(response.body)).not.toContain('Theirs');
    });
  });

  // =========================================================================
  describe('publishing', () => {
    it('returns every failing rule at once, not just the first', async () => {
      await createInstructor({ email: 'notready@test.dev' });
      const agent = await loginAs('notready@test.dev');

      const created = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor/courses'))
        .send({
          title: 'Bare',
          description: 'Short.'.padEnd(25, '.'),
          category: 'Engineering',
          thumbnailUrl: '/thumbnails/test.svg',
          difficulty: 'BEGINNER',
        });
      const courseId = created.body.data.id as string;

      const checklist = await agent.agent.get(
        `/api/v1/instructor/courses/${courseId}/publish-checklist`,
      );
      expect(checklist.status).toBe(200);
      expect(checklist.body.data.canPublish).toBe(false);

      const failing = (checklist.body.data.checks as { id: string; passed: boolean }[])
        .filter((check) => !check.passed)
        .map((check) => check.id);
      // Several rules fail together, and the checklist says so in one pass.
      expect(failing).toEqual(
        expect.arrayContaining(['descriptions', 'has-lessons', 'lesson-videos']),
      );

      const publish = await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${courseId}/publish`))
        .send({});
      expect(publish.status).toBe(422);
      for (const id of failing) {
        expect(response_keys(publish.body)).toContain(id);
      }

      const row = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
      expect(row.status).toBe('DRAFT');
    });

    it('publishes a complete course and records the event', async () => {
      const { user } = await createInstructor({ email: 'ready@test.dev' });
      const { course } = await publishableCourse(user.id);
      const agent = await loginAs('ready@test.dev');

      const checklist = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/publish-checklist`,
      );
      expect(checklist.body.data.canPublish).toBe(true);

      const published = await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/publish`))
        .send({});
      expect(published.status).toBe(200);
      expect(published.body.data.status).toBe('PUBLISHED');

      const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(row.publishedAt).not.toBeNull();
      await prisma.courseEvent.findFirstOrThrow({
        where: { courseId: course.id, type: 'PUBLISHED' },
      });
    });

    it('refuses to publish while the owner is suspended', async () => {
      const { user } = await createInstructor({ email: 'willsuspend@test.dev' });
      const { course } = await publishableCourse(user.id);

      await prisma.instructorProfile.update({
        where: { userId: user.id },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspensionReason: 'Suspended for the purposes of this test.',
        },
      });

      const agent = await loginAs('willsuspend@test.dev');
      const response = await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/publish`))
        .send({});
      // The route guard refuses the write before the checklist is reached.
      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/suspended/i);
    });

    it('keeps the original publishedAt across unpublish and republish', async () => {
      const { user } = await createInstructor({ email: 'republish@test.dev' });
      const { course } = await publishableCourse(user.id);
      const agent = await loginAs('republish@test.dev');

      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/publish`))
        .send({});
      const first = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });

      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/unpublish`))
        .send({});
      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/publish`))
        .send({});

      const again = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(again.publishedAt?.toISOString()).toBe(first.publishedAt?.toISOString());
    });
  });

  // =========================================================================
  describe('unpublishing and archiving never cost a learner anything', () => {
    it('hides an unpublished course from the catalog but keeps enrollments', async () => {
      const { user } = await createInstructor({ email: 'unpub@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'PUBLISHED',
        title: 'Searchable Course',
      });
      const learner = await createUser({ email: 'learner@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });

      const instructor = await loginAs('unpub@test.dev');
      await instructor
        .withCsrf(instructor.agent.post(`/api/v1/instructor/courses/${course.id}/unpublish`))
        .send({});

      const learnerAgent = await loginAs('learner@test.dev');
      // Gone from the catalog.
      const catalog = await learnerAgent.agent.get('/api/v1/courses?search=Searchable');
      expect(catalog.body.data).toHaveLength(0);

      // The enrollment and its progress are untouched.
      expect(
        await prisma.enrollment.findUnique({
          where: { userId_courseId: { userId: learner.id, courseId: course.id } },
        }),
      ).not.toBeNull();
    });

    it('keeps enrolled learners on an archived course and tells them', async () => {
      const { user } = await createInstructor({ email: 'archiver@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'PUBLISHED' });
      const learner = await createUser({ email: 'enrolled@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });

      const instructor = await loginAs('archiver@test.dev');
      const response = await instructor
        .withCsrf(instructor.agent.post(`/api/v1/instructor/courses/${course.id}/archive`))
        .send({});
      expect(response.status).toBe(200);

      // Still readable by the enrolled learner.
      const learnerAgent = await loginAs('enrolled@test.dev');
      const detail = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      expect(detail.status).toBe(200);

      expect(
        await prisma.enrollment.count({ where: { courseId: course.id } }),
      ).toBe(1);
      await prisma.courseEvent.findFirstOrThrow({
        where: { courseId: course.id, type: 'ARCHIVED' },
      });
    });

    it('refuses DELETE on a course with enrollments, suggesting archive', async () => {
      const { user } = await createInstructor({ email: 'deleter@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'PUBLISHED' });
      const learner = await createUser({ email: 'blocking@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });

      const agent = await loginAs('deleter@test.dev');
      const response = await agent.withCsrf(
        agent.agent.delete(`/api/v1/instructor/courses/${course.id}`),
      );
      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/archive/i);
      expect(await prisma.course.count({ where: { id: course.id } })).toBe(1);
    });

    it('allows DELETE on a course nobody is enrolled in', async () => {
      const { user } = await createInstructor({ email: 'cleandelete@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });

      const agent = await loginAs('cleandelete@test.dev');
      const response = await agent.withCsrf(
        agent.agent.delete(`/api/v1/instructor/courses/${course.id}`),
      );
      expect(response.status).toBe(204);
      expect(await prisma.course.count({ where: { id: course.id } })).toBe(0);
    });
  });

  // =========================================================================
  describe('lessons and modules', () => {
    it('reorders lessons transactionally and leaves progress alone', async () => {
      const { user } = await createInstructor({ email: 'reorder@test.dev' });
      const { course, module, lessons } = await createCourse({
        ownerId: user.id,
        lessonCount: 3,
      });
      const learner = await createUser({ email: 'watcher@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });
      await prisma.lessonProgress.create({
        data: {
          userId: learner.id,
          lessonId: lessons[0]!.id,
          maxWatchedSeconds: 100,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: new Date(),
        },
      });

      const agent = await loginAs('reorder@test.dev');
      const reversed = [lessons[2]!.id, lessons[1]!.id, lessons[0]!.id];
      const response = await agent
        .withCsrf(
          agent.agent.patch(`/api/v1/instructor/modules/${module.id}/lessons/reorder`),
        )
        .send({ lessonIds: reversed });
      expect(response.status).toBe(200);

      const rows = await prisma.lesson.findMany({
        where: { moduleId: module.id },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      expect(rows.map((row) => row.id)).toEqual(reversed);

      // Progress is keyed by lessonId, so it followed the lesson, not the slot.
      const progress = await prisma.lessonProgress.findFirstOrThrow({
        where: { userId: learner.id },
      });
      expect(progress.lessonId).toBe(lessons[0]!.id);
      expect(progress.isCompleted).toBe(true);
    });

    it('rejects a reorder that is not exactly the module’s lessons', async () => {
      const { user } = await createInstructor({ email: 'badorder@test.dev' });
      const { module, lessons } = await createCourse({ ownerId: user.id, lessonCount: 3 });
      const agent = await loginAs('badorder@test.dev');

      const partial = await agent
        .withCsrf(
          agent.agent.patch(`/api/v1/instructor/modules/${module.id}/lessons/reorder`),
        )
        .send({ lessonIds: [lessons[0]!.id, lessons[1]!.id] });
      expect(partial.status).toBe(422);

      const duplicated = await agent
        .withCsrf(
          agent.agent.patch(`/api/v1/instructor/modules/${module.id}/lessons/reorder`),
        )
        .send({ lessonIds: [lessons[0]!.id, lessons[0]!.id, lessons[1]!.id] });
      expect(duplicated.status).toBe(422);
    });

    it('deleting a lesson removes its progress and recalculates enrollments', async () => {
      const { user } = await createInstructor({ email: 'lessondel@test.dev' });
      const { course, lessons } = await createCourse({ ownerId: user.id, lessonCount: 3 });
      const learner = await createUser({ email: 'twothirds@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });

      // Two of three done: not complete.
      for (const lesson of lessons.slice(0, 2)) {
        await prisma.lessonProgress.create({
          data: {
            userId: learner.id,
            lessonId: lesson.id,
            maxWatchedSeconds: 100,
            completionPercentage: 100,
            isCompleted: true,
            completedAt: new Date(),
          },
        });
      }
      expect(
        (
          await prisma.enrollment.findUniqueOrThrow({
            where: { userId_courseId: { userId: learner.id, courseId: course.id } },
          })
        ).status,
      ).toBe('ACTIVE');

      // Delete the unwatched third lesson: now two of two.
      const agent = await loginAs('lessondel@test.dev');
      const response = await agent.withCsrf(
        agent.agent.delete(`/api/v1/instructor/lessons/${lessons[2]!.id}`),
      );
      expect(response.status).toBe(204);

      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_courseId: { userId: learner.id, courseId: course.id } },
      });
      expect(enrollment.status).toBe('COMPLETED');
      expect(enrollment.completedAt).not.toBeNull();
    });

    it('deleting a watched lesson removes its progress rows', async () => {
      const { user } = await createInstructor({ email: 'cascade@test.dev' });
      const { course, lessons } = await createCourse({ ownerId: user.id, lessonCount: 2 });
      const learner = await createUser({ email: 'cascadelearner@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });
      await prisma.lessonProgress.create({
        data: {
          userId: learner.id,
          lessonId: lessons[0]!.id,
          maxWatchedSeconds: 50,
          completionPercentage: 50,
        },
      });

      const agent = await loginAs('cascade@test.dev');
      await agent.withCsrf(
        agent.agent.delete(`/api/v1/instructor/lessons/${lessons[0]!.id}`),
      );

      expect(
        await prisma.lessonProgress.count({ where: { lessonId: lessons[0]!.id } }),
      ).toBe(0);
    });

    it('adding a lesson reopens finished enrollments, keeps the history and notifies', async () => {
      const { user } = await createInstructor({ email: 'adder@test.dev' });
      const { course, module } = await createCourse({
        ownerId: user.id,
        status: 'PUBLISHED',
        lessonCount: 2,
        title: 'Designing Accessible Interfaces',
      });
      const learner = await createUser({ email: 'finisher@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });
      await completeCourse(learner.id, course.id);

      const before = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_courseId: { userId: learner.id, courseId: course.id } },
      });
      expect(before.status).toBe('COMPLETED');
      const originalCompletion = before.completedAt!;

      const agent = await loginAs('adder@test.dev');
      const response = await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/modules/${module.id}/lessons`))
        .send({
          title: 'A brand new lesson',
          description: 'Added after some learners had already finished.',
          videoUrl: 'https://example.test/new.mp4',
          durationSeconds: 300,
        });
      expect(response.status).toBe(201);

      const after = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_courseId: { userId: learner.id, courseId: course.id } },
      });
      // Reopened...
      expect(after.status).toBe('ACTIVE');
      expect(after.completedAt).toBeNull();
      // ...but the fact that they finished is preserved.
      expect(after.firstCompletedAt?.toISOString()).toBe(
        originalCompletion.toISOString(),
      );

      // And they were told why.
      const notification = await prisma.notification.findFirstOrThrow({
        where: { userId: learner.id, type: 'COURSE_LESSONS_ADDED' },
      });
      expect(notification.body).toContain('Designing Accessible Interfaces');

      await prisma.courseEvent.findFirstOrThrow({
        where: { courseId: course.id, type: 'LESSONS_ADDED' },
      });
    });

    it('does not disturb learners who had not finished', async () => {
      const { user } = await createInstructor({ email: 'partial@test.dev' });
      const { course, module, lessons } = await createCourse({
        ownerId: user.id,
        lessonCount: 3,
      });
      const learner = await createUser({ email: 'midway@test.dev' });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });
      await prisma.lessonProgress.create({
        data: {
          userId: learner.id,
          lessonId: lessons[0]!.id,
          maxWatchedSeconds: 100,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: new Date(),
        },
      });

      const agent = await loginAs('partial@test.dev');
      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/modules/${module.id}/lessons`))
        .send({
          title: 'Another lesson',
          description: 'Added mid-course.',
          videoUrl: 'https://example.test/another.mp4',
          durationSeconds: 120,
        });

      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_courseId: { userId: learner.id, courseId: course.id } },
      });
      expect(enrollment.status).toBe('ACTIVE');
      // Nobody was notified, because nothing reopened for them.
      expect(
        await prisma.notification.count({
          where: { userId: learner.id, type: 'COURSE_LESSONS_ADDED' },
        }),
      ).toBe(0);
    });

    it('refuses lessons and modules on someone else’s course with 404', async () => {
      const alice = await createInstructor({ email: 'alice3@test.dev' });
      await createInstructor({ email: 'bob3@test.dev' });
      const { course, module, lessons } = await createCourse({ ownerId: alice.user.id });
      const bob = await loginAs('bob3@test.dev');

      const addModule = await bob
        .withCsrf(bob.agent.post(`/api/v1/instructor/courses/${course.id}/modules`))
        .send({ title: 'Intruding module' });
      expect(addModule.status).toBe(404);

      const addLesson = await bob
        .withCsrf(bob.agent.post(`/api/v1/instructor/modules/${module.id}/lessons`))
        .send({
          title: 'Intruding lesson',
          description: 'Should never be created.',
          videoUrl: 'https://example.test/x.mp4',
          durationSeconds: 60,
        });
      expect(addLesson.status).toBe(404);

      const editLesson = await bob
        .withCsrf(bob.agent.patch(`/api/v1/instructor/lessons/${lessons[0]!.id}`))
        .send({ title: 'Renamed by an intruder' });
      expect(editLesson.status).toBe(404);

      const reorder = await bob
        .withCsrf(bob.agent.patch(`/api/v1/instructor/modules/${module.id}/lessons/reorder`))
        .send({ lessonIds: lessons.map((l) => l.id).reverse() });
      expect(reorder.status).toBe(404);

      const deleted = await bob.withCsrf(
        bob.agent.delete(`/api/v1/instructor/lessons/${lessons[0]!.id}`),
      );
      expect(deleted.status).toBe(404);

      // Nothing happened.
      expect(await prisma.module.count({ where: { courseId: course.id } })).toBe(1);
      expect(await prisma.lesson.count({ where: { courseId: course.id } })).toBe(
        lessons.length,
      );
    });
  });

  // =========================================================================
  describe('preview', () => {
    it('shows the owner the learner view without enrolling or tracking', async () => {
      const { user } = await createInstructor({ email: 'previewer@test.dev' });
      const { course, lessons } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('previewer@test.dev');

      const response = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/preview`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.preview).toMatchObject({
        isPreview: true,
        courseStatus: 'DRAFT',
        inCatalog: false,
        progressTracked: false,
      });
      expect(response.body.data.modules[0].lessons).toHaveLength(2);

      // No enrollment was created by looking.
      expect(
        await prisma.enrollment.count({ where: { courseId: course.id } }),
      ).toBe(0);

      // Opening a lesson as the owner is explicitly untracked.
      const lesson = await agent.agent.get(`/api/v1/lessons/${lessons[0]!.id}`);
      expect(lesson.status).toBe(200);
      expect(lesson.body.data.isTracked).toBe(false);

      expect(
        await prisma.lessonProgress.count({ where: { userId: user.id } }),
      ).toBe(0);
    });

    it('refuses a preview of someone else’s course with 404', async () => {
      const alice = await createInstructor({ email: 'alice4@test.dev' });
      await createInstructor({ email: 'bob4@test.dev' });
      const { course } = await createCourse({ ownerId: alice.user.id, status: 'DRAFT' });

      const bob = await loginAs('bob4@test.dev');
      const response = await bob.agent.get(
        `/api/v1/instructor/courses/${course.id}/preview`,
      );
      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  describe('instructors as learners', () => {
    it('lets an instructor enroll in and complete another instructor’s course', async () => {
      const author = await createInstructor({ email: 'author5@test.dev' });
      await createInstructor({ email: 'student5@test.dev' });
      const { course, lessons } = await createCourse({
        ownerId: author.user.id,
        status: 'PUBLISHED',
        lessonCount: 2,
        durationSeconds: 100,
      });

      const student = await loginAs('student5@test.dev');

      const enrolled = await student.withCsrf(
        student.agent.post(`/api/v1/courses/${course.id}/enroll`),
      );
      expect(enrolled.status).toBe(201);

      for (const lesson of lessons) {
        const completed = await student
          .withCsrf(student.agent.post(`/api/v1/lessons/${lesson.id}/complete`))
          .send({ positionSeconds: 100 });
        expect(completed.status).toBe(200);
      }

      const mine = await student.agent.get('/api/v1/enrollments/me');
      expect(mine.body.data[0].status).toBe('COMPLETED');
      expect(mine.body.data[0].progressPercentage).toBe(100);

      // And it shows on their learner dashboard, unchanged by being an author.
      const dashboard = await student.agent.get('/api/v1/dashboard/learner');
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.data.stats.completedCourses).toBe(1);
    });

    it('refuses to let an instructor enroll in their own course', async () => {
      const { user } = await createInstructor({ email: 'selfenroll@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'PUBLISHED' });
      const agent = await loginAs('selfenroll@test.dev');

      const response = await agent.withCsrf(
        agent.agent.post(`/api/v1/courses/${course.id}/enroll`),
      );
      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(/your own course/i);
      expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(0);
    });

    it('keeps learner history intact across approval and suspension', async () => {
      // Start as a plain learner with real history.
      const author = await createInstructor({ email: 'otherauthor@test.dev' });
      const learner = await createUser({ email: 'promotable@test.dev' });
      const { course, lessons } = await createCourse({
        ownerId: author.user.id,
        status: 'PUBLISHED',
        lessonCount: 2,
      });
      await prisma.enrollment.create({ data: { userId: learner.id, courseId: course.id } });
      await prisma.lessonProgress.create({
        data: {
          userId: learner.id,
          lessonId: lessons[0]!.id,
          maxWatchedSeconds: 100,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: new Date(),
        },
      });

      // Become an instructor.
      await prisma.$transaction([
        prisma.user.update({ where: { id: learner.id }, data: { role: 'INSTRUCTOR' } }),
        prisma.instructorProfile.create({
          data: {
            userId: learner.id,
            displayName: 'Promotable Learner',
            title: 'Engineer',
            bio: 'A biography of at least eighty characters so that the schema minimum for an instructor profile is satisfied.',
          },
        }),
      ]);

      const agent = await loginAs('promotable@test.dev');
      const afterApproval = await agent.agent.get('/api/v1/enrollments/me');
      expect(afterApproval.body.data).toHaveLength(1);
      expect(afterApproval.body.data[0].completedLessons).toBe(1);

      // Then get suspended.
      await prisma.instructorProfile.update({
        where: { userId: learner.id },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspensionReason: 'Suspended for the purposes of this test.',
        },
      });

      const afterSuspension = await agent.agent.get('/api/v1/enrollments/me');
      expect(afterSuspension.status).toBe(200);
      expect(afterSuspension.body.data).toHaveLength(1);
      expect(afterSuspension.body.data[0].completedLessons).toBe(1);

      // Learning still works end to end.
      const resumed = await agent
        .withCsrf(agent.agent.post(`/api/v1/lessons/${lessons[1]!.id}/complete`))
        .send({ positionSeconds: 100 });
      expect(resumed.status).toBe(200);
    });
  });
});

/** The field-error keys of a 422 body, which name the failing checks. */
function response_keys(body: { errors?: Record<string, string[]> }): string[] {
  return Object.keys(body.errors ?? {});
}
