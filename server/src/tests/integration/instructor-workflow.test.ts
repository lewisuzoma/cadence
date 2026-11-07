import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  createCourse,
  createInstructor,
  createUser,
  loginAs,
  registerAndLogin,
  resetDb,
} from '../helpers/factories.js';

/**
 * The end-to-end workflow from section 15 of the brief, as one test.
 *
 * It is deliberately a single `it`: each step depends on the previous one
 * having genuinely worked, and splitting it would let step 9 pass against
 * fixtures that step 6 never actually produced.
 *
 * Nothing is injected mid-flow — every state change goes through the HTTP
 * API with the right session's cookies, which is what makes this evidence
 * rather than decoration.
 */
describe('end-to-end: learner becomes an instructor and teaches', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('runs all eleven steps', async () => {
    // --- cast -------------------------------------------------------------
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    const admin = await loginAs('admin@test.dev');

    // Somebody else's course, for step 10.
    const other = await createInstructor({ email: 'other-instructor@test.dev' });
    const { course: foreignCourse } = await createCourse({
      ownerId: other.user.id,
      status: 'PUBLISHED',
      title: 'Another instructors course',
    });

    // An existing course for the applicant to learn from first.
    const { course: existingCourse, lessons: existingLessons } = await createCourse({
      ownerId: other.user.id,
      status: 'PUBLISHED',
      lessonCount: 2,
      durationSeconds: 100,
      title: 'Existing course',
    });

    // =====================================================================
    // 1 · register a new learner and sign in
    // =====================================================================
    const applicant = await registerAndLogin('applicant@test.dev');
    expect((await applicant.agent.get('/api/v1/auth/me')).body.data.user.role).toBe(
      'LEARNER',
    );

    // =====================================================================
    // 2 · enroll in an existing course and make progress
    // =====================================================================
    const enrolled = await applicant.withCsrf(
      applicant.agent.post(`/api/v1/courses/${existingCourse.id}/enroll`),
    );
    expect(enrolled.status).toBe(201);

    const firstComplete = await applicant
      .withCsrf(applicant.agent.post(`/api/v1/lessons/${existingLessons[0]!.id}/complete`))
      .send({ positionSeconds: 100 });
    expect(firstComplete.status).toBe(200);

    const historyBefore = await applicant.agent.get('/api/v1/enrollments/me');
    expect(historyBefore.body.data).toHaveLength(1);
    expect(historyBefore.body.data[0].completedLessons).toBe(1);

    // =====================================================================
    // 3 · apply to become an instructor; the status is PENDING
    // =====================================================================
    const applied = await applicant
      .withCsrf(applicant.agent.post('/api/v1/instructor-applications'))
      .send({
        professionalTitle: 'Senior backend engineer',
        expertise: ['TypeScript', 'Node.js'],
        experience:
          'Four years running internal workshops and mentoring new hires through their first production API.',
        biography:
          'I build and maintain payment APIs. I care about boring, reliable systems: typed boundaries, good error messages and tests that catch real bugs.',
        motivation:
          'I want to teach the whole loop, from typed boundaries through to running the thing in production.',
      });
    expect(applied.status).toBe(201);
    expect(applied.body.data.status).toBe('PENDING');

    const applicationId = (
      await prisma.instructorApplication.findFirstOrThrow({
        where: { userId: applicant.userId },
      })
    ).id;

    // =====================================================================
    // 4 · the admin reviews and approves it
    // =====================================================================
    const queue = await admin.agent.get(
      '/api/v1/admin/instructor-applications?status=PENDING',
    );
    expect(queue.status).toBe(200);
    expect(
      (queue.body.data as { id: string }[]).some((row) => row.id === applicationId),
    ).toBe(true);

    const approved = await admin
      .withCsrf(
        admin.agent.post(`/api/v1/admin/instructor-applications/${applicationId}/approve`),
      )
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');

    // =====================================================================
    // 5 · back as the applicant, WITHOUT signing in again
    // =====================================================================
    // Same cookie jar, no new login: this is the "permissions take effect
    // on the next request" guarantee, exercised rather than asserted.
    const me = await applicant.agent.get('/api/v1/auth/me');
    expect(me.body.data.user.role).toBe('INSTRUCTOR');
    expect(me.body.data.user.instructorStatus).toBe('ACTIVE');

    const dashboard = await applicant.agent.get('/api/v1/instructor/dashboard');
    expect(dashboard.status).toBe(200);

    // And the learner history is exactly as it was.
    const historyAfter = await applicant.agent.get('/api/v1/enrollments/me');
    expect(historyAfter.body.data).toHaveLength(1);
    expect(historyAfter.body.data[0].completedLessons).toBe(1);

    // =====================================================================
    // 6 · create a course, a module and two lessons, reorder, preview
    // =====================================================================
    const created = await applicant
      .withCsrf(applicant.agent.post('/api/v1/instructor/courses'))
      .send({
        title: 'Production Node.js APIs with TypeScript',
        description:
          'Build a typed Node.js API end to end: request validation, layered services, and the tests that keep it honest in production.',
        shortDescription: 'A typed Node.js API, end to end.',
        category: 'Engineering',
        thumbnailUrl: '/thumbnails/engineering-1.svg',
        difficulty: 'INTERMEDIATE',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    const courseId = created.body.data.id as string;
    const courseSlug = created.body.data.slug as string;

    const module = await applicant
      .withCsrf(applicant.agent.post(`/api/v1/instructor/courses/${courseId}/modules`))
      .send({ title: 'Foundations' });
    expect(module.status).toBe(201);
    const moduleId = module.body.data.id as string;

    // One lesson with an external URL, one that will be given an upload.
    const lessonA = await applicant
      .withCsrf(applicant.agent.post(`/api/v1/instructor/modules/${moduleId}/lessons`))
      .send({
        title: 'Project setup and tsconfig',
        description: 'Strict compiler options that catch real bugs.',
        videoUrl: 'https://example.test/setup.mp4',
        durationSeconds: 600,
        isPreview: true,
      });
    expect(lessonA.status).toBe(201);

    const lessonB = await applicant
      .withCsrf(applicant.agent.post(`/api/v1/instructor/modules/${moduleId}/lessons`))
      .send({
        title: 'Typed route handlers',
        description: 'Where the types stop being decorative.',
        videoUrl: 'https://example.test/handlers.mp4',
        durationSeconds: 900,
      });
    expect(lessonB.status).toBe(201);

    const lessonAId = lessonA.body.data.id as string;
    const lessonBId = lessonB.body.data.id as string;

    // Reorder them, and check it stuck.
    const reordered = await applicant
      .withCsrf(
        applicant.agent.patch(`/api/v1/instructor/modules/${moduleId}/lessons/reorder`),
      )
      .send({ lessonIds: [lessonBId, lessonAId] });
    expect(reordered.status).toBe(200);

    const afterReorder = await prisma.lesson.findMany({
      where: { moduleId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    expect(afterReorder.map((row) => row.id)).toEqual([lessonBId, lessonAId]);

    // Preview it: no enrollment, no progress.
    const preview = await applicant.agent.get(
      `/api/v1/instructor/courses/${courseId}/preview`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.preview.progressTracked).toBe(false);
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(0);

    // =====================================================================
    // 7 · publish, and confirm the checklist passes
    // =====================================================================
    const checklist = await applicant.agent.get(
      `/api/v1/instructor/courses/${courseId}/publish-checklist`,
    );
    expect(checklist.status).toBe(200);
    expect(checklist.body.data.canPublish).toBe(true);
    expect(
      (checklist.body.data.checks as { passed: boolean }[]).every((check) => check.passed),
    ).toBe(true);

    const published = await applicant
      .withCsrf(applicant.agent.post(`/api/v1/instructor/courses/${courseId}/publish`))
      .send({});
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('PUBLISHED');

    // =====================================================================
    // 8 · another learner finds it, enrolls and watches
    // =====================================================================
    const student = await registerAndLogin('student@test.dev');

    const catalog = await student.agent.get('/api/v1/courses?search=Production Node.js');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data).toHaveLength(1);
    // The catalog now carries the instructor, and nothing else about them.
    expect(catalog.body.data[0].instructor).toMatchObject({
      displayName: 'New Learner',
      title: 'Senior backend engineer',
    });
    expect(Object.keys(catalog.body.data[0].instructor as object).sort()).toEqual([
      'displayName',
      'photoUrl',
      'title',
    ]);

    const studentEnrolled = await student.withCsrf(
      student.agent.post(`/api/v1/courses/${courseId}/enroll`),
    );
    expect(studentEnrolled.status).toBe(201);

    const watched = await student
      .withCsrf(student.agent.post(`/api/v1/lessons/${lessonBId}/complete`))
      .send({ positionSeconds: 900 });
    expect(watched.status).toBe(200);

    // =====================================================================
    // 9 · back as the instructor: the learner and their progress appear
    // =====================================================================
    const analytics = await applicant.agent.get(
      `/api/v1/instructor/courses/${courseId}/analytics`,
    );
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.stats.enrolled).toBe(1);
    expect(analytics.body.data.stats.lessonsCompleted).toBe(1);
    // One of two lessons done.
    expect(analytics.body.data.stats.averageProgress).toBe(50);

    const learners = await applicant.agent.get(
      `/api/v1/instructor/courses/${courseId}/learners`,
    );
    expect(learners.status).toBe(200);
    expect(learners.body.data).toHaveLength(1);
    expect(learners.body.data[0].email).toBe('student@test.dev');
    expect(learners.body.data[0].progressPercentage).toBe(50);

    const learnerDetail = await applicant.agent.get(
      `/api/v1/instructor/courses/${courseId}/learners/${student.userId}/progress`,
    );
    expect(learnerDetail.status).toBe(200);
    expect(learnerDetail.body.data.completedLessons).toBe(1);

    // =====================================================================
    // 10 · another instructor's course, analytics and learners: all 404
    // =====================================================================
    for (const path of [
      `/api/v1/instructor/courses/${foreignCourse.id}`,
      `/api/v1/instructor/courses/${foreignCourse.id}/analytics`,
      `/api/v1/instructor/courses/${foreignCourse.id}/learners`,
      `/api/v1/instructor/courses/${foreignCourse.id}/preview`,
    ]) {
      const response = await applicant.agent.get(path);
      expect(response.status, `${path} should answer 404`).toBe(404);
    }

    const foreignEdit = await applicant
      .withCsrf(applicant.agent.patch(`/api/v1/instructor/courses/${foreignCourse.id}`))
      .send({ title: 'Hijacked' });
    expect(foreignEdit.status).toBe(404);

    // =====================================================================
    // 11 · the admin suspends, then reinstates
    // =====================================================================
    const suspended = await admin
      .withCsrf(admin.agent.post(`/api/v1/admin/instructors/${applicant.userId}/suspend`))
      .send({ reason: 'Suspended as part of the end-to-end workflow test.' });
    expect(suspended.status).toBe(200);

    // Teaching: refused on the very next request.
    expect((await applicant.agent.get('/api/v1/instructor/dashboard')).status).toBe(403);
    const blockedEdit = await applicant
      .withCsrf(applicant.agent.patch(`/api/v1/instructor/courses/${courseId}`))
      .send({ title: 'Should not save' });
    expect(blockedEdit.status).toBe(403);

    // Learning: entirely unaffected, including the history from step 2.
    const learningWhileSuspended = await applicant.agent.get('/api/v1/enrollments/me');
    expect(learningWhileSuspended.status).toBe(200);
    expect(learningWhileSuspended.body.data).toHaveLength(1);
    expect(learningWhileSuspended.body.data[0].completedLessons).toBe(1);
    expect((await applicant.agent.get('/api/v1/dashboard/learner')).status).toBe(200);

    const stillLearning = await applicant
      .withCsrf(applicant.agent.post(`/api/v1/lessons/${existingLessons[1]!.id}/complete`))
      .send({ positionSeconds: 100 });
    expect(stillLearning.status).toBe(200);

    // Reinstate: access returns, again without a new sign-in.
    const reinstated = await admin
      .withCsrf(admin.agent.post(`/api/v1/admin/instructors/${applicant.userId}/reinstate`))
      .send({});
    expect(reinstated.status).toBe(200);

    expect((await applicant.agent.get('/api/v1/instructor/dashboard')).status).toBe(200);
    const editAgain = await applicant
      .withCsrf(applicant.agent.patch(`/api/v1/instructor/courses/${courseId}`))
      .send({ title: 'Production Node.js APIs with TypeScript (2nd edition)' });
    expect(editAgain.status).toBe(200);

    // --- and the course is still intact for its learner -------------------
    const studentView = await student.agent.get(`/api/v1/courses/${courseSlug}`);
    expect(studentView.status).toBe(200);
    expect(studentView.body.data.enrollment.completedLessons).toBe(1);
  }, 60_000);
});
