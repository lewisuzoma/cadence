import { Toaster as SonnerToaster } from 'sonner';

/**
 * Toasts.
 *
 * Sonner renders into an `aria-live` region, which is why it is the app's only
 * transient-feedback mechanism — `alert()` would be invisible to assistive
 * technology and would block the page. Styling is mapped onto the design
 * tokens so a success toast uses the same green as a Completed badge.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-md border border-border bg-card text-foreground shadow-overlay font-sans',
          title: 'text-small font-semibold',
          description: 'text-caption text-secondary-foreground',
          actionButton: 'bg-primary text-primary-foreground rounded-md',
          cancelButton: 'bg-muted text-secondary-foreground rounded-md',
          success: 'border-success/30 [&_[data-icon]]:text-success',
          error: 'border-destructive/30 [&_[data-icon]]:text-destructive',
          warning: 'border-warning/30 [&_[data-icon]]:text-warning',
        },
      }}
    />
  );
}
