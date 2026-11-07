import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import {
  setPermissionsChangedHandler,
  setUnauthenticatedHandler,
} from '@/lib/api-client';
import { clearAuthState, createQueryClient } from '@/lib/query-client';
import { qk } from '@/lib/query-keys';

/**
 * App-wide providers.
 *
 * The QueryClient is created inside state rather than at module scope, so a
 * test (or a fast refresh) gets a fresh cache instead of inheriting one.
 *
 * The api-client cannot import React, so it is handed a callback here: when a
 * refresh fails, every cached byte belonging to the signed-out user is dropped
 * before the redirect.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    setUnauthenticatedHandler(() => clearAuthState(queryClient));

    /*
     * The third of the three `me` refresh triggers (the others are window
     * focus and a new notification, both in `useLivePermissions`).
     *
     * When an instructor endpoint answers 401 or 403, the server disagrees
     * with what this UI believes about the user's permissions — almost
     * always because an admin approved or suspended them seconds ago.
     * Re-reading `me` is what turns that disagreement into a correct
     * screen rather than a dead button.
     */
    setPermissionsChangedHandler(() => {
      void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
      void queryClient.invalidateQueries({ queryKey: qk.applications.mine() });
    });
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* delayDuration: long enough not to flicker on a passing cursor. */}
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
