import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { setUnauthenticatedHandler } from '@/lib/api-client';
import { clearAuthState, createQueryClient } from '@/lib/query-client';

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
