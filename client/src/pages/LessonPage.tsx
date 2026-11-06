import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { formatTimecode } from '@cadence/shared';
import { ErrorState, ForbiddenState, NotFoundState } from '@/components/common/States';
import { UpNextList, UpNextListSkeleton } from '@/components/lessons/UpNextList';
import { LessonVideoPlayer } from '@/components/lessons/LessonVideoPlayer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useCourse, useCourseLessons, useLesson } from '@/features/courses/courses.queries';
import { useCompleteLesson, useLessonProgress } from '@/features/progress/progress.queries';
import { useLessonProgressTracker } from '@/features/progress/useLessonProgressTracker';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * The focused lesson view.
 *
 * Desktop (artifact page 6): a slim top bar carrying the course name, the
 * lesson title and the course progress; the player and lesson body on the
 * left; the "Up next in this course" rail on the right.
 *
 * Phone (artifact page 9, "App — lesson"): the top bar collapses to a back
 * arrow and "Lesson 5 of 12"; the player runs edge to edge; the body carries
 * the status badge, title, meta and a segmented Up next / Transcript /
 * Resources control; a sticky bottom bar holds Curriculum and Next lesson.
 *
 * Nothing here decides completion — `onEnded` asks the server, which applies
 * the rules.
 */
type LessonTab = 'up-next' | 'transcript' | 'resources';

