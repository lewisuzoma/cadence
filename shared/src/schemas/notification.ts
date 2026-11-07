import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../enums.js';
import { paginationQuerySchema, uuidSchema } from './common.js';

/**
 * In-app notifications.
 *
 * Every notification is written in the same transaction as the event that
 * caused it, so a user is never told about an approval that was rolled back.
 * Email is out of scope; `NotificationChannel` on the server is the seam
 * where it would be added.
 */

export const notificationSchema = z.object({
  id: uuidSchema,
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  /** An in-app route, never an external URL. */
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = paginationQuerySchema.extend({
  /** "Unread · 3" tab on the artifact's dropdown. */
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().min(0),
});
export type NotificationList = z.infer<typeof notificationListSchema>;
