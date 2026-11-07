import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  Clock,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  PauseCircle,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { can, canApplyToTeach, initials, fullName } from '@cadence/shared';
import { Wordmark } from '@/components/common/Brand';
import { NotificationBell } from '@/components/instructor/NotificationBell';
import { WorkspaceSwitcher } from '@/components/instructor/WorkspaceSwitcher';
import { MobileTabBar, MobileTabBarSpacer } from '@/components/layout/MobileTabBar';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useLogout, useMe } from '@/features/auth/auth.queries';
import {
  useAdminApplications,
  useMyApplication,
} from '@/features/instructor/instructor.queries';
import { useNotifications, useLivePermissions } from '@/features/notifications/notifications.queries';
import { cn } from '@/lib/utils';

/**
 * The learner shell.
 *
 * Desktop (artifact pages 3–7): a 68px top bar with the mark, pill nav where
 * the active item sits on a cobalt tint, and the avatar menu on the right.
 *
 * Phone (artifact pages 9–10, the "app" screens): the same top bar minus the
 * nav, with a fixed bottom tab bar instead. No hamburger — the tab bar is the
 * navigation, which is what makes those screens read as an app.
 */
const LEARNER_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/courses', label: 'Catalog', icon: BookOpen },
  { to: '/my-learning', label: 'My learning', icon: GraduationCap },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 items-center gap-2 rounded-pill px-3.5 text-small font-semibold transition-colors',
    isActive
      ? 'bg-primary-tint text-primary-hover'
      : 'text-secondary-foreground hover:bg-muted hover:text-foreground',
  );
}

/**
 * The avatar menu, in the four account states from desktop artifact page 4
 * and mobile board 4.
 *
 * Which state is shown is derived from `me` and the application status —
 * never stored — so an approval that lands while the user is sitting on
 * the page changes this menu on the next `me` refetch without a reload.
 */
