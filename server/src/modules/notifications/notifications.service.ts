import type { NotificationList, NotificationQuery, NotificationType } from '@cadence/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';

/**
 * In-app notifications.
 *
 * The important property is that a notification is written **in the same
 * transaction as the thing it announces**. "You're now an instructor" must
 * not survive an approval that rolled back, and an approval must not
 * succeed silently because the notification write failed afterwards. Every
 * `create*` below therefore takes a transaction client.
 */

/** A Prisma client or an interactive transaction — both satisfy the writes. */
export type Tx = PrismaClient | Prisma.TransactionClient;

export type NotificationDraft = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
};

/**
 * Where notifications are delivered.
 *
 * In-app is the only channel in scope. This interface is the seam an email
 * or push channel would be added at: `notify()` would fan out to a list of
 * channels instead of calling the database one directly. It is declared
 * rather than merely described so the shape is checked by the compiler and
 * an implementation cannot drift from it.
 */
export type NotificationChannel = {
  readonly name: string;
  deliver(drafts: NotificationDraft[], tx: Tx): Promise<void>;
};

/** The one channel that exists: a row in `notifications`. */
export const inAppChannel: NotificationChannel = {
  name: 'in-app',
  async deliver(drafts, tx) {
    if (drafts.length === 0) return;
    await tx.notification.createMany({
      data: drafts.map((draft) => ({
        userId: draft.userId,
        type: draft.type,
        title: draft.title,
        body: draft.body,
        link: draft.link ?? null,
      })),
    });
  },
};

const channels: NotificationChannel[] = [inAppChannel];

export const notificationsService = {
  /**
   * Queues notifications on the caller's transaction.
   *
   * Takes an array because most events notify more than one person — an
   * application submission tells the applicant and every admin — and one
   * `createMany` is better than N round trips inside a transaction that is
   * holding row locks.
   */
  async notify(drafts: NotificationDraft[], tx: Tx = prisma): Promise<void> {
    if (drafts.length === 0) return;
    for (const channel of channels) {
      await channel.deliver(drafts, tx);
    }
  },

  /** Every admin's id, for the notifications that fan out to the team. */
  async adminIds(tx: Tx = prisma): Promise<string[]> {
    const admins = await tx.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    return admins.map((admin) => admin.id);
  },

  async list(userId: string, query: NotificationQuery) {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    const data: NotificationList = {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
    };

    return { data, meta: buildMeta(query.page, query.pageSize, total) };
  },

  /**
   * Marks one notification read.
   *
   * Scoped by `userId` in the `where`, not checked afterwards: marking
   * someone else's notification read simply matches no rows, so there is no
   * path where the wrong row is written. A notification that is already
   * read, or never existed, is a no-op — the client calls this on render,
   * and making that a 404 would be noise rather than information.
   */
  async markRead(userId: string, notificationId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  },

  async markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  },

  async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },
};

/**
 * Fire-and-forget delivery for callers outside a transaction.
 *
 * Used only where the notification is genuinely incidental and must never
 * fail the request that triggered it. A failure is logged, never swallowed
 * silently.
 */
export function notifyDetached(drafts: NotificationDraft[]): void {
  notificationsService.notify(drafts).catch((error: unknown) => {
    logger.error({ err: error, count: drafts.length }, 'Failed to deliver notifications');
  });
}
