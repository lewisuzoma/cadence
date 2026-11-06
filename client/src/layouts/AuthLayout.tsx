import { NavLink, Outlet } from 'react-router-dom';
import { Play } from 'lucide-react';
import { BrandMark } from '@/components/common/Brand';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The sign-in / create-account shell, from desktop artifact page 2 and
 * mobile page 1.
 *
 * Desktop: a full-height cobalt panel fills the left half, carrying the
 * inverted mark, the value proposition, and two abstract shapes — the same
 * circle-and-rounded-square language as the course thumbnails — plus a
 * floating "Resume at 08:42" card that shows what the product does. The
 * right half is Canvas with the form card centred on it.
 *
 * Mobile: the panel collapses to a band at the top holding the mark and the
 * heading, and the card sits below it.
 *
 * The tab pair lives here rather than in each page, so Sign in and Create
 * account cannot drift apart. The tabs are real links: they change route.
 */
export function AuthLayout() {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-2">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <BrandPanel />

      <div className="flex items-center justify-center px-4 py-10 lg:px-8">
        <Card id="main" className="w-full max-w-md p-6 lg:p-8">
          <AuthTabs />
          <Outlet />
        </Card>
      </div>
    </div>
  );
}

/** The cobalt side (desktop) / band (mobile). */
function BrandPanel() {
  return (
    <div className="relative overflow-hidden bg-primary px-6 py-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
      {/*
        Decorative shapes, matching the thumbnail language. Behind the
        content and hidden from assistive technology.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-24 top-1/3 size-[26rem] rounded-pill bg-primary-hover max-lg:hidden" />
        <div className="absolute bottom-16 right-10 size-44 rounded-[2.5rem] bg-[#8EA0FF] max-lg:hidden" />
      </div>

      <div className="relative flex items-center gap-2.5">
        {/* Inverted on cobalt: a white tile with the cobalt glyph. */}
        <BrandMark className="bg-card text-primary" inverted />
        <span className="font-heading text-heading-sm tracking-tight">Cadence</span>
      </div>

      <div className="relative mt-6 flex flex-col gap-4 lg:mt-0 lg:max-w-lg">
        <h1 className="text-display-sm lg:text-display">
          Learn at your own pace. Pick up right where you left off.
        </h1>
        <p className="max-w-md text-body text-primary-foreground/85 max-lg:hidden">
          Every lesson remembers your last position, so a ten-minute break never costs you ten
          minutes.
        </p>
      </div>

      {/* The sample "Resume" card from the artifact: a still life of the product. */}
      <div
        aria-hidden="true"
        className="relative mt-10 hidden w-fit items-center gap-3 rounded-lg bg-card p-3 pr-6 shadow-overlay lg:flex"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-night">
          <Play className="size-4 fill-white text-white" />
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold text-foreground">Resume at 08:42</span>
          <span className="block h-1 w-36 overflow-hidden rounded-pill bg-border">
            <span className="block h-full w-3/5 bg-night-accent" />
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Sign in | Create account. A joined pair where the selected side is white
 * with an Ink outline and the other is a flat grey, exactly as drawn.
 */
function AuthTabs() {
  const base =
    'flex min-h-11 flex-1 items-center justify-center rounded-md px-4 text-small font-semibold transition-colors';

  return (
    <nav aria-label="Account" className="mb-6 flex gap-0 rounded-md bg-muted p-1">
      <NavLink
        to="/login"
        className={({ isActive }) =>
          cn(
            base,
            isActive
              ? 'border-2 border-foreground bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )
        }
      >
        Sign in
      </NavLink>
      <NavLink
        to="/register"
        className={({ isActive }) =>
          cn(
            base,
            isActive
              ? 'border-2 border-foreground bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )
        }
      >
        Create account
      </NavLink>
    </nav>
  );
}
