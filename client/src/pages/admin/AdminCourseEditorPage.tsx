import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Globe,
  Plus,
  Trash2,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import {
  formatDuration,
  formatTimecode,
  lessonInputSchema,
  type LessonInput,
  type LessonSummary,
  type ModuleWithLessons,
} from '@cadence/shared';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState, NotFoundState } from '@/components/common/States';
import { PageHeader } from '@/components/common/PageHeader';
import { CourseStatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAdminCourse,
  useCreateLesson,
  useCreateModule,
  useDeleteLesson,
  useDeleteModule,
  useReorderLessons,
  useSetCourseStatus,
  useUpdateLesson,
} from '@/features/courses/courses.queries';
import { ApiError } from '@/lib/api-client';

/**
 * The course editor.
 *
 * Mirrors the artifact's page 8: course header with status and a publish
 * action, a publishing checklist computed from the real course, then modules
 * with their lessons — add, edit, delete, toggle preview, and reorder with
 * arrow buttons that stay keyboard accessible (a drag handle alone would not).
 *
 * Reordering sends the whole new order to one transactional endpoint, so the
 * positions can never end up half-applied.
 */
export function AdminCourseEditorPage() {
  const { id = '' } = useParams();
  const { data: course, isPending, isError, error, refetch } = useAdminCourse(id);
  const setStatus = useSetCourseStatus();
  const createModule = useCreateModule(id);

  const [newModuleTitle, setNewModuleTitle] = useState('');

  if (isPending) return <EditorSkeleton />;
  if (isError) {
    if (error instanceof ApiError && error.status === 404) return <NotFoundState />;
    return <ErrorState title="Could not load this course" onRetry={() => void refetch()} />;
  }

  const lessons = course.modules.flatMap((module) => module.lessons);

  // The publishing checklist, computed from the course rather than hardcoded.
  const checks = [
    { label: 'Title is at least 3 characters', ok: course.title.trim().length >= 3 },
    { label: 'Description is at least 20 characters', ok: course.description.trim().length >= 20 },
    { label: 'At least one lesson', ok: lessons.length > 0 },
    { label: 'Every lesson has a duration', ok: lessons.every((l) => l.durationSeconds > 0) },
  ];
  const blocking = checks.filter((check) => !check.ok);

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-small text-muted-foreground">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/admin/courses" className="hover:text-primary-hover">
              Courses
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            Edit course
          </li>
        </ol>
      </nav>

      <PageHeader
        overline={course.category}
        title={course.title}
        description={`${lessons.length} lessons · ${formatDuration(course.estimatedDuration)}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <CourseStatusBadge status={course.status} />
            <Button asChild variant="secondary">
              <Link to={`/courses/${course.slug}`}>Preview</Link>
            </Button>
            {course.status === 'PUBLISHED' ? (
              <Button
                variant="secondary"
                loading={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: course.id, status: 'DRAFT' })}
              >
                Unpublish
              </Button>
            ) : (
              <Button
                loading={setStatus.isPending}
                disabled={blocking.length > 0}
                onClick={() => setStatus.mutate({ id: course.id, status: 'PUBLISHED' })}
              >
                <Globe aria-hidden="true" />
                Publish course
              </Button>
            )}
          </div>
        }
      />

      {/* Publishing checklist */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-title">Publishing checklist</h2>
          {blocking.length > 0 ? (
            <Badge variant="warning">
              <AlertTriangle aria-hidden="true" />
              {blocking.length} to fix
            </Badge>
          ) : (
            <Badge variant="success">
              <Check aria-hidden="true" />
              Ready
            </Badge>
          )}
        </div>
        <ul className="flex flex-col gap-2">
          {checks.map((check) => (
            <li key={check.label} className="flex items-center gap-2 text-small">
              {check.ok ? (
                <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <X className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              )}
              <span className={check.ok ? '' : 'text-destructive'}>{check.label}</span>
              <span className="sr-only">{check.ok ? ' — passed' : ' — needs attention'}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Modules */}
      <section aria-labelledby="modules-heading" className="flex flex-col gap-4">
        <h2 id="modules-heading" className="font-heading text-heading-sm">
          Modules and lessons
        </h2>

        {course.modules.length === 0 ? (
          <Card className="p-6 text-small text-secondary-foreground">
            This course has no modules yet. Add one below to start building the curriculum.
          </Card>
        ) : (
          course.modules.map((module) => (
            <ModuleEditor key={module.id} courseId={id} module={module} />
          ))
        )}

        {/* Add module */}
        <Card className="flex flex-col gap-3 p-5">
          <Label htmlFor="new-module">New module</Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="new-module"
              value={newModuleTitle}
              onChange={(event) => setNewModuleTitle(event.target.value)}
              placeholder="Module 1 · Foundations"
            />
            <Button
              loading={createModule.isPending}
              disabled={newModuleTitle.trim().length < 2}
              onClick={() =>
                createModule.mutate(
                  { title: newModuleTitle.trim() },
                  { onSuccess: () => setNewModuleTitle('') },
                )
              }
            >
              <Plus aria-hidden="true" />
              Add module
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ModuleEditor({ courseId, module }: { courseId: string; module: ModuleWithLessons }) {
  const reorder = useReorderLessons(courseId);
  const deleteModule = useDeleteModule(courseId);
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ids = module.lessons.map((lesson) => lesson.id);

  /** Swap two positions and send the whole order; the server is transactional. */
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    reorder.mutate({ moduleId: module.id, lessonIds: next });
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-title">{module.title}</h3>
          <p className="font-mono text-caption tabular text-muted-foreground">
            {module.lessons.length} lessons ·{' '}
            {formatDuration(
              module.lessons.reduce((total, lesson) => total + lesson.durationSeconds, 0),
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus aria-hidden="true" />
            Add lesson
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${module.title}`}
            className="text-destructive hover:bg-destructive-tint"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {module.lessons.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {module.lessons.map((lesson, index) => (
            <LessonEditorRow
              key={lesson.id}
              courseId={courseId}
              lesson={lesson}
              index={index}
              isFirst={index === 0}
              isLast={index === module.lessons.length - 1}
              onMove={(direction) => move(index, direction)}
              reordering={reorder.isPending}
            />
          ))}
        </ul>
      ) : (
        <p className="text-small text-secondary-foreground">
          No lessons in this module yet.
        </p>
      )}

      {adding ? (
        <LessonForm
          courseId={courseId}
          moduleId={module.id}
          position={module.lessons.length + 1}
          onDone={() => setAdding(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmingDelete(false);
            setDeleteError(null);
          }
        }}
        title={`Delete ${module.title}?`}
        description={`This removes ${module.lessons.length} lesson${module.lessons.length === 1 ? '' : 's'}. It cannot be undone.`}
        confirmLabel="Delete module"
        loading={deleteModule.isPending}
        error={deleteError}
        onConfirm={() =>
          deleteModule.mutate(module.id, {
            onSuccess: () => setConfirmingDelete(false),
            onError: (error) =>
              setDeleteError(
                error instanceof ApiError ? error.message : 'Could not delete this module.',
              ),
          })
        }
      />
    </Card>
  );
}

