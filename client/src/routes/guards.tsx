import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { can, type Permission, type Role } from '@cadence/shared';
import { FullPageSpinner } from '@/components/common/FullPageSpinner';
import { SuspendedInstructorPage } from '@/pages/instructor/SuspendedInstructorPage';
import { useMe } from '@/features/auth/auth.queries';

/**
 * Route guards.
 *
 * These are a navigation convenience, not a security boundary: the server
 * refuses every unauthorised request regardless of what the client renders.
 * That is why `RoleRoute` shows a real 403 page rather than silently
 * redirecting — the user asked for something specific and deserves to know
 * they are not allowed it.
 */

/** Requires a session. Remembers where the user was going. */
export function ProtectedRoute() {
  const { data: user, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageSpinner label="Checking your session" />;

  if (isError || !user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <Outlet />;
}

/** Requires one of the given roles. Renders 403, never a redirect. */
export function RoleRoute({ allow }: { allow: Role[] }) {
  const { data: user, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageSpinner label="Checking your access" />;

  if (isError || !user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (!allow.includes(user.role)) {
    return <Navigate to="/403" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/**
 * Requires a capability rather than a role.
 *
 * This is what every new route uses. `RoleRoute` could express "admins
 * only", but it cannot express "an instructor, unless they are
 * suspended" — and a suspended instructor is precisely the case this
 * feature has to get right.
 *
 * A suspended instructor is shown the explanation page rather than a bare
 * 403: they have not done anything wrong by clicking the link, their
 * workspace genuinely used to be there, and the page tells them what
 * happened and what still works.
 *
 * As with every guard here, this is navigation, not security. The server
 * refuses the same requests independently.
 */
export function PermissionRoute({ require: permission }: { require: Permission }) {
  const { data: user, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageSpinner label="Checking your access" />;

  if (isError || !user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (can(user, permission)) return <Outlet />;

  // Held the permission but for the suspension: explain, don't just refuse.
  if (user.role === 'INSTRUCTOR' && user.instructorStatus === 'SUSPENDED') {
    return <SuspendedInstructorPage />;
  }

  return <Navigate to="/403" replace state={{ from: location.pathname }} />;
}

/**
 * For /login and /register: a signed-in visitor is sent on to where they were
 * headed, or to their own home — admins to the admin overview, learners to
 * their dashboard.
 */
export function GuestRoute() {
  const { data: user, isPending } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageSpinner label="Loading" />;

  if (user) {
    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    const home = user.role === 'ADMIN' ? '/admin' : '/dashboard';
    return <Navigate to={next && next.startsWith('/') ? next : home} replace />;
  }

  return <Outlet />;
}
