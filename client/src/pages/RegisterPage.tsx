import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { registerSchema, type RegisterInput } from '@cadence/shared';
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
import { applyFieldErrors, useRegister } from '@/features/auth/auth.queries';

/**
 * Create account — the other half of the artifact's tab pair. The split
 * panel and the tabs come from AuthLayout, so this is only the card body.
 *
 * Registration always creates a LEARNER: there is no role field here, and
 * the server ignores one if a request supplies it (covered by a test).
 */
export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const register = useRegister();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
    <>
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="font-heading text-heading">Create account</h2>
        <p className="text-small text-secondary-foreground">
          Start learning in under a minute.
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
    </>
  );
}
