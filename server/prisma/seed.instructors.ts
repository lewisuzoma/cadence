import type { PrismaClient } from '@prisma/client';

/**
 * Instructor-feature seed data.
 *
 * Kept beside the main seed rather than inside it: this is a separate
 * concern with its own cast of people, and a 900-line seed file is harder
 * to reason about than two smaller ones.
 *
 * Idempotent like the rest, through `upsert` on natural keys. Running the
 * seed twice must change nothing, which is a property the test suite
 * checks rather than a promise this comment makes.
 */

export type InstructorSeedResult = {
  approved: { id: string; email: string };
  suspended: { id: string; email: string };
  pendingApplicant: { id: string; email: string };
  rejectedApplicant: { id: string; email: string };
  withdrawnApplicant: { id: string; email: string };
  courses: { id: string; slug: string; title: string; lessonIds: string[] }[];
};

/** Lesson bodies for the approved instructor's two courses. */
const OBSERVABILITY_LESSONS = [
  { title: 'Why observability beats guessing', seconds: 742, preview: true },
  { title: 'Structured logging in Express', seconds: 1265, preview: false },
  { title: 'Correlation IDs across services', seconds: 918, preview: false },
];

const INDEXING_LESSONS = [
  { title: 'How Postgres chooses an index', seconds: 1104, preview: true },
  { title: 'B-tree, GIN and when each wins', seconds: 1382, preview: false },
  { title: 'Reading EXPLAIN without fear', seconds: 1540, preview: false },
  { title: 'Indexes that make writes slow', seconds: 866, preview: false },
];

