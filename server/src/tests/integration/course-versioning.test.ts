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
 * Course content versioning.
 *
 * The promise is narrow and worth stating: **a learner sees the course
 * as it was published, and an instructor's work in progress stays
 * invisible until they say otherwise.** Almost every test here is some
 * form of "the instructor changed something; did the learner notice?" —
 * which should be no, until the moment they publish.
 */

type Agent = Awaited<ReturnType<typeof loginAs>>;

/** Publishes a course and returns the response. */
function publish(agent: Agent, courseId: string, changeSummary?: string) {
  return agent
    .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${courseId}/publish`))
    .send(changeSummary ? { changeSummary } : {});
}

describe('course content versioning', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // =========================================================================
  describe('publishing takes a snapshot', () => {
    it('creates version 1 with the curriculum as it stands', async () => {
      const { user } = await createInstructor({ email: 'v1@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('v1@test.dev');

      const published = await publish(agent, course.id, 'First release.');
      expect(published.status).toBe(200);

      const version = await prisma.courseVersion.findFirstOrThrow({
        where: { courseId: course.id },
        include: { lessons: true },
      });
      expect(version.version).toBe(1);
      expect(version.changeSummary).toBe('First release.');
      expect(version.lessons).toHaveLength(2);

      const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(row.liveVersionId).toBe(version.id);
    });

    it('increments the version on each publish and keeps the history', async () => {
      const { user } = await createInstructor({ email: 'v2@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 1,
      });
      const agent = await loginAs('v2@test.dev');

      await publish(agent, course.id, 'First.');
      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/courses/${course.id}`))
        .send({ title: 'A better title' });
      await publish(agent, course.id, 'Retitled.');

      const versions = await prisma.courseVersion.findMany({
        where: { courseId: course.id },
        orderBy: { version: 'asc' },
      });
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      // The old version is kept, with the title it carried.
      expect(versions[0]!.title).not.toBe('A better title');
      expect(versions[1]!.title).toBe('A better title');

      const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(row.liveVersionId).toBe(versions[1]!.id);
    });
  });

  // =========================================================================
  describe('a learner sees the published version, not the draft', () => {
    /** A published course with one enrolled learner. */
    async function publishedCourseWithLearner(email: string) {
      const { user } = await createInstructor({ email });
      const { course, module } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
        title: 'Original title',
      });
      const agent = await loginAs(email);
      await publish(agent, course.id);

      const learner = await createUser({ email: `learner-${email}` });
      await prisma.enrollment.create({
        data: { userId: learner.id, courseId: course.id },
      });
      const learnerAgent = await loginAs(`learner-${email}`);

      return { owner: user, course, module, agent, learner, learnerAgent };
    }

    it('keeps an edited title out of the catalog until it is published', async () => {
      const { course, agent, learnerAgent } = await publishedCourseWithLearner(
        'title@test.dev',
      );

      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/courses/${course.id}`))
        .send({ title: 'Work in progress title' });

      // The catalogue still shows what was published.
      const catalog = await learnerAgent.agent.get('/api/v1/courses?search=Original');
      expect(catalog.body.data).toHaveLength(1);
      expect(catalog.body.data[0].title).toBe('Original title');

      // And so does the course page.
      const detail = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      expect(detail.body.data.title).toBe('Original title');

      // The instructor sees their own draft, which is the point.
      const draft = await agent.agent.get(`/api/v1/instructor/courses/${course.id}`);
      expect(draft.body.data.title).toBe('Work in progress title');

      // Publishing is what makes it real.
      await publish(agent, course.id);
      const after = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      expect(after.body.data.title).toBe('Work in progress title');
    });

    it('hides a lesson added after publication', async () => {
      const { course, module, agent, learnerAgent } = await publishedCourseWithLearner(
        'addlesson@test.dev',
      );

      const added = await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/modules/${module.id}/lessons`))
        .send({
          title: 'Not ready for anyone yet',
          description: 'Half written.',
          videoUrl: 'https://example.test/wip.mp4',
          durationSeconds: 300,
        });
      expect(added.status).toBe(201);
      const newLessonId = added.body.data.id as string;

      // Absent from the learner's curriculum...
      const detail = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      const titles = (detail.body.data.modules as { lessons: { title: string }[] }[])
        .flatMap((m) => m.lessons)
        .map((l) => l.title);
      expect(titles).not.toContain('Not ready for anyone yet');
      expect(detail.body.data.lessonCount).toBe(2);

      // ...and from the flat list...
      const list = await learnerAgent.agent.get(`/api/v1/courses/${course.id}/lessons`);
      expect(list.body.data).toHaveLength(2);

      // ...and unreachable even with its id in hand, which is what makes
      // the hiding meaningful rather than cosmetic.
      const direct = await learnerAgent.agent.get(`/api/v1/lessons/${newLessonId}`);
      expect(direct.status).toBe(404);

      // The instructor can see and open it.
      const ownerView = await agent.agent.get(`/api/v1/lessons/${newLessonId}`);
      expect(ownerView.status).toBe(200);
    });

    it('keeps an edited lesson title out of the learner view', async () => {
      const { course, agent, learnerAgent } = await publishedCourseWithLearner(
        'editlesson@test.dev',
      );
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { courseId: course.id },
        orderBy: { order: 'asc' },
      });

      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/lessons/${lesson.id}`))
        .send({ title: 'Renamed in the draft' });

      const detail = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      const titles = (detail.body.data.modules as { lessons: { title: string }[] }[])
        .flatMap((m) => m.lessons)
        .map((l) => l.title);
      expect(titles).not.toContain('Renamed in the draft');

      await publish(agent, course.id);
      const after = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      const afterTitles = (after.body.data.modules as { lessons: { title: string }[] }[])
        .flatMap((m) => m.lessons)
        .map((l) => l.title);
      expect(afterTitles).toContain('Renamed in the draft');
    });

    it('does not make a lesson free just because the draft says so', async () => {
      const { course, agent } = await publishedCourseWithLearner('previewflag@test.dev');
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { courseId: course.id },
        orderBy: { order: 'asc' },
      });

      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/lessons/${lesson.id}`))
        .send({ isPreview: true });

      // A stranger must not get it until the flag is actually published.
      await createUser({ email: 'stranger-preview@test.dev' });
      const stranger = await loginAs('stranger-preview@test.dev');
      expect((await stranger.agent.get(`/api/v1/lessons/${lesson.id}`)).status).toBe(403);

      await publish(agent, course.id);
      expect((await stranger.agent.get(`/api/v1/lessons/${lesson.id}`)).status).toBe(200);
    });

    it('leaves progress intact across a publish', async () => {
      const { course, agent, learner, learnerAgent } = await publishedCourseWithLearner(
        'progress@test.dev',
      );
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { courseId: course.id },
        orderBy: { order: 'asc' },
      });

      const completed = await learnerAgent
        .withCsrf(learnerAgent.agent.post(`/api/v1/lessons/${lesson.id}/complete`))
        .send({ positionSeconds: 100 });
      expect(completed.status).toBe(200);

      // Rename the lesson and publish: progress is keyed by lesson id,
      // which a version references rather than copies, so it survives.
      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/lessons/${lesson.id}`))
        .send({ title: 'Renamed after someone finished it' });
      await publish(agent, course.id);

      const enrollments = await learnerAgent.agent.get('/api/v1/enrollments/me');
      expect(enrollments.body.data[0].completedLessons).toBe(1);

      expect(
        await prisma.lessonProgress.count({
          where: { userId: learner.id, lessonId: lesson.id, isCompleted: true },
        }),
      ).toBe(1);
    });
  });

  // =========================================================================
  describe('the draft state the editor reads', () => {
    it('reports no pending changes immediately after publishing', async () => {
      const { user } = await createInstructor({ email: 'clean@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 1,
      });
      const agent = await loginAs('clean@test.dev');
      await publish(agent, course.id);

      const state = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/draft-state`,
      );
      expect(state.status).toBe(200);
      expect(state.body.data.hasUnpublishedChanges).toBe(false);
      expect(state.body.data.pendingChanges).toEqual([]);
      expect(state.body.data.liveVersion).toBe(1);
      expect(state.body.data.history).toHaveLength(1);
    });

    it('names what a learner would notice', async () => {
      const { user } = await createInstructor({ email: 'pending@test.dev' });
      const { course, module, lessons } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('pending@test.dev');
      await publish(agent, course.id);

      // Four different kinds of change.
      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/courses/${course.id}`))
        .send({ title: 'Changed' });
      await agent
        .withCsrf(agent.agent.patch(`/api/v1/instructor/lessons/${lessons[0]!.id}`))
        .send({ title: 'Also changed' });
      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/modules/${module.id}/lessons`))
        .send({
          title: 'Brand new',
          description: 'New.',
          videoUrl: 'https://example.test/n.mp4',
          durationSeconds: 100,
        });
      await agent.withCsrf(
        agent.agent.delete(`/api/v1/instructor/lessons/${lessons[1]!.id}`),
      );

      const state = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/draft-state`,
      );
      expect(state.body.data.hasUnpublishedChanges).toBe(true);

      const kinds = (state.body.data.pendingChanges as { kind: string }[]).map(
        (change) => change.kind,
      );
      expect(kinds).toEqual(
        expect.arrayContaining(['COURSE_FIELD', 'LESSON_EDITED', 'LESSON_ADDED']),
      );

      /*
       * The deletion is NOT listed as pending, and that is correct:
       * deleting a lesson also deletes every learner's progress on it,
       * which cannot honestly be deferred, so it takes effect at once.
       * The separate test below pins that behaviour down.
       */
      expect(kinds).not.toContain('LESSON_REMOVED');
    });

    it('notices a reorder, and reports it once rather than per lesson', async () => {
      const { user } = await createInstructor({ email: 'reorderv@test.dev' });
      const { course, module, lessons } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 3,
      });
      const agent = await loginAs('reorderv@test.dev');
      await publish(agent, course.id);

      await agent
        .withCsrf(
          agent.agent.patch(`/api/v1/instructor/modules/${module.id}/lessons/reorder`),
        )
        .send({ lessonIds: [lessons[2]!.id, lessons[1]!.id, lessons[0]!.id] });

      const state = await agent.agent.get(
        `/api/v1/instructor/courses/${course.id}/draft-state`,
      );
      const reorders = (state.body.data.pendingChanges as { kind: string }[]).filter(
        (change) => change.kind === 'LESSONS_REORDERED',
      );
      // Moving three lessons is one change the learner notices, not three.
      expect(reorders).toHaveLength(1);
    });

    it('answers 404 for another instructor’s course', async () => {
      const alice = await createInstructor({ email: 'alice-v@test.dev' });
      await createInstructor({ email: 'bob-v@test.dev' });
      const { course } = await createCourse({ ownerId: alice.user.id, status: 'DRAFT' });

      const bob = await loginAs('bob-v@test.dev');
      const state = await bob.agent.get(
        `/api/v1/instructor/courses/${course.id}/draft-state`,
      );
      expect(state.status).toBe(404);
    });
  });

  // =========================================================================
  describe('unpublishing and archiving', () => {
    it('keeps the version so republishing does not lose the history', async () => {
      const { user } = await createInstructor({ email: 'unpub-v@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 1,
      });
      const agent = await loginAs('unpub-v@test.dev');
      await publish(agent, course.id);

      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/unpublish`))
        .send({});

      // The version survives; the course is simply not live.
      expect(
        await prisma.courseVersion.count({ where: { courseId: course.id } }),
      ).toBe(1);

      await publish(agent, course.id);
      const versions = await prisma.courseVersion.findMany({
        where: { courseId: course.id },
      });
      // Republishing adds a version rather than overwriting the first.
      expect(versions).toHaveLength(2);
    });

    it('keeps an archived course readable for the learners already on it', async () => {
      const { user } = await createInstructor({ email: 'archive-v@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('archive-v@test.dev');
      await publish(agent, course.id);

      const learner = await createUser({ email: 'archived-learner@test.dev' });
      await prisma.enrollment.create({
        data: { userId: learner.id, courseId: course.id },
      });

      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/archive`))
        .send({});

      const learnerAgent = await loginAs('archived-learner@test.dev');
      const detail = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      expect(detail.status).toBe(200);
      // The curriculum they signed up to is still what they see.
      expect(detail.body.data.lessonCount).toBe(2);
    });
  });

  // =========================================================================
  describe('deleting a lesson that is live', () => {
    it('removes it from the published curriculum too', async () => {
      const { user } = await createInstructor({ email: 'delete-v@test.dev' });
      const { course, lessons } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('delete-v@test.dev');
      await publish(agent, course.id);

      const learner = await createUser({ email: 'delete-v-learner@test.dev' });
      await prisma.enrollment.create({
        data: { userId: learner.id, courseId: course.id },
      });

      await agent.withCsrf(
        agent.agent.delete(`/api/v1/instructor/lessons/${lessons[0]!.id}`),
      );

      /*
       * The snapshot row cascades with the lesson. Keeping it would mean
       * the published curriculum listed a lesson that cannot be played,
       * which is worse than the course getting shorter.
       */
      const learnerAgent = await loginAs('delete-v-learner@test.dev');
      const detail = await learnerAgent.agent.get(`/api/v1/courses/${course.slug}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.lessonCount).toBe(1);

      expect(
        await prisma.courseVersionLesson.count({ where: { lessonId: lessons[0]!.id } }),
      ).toBe(0);
    });
  });
});
