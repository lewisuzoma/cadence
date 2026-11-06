import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Check } from 'lucide-react';
import {
  PASSWORD_RESET_TTL_MINUTES,
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from '@cadence/shared';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { applyFieldErrors, useForgotPassword } from '@/features/auth/auth.queries';

/**
 * Reset your password — step one, from the artifact.
 *
 * Two states in one card: the email form, and the confirmation that replaces
 * it on success. The back link and the heading persist across both, so the
 * card does not appear to become a different screen.
 *
 * The confirmation is deliberately conditional ("if an account exists"): the
 * server will not say whether the address is registered, and the copy must
 * not imply more than the server actually told us.
 */
export function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = (values: ForgotPasswordInput) => {
    setFormError(null);
    forgotPassword.mutate(values, {
      // The address is read back from the submitted values, not from the
      // response: the server never echoes it, by design.
      onSuccess: () => setSentTo(values.email),
      onError: (error) => setFormError(applyFieldErrors(error, form.setError)),
    });
  };

  return (
    <>
      <BackToSignIn />

      <div className="mb-6 flex flex-col gap-1">
        <h2 className="font-heading text-heading">Reset your password</h2>
        {sentTo ? null : (
          <p className="text-small text-secondary-foreground">
            Enter your account email and we&rsquo;ll send you a link to choose a new password.
          </p>
        )}
      </div>

      {sentTo ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md bg-success-tint px-3.5 py-3 text-small text-foreground"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <p>
            If an account exists for{' '}
            <span className="font-semibold text-primary">{sentTo}</span>, a reset link is on its
            way. It expires in {PASSWORD_RESET_TTL_MINUTES} minutes.
          </p>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
            {formError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive-tint px-3.5 py-3 text-small text-destructive"
              >
                {formError}
              </p>
            ) : null}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="ada@cadence.dev"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              size="lg"
              loading={forgotPassword.isPending}
              className="w-full"
            >
              Send reset link
            </Button>
          </form>
        </Form>
      )}
    </>
  );
}

/** Shared by both reset screens: the way back out of the flow. */
export function BackToSignIn() {
  return (
    <Link
      to="/login"
      className="mb-4 inline-flex items-center gap-1.5 text-caption font-semibold text-primary hover:text-primary-hover"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Back to sign in
    </Link>
  );
}
