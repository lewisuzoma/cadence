import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, FileEdit, Globe, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import {
  COURSE_STATUSES,
  SEARCH_DEBOUNCE_MS,
  formatDuration,
  type CourseStatus,
  type CourseSummary,
} from '@cadence/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { CourseStatusBadge } from '@/components/common/StatusBadge';
import { CourseFormDialog } from '@/components/admin/CourseFormDialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAdminCourses,
  useDeleteCourse,
  useSetCourseStatus,
} from '@/features/courses/courses.queries';
import { ApiError } from '@/lib/api-client';
import { relativeTime } from '@/lib/utils';

/**
 * Admin course management.
 *
 * The table the artifact shows: status filter, search, per-row actions for
 * publish / unpublish / archive, a create-and-edit dialog, and a delete that
 * surfaces the API's 409 ("archive it instead") inside the confirmation rather
 * than as a disappearing toast.
 */
export function AdminCoursesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CourseStatus | 'ALL'>('ALL');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<CourseSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CourseSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const query = useMemo(
    () => ({
      page,
      ...(search ? { search } : {}),
      ...(status === 'ALL' ? {} : { status }),
    }),
    [page, search, status],
  );

  const { data, isPending, isError, refetch } = useAdminCourses(query);
  const setCourseStatus = useSetCourseStatus();
  const deleteCourse = useDeleteCourse();

  const courses = data?.items ?? [];
  const meta = data?.meta;

  const confirmDelete = () => {
    if (!deleting) return;
    setDeleteError(null);
    deleteCourse.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        // The 409 explains that learners are enrolled and tells the admin to
        // archive instead; it belongs in the dialog they are looking at.
        setDeleteError(
          error instanceof ApiError ? error.message : 'Could not delete this course.',
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        overline="Admin"
        title="Courses"
        description="Create, publish and archive courses."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New course
          </Button>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="admin-course-search">Search</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="admin-course-search"
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search by title or category"
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 md:w-52">
          <Label htmlFor="admin-course-status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as CourseStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger id="admin-course-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {COURSE_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        <ErrorState title="Could not load courses" onRetry={() => void refetch()} />
      ) : isPending ? (
        <Card className="p-5">
          <div className="flex flex-col gap-3" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : courses.length === 0 ? (
        <EmptyState
          title={search || status !== 'ALL' ? 'No courses match' : 'No courses yet'}
          description={
            search || status !== 'ALL'
              ? 'Try a different search or clear the status filter.'
              : 'Create your first course, add lessons to it, then publish it.'
          }
          icon={FileEdit}
          action={{ label: 'New course', onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lessons</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell>
                      <Link
                        to={`/admin/courses/${course.id}/lessons`}
                        className="font-semibold hover:text-primary-hover"
                      >
                        {course.title}
                      </Link>
                      <p className="text-caption text-muted-foreground">
                        {course.category} ·{' '}
                        {course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}
                      </p>
                    </TableCell>
                    <TableCell>
                      <CourseStatusBadge status={course.status} />
                    </TableCell>
                    <TableCell className="tabular">{course.lessonCount}</TableCell>
                    <TableCell className="tabular">
                      {formatDuration(course.estimatedDuration)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {relativeTime(course.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${course.title}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/admin/courses/${course.id}/lessons`}>
                              <FileEdit aria-hidden="true" />
                              Edit lessons
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditing(course)}>
                            <FileEdit aria-hidden="true" />
                            Edit details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {course.status !== 'PUBLISHED' ? (
                            <DropdownMenuItem
                              onClick={() =>
                                setCourseStatus.mutate({ id: course.id, status: 'PUBLISHED' })
                              }
                            >
                              <Globe aria-hidden="true" />
                              Publish
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                setCourseStatus.mutate({ id: course.id, status: 'DRAFT' })
                              }
                            >
                              <FileEdit aria-hidden="true" />
                              Unpublish
                            </DropdownMenuItem>
                          )}
                          {course.status !== 'ARCHIVED' ? (
                            <DropdownMenuItem
                              onClick={() =>
                                setCourseStatus.mutate({ id: course.id, status: 'ARCHIVED' })
                              }
                            >
                              <Archive aria-hidden="true" />
                              Archive
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(course);
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      {/* Create / edit */}
      <CourseFormDialog open={creating} onOpenChange={setCreating} />
      <CourseFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        course={editing ?? undefined}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        title={`Delete ${deleting?.title ?? 'this course'}?`}
        description={
          deleting
            ? `This removes ${deleting.lessonCount} lesson${deleting.lessonCount === 1 ? '' : 's'}. It cannot be undone.`
            : ''
        }
        confirmLabel="Delete course"
        onConfirm={confirmDelete}
        loading={deleteCourse.isPending}
        error={deleteError}
      />
    </div>
  );
}
