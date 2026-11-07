import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  GripVertical,
  Info,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { LessonSummary, ModuleWithLessons } from '@cadence/shared';
import { formatDuration, formatTimecode } from '@cadence/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { LessonDialog } from '@/components/instructor/LessonDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  useCreateModule,
  useDeleteLesson,
  useDeleteModule,
  useInstructorCourse,
  useReorderLessons,
  useUpdateLesson,
} from '@/features/instructor/instructor.queries';
import { cn } from '@/lib/utils';

/**
 * "Manage lessons" — desktop artifact page 8, mobile board 6.
 *
 * Reordering has **two** equal paths, not a mouse path with a keyboard
 * afterthought:
 *
 *  - drag by the handle, via `@dnd-kit`;
 *  - focus a handle and press ↑ / ↓ (dnd-kit's keyboard sensor), or use
 *    the explicit Move up / Move down buttons on every row.
 *
 * The buttons exist because a keyboard sensor still requires the user to
 * discover that a handle is draggable. Two visible arrows require no
 * discovery at all, and they are what a screen-reader user will find.
 */

/** A lesson's video state, as the artifact's chips show it. */
function VideoChip({ lesson }: { lesson: LessonSummary }) {
  if (lesson.durationSeconds > 0 && lesson.videoKind === 'URL') {
    return (
      <Badge variant="info">
        <Link2 aria-hidden="true" />
        External URL
      </Badge>
    );
  }
  if (lesson.durationSeconds > 0) {
    return <Badge variant="success">Video ready</Badge>;
  }
  return (
    <Badge variant="warning">
      <AlertCircle aria-hidden="true" />
      No video yet
    </Badge>
  );
}

