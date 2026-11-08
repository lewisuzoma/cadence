import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Plus,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {
  DIFFICULTIES,
  courseInputSchema,
  formatDateTime,
  formatDuration,
  type CourseInput,
  type Difficulty,
  type PublishChecklist,
} from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { applyFieldErrors } from '@/features/auth/auth.queries';
import { useCourseCategories } from '@/features/courses/courses.queries';
import {
  useCourseDraftState,
  useCourseStatus,
  useCreateCourse,
  useInstructorCourse,
  usePublishChecklist,
  useUpdateCourse,
} from '@/features/instructor/instructor.queries';
import { uploadFile } from '@/features/uploads/upload';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Create / Edit course — desktop artifact page 7, mobile board 6.
 *
 * One component for both, because the fields and the rules are identical
 * and the only difference is whether there is an id yet. The publish
 * readiness panel is the server's checklist rendered verbatim: the client
 * does not re-derive any of those rules, so there is no way for the two to
 * disagree about whether a course can go live.
 */

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
};

function CharacterCount({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={cn(
        'font-mono text-caption tabular-nums',
        value.length > max ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {value.length} / {max}
    </span>
  );
}

/** A small repeated-text-field list: objectives and prerequisites. */
function ListField({
  label,
  values,
  onChange,
  max,
  placeholder,
  description,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder: string;
  description: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const entry = draft.trim();
    if (!entry || values.length >= max) return;
    onChange([...values, entry]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <FormLabel>{label}</FormLabel>
        <span className="font-mono text-caption tabular-nums text-muted-foreground">
          {values.length} / {max}
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {values.map((entry, index) => (
          <li key={`${entry}-${index}`} className="flex items-center gap-2">
            <span className="flex flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-small">
              <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
              {entry}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove "${entry}"`}
              onClick={() => onChange(values.filter((_, position) => position !== index))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Must not submit the whole form.
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          disabled={values.length >= max}
          aria-label={`Add to ${label.toLowerCase()}`}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <FormDescription>{description}</FormDescription>
    </div>
  );
}

/** The server's checklist, rendered as the artifact's readiness panel. */
function ReadinessPanel({
  checklist,
  courseId,
  onPublish,
  publishing,
  isLive,
  hasUnpublishedChanges,
}: {
  checklist: PublishChecklist;
  courseId: string;
  onPublish: () => void;
  publishing: boolean;
  /** True once the course has been published at least once. */
  isLive: boolean;
  hasUnpublishedChanges: boolean;
}) {
  const outstanding = checklist.total - checklist.passing;
  // A live course with nothing pending has nothing to publish, and a
  // button that would be a no-op is worse than a disabled one.
  const nothingToPublish = isLive && !hasUnpublishedChanges;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Publish readiness</CardTitle>
        <span className="font-mono text-caption text-muted-foreground">
          {checklist.passing} of {checklist.total} passing
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress
          value={(checklist.passing / checklist.total) * 100}
          tone={checklist.canPublish ? 'success' : 'warning'}
          label={`${checklist.passing} of ${checklist.total} publishing checks passing`}
        />

        <ul className="flex flex-col gap-2.5">
          {checklist.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2 text-small">
              {check.passed ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-hidden="true"
                />
              ) : (
                <XCircle
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0">
                <span
                  className={cn(
                    'block',
                    check.passed
                      ? 'text-secondary-foreground'
                      : 'font-semibold text-destructive',
                  )}
                >
                  {check.label}
                </span>
                {!check.passed && check.detail ? (
                  <span className="block text-caption text-muted-foreground">
                    {check.detail}
                    {check.lessonIds && check.lessonIds.length > 0 ? (
                      <>
                        {' — '}
                        <Link
                          to={`/instructor/courses/${courseId}/lessons`}
                          className="font-semibold text-primary-hover underline"
                        >
                          Manage lessons
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          onClick={onPublish}
          disabled={!checklist.canPublish || publishing || nothingToPublish}
          className="w-full"
        >
          {publishing
            ? 'Publishing…'
            : !checklist.canPublish
              ? `Publish course · ${outstanding} to fix`
              : nothingToPublish
                ? 'Everything is published'
                : isLive
                  ? 'Publish changes'
                  : 'Publish course'}
        </Button>
        <p className="text-caption text-muted-foreground">
          {isLive
            ? 'Learners keep seeing the published version until you publish again.'
            : 'Drafts are only visible to you and admins.'}
        </p>
      </CardContent>
    </Card>
  );
}

export function CourseFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const course = useInstructorCourse(id);
  const checklist = usePublishChecklist(id);
  const draftState = useCourseDraftState(id);
  const categories = useCourseCategories();
  const create = useCreateCourse();
  const update = useUpdateCourse(id ?? '');
  const status = useCourseStatus(id ?? '');

  const [formError, setFormError] = useState<string | null>(null);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<CourseInput>({
    resolver: zodResolver(courseInputSchema),
    mode: 'onBlur',
    defaultValues: {
      title: '',
      description: '',
      shortDescription: '',
      category: '',
      thumbnailUrl: '',
      difficulty: 'BEGINNER',
      learningObjectives: [],
      prerequisites: [],
      targetAudience: '',
    },
  });

  // Fill the form once the course arrives.
  useEffect(() => {
    if (!course.data) return;
    form.reset({
      title: course.data.title,
      description: course.data.description,
      shortDescription: course.data.shortDescription,
      category: course.data.category,
      thumbnailUrl: course.data.thumbnailUrl,
      difficulty: course.data.difficulty,
      learningObjectives: course.data.learningObjectives,
      prerequisites: course.data.prerequisites,
      targetAudience: course.data.targetAudience,
    });
  }, [course.data, form]);

  const onThumbnailChosen = async (file: File) => {
    setThumbBusy(true);
    try {
      const asset = await uploadFile({
        file,
        kind: 'IMAGE',
        purpose: 'COURSE_THUMBNAIL',
        ...(id ? { courseId: id } : {}),
      }).done;
      if (asset.url) {
        form.setValue('thumbnailUrl', asset.url, { shouldDirty: true });
        form.setValue('thumbnailAssetId', asset.id, { shouldDirty: true });
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'The image could not be uploaded.',
      );
    } finally {
      setThumbBusy(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (isEdit) {
        await update.mutateAsync(values);
        setSavedAt(new Date().toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }));
      } else {
        const created = await create.mutateAsync(values);
        navigate(`/instructor/courses/${created.id}`, { replace: true });
      }
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError));
    }
  });

  const onPublish = () => {
    status.mutate(
      { action: 'publish', ...(summary.trim() ? { changeSummary: summary.trim() } : {}) },
      {
        onSuccess: () => {
          setPublishOpen(false);
          setSummary('');
        },
        onError: (error) => {
          // The 422 carries the whole checklist; refetching renders it.
          void checklist.refetch();
          setFormError(
            error instanceof ApiError
              ? error.message
              : 'The course could not be published.',
          );
        },
      },
    );
  };

  if (isEdit && course.isPending) return <LoadingState label="Loading the course" />;
  if (isEdit && course.isError) {
    return (
      <ErrorState
        title="Couldn't load this course"
        description="It may have been deleted, or it may belong to someone else."
        onRetry={() => void course.refetch()}
      />
    );
  }

  const values = form.watch();
  const derivedDuration = course.data?.estimatedDuration ?? 0;
  const lessonsWithVideo = (course.data?.modules ?? [])
    .flatMap((module) => module.lessons)
    .filter((lesson) => lesson.durationSeconds > 0).length;
  const totalLessons = course.data?.lessonCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'My courses', to: '/instructor/courses' },
          { label: isEdit ? 'Edit course' : 'Create course' },
        ]}
        title={isEdit ? (course.data?.title ?? 'Edit course') : 'Create course'}
        description={
          isEdit ? undefined : 'Courses start as private drafts, visible only to you and admins.'
        }
        actions={
          isEdit && course.data ? (
            <>
              <Badge
                variant={
                  course.data.status === 'PUBLISHED'
                    ? 'ink'
                    : course.data.status === 'DRAFT'
                      ? 'outline'
                      : 'secondary'
                }
              >
                {course.data.status.charAt(0) + course.data.status.slice(1).toLowerCase()}
              </Badge>
              <Button asChild variant="outline">
                <Link to={`/instructor/courses/${id}/lessons`}>
                  Lessons · {totalLessons}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={`/instructor/courses/${id}/preview`}>
                  <Eye aria-hidden="true" />
                  Preview
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      {/* The one thing an instructor editing a live course needs to know:
          what they are looking at is not what their learners are. */}
      {isEdit && draftState.data?.hasUnpublishedChanges ? (
        <div
          role="status"
          className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning-tint px-4 py-3"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-small font-semibold text-foreground">
              You have unpublished changes
            </p>
            <p className="text-small text-secondary-foreground">
              Learners still see{' '}
              {draftState.data.liveVersion
                ? `version ${draftState.data.liveVersion}`
                : 'the published version'}
              . These changes go live when you publish:
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {draftState.data.pendingChanges.slice(0, 6).map((change) => (
                <li key={`${change.kind}-${change.field}`}>
                  <Badge variant="secondary">{change.label}</Badge>
                </li>
              ))}
              {draftState.data.pendingChanges.length > 6 ? (
                <li>
                  <Badge variant="outline">
                    +{draftState.data.pendingChanges.length - 6} more
                  </Badge>
                </li>
              ) : null}
            </ul>
          </div>
          <Button
            size="sm"
            disabled={!checklist.data?.canPublish || status.isPending}
            onClick={() => setPublishOpen(true)}
          >
            Publish changes
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
            {formError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-tint px-4 py-3 text-small text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {formError}
              </div>
            ) : null}

            {/* --- Basics ---------------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>Basics</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Title</FormLabel>
                        <CharacterCount value={field.value} max={120} />
                      </div>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormDescription>
                        Clear and specific. Learners search by these words.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="shortDescription"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Short description</FormLabel>
                        <CharacterCount value={field.value ?? ''} max={160} />
                      </div>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormDescription>
                        One sentence shown on course cards and in search results.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Full description</FormLabel>
                        <CharacterCount value={field.value} max={4000} />
                      </div>
                      <FormControl>
                        <Textarea {...field} rows={6} />
                      </FormControl>
                      <FormDescription>
                        Shown on the course page. At least 80 characters.
                      </FormDescription>
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
                        <FormLabel>Category</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(categories.data ?? []).map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="difficulty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Difficulty</FormLabel>
                        <FormControl>
                          <div
                            className="flex gap-1 rounded-lg bg-muted p-1"
                            role="radiogroup"
                            aria-label="Difficulty"
                          >
                            {DIFFICULTIES.map((level) => (
                              <button
                                key={level}
                                type="button"
                                role="radio"
                                aria-checked={field.value === level}
                                onClick={() => field.onChange(level)}
                                className={cn(
                                  'min-h-10 flex-1 rounded-md px-2 text-small font-semibold transition-colors max-sm:min-h-11',
                                  field.value === level
                                    ? 'bg-card text-foreground shadow-sm'
                                    : 'text-secondary-foreground hover:text-foreground',
                                )}
                              >
                                {DIFFICULTY_LABELS[level]}
                              </button>
                            ))}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Derived, and labelled as such — there is deliberately no
                    second, editable duration to drift from the lessons. */}
                {isEdit ? (
                  <div className="flex flex-col gap-1.5">
                    {/* Derived, not editable, so not a form field. */}
                    <p className="text-small font-semibold">Estimated duration</p>
                    <p className="flex flex-wrap items-baseline gap-2 rounded-lg bg-muted px-3 py-2.5">
                      <span className="font-mono text-small font-semibold text-foreground">
                        {derivedDuration > 0 ? formatDuration(derivedDuration) : '—'}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        Derived from lesson videos · {lessonsWithVideo} of {totalLessons}{' '}
                        lesson{totalLessons === 1 ? '' : 's'} have one
                      </span>
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* --- Thumbnail -------------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>Thumbnail</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-start gap-4">
                <div className="relative aspect-video w-56 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {values.thumbnailUrl ? (
                    <img
                      src={values.thumbnailUrl}
                      alt="Course thumbnail preview"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-caption text-muted-foreground">
                      16:9 preview
                    </span>
                  )}
                </div>

                <div className="flex min-w-48 flex-1 flex-col gap-3">
                  <p className="text-caption text-muted-foreground">
                    JPG, PNG or WebP · up to 5 MB · at least 1280 × 720.
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onThumbnailChosen(file);
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={thumbBusy}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload aria-hidden="true" />
                      {thumbBusy
                        ? 'Uploading…'
                        : values.thumbnailUrl
                          ? 'Replace image'
                          : 'Upload image'}
                    </Button>
                    {values.thumbnailUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive-tint"
                        onClick={() => {
                          form.setValue('thumbnailUrl', '', { shouldDirty: true });
                          form.setValue('thumbnailAssetId', null, { shouldDirty: true });
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        Remove
                      </Button>
                    ) : null}
                  </div>

                  <FormField
                    control={form.control}
                    name="thumbnailUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-caption">Or paste an image URL</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="/thumbnails/example.svg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* --- Who it's for ----------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>Who it&rsquo;s for &amp; what they&rsquo;ll learn</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <FormField
                  control={form.control}
                  name="learningObjectives"
                  render={({ field }) => (
                    <FormItem>
                      <ListField
                        label="Learning objectives"
                        values={field.value ?? []}
                        onChange={field.onChange}
                        max={10}
                        placeholder="e.g. Write a runbook for an alert"
                        description="What learners can do after the course. Start with a verb. Up to 10."
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prerequisites"
                  render={({ field }) => (
                    <FormItem>
                      <ListField
                        label="Prerequisites"
                        values={field.value ?? []}
                        onChange={field.onChange}
                        max={8}
                        placeholder="e.g. Basic SQL"
                        description="What learners should know first. Up to 8."
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetAudience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target audience</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value ?? ''} rows={3} />
                      </FormControl>
                      <FormDescription>
                        Who will get the most out of this course, and who it&rsquo;s not for.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </form>
        </Form>

        {/* --- the side rail ----------------------------------------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          {isEdit && checklist.data ? (
            <ReadinessPanel
              checklist={checklist.data}
              courseId={id!}
              onPublish={() => setPublishOpen(true)}
              publishing={status.isPending}
              isLive={draftState.data?.liveVersion !== null && draftState.data !== undefined}
              hasUnpublishedChanges={draftState.data?.hasUnpublishedChanges ?? false}
            />
          ) : null}

          {isEdit && draftState.data && draftState.data.history.length > 0 ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle>Version history</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHistoryOpen((open) => !open)}
                  aria-expanded={historyOpen}
                >
                  {historyOpen ? 'Hide' : 'Show'}
                </Button>
              </CardHeader>
              {historyOpen ? (
                <CardContent>
                  <ol className="flex flex-col gap-3">
                    {draftState.data.history.map((entry) => (
                      <li key={entry.id} className="flex gap-3">
                        <span
                          className={cn(
                            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-caption font-semibold',
                            entry.isLive
                              ? 'bg-success-tint text-success'
                              : 'bg-muted text-muted-foreground',
                          )}
                          aria-hidden="true"
                        >
                          v{entry.version}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 text-small font-semibold">
                            {entry.title}
                            {entry.isLive ? <Badge variant="success">Live</Badge> : null}
                          </span>
                          <span className="block text-caption text-muted-foreground">
                            {entry.lessonCount} lesson
                            {entry.lessonCount === 1 ? '' : 's'} ·{' '}
                            {formatDateTime(entry.publishedAt)} · {entry.publishedBy}
                          </span>
                          {entry.changeSummary ? (
                            <span className="block text-caption text-secondary-foreground">
                              {entry.changeSummary}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {savedAt ? (
                <p className="text-caption text-muted-foreground">Draft saved {savedAt}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {isEdit ? (
                  <Button asChild variant="outline" className="flex-1">
                    <Link to={`/instructor/courses/${id}/preview`}>Preview</Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => void onSubmit()}
                  disabled={create.isPending || update.isPending}
                >
                  {create.isPending || update.isPending
                    ? 'Saving…'
                    : isEdit
                      ? 'Save draft'
                      : 'Create course'}
                </Button>
              </div>
              {isEdit ? (
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/instructor/courses/${id}/lessons`}>
                    <Plus aria-hidden="true" />
                    Add lessons
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* --- publish ------------------------------------------------- */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draftState.data?.liveVersion
                ? `Publish version ${draftState.data.liveVersion + 1}?`
                : 'Publish this course?'}
            </DialogTitle>
            <DialogDescription>
              {draftState.data?.liveVersion
                ? 'Your changes replace what learners currently see. Anyone already enrolled keeps their progress.'
                : 'The course appears in the catalog and learners can enroll.'}
            </DialogDescription>
          </DialogHeader>

          {draftState.data && draftState.data.pendingChanges.length > 0 ? (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                What changes
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {draftState.data.pendingChanges.map((change) => (
                  <li
                    key={`${change.kind}-${change.field}`}
                    className="text-small text-secondary-foreground"
                  >
                    {change.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="change-summary" className="text-small font-semibold">
              What changed? (optional)
            </label>
            <Textarea
              id="change-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              placeholder="e.g. Rewrote the tracing lesson and fixed two durations"
            />
            <p className="text-caption text-muted-foreground">
              Kept with this version so you can tell your releases apart later.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onPublish} disabled={status.isPending}>
              {status.isPending
                ? 'Publishing…'
                : draftState.data?.liveVersion
                  ? 'Publish changes'
                  : 'Publish course'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
