/**
 * Idempotent seed.
 *
 * Every write is an `upsert` keyed on a natural unique column (user email,
 * course slug, module position, lesson position), so running this twice — or
 * twenty times — converges on the same database instead of duplicating rows.
 * The Compose `migrate` job runs it on every `up`, which is exactly the case
 * that has to be safe.
 *
 * Course titles, categories and lesson names mirror the design artifacts, so
 * a reviewer opening the app sees the screens the PDFs describe.
 */
import { SAMPLE_LESSON_VIDEO } from '@cadence/shared';
import { PrismaClient, type Difficulty, type CourseStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Low cost here on purpose: seeding 4 users at cost 12 is needlessly slow. */
const SEED_BCRYPT_COST = 10;

const SEED_PASSWORD = 'Password123';

type LessonSeed = {
  title: string;
  description: string;
  durationSeconds: number;
  isPreview?: boolean;
  captions?: boolean;
};

type ModuleSeed = { title: string; lessons: LessonSeed[] };

type CourseSeed = {
  slug: string;
  title: string;
  description: string;
  category: string;
  difficulty: Difficulty;
  status: CourseStatus;
  thumbnailUrl: string;
  modules: ModuleSeed[];
};

/**
 * The bundled sample lesson, served by the client from `client/public/media`.
 *
 * This used to point at Blender's open movies on Google's public sample
 * bucket; that bucket now answers 403, which left every seeded lesson with a
 * dead `videoUrl`. The sample ships with the repository instead, so it cannot
 * rot, needs no CDN and satisfies the client's own `media-src 'self'` CSP.
 * Rebuild it with `npm run lesson:video` (scripts/make-lesson-video.mjs).
 *
 * One file serves every lesson, so every lesson is seeded with the sample's
 * own length rather than the per-lesson figure below: the curriculum, the
 * player's timecode and the completion rules then all agree about how long a
 * lesson is. `videoUrl` and `durationSeconds` are plain columns — point a
 * deployment at its own media and the authored durations apply again.
 */
const SAMPLE_VIDEO = SAMPLE_LESSON_VIDEO;

const COURSES: CourseSeed[] = [
  {
    slug: 'typescript-for-production-apis',
    title: 'TypeScript for Production APIs',
    description:
      'Build a typed Node.js API end to end: request validation, layered services, database access and the tests that keep it honest.',
    category: 'Engineering',
    difficulty: 'INTERMEDIATE',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/typescript-for-production-apis.svg',
    modules: [
      {
        title: 'Module 1 · Foundations',
        lessons: [
          {
            title: 'Project setup & tsconfig',
            description:
              'Strict compiler options, path aliases and a build that fails loudly instead of guessing.',
            durationSeconds: 725,
            isPreview: true,
            captions: true,
          },
          {
            title: 'Types that model your domain',
            description: 'Make the illegal states unrepresentable before writing any logic.',
            durationSeconds: 1000,
          },
          {
            title: 'Errors as values',
            description: 'One error hierarchy, one translation layer, no swallowed failures.',
            durationSeconds: 1110,
          },
          {
            title: 'Typed route handlers',
            description: 'Wiring Express so a handler cannot read an unvalidated field.',
            durationSeconds: 1330,
          },
        ],
      },
      {
        title: 'Module 2 · Validation & services',
        lessons: [
          {
            title: 'Validating input with Zod',
            description:
              'Define one schema per request body, infer the TypeScript type from it, and return structured 422 errors the frontend can map straight onto form fields.',
            durationSeconds: 860,
            captions: true,
          },
          {
            title: 'Service layer boundaries',
            description: 'Why a service never touches req or res, and what that buys you.',
            durationSeconds: 1440,
          },
          {
            title: 'Repositories & transactions',
            description: 'Keeping multi-step writes atomic without leaking Prisma upwards.',
            durationSeconds: 1575,
          },
          {
            title: 'Pagination done right',
            description: 'Bounded page sizes, stable ordering and honest totals.',
            durationSeconds: 1230,
          },
        ],
      },
      {
        title: 'Module 3 · Auth & testing',
        lessons: [
          {
            title: 'Sessions & secure cookies',
            description: 'httpOnly, SameSite, rotation, and why localStorage is not a vault.',
            durationSeconds: 1690,
          },
          {
            title: 'Role-based authorization',
            description: 'Enforcing roles on the server, and object-level checks that stop IDOR.',
            durationSeconds: 1365,
          },
          {
            title: 'Integration tests with Supertest',
            description: 'Testing against a real database instead of a mocked one.',
            durationSeconds: 1820,
          },
          {
            title: 'Shipping: config & logging',
            description: 'Validated environment, structured logs, redaction by default.',
            durationSeconds: 1445,
          },
        ],
      },
    ],
  },
  {
    slug: 'designing-accessible-interfaces',
    title: 'Designing Accessible Interfaces',
    description:
      'Contrast, focus order, ARIA and testing with real screen readers. Build interfaces that work for everyone, verified rather than assumed.',
    category: 'Design',
    difficulty: 'BEGINNER',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/designing-accessible-interfaces.svg',
    modules: [
      {
        title: 'Module 1 · Perceivable',
        lessons: [
          {
            title: 'Contrast that actually passes',
            description: 'Measuring AA and AAA, and what to do when the brand colour fails.',
            durationSeconds: 640,
            isPreview: true,
          },
          {
            title: 'Type, spacing and zoom',
            description: 'Reflow at 200% without losing content or function.',
            durationSeconds: 700,
          },
          {
            title: 'Never colour alone',
            description: 'Pairing status colour with an icon and a word.',
            durationSeconds: 560,
          },
        ],
      },
      {
        title: 'Module 2 · Operable',
        lessons: [
          {
            title: 'Focus order and visible focus',
            description: 'Keyboard paths through dialogs, menus and forms.',
            durationSeconds: 880,
          },
          {
            title: 'ARIA: the parts you need',
            description: 'Live regions, labels and the first rule of ARIA.',
            durationSeconds: 940,
          },
          {
            title: 'Testing with a screen reader',
            description: 'NVDA and VoiceOver basics for developers.',
            durationSeconds: 1080,
          },
        ],
      },
    ],
  },
  {
    slug: 'postgresql-from-schema-to-scale',
    title: 'PostgreSQL from Schema to Scale',
    description:
      "Constraints, indexes and migrations you won't regret later. Model data so the database enforces your rules instead of hoping the application does.",
    category: 'Data',
    difficulty: 'INTERMEDIATE',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/postgresql-from-schema-to-scale.svg',
    modules: [
      {
        title: 'Module 1 · Modelling',
        lessons: [
          {
            title: 'Keys, types and constraints',
            description: 'Let the schema reject impossible rows.',
            durationSeconds: 900,
            isPreview: true,
          },
          {
            title: 'Normalisation, and when to stop',
            description: 'Denormalise deliberately, with a service that keeps it consistent.',
            durationSeconds: 1020,
          },
          {
            title: 'Composite indexes',
            description: 'Column order, selectivity and reading an EXPLAIN plan.',
            durationSeconds: 1180,
          },
        ],
      },
      {
        title: 'Module 2 · Operating',
        lessons: [
          {
            title: 'Migrations without downtime',
            description: 'Expand, migrate, contract.',
            durationSeconds: 1240,
          },
          {
            title: 'Transactions and isolation',
            description: 'What actually happens under concurrent writes.',
            durationSeconds: 1340,
          },
          {
            title: 'Aggregates that stay fast',
            description: 'GROUP BY, FILTER and why counting in the app layer hurts.',
            durationSeconds: 1120,
          },
        ],
      },
    ],
  },
  {
    slug: 'react-state-patterns',
    title: 'React State Patterns',
    description:
      'Server state, local state and when each one belongs where. Stop reaching for a global store to solve a caching problem.',
    category: 'Engineering',
    difficulty: 'INTERMEDIATE',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/react-state-patterns.svg',
    modules: [
      {
        title: 'Module 1 · Server state',
        lessons: [
          {
            title: 'Query keys and cache shape',
            description: 'A key factory beats inline arrays every time.',
            durationSeconds: 760,
            isPreview: true,
          },
          {
            title: 'Invalidation as a design decision',
            description: 'Mapping mutations to the queries they affect.',
            durationSeconds: 820,
          },
          {
            title: 'Optimistic updates and rollback',
            description: 'Instant feedback without lying to the user.',
            durationSeconds: 950,
          },
        ],
      },
      {
        title: 'Module 2 · Local state',
        lessons: [
          {
            title: 'Derived state is not state',
            description: 'Compute it, do not store it.',
            durationSeconds: 640,
          },
          {
            title: 'Context without re-render storms',
            description: 'What belongs in context: auth and theme, not data.',
            durationSeconds: 880,
          },
        ],
      },
    ],
  },
  {
    slug: 'nodejs-security-essentials',
    title: 'Node.js Security Essentials',
    description:
      'Sessions, CSRF, rate limiting and secrets handling. The attacks that actually hit web applications, and the defences that stop them.',
    category: 'Security',
    difficulty: 'ADVANCED',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/nodejs-security-essentials.svg',
    modules: [
      {
        title: 'Module 1 · Identity',
        lessons: [
          {
            title: 'Hashing passwords properly',
            description: 'Cost factors, pepper myths and timing attacks.',
            durationSeconds: 980,
            isPreview: true,
          },
          {
            title: 'Token rotation and theft detection',
            description: 'Refresh families, and what to do when one is replayed.',
            durationSeconds: 1260,
          },
          {
            title: 'CSRF in a cookie world',
            description: 'SameSite, double-submit, and why one is not enough.',
            durationSeconds: 1040,
          },
        ],
      },
      {
        title: 'Module 2 · Surface',
        lessons: [
          {
            title: 'Rate limiting and lockout',
            description: 'Protecting login without locking out real users.',
            durationSeconds: 760,
          },
          {
            title: 'Headers, CORS and CSP',
            description: 'What each header actually prevents.',
            durationSeconds: 900,
          },
          {
            title: 'Secrets and configuration',
            description: 'Validated env, no secrets in images, rotation.',
            durationSeconds: 820,
          },
        ],
      },
    ],
  },
  {
    slug: 'design-systems-in-practice',
    title: 'Design Systems in Practice',
    description:
      'Tokens, components and governance for growing teams. Build a system people use instead of one they work around.',
    category: 'Design',
    difficulty: 'INTERMEDIATE',
    status: 'PUBLISHED',
    thumbnailUrl: '/thumbnails/design-systems-in-practice.svg',
    modules: [
      {
        title: 'Module 1 · Tokens',
        lessons: [
          {
            title: 'Naming colour without naming colour',
            description: 'Semantic tokens survive a rebrand; "blue-500" does not.',
            durationSeconds: 700,
            isPreview: true,
          },
          {
            title: 'Type scale and rhythm',
            description: 'A scale you can hold in your head.',
            durationSeconds: 660,
          },
        ],
      },
      {
        title: 'Module 2 · Components',
        lessons: [
          {
            title: 'Variants over wrappers',
            description: 'Extending a primitive instead of hiding it.',
            durationSeconds: 840,
          },
          {
            title: 'Documenting the contract',
            description: 'Props, states and the cases people get wrong.',
            durationSeconds: 780,
          },
        ],
      },
    ],
  },
  {
    // The ARCHIVED fixture: off the catalog, still open to anyone enrolled.
    slug: 'product-thinking-for-engineers',
    title: 'Product Thinking for Engineers',
    description:
      'Framing problems, scoping MVPs and measuring outcomes. An older course, kept available to the people already taking it.',
    category: 'Product',
    difficulty: 'BEGINNER',
    status: 'ARCHIVED',
    thumbnailUrl: '/thumbnails/product-thinking-for-engineers.svg',
    modules: [
      {
        title: 'Module 1 · Framing',
        lessons: [
          {
            title: 'Problems before solutions',
            description: 'Writing the problem statement first.',
            durationSeconds: 620,
          },
          {
            title: 'Scoping an MVP honestly',
            description: 'Cutting scope without cutting the point.',
            durationSeconds: 700,
          },
        ],
      },
      {
        title: 'Module 2 · Measuring',
        lessons: [
          {
            title: 'Outcomes over output',
            description: 'Choosing one metric that would change your mind.',
            durationSeconds: 760,
          },
        ],
      },
    ],
  },
  {
    // The DRAFT fixture: invisible to learners (404, not 403), and it cannot
    // be published until every lesson has a video — the editor screen in the
    // design artifact shows exactly this state.
    slug: 'graphql-schema-design',
    title: 'GraphQL Schema Design',
    description:
      'Model types, connections and errors so your GraphQL API stays easy to evolve — and easy for frontend teams to consume.',
    category: 'Engineering',
    difficulty: 'INTERMEDIATE',
    status: 'DRAFT',
    thumbnailUrl: '/thumbnails/graphql-schema-design.svg',
    modules: [
      {
        title: 'Module 1 · Schema',
        lessons: [
          {
            title: 'Why schema-first',
            description: 'The schema is the contract; write it on purpose.',
            durationSeconds: 750,
          },
          {
            title: 'Types, inputs and enums',
            description: 'Modelling without leaking your database.',
            durationSeconds: 1270,
          },
          {
            title: 'Connections & pagination',
            description: 'Cursors, edges and why offset hurts.',
            durationSeconds: 1480,
          },
        ],
      },
      {
        title: 'Module 2 · Evolution',
        lessons: [
          {
            title: 'Error unions',
            description: 'Errors as part of the schema, not an afterthought.',
            durationSeconds: 980,
          },
          {
            title: 'Versioning without versions',
            description: 'Deprecate, measure, remove.',
            durationSeconds: 1040,
          },
        ],
      },
    ],
  },
];

async function seedUsers() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, SEED_BCRYPT_COST);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@cadence.dev' },
    update: {},
    create: {
      firstName: 'Tunde',
      lastName: 'Bakare',
      email: 'admin@cadence.dev',
      passwordHash,
      role: 'ADMIN',
    },
  });

  const learners = [];
  for (const learner of [
    { firstName: 'Ada', lastName: 'Okafor', email: 'ada@cadence.dev' },
    { firstName: 'Kwame', lastName: 'Mensah', email: 'kwame@cadence.dev' },
    { firstName: 'Lina', lastName: 'Haddad', email: 'lina@cadence.dev' },
  ]) {
    learners.push(
      await prisma.user.upsert({
        where: { email: learner.email },
        update: {},
        create: { ...learner, passwordHash, role: 'LEARNER' },
      }),
    );
  }

  return { admin, learners };
}

