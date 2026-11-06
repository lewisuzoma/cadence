import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  User,
} from '@cadence/shared';
import { ApiError } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { authApi } from './auth.api';

/**
 * Auth state is server state: the session lives in httpOnly cookies and the
 * user record is a cached query. Nothing about the user is kept in
 * localStorage, so there is no stale copy to go out of sync with the cookie.
 */

export const meQueryOptions = () =>
  queryOptions({
    queryKey: qk.auth.me(),
    queryFn: authApi.me,
    // A 401 here is the normal signed-out answer, not a failure to retry.
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

export function useMe() {
  return useQuery(meQueryOptions());
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    // The form renders field-level errors itself.
    meta: { silent: true },
    onSuccess: (user: User) => {
      queryClient.setQueryData(qk.auth.me(), user);
      // Anything cached for a previous visitor must not leak into this session.
      void queryClient.invalidateQueries();
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => authApi.register(input),
    meta: { silent: true },
    onSuccess: (user: User) => {
      queryClient.setQueryData(qk.auth.me(), user);
      void queryClient.invalidateQueries();
    },
  });
}

/**
 * Requests a reset link.
 *
 * `silent` because the page shows the outcome in place — a toast would be the
 * wrong shape for a message the user needs to read and act on. There is no
 * cache to touch: nothing about the session has changed.
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => authApi.forgotPassword(input),
    meta: { silent: true },
  });
}

/**
 * Spends a reset link.
 *
 * The server deliberately does not sign the user in, so there is no user to
 * cache; the page sends them to /login afterwards. The cache is cleared all
 * the same, because the reset revoked every session — including any stale one
 * this tab was holding.
 */
export function useResetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => authApi.resetPassword(input),
    meta: { silent: true },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      // Clear on settle, not on success: if the request failed the cookies may
      // still be gone, and keeping a stale cache would show a phantom session.
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => authApi.updateProfile(input),
    meta: { silent: true },
    onSuccess: (user: User) => {
      queryClient.setQueryData(qk.auth.me(), user);
      toast.success('Profile updated');
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => authApi.changePassword(input),
    meta: { silent: true },
    onSuccess: (user: User) => {
      queryClient.setQueryData(qk.auth.me(), user);
      toast.success('Password updated', {
        description: 'Other devices have been signed out.',
      });
    },
  });
}

/**
 * Maps a server 400 back onto the form that produced it, so a validation
 * failure the browser could not catch still lands under the right input.
 *
 * Generic over the form's values so each caller keeps its own field names;
 * the cast is needed because the server's keys are strings at runtime and
 * cannot be proven to be paths of `T` at compile time.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fallbackField?: Path<T>,
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';

  if (error.fieldErrors) {
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const message = messages[0];
      if (message) setError(field as Path<T>, { type: 'server', message });
    }
    return null;
  }

  // No field detail (a 401 or 409, say): show it as a form-level message, or
  // attach it to the field the caller nominates.
  if (fallbackField) {
    setError(fallbackField, { type: 'server', message: error.message });
    return null;
  }
  return error.message;
}
