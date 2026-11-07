import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Lock, Search, Users } from 'lucide-react';
import type { CourseLearnerRow } from '@cadence/shared';
import { formatDate, initials, relativeTime } from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState, ErrorState } from '@/components/common/States';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCourseAnalytics,
  useCourseLearners,
} from '@/features/instructor/instructor.queries';

/**
 * Enrolled learners — desktop artifact page 12, mobile board 7.
 *
 * A table on desktop and stacked cards on phones, over the same data.
 * Search, filters, sorting and paging are all server-side: a course with
 * a few thousand learners must not ship all of them to the browser so the
 * browser can show ten.
 *
 * The footer line about privacy is not decoration — it is the contract
 * this screen keeps, and saying it where an instructor can see it is part
 * of keeping it.
 */

const STATUS_LABELS = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  INACTIVE: 'Inactive',
} as const;

function StatusPill({ status }: { status: CourseLearnerRow['displayStatus'] }) {
  if (status === 'COMPLETED') return <Badge variant="success">Completed</Badge>;
  if (status === 'IN_PROGRESS') return <Badge variant="warning">In progress</Badge>;
  if (status === 'INACTIVE') return <Badge variant="secondary">Inactive</Badge>;
  return (
    <Badge variant="outline" className="border-dashed">
      Not started
    </Badge>
  );
}

