import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  PauseCircle,
  Pencil,
  XCircle,
} from 'lucide-react';
import type { MyApplication } from '@cadence/shared';
import { formatDate, formatDateTime } from '@cadence/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  useMyApplication,
  useWithdrawApplication,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * "Instructor application" — desktop artifact page 3, mobile board 3.
 *
 * One page, four states. The artifact draws them side by side to show the
 * set; here exactly one renders, chosen by the *derived* status the server
 * sends. Deriving it server-side is what keeps this component a switch
 * rather than a tangle of "has a profile but the application says…".
 */

function StatusHeader({
  icon: Icon,
  tone,
  title,
  meta,
  badge,
}: {
  icon: typeof Clock;
  tone: 'pending' | 'rejected' | 'approved' | 'suspended';
  title: string;
  meta: string;
  badge: React.ReactNode;
}) {
  const tones = {
    pending: 'bg-warning-tint text-warning',
    rejected: 'bg-destructive-tint text-destructive',
    approved: 'bg-success-tint text-success',
    suspended: 'bg-muted text-foreground',
  } as const;

  return (
    <div className="flex items-start gap-4">
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          tones[tone],
        )}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-h2">{title}</h2>
          {badge}
        </div>
        <p className="mt-1 text-small text-secondary-foreground">{meta}</p>
      </div>
    </div>
  );
}