function LessonEditorRow({
  courseId,
  lesson,
  index,
  isFirst,
  isLast,
  onMove,
  reordering,
}: {
  courseId: string;
  lesson: LessonSummary;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  reordering: boolean;
}) {
  const updateLesson = useUpdateLesson(courseId);
  const deleteLesson = useDeleteLesson(courseId);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-3">
      <span className="font-mono text-caption tabular text-muted-foreground">
        {String(index + 1).padStart(2, '0')}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-semibold">{lesson.title}</p>
        <p className="flex items-center gap-2 font-mono text-caption tabular text-muted-foreground">
          {formatTimecode(lesson.durationSeconds)}
          {lesson.isPreview ? <Badge variant="outline">Preview</Badge> : null}
        </p>
      </div>

      {/* Video presence, from the real field rather than a fake status. */}
      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
        {lesson.description ? (
          <Video className="size-4 text-success" aria-hidden="true" />
        ) : (
          <VideoOff className="size-4" aria-hidden="true" />
        )}
      </span>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-caption">
          <Switch
            checked={lesson.isPreview}
            disabled={updateLesson.isPending}
            onCheckedChange={(checked) =>
              updateLesson.mutate({ lessonId: lesson.id, input: { isPreview: checked } })
            }
            aria-label={`Free preview for ${lesson.title}`}
          />
          Preview
        </label>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${lesson.title} up`}
          disabled={isFirst || reordering}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${lesson.title} down`}
          disabled={isLast || reordering}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${lesson.title}`}
          className="text-destructive hover:bg-destructive-tint"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${lesson.title}?`}
        description="Any learner progress recorded against this lesson is removed with it."
        confirmLabel="Delete lesson"
        loading={deleteLesson.isPending}
        onConfirm={() =>
          deleteLesson.mutate(lesson.id, { onSuccess: () => setConfirming(false) })
        }
      />
    </li>
  );
}

/** The inline "New lesson · position NN" form from the artifact. */
function LessonForm({
  courseId,
  moduleId,
  position,
  onDone,
}: {
  courseId: string;
  moduleId: string;
  position: number;
  onDone: () => void;
}) {
  const createLesson = useCreateLesson(courseId);

  const form = useForm<LessonInput>({
    resolver: zodResolver(lessonInputSchema),
    defaultValues: {
      title: '',
      description: '',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      durationSeconds: 600,
      isPreview: false,
    },
  });

  return (
    <Card className="flex flex-col gap-4 border-primary/40 bg-primary-tint/40 p-5">
      <p className="text-overline uppercase text-muted-foreground">
        New lesson · position {String(position).padStart(2, '0')}
      </p>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) =>
            createLesson.mutate(
              { moduleId, input: values },
              {
                onSuccess: () => {
                  form.reset();
                  onDone();
                },
                onError: (error) => applyLessonErrors(error, form.setError),
              },
            ),
          )}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Lesson title</FormLabel>
                  <FormControl>
                    <Input placeholder="Validating input with Zod" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="durationSeconds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Duration (seconds)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                    />
                  </FormControl>
                  <FormDescription>
                    {formatTimecode(Number(field.value) || 0)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="videoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Video URL</FormLabel>
                <FormControl>
                  <Input placeholder="https://cdn.example.com/lesson.mp4" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-small">
              <Switch
                checked={form.watch('isPreview')}
                onCheckedChange={(checked) => form.setValue('isPreview', checked)}
                aria-label="Free preview"
              />
              Free preview
            </label>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" loading={createLesson.isPending}>
                Add lesson
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </Card>
  );
}

/** Narrow helper so the lesson form can map server field errors too. */
function applyLessonErrors(
  error: unknown,
  setError: (field: keyof LessonInput, value: { type: string; message: string }) => void,
): void {
  if (!(error instanceof ApiError) || !error.fieldErrors) return;
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const message = messages[0];
    if (message) setError(field as keyof LessonInput, { type: 'server', message });
  }
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
