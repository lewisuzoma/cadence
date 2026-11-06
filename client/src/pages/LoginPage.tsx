import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@cadence/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { applyFieldErrors, useLogin } from '@/features/auth/auth.queries';

/**
 * Sign in.
 *
 * The artifact's layout: a value proposition on the left at desktop width, the
 * form card on the right, stacking to one column on mobile.
 *
 * Validation uses the SAME Zod schema the server validates with, so the rules
 * cannot drift. A server-side failure is mapped back onto the form rather than
 * shown as a toast, because the user needs it next to the field.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (values: LoginInput) => {
    setFormError(null);
    login.mutate(values, {
      onSuccess: (user) => {
        const next = searchParams.get('next');
        const home = user.role === 'ADMIN' ? '/admin' : '/dashboard';
        navigate(next && next.startsWith('/') ? next : home, { replace: true });
      },
      onError: (error) => {
        // Bad credentials have no field to attach to, so they surface above
        // the form; a 400 lands on the individual inputs.
        setFormError(applyFieldErrors(error, form.setError));
      },
    });
  };

  return (
    <div className="grid w-full max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
      <section className="hidden flex-col gap-5 lg:flex">
        <h1 className="text-display">Learn at your own pace. Pick up right where you left off.</h1>
        <p className="max-w-lg text-body text-secondary-foreground">
          Every lesson remembers your last position, so a ten-minute break never costs you ten
          minutes.
        </p>
      </section>

      <Card className="w-full max-w-md justify-self-center p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="font-heading text-heading">Welcome back</h2>
          <p className="text-small text-secondary-foreground">Sign in to continue learning.</p>
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

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" size="lg" loading={login.isPending} className="w-full">
              Sign in
            </Button>

            <p className="text-center text-small text-secondary-foreground">
              New here?{' '}
              <Link to="/register" className="font-semibold text-primary hover:text-primary-hover">
                Create an account
              </Link>
            </p>
          </form>
        </Form>
      </Card>
    </div>
  );
}
