import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Eye,
  Flag,
  LayoutGrid,
  Pencil,
  Plus,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { InstructorActivityItem } from '@cadence/shared';
import { relativeTime, timezoneLabel } from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState } from '@/components/common/States';
import { StatCard } from '@/components/dashboard/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/auth.queries';
import {
  useInstructorActivity,
  useInstructorDashboard,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * The Instructor dashboard — desktop artifact page 5, mobile board 5.
 *
 * Six stat cards, a filterable activity feed, a course rail and the
 * "Finish your draft" nudge. Every number comes from the API; nothing on
 * this page is computed in the browser or hard-coded.
 */

const FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'ENROLLMENT' as const, label: 'Enrollments' },
  { value: 'LESSON_COMPLETED' as const, label: 'Lessons' },
  { value: 'MILESTONE' as const, label: 'Milestones' },
  { value: 'COURSE_EVENT' as const, label: 'Course events' },
];

/** Greets by time of day, as the artifact's "Good afternoon, Ada" does. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function ActivityIcon({ item }: { item: InstructorActivityItem }) {
  const map = {
    ENROLLMENT: { icon: Plus, className: 'bg-primary-tint text-primary-hover' },
    LESSON_COMPLETED: { icon: CheckCircle2, className: 'bg-success-tint text-success' },
    MILESTONE: { icon: Flag, className: 'bg-warning-tint text-warning' },
    COURSE_EVENT: { icon: Eye, className: 'bg-foreground text-background' },
  } as const;
  const { icon: Icon, className } = map[item.kind];
  return (
    <span
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', className)}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

/** The sentence for one activity row, built from the record's own fields. */
function activitySentence(item: InstructorActivityItem): React.ReactNode {
  switch (item.kind) {
    case 'ENROLLMENT':
      return (
        <>
          <strong className="font-semibold">{item.learner?.name}</strong> enrolled
        </>
      );
    case 'LESSON_COMPLETED':
      return (
        <>
          <strong className="font-semibold">{item.learner?.name}</strong> completed &ldquo;
          {item.lessonTitle}&rdquo;
        </>
      );
    case 'MILESTONE':
      return (
        <>
          <strong className="font-semibold">{item.learner?.name}</strong>{' '}
          {item.milestone === 100
            ? 'finished the course (100%)'
            : `reached ${item.milestone}% progress`}
        </>
      );
    case 'COURSE_EVENT':
    default:
      return (
        <>
          <strong className="font-semibold">You</strong>{' '}
          {item.courseEventType === 'PUBLISHED'
            ? 'published the course'
            : item.courseEventType === 'ARCHIVED'
              ? 'archived the course'
              : item.courseEventType === 'UNPUBLISHED'
                ? 'moved the course back to drafts'
                : item.courseEventType === 'LESSONS_ADDED'
                  ? 'added lessons to the course'
                  : 'created the course'}
        </>
      );
  }
}

