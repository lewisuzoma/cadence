import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Test render helpers.
 *
 * Each test gets its own QueryClient with retries off: a retry would make a
 * deliberately failing request take seconds and hide which attempt failed.
 *
 * Routing uses `MemoryRouter` + `Routes` rather than `createMemoryRouter`.
 * The data router drives every navigation through a `Request` carrying an
 * `AbortSignal`, and under jsdom that signal is a different class from the one
 * Node's fetch accepts ("Expected signal to be an instance of AbortSignal") —
 * so navigation silently never completes and the assertion fails for a reason
 * that has nothing to do with the component. `MemoryRouter` does not use that
 * machinery. The real data router is exercised by the production build and by
 * the server-side workflow tests.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

/** Renders a component that does not need routing. */
export function renderWithClient(
  ui: ReactElement,
  options?: RenderOptions & { client?: QueryClient },
) {
  const client = options?.client ?? createTestQueryClient();
  return {
    client,
    ...render(ui, {
      wrapper: ({ children }) => <Wrapper client={client}>{children}</Wrapper>,
      ...options,
    }),
  };
}

/**
 * Exposes the current path so a test can assert on navigation without
 * reaching into router internals.
 */
function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location" hidden>
      {`${location.pathname}${location.search}`}
    </span>
  );
}

/** Reads the path the probe last rendered. */
export function currentPath(): string {
  return document.querySelector('[data-testid="location"]')?.textContent ?? '';
}

export function renderWithRouter(
  ui: ReactElement,
  options?: {
    path?: string;
    initialEntries?: string[];
    client?: QueryClient;
    extraRoutes?: { path: string; element: ReactElement }[];
  },
) {
  const client = options?.client ?? createTestQueryClient();
  const path = options?.path ?? '/';

  return {
    client,
    currentPath,
    ...render(
      <Wrapper client={client}>
        <MemoryRouter initialEntries={options?.initialEntries ?? [path]}>
          <Routes>
            <Route path={path} element={ui} />
            {(options?.extraRoutes ?? []).map((route) => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))}
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </Wrapper>,
    ),
  };
}
