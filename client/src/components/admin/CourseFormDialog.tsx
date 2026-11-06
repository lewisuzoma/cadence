import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  DIFFICULTIES,
  courseInputSchema,
  type CourseInput,
  type CourseSummary,
} from '@cadence/shared';
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
import { applyFieldErrors } from '@/features/auth/auth.queries';
import { useCreateCourse, useUpdateCourse } from '@/features/courses/courses.queries';

/**
 * Create / edit course.
 *
 * One dialog for both, because the fields are identical — only the mutation
 * differs. Validation is the shared `courseInputSchema`, the same object the
 * server parses the request body with, and a server-side field error is mapped
 * back onto the matching input.
 *
 * The thumbnail field shows a live preview, as the artifact's editor does.
 */
export function CourseFormDialog({
  open,
  onOpenChange,
  course,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when creating. */
  course?: CourseSummary;
}) {
  const createCourse = useCreateCourse();
  const updateCourse = useUpdateCourse(course?.id ?? '');
  const isEditing = Boolean(course);
  const pending = createCourse.isPending || updateCourse.isPending;

  const form = useForm<CourseInput>({
    resolver: zodResolver(courseInputSchema),
    defaultValues: {
      title: '',
      description: '',
      category: '',
      thumbnailUrl: '/thumbnails/typescript-for-production-apis.svg',
      difficulty: 'BEGINNER',
    },
  });

  // Load the course being edited, and clear the form when the dialog closes
  // so creating after editing does not inherit the previous values.
  useEffect(() => {
    if (!open) return;
    if (course) {
      form.reset({
        title: course.title,
        description: course.description,
        category: course.category,
        thumbnailUrl: course.thumbnailUrl,
        difficulty: course.difficulty,
      });
    } else {
      form.reset({
        title: '',
        description: '',
        category: '',
        thumbnailUrl: '/thumbnails/typescript-for-production-apis.svg',
        difficulty: 'BEGINNER',
      });
    }
  }, [course, form, open]);

  const thumbnail = form.watch('thumbnailUrl');
  const description = form.watch('description') ?? '';

  const onSubmit = (values: CourseInput) => {
    const handlers = {
      onSuccess: () => onOpenChange(false),
      onError: (error: unknown) => applyFieldErrors(error, form.setError),
    };
    if (course) {
      updateCourse.mutate(values, handlers);
    } else {
      createCourse.mutate(values, handlers);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit course' : 'New course'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Changes are saved immediately. Publishing is a separate action.'
              : 'A new course starts as a draft. Add lessons before publishing it.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="TypeScript for Production APIs" {...field} />
                  </FormControl>
                  <FormDescription>Use 3 to 140 characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="What will a learner be able to do after this course?"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{description.length} / 5000 characters</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Category</FormLabel>
                    <FormControl>
                      <Input placeholder="Engineering" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="difficulty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Level</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DIFFICULTIES.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option.charAt(0) + option.slice(1).toLowerCase()}
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
              name="thumbnailUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Thumbnail</FormLabel>
                  <FormControl>
                    <Input placeholder="/thumbnails/my-course.svg" {...field} />
                  </FormControl>
                  <FormDescription>
                    A path served by the app, or an absolute https URL.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Live preview, as the artifact's editor shows. */}
            {thumbnail ? (
              <div className="flex flex-col gap-2">
                <p className="text-overline uppercase text-muted-foreground">Catalog preview</p>
                <div className="w-full max-w-xs overflow-hidden rounded-md border border-border">
                  <img
                    src={thumbnail}
                    alt=""
                    className="aspect-video w-full bg-muted object-cover"
                    onError={(event) => {
                      // A bad path should look wrong, not break the layout.
                      event.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                {isEditing ? 'Save changes' : 'Create course'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
