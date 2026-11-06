import { NavLink } from 'react-router-dom';
import { BarChart3, Home, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The bottom tab bar from mobile artifact pages 9 and 10.
 *
 * Those two pages are labelled "app" in the artifact's own contents list, and
 * what makes them read as an app is this: a fixed bottom bar with Home,
 * Catalog and Progress, the active tab in cobalt. Built as web rather than
 * native — the deliverable is one responsive application, so these are the
 * same routes at phone width, not a second codebase.
 *
 * Hidden from `md` up, where the top bar takes over. `pb-[env(safe-area-
 * inset-bottom)]` keeps it clear of the iOS home indicator.
 */
const TABS = [
  { to: '/dashboard', label: 'Home', icon: Home, end: true },
  { to: '/courses', label: 'Catalog', icon: LayoutGrid, end: false },
  { to: '/my-learning', label: 'Progress', icon: BarChart3, end: false },
];

export function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => (
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
              {({ isActive }) => (
                <>
                  <tab.icon
                    className={cn('size-5', isActive && 'stroke-[2.4]')}
                    aria-hidden="true"
                  />
                  {tab.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Spacer so page content can scroll clear of the fixed bar. Rendered once by
 * the layout rather than remembered per page.
 */
export function MobileTabBarSpacer() {
  return <div aria-hidden="true" className="h-16 md:hidden" />;
}
