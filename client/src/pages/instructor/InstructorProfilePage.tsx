import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PauseCircle, Upload } from 'lucide-react';
import {
  BIOGRAPHY_MAX,
  BIOGRAPHY_MIN,
  formatDateTime,
  instructorProfileUpdateSchema,
  type InstructorProfileUpdateInput,
} from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { Input, Textarea } from '@/components/ui/input';
import { applyFieldErrors } from '@/features/auth/auth.queries';
import {
  useInstructorProfile,
  useUpdateInstructorProfile,
} from '@/features/instructor/instructor.queries';
import { uploadFile } from '@/features/uploads/upload';
import { cn } from '@/lib/utils';

/**
 * The instructor's public profile.
 *
 * Only display name, title, bio and photo: the things learners see on a
 * course page. Status is read-only here on purpose — suspension is an
 * admin action, and offering an instructor a control that would always be
 * refused would be worse than not offering it.
 */
export function InstructorProfilePage() {
  const { data, isPending, isError, refetch } = useInstructorProfile();
  const update = useUpdateInstructorProfile();

  const [formError, setFormError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<InstructorProfileUpdateInput>({
    resolver: zodResolver(instructorProfileUpdateSchema),
    defaultValues: { displayName: '', title: '', bio: '' },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      displayName: data.displayName,
      title: data.title,
      bio: data.bio,
    });
    setPhotoUrl(data.photoUrl);
  }, [data, form]);

  if (isPending) return <LoadingState label="Loading your instructor profile" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load your instructor profile"
        description="It is created when an application is approved."
        onRetry={() => void refetch()}
      />
    );
  }

  const onPhotoChosen = async (file: File) => {
    setPhotoBusy(true);
    try {
      const asset = await uploadFile({ file, kind: 'IMAGE', purpose: 'PROFILE_PHOTO' }).done;
      form.setValue('photoKey', asset.id, { shouldDirty: true });
      if (asset.url) setPhotoUrl(asset.url);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The photo could not be uploaded.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync(values);
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError));
    }
  });

  const bio = form.watch('bio');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Instructor profile"
        description="This is what learners see on your course pages."
      />

      {data.status === 'SUSPENDED' ? (
        <div
          role="status"
          className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-muted p-4"
        >
          <PauseCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="flex flex-wrap items-center gap-2 text-small font-semibold">
              Instructor access suspended
              <Badge variant="ink">Suspended</Badge>
            </p>
            {data.suspensionReason ? (
              <p className="mt-1 text-small text-secondary-foreground">
                {data.suspensionReason}
              </p>
            ) : null}
            <p className="mt-1 text-caption text-muted-foreground">
              Since {formatDateTime(data.suspendedAt)}. Your learning is unaffected.
            </p>
          </div>
        </div>
      ) : null}

      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-6">
          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive bg-destructive-tint px-4 py-3 text-small text-destructive"
            >
              {formError}
            </p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>How learners see you</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-4">
                <Avatar className="size-16">
                  {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
                  <AvatarFallback className="text-body">
                    {data.displayName
                      .split(' ')
                      .map((part) => part[0] ?? '')
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <input
                    ref={fileRef}
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
                    disabled={photoBusy || data.status === 'SUSPENDED'}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload aria-hidden="true" />
                    {photoBusy ? 'Uploading…' : photoUrl ? 'Replace photo' : 'Upload photo'}
                  </Button>
                  <p className="mt-1.5 text-caption text-muted-foreground">
                    JPG, PNG or WebP, up to 5 MB. Square photos look best.
                  </p>
                </div>
              </div>

              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={data.status === 'SUSPENDED'} />
                    </FormControl>
                    <FormDescription>
                      Shown as the author on every course you teach.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Professional title</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={data.status === 'SUSPENDED'} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-baseline justify-between gap-2">
                      <FormLabel>Biography</FormLabel>
                      <span
                        className={cn(
                          'font-mono text-caption tabular-nums',
                          (bio?.length ?? 0) > BIOGRAPHY_MAX
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                        )}
                      >
                        {bio?.length ?? 0} / {BIOGRAPHY_MAX}
                      </span>
                    </div>
                    <FormControl>
                      <Textarea {...field} rows={5} disabled={data.status === 'SUSPENDED'} />
                    </FormControl>
                    <FormDescription>
                      Write in the first person; {BIOGRAPHY_MIN}&ndash;{BIOGRAPHY_MAX}{' '}
                      characters.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="submit"
              disabled={update.isPending || data.status === 'SUSPENDED'}
            >
              {update.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