async function seedCourses(adminId: string) {
  const created: { id: string; slug: string; lessonIds: string[] }[] = [];

  for (const seed of COURSES) {
    const course = await prisma.course.upsert({
      where: { slug: seed.slug },
      update: {
        title: seed.title,
        description: seed.description,
        category: seed.category,
        difficulty: seed.difficulty,
        status: seed.status,
        thumbnailUrl: seed.thumbnailUrl,
      },
      create: {
        slug: seed.slug,
        title: seed.title,
        description: seed.description,
        category: seed.category,
        difficulty: seed.difficulty,
        status: seed.status,
        thumbnailUrl: seed.thumbnailUrl,
        createdById: adminId,
        publishedAt: seed.status === 'PUBLISHED' ? new Date() : null,
      },
    });

    const lessonIds: string[] = [];
    for (const [moduleIndex, moduleSeed] of seed.modules.entries()) {
      const order = moduleIndex + 1;
      const module = await prisma.module.upsert({
        where: { courseId_order: { courseId: course.id, order } },
        update: { title: moduleSeed.title },
        create: { courseId: course.id, title: moduleSeed.title, order },
      });

      for (const [lessonIndex, lessonSeed] of moduleSeed.lessons.entries()) {
        const lessonOrder = lessonIndex + 1;
        const lesson = await prisma.lesson.upsert({
          where: { moduleId_order: { moduleId: module.id, order: lessonOrder } },
          update: {
            title: lessonSeed.title,
            description: lessonSeed.description,
            durationSeconds: SAMPLE_VIDEO.durationSeconds,
            isPreview: lessonSeed.isPreview ?? false,
            videoUrl: SAMPLE_VIDEO.url,
            captionsUrl: lessonSeed.captions ? SAMPLE_VIDEO.captionsUrl : null,
            courseId: course.id,
          },
          create: {
            moduleId: module.id,
            courseId: course.id,
            title: lessonSeed.title,
            description: lessonSeed.description,
            durationSeconds: SAMPLE_VIDEO.durationSeconds,
            isPreview: lessonSeed.isPreview ?? false,
            videoUrl: SAMPLE_VIDEO.url,
            captionsUrl: lessonSeed.captions ? SAMPLE_VIDEO.captionsUrl : null,
            order: lessonOrder,
          },
        });
        lessonIds.push(lesson.id);
      }
    }

    created.push({ id: course.id, slug: seed.slug, lessonIds });
  }

  return created;
}