function SortableLesson({
  lesson,
  index,
  total,
  position,
  onMove,
  onEdit,
  onDelete,
  onTogglePreview,
}: {
  lesson: LessonSummary;
  index: number;
  total: number;
  position: number;
  onMove: (from: number, to: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePreview: (next: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-3',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted active:cursor-grabbing"
        aria-label={`Reorder ${lesson.title}. Press space, then the arrow keys.`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      {/* The always-visible keyboard path. */}
      <div className="flex flex-col gap-0.5">
        <Button
          variant="outline"
          size="icon"
          className="size-6"
          disabled={index === 0}
          aria-label={`Move ${lesson.title} up`}
          onClick={() => onMove(index, index - 1)}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-6"
          disabled={index === total - 1}
          aria-label={`Move ${lesson.title} down`}
          onClick={() => onMove(index, index + 1)}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>

      <span className="w-6 shrink-0 font-mono text-caption text-muted-foreground">
        {String(position).padStart(2, '0')}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-semibold text-foreground">{lesson.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <VideoChip lesson={lesson} />
          <span className="font-mono text-caption text-muted-foreground">
            {lesson.durationSeconds > 0 ? formatTimecode(lesson.durationSeconds) : '—'}
          </span>
        </p>
      </div>

      <label className="flex shrink-0 items-center gap-2 text-caption text-secondary-foreground max-sm:hidden">
        <Switch
          checked={lesson.isPreview}
          onCheckedChange={onTogglePreview}
          aria-label={`Free preview for ${lesson.title}`}
        />
        Free preview
      </label>

      <Button variant="outline" size="icon" aria-label={`Edit ${lesson.title}`} onClick={onEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label={`Delete ${lesson.title}`}
        className="text-destructive hover:bg-destructive-tint"
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

function ModuleSection({
  module,
  courseId,
  startNumber,
  onEditLesson,
  onDeleteLesson,
  onDeleteModule,
}: {
  module: ModuleWithLessons;
  courseId: string;
  startNumber: number;
  onEditLesson: (lesson: LessonSummary | null, moduleId: string) => void;
  onDeleteLesson: (lesson: LessonSummary) => void;
  onDeleteModule: (module: ModuleWithLessons) => void;
}) {
  // Local order so a drag feels instant; the server is the authority and
  // the list resets to its answer when the course refetches.
  const [order, setOrder] = useState<LessonSummary[]>(module.lessons);
  useEffect(() => setOrder(module.lessons), [module.lessons]);

  const reorder = useReorderLessons(courseId);
  const updateLesson = useUpdateLesson(courseId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A few pixels of slop, so a click on the handle is not a drag.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commit = (next: LessonSummary[]) => {
    setOrder(next);
    reorder.mutate({ moduleId: module.id, lessonIds: next.map((lesson) => lesson.id) });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    commit(arrayMove(order, from, to));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((lesson) => lesson.id === active.id);
    const to = order.findIndex((lesson) => lesson.id === over.id);
    if (from === -1 || to === -1) return;
    commit(arrayMove(order, from, to));
  };

  const duration = order.reduce((sum, lesson) => sum + lesson.durationSeconds, 0);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="font-mono text-caption uppercase tracking-wide text-muted-foreground">
            Module {String(module.order).padStart(2, '0')}
          </span>
          <h2 className="text-heading-sm">{module.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">
            {order.length} lesson{order.length === 1 ? '' : 's'}
            {duration > 0 ? ` · ${formatDuration(duration)}` : ''}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Delete module ${module.title}`}
            className="text-destructive hover:bg-destructive-tint"
            onClick={() => onDeleteModule(module)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 pt-4">
        {order.length === 0 ? (
          <p className="py-4 text-center text-small text-muted-foreground">
            No lessons in this module yet.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={order.map((lesson) => lesson.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {order.map((lesson, index) => (
                  <SortableLesson
                    key={lesson.id}
                    lesson={lesson}
                    index={index}
                    total={order.length}
                    position={startNumber + index}
                    onMove={move}
                    onEdit={() => onEditLesson(lesson, module.id)}
                    onDelete={() => onDeleteLesson(lesson)}
                    onTogglePreview={(next) =>
                      updateLesson.mutate({
                        lessonId: lesson.id,
                        input: { isPreview: next },
                      })
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <Button
          variant="ghost"
          className="w-full border border-dashed border-primary/40 text-primary-hover hover:bg-primary-tint"
          onClick={() => onEditLesson(null, module.id)}
        >
          <Plus aria-hidden="true" />
          Add lesson to {module.title}
        </Button>
      </CardContent>
    </Card>
  );
}

export function ManageLessonsPage() {
  const { id } = useParams<{ id: string }>();
  const course = useInstructorCourse(id);
  const createModule = useCreateModule(id ?? '');
  const deleteModule = useDeleteModule();
  const deleteLesson = useDeleteLesson(id ?? '');

  const [editing, setEditing] = useState<
    { lesson: LessonSummary | null; moduleId: string } | null
  >(null);
  const [confirmLesson, setConfirmLesson] = useState<LessonSummary | null>(null);
  const [confirmModule, setConfirmModule] = useState<ModuleWithLessons | null>(null);
  const [newModule, setNewModule] = useState('');
  const [addingModule, setAddingModule] = useState(false);

  if (course.isPending) return <LoadingState label="Loading lessons" />;
  if (course.isError || !course.data) {
    return (
      <ErrorState
        title="Couldn't load this course"
        onRetry={() => void course.refetch()}
      />
    );
  }

  const data = course.data;
  const allLessons = data.modules.flatMap((module) => module.lessons);
  const needVideo = allLessons.filter((lesson) => lesson.durationSeconds === 0).length;
  const totalDuration = allLessons.reduce((sum, lesson) => sum + lesson.durationSeconds, 0);

  // Lesson numbers run across the whole course, as the artifact shows.
  let runningNumber = 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'My courses', to: '/instructor/courses' },
          { label: data.title, to: `/instructor/courses/${id}` },
          { label: 'Lessons' },
        ]}
        title="Manage lessons"
        description={`${data.title} · ${data.modules.length} module${
          data.modules.length === 1 ? '' : 's'
        } · ${allLessons.length} lesson${allLessons.length === 1 ? '' : 's'}${
          totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ''
        }${needVideo > 0 ? ` · ${needVideo} need a video` : ''}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={`/instructor/courses/${id}/preview`}>
                <Eye aria-hidden="true" />
                Preview course
              </Link>
            </Button>
            <Button onClick={() => setAddingModule(true)}>
              <Plus aria-hidden="true" />
              Add module
            </Button>
          </>
        }
      />

      <p className="flex items-start gap-2 rounded-lg bg-primary-tint px-4 py-3 text-small text-secondary-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary-hover" aria-hidden="true" />
        Drag lessons by the handle, or use the arrow buttons. With the keyboard, focus a
        handle and press space, then ↑ / ↓. The new order saves automatically.
      </p>

      {addingModule ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
                <label htmlFor="new-module" className="text-small font-semibold">
                Module title
              </label>
              <Input
                id="new-module"
                value={newModule}
                onChange={(event) => setNewModule(event.target.value)}
                placeholder="e.g. Metrics & traces"
                autoFocus
              />
            </div>
            <Button
              disabled={!newModule.trim() || createModule.isPending}
              onClick={() => {
                createModule.mutate(
                  { title: newModule.trim() },
                  {
                    onSuccess: () => {
                      setNewModule('');
                      setAddingModule(false);
                    },
                  },
                );
              }}
            >
              Add module
            </Button>
            <Button variant="ghost" onClick={() => setAddingModule(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {data.modules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-heading-sm">No modules yet</p>
            <p className="max-w-sm text-small text-secondary-foreground">
              Lessons live inside modules. Add your first module to start building the
              course.
            </p>
            <Button onClick={() => setAddingModule(true)}>
              <Plus aria-hidden="true" />
              Add module
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.modules.map((module) => {
            const start = runningNumber;
            runningNumber += module.lessons.length;
            return (
              <ModuleSection
                key={module.id}
                module={module}
                courseId={id!}
                startNumber={start}
                onEditLesson={(lesson, moduleId) => setEditing({ lesson, moduleId })}
                onDeleteLesson={setConfirmLesson}
                onDeleteModule={setConfirmModule}
              />
            );
          })}
        </div>
      )}

      {editing ? (
        <LessonDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          courseId={id!}
          courseTitle={data.title}
          moduleId={editing.moduleId}
          modules={data.modules}
          lesson={editing.lesson}
        />
      ) : null}

      <ConfirmDialog
        open={confirmLesson !== null}
        onOpenChange={(open) => !open && setConfirmLesson(null)}
        title={`Delete "${confirmLesson?.title ?? ''}"?`}
        description="Learners' progress on this lesson is deleted with it, and every enrolled learner's course progress is recalculated. This cannot be undone."
        confirmLabel="Delete lesson"
        destructive
        loading={deleteLesson.isPending}
        onConfirm={() => {
          if (!confirmLesson) return;
          deleteLesson.mutate(confirmLesson.id, {
            onSuccess: () => setConfirmLesson(null),
          });
        }}
      />

      <ConfirmDialog
        open={confirmModule !== null}
        onOpenChange={(open) => !open && setConfirmModule(null)}
        title={`Delete module "${confirmModule?.title ?? ''}"?`}
        description="Its lessons are deleted with it. A module whose lessons learners have already watched cannot be deleted — remove those lessons individually, or archive the course."
        confirmLabel="Delete module"
        destructive
        loading={deleteModule.isPending}
        onConfirm={() => {
          if (!confirmModule) return;
          deleteModule.mutate(confirmModule.id, {
            onSuccess: () => setConfirmModule(null),
          });
        }}
      />
    </div>
  );
}
