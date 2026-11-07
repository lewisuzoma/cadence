import { Link, useParams } from 'react-router-dom';
import { Eye, EyeOff, Pencil, PlayCircle, X } from 'lucide-react';
import { formatTimecode } from '@cadence/shared';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCoursePreview } from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * Course preview — desktop artifact page 10, mobile board 6.
 *
 * The learner's view, inside a preview frame. The banner is not merely
 * informational: it is the thing that stops an instructor mistaking this
 * for the real player and wondering why their watching is not counted.
 *
 * Nothing here writes progress. The server returns `progressTracked:
 * false` and the lesson endpoint independently refuses to record anything
 * for a course's owner, so the promise in the banner is enforced on the
 * server rather than merely made in the UI.
 */
export function CoursePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = useCoursePreview(id);

  if (isPending) return <LoadingState label="Loading preview" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load the preview"
        onRetry={() => void refetch()}
      />
    );
  }

  const lessons = data.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ ...lesson, moduleTitle: module.title, moduleOrder: module.order })),
  );
  const first = lessons[0];

  return (
    <div className="-mx-4 -my-6 flex min-h-dvh flex-col lg:-mx-8 lg:-my-8">
      {/* --- the preview banner ---------------------------------- */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 bg-foreground px-4 py-3 text-background lg:px-8">
        <span className="flex items-center gap-2 rounded-pill bg-video-accent px-3 py-1 text-caption font-semibold text-foreground">
          <Eye className="size-3.5" aria-hidden="true" />
          Preview mode
        </span>
        <p className="min-w-0 flex-1 text-small text-background/90">
          You&rsquo;re seeing this course as a learner would. Nothing you watch here is
          saved as progress, and no enrollment is created.
        </p>
        <span className="rounded-pill border border-background/30 px-3 py-1 text-caption">
          {data.preview.courseStatus === 'PUBLISHED'
            ? 'Published · in catalog'
            : data.preview.courseStatus === 'DRAFT'
              ? 'Draft · not in catalog'
              : 'Archived · not in catalog'}
        </span>
        <Button asChild variant="secondary" size="sm">
          <Link to={`/instructor/courses/${id}`}>
            <X aria-hidden="true" />
            Exit preview
          </Link>
        </Button>
      </div>

      <div className="flex-1 px-4 py-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-caption text-muted-foreground">
              {data.title}
              {first ? ` · ${first.moduleTitle}` : ''}
            </p>
            <h1 className="text-heading">
              {first ? `${String(1).padStart(2, '0')} · ${first.title}` : data.title}
            </h1>
          </div>
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <EyeOff className="size-3.5" aria-hidden="true" />
            Progress bar hidden in preview
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* --- the player surface -------------------------------- */}
          <div className="flex flex-col gap-4">
            <div className="relative overflow-hidden rounded-xl bg-night">
              <span className="absolute left-4 top-4 z-10 rounded-md bg-night/80 px-2.5 py-1 font-mono text-caption font-semibold uppercase text-video-accent">
                Preview · progress not saved
              </span>

              <div className="grid aspect-video place-items-center">
                {first && first.durationSeconds > 0 ? (
                  <Link
                    to={`/courses/${data.slug}/lessons/${first.id}`}
                    className="flex size-16 items-center justify-center rounded-full bg-card text-foreground transition-transform hover:scale-105"
                    aria-label={`Play ${first.title}`}
                  >
                    <PlayCircle className="size-8" aria-hidden="true" />
                  </Link>
                ) : (
                  <p className="px-6 text-center text-small text-night-muted">
                    This lesson has no playable video yet.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
                <span className="font-mono text-caption text-night-muted">
                  00:00 / {first ? formatTimecode(first.durationSeconds) : '00:00'}
                </span>
                <span className="text-caption text-night-muted">
                  Resume &amp; completion tracking are off in preview
                </span>
              </div>
            </div>

            {first ? (
              <Card>
                <CardContent className="flex flex-col gap-2 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-heading-sm">
                      01 · {first.title}
                    </h2>
                    {first.isPreview ? <Badge variant="info">Free preview</Badge> : null}
                  </div>
                  <p className="text-caption text-muted-foreground">
                    Lesson 1 of {lessons.length}
                    {data.instructor ? ` · ${data.instructor.displayName}` : ''}
                  </p>
                  {first.description ? (
                    <p className="text-small text-secondary-foreground">
                      {first.description}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* --- the lesson list ----------------------------------- */}
          <aside className="flex flex-col gap-3">
            <h2 className="text-heading-sm">Lessons in this course</h2>
            {lessons.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-small text-muted-foreground">
                  This course has no lessons yet.
                </CardContent>
              </Card>
            ) : (
              <ol className="flex flex-col gap-2">
                {lessons.map((lesson, index) => {
                  const playable = lesson.durationSeconds > 0;
                  return (
                    <li
                      key={lesson.id}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3',
                        index === 0 ? 'border-primary bg-primary-tint/30' : 'border-border',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-md',
                          playable
                            ? index === 0
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-foreground text-background'
                            : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        <PlayCircle className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-caption text-muted-foreground">
                          Module {String(lesson.moduleOrder).padStart(2, '0')}
                          {lesson.isPreview ? ' · Free preview' : ''}
                        </span>
                        <span className="block text-small font-semibold text-foreground">
                          {String(index + 1).padStart(2, '0')} · {lesson.title}
                        </span>
                        <span
                          className={cn(
                            'block font-mono text-caption',
                            playable ? 'text-muted-foreground' : 'text-destructive',
                          )}
                        >
                          {playable
                            ? `${formatTimecode(lesson.durationSeconds)}${index === 0 ? ' · Previewing' : ''}`
                            : "No video — learners can't play this yet"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            <Button asChild variant="outline">
              <Link to={`/instructor/courses/${id}/lessons`}>
                <Pencil aria-hidden="true" />
                Edit lessons
              </Link>
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
}
