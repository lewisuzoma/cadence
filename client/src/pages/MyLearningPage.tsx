import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { EnrollmentStatus } from '@cadence/shared';
import { EmptyState, ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { CourseCard, CourseCardSkeletonGrid } from '@/components/courses/CourseCard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePrefetchCourse } from '@/features/courses/courses.queries';
import { useMyEnrollments } from '@/features/enrollment/enrollment.queries';

type Filter = 'ALL' | EnrollmentStatus;

/**
 * "My learning": the learner's enrolled courses, split into In progress and
 * Completed as the artifact shows. Filtering happens on the server (the
 * `status` query parameter), not by filtering a page in the browser, so the
 * pagination totals stay correct.
 */
export function MyLearningPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const prefetch = usePrefetchCourse();

  const { data, isPending, isError, refetch } = useMyEnrollments({
    page,
    ...(filter === 'ALL' ? {} : { status: filter }),
  });

  const enrollments = data?.items ?? [];
  const meta = data?.meta;

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="My learning"
        description={
          meta
            ? `${meta.total} course${meta.total === 1 ? '' : 's'} in your library`
            : 'Everything you are enrolled in'
        }
      />

      <Tabs value={filter} onValueChange={(value) => changeFilter(value as Filter)}>
        <TabsList>
          <TabsTrigger value="ALL">All</TabsTrigger>
          <TabsTrigger value="ACTIVE">In progress</TabsTrigger>
          <TabsTrigger value="COMPLETED">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {isError ? (
        <ErrorState title="Could not load your courses" onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          <CourseCardSkeletonGrid count={3} />
        </div>
      ) : enrollments.length === 0 ? (
        <EmptyState
          title={
            filter === 'COMPLETED'
              ? 'Nothing completed yet'
              : filter === 'ACTIVE'
                ? 'Nothing in progress yet'
                : 'You are not enrolled in anything yet'
          }
          description="Enrol in a course and your progress, positions and completions will show up here."
          icon={BookOpen}
          action={{ label: 'Browse courses', to: '/courses' }}
        />
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {enrollments.map((enrollment) => (
              <CourseCard
                key={enrollment.id}
                course={enrollment.course}
                onPrefetch={prefetch}
              />
            ))}
          </div>
          {meta && meta.totalPages > 1 ? (
            <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}
