import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
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
 */
export function applyFieldErrors(
  error: unknown,
  setError: (field: string, error: { type: string; message: string }) => void,
  fallbackField?: string,
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';

  if (error.fieldErrors) {
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const message = messages[0];
      if (message) setError(field, { type: 'server', message });
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