export function LessonPage() {
  const { slug = '', lessonId = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<LessonTab>('up-next');

  const lessonQuery = useLesson(lessonId);
  const courseQuery = useCourse(slug);
  const lessonsQuery = useCourseLessons(lessonQuery.data?.course.id ?? '');
  const progressQuery = useLessonProgress(lessonId, Boolean(lessonQuery.data?.isTracked));
  const completeLesson = useCompleteLesson();

  const lesson = lessonQuery.data;
  const durationSeconds = lesson?.durationSeconds ?? 0;

  const tracker = useLessonProgressTracker(lessonId, {
    enabled: Boolean(lesson?.isTracked),
    durationSeconds,
  });

  const goToLesson = useCallback(
    (nextId: string) => {
      tracker.flush('pause');
      navigate(`/courses/${slug}/lessons/${nextId}`);
    },
    [navigate, slug, tracker],
  );

  if (lessonQuery.isPending) return <LessonPageSkeleton />;

  if (lessonQuery.isError) {
    const error = lessonQuery.error;
    if (error instanceof ApiError && error.status === 403) return <ForbiddenLesson slug={slug} />;
    if (error instanceof ApiError && error.status === 404) return <NotFoundState />;
    return (
      <ErrorState title="Could not load this lesson" onRetry={() => void lessonQuery.refetch()} />
    );
  }

  if (!lesson) return <LessonPageSkeleton />;

  const progress = progressQuery.data?.progress ?? lesson.progress;
  const resumeFrom = progress?.lastPositionSeconds ?? 0;
  const courseProgress = courseQuery.data?.enrollment?.progressPercentage ?? 0;
  const siblings = lessonsQuery.data ?? [];
  const index = siblings.findIndex((item) => item.id === lesson.id);
  const position = index >= 0 ? index + 1 : null;
  const percentage = progress?.completionPercentage ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar: back + position on phone, full context on desktop. */}
      <header className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Back to the course"
          onClick={() => {
            tracker.flush('pause');
            navigate(`/courses/${slug}`);
          }}
          className="rounded-pill"
        >
          <ChevronLeft />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-caption text-muted-foreground max-md:hidden">
            {lesson.course.title} · {lesson.module.title}
          </p>
          <p className="truncate text-small font-semibold max-md:hidden">{lesson.title}</p>
          <p className="text-small font-semibold md:hidden">
            {position ? `Lesson ${position} of ${siblings.length}` : lesson.module.title}
          </p>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Progress
            value={courseProgress}
            label={`${lesson.course.title} progress`}
            size="sm"
            className="w-40"
          />
          <span className="font-mono text-caption tabular text-secondary-foreground">
            {courseProgress}%
          </span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {/* The player bleeds to the screen edges on phone, as in the app screen. */}
          <div className="max-md:-mx-4">
            <LessonVideoPlayer
              videoUrl={lesson.videoUrl}
              captionsUrl={lesson.captionsUrl}
              title={lesson.title}
              durationSeconds={durationSeconds}
              resumeFromSeconds={resumeFrom}
              isCompleted={progress?.isCompleted ?? false}
              onPositionChange={tracker.report}
              onFlush={(reason) => tracker.flush(reason)}
              onEnded={(positionSeconds) => {
                if (!lesson.isTracked || progress?.isCompleted) return;
                completeLesson.mutate({ lessonId, positionSeconds: Math.floor(positionSeconds) });
              }}
              hasNext={Boolean(lesson.nextLessonId)}
              onNext={() => lesson.nextLessonId && goToLesson(lesson.nextLessonId)}
              className="max-md:rounded-none max-md:border-x-0"
            />
          </div>

          <Card className="flex flex-col gap-4 p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                {progress?.isCompleted ? (
                  <Badge variant="success" className="w-fit">
                    Completed
                  </Badge>
                ) : percentage > 0 ? (
                  <Badge variant="warning" className="w-fit">
                    In progress · {percentage}%
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="w-fit">
                    Not started
                  </Badge>
                )}
                <h1 className="font-heading text-heading lg:text-display-sm">{lesson.title}</h1>
                <p className="text-small text-secondary-foreground">
                  {lesson.course.title} · {formatTimecode(lesson.durationSeconds)}
                </p>
              </div>
            </div>

            {/* Segmented control, Ink when selected — the artifact's treatment. */}
            <div
              role="tablist"
              aria-label="Lesson panels"
              className="flex flex-wrap gap-2 border-b border-border pb-4"
            >
              {(
                [
                  ['up-next', 'Up next'],
                  ['transcript', 'Transcript'],
                  ['resources', 'Resources'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  variant={tab === value ? 'ink' : 'secondary'}
                  size="sm"
                  className="rounded-md"
                  onClick={() => setTab(value)}
                >
                  {label}
                </Button>
              ))}
            </div>

            {tab === 'up-next' ? (
              <div className="flex flex-col gap-4">
                {lesson.description ? (
                  <p className="max-w-3xl text-body text-secondary-foreground">
                    {lesson.description}
                  </p>
                ) : null}

                {/* On phone the rail lives here, under the lesson body. */}
                <div className="lg:hidden">
                  {lessonsQuery.isPending ? (
                    <UpNextListSkeleton rows={3} />
                  ) : (
                    <UpNextList
                      lessons={siblings.slice(
                        Math.max(0, index + 1),
                        Math.max(0, index + 1) + 3,
                      )}
                      courseSlug={slug}
                      currentLessonId={lessonId}
                    />
                  )}
                </div>
              </div>
            ) : null}

            {tab === 'transcript' ? (
              <p className="text-small text-secondary-foreground">
                {lesson.captionsUrl
                  ? 'This lesson ships captions. Turn them on with the CC control in the player, or press C.'
                  : 'No transcript has been added for this lesson yet.'}
              </p>
            ) : null}

            {tab === 'resources' ? (
              <p className="text-small text-secondary-foreground">
                No downloadable resources are attached to this lesson.
              </p>
            ) : null}

            {!lesson.isTracked ? (
              <p className="rounded-md bg-primary-tint px-3.5 py-3 text-small text-primary-hover">
                You are watching a free preview. Enrol in this course to save your progress.
              </p>
            ) : (
              <p className="text-caption text-muted-foreground">
                Position saved automatically every 10 seconds and on pause.
              </p>
            )}

            {/* Desktop actions; phone uses the sticky bar below. */}
            <div className="hidden flex-wrap items-center justify-between gap-3 border-t border-border pt-4 md:flex">
              <Button
                variant="secondary"
                disabled={!lesson.previousLessonId}
                onClick={() => lesson.previousLessonId && goToLesson(lesson.previousLessonId)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>

              {lesson.isTracked && !progress?.isCompleted ? (
                <Button
                  variant="success"
                  loading={completeLesson.isPending}
                  onClick={() =>
                    completeLesson.mutate({
                      lessonId,
                      positionSeconds: Math.max(resumeFrom, progress?.maxWatchedSeconds ?? 0),
                    })
                  }
                >
                  Mark as complete
                </Button>
              ) : null}

              <Button
                disabled={!lesson.nextLessonId}
                onClick={() => lesson.nextLessonId && goToLesson(lesson.nextLessonId)}
              >
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </Card>
        </div>

        {/* Desktop rail */}
        <aside className="hidden flex-col gap-4 lg:sticky lg:top-24 lg:flex">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-title">Up next in this course</h2>
            {lessonsQuery.isPending ? (
              <UpNextListSkeleton rows={5} />
            ) : (
              <ScrollArea className="max-h-[30rem]">
                <UpNextList
                  lessons={siblings}
                  courseSlug={slug}
                  currentLessonId={lessonId}
                />
              </ScrollArea>
            )}
            <Button asChild variant="secondary" className="w-full">
              <Link to={`/courses/${slug}`}>View full curriculum</Link>
            </Button>
          </Card>
        </aside>
      </div>

      {/*
        The phone action bar from artifact page 9. `bottom-16` clears the tab
        bar, and the safe-area inset keeps it above the home indicator.
      */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-16 z-30 flex gap-3 border-t border-border bg-card p-3',
          'pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden',
        )}
      >
        <Button asChild variant="secondary" className="flex-1">
          <Link to={`/courses/${slug}`}>Curriculum</Link>
        </Button>
        <Button
          className="flex-1"
          disabled={!lesson.nextLessonId}
          onClick={() => lesson.nextLessonId && goToLesson(lesson.nextLessonId)}
        >
          Next lesson
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      {/* Spacer so the sticky bar never covers the last of the content. */}
      <div aria-hidden="true" className="h-20 md:hidden" />
    </div>
  );
}

function ForbiddenLesson({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col gap-6">
      <ForbiddenState />
      <div className="flex justify-center">
        <Button asChild variant="secondary">
          <Link to={`/courses/${slug}`}>Back to the course</Link>
        </Button>
      </div>
    </div>
  );
}

function LessonPageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Card className="flex flex-col gap-3 p-6">
            <Skeleton className="h-5 w-28 rounded-pill" />
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        </div>
        <Card className="hidden flex-col gap-3 p-5 lg:flex">
          <Skeleton className="h-5 w-40" />
          <UpNextListSkeleton rows={4} />
        </Card>
      </div>
    </div>
  );
}
