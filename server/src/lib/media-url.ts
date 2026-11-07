/**
 * Addresses for stored media.
 *
 * Two kinds of asset, two rules:
 *
 *  - **Images** (course thumbnails, instructor photos) are public by nature:
 *    they appear in the catalog to signed-out visitors. They get a stable
 *    path served by the API, which works identically under both storage
 *    drivers and keeps the browser cache useful.
 *  - **Videos** are not public. They are never addressed by this function;
 *    `uploads.service` mints a short-lived signed URL for them, and only
 *    after the lesson access check has passed. Keeping the two apart in
 *    separate functions is deliberate: it makes "which one did I call?" a
 *    visible decision at each call site rather than a flag someone forgets.
 */

/** Where the API serves stored images from. */
export const MEDIA_ROUTE_PREFIX = '/api/v1/media';

/**
 * A public URL for a stored image, or `null` when there is no key.
 *
 * The key is path-encoded rather than interpolated raw: a key is generated
 * server-side today, but a function that would break on the first key
 * containing a space or a `?` is a trap for later.
 */
export function mediaUrlForKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${MEDIA_ROUTE_PREFIX}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
