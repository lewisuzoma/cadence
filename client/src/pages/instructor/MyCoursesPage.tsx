import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Archive,
  BarChart3,
  Eye,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import type { CourseStatus, InstructorCourseCard } from '@cadence/shared';
import { formatDate } from '@cadence/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState } from '@/components/common/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCourseStatus,
  useDeleteCourse,
  useInstructorCourses,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * "My courses" — desktop artifact page 6, mobile board 5.
 *
 * Tabs with live counts, a search box, and a card per course carrying its
 * status, counts and a small activity summary. Every action in the menu
 * does something real, and each is offered only when the course's state
 * allows it — an archived course has nothing to unpublish.
 */

const TABS: { value: CourseStatus | undefined; label: string; countKey: string }[] = [
  { value: undefined, label: 'All', countKey: 'ALL' },
  { value: 'PUBLISHED', label: 'Published', countKey: 'PUBLISHED' },
  { value: 'DRAFT', label: 'Drafts', countKey: 'DRAFT' },
  { value: 'ARCHIVED', label: 'Archived', countKey: 'ARCHIVED' },
];

function StatusBadge({ status }: { status: CourseStatus }) {
  if (status === 'PUBLISHED') {
    return <Badge variant="ink">Published</Badge>;
  }
  if (status === 'DRAFT') {
    return (
      <Badge variant="outline" className="border-dashed bg-card">
        <Pencil aria-hidden="true" />
        Draft
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Archive aria-hidden="true" />
      Archived
    </Badge>
  );
}

function CourseCard({
  course,
  onArchive,
  onDelete,
}: {
  course: InstructorCourseCard;
  onArchive: (course: InstructorCourseCard) => void;
  onDelete: (course: InstructorCourseCard) => void;
}) {
  const status = useCourseStatus(course.id);
  const needsWork = course.status === 'DRAFT';

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-video">
        <img
          src={course.thumbnailUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <StatusBadge status={course.status} />
          {/* The point of saying it here: an instructor should not have
              to open a course to find out they left changes unpublished. */}
          {course.hasUnpublishedChanges ? (
            <Badge variant="warning">Unpublished changes</Badge>
          ) : null}
        </span>
      </div>

      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {course.category}
        </p>
        <h3 className="text-heading-sm">
          <Link
            to={`/instructor/courses/${course.id}`}
            className="transition-colors hover:text-primary-hover"
          >
            {course.title}
          </Link>
        </h3>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span>
            {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'}
          </span>
          <span>
            {course.enrolledLearners} learner{course.enrolledLearners === 1 ? '' : 's'}
          </span>
          <span>Created {formatDate(course.createdAt)}</span>
          {course.liveVersion ? <span>Live: v{course.liveVersion}</span> : null}
        </p>

        {/* The artifact's activity strip: last-7-days enrollments and the
            average progress, with a dash where there is nothing to show
            rather than a misleading zero. */}
        <div className="mt-auto grid grid-cols-2 gap-3 rounded-lg bg-muted p-3">
          <div>
            <p className="text-caption text-muted-foreground">New enrollments · 7d</p>
            <p className="font-mono text-small font-semibold text-foreground">
              {course.newEnrollments7d > 0 ? `+${course.newEnrollments7d}` : course.enrolledLearners > 0 ? '0' : '—'}
            </p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">
              Avg progress{' '}
              <span className="font-semibold text-foreground">
                {course.averageProgress === null ? '—' : `${course.averageProgress}%`}
              </span>
            </p>
            <Progress
              value={course.averageProgress ?? 0}
              size="sm"
              className="mt-1.5"
              label={`Average progress on ${course.title}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="flex-1">
            <Link
              to={
                needsWork
                  ? `/instructor/courses/${course.id}`
                  : `/instructor/courses/${course.id}/lessons`
              }
            >
              {needsWork ? 'Continue editing' : 'Manage lessons'}
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={`More actions for ${course.title}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {course.status === 'PUBLISHED' ? (
                <DropdownMenuItem asChild>
                  <Link to={`/courses/${course.slug}`}>
                    <Eye aria-hidden="true" />
                    View in catalog
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link to={`/instructor/courses/${course.id}`}>
                  <Pencil aria-hidden="true" />
                  Edit details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/instructor/courses/${course.id}/lessons`}>
                  <LayoutGrid aria-hidden="true" />
                  Manage lessons
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/instructor/courses/${course.id}/preview`}>
                  <Eye aria-hidden="true" />
                  Preview as learner
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/instructor/courses/${course.id}/analytics`}>
                  <BarChart3 aria-hidden="true" />
                  Analytics
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Each transition appears only where it is legal. */}
              {course.status === 'DRAFT' ? (
                <DropdownMenuItem onClick={() => status.mutate({ action: 'publish' })}>
                  <Upload aria-hidden="true" />
                  Publish…
                </DropdownMenuItem>
              ) : null}
              {course.status === 'PUBLISHED' ? (
                <DropdownMenuItem onClick={() => status.mutate({ action: 'unpublish' })}>
                  <Pencil aria-hidden="true" />
                  Unpublish (back to draft)
                </DropdownMenuItem>
              ) : null}
              {course.status !== 'ARCHIVED' ? (
                <DropdownMenuItem destructive onClick={() => onArchive(course)}>
                  <Archive aria-hidden="true" />
                  Archive…
                </DropdownMenuItem>
              ) : null}
              {course.enrolledLearners === 0 ? (
                <DropdownMenuItem destructive onClick={() => onDelete(course)}>
                  Delete…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export function MyCoursesPage() {
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') as CourseStatus | null;
  const search = params.get('search') ?? '';

  const [confirmArchive, setConfirmArchive] = useState<InstructorCourseCard | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<InstructorCourseCard | null>(null);

  const filters = {
    pageSize: 24,
    ...(statusParam ? { status: statusParam } : {}),
    ...(search ? { search } : {}),
  };
  const { data, isPending, isError, refetch } = useInstructorCourses(filters);

  const archive = useCourseStatus(confirmArchive?.id ?? '');
  const remove = useDeleteCourse();

  const counts = data?.meta.counts ?? {};
  const courses = data?.items ?? [];

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My courses"
        description={
          counts.ALL
            ? `${counts.PUBLISHED ?? 0} published · ${counts.DRAFT ?? 0} draft · ${counts.ARCHIVED ?? 0} archived`
            : undefined
        }
        actions={
          <Button asChild>
            <Link to="/instructor/courses/new">
              <Plus aria-hidden="true" />
              Create course
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {TABS.map((tab) => {
            const active = (statusParam ?? undefined) === tab.value;
            return (
              <button
                key={tab.label}
                type="button"
                aria-pressed={active}
                onClick={() => setParam('status', tab.value)}
                className={cn(
                  'flex min-h-10 items-center gap-1.5 rounded-pill px-3.5 text-small font-semibold transition-colors max-sm:min-h-11',
                  active
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                    : 'text-secondary-foreground hover:bg-muted',
                )}
              >
                {tab.label}
                <span className="font-mono text-caption text-muted-foreground">
                  {counts[tab.countKey] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setParam('search', event.target.value || undefined)}
            placeholder="Search your courses"
            aria-label="Search your courses"
            className="pl-9"
          />
        </div>
      </div>

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-96 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Couldn't load your courses"
          onRetry={() => void refetch()}
        />
      ) : courses.length === 0 ? (
        /* The artifact's new-instructor empty state (mobile board 5). */
        <EmptyState
          icon={Plus}
          title={search || statusParam ? 'No courses match' : 'Create your first course'}
          description={
            search || statusParam
              ? 'Try a different search or filter.'
              : 'Courses start as private drafts. Add lessons, preview as a learner, then publish when the checklist is green.'
          }
          {...(search || statusParam
            ? {}
            : { action: { label: 'Create course', to: '/instructor/courses/new' } })}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              onArchive={setConfirmArchive}
              onDelete={setConfirmDelete}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmArchive !== null}
        onOpenChange={(open) => !open && setConfirmArchive(null)}
        title={`Archive "${confirmArchive?.title ?? ''}"?`}
        description="It leaves the catalog and no one new can enroll. Learners already enrolled keep full access and their progress is untouched. You can publish it again later."
        confirmLabel="Archive course"
        destructive
        loading={archive.isPending}
        onConfirm={() => {
          archive.mutate({ action: 'archive' }, { onSuccess: () => setConfirmArchive(null) });
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        description="This cannot be undone. Only courses with no enrolled learners can be deleted; archive instead to keep a course's history."
        confirmLabel="Delete course"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          remove.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) });
        }}
      />
    </div>
  );
}
