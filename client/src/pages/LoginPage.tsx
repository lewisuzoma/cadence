import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check, Eye, EyeOff } from 'lucide-react';
import { loginSchema, type LoginInput } from '@cadence/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
 * Sign in — desktop artifact page 2, mobile page 1.
 *
 * The surrounding split panel and the Sign in / Create account tabs live in
 * AuthLayout. This renders the card's contents: heading, the two fields with
 * a reveal toggle on the password, "keep me signed in", the action, and the
 * prototype shortcuts.
 *
 * Validation uses the same Zod schema the server validates with, so the
 * rules cannot drift, and a server-side failure is mapped back onto the form
 * rather than shown as a toast — the user needs it next to the field.
 */

/**
 * The seeded demo accounts, matching the README and the seed. The artifact
 * calls these "prototype shortcuts": they fill the form in rather than
 * signing in behind the reviewer's back, so what is about to be submitted
 * stays visible.
 */
const DEMO_ACCOUNTS = [
  { label: 'Demo learner', email: 'ada@cadence.dev' },
  { label: 'Demo admin', email: 'admin@cadence.dev' },
] as const;
const DEMO_PASSWORD = 'Password123';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  /*
   * A one-off message handed over by another screen — today, the reset flow
   * saying the password was changed. It is read once into state so that it
   * survives re-renders but does not come back if the user navigates away
   * and returns.
   */
  const [notice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
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
    <>
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="font-heading text-heading">Welcome back</h2>
        <p className="text-small text-secondary-foreground">Sign in to continue learning.</p>
      </div>

      {notice ? (
        <div
          role="status"
          className="mb-5 flex items-start gap-3 rounded-md bg-success-tint px-3.5 py-3 text-small text-foreground"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <p>{notice}</p>
        </div>
      ) : null}

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
                <div className="flex items-baseline justify-between gap-3">
                  <FormLabel>Password</FormLabel>
                  <Link
                    to="/forgot-password"
                    className="text-caption font-semibold text-primary underline underline-offset-2 hover:text-primary-hover"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-12"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    // Not a Button: it sits inside the input's box and must
                    // not inherit the 44px control height.
                    className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem className="flex-row items-center gap-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel className="font-normal text-secondary-foreground">
                  Keep me signed in for 30 days
                </FormLabel>
              </FormItem>
            )}
          />

          <Button type="submit" size="lg" loading={login.isPending} className="w-full">
            Sign in
          </Button>
        </form>
      </Form>

      {/* Prototype shortcuts */}
      <div className="mt-6 border-t border-border pt-5">
        <p className="mb-3 text-overline uppercase text-muted-foreground">Prototype shortcuts</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <Button
              key={account.email}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                form.setValue('email', account.email, { shouldValidate: true });
                form.setValue('password', DEMO_PASSWORD, { shouldValidate: true });
                setFormError(null);
              }}
            >
              {account.label}
              <ArrowRight aria-hidden="true" />
            </Button>
          ))}
        </div>
        <p className="mt-2 text-caption text-muted-foreground">
          Fills the seeded credentials in. Press Sign in to continue.
        </p>
      </div>
    </>
  );
}
