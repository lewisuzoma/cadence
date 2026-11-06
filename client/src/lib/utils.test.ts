import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';
import { cn } from './utils';

/**
 * Guards the tailwind-merge configuration in `cn`.
 *
 * The project's type scale is named after the design artifact
 * (`text-small`, `text-caption`, …), which tailwind-merge does not recognise
 * as font sizes. Left unconfigured it files them under *colours*, so a class
 * string carrying both a size and a colour keeps only whichever came last —
 * and the loss is silent, because the element simply inherits instead.
 *
 * That is what made the catalog's selected category chip render Ink-on-Ink.
 * These tests pin the behaviour per class group rather than asserting on a
 * whole merged string, so adding a variant does not churn them.
 */

const FONT_SIZES = [
  'display',
  'display-sm',
  'heading',
  'heading-sm',
  'title',
  'body',
  'small',
  'caption',
  'overline',
  'timecode',
];

const isFontSize = (cls: string) => FONT_SIZES.includes(cls.replace(/^text-/, ''));

/** Splits the `text-*` classes that survived a merge into sizes and colours. */
function textClasses(merged: string) {
  const all = merged.split(' ').filter((c) => c.startsWith('text-'));
  return {
    sizes: all.filter(isFontSize),
    colors: all.filter((c) => !isFontSize(c)),
  };
}

describe('cn — custom scales', () => {
  it('keeps a font size and a colour together, rather than one overwriting the other', () => {
    const { sizes, colors } = textClasses(cn('text-small', 'text-background'));

    expect(sizes).toEqual(['text-small']);
    expect(colors).toEqual(['text-background']);
  });

  it('still lets one font size override another', () => {
    expect(cn('text-small', 'text-body')).toBe('text-body');
    expect(cn('text-small', 'text-caption')).toBe('text-caption');
  });

  it('still lets one colour override another', () => {
    expect(cn('text-foreground', 'text-background')).toBe('text-background');
  });

  it('resolves the custom radius instead of leaving both classes to CSS order', () => {
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('rounded-pill', 'rounded-md')).toBe('rounded-md');
  });

  it('resolves the custom shadows', () => {
    expect(cn('shadow-card', 'shadow-overlay')).toBe('shadow-overlay');
  });
});

describe('buttonVariants — every variant keeps its own colour and size', () => {
  const variants = [
    'default',
    'ink',
    'secondary',
    'outline',
    'ghost',
    'link',
    'destructive',
    'destructive-outline',
    'success',
  ] as const;
  const sizes = ['default', 'sm', 'lg', 'icon', 'icon-sm'] as const;

  /*
   * `ink` on a dark fill is the case that actually broke: losing
   * `text-background` left Ink text on an Ink chip. The others are checked
   * too because they failed the same way, just less visibly.
   */
  it.each(variants.flatMap((variant) => sizes.map((size) => [variant, size] as const)))(
    '%s / %s survives the merge with exactly one font size',
    (variant, size) => {
      const { sizes: fontSizes } = textClasses(cn(buttonVariants({ variant, size })));
      expect(fontSizes).toHaveLength(1);
    },
  );

  it.each([
    ['default', 'text-primary-foreground'],
    ['ink', 'text-background'],
    ['secondary', 'text-foreground'],
    ['link', 'text-primary'],
    ['destructive', 'text-destructive-foreground'],
    ['destructive-outline', 'text-destructive'],
    ['success', 'text-success-foreground'],
  ] as const)('%s keeps %s at every size', (variant, expected) => {
    for (const size of sizes) {
      expect(cn(buttonVariants({ variant, size }))).toContain(expected);
    }
  });
});
