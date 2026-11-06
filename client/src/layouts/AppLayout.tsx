import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { initials, fullName } from '@cadence/shared';
import { Wordmark } from '@/components/common/Brand';
import { MobileTabBar, MobileTabBarSpacer } from '@/components/layout/MobileTabBar';
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

export function UserMenu() {
  const { data: user } = useMe();
  const logout = useLogout();
  if (!user) return null;

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
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 h-17 border-b border-border bg-card/95 backdrop-blur">
        <div className="container flex h-17 items-center gap-4">
          <Wordmark to={user?.role === 'ADMIN' ? '/admin' : '/dashboard'} />

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
          </nav>

          <div className="ml-auto flex items-center gap-2">
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
 * The admin shell: a fixed 246px sidebar (measured from artifact pages 8–9)
 * with the ADMIN chip, the nav list, and "View learner site" plus "Sign out"
 * pinned to the bottom. Below `lg` it becomes a drawer — admin keeps the
 * hamburger because it has no bottom-tab equivalent in the artifacts.
 */
export function AdminLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);

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

        <div className="hidden h-17 shrink-0 items-center justify-end border-b border-border bg-card/95 px-8 lg:flex">
          <span className="mr-3 text-caption text-muted-foreground">
            Signed in as {user ? fullName(user) : ''}
          </span>
          <UserMenu />
        </div>

        <main id="main" className="flex-1 px-4 py-8 lg:px-8 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
