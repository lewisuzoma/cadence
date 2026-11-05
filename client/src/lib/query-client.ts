import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api-client';
import { qk } from './query-keys';

/**
 * One QueryClient for the app.
 *
 * Two deliberate choices:
 *  - retries skip client errors. Retrying a 403 or a 422 just delays the error
 *    the user needs to see; only 5xx and network failures are worth repeating.
 *  - mutation errors surface as a toast centrally, so no component has to
 *    remember to report a failure. A mutation can opt out with
 *    `meta: { silent: true }` when it renders its own inline error (forms do).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.isClientError) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Background refetch failures are not worth interrupting anyone over;
        // the component's ErrorState handles the first load.
        if (query.state.data !== undefined && error instanceof ApiError && error.status >= 500) {
          toast.error('Could not refresh', { description: error.message });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent) return;
        if (error instanceof ApiError) {
          // A 401 is already handled by the api-client (refresh then redirect).
          if (error.status === 401) return;
          toast.error(error.message);
          return;
        }
        toast.error('Something went wrong. Please try again.');
      },
    }),
  });
}

/**
 * Called by the api-client when a refresh fails: drop every cached byte of the
 * signed-out user before the redirect, so nothing of theirs can be rendered.
 */
export function clearAuthState(queryClient: QueryClient): void {
  queryClient.setQueryData(qk.auth.me(), null);
  queryClient.clear();
}
