import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import { SEARCH_DEBOUNCE_MS, formatTimecode, initials } from '@cadence/shared';
import { EmptyState, ErrorState, NotFoundState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { LessonStatusBadge } from '@/components/common/StatusBadge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminUser, useAdminUsers, useSetUserActive } from '@/features/admin/admin.queries';
import { ApiError } from '@/lib/api-client';
import { relativeTime } from '@/lib/utils';

/**
 * Admin learner management: a searchable, paginated table, then a detail page
 * per learner with their enrollments and per-lesson progress.
 *
 * Every percentage shown here is the server's, so the admin view and the
 * learner's own dashboard cannot disagree.
 */
export function AdminLearnersPage() {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const setActive = useSetUserActive();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const query = useMemo(
    () => ({ page, ...(search ? { search } : {}) }),
    [page, search],
  );
  const { data, isPending, isError, refetch } = useAdminUsers(query);

  const learners = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        overline="Admin"
        title="Learners"
        description="Everyone on the platform, with their progress."
      />

      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor="learner-search">Search</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="learner-search"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search by name or email"
            className="pl-10"
          />
        </div>
      </div>

      {isError ? (
        <ErrorState title="Could not load learners" onRetry={() => void refetch()} />
      ) : isPending ? (
        <Card className="flex flex-col gap-3 p-5" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </Card>
      ) : learners.length === 0 ? (
        <EmptyState
          title={search ? 'No learners match' : 'No learners yet'}
          description={
            search
              ? 'Try a different name or email.'
              : 'Accounts will appear here as soon as someone registers.'
          }
          icon={Users}
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Learner</TableHead>
                  <TableHead>Courses</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learners.map((learner) => (
                  <TableRow key={learner.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initials(learner)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <Link
                            to={`/admin/learners/${learner.id}`}
                            className="block truncate font-semibold hover:text-primary-hover"
                          >
                            {learner.firstName} {learner.lastName}
                          </Link>
                          <p className="truncate text-caption text-muted-foreground">
                            {learner.email}
                          </p>
                        </div>
                        {learner.role === 'ADMIN' ? <Badge variant="info">Admin</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular">
                      {learner.enrolledCourses}
                      <span className="text-muted-foreground">
                        {' '}
                        ({learner.completedCourses} done)
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-32 flex-col gap-1">
                        <span className="font-mono text-caption tabular">
                          {learner.overallProgressPercentage}%
                        </span>
                        <Progress
                          value={learner.overallProgressPercentage}
                          label={`${learner.firstName} overall progress`}
                          size="sm"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {learner.lastActiveAt ? relativeTime(learner.lastActiveAt) : 'Never started'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={learner.isActive}
                        disabled={setActive.isPending}
                        onCheckedChange={(checked) =>
                          setActive.mutate({ id: learner.id, isActive: checked })
                        }
                        aria-label={`${learner.isActive ? 'Deactivate' : 'Activate'} ${learner.firstName} ${learner.lastName}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {meta && meta.totalPages > 1 ? (
            <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** The learner detail page. No design existed for it; it extends the system. */
export function AdminLearnerDetailPage() {
  const { id = '' } = useParams();
  const { data: learner, isPending, isError, error, refetch } = useAdminUser(id);
  const setActive = useSetUserActive();

  if (isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    if (error instanceof ApiError && error.status === 404) return <NotFoundState />;
    return <ErrorState title="Could not load this learner" onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-small text-muted-foreground">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/admin/learners" className="hover:text-primary-hover">
              Learners
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            {learner.firstName} {learner.lastName}
          </li>
        </ol>
      </nav>

      <PageHeader
        overline={learner.role}
        title={`${learner.firstName} ${learner.lastName}`}
        description={learner.email}
        actions={
          <label className="flex items-center gap-3 text-small">
            <Switch
              checked={learner.isActive}
              disabled={setActive.isPending}
              onCheckedChange={(checked) => setActive.mutate({ id: learner.id, isActive: checked })}
              aria-label={learner.isActive ? 'Deactivate this account' : 'Activate this account'}
            />
            {learner.isActive ? 'Active' : 'Deactivated'}
          </label>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-1 p-5">
          <p className="text-small font-semibold text-secondary-foreground">Enrolled courses</p>
          <p className="text-display-sm tabular">{learner.enrolledCourses}</p>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <p className="text-small font-semibold text-secondary-foreground">Lessons completed</p>
          <p className="text-display-sm tabular">{learner.completedLessons}</p>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <p className="text-small font-semibold text-secondary-foreground">Overall progress</p>
          <p className="text-display-sm tabular">{learner.overallProgressPercentage}%</p>
        </Card>
      </div>

      <section aria-labelledby="enrollments-heading" className="flex flex-col gap-4">
        <h2 id="enrollments-heading" className="font-heading text-heading-sm">
          Courses
        </h2>
        {learner.courses.length === 0 ? (
          <Card className="p-6 text-small text-secondary-foreground">
            This learner has not enrolled in anything yet.
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learner.courses.map((course) => (
                  <TableRow key={course.courseId}>
                    <TableCell>
                      <Link
                        to={`/courses/${course.courseSlug}`}
                        className="font-semibold hover:text-primary-hover"
                      >
                        {course.courseTitle}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={course.status === 'COMPLETED' ? 'success' : 'warning'}>
                        {course.status.charAt(0) + course.status.slice(1).toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-caption tabular">
                        {course.completedLessons}/{course.totalLessons} ·{' '}
                        {course.progressPercentage}%
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {course.lastAccessedAt ? relativeTime(course.lastAccessedAt) : 'Not started'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section aria-labelledby="lessons-heading" className="flex flex-col gap-4">
        <h2 id="lessons-heading" className="font-heading text-heading-sm">
          Recent lesson activity
        </h2>
        {learner.lessons.length === 0 ? (
          <Card className="p-6 text-small text-secondary-foreground">
            No lessons watched yet.
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lesson</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learner.lessons.map((lesson) => (
                  <TableRow key={lesson.lessonId}>
                    <TableCell className="font-semibold">{lesson.lessonTitle}</TableCell>
                    <TableCell className="text-muted-foreground">{lesson.courseTitle}</TableCell>
                    <TableCell className="font-mono tabular">
                      {formatTimecode(lesson.lastPositionSeconds)} /{' '}
                      {formatTimecode(lesson.durationSeconds)}
                    </TableCell>
                    <TableCell>
                      <LessonStatusBadge
                        status={
                          lesson.isCompleted
                            ? 'COMPLETED'
                            : lesson.completionPercentage > 0
                              ? 'IN_PROGRESS'
                              : 'NOT_STARTED'
                        }
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {relativeTime(lesson.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <div>
        <Button asChild variant="secondary">
          <Link to="/admin/learners">Back to learners</Link>
        </Button>
      </div>
    </div>
  );
}
