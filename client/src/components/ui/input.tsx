import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Input. 44px tall to meet the artifact's minimum touch target, with the
 * focus ring supplied globally by `:focus-visible` in globals.css so every
 * control in the app focuses identically.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md border border-input bg-card px-3.5 py-2 text-body text-foreground',
        'placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive',
        'file:border-0 file:bg-transparent file:text-small file:font-medium',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-24 w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-body text-foreground',
      'placeholder:text-muted-foreground',
      'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
      'aria-[invalid=true]:border-destructive',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };
