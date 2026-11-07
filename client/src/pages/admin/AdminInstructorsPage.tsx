import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GraduationCap, Search } from 'lucide-react';
import type { AdminInstructorListItem } from '@cadence/shared';
import { formatDate, initials } from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState, ErrorState } from '@/components/common/States';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAdminInstructors,
  useInstructorStatusChange,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * Instructor management — desktop artifact page 16, mobile board 8.
 *
 * The footnote matters as much as the table: suspending takes effect on
 * the instructor's next request, and their own learning is never
 * affected. Saying that where the button is removes the main reason an
 * admin would hesitate over it.
 */
export function AdminInstructorsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const search = params.get('search') ?? '';
  const page = Number(params.get('page') ?? '1');

  const { data, isPending, isError, refetch } = useAdminInstructors({
    page,
    pageSize: 20,
    ...(status ? { status: status as 'ACTIVE' | 'SUSPENDED' } : {}),
    ...(search ? { search } : {}),
  });
  const change = useInstructorStatusChange();

  const [target, setTarget] = useState<{
    instructor: AdminInstructorListItem;
    action: 'suspend' | 'reinstate';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const counts = data?.meta.counts ?? {};
  const rows = data?.items ?? [];

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const tabs = [
    { value: undefined, label: 'All', key: 'ALL' },
    { value: 'ACTIVE', label: 'Active', key: 'ACTIVE' },
    { value: 'SUSPENDED', label: 'Suspended', key: 'SUSPENDED' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instructor management"
        description={
          counts.ALL
            ? `${counts.ALL} instructor${counts.ALL === 1 ? '' : 's'} · ${counts.ACTIVE ?? 0} active · ${counts.SUSPENDED ?? 0} suspended`
            : undefined
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
                placeholder="Search name or email"
                aria-label="Search instructors"
                className="pl-9"
              />
            </div>
            <div className="flex gap-1" role="group" aria-label="Filter by status">
              {tabs.map((tab) => {
                const active = (status || undefined) === tab.value;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setParam('status', tab.value)}
                    className={cn(
                      'flex min-h-10 items-center gap-1.5 rounded-pill px-3.5 text-small font-semibold transition-colors max-sm:min-h-11',
                      active
                        ? 'bg-foreground text-background'
                        : 'border border-border text-secondary-foreground hover:bg-muted',
                    )}
                  >
                    {tab.label}
                    <span className="font-mono text-caption">{counts[tab.key] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState title="Couldn't load instructors" onRetry={() => void refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No instructors yet"
              description="Approve an application to create the first one."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] text-small">
                  <caption className="sr-only">Instructors and their status</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-3 font-semibold">Instructor</th>
                      <th scope="col" className="py-3 font-semibold">Courses</th>
                      <th scope="col" className="py-3 font-semibold">Learners</th>
                      <th scope="col" className="py-3 font-semibold">Instructor since</th>
                      <th scope="col" className="py-3 font-semibold">Status</th>
                      <th scope="col" className="py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((instructor) => (
                      <tr
                        key={instructor.userId}
                        className={cn(
                          'border-b border-border last:border-0',
                          instructor.status === 'SUSPENDED' && 'bg-muted/40',
                        )}
                      >
                        <td className="py-3">
                          <span className="flex items-center gap-3">
                            <Avatar className="size-9">
                              {instructor.photoUrl ? (
                                <AvatarImage src={instructor.photoUrl} alt="" />
                              ) : null}
                              <AvatarFallback>{initials(instructor)}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-foreground">
                                {instructor.displayName}
                              </span>
                              <span className="block truncate text-caption text-muted-foreground">
                                {instructor.email} · {instructor.title}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="block font-mono text-caption">
                            {instructor.publishedCourses} published
                          </span>
                          <span className="block font-mono text-caption text-muted-foreground">
                            {instructor.totalCourses} total
                          </span>
                        </td>
                        <td className="py-3 font-mono tabular-nums">
                          {instructor.learners.toLocaleString()}
                        </td>
                        <td className="py-3 font-mono text-caption">
                          {formatDate(instructor.instructorSince)}
                        </td>
                        <td className="py-3">
                          {instructor.status === 'ACTIVE' ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <>
                              <Badge variant="ink">Suspended</Badge>
                              {instructor.suspendedAt ? (
                                <span className="mt-1 block text-caption text-muted-foreground">
                                  since {formatDate(instructor.suspendedAt)}
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="py-3">
                          <span className="flex items-center justify-end gap-2">
                            {instructor.status === 'ACTIVE' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-destructive text-destructive hover:bg-destructive-tint"
                                onClick={() => {
                                  setTarget({ instructor, action: 'suspend' });
                                  setReason('');
                                  setError(null);
                                }}
                              >
                                Suspend…
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setTarget({ instructor, action: 'reinstate' });
                                  setReason('');
                                  setError(null);
                                }}
                              >
                                Reinstate…
                              </Button>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                totalPages={data?.meta.totalPages ?? 1}
                onPageChange={(next) => setParam('page', String(next))}
              />
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-caption text-muted-foreground">
        Suspending removes teaching permissions on the instructor&rsquo;s next request.
        Their own learning, enrollments and progress are never affected.
      </p>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.action === 'suspend' ? 'Suspend' : 'Reinstate'}{' '}
              {target?.instructor.displayName}?
            </DialogTitle>
            <DialogDescription>
              {target?.action === 'suspend'
                ? "They lose teaching permissions on their next request and their courses are hidden from the catalog. Learners already enrolled keep access, and the instructor's own learning is unaffected."
                : 'Their Teaching workspace becomes available again and their published courses return to the catalog.'}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p role="alert" className="text-small text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="status-reason" className="text-small font-semibold">
              Reason {target?.action === 'suspend' ? '*' : '(optional)'}
            </label>
            <Textarea
              id="status-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
            />
            {target?.action === 'suspend' ? (
              <p className="text-caption text-muted-foreground">
                A reason is required. The instructor will see it.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              className={
                target?.action === 'suspend'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
              disabled={
                change.isPending ||
                (target?.action === 'suspend' && reason.trim().length < 10)
              }
              onClick={() => {
                if (!target) return;
                setError(null);
                change.mutate(
                  target.action === 'suspend'
                    ? {
                        action: 'suspend',
                        userId: target.instructor.userId,
                        reason: reason.trim(),
                      }
                    : {
                        action: 'reinstate',
                        userId: target.instructor.userId,
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      },
                  {
                    onSuccess: () => setTarget(null),
                    onError: (mutationError) =>
                      setError(
                        mutationError instanceof Error
                          ? mutationError.message
                          : 'The change failed.',
                      ),
                  },
                );
              }}
            >
              {change.isPending
                ? 'Working…'
                : target?.action === 'suspend'
                  ? 'Suspend instructor'
                  : 'Reinstate instructor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
