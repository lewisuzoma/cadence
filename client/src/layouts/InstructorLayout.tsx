import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  User,
} from 'lucide-react';
import { can } from '@cadence/shared';
import { Wordmark } from '@/components/common/Brand';
import { NotificationBell } from '@/components/instructor/NotificationBell';
import { WorkspaceSwitcher } from '@/components/instructor/WorkspaceSwitcher';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useMe } from '@/features/auth/auth.queries';
import { useInstructorDashboard } from '@/features/instructor/instructor.queries';
import { UserMenu } from '@/layouts/AppLayout';
import { cn } from '@/lib/utils';

/**
 * The Teaching workspace shell, from desktop artifact pages 4–13.
 *
 * A 292 px sidebar headed "TEACHING", the workspace switcher beside the
 * wordmark in the top bar, and the notification bell and avatar on the
 * right. Below `lg` the sidebar becomes a drawer and a bottom tab bar
 * takes over, matching mobile board 5.
 *
 * The learner shell is not reused: the artifact gives teaching its own
 * chrome precisely so that an instructor always knows which workspace
 * they are in, and collapsing the two would lose that.
 */
const TEACHING_NAV = [
  { to: '/instructor', label: 'Instructor dashboard', icon: LayoutDashboard, end: true },
  { to: '/instructor/courses', label: 'My courses', icon: LayoutGrid, end: false },
  { to: '/instructor/analytics', label: 'Learners & analytics', icon: BarChart3, end: false },
  { to: '/instructor/profile', label: 'Instructor profile', icon: User, end: false },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-small font-semibold transition-colors',
    isActive
      ? 'bg-primary-tint text-primary-hover'
      : 'text-secondary-foreground hover:bg-muted hover:text-foreground',
  );
}

/** The mobile bottom bar for the teaching workspace (mobile board 5). */
function TeachingTabBar() {
  const tabs = [
    { to: '/instructor', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/instructor/courses', label: 'Courses', icon: LayoutGrid, end: false },
    { to: '/instructor/analytics', label: 'Analytics', icon: BarChart3, end: false },
    { to: '/dashboard', label: 'Learning', icon: BookOpen, end: false },
  ];

  return (
    <nav
      aria-label="Teaching"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex items-stretch">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-caption font-semibold transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <tab.icon className="size-5" aria-hidden="true" />
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function InstructorLayout() {
  const { data: user } = useMe();
  const { data: dashboard } = useInstructorDashboard();
  const [menuOpen, setMenuOpen] = useState(false);

  const courseCount = dashboard?.stats.totalCourses;

  const nav = (
    <nav aria-label="Teaching" className="flex flex-1 flex-col gap-1">
      <p className="px-3 pb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        Teaching
      </p>
      {TEACHING_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={navLinkClass}
          onClick={() => setMenuOpen(false)}
        >
          <item.icon className="size-4" aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
          {item.to === '/instructor/courses' && courseCount !== undefined ? (
            <span className="font-mono text-caption text-muted-foreground">
              {courseCount}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );

  /** The artifact's sidebar footer: a nudge back to the learner side. */
  const footer = (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-caption text-secondary-foreground">
        Learning something new? Your enrollments are one click away.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-2 w-full">
        <Link to="/dashboard">Switch to Learning</Link>
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 h-17 border-b border-border bg-card/95 backdrop-blur">
        <div className="flex h-17 items-center gap-3 px-4 lg:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open teaching menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="gap-4">
              <SheetTitle className="sr-only">Teaching navigation</SheetTitle>
              <Wordmark to="/instructor" />
              {nav}
              {footer}
            </SheetContent>
          </Sheet>

          <Wordmark to="/instructor" />

          {/* Only an actual instructor sees the switcher; an admin reaching
              the workspace has the admin area instead. */}
          {can(user, 'instructor:dashboard') ? (
            <WorkspaceSwitcher className="ml-2 max-sm:hidden" />
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-1">
        <aside className="sticky top-17 hidden h-[calc(100dvh-4.25rem)] w-[292px] shrink-0 flex-col gap-4 border-r border-border bg-card p-4 lg:flex">
          {nav}
          {footer}
        </aside>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 pb-24 lg:px-8 lg:py-8 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <TeachingTabBar />
    </div>
  );
}
