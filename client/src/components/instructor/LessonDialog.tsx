import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { LessonSummary, ModuleWithLessons } from '@cadence/shared';
import { durationSecondsSchema } from '@cadence/shared';
import { VideoUploader, type VideoValue } from '@/components/instructor/VideoUploader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { applyFieldErrors } from '@/features/auth/auth.queries';
import {
  useCreateLesson,
  useUpdateLesson,
} from '@/features/instructor/instructor.queries';

/**
 * Create / Edit lesson — desktop artifact page 9.
 *
 * The form's own schema rather than the shared `lessonInputSchema`,
 * because the dialog's rules differ from the API's in one deliberate way:
 * **a lesson may be saved without a video.** The artifact says so
 * explicitly ("You can save now and add the video later"), and the
 * publish checklist is what stops such a lesson reaching a learner. The
 * server still applies its own schema; this one is only the browser's
 * first pass.
 */
const lessonFormSchema = z.object({
  title: z.string().trim().min(2, 'Give the lesson a title').max(140),
  description: z.string().trim().max(2000),
  moduleId: z.string().uuid(),
  isPreview: z.boolean(),
  /** Only meaningful for an external URL; an upload measures itself. */
  manualDuration: z.union([durationSecondsSchema, z.literal('')]).optional(),
});

type LessonFormValues = z.infer<typeof lessonFormSchema>;

export function LessonDialog({
  open,
  onOpenChange,
  courseId,
  courseTitle,
  moduleId,
  modules,
  lesson,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseTitle: string;
  moduleId: string;
  modules: ModuleWithLessons[];
  lesson: LessonSummary | null;
}) {
  const isEdit = lesson !== null;
  const createLesson = useCreateLesson(courseId);
  const updateLesson = useUpdateLesson(courseId);

  const [video, setVideo] = useState<VideoValue>({});
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LessonFormValues>({
    resolver: zodResolver(lessonFormSchema),
    defaultValues: {
      title: lesson?.title ?? '',
      description: lesson?.description ?? '',
      moduleId,
      isPreview: lesson?.isPreview ?? false,
      manualDuration: lesson?.durationSeconds ?? '',
    },
  });

  useEffect(() => {
    form.reset({
      title: lesson?.title ?? '',
      description: lesson?.description ?? '',
      moduleId,
      isPreview: lesson?.isPreview ?? false,
      manualDuration: lesson?.durationSeconds ?? '',
    });
    setVideo({});
    setFormError(null);
  }, [lesson, moduleId, form]);

  const currentModule = modules.find((module) => module.id === moduleId);
  const lessonNumber = currentModule
    ? currentModule.lessons.findIndex((item) => item.id === lesson?.id) + 1
    : 0;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    /*
     * The duration the server should store.
     *
     * An upload reports its own, measured by the server — that value wins
     * and the manual field is ignored, because completion is measured
     * against it and a typed number would be a guess. Manual entry is
     * only for external URLs, where there is genuinely nothing to measure.
     */
    const duration =
      video.durationSeconds ??
      (typeof values.manualDuration === 'number' ? values.manualDuration : undefined);

    try {
      if (isEdit) {
        await updateLesson.mutateAsync({
          lessonId: lesson.id,
          input: {
            title: values.title,
            description: values.description,
            isPreview: values.isPreview,
            ...(video.assetId !== undefined ? { videoAssetId: video.assetId } : {}),
            ...(video.url !== undefined ? { videoUrl: video.url } : {}),
            ...(duration !== undefined ? { durationSeconds: duration } : {}),
          },
        });
      } else {
        if (!video.assetId && !video.url && duration === undefined) {
          // A new lesson with no video at all still needs *a* duration for
          // the row; the publish checklist is what flags it as unplayable.
          setFormError(
            'Add a video or a duration. You can replace a placeholder duration once the video is uploaded.',
          );
          return;
        }
        await createLesson.mutateAsync({
          moduleId: values.moduleId,
          input: {
            title: values.title,
            description: values.description,
            isPreview: values.isPreview,
            videoUrl: video.url ?? '',
            ...(video.assetId ? { videoAssetId: video.assetId } : {}),
            durationSeconds: duration ?? 1,
          },
        });
      }
      onOpenChange(false);
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError));
    }
  });

  const pending = createLesson.isPending || updateLesson.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit lesson' : 'Add lesson'}</DialogTitle>
          <DialogDescription>
            {courseTitle}
            {currentModule
              ? ` · Module ${String(currentModule.order).padStart(2, '0')}`
              : ''}
            {isEdit && lessonNumber > 0
              ? ` · Lesson ${String(lessonNumber).padStart(2, '0')}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            {formError ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive bg-destructive-tint px-3 py-2 text-small text-destructive"
              >
                {formError}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lesson title</FormLabel>
                    <FormControl>
                      <Input {...field} autoFocus />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="moduleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Module</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      // Moving an existing lesson between modules would
                      // need a re-order on both sides; out of scope here.
                      disabled={isEdit}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {modules.map((module) => (
                          <SelectItem key={module.id} value={module.id}>
                            {String(module.order).padStart(2, '0')} · {module.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <VideoUploader
              courseId={courseId}
              value={video}
              onChange={setVideo}
              existingLabel={
                isEdit && lesson.videoKind !== 'NONE'
                  ? lesson.videoKind === 'UPLOAD'
                    ? 'This lesson already has an uploaded video.'
                    : 'This lesson already uses an external URL.'
                  : null
              }
            />

            {/* Manual duration, only where it is honest to offer it. */}
            {video.assetId ? null : (
              <FormField
                control={form.control}
                name="manualDuration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (seconds)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value === '' ? '' : String(field.value)}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value === '' ? '' : Number(event.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Needed for an external URL. An uploaded video measures its own
                      duration, which is what completion is checked against.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="isPreview"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg bg-muted p-3">
                  <div>
                    <FormLabel>Free preview</FormLabel>
                    <FormDescription>
                      Anyone can watch this lesson before enrolling.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter className="items-center gap-3 sm:justify-between">
              <p className="text-caption text-muted-foreground">
                You can save now and add the video later.
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Saving…' : 'Save lesson'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
