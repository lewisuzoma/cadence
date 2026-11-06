import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  COURSE_SORTS,
  DIFFICULTIES,
  SEARCH_DEBOUNCE_MS,

  type CourseSort,
  type Difficulty,
} from '@cadence/shared';
import { EmptyState, ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { CourseCard, CourseCardSkeletonGrid } from '@/components/courses/CourseCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ContinueLearningCard } from '@/components/dashboard/ContinueLearningCard';
import { useCourseCategories, useCourses, usePrefetchCourse } from '@/features/courses/courses.queries';
import { useLearnerDashboard } from '@/features/dashboard/dashboard.queries';
import { cn, pluralize } from '@/lib/utils';

/**
 * The catalog.
 *
 * Every filter lives in the URL, so a filtered view is shareable, survives a
 * refresh and works with the back button. The search box keeps its own local
 * value and writes to the URL on a debounce, so typing stays responsive
 * without a request per keystroke.
 */
export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page') ?? 1);
  const category = searchParams.get('category') ?? '';
  const difficulty = (searchParams.get('difficulty') ?? '') as Difficulty | '';
  const sort = (searchParams.get('sort') ?? 'newest') as CourseSort;
  const search = searchParams.get('search') ?? '';

  const [searchDraft, setSearchDraft] = useState(search);

  // Keep the box in step when the URL changes from elsewhere (back button).
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    if (searchDraft === search) return;
    const timer = setTimeout(() => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        if (searchDraft) next.set('search', searchDraft);
        else next.delete('search');
        // A new search starts at page 1; staying on page 4 would look empty.
        next.delete('page');
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, searchDraft, setSearchParams]);

  const setParam = (key: string, value: string | null) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  };

  const query = useMemo(
    () => ({
      page,
      ...(search ? { search } : {}),
      ...(category ? { category } : {}),
      ...(difficulty ? { difficulty } : {}),
      sort,
    }),
    [category, difficulty, page, search, sort],
  );

  const { data, isPending, isError, refetch, isPlaceholderData } = useCourses(query);
  const { data: categories = [] } = useCourseCategories();
  const prefetch = usePrefetchCourse();
  // The artifact puts the continue banner at the top of the catalog too.
  const { data: dashboard } = useLearnerDashboard();

  const courses = data?.items ?? [];
  const meta = data?.meta;
  const hasFilters = Boolean(search || category || difficulty);

  return (
    <div className="flex flex-col gap-8">
      {dashboard?.continueLearning ? (
        <ContinueLearningCard item={dashboard.continueLearning} />
      ) : null}

      <PageHeader
        title="Course catalog"
        description={
          meta
            ? `${pluralize(meta.total, 'course')} available`
            : 'Browse everything on the platform'
        }
      />

      {/* Search + sort */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="catalog-search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="catalog-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search title, topic or category"
                className="pl-10"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 md:w-56">
            <Label htmlFor="catalog-sort">Sort</Label>
            <Select value={sort} onValueChange={(value) => setParam('sort', value)}>
              <SelectTrigger id="catalog-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COURSE_SORTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === 'newest'
                      ? 'Newest first'
                      : option === 'oldest'
                        ? 'Oldest first'
                        : option === 'title'
                          ? 'Title A–Z'
                          : 'Longest first'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 md:w-48">
            <Label htmlFor="catalog-difficulty">Level</Label>
            <Select
              value={difficulty || 'all'}
              onValueChange={(value) => setParam('difficulty', value === 'all' ? null : value)}
            >
              <SelectTrigger id="catalog-difficulty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                {DIFFICULTIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.charAt(0) + option.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Category chips, as the artifact shows: All, then each category. */}
        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
            <CategoryChip
              label="All"
              active={!category}
              onClick={() => setParam('category', null)}
            />
            {categories.map((item) => (
              <CategoryChip
                key={item}
                label={item}
                active={category === item}
                onClick={() => setParam('category', item)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Results */}
      {isError ? (
        <ErrorState title="Could not load courses" onRetry={() => void refetch()} />
      ) : isPending ? (
        <div
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-busy="true"
          aria-live="polite"
        >
          <CourseCardSkeletonGrid count={8} />
        </div>
      ) : courses.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No courses match those filters' : 'No courses yet'}
          description={
            hasFilters
              ? 'Try a different search term, or clear the filters to see everything.'
              : 'Courses will appear here as soon as an administrator publishes one.'
          }
          action={
            hasFilters
              ? { label: 'Clear filters', onClick: () => setSearchParams(new URLSearchParams()) }
              : undefined
          }
        />
      ) : (
        <>
          <div
            className={cn(
              'grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
              // Dim while the next page loads, rather than unmounting the grid.
              isPlaceholderData && 'opacity-60 transition-opacity',
            )}
          >
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} onPrefetch={prefetch} />
            ))}
          </div>

          {meta && meta.totalPages > 1 ? (
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              onPageChange={(next) => setParam('page', String(next))}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      // Ink when selected: the artifact reserves cobalt for the one
      // primary action on a screen, so selection reads as state instead.
      variant={active ? 'ink' : 'secondary'}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-pill"
    >
      {label}
    </Button>
  );
}
