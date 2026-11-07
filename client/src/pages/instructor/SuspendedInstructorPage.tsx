import { Link } from 'react-router-dom';
import { CheckCircle2, PauseCircle, XCircle } from 'lucide-react';
import { formatDateTime } from '@cadence/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMyApplication } from '@/features/instructor/instructor.queries';

/**
 * What a suspended instructor sees instead of the teaching workspace.
 *
 * Deliberately not a bare 403. The workspace was theirs and now is not,
 * so the page says why, says what still works, and gives them somewhere
 * to go — which is the difference between a refusal and an explanation.
 */
export function SuspendedInstructorPage() {
  const { data } = useMyApplication();
  const suspension = data?.suspension;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-10">
      <Card>
        <CardContent className="flex flex-col gap-6 pt-6">
          <div className="flex items-start gap-4">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted"
              aria-hidden="true"
            >
              <PauseCircle className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-h2">Your instructor access is suspended</h1>
                <Badge variant="ink">Suspended</Badge>
              </div>
              {suspension ? (
                <p className="mt-1 text-small text-secondary-foreground">
                  Since {formatDateTime(suspension.since)}
                </p>
              ) : null}
            </div>
          </div>

          {suspension?.reason ? (
            <div className="rounded-lg bg-muted p-4">
              <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                Reason
              </p>
              <p className="mt-2 text-small text-secondary-foreground">
                {suspension.reason}
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
                <strong className="font-semibold">You can still learn.</strong> My learning,
                your enrollments and your progress work exactly as before.
              </span>
            </li>
            <li className="flex items-start gap-2 text-small">
              <XCircle
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span>
                <strong className="font-semibold">Teaching is paused.</strong> You can&rsquo;t
                edit or publish courses. Learners already enrolled keep access; your courses
                are hidden from the catalog.
              </span>
            </li>
          </ul>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button asChild>
              <Link to="/my-learning">Go to My learning</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/instructor-application">See the full details</Link>
            </Button>
            <Button asChild variant="ghost">
              <a href="mailto:support@cadence.dev">Contact support</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
