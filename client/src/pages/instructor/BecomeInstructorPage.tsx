import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, GraduationCap, Link2, Lock, Upload, User as UserIcon } from 'lucide-react';
import {
  BIOGRAPHY_MAX,
  BIOGRAPHY_MIN,
  EXPERIENCE_MAX,
  EXPERTISE_MAX,
  MOTIVATION_MAX,
  MOTIVATION_MIN,
  fullName,
  instructorApplicationInputSchema,
  type InstructorApplicationInput,
} from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { TagInput } from '@/components/instructor/TagInput';
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
import { Input, Textarea } from '@/components/ui/input';
import { applyFieldErrors, useMe } from '@/features/auth/auth.queries';
import { useApplyToTeach, useMyApplication } from '@/features/instructor/instructor.queries';
import { uploadFile } from '@/features/uploads/upload';
import { cn } from '@/lib/utils';

/**
 * "Teach on Cadence" — desktop artifact page 2, mobile board 2.
 *
 * Two columns on desktop: the form, and a sticky "What happens next"
 * explainer with the reassurance panel beneath it. One column on mobile.
 */

/** Where the draft is kept if the tab closes before submitting. */
const DRAFT_KEY = 'cadence:instructor-application-draft';

/** A live "128 / 1000" counter, as every long field in the artifact has. */
function CharacterCount({ value, max }: { value: string; max: number }) {
  const length = value.length;
  return (
    <span
      className={cn(
        'font-mono text-caption tabular-nums',
        length > max ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {length} / {max}
    </span>
  );
}

const STEPS = [
  {
    title: 'You apply',
    body: "Edit or withdraw any time while it's pending.",
  },
  {
    title: 'An admin reviews it',
    body: "You'll get a notification with the decision.",
  },
  {
    title: 'You start teaching',
    body: 'Switch to the Teaching workspace to create your first course.',
  },
];

export function BecomeInstructorPage() {
  const navigate = useNavigate();
  const { data: user } = useMe();
  const { data: application } = useMyApplication();
  const apply = useApplyToTeach();

  const [formError, setFormError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ key: string; name: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<InstructorApplicationInput>({
    resolver: zodResolver(instructorApplicationInputSchema),
    mode: 'onBlur',
    defaultValues: {
      professionalTitle: '',
      expertise: [],
      experience: '',
      biography: '',
      motivation: '',
      portfolioUrl: undefined,
      profilePhotoKey: undefined,
    },
  });

  /*
   * The draft is restored once, on mount.
   *
   * localStorage is the right home for this and only this: it is a
   * convenience for one person on one device, it is never the source of
   * truth for anything, and losing it costs nothing. The moment the
   * application is submitted it is cleared, because the server has it.
   */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<InstructorApplicationInput>;
      form.reset({ ...form.getValues(), ...parsed });
      setDraftSaved(true);
    } catch {
      // A corrupt or blocked store is simply an empty form.
    }
  }, [form]);

  // Saved on every change, debounced by the browser's own event cadence.
  useEffect(() => {
    const subscription = form.watch((values) => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
        setDraftSaved(true);
      } catch {
        // Private mode: the form still works, there is just no draft.
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Someone who already applied belongs on the status page.
  useEffect(() => {
    if (application && application.status !== 'NOT_APPLIED' && application.status !== 'REJECTED') {
      navigate('/instructor-application', { replace: true });
    }
  }, [application, navigate]);

  const onPhotoChosen = async (file: File) => {
    setPhotoBusy(true);
    try {
      const asset = await uploadFile({
        file,
        kind: 'IMAGE',
        purpose: 'PROFILE_PHOTO',
      }).done;
      setPhoto({ key: asset.id, name: asset.originalName ?? file.name });
      // The server stores the key; the form carries it through.
      form.setValue('profilePhotoKey', asset.id, { shouldDirty: true });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'The photo could not be uploaded.',
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apply.mutateAsync(values);
      localStorage.removeItem(DRAFT_KEY);
      navigate('/instructor-application', { replace: true });
    } catch (error) {
      // Field errors land on their inputs; anything else becomes a banner.
      // The draft is deliberately left intact either way.
      setFormError(applyFieldErrors(error, form.setError));
    }
  });

  const values = form.watch();

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        breadcrumbs={[
          { label: 'My learning', to: '/my-learning' },
          { label: 'Become an Instructor' },
        ]}
        title="Teach on Cadence"
        description="Tell us what you'd like to teach. An administrator reviews every application, usually within 3 business days. Becoming an instructor adds a Teaching workspace; your courses and progress as a learner stay exactly as they are."
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
            {formError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive bg-destructive-tint px-4 py-3 text-small text-destructive"
              >
                {formError}
              </div>
            ) : null}

            {/* --- About you ------------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>About you</CardTitle>
                <p className="text-caption text-muted-foreground">
                  Fields marked * are required.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    {/* A plain label, not `FormLabel`: these two are read
                        from the session and are not form fields at all —
                        `FormLabel` requires a `FormField` context that
                        deliberately does not exist here. */}
                    <label htmlFor="full-name" className="text-small font-semibold">
                      Full name
                    </label>
                    <div className="relative">
                      <Input
                        id="full-name"
                        value={user ? fullName(user) : ''}
                        readOnly
                        disabled
                        className="pr-9"
                      />
                      <Lock
                        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="email" className="text-small font-semibold">
                      Email
                    </label>
                    <div className="relative">
                      <Input
                        id="email"
                        value={user?.email ?? ''}
                        readOnly
                        disabled
                        className="pr-9"
                      />
                      <Lock
                        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
                <p className="-mt-2 text-caption text-muted-foreground">
                  From your account. To change them, edit your{' '}
                  <Link to="/profile" className="font-semibold text-primary-hover underline">
                    profile settings
                  </Link>
                  .
                </p>

                <FormField
                  control={form.control}
                  name="professionalTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Professional title *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Senior backend engineer" />
                      </FormControl>
                      <FormDescription>
                        How learners will see you, e.g. &ldquo;Product designer&rdquo; or
                        &ldquo;Data engineer&rdquo;.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expertise"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Areas of expertise *</FormLabel>
                        <span className="font-mono text-caption tabular-nums text-muted-foreground">
                          {field.value.length} / {EXPERTISE_MAX}
                        </span>
                      </div>
                      <FormControl>
                        <TagInput
                          value={field.value}
                          onChange={field.onChange}
                          max={EXPERTISE_MAX}
                          invalid={Boolean(fieldState.error)}
                        />
                      </FormControl>
                      <FormDescription>
                        Add 1&ndash;{EXPERTISE_MAX} topics you can teach. Press Enter or comma
                        to add; Backspace removes the last one.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="experience"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Teaching experience *</FormLabel>
                        <CharacterCount value={field.value} max={EXPERIENCE_MAX} />
                      </div>
                      <FormControl>
                        <Textarea {...field} rows={3} />
                      </FormControl>
                      <FormDescription>
                        Classes, workshops, mentoring, talks or written tutorials all count.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* --- Your instructor profile ----------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>Your instructor profile</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <FormField
                  control={form.control}
                  name="biography"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Short biography *</FormLabel>
                        <CharacterCount value={field.value} max={BIOGRAPHY_MAX} />
                      </div>
                      <FormControl>
                        <Textarea {...field} rows={4} />
                      </FormControl>
                      <FormDescription>
                        Shown on your course pages. Write in the first person;{' '}
                        {BIOGRAPHY_MIN}&ndash;{BIOGRAPHY_MAX} characters.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="motivation"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Why do you want to teach on Cadence? *</FormLabel>
                        <CharacterCount value={field.value} max={MOTIVATION_MAX} />
                      </div>
                      <FormControl>
                        <Textarea {...field} rows={3} />
                      </FormControl>
                      {/* The artifact's live helper: it counts down to the
                          minimum rather than only complaining after a blur. */}
                      {field.value.length > 0 && field.value.length < MOTIVATION_MIN ? (
                        <FormDescription className="text-destructive">
                          Tell us a bit more &mdash; at least {MOTIVATION_MIN} characters
                          (currently {field.value.length}). What would learners get from your
                          courses?
                        </FormDescription>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="photo" className="text-small font-semibold">
                    Profile photo (optional)
                  </label>
                  <div className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-border p-4">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="size-6" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-small font-semibold text-foreground">
                        {photo ? photo.name : "No photo yet — we'll show your initials."}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        JPG, PNG or WebP, up to 2 MB. Square photos look best.
                      </p>
                    </div>
                    <input
                      ref={fileRef}
                      id="photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void onPhotoChosen(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={photoBusy}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload aria-hidden="true" />
                      {photoBusy ? 'Uploading…' : photo ? 'Replace photo' : 'Upload photo'}
                    </Button>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="portfolioUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>LinkedIn or portfolio URL (optional)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Link2
                            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Input
                            {...field}
                            value={field.value ?? ''}
                            className="pl-9"
                            placeholder="https://"
                            inputMode="url"
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Must start with https://. Shown to admins during review only.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                {draftSaved ? (
                  <>
                    <Check className="size-3.5 text-success" aria-hidden="true" />
                    Draft saved on this device
                  </>
                ) : null}
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" asChild>
                  <Link to="/my-learning">Cancel</Link>
                </Button>
                <Button type="submit" disabled={apply.isPending}>
                  {apply.isPending ? 'Submitting…' : 'Submit application'}
                </Button>
              </div>
            </div>
          </form>
        </Form>

        {/* --- What happens next --------------------------------------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>What happens next</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                        index === 0
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-primary-tint text-primary-hover',
                      )}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-small font-semibold text-foreground">
                        {step.title}
                      </span>
                      <span className="block text-small text-secondary-foreground">
                        {step.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <div className="rounded-xl bg-primary-tint p-4">
            <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-primary-hover">
              <GraduationCap className="size-4" aria-hidden="true" />
              Your learning is safe
            </p>
            <p className="mt-2 text-small text-secondary-foreground">
              Approval adds instructor tools. Your{' '}
              {application?.enrolledCourseCount ?? 0} enrolled course
              {application?.enrolledCourseCount === 1 ? '' : 's'} and all your progress stay
              in My learning, and you can keep enrolling in other instructors&rsquo; courses.
            </p>
          </div>
        </aside>
      </div>

      <p className="sr-only" aria-live="polite">
        {values.expertise.length} areas of expertise added.
      </p>
    </div>
  );
}