export function UserMenu() {
  const { data: user } = useMe();
  const logout = useLogout();
  // The status query is only meaningful for a signed-in user, and only a
  // learner can have a pending application to report.
  const { data: application } = useMyApplication(Boolean(user));

  if (!user) return null;

  const pending = application?.status === 'PENDING';
  const suspended = user.instructorStatus === 'SUSPENDED';
  const teaches = can(user, 'instructor:dashboard');
  const canApply = canApplyToTeach(user, pending);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-pill transition-colors hover:bg-muted"
          aria-label={`Account menu for ${fullName(user)}`}
        >
          <Avatar>
            <AvatarFallback>{initials(user)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <span className="block normal-case tracking-normal">
            <span className="block text-small font-semibold text-foreground">
              {fullName(user)}
            </span>
            <span className="block text-caption font-normal text-muted-foreground">
              {user.email}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              <Badge variant="secondary">Learner</Badge>
              {suspended ? (
                <Badge variant="ink">
                  <PauseCircle aria-hidden="true" />
                  Instructor suspended
                </Badge>
              ) : teaches ? (
                <Badge variant="info">Instructor</Badge>
              ) : null}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* --- the state-dependent entry ---------------------------------
            Exactly one of these four appears, and which one is a function
            of the data rather than of anything remembered. */}
        {canApply ? (
          <DropdownMenuItem asChild>
            <Link to="/become-an-instructor" className="text-primary-hover">
              <GraduationCap aria-hidden="true" />
              Become an Instructor
            </Link>
          </DropdownMenuItem>
        ) : null}

        {pending ? (
          <DropdownMenuItem asChild>
            <Link to="/instructor-application">
              <Clock aria-hidden="true" className="text-warning" />
              <span className="flex-1">Application pending</span>
              <Badge variant="warning">In review</Badge>
            </Link>
          </DropdownMenuItem>
        ) : null}

        {suspended ? (
          <DropdownMenuItem asChild>
            <Link to="/instructor-application">
              <PauseCircle aria-hidden="true" />
              Why is teaching paused?
            </Link>
          </DropdownMenuItem>
        ) : null}

        {teaches ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/instructor">
                <GraduationCap aria-hidden="true" />
                Switch to Teaching
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/instructor/profile">
                <Users aria-hidden="true" />
                Instructor profile
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuItem asChild>
          <Link to="/my-learning">
            <BookOpen aria-hidden="true" />
            My learning
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link to="/profile">
            <Settings aria-hidden="true" />
            Profile and password
          </Link>
        </DropdownMenuItem>
        {user.role === 'ADMIN' ? (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck aria-hidden="true" />
              Admin area
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onClick={() => logout.mutate()} aria-label="Sign out">
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const { data: user } = useMe();
  const { data: application } = useMyApplication(Boolean(user));
  const { data: notifications } = useNotifications({ pageSize: 10 });

  // Re-reads `me` on focus and when a new notification arrives, so an
  // approval or a suspension reaches this navigation without a reload.
  useLivePermissions(notifications?.items.unreadCount);

  const pending = application?.status === 'PENDING';
  const teaches = can(user, 'instructor:dashboard');
  const canApply = canApplyToTeach(user, pending);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 h-17 border-b border-border bg-card/95 backdrop-blur">
        <div className="container flex h-17 items-center gap-4">
          <Wordmark to={user?.role === 'ADMIN' ? '/admin' : '/dashboard'} />

          {/* An instructor gets the switcher here instead of a nav item,
              which is how the artifact moves between the workspaces. */}
          {teaches ? <WorkspaceSwitcher className="ml-2 max-lg:hidden" /> : null}

          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
            {LEARNER_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            {user?.role === 'ADMIN' ? (
              <NavLink to="/admin" className={navLinkClass}>
                Admin
              </NavLink>
            ) : null}

            {/* The artifact's pill, which the nav shows only in the two
                states where it means something. */}
            {canApply ? (
              <NavLink
                to="/become-an-instructor"
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-2 rounded-pill px-3.5 text-small font-semibold transition-colors',
                    isActive
                      ? 'bg-primary-tint text-primary-hover'
                      : 'bg-primary-tint/60 text-primary-hover hover:bg-primary-tint',
                  )
                }
              >
                <GraduationCap className="size-4" aria-hidden="true" />
                Become an Instructor
              </NavLink>
            ) : null}

            {pending ? (
              <NavLink
                to="/instructor-application"
                className="flex min-h-11 items-center gap-2 rounded-pill bg-warning-tint px-3.5 text-small font-semibold text-warning transition-colors hover:brightness-95"
              >
                <Clock className="size-4" aria-hidden="true" />
                Application pending
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user ? <NotificationBell /> : null}
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="main" className="container flex-1 py-6 lg:py-12">
        <Outlet />
      </main>

      <footer className="border-t border-border py-6 max-md:hidden">
        <div className="container flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
          <p>Cadence — a learning platform.</p>
          <p>
            <a className="hover:text-primary-hover" href="/api/docs">
              API documentation
            </a>
          </p>
        </div>
      </footer>

      <MobileTabBarSpacer />
      <MobileTabBar />
    </div>
  );
}

const ADMIN_NAV = [
  { to: '/admin', label: 'Activity', icon: Activity, end: true },
  { to: '/admin/courses', label: 'Courses', icon: BookOpen, end: false },
  { to: '/admin/learners', label: 'Learners', icon: Users, end: false },
  { to: '/admin/settings', label: 'Settings', icon: Settings, end: false },
];

/**
 * The instructor section of the admin sidebar, which the artifact prints
 * under its own "INSTRUCTORS" heading (desktop pages 14–16).
 */
const ADMIN_INSTRUCTOR_NAV = [
  {
    to: '/admin/instructor-applications',
    label: 'Applications',
    icon: GraduationCap,
    end: false,
  },
  {
    to: '/admin/instructors',
    label: 'Instructor management',
    icon: Users,
    end: false,
  },
];

/**
 * The admin shell: a fixed 246px sidebar (measured from artifact pages 8–9)
 * with the ADMIN chip, the nav list, and "View learner site" plus "Sign out"
 * pinned to the bottom. Below `lg` it becomes a drawer — admin keeps the
 * hamburger because it has no bottom-tab equivalent in the artifacts.
 */
export function AdminLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);
  // The pending-review count beside "Applications", from the same query
  // the page itself uses — so the badge and the tab can never disagree.
  const applications = useAdminApplications({ status: 'PENDING', pageSize: 1 });
  const pendingApplications = applications.data?.meta.total ?? 0;

  const nav = (
    <nav aria-label="Admin" className="flex flex-1 flex-col gap-1">
      {ADMIN_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={navLinkClass}
          onClick={() => setMenuOpen(false)}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}

      <p className="mt-4 px-3 pb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        Instructors
      </p>
      {ADMIN_INSTRUCTOR_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={navLinkClass}
          onClick={() => setMenuOpen(false)}
        >
          <item.icon className="size-4" aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
          {item.to === '/admin/instructor-applications' && pendingApplications > 0 ? (
            <span className="flex min-h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 font-mono text-caption text-warning-foreground">
              {pendingApplications}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <Button asChild variant="ghost" className="justify-start">
        <Link to="/courses">View learner site</Link>
      </Button>
      <Button
        variant="ghost"
        className="justify-start text-destructive hover:bg-destructive-tint"
        onClick={() => logout.mutate()}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-[246px] shrink-0 flex-col gap-4 border-r border-border bg-card p-4 lg:flex">
        <Wordmark to="/admin" showAdminChip />
        {nav}
        {footer}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 h-17 border-b border-border bg-card/95 backdrop-blur lg:hidden">
          <div className="flex h-17 items-center gap-3 px-4">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open admin menu">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="gap-4">
                <SheetTitle className="sr-only">Admin navigation</SheetTitle>
                <Wordmark to="/admin" showAdminChip />
                {nav}
                {footer}
              </SheetContent>
            </Sheet>
            <Wordmark to="/admin" />
            <div className="ml-auto">
              <UserMenu />
            </div>
          </div>
        </header>

        <div className="hidden h-17 shrink-0 items-center justify-end gap-2 border-b border-border bg-card/95 px-8 lg:flex">
          <span className="mr-1 text-caption text-muted-foreground">
            Signed in as {user ? fullName(user) : ''}
          </span>
          <NotificationBell />
          <UserMenu />
        </div>

        <main id="main" className="flex-1 px-4 py-8 lg:px-8 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
