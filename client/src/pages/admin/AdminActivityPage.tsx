import { useState } from 'react';
import { Activity } from 'lucide-react';
import { ActivityRow } from '@/components/dashboard/ActivityRow';
import { EmptyState, ErrorState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlatformActivity } from '@/features/dashboard/dashboard.queries';

/**
 * The platform-wide activity feed, paginated.
 *
 * The feed is a projection over enrollments and lesson progress rather than a
 * separate event table — see the note in dashboard.repository.ts for why, and
 * ARCHITECTURE.md for what an audit log would change.
 */
export function AdminActivityPage() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError, refetch } = usePlatformActivity(page);

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        overline="Admin"
        title="Activity feed"
        description="Enrollments, lesson starts and completions across every learner."
      />

      {isError ? (
        <ErrorState title="Could not load activity" onRetry={() => void refetch()} />
      ) : isPending ? (
        <Card className="flex flex-col gap-3 p-5" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Once learners enrol and start watching, their activity appears here."
          icon={Activity}
        />
      ) : (
        <>
          <Card className="divide-y divide-border">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} showUser />
            ))}
          </Card>
          {meta && meta.totalPages > 1 ? (
            <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}