function ActivityBadge({ item }: { item: InstructorActivityItem }) {
  if (item.kind === 'MILESTONE') {
    return <Badge variant={item.milestone === 100 ? 'success' : 'warning'}>{item.milestone}%</Badge>;
  }
  if (item.kind === 'ENROLLMENT') return <Badge variant="secondary">Enrollment</Badge>;
  if (item.kind === 'LESSON_COMPLETED') return <Badge variant="secondary">Lesson</Badge>;
  return (
    <Badge variant={item.courseEventType === 'PUBLISHED' ? 'info' : 'secondary'}>
      {item.courseEventType
        ? item.courseEventType.charAt(0) + item.courseEventType.slice(1).toLowerCase()
        : 'Course'}
    </Badge>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

export function InstructorDashboardPage() {
  const { data: user } = useMe();
  const { data, isPending, isError, refetch } = useInstructorDashboard();
  const [filter, setFilter] = useState<InstructorActivityItem['kind'] | undefined>();
  const activity = useInstructorActivity({ pageSize: 8, days: 30, ...(filter ? { kind: filter } : {}) });

  if (isPending) return <DashboardSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load your dashboard"
        description="The server took too long to respond. Your data is safe; try again in a moment."
        onRetry={() => void refetch()}
      />
    );
  }

  const { stats, courses, draftNudge } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline="Teaching workspace"
        title={`${greeting()}, ${user?.firstName ?? ''}`.trim()}
        description={
          stats.newEnrollments7d > 0
            ? `${stats.newEnrollments7d} new enrollment${stats.newEnrollments7d === 1 ? '' : 's'} across your courses this week.`
            : 'No new enrollments in the last seven days.'
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/instructor/courses">View my courses</Link>
            </Button>
            <Button asChild>
              <Link to="/instructor/courses/new">
                <Plus aria-hidden="true" />
                Create course
              </Link>
            </Button>
          </>
        }
      />

      {/* --- the six stat cards ------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          icon={LayoutGrid}
          label="Total courses"
          value={stats.totalCourses}
          hint={stats.archivedCourses > 0 ? `${stats.archivedCourses} archived` : undefined}
        />
        <StatCard
          icon={CheckCircle2}
          label="Published"
          value={stats.publishedCourses}
          hint="Visible in the catalog"
          tone="success"
        />
        <StatCard
          icon={Pencil}
          label="Drafts"
          value={stats.draftCourses}
          hint="Not visible to learners"
        />
        <StatCard
          icon={Users}
          label="Enrolled learners"
          value={stats.enrolledLearners}
          hint={
            stats.newEnrollments7d > 0
              ? `Distinct learners · ▲ ${stats.newEnrollments7d} this week`
              : 'Distinct learners'
          }
        />
        <StatCard
          icon={CheckCircle2}
          label="Lessons completed"
          value={stats.lessonsCompleted}
          hint="Across all your courses"
          tone="success"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg completion rate"
          value={`${stats.averageCompletionRate}%`}
          hint="Completed ÷ enrolled"
          tone="warning"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* --- recent activity -------------------------------------- */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Recent activity</CardTitle>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter activity">
              {FILTERS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={filter === option.value}
                  className={cn(
                    'min-h-9 rounded-pill px-3 text-caption font-semibold transition-colors',
                    filter === option.value
                      ? 'bg-foreground text-background'
                      : 'border border-border text-secondary-foreground hover:bg-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {activity.isPending ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : (activity.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="Nothing yet"
                description="Enrollments, completions and milestones on your courses will appear here."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {activity.data?.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 py-3">
                    <ActivityIcon item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-small text-foreground">
                        {activitySentence(item)}
                      </span>
                      <span className="block text-caption text-muted-foreground">
                        <Link
                          to={`/instructor/courses/${item.courseId}`}
                          className="hover:text-primary-hover hover:underline"
                        >
                          {item.courseTitle}
                        </Link>{' '}
                        · <span className="font-mono">{relativeTime(item.occurredAt)}</span>
                      </span>
                    </span>
                    <ActivityBadge item={item} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-caption text-muted-foreground">
              Showing the last 30 days · times in {timezoneLabel()}
            </p>
          </CardContent>
        </Card>

        {/* --- your courses + the draft nudge ------------------------ */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Your courses</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to="/instructor/courses">See all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {courses.length === 0 ? (
                <EmptyState
                  icon={LayoutGrid}
                  title="No courses yet"
                  description="Courses start as private drafts."
                  action={{ label: 'Create course', to: '/instructor/courses/new' }}
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {courses.slice(0, 5).map((course) => (
                    <li key={course.id}>
                      <Link
                        to={`/instructor/courses/${course.id}`}
                        className="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-muted"
                      >
                        <img
                          src={course.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="size-11 shrink-0 rounded-md object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-small font-semibold text-foreground">
                            {course.title}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                course.status === 'PUBLISHED'
                                  ? 'ink'
                                  : course.status === 'DRAFT'
                                    ? 'outline'
                                    : 'secondary'
                              }
                            >
                              {course.status === 'PUBLISHED'
                                ? 'Published'
                                : course.status === 'DRAFT'
                                  ? 'Draft'
                                  : 'Archived'}
                            </Badge>
                            <span className="text-caption text-muted-foreground">
                              {course.status === 'DRAFT'
                                ? `${course.lessonCount} lesson${course.lessonCount === 1 ? '' : 's'}`
                                : `${course.enrolledLearners} learner${course.enrolledLearners === 1 ? '' : 's'}`}
                            </span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {draftNudge ? (
            <Card className="border-transparent bg-foreground text-background">
              <CardHeader>
                <CardTitle className="text-background">Finish your draft</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-small text-background/80">
                  &ldquo;{draftNudge.title}&rdquo; passes {draftNudge.passing} of{' '}
                  {draftNudge.total} publishing checks. {draftNudge.summary}
                </p>
                <Progress
                  value={(draftNudge.passing / draftNudge.total) * 100}
                  tone="warning"
                  className="bg-background/20"
                  label={`${draftNudge.passing} of ${draftNudge.total} publishing checks passing`}
                />
                <Button asChild variant="secondary" className="self-start">
                  <Link to={`/instructor/courses/${draftNudge.courseId}`}>
                    Continue editing
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