/**
 * Enrollments and progress, so both dashboards have real data on first load:
 *  - Ada: one course part-watched (7 of 12 complete, lesson 8 in progress),
 *    one barely started, and one finished
 *  - Kwame: one finished course
 *  - Lina: enrolled, nothing watched (the "Not started" state)
 */
async function seedProgress(
  learners: { id: string; email: string }[],
  courses: { id: string; slug: string; lessonIds: string[] }[],
) {
  const bySlug = new Map(courses.map((course) => [course.slug, course]));
  const [ada, kwame, lina] = learners;
  if (!ada || !kwame || !lina) throw new Error('Expected three seeded learners');

  const enroll = async (userId: string, courseId: string) =>
    prisma.enrollment.upsert({
      where: { userId_courseId: { userId, courseId } },
      update: {},
      create: { userId, courseId, status: 'ACTIVE' },
    });

  const setProgress = async (
    userId: string,
    lessonId: string,
    durationSeconds: number,
    options: { completed: boolean; position?: number },
  ) => {
    const position = options.completed
      ? durationSeconds
      : Math.min(options.position ?? 0, durationSeconds);
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: {
        lastPositionSeconds: position,
        maxWatchedSeconds: position,
        completionPercentage: options.completed
          ? 100
          : Math.round((position / durationSeconds) * 100),
        isCompleted: options.completed,
        completedAt: options.completed ? new Date() : null,
      },
      create: {
        userId,
        lessonId,
        lastPositionSeconds: position,
        maxWatchedSeconds: position,
        completionPercentage: options.completed
          ? 100
          : Math.round((position / durationSeconds) * 100),
        isCompleted: options.completed,
        completedAt: options.completed ? new Date() : null,
      },
    });
  };

  const durations = new Map(
    (
      await prisma.lesson.findMany({ select: { id: true, durationSeconds: true } })
    ).map((row) => [row.id, row.durationSeconds]),
  );

  // --- Ada: the "in progress" headline course -----------------------------
  const ts = bySlug.get('typescript-for-production-apis');
  if (ts) {
    const enrollment = await enroll(ada.id, ts.id);
    for (const [index, lessonId] of ts.lessonIds.entries()) {
      const duration = durations.get(lessonId) ?? 600;
      if (index < 7) {
        await setProgress(ada.id, lessonId, duration, { completed: true });
      } else if (index === 7) {
        // 08:42 of 14:20, exactly the position the design artifact shows.
        await setProgress(ada.id, lessonId, duration, { completed: false, position: 522 });
      }
    }
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { lastAccessedAt: new Date(), lastLessonId: ts.lessonIds[7] ?? null },
    });
  }

  // --- Ada: barely started -----------------------------------------------
  const pg = bySlug.get('postgresql-from-schema-to-scale');
  if (pg) {
    const enrollment = await enroll(ada.id, pg.id);
    const first = pg.lessonIds[0];
    if (first) {
      await setProgress(ada.id, first, durations.get(first) ?? 900, {
        completed: false,
        position: 135,
      });
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          lastAccessedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          lastLessonId: first,
        },
      });
    }
  }

  // --- Ada: a completed course (so "Completed" tabs are not empty) -------
  const a11y = bySlug.get('designing-accessible-interfaces');
  if (a11y) {
    const enrollment = await enroll(ada.id, a11y.id);
    for (const lessonId of a11y.lessonIds) {
      await setProgress(ada.id, lessonId, durations.get(lessonId) ?? 600, {
        completed: true,
      });
    }
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        lastAccessedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        lastLessonId: a11y.lessonIds.at(-1) ?? null,
      },
    });
  }

  // --- Kwame: finished a different course --------------------------------
  const react = bySlug.get('react-state-patterns');
  if (react) {
    const enrollment = await enroll(kwame.id, react.id);
    for (const lessonId of react.lessonIds) {
      await setProgress(kwame.id, lessonId, durations.get(lessonId) ?? 600, {
        completed: true,
      });
    }
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        lastAccessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        lastLessonId: react.lessonIds.at(-1) ?? null,
      },
    });
  }

  // --- Lina: enrolled, nothing watched -----------------------------------
  const security = bySlug.get('nodejs-security-essentials');
  if (security) await enroll(lina.id, security.id);

  // --- Kwame on the archived course: proves access survives archiving ----
  const archived = bySlug.get('product-thinking-for-engineers');
  if (archived) await enroll(kwame.id, archived.id);
}

async function main() {
  console.log('Seeding Cadence…');

  const { admin, learners } = await seedUsers();
  console.log(`  users: 1 admin + ${learners.length} learners`);

  const courses = await seedCourses(admin.id);
  const lessonCount = courses.reduce((total, course) => total + course.lessonIds.length, 0);
  console.log(`  courses: ${courses.length} (${lessonCount} lessons)`);

  await seedProgress(learners, courses);
  console.log('  enrollments and progress: done');

  console.log('\nSeed complete. Sign in with:');
  console.log(`  admin   admin@cadence.dev / ${SEED_PASSWORD}`);
  console.log(`  learner ada@cadence.dev   / ${SEED_PASSWORD}  (course in progress)`);
  console.log(`  learner kwame@cadence.dev / ${SEED_PASSWORD}  (course completed)`);
  console.log(`  learner lina@cadence.dev  / ${SEED_PASSWORD}  (nothing started)`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