export async function seedInstructors(
  prisma: PrismaClient,
  passwordHash: string,
  sampleVideoUrl: string,
  adminId: string,
): Promise<InstructorSeedResult> {
  // --- the people ---------------------------------------------------------

  const approved = await prisma.user.upsert({
    where: { email: 'nadia@cadence.dev' },
    update: {},
    create: {
      firstName: 'Nadia',
      lastName: 'Rahman',
      email: 'nadia@cadence.dev',
      passwordHash,
      role: 'INSTRUCTOR',
    },
  });
  // A second upsert pass, because a user seeded as a LEARNER by an earlier
  // version of this seed must be promoted rather than left behind.
  await prisma.user.update({ where: { id: approved.id }, data: { role: 'INSTRUCTOR' } });

  const suspended = await prisma.user.upsert({
    where: { email: 'yusuf@cadence.dev' },
    update: {},
    create: {
      firstName: 'Yusuf',
      lastName: 'Danjuma',
      email: 'yusuf@cadence.dev',
      passwordHash,
      role: 'INSTRUCTOR',
    },
  });
  await prisma.user.update({ where: { id: suspended.id }, data: { role: 'INSTRUCTOR' } });

  const pendingApplicant = await prisma.user.upsert({
    where: { email: 'kemi@cadence.dev' },
    update: {},
    create: {
      firstName: 'Kemi',
      lastName: 'Adeyemi',
      email: 'kemi@cadence.dev',
      passwordHash,
      role: 'LEARNER',
    },
  });

  const rejectedApplicant = await prisma.user.upsert({
    where: { email: 'chidi@cadence.dev' },
    update: {},
    create: {
      firstName: 'Chidi',
      lastName: 'Eze',
      email: 'chidi@cadence.dev',
      passwordHash,
      role: 'LEARNER',
    },
  });

  const withdrawnApplicant = await prisma.user.upsert({
    where: { email: 'sofia@cadence.dev' },
    update: {},
    create: {
      firstName: 'Sofia',
      lastName: 'Rossi',
      email: 'sofia@cadence.dev',
      passwordHash,
      role: 'LEARNER',
    },
  });

  // --- instructor profiles -----------------------------------------------

  await prisma.instructorProfile.upsert({
    where: { userId: approved.id },
    update: { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
    create: {
      userId: approved.id,
      displayName: 'Nadia Rahman',
      title: 'Senior backend engineer',
      bio: 'I build and maintain payment APIs used by small businesses across West Africa. I care about boring, reliable systems: typed boundaries, good error messages and tests that catch real bugs before customers do.',
      status: 'ACTIVE',
      approvedAt: daysAgo(60),
    },
  });

  await prisma.instructorProfile.upsert({
    where: { userId: suspended.id },
    update: {
      status: 'SUSPENDED',
      suspendedAt: daysAgo(4),
      suspendedById: adminId,
      suspensionReason:
        'Two lessons use third-party video without permission. Replace them and reply to the review email, and we will reinstate your access.',
    },
    create: {
      userId: suspended.id,
      displayName: 'Yusuf Danjuma',
      title: 'Analytics engineer',
      bio: 'I work on data pipelines and the dashboards that sit on top of them. I like teaching the parts that are easy to get subtly wrong: time zones, late-arriving rows and idempotent loads.',
      status: 'SUSPENDED',
      approvedAt: daysAgo(120),
      suspendedAt: daysAgo(4),
      suspendedById: adminId,
      suspensionReason:
        'Two lessons use third-party video without permission. Replace them and reply to the review email, and we will reinstate your access.',
    },
  });

  // --- applications in each state ----------------------------------------
  //
  // Found by (userId, status) rather than upserted on a unique key: an
  // application has no natural one, and the partial index only covers
  // PENDING. Checking first is what keeps a second seed run from stacking
  // up duplicates.

  const pendingApplication = await ensureApplication(prisma, {
    userId: pendingApplicant.id,
    status: 'PENDING',
    professionalTitle: 'Lead product designer',
    expertise: ['Figma', 'Design systems', 'Accessibility', 'UX research'],
    experience:
      'Run a monthly design critique for 30 designers across our product teams. Taught a 6-week accessibility course at a Lagos design bootcamp (two cohorts, 48 students). Regular speaker at local UX meetups.',
    biography:
      'I lead product design for a payments company, where I built and now maintain our design system. Before that I was a front-end developer, so I care a lot about handoff, tokens and components that engineers actually use.',
    motivation:
      'Most design system courses stop at Figma. I want to teach the whole loop: tokens, accessible components, documentation and adoption. Cadence’s engineering audience is exactly who I want to reach.',
    portfolioUrl: 'https://kemi.design',
    submittedAt: daysAgo(1),
  });

  await ensureApplication(prisma, {
    userId: rejectedApplicant.id,
    status: 'REJECTED',
    professionalTitle: 'Backend engineer',
    expertise: ['Node.js', 'REST'],
    experience:
      'Two years mentoring junior engineers on our platform team, plus a handful of internal brown-bag talks on API design.',
    biography:
      'I work on internal platform services and spend most of my time on the boundary between teams: contracts, versioning and the migrations nobody wants to own.',
    motivation:
      'I would like to turn the internal talks I have been giving into something more structured that other people can follow at their own pace.',
    submittedAt: daysAgo(10),
    decidedAt: daysAgo(8),
    decidedById: adminId,
    decisionReason:
      'Your experience is a strong fit, but we already have two Node.js API courses. Please reapply with a topic outline for something not yet in the catalog, such as API security or observability.',
  });

  await ensureApplication(prisma, {
    userId: withdrawnApplicant.id,
    status: 'WITHDRAWN',
    professionalTitle: 'Frontend engineer',
    expertise: ['React', 'TypeScript'],
    experience:
      'Ran an internal React workshop series for about 20 engineers over six weeks, and wrote the team’s component guidelines.',
    biography:
      'I build design-system components and the tooling around them. Most of what I know about accessibility I learned by getting it wrong in production first.',
    motivation:
      'I wanted to write up the workshop material properly, but my team is short-handed this quarter so I have withdrawn for now.',
    submittedAt: daysAgo(20),
    decidedAt: daysAgo(18),
  });

  // --- the approved instructor's courses ----------------------------------

  const published = await ensureCourse(prisma, {
    ownerId: approved.id,
    slug: 'observability-for-backend-engineers',
    title: 'Observability for Backend Engineers',
    shortDescription:
      'Logs, metrics and traces that help you find production bugs in minutes, not days.',
    description:
      'Most outages are slow to fix because nobody can see what the system is doing. In this course you will instrument a Node.js API with structured logs, RED metrics and distributed traces, then use them to debug three realistic incidents.',
    category: 'Engineering',
    difficulty: 'INTERMEDIATE',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/engineering-1.svg',
    learningObjectives: [
      'Add structured, correlated logs to an Express API',
      'Choose and alert on RED metrics',
      'Trace a slow request across services',
    ],
    prerequisites: ['Comfortable with Node.js and HTTP', 'Has deployed at least one API'],
    targetAudience:
      'Backend and full-stack engineers who run their own services in production. Not aimed at people new to programming.',
    moduleTitle: 'Foundations',
    lessons: OBSERVABILITY_LESSONS,
    videoUrl: sampleVideoUrl,
    publishedAt: daysAgo(45),
  });

  const draft = await ensureCourse(prisma, {
    ownerId: approved.id,
    slug: 'postgresql-indexing-in-practice',
    title: 'Intro to PostgreSQL Indexing',
    shortDescription:
      'Why your query is slow, and which index actually fixes it.',
    description:
      'Indexes are the first thing people reach for and the last thing they measure. This course works through the planner’s decisions on real tables: what each index type costs to maintain, how to read EXPLAIN, and when adding an index makes things worse.',
    category: 'Data',
    difficulty: 'INTERMEDIATE',
    status: 'DRAFT',
    thumbnailUrl: '/thumbnails/data-1.svg',
    learningObjectives: [
      'Read an EXPLAIN ANALYZE plan',
      'Choose between B-tree, GIN and BRIN',
    ],
    prerequisites: ['Comfortable writing SQL joins'],
    targetAudience: 'Engineers who own a Postgres database and have had a query go bad.',
    moduleTitle: 'Planning and indexes',
    lessons: INDEXING_LESSONS,
    videoUrl: sampleVideoUrl,
    publishedAt: null,
  });

  // --- learners on the published course -----------------------------------
  //
  // Real enrollments and real progress rows, so the instructor dashboard
  // and the analytics page have something true to show on a fresh install
  // rather than rendering zeroes.

  const learners = await prisma.user.findMany({
    where: { email: { in: ['ada@cadence.dev', 'kwame@cadence.dev', 'lina@cadence.dev'] } },
    select: { id: true, email: true },
  });

  // Ada finishes it, Kwame is partway, Lina has just enrolled.
  const plan: Record<string, number> = {
    'ada@cadence.dev': published.lessonIds.length,
    'kwame@cadence.dev': 2,
    'lina@cadence.dev': 0,
  };

  for (const learner of learners) {
    const completed = plan[learner.email] ?? 0;
    const finished = completed === published.lessonIds.length && completed > 0;

    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: learner.id, courseId: published.id } },
      update: {},
      create: {
        userId: learner.id,
        courseId: published.id,
        enrolledAt: daysAgo(30),
        lastAccessedAt: completed > 0 ? daysAgo(2) : null,
        status: finished ? 'COMPLETED' : 'ACTIVE',
        ...(finished ? { completedAt: daysAgo(2), firstCompletedAt: daysAgo(2) } : {}),
      },
    });

    for (let index = 0; index < completed; index++) {
      const lessonId = published.lessonIds[index]!;
      const seconds = OBSERVABILITY_LESSONS[index]?.seconds ?? 600;
      await prisma.lessonProgress.upsert({
        where: { userId_lessonId: { userId: learner.id, lessonId } },
        update: {},
        create: {
          userId: learner.id,
          lessonId,
          lastPositionSeconds: seconds,
          maxWatchedSeconds: seconds,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: daysAgo(3),
        },
      });
    }
  }

  // --- a course event, so the activity feed is not empty -------------------
  const existingEvent = await prisma.courseEvent.findFirst({
    where: { courseId: published.id, type: 'PUBLISHED' },
  });
  if (!existingEvent) {
    await prisma.courseEvent.create({
      data: {
        courseId: published.id,
        actorId: approved.id,
        type: 'PUBLISHED',
        createdAt: daysAgo(45),
      },
    });
  }

  // --- a notification for the pending application --------------------------
  const existingNotification = await prisma.notification.findFirst({
    where: { userId: adminId, type: 'APPLICATION_RECEIVED' },
  });
  if (!existingNotification) {
    await prisma.notification.create({
      data: {
        userId: adminId,
        type: 'APPLICATION_RECEIVED',
        title: 'New instructor application',
        body: 'Kemi Adeyemi applied to teach. Review it in Applications.',
        link: `/admin/instructor-applications/${pendingApplication.id}`,
        createdAt: daysAgo(1),
      },
    });
  }

  return {
    approved: { id: approved.id, email: approved.email },
    suspended: { id: suspended.id, email: suspended.email },
    pendingApplicant: { id: pendingApplicant.id, email: pendingApplicant.email },
    rejectedApplicant: { id: rejectedApplicant.id, email: rejectedApplicant.email },
    withdrawnApplicant: { id: withdrawnApplicant.id, email: withdrawnApplicant.email },
    courses: [published, draft],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Creates an application only if this user has none in that state. */
async function ensureApplication(
  prisma: PrismaClient,
  input: {
    userId: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
    professionalTitle: string;
    expertise: string[];
    experience: string;
    biography: string;
    motivation: string;
    portfolioUrl?: string;
    submittedAt: Date;
    decidedAt?: Date;
    decidedById?: string;
    decisionReason?: string;
  },
) {
  const existing = await prisma.instructorApplication.findFirst({
    where: { userId: input.userId, status: input.status },
  });
  if (existing) return existing;

  const application = await prisma.instructorApplication.create({
    data: {
      userId: input.userId,
      professionalTitle: input.professionalTitle,
      expertise: input.expertise,
      experience: input.experience,
      biography: input.biography,
      motivation: input.motivation,
      status: input.status,
      submittedAt: input.submittedAt,
      createdAt: input.submittedAt,
      ...(input.portfolioUrl ? { portfolioUrl: input.portfolioUrl } : {}),
      ...(input.decidedAt ? { decidedAt: input.decidedAt } : {}),
      ...(input.decidedById ? { decidedById: input.decidedById } : {}),
      ...(input.decisionReason ? { decisionReason: input.decisionReason } : {}),
    },
  });

  // The matching history, so the status page and the admin timeline have
  // something real to render rather than an empty list.
  await prisma.instructorApplicationEvent.create({
    data: {
      applicationId: application.id,
      userId: input.userId,
      actorId: input.userId,
      action: 'SUBMITTED',
      toStatus: 'PENDING',
      createdAt: input.submittedAt,
    },
  });

  if (input.status === 'REJECTED' || input.status === 'WITHDRAWN') {
    await prisma.instructorApplicationEvent.create({
      data: {
        applicationId: application.id,
        userId: input.userId,
        actorId: input.decidedById ?? input.userId,
        action: input.status === 'REJECTED' ? 'REJECTED' : 'WITHDRAWN',
        fromStatus: 'PENDING',
        toStatus: input.status,
        ...(input.decisionReason ? { reason: input.decisionReason } : {}),
        createdAt: input.decidedAt ?? input.submittedAt,
      },
    });
  }

  return application;
}

/** Upserts a course with one module and its lessons. */
async function ensureCourse(
  prisma: PrismaClient,
  input: {
    ownerId: string;
    slug: string;
    title: string;
    shortDescription: string;
    description: string;
    category: string;
    difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    thumbnailUrl: string;
    learningObjectives: string[];
    prerequisites: string[];
    targetAudience: string;
    moduleTitle: string;
    lessons: { title: string; seconds: number; preview: boolean }[];
    videoUrl: string;
    publishedAt: Date | null;
  },
) {
  const course = await prisma.course.upsert({
    where: { slug: input.slug },
    update: {
      title: input.title,
      shortDescription: input.shortDescription,
      description: input.description,
      category: input.category,
      difficulty: input.difficulty,
      status: input.status,
      thumbnailUrl: input.thumbnailUrl,
      learningObjectives: input.learningObjectives,
      prerequisites: input.prerequisites,
      targetAudience: input.targetAudience,
    },
    create: {
      slug: input.slug,
      title: input.title,
      shortDescription: input.shortDescription,
      description: input.description,
      category: input.category,
      difficulty: input.difficulty,
      status: input.status,
      thumbnailUrl: input.thumbnailUrl,
      learningObjectives: input.learningObjectives,
      prerequisites: input.prerequisites,
      targetAudience: input.targetAudience,
      createdById: input.ownerId,
      publishedAt: input.publishedAt,
    },
  });

  const module = await prisma.module.upsert({
    where: { courseId_order: { courseId: course.id, order: 1 } },
    update: { title: input.moduleTitle },
    create: { courseId: course.id, title: input.moduleTitle, order: 1 },
  });

  const lessonIds: string[] = [];
  for (const [index, lesson] of input.lessons.entries()) {
    const row = await prisma.lesson.upsert({
      where: { moduleId_order: { moduleId: module.id, order: index + 1 } },
      update: {
        title: lesson.title,
        durationSeconds: lesson.seconds,
        isPreview: lesson.preview,
      },
      create: {
        moduleId: module.id,
        courseId: course.id,
        title: lesson.title,
        description: `${lesson.title} — part of ${input.title}.`,
        videoUrl: input.videoUrl,
        durationSeconds: lesson.seconds,
        order: index + 1,
        isPreview: lesson.preview,
      },
    });
    lessonIds.push(row.id);
  }

  return { id: course.id, slug: course.slug, title: course.title, lessonIds };
}
