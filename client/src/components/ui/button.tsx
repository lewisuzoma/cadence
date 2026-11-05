import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Button.
 *
 * Sizes honour the artifact's "44px min target" note: `default` and `lg` are
 * at or above 44px, and `sm`/`icon` are only used where the design shows a
 * compact control inside a larger hit area.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-small font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'bg-card text-foreground border border-border hover:bg-muted',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:text-primary-hover hover:underline',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        /** The "Delete course…" treatment: destructive, but not shouting. */
        'destructive-outline':
          'border border-destructive/40 bg-transparent text-destructive hover:bg-destructive-tint',
        success: 'bg-success text-success-foreground hover:bg-success/90',
      },
      size: {
        default: 'h-11 px-5 py-2',
        sm: 'h-9 px-3 text-caption',
        lg: 'h-12 px-6 text-body',
        icon: 'size-11',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Shows a spinner and blocks input while a mutation is in flight. */
    loading?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
