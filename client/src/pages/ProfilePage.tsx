import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@cadence/shared';
import { PageHeader } from '@/components/common/PageHeader';
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
import { Input } from '@/components/ui/input';
import {
  applyFieldErrors,
  useChangePassword,
  useMe,
  useUpdateProfile,
} from '@/features/auth/auth.queries';
import { FullPageSpinner } from '@/components/common/FullPageSpinner';

/**
 * Profile and password.
 *
 * This is the admin nav's "Settings" destination, and the learner's account
 * page. Both forms are real: the profile form writes to `PATCH /auth/me`, and
 * the password form to `POST /auth/change-password`, which revokes every other
 * session server-side.
 */
export function ProfilePage() {
  const { data: user, isPending } = useMe();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    values: user ? { firstName: user.firstName, lastName: user.lastName } : undefined,
    defaultValues: { firstName: '', lastName: '' },
  });

  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', password: '', confirmPassword: '' },
  });

  if (isPending) return <FullPageSpinner label="Loading your profile" />;
  if (!user) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <PageHeader
        title="Profile"
        description="Your details and password."
        actions={<Badge variant={user.role === 'ADMIN' ? 'info' : 'secondary'}>{user.role}</Badge>}
      />

      <Card className="flex flex-col gap-5 p-6">
        <h2 className="font-heading text-heading-sm">Your details</h2>

        <Form {...profileForm}>
          <form
            onSubmit={profileForm.handleSubmit((values) =>
              updateProfile.mutate(values, {
                onError: (error) => applyFieldErrors(error, profileForm.setError),
              }),
            )}
            className="flex flex-col gap-5"
            noValidate
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={profileForm.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>First name</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={profileForm.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Last name</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <FormLabel asChild>
                <span className="text-small font-semibold">Email</span>
              </FormLabel>
              <Input value={user.email} readOnly disabled aria-describedby="email-hint" />
              <p id="email-hint" className="text-caption text-muted-foreground">
                Your email is the identity on your progress records, so it cannot be changed here.
              </p>
            </div>

            <div>
              <Button type="submit" loading={updateProfile.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </Form>
      </Card>

      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-heading-sm">Password</h2>
          <p className="text-small text-secondary-foreground">
            Changing your password signs you out everywhere else.
          </p>
        </div>

        <Form {...passwordForm}>
          <form
            onSubmit={passwordForm.handleSubmit((values) => {
              setPasswordError(null);
              changePassword.mutate(values, {
                onSuccess: () => passwordForm.reset(),
                onError: (error) => {
                  setPasswordError(
                    applyFieldErrors(error, passwordForm.setError, 'currentPassword'),
                  );
                },
              });
            })}
            className="flex flex-col gap-5"
            noValidate
          >
            {passwordError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive-tint px-3.5 py-3 text-small text-destructive"
              >
                {passwordError}
              </p>
            ) : null}

            <FormField
              control={passwordForm.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Current password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={passwordForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    At least 8 characters, with a letter and a number.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={passwordForm.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Confirm new password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <Button type="submit" loading={changePassword.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </Form>
      </Card>
    </div>
  );
}
