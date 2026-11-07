import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Lock,
  Pencil,
  Plus,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import type { InstructorApplicationStatus } from '@cadence/shared';
import { formatDate, formatDateTime, initials, relativeTime } from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  useAddApplicationNote,
  useAdminApplication,
  useAdminApplications,
  useDecideApplication,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * Instructor applications — desktop artifact pages 14 and 15.
 *
 * The queue and the review screen. Both live here because they share the
 * status vocabulary and the decision actions, and splitting them would
 * mean keeping two copies of each in step.
 */

const TABS: { value: InstructorApplicationStatus | undefined; label: string; key: string }[] = [
  { value: 'PENDING', label: 'Pending', key: 'PENDING' },
  { value: 'APPROVED', label: 'Approved', key: 'APPROVED' },
  { value: 'REJECTED', label: 'Rejected', key: 'REJECTED' },
  { value: 'WITHDRAWN', label: 'Withdrawn', key: 'WITHDRAWN' },
  { value: undefined, label: 'All', key: 'ALL' },
];

function StatusBadge({ status }: { status: InstructorApplicationStatus }) {
  if (status === 'PENDING') return <Badge variant="warning">Pending</Badge>;
  if (status === 'APPROVED') return <Badge variant="success">Approved</Badge>;
  if (status === 'REJECTED') return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="secondary">Withdrawn</Badge>;
}

// ===========================================================================
// The queue
// ===========================================================================