export function CourseLearnersPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();

  const page = Number(params.get('page') ?? '1');
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const band = params.get('band') ?? '';
  const sort = params.get('sort') ?? 'activity';

  const analytics = useCourseAnalytics(id);
  const { data, isPending, isError, refetch } = useCourseLearners(id, {
    page,
    pageSize: 10,
    ...(search ? { search } : {}),
    ...(status ? { status: status as CourseLearnerRow['displayStatus'] } : {}),
    ...(band ? { band: band as never } : {}),
    sort: sort as never,
  });

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change restarts paging; page 7 of the old result set is
    // meaningless against the new one.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const rows = data?.items ?? [];
  const stats = analytics.data?.stats;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Analytics', to: '/instructor/analytics' },
          {
            label: analytics.data?.courseTitle ?? 'Course',
            to: `/instructor/courses/${id}/analytics`,
          },
          { label: 'Learners' },
        ]}
        title="Enrolled learners"
        description={
          stats
            ? `${stats.enrolled} learner${stats.enrolled === 1 ? '' : 's'} · ${stats.completed} completed · ${stats.active} active in the last ${analytics.data?.activeDays ?? 14} days`
            : undefined
        }
        actions={
          <Button asChild variant="outline">
            <Link to={`/instructor/courses/${id}/analytics`}>
              <ArrowLeft aria-hidden="true" />
              Course analytics
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setParam('search', event.target.value || undefined)}
                placeholder="Search by name or email"
                aria-label="Search by name or email"
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-small text-secondary-foreground">Status</span>
              <Select
                value={status || 'all'}
                onValueChange={(value) => setParam('status', value === 'all' ? undefined : value)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-small text-secondary-foreground">Progress</span>
              <Select
                value={band || 'any'}
                onValueChange={(value) => setParam('band', value === 'any' ? undefined : value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="0-25">0–25%</SelectItem>
                  <SelectItem value="25-50">25–50%</SelectItem>
                  <SelectItem value="50-75">50–75%</SelectItem>
                  <SelectItem value="75-99">75–99%</SelectItem>
                  <SelectItem value="100">100%</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-small text-secondary-foreground">Sort</span>
              <Select value={sort} onValueChange={(value) => setParam('sort', value)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">Recent activity</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="enrolled">Enrolled date</SelectItem>
                  <SelectItem value="progress">Progress</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              title="Couldn't load learners"
              onRetry={() => void refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={search || status || band ? 'No learners match' : 'No learners yet'}
              description={
                search || status || band
                  ? 'Try a different search or filter.'
                  : 'Learners appear here as soon as someone enrolls.'
              }
            />
          ) : (
            <>
              {/* --- desktop table ----------------------------------- */}
              <div className="overflow-x-auto max-md:hidden">
                <table className="w-full min-w-[46rem] text-small">
                  <caption className="sr-only">
                    Enrolled learners and their progress in this course
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-3 font-semibold">Learner</th>
                      <th scope="col" className="py-3 font-semibold">Enrolled</th>
                      <th scope="col" className="py-3 font-semibold">Progress</th>
                      <th scope="col" className="py-3 font-semibold">Lessons</th>
                      <th scope="col" className="py-3 font-semibold">Last activity</th>
                      <th scope="col" className="py-3 font-semibold">Status</th>
                      <th scope="col" className="py-3">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((learner) => (
                      <tr
                        key={learner.userId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-3">
                          <span className="flex items-center gap-3">
                            <Avatar className="size-9">
                              <AvatarFallback>{initials(learner)}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-foreground">
                                {learner.firstName} {learner.lastName}
                              </span>
                              <span className="block truncate text-caption text-muted-foreground">
                                {learner.email}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3 font-mono text-caption">
                          {formatDate(learner.enrolledAt)}
                        </td>
                        <td className="py-3">
                          <span className="flex items-center gap-2">
                            <Progress
                              value={learner.progressPercentage}
                              size="sm"
                              tone={learner.progressPercentage === 100 ? 'success' : 'primary'}
                              className="w-24"
                              label={`${learner.firstName} ${learner.lastName}'s progress`}
                            />
                            <span className="font-mono tabular-nums">
                              {learner.progressPercentage}%
                            </span>
                          </span>
                        </td>
                        <td className="py-3 font-mono tabular-nums">
                          {learner.completedLessons} / {learner.totalLessons}
                        </td>
                        <td className="py-3 text-caption text-secondary-foreground">
                          {learner.lastActivityAt
                            ? relativeTime(learner.lastActivityAt)
                            : '—'}
                        </td>
                        <td className="py-3">
                          <StatusPill status={learner.displayStatus} />
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            asChild
                            variant="outline"
                            size="icon"
                            aria-label={`Open ${learner.firstName} ${learner.lastName}'s progress`}
                          >
                            <Link
                              to={`/instructor/courses/${id}/learners/${learner.userId}`}
                            >
                              <ChevronRight className="size-4" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* --- phone cards ------------------------------------- */}
              <ul className="flex flex-col gap-3 md:hidden">
                {rows.map((learner) => (
                  <li key={learner.userId}>
                    <Link
                      to={`/instructor/courses/${id}/learners/${learner.userId}`}
                      className="flex flex-col gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary"
                    >
                      <span className="flex items-start gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback>{initials(learner)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-foreground">
                            {learner.firstName} {learner.lastName}
                          </span>
                          <span className="block truncate text-caption text-muted-foreground">
                            {learner.email}
                          </span>
                        </span>
                        <StatusPill status={learner.displayStatus} />
                      </span>
                      <Progress
                        value={learner.progressPercentage}
                        size="sm"
                        tone={learner.progressPercentage === 100 ? 'success' : 'primary'}
                        label={`${learner.firstName}'s progress`}
                      />
                      <span className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
                        <span>
                          Enrolled {formatDate(learner.enrolledAt)}
                          {learner.lastActivityAt
                            ? ` · Active ${relativeTime(learner.lastActivityAt)}`
                            : ''}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">
                          {learner.completedLessons}/{learner.totalLessons} ·{' '}
                          {learner.progressPercentage}%
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <p className="text-caption text-muted-foreground">
                  Showing {(page - 1) * 10 + 1}–
                  {Math.min(page * 10, data?.meta.total ?? 0)} of {data?.meta.total ?? 0}{' '}
                  learners
                </p>
                <Pagination
                  page={page}
                  totalPages={data?.meta.totalPages ?? 1}
                  onPageChange={(next) => setParam('page', String(next))}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <Lock className="size-3.5" aria-hidden="true" />
        You see each learner&rsquo;s name, email and progress in this course only.
      </p>
    </div>
  );
}
