import { PASSWORD_RESET_TTL_MINUTES } from '@cadence/shared';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Outbound transactional mail.
 *
 * Everything above this file composes a message and calls `mailer.send`; the
 * transport is the only thing that changes when real delivery is wired up.
 *
 * There is no transport yet, so `send` prints the message to the log. That is
 * a deliberate stand-in rather than a silent drop: a reset link nobody can
 * reach is a dead feature, and printing it is what makes the flow followable
 * end to end today.
 *
 * Wiring Mailtrap up is a change to this file alone — read the SMTP
 * credentials in `config/env.ts`, build a nodemailer transport from them, and
 * have `send` hand it this same message. `hasTransport` then becomes true and
 * the message body stops being logged. No caller changes.
 */

export type Mail = {
  to: string;
  subject: string;
  /** Plain text, because every client renders it and nothing can be hidden in it. */
  text: string;
};

/**
 * Whether real delivery is configured. Gating on this rather than on
 * NODE_ENV is what keeps the two concerns apart: a production deployment
 * with no transport still needs to be told its mail is going nowhere, and a
 * local stack running NODE_ENV=production still needs the link.
 */
const hasTransport = false;

export const mailer = {
  /*
   * Returns a promise without being `async`: there is nothing to await yet,
   * but the signature is the one an SMTP transport will need, so callers do
   * not change when the real one lands.
   */
  send(mail: Mail): Promise<void> {
    const meta = { to: mail.to, subject: mail.subject, from: env.MAIL_FROM };

    if (hasTransport) {
      // The body carries single-use secrets; once it is really being
      // delivered, the log records only that it was.
      logger.info(meta, 'Mail sent');
      return Promise.resolve();
    }

    // `warn`, not `info`: nothing was delivered, and an operator who sees
    // this in a real deployment needs to act on it.
    logger.warn(
      meta,
      `No mail transport is configured — the message was NOT delivered. Printed instead:\n${mail.text}`,
    );
    return Promise.resolve();
  },
};

/**
 * The password-reset message.
 *
 * It states the expiry and what to do if the request was not theirs, and it
 * never says whether the address is registered — the caller sends this only
 * when it is, and says the same thing to the browser either way.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  firstName: string;
  resetUrl: string;
}): Promise<void> {
  await mailer.send({
    to: params.to,
    subject: 'Reset your Cadence password',
    text: [
      `Hi ${params.firstName},`,
      '',
      'Use the link below to choose a new Cadence password. It expires in ' +
        `${PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.`,
      '',
      params.resetUrl,
      '',
      'If you did not ask for this, you can ignore this email — your password',
      'will not change until the link is used.',
      '',
      '— Cadence',
    ].join('\n'),
  });
}
