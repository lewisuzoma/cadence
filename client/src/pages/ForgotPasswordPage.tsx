import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The destination of the artifact's "Forgot password?" link.
 *
 * Self-service reset needs a mail transport, which is out of scope for this
 * build. Rather than render a link that goes nowhere — the spec is explicit
 * that there are no decorative controls — the link resolves here and says
 * plainly what to do instead. Honest, and the sign-in screen still matches
 * the design.
 */
export function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-5">
      <span className="flex size-12 items-center justify-center rounded-pill bg-primary-tint text-primary">
        <Mail className="size-6" aria-hidden="true" />
      </span>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-heading">Password reset</h2>
        <p className="text-small text-secondary-foreground">
          This deployment has no mail transport configured, so Cadence cannot send a reset link.
          Ask an administrator to set a new password for you.
        </p>
        <p className="text-small text-secondary-foreground">
          If you are signed in already, you can change your own password from{' '}
          <Link to="/profile" className="font-semibold text-primary hover:text-primary-hover">
            your profile
          </Link>
          .
        </p>
      </div>

      <Button asChild className="w-full">
        <Link to="/login">Back to sign in</Link>
      </Button>
    </div>
  );
}
