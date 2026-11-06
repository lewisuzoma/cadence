import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@cadence/shared';
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
import { applyFieldErrors, useRegister } from '@/features/auth/auth.queries';

/**
 * Create account. Reuses the sign-in card from the artifact's tab pair.
 *
 * Registration always creates a LEARNER: there is no role field here, and the
 * server ignores one if a request supplies it (covered by a test).
 */
export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const register = useRegister();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = (values: RegisterInput) => {
    setFormError(null);
    register.mutate(values, {
      onSuccess: () => {
        const next = searchParams.get('next');
        navigate(next && next.startsWith('/') ? next : '/dashboard', { replace: true });
      },
      onError: (error) => {
        // A duplicate email is a 409 with no field detail, so it is attached
        // to the email input where the user can act on it.
        setFormError(applyFieldErrors(error, form.setError, 'email'));
      },
    });
  };

  return (
    <div className="grid w-full max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
      <section className="hidden flex-col gap-5 lg:flex">
        <h1 className="text-display">Start learning in under a minute.</h1>
        <p className="max-w-lg text-body text-secondary-foreground">
          Enrol in a course and your progress, positions and completions are saved as you go, on
          every device you sign in on.
        </p>
      </section>

      <Card className="w-full max-w-md justify-self-center p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="font-heading text-heading">Create account</h2>
          <p className="text-small text-secondary-foreground">
            Already have one?{' '}
            <Link to="/login" className="font-semibold text-primary hover:text-primary-hover">
              Sign in
            </Link>
          </p>
        </div>

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

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
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
                control={form.control}
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

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Password</FormLabel>
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
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Confirm password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" size="lg" loading={register.isPending} className="w-full">
              Create account
            </Button>
          </form>
        </Form>
      </Card>
    </div>
  );
}
