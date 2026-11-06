import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
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
 * The learner shell: a 68px top bar over the page, as the artifact shows
 * (wordmark, primary nav, avatar menu). On mobile the nav collapses into a
 * Sheet drawer.
 *
 * The admin area gets its own shell with a fixed 246px sidebar — see
 * AdminLayout.
 */

const LEARNER_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/courses', label: 'Catalog', icon: BookOpen },
  { to: '/my-learning', label: 'My learning', icon: GraduationCap },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 items-center gap-2 rounded-md px-3 text-small font-semibold transition-colors',
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
        <DropdownMenuItem
          destructive
          onClick={() => logout.mutate()}
          aria-label="Sign out"
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Wordmark({ to = '/dashboard' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-md">
      {/* The artifact's mark: a cobalt square with the C, then the wordmark. */}
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary font-heading text-small font-bold text-primary-foreground"
        aria-hidden="true"
      >
        C
      </span>
      <span className="font-heading text-heading-sm tracking-tight">Cadence</span>
    </Link>
  );
}

export function AppLayout() {
  const { data: user } = useMe();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer on navigation, so a tap does not leave it open behind
  // the new page.
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 h-17 border-b border-border bg-card/95 backdrop-blur">
        <div className="container flex h-17 items-center gap-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Wordmark to={user?.role === 'ADMIN' ? '/admin' : '/dashboard'} />
              <nav aria-label="Main" className="mt-4 flex flex-col gap-1">
                {LEARNER_NAV.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={closeMenu}>
                    <item.icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                ))}
                {user?.role === 'ADMIN' ? (
                  <NavLink to="/admin" className={navLinkClass} onClick={closeMenu}>
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    Admin
                  </NavLink>
                ) : null}
              </nav>
            </SheetContent>
          </Sheet>

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

      <main id="main" className="container flex-1 py-8 lg:py-12" key={location.pathname}>
        <Outlet />
      </main>

      <footer className="border-t border-border py-6">
        <div className="container flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
          <p>Cadence — a learning platform.</p>
          <p>
            <a className="hover:text-primary-hover" href="/api/docs">
              API documentation
            </a>
          </p>
        </div>
      </footer>
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
 * The admin shell. The artifact gives it a fixed 246px sidebar with the
 * ADMIN chip, a nav list, and "View learner site" plus "Sign out" pinned to
 * the bottom. Below the lg breakpoint it becomes the same drawer pattern.
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

      {/* Fixed 246px sidebar, measured from the artifact. */}
      <aside className="sticky top-0 hidden h-dvh w-[246px] shrink-0 flex-col gap-4 border-r border-border bg-card p-4 lg:flex">
        <div className="flex items-center gap-2">
          <Wordmark to="/admin" />
          <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-overline uppercase text-primary-hover">
            Admin
          </span>
        </div>
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
                <Wordmark to="/admin" />
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

/** The centred card layout for /login and /register. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="container flex h-17 items-center">
        <Wordmark to="/courses" />
      </header>
      <main id="main" className="container flex flex-1 items-center justify-center py-10">
        <Outlet />
      </main>
    </div>
  );
}
