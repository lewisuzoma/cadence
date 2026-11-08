import type { PrismaClient } from '@prisma/client';

/**
 * Gives every published course a live version.
 *
 * Learner-facing reads come from the live version, so a seeded course
 * without one would be invisible in the catalogue — the seed would
 * produce a database the application cannot show. Running this at the
 * end of the seed is the equivalent of the instructor pressing Publish.
 *
 * Idempotent like the rest: a course that already has a live version is
 * left alone, so seeding twice does not stack up v2, v3, v4…
 */
export async function seedCourseVersions(prisma: PrismaClient): Promise<number> {
  const courses = await prisma.course.findMany({
    where: {
      status: { in: ['PUBLISHED', 'ARCHIVED'] },
      liveVersionId: null,
    },
    select: {
      id: true,
      title: true,
      shortDescription: true,
      description: true,
      category: true,
      difficulty: true,
      thumbnailUrl: true,
      learningObjectives: true,
      prerequisites: true,
      targetAudience: true,
      createdById: true,
      publishedAt: true,
      createdAt: true,
    },
  });

  for (const course of courses) {
    const version = await prisma.courseVersion.create({
      data: {
        courseId: course.id,
        version: 1,
        title: course.title,
        shortDescription: course.shortDescription,
        description: course.description,
        category: course.category,
        difficulty: course.difficulty,
        thumbnailUrl: course.thumbnailUrl,
        learningObjectives: course.learningObjectives,
        prerequisites: course.prerequisites,
        targetAudience: course.targetAudience,
        publishedById: course.createdById,
        publishedAt: course.publishedAt ?? course.createdAt,
        changeSummary: 'Initial release.',
      },
    });

    const lessons = await prisma.lesson.findMany({
      where: { courseId: course.id },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
      select: {
        id: true,
        title: true,
        description: true,
        durationSeconds: true,
        order: true,
        isPreview: true,
        module: { select: { title: true, order: true } },
      },
    });

    if (lessons.length > 0) {
      await prisma.courseVersionLesson.createMany({
        data: lessons.map((lesson) => ({
          versionId: version.id,
          lessonId: lesson.id,
          moduleTitle: lesson.module.title,
          moduleOrder: lesson.module.order,
          title: lesson.title,
          description: lesson.description,
          durationSeconds: lesson.durationSeconds,
          order: lesson.order,
          isPreview: lesson.isPreview,
        })),
      });
    }

    await prisma.course.update({
      where: { id: course.id },
      data: { liveVersionId: version.id },
    });
  }

  return courses.length;
}
