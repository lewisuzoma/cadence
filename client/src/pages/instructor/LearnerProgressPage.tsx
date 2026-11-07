import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Circle, Lock, PlayCircle } from 'lucide-react';
import { formatDate, formatDuration, formatTimecode, initials, relativeTime } from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLearnerProgress } from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * One learner's progress in one course — desktop artifact page 13.
 *
 * Deliberately narrow. The server sends a learner's name, email and their
 * lessons *in this course*; there is nothing else here to render, which
 * is the point. The footnote says so, because an instructor should know
 * what they are and are not being shown.
 */

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'NOT_STARTED', label: 'Not started' },
] as const;

export function LearnerProgressPage() {
  const { id, userId } = useParams<{ id: string; userId: string }>();
  const { data, isPending, isError, refetch } = useLearnerProgress(id, userId);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');

  if (isPending) return <LoadingState label="Loading learner progress" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load this learner"
        description="They may not be enrolled in this course."
        onRetry={() => void refetch()}
      />
    );
  }

  const counts = {
    all: data.lessons.length,
    COMPLETED: data.lessons.filter((lesson) => lesson.status === 'COMPLETED').length,
    IN_PROGRESS: data.lessons.filter((lesson) => lesson.status === 'IN_PROGRESS').length,
    NOT_STARTED: data.lessons.filter((lesson) => lesson.status === 'NOT_STARTED').length,
  };

  const visible =
    filter === 'all'
      ? data.lessons
      : data.lessons.filter((lesson) => lesson.status === filter);

  const name = `${data.learner.firstName} ${data.learner.lastName}`;
  const aheadOfAverage = data.progressPercentage > data.course.averageProgress;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Analytics', to: '/instructor/analytics' },
          { label: 'Learners', to: `/instructor/courses/${id}/learners` },
          { label: name },
        ]}
        title={name}
      />

      {/* --- the summary card -------------------------------------- */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 pt-6">
          <div className="flex min-w-56 flex-1 items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="text-body">
                {initials(data.learner)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-heading-sm">{name}</p>
              <p className="truncate text-small text-muted-foreground">
                {data.learner.email}
              </p>
              <p className="mt-2">
                {data.enrollmentStatus === 'COMPLETED' ? (
                  <Badge variant="success">Completed</Badge>
                ) : data.progressPercentage > 0 ? (
                  <Badge variant="warning">In progress</Badge>
                ) : (
                  <Badge variant="outline" className="border-dashed">
                    Not started
                  </Badge>
                )}
              </p>
            </div>
          </div>

          <div
            className="relative grid size-24 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(hsl(var(--primary)) ${data.progressPercentage * 3.6}deg, hsl(var(--muted)) 0)`,
            }}
            role="img"
            aria-label={`${data.progressPercentage}% complete`}
          >
            <span className="grid size-18 place-items-center rounded-full bg-card">
              <span className="text-heading-sm tabular-nums">
                {data.progressPercentage}%
              </span>
            </span>
          </div>

          <dl className="grid min-w-56 flex-1 gap-x-4 gap-y-1.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <dt className="text-small text-muted-foreground">Lessons</dt>
            <dd className="font-mono text-small font-semibold">
              {data.completedLessons} / {data.course.lessonCount} completed
            </dd>
            <dt className="text-small text-muted-foreground">Enrolled</dt>
            <dd className="text-small font-semibold">{formatDate(data.enrolledAt)}</dd>
            <dt className="text-small text-muted-foreground">Last active</dt>
            <dd className="text-small font-semibold">
              {data.lastActivityAt ? relativeTime(data.lastActivityAt) : '—'}
            </dd>
            <dt className="text-small text-muted-foreground">Time watched</dt>
            <dd className="font-mono text-small font-semibold">
              {data.totalWatchedSeconds > 0
                ? formatDuration(data.totalWatchedSeconds)
                : '—'}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* --- lesson by lesson ----------------------------------- */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Lesson by lesson</CardTitle>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter lessons">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    'flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-caption font-semibold transition-colors',
                    filter === option.value
                      ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                      : 'text-secondary-foreground hover:bg-muted',
                  )}
                >
                  {option.label}
                  <span className="font-mono text-muted-foreground">
                    {counts[option.value]}
                  </span>
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent>
            <ol className="flex flex-col gap-1">
              {visible.map((lesson) => {
                const inProgress = lesson.status === 'IN_PROGRESS';
                return (
                  <li
                    key={lesson.lessonId}
                    className={cn(
                      'flex items-start gap-3 rounded-lg px-3 py-3',
                      inProgress && 'bg-warning-tint/50 ring-1 ring-warning/30',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                        lesson.status === 'COMPLETED'
                          ? 'bg-success-tint text-success'
                          : inProgress
                            ? 'bg-warning-tint text-warning'
                            : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden="true"
                    >
                      {lesson.status === 'COMPLETED' ? (
                        <Check className="size-4" />
                      ) : inProgress ? (
                        <PlayCircle className="size-4" />
                      ) : (
                        <Circle className="size-3" />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-small font-semibold text-foreground">
                        <span className="font-mono text-muted-foreground">
                          {String(lesson.order).padStart(2, '0')}
                        </span>{' '}
                        · {lesson.title}
                      </span>
                      <span className="block text-caption text-muted-foreground">
                        {lesson.status === 'COMPLETED' && lesson.completedAt
                          ? `Completed ${relativeTime(lesson.completedAt)}`
                          : inProgress
                            ? `Last position saved ${lesson.updatedAt ? relativeTime(lesson.updatedAt) : 'recently'}`
                            : formatTimecode(lesson.durationSeconds)}
                      </span>
                      {inProgress ? (
                        <span className="mt-2 flex items-center gap-2">
                          <Progress
                            value={
                              lesson.durationSeconds > 0
                                ? (lesson.lastPositionSeconds / lesson.durationSeconds) * 100
                                : 0
                            }
                            size="sm"
                            tone="warning"
                            className="max-w-48"
                            label={`Position in ${lesson.title}`}
                          />
                          <span className="font-mono text-caption tabular-nums text-secondary-foreground">
                            {formatTimecode(lesson.lastPositionSeconds)} /{' '}
                            {formatTimecode(lesson.durationSeconds)}
                          </span>
                        </span>
                      ) : null}
                    </span>

                    <Badge
                      variant={
                        lesson.status === 'COMPLETED'
                          ? 'success'
                          : inProgress
                            ? 'warning'
                            : 'outline'
                      }
                      className={lesson.status === 'NOT_STARTED' ? 'border-dashed' : undefined}
                    >
                      {lesson.status === 'COMPLETED'
                        ? 'Completed'
                        : inProgress
                          ? 'In progress'
                          : 'Not started'}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {/* --- side rail ------------------------------------------- */}
        <aside className="flex flex-col gap-4">
          {data.lastWatched ? (
            <Card>
              <CardHeader>
                <CardTitle>Last watched</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-small font-semibold text-foreground">
                  {data.lastWatched.title}
                </p>
                <p className="text-caption text-muted-foreground">
                  Stopped at{' '}
                  <span className="font-mono text-foreground">
                    {formatTimecode(data.lastWatched.positionSeconds)}
                  </span>{' '}
                  of {formatTimecode(data.lastWatched.durationSeconds)} ·{' '}
                  {relativeTime(data.lastWatched.at)}
                </p>
                <Progress
                  value={
                    data.lastWatched.durationSeconds > 0
                      ? (data.lastWatched.positionSeconds /
                          data.lastWatched.durationSeconds) *
                        100
                      : 0
                  }
                  tone="warning"
                  size="sm"
                  label={`Position in ${data.lastWatched.title}`}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Course</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-small font-semibold text-foreground">
                {data.course.title}
              </p>
              <p className="text-caption text-muted-foreground">
                {data.course.lessonCount} lesson
                {data.course.lessonCount === 1 ? '' : 's'}
                {data.course.estimatedDuration > 0
                  ? ` · ${formatDuration(data.course.estimatedDuration)}`
                  : ''}{' '}
                · {data.course.status.charAt(0)}
                {data.course.status.slice(1).toLowerCase()}
              </p>
              <p className="text-caption text-secondary-foreground">
                Course average progress:{' '}
                <strong className="font-semibold">{data.course.averageProgress}%</strong> ·{' '}
                {data.learner.firstName} is{' '}
                {aheadOfAverage
                  ? 'ahead of the average'
                  : data.progressPercentage === data.course.averageProgress
                    ? 'at the average'
                    : 'behind the average'}
                .
              </p>
            </CardContent>
          </Card>

          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Only {data.learner.firstName}&rsquo;s activity in your course is shown. Other
            courses and account details stay private.
          </p>

          <Button asChild variant="outline">
            <Link to={`/instructor/courses/${id}/learners`}>
              <ArrowLeft aria-hidden="true" />
              All learners
            </Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
