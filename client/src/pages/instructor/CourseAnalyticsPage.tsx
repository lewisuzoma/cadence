import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Table2,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { CourseAnalytics } from '@cadence/shared';
import { formatDate, formatDateTime, timezoneLabel } from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState } from '@/components/common/States';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCourseAnalytics,
  useInstructorCourses,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * Course analytics — desktop artifact page 11, mobile board 7.
 *
 * Four charts, all from server aggregates and none of them decorative.
 * Each has:
 *   - an empty state, because a draft course genuinely has no data;
 *   - a "View as table" toggle, which is the accessible alternative and
 *     also the thing an instructor reaches for when they want the number
 *     rather than the shape.
 *
 * The bars are plain CSS rather than a charting library. For four charts
 * of this shape a div with a width is less code, renders instantly, scales
 * to any container, and — unlike an SVG chart — the numbers are real text
 * that a screen reader and the browser's find-in-page can both see.
 */

/** A chart card with its table alternative. */
function ChartCard({
  title,
  description,
  footnote,
  isEmpty,
  emptyMessage,
  children,
  table,
}: {
  title: string;
  description?: string;
  footnote?: React.ReactNode;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-caption text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {!isEmpty ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAsTable((previous) => !previous)}
            aria-pressed={asTable}
          >
            <Table2 aria-hidden="true" />
            {asTable ? 'View as chart' : 'View as table'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="py-8 text-center text-small text-muted-foreground">{emptyMessage}</p>
        ) : asTable ? (
          table
        ) : (
          children
        )}
        {footnote && !isEmpty ? (
          <div className="mt-4 text-caption text-muted-foreground">{footnote}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EnrollmentsChart({ data }: { data: CourseAnalytics['enrollmentsOverTime'] }) {
  const peak = Math.max(...data.map((point) => point.count), 1);
  return (
    <div className="flex h-56 items-end gap-2" role="img" aria-label="Enrollments per week">
      {data.map((point) => (
        <div key={point.weekStart} className="flex flex-1 flex-col items-center gap-2">
          <span className="font-mono text-caption tabular-nums text-foreground">
            {point.count}
          </span>
          <div
            className="w-full rounded-t-md bg-primary transition-all"
            style={{ height: `${Math.max(4, (point.count / peak) * 100)}%` }}
          />
          <span className="font-mono text-caption text-muted-foreground">
            {new Date(point.weekStart).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

function DistributionChart({
  data,
}: {
  data: CourseAnalytics['progressDistribution'];
}) {
  const peak = Math.max(...data.map((band) => band.count), 1);
  const labels: Record<string, string> = {
    '0-25': '0–25%',
    '25-50': '25–50%',
    '50-75': '50–75%',
    '75-99': '75–99%',
    '100': '100%',
  };

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((band) => (
        <li key={band.band} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5rem] items-center gap-3">
          <span className="font-mono text-caption text-secondary-foreground">
            {labels[band.band]}
          </span>
          <span className="h-5 overflow-hidden rounded-pill bg-muted">
            <span
              className={cn(
                'block h-full rounded-pill transition-all',
                band.band === '100' ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${Math.max(band.count === 0 ? 0 : 3, (band.count / peak) * 100)}%` }}
            />
          </span>
          <span className="text-right font-mono text-caption tabular-nums text-foreground">
            {band.count} · {band.percentage}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function LessonCompletionChart({
  data,
}: {
  data: CourseAnalytics['lessonCompletion'];
}) {
  // The steepest fall between consecutive lessons is where learners stop,
  // which is the one thing this chart exists to surface.
  let steepest = { index: -1, drop: 0 };
  for (let index = 1; index < data.length; index++) {
    const drop = data[index - 1]!.percentage - data[index]!.percentage;
    if (drop > steepest.drop) steepest = { index, drop };
  }

  return (
    <>
      <div
        className="flex h-56 items-end gap-1.5"
        role="img"
        aria-label="Completion rate per lesson"
      >
        {data.map((lesson, index) => (
          <div key={lesson.lessonId} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="font-mono text-caption tabular-nums text-muted-foreground">
              {lesson.percentage}
            </span>
            <div
              className={cn(
                'w-full rounded-t-md transition-all',
                index === steepest.index ? 'bg-warning' : 'bg-primary/60',
              )}
              style={{ height: `${Math.max(2, lesson.percentage)}%` }}
            />
            <span className="font-mono text-caption text-muted-foreground">
              {String(lesson.order).padStart(2, '0')}
            </span>
          </div>
        ))}
      </div>
      {steepest.index > 0 ? (
        <p className="mt-4 rounded-lg bg-warning-tint px-3 py-2 text-small text-secondary-foreground">
          <strong className="font-semibold">
            Lesson {String(data[steepest.index]!.order).padStart(2, '0')} ·{' '}
            {data[steepest.index]!.title}
          </strong>{' '}
          loses {steepest.drop} points after the lesson before it, the steepest drop in the
          course.
        </p>
      ) : null}
    </>
  );
}

function ActiveDonut({ stats, activeDays }: { stats: CourseAnalytics['stats']; activeDays: number }) {
  const total = stats.enrolled || 1;
  const percentage = Math.round((stats.active / total) * 100);

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div
        className="relative grid size-32 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(hsl(var(--primary)) ${percentage * 3.6}deg, hsl(var(--muted)) 0)`,
        }}
        role="img"
        aria-label={`${percentage}% of learners active in the last ${activeDays} days`}
      >
        <span className="grid size-24 place-items-center rounded-full bg-card text-center">
          <span>
            <span className="block text-heading-sm tabular-nums">{percentage}%</span>
            <span className="block text-caption text-muted-foreground">active</span>
          </span>
        </span>
      </div>
      <ul className="flex flex-col gap-2 text-small">
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-primary" aria-hidden="true" />
          Active
          <span className="ml-auto pl-6 font-mono tabular-nums font-semibold">
            {stats.active}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-muted" aria-hidden="true" />
          Inactive
          <span className="ml-auto pl-6 font-mono tabular-nums font-semibold">
            {stats.inactive}
          </span>
        </li>
      </ul>
    </div>
  );
}

export function CourseAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const selected = id ?? params.get('course') ?? undefined;

  // The picker is only needed on the standalone /analytics route, where no
  // course is in the path yet.
  const courses = useInstructorCourses({ pageSize: 50 });
  const { data, isPending, isError, refetch } = useCourseAnalytics(selected);

  if (!selected) {
    const list = courses.data?.items ?? [];
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Learners & analytics" description="Choose a course to see how it is doing." />
        {courses.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No courses yet"
            description="Analytics appear once you have a course with learners on it."
            action={{ label: 'Create course', to: '/instructor/courses/new' }}
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((course) => (
              <li key={course.id}>
                <Link
                  to={`/instructor/courses/${course.id}/analytics`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary"
                >
                  <img
                    src={course.thumbnailUrl}
                    alt=""
                    className="size-12 rounded-md object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{course.title}</span>
                    <span className="block text-caption text-muted-foreground">
                      {course.enrolledLearners} learner
                      {course.enrolledLearners === 1 ? '' : 's'}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load course analytics"
        description="The server took too long to respond. Your data is safe; try again in a moment."
        onRetry={() => void refetch()}
      />
    );
  }

  const noLearners = data.stats.enrolled === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Course analytics"
        actions={
          <Button asChild variant="outline">
            <Link to={`/instructor/courses/${selected}/learners`}>
              Enrolled learners
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-small text-secondary-foreground">Course</span>
        <Select
          value={selected}
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('course', value);
            setParams(next);
            window.location.assign(`/instructor/courses/${value}/analytics`);
          }}
        >
          <SelectTrigger className="w-full sm:w-96">
            <SelectValue>{data.courseTitle}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(courses.data?.items ?? []).map((course) => (
              <SelectItem key={course.id} value={course.id}>
                {course.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {noLearners ? (
        <EmptyState
          icon={BarChart3}
          title="No learners yet"
          description={
            data.courseStatus === 'DRAFT'
              ? 'This course is a draft. Charts appear after the first enrollment.'
              : 'Charts appear after the first enrollment.'
          }
          {...(data.courseStatus === 'DRAFT'
            ? {
                action: {
                  label: 'Finish & publish',
                  to: `/instructor/courses/${selected}`,
                },
              }
            : {})}
        />
      ) : null}

      {/* --- the six stat cards ------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Users}
          label="Enrolled"
          value={data.stats.enrolled}
          hint={
            data.stats.firstEnrollmentAt
              ? `Since ${formatDate(data.stats.firstEnrollmentAt)}`
              : 'No enrollments yet'
          }
        />
        <StatCard
          icon={TrendingUp}
          label="Active learners"
          value={data.stats.active}
          hint={`${data.stats.enrolled === 0 ? 0 : Math.round((data.stats.active / data.stats.enrolled) * 100)}% · last ${data.activeDays} days`}
          tone="info"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={data.stats.completed}
          hint={`Finished all ${data.lessonCount} lesson${data.lessonCount === 1 ? '' : 's'}`}
          tone="success"
        />
        <StatCard
          label="Completion rate"
          value={`${data.stats.completionRate}%`}
          hint={`${data.stats.completed} ÷ ${data.stats.enrolled} enrolled`}
        />
        <StatCard
          label="Avg progress"
          value={`${data.stats.averageProgress}%`}
          hint="Mean course progress"
        />
        <StatCard
          label="Lessons completed"
          value={data.stats.lessonsCompleted}
          hint="Total lesson completions"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Enrollments over time"
          description="New enrollments per week · weeks start Monday, UTC"
          isEmpty={data.enrollmentsOverTime.length === 0}
          emptyMessage="No enrollments yet."
          table={
            <table className="w-full text-small">
              <caption className="sr-only">New enrollments per week</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 font-semibold">Week beginning</th>
                  <th scope="col" className="py-2 text-right font-semibold">Enrollments</th>
                </tr>
              </thead>
              <tbody>
                {data.enrollmentsOverTime.map((point) => (
                  <tr key={point.weekStart} className="border-b border-border last:border-0">
                    <td className="py-2">{formatDate(point.weekStart)}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{point.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <EnrollmentsChart data={data.enrollmentsOverTime} />
        </ChartCard>

        <ChartCard
          title="Learner progress distribution"
          description="Enrolled learners by overall course progress"
          isEmpty={noLearners}
          emptyMessage="No learners yet."
          footnote={<>Mean progress {data.stats.averageProgress}%</>}
          table={
            <table className="w-full text-small">
              <caption className="sr-only">Learners by progress band</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 font-semibold">Progress</th>
                  <th scope="col" className="py-2 text-right font-semibold">Learners</th>
                  <th scope="col" className="py-2 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.progressDistribution.map((band) => (
                  <tr key={band.band} className="border-b border-border last:border-0">
                    <td className="py-2">{band.band.replace('-', '–')}%</td>
                    <td className="py-2 text-right font-mono tabular-nums">{band.count}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {band.percentage}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <DistributionChart data={data.progressDistribution} />
        </ChartCard>
      </div>

      <ChartCard
        title="Completion rate per lesson"
        description="Share of enrolled learners who completed each lesson. The biggest drop shows where learners stop."
        isEmpty={data.lessonCompletion.length === 0 || noLearners}
        emptyMessage={
          data.lessonCompletion.length === 0
            ? 'This course has no lessons yet.'
            : 'No learners yet.'
        }
        table={
          <table className="w-full text-small">
            <caption className="sr-only">Completion rate per lesson</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 font-semibold">#</th>
                <th scope="col" className="py-2 font-semibold">Lesson</th>
                <th scope="col" className="py-2 text-right font-semibold">Completed</th>
                <th scope="col" className="py-2 text-right font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.lessonCompletion.map((lesson) => (
                <tr key={lesson.lessonId} className="border-b border-border last:border-0">
                  <td className="py-2 font-mono">{String(lesson.order).padStart(2, '0')}</td>
                  <td className="py-2">{lesson.title}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {lesson.completed}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {lesson.percentage}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <LessonCompletionChart data={data.lessonCompletion} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Active vs. inactive learners"
          description={`Active = any progress or enrollment activity in the last ${data.activeDays} days`}
          isEmpty={noLearners}
          emptyMessage="No learners yet."
          table={
            <table className="w-full text-small">
              <caption className="sr-only">Active and inactive learners</caption>
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-2">Active</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {data.stats.active}
                  </td>
                </tr>
                <tr>
                  <td className="py-2">Inactive</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {data.stats.inactive}
                  </td>
                </tr>
              </tbody>
            </table>
          }
          footnote={
            <Link
              to={`/instructor/courses/${selected}/learners?status=INACTIVE`}
              className="font-semibold text-primary-hover hover:underline"
            >
              See inactive learners →
            </Link>
          }
        >
          <ActiveDonut stats={data.stats} activeDays={data.activeDays} />
        </ChartCard>

        {/* The artifact's "How these numbers are calculated" panel: the
            metric definitions, stated where they are read. */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>How these numbers are calculated</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-small font-semibold">Enrolled</dt>
              <dd className="text-small text-secondary-foreground">
                Enrollments not cancelled. You and admins are excluded.
              </dd>
              <dt className="text-small font-semibold">Active</dt>
              <dd className="text-small text-secondary-foreground">
                Progress or enrollment activity in the last {data.activeDays} days.
              </dd>
              <dt className="text-small font-semibold">Completion rate</dt>
              <dd className="text-small text-secondary-foreground">
                Completed learners ÷ enrolled learners.
              </dd>
              <dt className="text-small font-semibold">Avg progress</dt>
              <dd className="text-small text-secondary-foreground">
                Mean of each learner&rsquo;s course progress.
              </dd>
            </dl>
            <p className="mt-4 text-caption text-muted-foreground">
              Updated {formatDateTime(data.generatedAt)} {timezoneLabel()}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