export function AdminApplicationsPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as InstructorApplicationStatus | null) ?? 'PENDING';
  const search = params.get('search') ?? '';
  const page = Number(params.get('page') ?? '1');

  const { data, isPending, isError, refetch } = useAdminApplications({
    page,
    pageSize: 20,
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    sort: 'oldest',
  });

  const counts = data?.meta.counts ?? {};
  const rows = data?.items ?? [];

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instructor applications"
        description="Review learners who want to teach. Oldest pending first."
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div
            className="flex flex-wrap gap-1 border-b border-border pb-3"
            role="group"
            aria-label="Filter by status"
          >
            {TABS.map((tab) => {
              const active = (params.get('status') ?? 'PENDING') === (tab.value ?? 'ALL');
              return (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParam('status', tab.value ?? 'ALL')}
                  className={cn(
                    'flex min-h-10 items-center gap-1.5 rounded-pill px-3.5 text-small font-semibold transition-colors max-sm:min-h-11',
                    active
                      ? 'bg-primary-tint text-primary-hover'
                      : 'text-secondary-foreground hover:bg-muted',
                  )}
                >
                  {tab.label}
                  <span className="font-mono text-caption">{counts[tab.key] ?? 0}</span>
                </button>
              );
            })}
          </div>

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
                placeholder="Search name, email, title or expertise"
                aria-label="Search applications"
                className="pl-9"
              />
            </div>
            <p className="text-small text-muted-foreground">
              {data?.meta.total ?? 0} application{(data?.meta.total ?? 0) === 1 ? '' : 's'}
            </p>
          </div>

          {isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState title="Couldn't load applications" onRetry={() => void refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing to review"
              description={
                search
                  ? 'No applications match that search.'
                  : 'New applications appear here as soon as they are submitted.'
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-small">
                  <caption className="sr-only">Instructor applications</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-3 font-semibold">Applicant</th>
                      <th scope="col" className="py-3 font-semibold">Title</th>
                      <th scope="col" className="py-3 font-semibold">Expertise</th>
                      <th scope="col" className="py-3 font-semibold">Applied</th>
                      <th scope="col" className="py-3 font-semibold">Status</th>
                      <th scope="col" className="py-3">
                        <span className="sr-only">Review</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((application) => (
                      <tr key={application.id} className="border-b border-border last:border-0">
                        <td className="py-3">
                          <span className="flex items-center gap-3">
                            <Avatar className="size-9">
                              <AvatarFallback>{initials(application.applicant)}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-foreground">
                                {application.applicant.firstName}{' '}
                                {application.applicant.lastName}
                              </span>
                              <span className="block truncate text-caption text-muted-foreground">
                                {application.applicant.email}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3">{application.professionalTitle}</td>
                        <td className="py-3">
                          <span className="flex flex-wrap gap-1">
                            {application.expertise.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="info">
                                {tag}
                              </Badge>
                            ))}
                            {application.expertise.length > 2 ? (
                              <Badge variant="secondary">
                                +{application.expertise.length - 2}
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="block font-mono text-caption">
                            {formatDate(application.submittedAt)}
                          </span>
                          <span className="block text-caption text-muted-foreground">
                            {relativeTime(application.submittedAt)}
                          </span>
                        </td>
                        <td className="py-3">
                          <StatusBadge status={application.status} />
                        </td>
                        <td className="py-3 text-right">
                          <Button asChild size="sm">
                            <Link to={`/admin/instructor-applications/${application.id}`}>
                              Review
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-caption text-muted-foreground">
                  Page {page} of {data?.meta.totalPages ?? 1} · 20 per page
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
    </div>
  );
}

// ===========================================================================
// The review screen
// ===========================================================================

export function AdminApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = useAdminApplication(id);
  const decide = useDecideApplication(id ?? '');
  const addNote = useAddApplicationNote(id ?? '');

  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  if (isPending) return <LoadingState label="Loading the application" />;
  if (isError || !data) {
    return <ErrorState title="Couldn't load this application" onRetry={() => void refetch()} />;
  }

  const name = `${data.applicant.firstName} ${data.applicant.lastName}`;
  const notes = data.history.filter((event) => event.action === 'NOTE_ADDED');
  const decidable = data.status === 'PENDING';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Instructor applications', to: '/admin/instructor-applications' },
          { label: name },
        ]}
        title={name}
        actions={
          decidable ? (
            <>
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive-tint"
                onClick={() => setRejectOpen(true)}
              >
                <X aria-hidden="true" />
                Reject…
              </Button>
              <Button
                className="bg-success text-success-foreground hover:bg-success/90"
                onClick={() => setApproveOpen(true)}
              >
                <Check aria-hidden="true" />
                Approve…
              </Button>
            </>
          ) : (
            <Button asChild variant="outline">
              <Link to="/admin/instructor-applications">
                <ArrowLeft aria-hidden="true" />
                Back to the queue
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={data.status} />
        <p className="text-small text-secondary-foreground">
          {data.applicant.email} · {data.professionalTitle} · applied{' '}
          {formatDateTime(data.submittedAt)}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* --- the application ------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Application</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <section>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                Areas of expertise
              </h3>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {data.expertise.map((tag) => (
                  <Badge key={tag} variant="info">
                    {tag}
                  </Badge>
                ))}
              </p>
            </section>

            <section>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                Teaching experience
              </h3>
              <p className="mt-2 whitespace-pre-line text-small text-secondary-foreground">
                {data.experience}
              </p>
            </section>

            <section>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                Short biography
              </h3>
              <p className="mt-2 whitespace-pre-line text-small text-secondary-foreground">
                {data.biography}
              </p>
            </section>

            <section>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                Why teach on Cadence?
              </h3>
              <p className="mt-2 whitespace-pre-line text-small text-secondary-foreground">
                {data.motivation}
              </p>
            </section>

            <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
              <section>
                <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                  Portfolio
                </h3>
                {data.portfolioUrl ? (
                  <a
                    href={data.portfolioUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2 inline-flex items-center gap-1.5 text-small font-semibold text-primary-hover hover:underline"
                  >
                    {data.portfolioUrl.replace(/^https:\/\//, '')}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : (
                  <p className="mt-2 text-small text-muted-foreground">None</p>
                )}
              </section>

              <section>
                <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                  Profile photo
                </h3>
                {data.profilePhotoUrl ? (
                  <img
                    src={data.profilePhotoUrl}
                    alt={`${name}'s profile photo`}
                    className="mt-2 size-20 rounded-lg object-cover"
                  />
                ) : (
                  <p className="mt-2 text-small text-muted-foreground">None</p>
                )}
              </section>
            </div>

            {data.decisionReason ? (
              <div className="rounded-lg bg-muted p-4">
                <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                  Decision reason
                </h3>
                <p className="mt-2 text-small text-secondary-foreground">
                  {data.decisionReason}
                </p>
                {data.decidedBy ? (
                  <p className="mt-2 text-caption text-muted-foreground">
                    {data.decidedBy.name} · {formatDateTime(data.decidedAt)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* --- the side rail ---------------------------------------- */}
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Applicant account</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <dt className="text-small text-muted-foreground">Member since</dt>
                <dd className="text-small font-semibold">
                  {formatDate(data.applicant.memberSince)}
                </dd>
                <dt className="text-small text-muted-foreground">Current role</dt>
                <dd className="text-small font-semibold">
                  {data.applicant.role.charAt(0)}
                  {data.applicant.role.slice(1).toLowerCase()}
                </dd>
                <dt className="text-small text-muted-foreground">Learning</dt>
                <dd className="text-small font-semibold">
                  {data.applicant.enrolledCourses} course
                  {data.applicant.enrolledCourses === 1 ? '' : 's'} enrolled ·{' '}
                  {data.applicant.completedCourses} completed
                </dd>
                <dt className="text-small text-muted-foreground">Past applications</dt>
                <dd className="text-small font-semibold">
                  {data.applicant.pastApplications === 0
                    ? 'None'
                    : data.applicant.pastApplications}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decision history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {data.history.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      className={cn(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
                        event.action === 'APPROVED'
                          ? 'bg-success-tint text-success'
                          : event.action === 'REJECTED'
                            ? 'bg-destructive-tint text-destructive'
                            : event.action === 'NOTE_ADDED'
                              ? 'bg-warning-tint text-warning'
                              : 'bg-primary-tint text-primary-hover',
                      )}
                      aria-hidden="true"
                    >
                      {event.action === 'NOTE_ADDED' ? (
                        <StickyNote className="size-3" />
                      ) : event.action === 'UPDATED' ? (
                        <Pencil className="size-3" />
                      ) : (
                        <Plus className="size-3" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-small">
                        <strong className="font-semibold">
                          {event.action === 'NOTE_ADDED'
                            ? 'Internal note added'
                            : event.action === 'UPDATED'
                              ? 'Edited'
                              : event.action.charAt(0) + event.action.slice(1).toLowerCase()}
                        </strong>{' '}
                        by {event.actor.name}
                      </span>
                      <span className="block font-mono text-caption text-muted-foreground">
                        {formatDateTime(event.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Internal notes</CardTitle>
              <Badge variant="ink">
                <Lock aria-hidden="true" />
                Admins only
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {notes.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-warning/30 bg-warning-tint/40 p-3"
                >
                  <p className="text-small text-secondary-foreground">{event.internalNote}</p>
                  <p className="mt-1.5 text-caption text-muted-foreground">
                    {event.actor.name} · {formatDateTime(event.createdAt)}
                  </p>
                </div>
              ))}

              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Add a note for other admins…"
                aria-label="Add an internal note"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-caption text-muted-foreground">
                  Never shown to the applicant.
                </p>
                <Button
                  size="sm"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() => addNote.mutate(note.trim(), { onSuccess: () => setNote('') })}
                >
                  Add note
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* --- approve ---------------------------------------------- */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {name}?</DialogTitle>
            <DialogDescription>
              Their role becomes Instructor, an instructor profile is created from this
              application, and they are notified. Their learning is unaffected.
            </DialogDescription>
          </DialogHeader>
          {decisionError ? (
            <p role="alert" className="text-small text-destructive">
              {decisionError}
            </p>
          ) : null}
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Optional note for the applicant…"
            aria-label="Optional approval note"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-success text-success-foreground hover:bg-success/90"
              disabled={decide.isPending}
              onClick={() => {
                setDecisionError(null);
                decide.mutate(
                  { action: 'approve', ...(reason.trim() ? { reason: reason.trim() } : {}) },
                  {
                    onSuccess: () => {
                      setApproveOpen(false);
                      setReason('');
                    },
                    onError: (error) =>
                      setDecisionError(
                        error instanceof Error ? error.message : 'The approval failed.',
                      ),
                  },
                );
              }}
            >
              {decide.isPending ? 'Approving…' : 'Approve application'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- reject ------------------------------------------------ */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
            <DialogDescription>
              {name} stays a learner and can reapply after the cooldown.
            </DialogDescription>
          </DialogHeader>
          {decisionError ? (
            <p role="alert" className="text-small text-destructive">
              {decisionError}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reject-reason" className="text-small font-semibold">
              Reason *
            </label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              required
            />
            <p className="text-caption text-muted-foreground">
              A reason is required. The applicant will see it.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={reason.trim().length < 10 || decide.isPending}
              onClick={() => {
                setDecisionError(null);
                decide.mutate(
                  { action: 'reject', reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setRejectOpen(false);
                      setReason('');
                    },
                    onError: (error) =>
                      setDecisionError(
                        error instanceof Error ? error.message : 'The rejection failed.',
                      ),
                  },
                );
              }}
            >
              {decide.isPending ? 'Rejecting…' : 'Reject application'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
