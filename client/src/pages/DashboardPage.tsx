import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, Clock, TrendingUp } from 'lucide-react';
import { formatDuration } from '@cadence/shared';
import { EmptyState, ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { CourseCard, CourseCardSkeletonGrid } from '@/components/courses/CourseCard';
import { ActivityRow } from '@/components/dashboard/ActivityRow';
import {
  ContinueLearningCard,
  ContinueLearningSkeleton,
} from '@/components/dashboard/ContinueLearningCard';
import { StatCard, StatCardSkeletonRow } from '@/components/dashboard/StatCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/auth.queries';
import { useLearnerDashboard } from '@/features/dashboard/dashboard.queries';
import { usePrefetchCourse } from '@/features/courses/courses.queries';
import { pluralize } from '@/lib/utils';

/**
 * The learner home.
 *
 * Two presentations of the same data, both from `GET /dashboard/learner`:
 *
 *  - **Phone** (mobile artifact page 10, "App — home"): "Hi, Ada" with the
 *    streak line, the continue card, three compact stat tiles, then "Your
 *    courses" as thumbnail rows with inline progress.
 *  - **Desktop** (artifact page 7): the full page header, the wide continue
 *    banner, four stat cards and the course grid.
 *
 * Every number is a server aggregate; nothing here is computed in the browser
 * and nothing is a constant.
 */
export function DashboardPage() {
  const { data: user } = useMe();
  const { data, isPending, isError, refetch } = useLearnerDashboard();
  const prefetch = usePrefetchCourse();

  if (isError) {
    return <ErrorState title="Could not load your dashboard" onRetry={() => void refetch()} />;
  }
  if (isPending) return <DashboardSkeleton />;

  const { stats, continueLearning, courses, recentActivity } = data;

  /** "4-day streak · 3 lessons this week", when there is anything to say. */
  const summaryLine = [
    stats.streakDays > 0 ? `${stats.streakDays}-day streak` : null,
    stats.lessonsThisWeek > 0
      ? `${pluralize(stats.lessonsThisWeek, 'lesson')} this week`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {/* Phone greeting — the app screen's header block. */}
      <header className="flex flex-col gap-1 md:hidden">
        <h1 className="text-display-sm">Hi, {user?.firstName ?? 'there'}</h1>
        <p className="text-small text-secondary-foreground">
          {summaryLine || 'Pick a course to get started.'}
        </p>
      </header>

      {/* Desktop header */}
      <PageHeader
        className="max-md:hidden"
        overline="Your learning"
        title={`Welcome back, ${user?.firstName ?? ''}.`.trim()}
        description={
          stats.enrolledCourses === 0
            ? 'Pick a course and your progress will show up here.'
            : `${stats.completedLessons} of ${stats.totalLessons} lessons complete${summaryLine ? ` · ${summaryLine}` : ''}.`
        }
        actions={
          <Button asChild variant="secondary">
            <Link to="/courses">Browse courses</Link>
          </Button>
        }
      />

      {continueLearning ? <ContinueLearningCard item={continueLearning} /> : null}

      {/* Phone: three compact tiles in one row, as the artifact shows. */}
      <div className="grid grid-cols-3 gap-3 md:hidden">
        <CompactStat value={stats.enrolledCourses} label="Enrolled" />
        <CompactStat value={stats.completedLessons} label="Lessons done" />
        <CompactStat value={`${stats.overallProgressPercentage}%`} label="Overall" />
      </div>

      {/* Desktop: the fuller stat row. */}
      <section aria-labelledby="stats-heading" className="hidden flex-col gap-4 md:flex">
        <h2 id="stats-heading" className="font-heading text-heading-sm">
          Your progress
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Enrolled courses"
            value={stats.enrolledCourses}
            hint={`${stats.completedCourses} completed · ${stats.inProgressCourses} active`}
            icon={BookOpen}
          />
          <StatCard
            label="Lessons completed"
            value={stats.completedLessons}
            hint={`of ${stats.totalLessons} enrolled lessons`}
            icon={CheckCircle2}
          />
          <StatCard
            label="Overall progress"
            value={`${stats.overallProgressPercentage}%`}
            hint="across every enrolled course"
            icon={TrendingUp}
          />
          <StatCard
            label="Watch time"
            value={formatDuration(stats.watchedSeconds)}
            hint="all time"
            icon={Clock}
          />
        </div>
      </section>

      {/* Your courses */}
      <section aria-labelledby="courses-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="courses-heading" className="font-heading text-heading-sm">
            Your courses
          </h2>
          {courses.length > 0 ? (
            <Button asChild variant="ghost">
              <Link to="/my-learning">See all</Link>
            </Button>
          ) : null}
        </div>

        {courses.length === 0 ? (
          <EmptyState
            title="Nothing in progress yet"
            description="Enrol in a course and your progress and saved positions will show up here."
            icon={BookOpen}
            action={{ label: 'Browse courses', to: '/courses' }}
          />
        ) : (
          <>
            {/* Phone: compact rows. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {courses.slice(0, 6).map((enrollment) => (
                <li key={enrollment.id}>
                  <CourseProgressRow
                    slug={enrollment.course.slug}
                    title={enrollment.course.title}
                    thumbnailUrl={enrollment.course.thumbnailUrl}
                    percentage={enrollment.progressPercentage}
                    completed={enrollment.status === 'COMPLETED'}
                  />
                </li>
              ))}
            </ul>

            {/* Desktop: the card grid. */}
            <div className="hidden gap-6 sm:grid-cols-2 lg:grid-cols-3 md:grid">
              {courses.slice(0, 6).map((enrollment) => (
                <CourseCard key={enrollment.id} course={enrollment.course} onPrefetch={prefetch} />
              ))}
            </div>
          </>
        )}
      </section>

      {recentActivity.length > 0 ? (
        <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
          <h2 id="activity-heading" className="font-heading text-heading-sm">
            Recent activity
          </h2>
          <Card className="divide-y divide-border">
            {recentActivity.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

/** The phone tile: a big number over a small label. */
function CompactStat({ value, label }: { value: string | number; label: string }) {
  return (
    <Card className="flex flex-col gap-0.5 p-4">
      <span className="text-heading tabular">{value}</span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </Card>
  );
}

/**
 * The phone course row from the artifact: a square colour thumbnail, the
 * title, and a progress bar with its percentage on the right.
 */
export function CourseProgressRow({
  slug,
  title,
  thumbnailUrl,
  percentage,
  completed,
}: {
  slug: string;
  title: string;
  thumbnailUrl: string;
  percentage: number;
  completed: boolean;
}) {
  return (
    <Link
      to={`/courses/${slug}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
    >
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        className="size-14 shrink-0 rounded-md object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="truncate text-small font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-border">
            <span
              className={completed ? 'block h-full bg-success' : 'block h-full bg-primary'}
              style={{ width: `${percentage}%` }}
            />
          </span>
          <span className="shrink-0 font-mono text-caption tabular text-secondary-foreground">
            {percentage}%
          </span>
        </span>
      </span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-60" />
      </div>
      <ContinueLearningSkeleton />
      <div className="grid grid-cols-3 gap-3 md:hidden">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="hidden gap-4 sm:grid-cols-2 lg:grid-cols-4 md:grid">
        <StatCardSkeletonRow count={4} />
      </div>
      <div className="hidden gap-6 sm:grid-cols-2 lg:grid-cols-3 md:grid">
        <CourseCardSkeletonGrid count={3} />
      </div>
    </div>
  );
}
