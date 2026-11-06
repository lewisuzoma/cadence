import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind is configured entirely from the CSS variables in
 * `src/styles/globals.css`, which hold the tokens read off the design
 * artifacts (see docs/design-notes.md).  Nothing here hardcodes a colour, so
 * retheming means editing one CSS file.
 *
 * Breakpoints come from the artifact's own note: "Mobile-first grids.
 * 4 → 2 → 1 columns at 1200 / 720px".
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      sm: '480px',
      md: '720px', // the artifact's 1-to-2 column switch
      lg: '1200px', // the artifact's 2-to-4 column switch
      xl: '1440px', // the desktop design canvas
    },
    container: {
      center: true,
      // 16px gutters on mobile, 80px at the desktop canvas width.
      padding: { DEFAULT: '1rem', md: '1.5rem', lg: '2rem', xl: '5rem' },
      screens: { xl: '1440px' },
    },
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
          tint: 'hsl(var(--primary-tint))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          tint: 'hsl(var(--success-tint))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          tint: 'hsl(var(--warning-tint))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          tint: 'hsl(var(--destructive-tint))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        /** The player surface: the only dark area in the design. */
        night: {
          DEFAULT: 'hsl(var(--night))',
          foreground: 'hsl(var(--night-foreground))',
          muted: 'hsl(var(--night-muted))',
          /** Amber scrubber fill, and the track behind it. */
          accent: 'hsl(var(--video-accent))',
          track: 'hsl(var(--video-track))',
        },
        avatar: {
          DEFAULT: 'hsl(var(--avatar))',
          foreground: 'hsl(var(--avatar-foreground))',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        heading: ['var(--font-heading)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        // The artifact's type scale, with its letter-spacing and line heights.
        display: ['3rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-sm': ['2.25rem', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '700' }],
        heading: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '700' }],
        'heading-sm': ['1.375rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
        title: ['1.125rem', { lineHeight: '1.35', fontWeight: '600' }],
        body: ['1rem', { lineHeight: '1.5' }],
        small: ['0.875rem', { lineHeight: '1.45' }],
        caption: ['0.8125rem', { lineHeight: '1.4' }],
        overline: ['0.8125rem', { lineHeight: '1.2', letterSpacing: '0.06em', fontWeight: '600' }],
        timecode: ['0.875rem', { lineHeight: '1.2' }],
      },
      borderRadius: {
        // The artifact's radius scale: 8 · 12 · 20 · pill.
        sm: '0.5rem',
        DEFAULT: '0.75rem',
        md: '0.75rem',
        lg: '1.25rem',
        pill: '9999px',
      },
      boxShadow: {
        // "none at rest, 8% on hover".
        none: 'none',
        hover: '0 8px 24px -8px hsl(var(--shadow-color) / 0.08), 0 2px 6px -2px hsl(var(--shadow-color) / 0.08)',
        card: '0 1px 2px 0 hsl(var(--shadow-color) / 0.04)',
        overlay: '0 24px 48px -12px hsl(var(--shadow-color) / 0.18)',
      },
      spacing: {
        // The 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 rhythm, named.
        '4.5': '1.125rem',
        // 68px: the top bar height measured from the artifact.
        '17': '4.25rem',
        '18': '4.5rem', // 72
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        /*
         * A nudge-then-rest beat, for an attention cue that loops forever:
         * the hold from 55% on keeps it from reading as a jitter.  Both ends
         * sit at 0 so the reduced-motion rule in globals.css, which collapses
         * every animation to a single 0.01ms run, leaves the element at rest
         * rather than frozen mid-slide.
         */
        'nudge-x': {
          '0%, 55%, 100%': { transform: 'translateX(0)' },
          '27%': { transform: 'translateX(0.3rem)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'nudge-x': 'nudge-x 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
