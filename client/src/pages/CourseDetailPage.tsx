import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Clock, Layers, PlayCircle } from 'lucide-react';
import { formatDuration } from '@cadence/shared';
import {
  CourseStatusBadge,
  DifficultyBadge,
  EnrollmentStatusBadge,
} from '@/components/common/StatusBadge';
import { ErrorState, NotFoundState } from '@/components/common/States';
import { LessonList, LessonListSkeleton } from '@/components/lessons/LessonList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/auth.queries';
import { useCourse } from '@/features/courses/courses.queries';
import { useEnroll, useLeaveCourse } from '@/features/enrollment/enrollment.queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, pluralize } from '@/lib/utils';

/**
 * Course detail.
 *
 * The artifact's layout: a hero with the course meta and the primary action,
 * the curriculum grouped by module on the left, and a summary rail on the
 * right that stacks underneath on mobile.
 *
 * The primary action is chosen from the server's enrollment state — Enrol,
 * Continue (resuming at the saved lesson), or Review.
 */
export function CourseDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const { data: course, isPending, isError, error, refetch } = useCourse(slug);
  const enroll = useEnroll(slug);
  const leave = useLeaveCourse();

  if (isPending) return <CourseDetailSkeleton />;

  if (isError) {
    if (error instanceof ApiError && error.status === 404) return <NotFoundState />;
    return <ErrorState title="Could not load this course" onRetry={() => void refetch()} />;
  }

  const enrollment = course.enrollment;
  const allLessons = course.modules.flatMap((module) => module.lessons);
  const firstLessonId = allLessons[0]?.id;
  // Resume at the saved lesson, else the first lesson that is not finished.
  const resumeLessonId =
    enrollment?.lastLessonId ??
    allLessons.find((lesson) => lesson.status !== 'COMPLETED')?.id ??
    firstLessonId;

  const canOpenLessons = Boolean(enrollment?.isEnrolled) || user?.role === 'ADMIN';

  return (
    <div className="flex flex-col gap-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-small text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link to="/courses" className="hover:text-primary-hover">
              Catalog
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              to={`/courses?category=${encodeURIComponent(course.category)}`}
              className="hover:text-primary-hover"
            >
              {course.category}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            {course.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="flex flex-col gap-8">
          {/* Hero */}
          <header className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{course.category}</Badge>
              <DifficultyBadge difficulty={course.difficulty} />
              {user?.role === 'ADMIN' ? <CourseStatusBadge status={course.status} /> : null}
              {enrollment?.isEnrolled ? (
                <EnrollmentStatusBadge status={enrollment.status} />
              ) : null}
            </div>

            <h1 className="text-display-sm lg:text-display">{course.title}</h1>
            <p className="max-w-3xl text-body text-secondary-foreground">{course.description}</p>

            <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-small text-secondary-foreground">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Total duration</dt>
                <dd>{formatDuration(course.estimatedDuration)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Structure</dt>
                <dd>
                  {pluralize(course.modules.length, 'module')} ·{' '}
                  {pluralize(course.lessonCount, 'lesson')}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
                <dt className="sr-only">Level</dt>
                <dd>{course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}</dd>
              </div>
            </dl>
          </header>

          {/* Curriculum */}
          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-heading">Curriculum</h2>
            {course.modules.length === 0 ? (
              <Card className="p-6 text-small text-secondary-foreground">
                This course has no lessons yet.
              </Card>
            ) : (
              <Card className="p-5">
                <LessonList
                  modules={course.modules}
                  courseSlug={course.slug}
                  canOpen={canOpenLessons}
                  currentLessonId={enrollment?.lastLessonId ?? undefined}
                />
              </Card>
            )}
          </section>
        </div>

        {/* Summary rail */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <Card className="flex flex-col gap-4 p-5">
            {enrollment?.isEnrolled ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-small font-semibold">
                    {enrollment.completedLessons} of {course.lessonCount} complete
                  </p>
                  <span className="font-mono text-title tabular">
                    {enrollment.progressPercentage}%
                  </span>
                </div>
                <Progress
                  value={enrollment.progressPercentage}
                  label={`${course.title} progress`}
                  tone={enrollment.status === 'COMPLETED' ? 'success' : 'primary'}
                />

                {resumeLessonId ? (
                  <Button asChild size="lg" className="w-full">
                    <Link to={`/courses/${course.slug}/lessons/${resumeLessonId}`}>
                      <PlayCircle aria-hidden="true" />
                      {enrollment.status === 'COMPLETED' ? 'Review course' : 'Continue'}
                    </Link>
                  </Button>
                ) : null}

                <p className="text-caption text-muted-foreground">
                  Enrolled {formatDate(enrollment.enrolledAt)}. Progress syncs across every device
                  you sign in on.
                </p>

                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive-tint"
                  loading={leave.isPending}
                  onClick={() => leave.mutate(course.id)}
                >
                  Leave course
                </Button>
              </>
            ) : (
              <>
                <p className="text-small text-secondary-foreground">
                  Enrol to track your progress. Every lesson remembers where you stopped.
                </p>
                <Button
                  size="lg"
                  className="w-full"
                  loading={enroll.isPending}
                  disabled={course.lessonCount === 0}
                  onClick={() =>
                    enroll.mutate(course.id, {
                      onSuccess: () => {
                        // Straight into the first lesson, which is what the
                        // learner wanted when they pressed Enrol.
                        if (firstLessonId) {
                          navigate(`/courses/${course.slug}/lessons/${firstLessonId}`);
                        }
                      },
                    })
                  }
                >
                  {course.lessonCount === 0 ? 'Not available yet' : 'Enrol — free'}
                </Button>
                {allLessons.some((lesson) => lesson.isPreview) ? (
                  <p className="text-caption text-muted-foreground">
                    One lesson is free to preview without enrolling.
                  </p>
                ) : null}
              </>
            )}
          </Card>

          {course.createdBy && user?.role === 'ADMIN' ? (
            <Card className="flex flex-col gap-1 p-5">
              <p className="text-overline uppercase text-muted-foreground">Author</p>
              <p className="text-small font-semibold">
                {course.createdBy.firstName} {course.createdBy.lastName}
              </p>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CourseDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-4 w-64" />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-6 w-48 rounded-pill" />
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-56" />
          <Card className="p-5">
            <LessonListSkeleton rows={6} />
          </Card>
        </div>
        <Card className="flex flex-col gap-4 p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-2 w-full rounded-pill" />
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-3 w-40" />
        </Card>
      </div>
    </div>
  );
}
