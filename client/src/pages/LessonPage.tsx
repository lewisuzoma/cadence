import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatTimecode } from '@cadence/shared';
import { ErrorState, ForbiddenState, NotFoundState } from '@/components/common/States';
import { LessonStatusBadge } from '@/components/common/StatusBadge';
import { LessonSidebarList, LessonListSkeleton } from '@/components/lessons/LessonList';
import { LessonVideoPlayer } from '@/components/lessons/LessonVideoPlayer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useCourse, useCourseLessons, useLesson } from '@/features/courses/courses.queries';
import {
  useCompleteLesson,
  useLessonProgress,
} from '@/features/progress/progress.queries';
import { useLessonProgressTracker } from '@/features/progress/useLessonProgressTracker';
import { ApiError } from '@/lib/api-client';

/**
 * The focused lesson view.
 *
 * Two columns at desktop width: the player and lesson body on the left, the
 * course lesson list on the right; stacked on mobile. The player is fed the
 * saved position and reports back to the tracker, which is the only thing
 * that writes progress.
 *
 * Nothing here decides completion. `onEnded` asks the server, and the server
 * applies the rules.
 */
export function LessonPage() {
  const { slug = '', lessonId = '' } = useParams();
  const navigate = useNavigate();

  const lessonQuery = useLesson(lessonId);
  const courseQuery = useCourse(slug);
  const lessonsQuery = useCourseLessons(lessonQuery.data?.course.id ?? '');
  const progressQuery = useLessonProgress(lessonId, Boolean(lessonQuery.data?.isTracked));
  const completeLesson = useCompleteLesson();

  const lesson = lessonQuery.data;
  const durationSeconds = lesson?.durationSeconds ?? 0;

  const tracker = useLessonProgressTracker(lessonId, {
    // Preview viewers with no enrollment are not tracked; the server would
    // refuse the write, so the client does not attempt it.
    enabled: Boolean(lesson?.isTracked),
    durationSeconds,
  });

  const goToLesson = useCallback(
    (nextId: string) => {
      // Flush before navigating so the position is not lost between pages.
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
      <ErrorState
        title="Could not load this lesson"
        onRetry={() => void lessonQuery.refetch()}
      />
    );
  }

  // `lesson` is read above the guards because the tracker hook needs the
  // duration and hooks cannot be called conditionally. TypeScript cannot see
  // that the guards already rule out `undefined`, so this narrows it.
  if (!lesson) return <LessonPageSkeleton />;

  const progress = progressQuery.data?.progress ?? lesson.progress;
  const resumeFrom = progress?.lastPositionSeconds ?? 0;
  const courseProgress = courseQuery.data?.enrollment?.progressPercentage ?? 0;
  const siblings = lessonsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-small text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link to="/courses" className="hover:text-primary-hover">
              Courses
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link to={`/courses/${slug}`} className="hover:text-primary-hover">
              {lesson.course.title}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            {lesson.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:items-start">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-6">
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
              // Only ask when the lesson is tracked and not already complete.
              if (!lesson.isTracked || progress?.isCompleted) return;
              completeLesson.mutate({ lessonId, positionSeconds: Math.floor(positionSeconds) });
            }}
            hasNext={Boolean(lesson.nextLessonId)}
            onNext={() => lesson.nextLessonId && goToLesson(lesson.nextLessonId)}
          />

          <Card className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-2">
                <p className="text-overline uppercase text-muted-foreground">
                  {lesson.module.title}
                </p>
                <h1 className="font-heading text-heading">{lesson.title}</h1>
                <p className="font-mono text-caption tabular text-muted-foreground">
                  {formatTimecode(lesson.durationSeconds)}
                  {progress && !progress.isCompleted && progress.completionPercentage > 0
                    ? ` · ${progress.completionPercentage}% watched`
                    : ''}
                </p>
              </div>
              <LessonStatusBadge status={lesson.status} />
            </div>

            {lesson.description ? (
              <p className="max-w-3xl text-body text-secondary-foreground">
                {lesson.description}
              </p>
            ) : null}

            {!lesson.isTracked ? (
              <p className="rounded-md bg-primary-tint px-3.5 py-3 text-small text-primary-hover">
                You are watching a free preview. Enrol in this course to save your progress.
              </p>
            ) : (
              <p className="text-caption text-muted-foreground">
                Your position is saved automatically every 10 seconds, and when you pause.
              </p>
            )}

            {/* Previous / next */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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
                      // The server rejects this unless it has been earned.
                      positionSeconds: Math.max(
                        resumeFrom,
                        progress?.maxWatchedSeconds ?? 0,
                      ),
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
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </Card>
        </div>

        {/* Side column */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-title">Up next in this course</h2>
              <span className="font-mono text-caption tabular text-secondary-foreground">
                {courseProgress}%
              </span>
            </div>
            <Progress value={courseProgress} label={`${lesson.course.title} progress`} size="sm" />

            {lessonsQuery.isPending ? (
              <LessonListSkeleton rows={5} />
            ) : (
              <ScrollArea className="max-h-[28rem]">
                <LessonSidebarList
                  lessons={siblings}
                  courseSlug={slug}
                  currentLessonId={lessonId}
                />
              </ScrollArea>
            )}

            <Button asChild variant="ghost" className="justify-start">
              <Link to={`/courses/${slug}`}>View full curriculum</Link>
            </Button>
          </Card>
        </aside>
      </div>
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
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="flex flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Card className="flex flex-col gap-3 p-6">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        </div>
        <Card className="flex flex-col gap-3 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-1.5 w-full rounded-pill" />
          <LessonListSkeleton rows={5} />
        </Card>
      </div>
    </div>
  );
}
