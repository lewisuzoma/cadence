import { Link } from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  PlayCircle,
  TrendingUp,
} from 'lucide-react';
import { formatDuration, formatRemaining, formatTimecode } from '@cadence/shared';
import { EmptyState, ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { CourseCard, CourseCardSkeletonGrid } from '@/components/courses/CourseCard';
import { ActivityRow } from '@/components/dashboard/ActivityRow';
import { StatCard, StatCardSkeletonRow } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/auth.queries';
import { useLearnerDashboard } from '@/features/dashboard/dashboard.queries';
import { usePrefetchCourse } from '@/features/courses/courses.queries';

/**
 * The learner dashboard.
 *
 * Every number comes from `GET /dashboard/learner`, which computes it in SQL.
 * Nothing on this page is derived in the browser, and nothing is a constant.
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
  const greeting = user ? `Welcome back, ${user.firstName}.` : 'Welcome back.';

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        overline="Your learning"
        title={greeting}
        description={
          stats.enrolledCourses === 0
            ? 'Pick a course and your progress will show up here.'
            : `${stats.completedLessons} of ${stats.totalLessons} lessons complete across your courses.`
        }
        actions={
          <Button asChild variant="secondary">
            <Link to="/courses">Browse courses</Link>
          </Button>
        }
      />

      {/* Continue learning — the artifact's headline card. */}
      {continueLearning ? (
        <Card variant="interactive" className="overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[240px_1fr]">
            <img
              src={continueLearning.thumbnailUrl}
              alt=""
              className="h-40 w-full object-cover md:h-full"
              loading="lazy"
            />
            <div className="flex flex-col gap-3 p-6">
              <p className="text-overline uppercase text-muted-foreground">Continue learning</p>
              <h2 className="font-heading text-heading-sm">{continueLearning.lessonTitle}</h2>
              <p className="text-small text-secondary-foreground">
                {continueLearning.courseTitle} · {continueLearning.moduleTitle} ·{' '}
                {formatRemaining(
                  continueLearning.lastPositionSeconds,
                  continueLearning.durationSeconds,
                )}
              </p>
              <div className="flex max-w-md flex-col gap-1.5">
                <Progress
                  value={continueLearning.courseProgressPercentage}
                  label={`${continueLearning.courseTitle} progress`}
                  size="sm"
                />
                <span className="font-mono text-caption tabular text-muted-foreground">
                  {continueLearning.courseProgressPercentage}% of the course
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3">
                <Button asChild>
                  <Link
                    to={`/courses/${continueLearning.courseSlug}/lessons/${continueLearning.lessonId}`}
                  >
                    <PlayCircle aria-hidden="true" />
                    Resume at {formatTimecode(continueLearning.lastPositionSeconds)}
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link to={`/courses/${continueLearning.courseSlug}`}>Course overview</Link>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Stats */}
      <section aria-labelledby="stats-heading" className="flex flex-col gap-4">
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

      {/* My courses */}
      <section aria-labelledby="courses-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="courses-heading" className="font-heading text-heading-sm">
            My courses
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
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.slice(0, 6).map((enrollment) => (
              <CourseCard
                key={enrollment.id}
                course={enrollment.course}
                onPrefetch={prefetch}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
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

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeletonRow count={4} />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <CourseCardSkeletonGrid count={3} />
      </div>
    </div>
  );
}
