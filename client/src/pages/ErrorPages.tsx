import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ErrorState, ForbiddenState, NotFoundState } from '@/components/common/States';

/** /403 — reached when RoleRoute refuses a route. */
export function ForbiddenPage() {
  useEffect(() => {
    document.title = 'Admins only · Cadence';
  }, []);
  return (
    <div className="mx-auto w-full max-w-xl py-10">
      <ForbiddenState />
    </div>
  );
}

/** The catch-all route. */
export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found · Cadence';
  }, []);
  return (
    <div className="mx-auto w-full max-w-xl py-10">
      <NotFoundState />
    </div>
  );
}

/**
 * The router's error boundary: a render error or a loader failure lands here
 * instead of a blank page. It deliberately does not show a stack trace — the
 * detail goes to the console for a developer, not to the screen.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    // Surfaced rather than swallowed, so a real failure is diagnosable.
    console.error('Route error:', error);
  }, [error]);

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="mx-auto w-full max-w-xl py-10">
        <NotFoundState />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl py-10">
      <ErrorState
        title="Something went wrong"
        description="This page could not be displayed. Reloading usually clears it."
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}
