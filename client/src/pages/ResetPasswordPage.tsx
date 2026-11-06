import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { resetPasswordSchema, type ResetPasswordInput } from '@cadence/shared';
import { Button } from '@/components/ui/button';
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
import { ApiError } from '@/lib/api-client';
import { applyFieldErrors, useResetPassword } from '@/features/auth/auth.queries';
import { BackToSignIn } from './ForgotPasswordPage';

/**
 * Reset your password — step two: where the emailed link lands.
 *
 * The token travels in the query string and is submitted as part of the form,
 * never shown. It stays out of the rendered page entirely, so a screenshot or
 * a shoulder-glance cannot carry it off.
 *
 * On success the user is sent to sign in rather than straight into the app:
 * the server does not issue a session here, deliberately, so that recovering
 * an account still ends with the new password being typed.
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const resetPassword = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const token = searchParams.get('token') ?? '';

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const onSubmit = (values: ResetPasswordInput) => {
    setFormError(null);
    resetPassword.mutate(values, {
      onSuccess: () => {
        navigate('/login', {
          replace: true,
          state: { notice: 'Your password has been updated. Sign in with your new password.' },
        });
      },
      onError: (error) => {
        /*
         * A complaint about the token has no input to sit under — the token
         * is not something the user typed or can correct — so it is lifted
         * to the form-level message, which is also where the "request a new
         * link" escape hatch lives.
         */
        const tokenError =
          error instanceof ApiError ? error.fieldErrors?.token?.[0] : undefined;
        if (tokenError) {
          setFormError(tokenError);
          return;
        }
        setFormError(applyFieldErrors(error, form.setError));
      },
    });
  };

  // A link that arrived without its token cannot be repaired here, so the
  // page says so rather than presenting a form that is certain to fail.
  if (!token) {
    return (
      <>
        <BackToSignIn />
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-heading">This link is incomplete</h2>
            <p className="text-small text-secondary-foreground">
              The reset link is missing its token — some mail clients cut long links in half.
              Request a new one and open it directly from the email.
            </p>
          </div>
          <Button asChild className="w-full">
            <Link to="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <BackToSignIn />

      <div className="mb-6 flex flex-col gap-1">
        <h2 className="font-heading text-heading">Choose a new password</h2>
        <p className="text-small text-secondary-foreground">
          Signing in on your other devices will need the new password too.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          {formError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive-tint px-3.5 py-3 text-small text-destructive"
            >
              {formError}{' '}
              <Link to="/forgot-password" className="font-semibold underline underline-offset-2">
                Request a new link
              </Link>
            </p>
          ) : null}

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>New password</FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      className="pr-12"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <FormDescription>
                  At least 8 characters, with a letter and a number.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
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

          <Button type="submit" size="lg" loading={resetPassword.isPending} className="w-full">
            Set new password
          </Button>
        </form>
      </Form>
    </>
  );
}