/** The timeline of events the applicant is allowed to see. */
function History({ history }: { history: MyApplication['history'] }) {
  if (history.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2">
      {history.map((event) => (
        <li key={event.id} className="flex items-center gap-2 text-small">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              event.action === 'SUBMITTED' ? 'bg-border' : 'bg-warning',
            )}
            aria-hidden="true"
          />
          <span className="font-semibold text-foreground">
            {event.action === 'SUBMITTED'
              ? 'Submitted'
              : event.action === 'UPDATED'
                ? 'Edited'
                : event.action.charAt(0) + event.action.slice(1).toLowerCase()}
          </span>
          <span className="text-secondary-foreground">
            {event.actor.isSelf ? 'by you' : `by ${event.actor.name}`} ·{' '}
            {formatDateTime(event.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ApplicationStatusPage() {
  const { data, isPending, isError, refetch } = useMyApplication();
  const withdraw = useWithdrawApplication();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isPending) return <LoadingState label="Loading your application" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load your application"
        description="The server did not respond. Nothing about your application has changed; try again in a moment."
        onRetry={() => void refetch()}
      />
    );
  }

  const application = data.application;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Instructor application"
        description="Track your application to teach on Cadence."
      />

      <Card className="mt-6">
        <CardContent className="flex flex-col gap-6 pt-6">
          {/* ---------------------------------------------------------- */}
          {data.status === 'NOT_APPLIED' ? (
            <div className="flex flex-col items-start gap-4">
              <StatusHeader
                icon={Pencil}
                tone="pending"
                title="You haven't applied yet"
                meta="Tell us what you'd like to teach and an admin will review it."
                badge={<Badge variant="secondary">Not applied</Badge>}
              />
              <Button asChild>
                <Link to="/become-an-instructor">
                  Become an Instructor
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          ) : null}

          {/* --- 1 · PENDING ------------------------------------------- */}
          {data.status === 'PENDING' && application ? (
            <>
              <StatusHeader
                icon={Clock}
                tone="pending"
                title="Under review"
                meta={`Submitted ${formatDateTime(application.submittedAt)} · usually decided within 3 business days`}
                badge={<Badge variant="warning">Pending</Badge>}
              />

              <dl className="grid gap-3 rounded-lg bg-muted p-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <dt className="text-small text-muted-foreground">Title</dt>
                <dd className="text-small font-semibold text-foreground">
                  {application.professionalTitle}
                </dd>
                <dt className="text-small text-muted-foreground">Expertise</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {application.expertise.map((tag) => (
                    <Badge key={tag} variant="info">
                      {tag}
                    </Badge>
                  ))}
                </dd>
                <dt className="text-small text-muted-foreground">Last edited</dt>
                <dd className="text-small font-semibold text-foreground">
                  {formatDateTime(application.updatedAt)}
                </dd>
              </dl>

              <History history={data.history} />

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button asChild>
                  <Link to="/become-an-instructor/edit">
                    <Pencil aria-hidden="true" />
                    Edit application
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive-tint"
                  onClick={() => setConfirmOpen(true)}
                >
                  Withdraw…
                </Button>
              </div>
            </>
          ) : null}

          {/* --- 2 · REJECTED ------------------------------------------ */}
          {data.status === 'REJECTED' && application ? (
            <>
              <StatusHeader
                icon={XCircle}
                tone="rejected"
                title="Not approved this time"
                meta={`Decided ${formatDateTime(application.decidedAt)}`}
                badge={<Badge variant="destructive">Rejected</Badge>}
              />

              {application.decisionReason ? (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    Reason from the reviewer
                  </p>
                  <p className="mt-2 text-small text-secondary-foreground">
                    {application.decisionReason}
                  </p>
                </div>
              ) : null}

              {data.canReapplyAt && !data.canReapplyNow ? (
                <p className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-small">
                  <CalendarClock className="size-4 text-primary" aria-hidden="true" />
                  You can reapply on{' '}
                  <strong className="font-semibold">{formatDate(data.canReapplyAt)}</strong>.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button asChild disabled={!data.canReapplyNow}>
                  {data.canReapplyNow ? (
                    <Link to="/become-an-instructor">Reapply</Link>
                  ) : (
                    <span>Reapply</span>
                  )}
                </Button>
                {!data.canReapplyNow && data.canReapplyAt ? (
                  <span className="text-small text-muted-foreground">
                    Available from {formatDate(data.canReapplyAt)}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          {/* --- 3 · APPROVED ------------------------------------------ */}
          {data.status === 'APPROVED' ? (
            <>
              <StatusHeader
                icon={CheckCircle2}
                tone="approved"
                title="You're an instructor"
                meta={`Approved ${formatDateTime(data.instructorSince)} by the Cadence team`}
                badge={<Badge variant="success">Approved</Badge>}
              />

              <p className="text-small text-secondary-foreground">
                Your Teaching workspace is ready. Use the{' '}
                <strong className="font-semibold">Learning ⇄ Teaching</strong> switcher in the
                top bar to move between your courses as a learner and the courses you teach.
              </p>

              <ul className="flex flex-col gap-2 rounded-lg bg-muted p-4">
                <li className="flex items-center gap-2 text-small">
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  Instructor profile created from your application
                </li>
                <li className="flex items-center gap-2 text-small">
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  Your {data.enrolledCourseCount} enrolled course
                  {data.enrolledCourseCount === 1 ? '' : 's'} and progress are unchanged
                </li>
              </ul>

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button asChild>
                  <Link to="/instructor">
                    Go to Instructor Dashboard
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/instructor/profile">Review your instructor profile</Link>
                </Button>
              </div>
            </>
          ) : null}

          {/* --- 4 · SUSPENDED ----------------------------------------- */}
          {data.status === 'SUSPENDED' && data.suspension ? (
            <>
              <StatusHeader
                icon={PauseCircle}
                tone="suspended"
                title="Instructor access suspended"
                meta={`Since ${formatDateTime(data.suspension.since)}`}
                badge={<Badge variant="ink">Suspended</Badge>}
              />

              {data.suspension.reason ? (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    Reason
                  </p>
                  <p className="mt-2 text-small text-secondary-foreground">
                    {data.suspension.reason}
                  </p>
                </div>
              ) : null}

              <ul className="flex flex-col gap-3">
                <li className="flex items-start gap-2 text-small">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-semibold">You can still learn.</strong> My
                    learning, your enrollments and progress work as usual.
                  </span>
                </li>
                <li className="flex items-start gap-2 text-small">
                  <XCircle
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-semibold">Teaching is paused.</strong> You can't
                    edit or publish courses. Learners already enrolled keep access; your
                    courses are hidden from the catalog.
                  </span>
                </li>
              </ul>

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button asChild>
                  <Link to="/my-learning">Go to My learning</Link>
                </Button>
                <Button asChild variant="outline">
                  <a href="mailto:support@cadence.dev">Contact support</a>
                </Button>
              </div>
            </>
          ) : null}

          {/* --- WITHDRAWN --------------------------------------------- */}
          {data.status === 'WITHDRAWN' ? (
            <>
              <StatusHeader
                icon={Pencil}
                tone="suspended"
                title="Application withdrawn"
                meta={`Withdrawn ${formatDateTime(application?.decidedAt)}`}
                badge={<Badge variant="secondary">Withdrawn</Badge>}
              />
              <p className="text-small text-secondary-foreground">
                You can apply again whenever you're ready.
              </p>
              <div className="border-t border-border pt-5">
                <Button asChild>
                  <Link to="/become-an-instructor">Apply again</Link>
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Withdraw your application?"
        description="Your application will be closed. You can apply again at any time, and nothing about your learning changes."
        confirmLabel="Withdraw application"
        destructive
        onConfirm={() => {
          withdraw.mutate();
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}
