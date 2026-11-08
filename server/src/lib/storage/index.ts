import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';
import { LocalStorageDriver } from './local.driver.js';
import { S3StorageDriver } from './s3.driver.js';
import type { StorageProvider } from './types.js';

export * from './types.js';
export * from './media-type.js';
export { LocalStorageDriver } from './local.driver.js';

/**
 * The configured storage provider, built once.
 *
 * Lazy rather than eager so that importing anything from this module in a
 * test does not construct an S3 client, and so a misconfiguration surfaces
 * on first use with a clear message rather than at import time somewhere
 * unrelated.
 */
let provider: StorageProvider | undefined;

export function storage(): StorageProvider {
  if (!provider) {
    provider =
      env.STORAGE_DRIVER === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
    logger.info({ driver: provider.name }, 'Storage provider ready');
  }
  return provider;
}

/** Replaces the provider. Tests only. */
export function setStorageProvider(next: StorageProvider | undefined): void {
  provider = next;
}

/**
 * Builds a storage key.
 *
 * Shaped `<purpose>/<owner>/<uuid>.<ext>` so that objects are attributable
 * from the key alone when someone is looking at a bucket, and partitioned
 * by owner so one instructor's media is easy to find or remove.
 *
 * The filename the user chose is deliberately **not** part of the key: it
 * is attacker-controlled, may contain path separators or unicode that
 * behaves differently across the two drivers, and is kept in
 * `MediaAsset.originalName` where it is only ever displayed.
 */
export function buildStorageKey(params: {
  purpose: string;
  ownerId: string;
  mimeType: string;
}): string {
  const extension = extensionFor(params.mimeType);
  const folder = params.purpose.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `${folder}/${params.ownerId}/${randomUUID()}${extension}`;
}

function extensionFor(mimeType: string): string {
  switch (mimeType.toLowerCase().split(';')[0]!.trim()) {
    case 'video/mp4':
      return '.mp4';
    case 'video/webm':
      return '.webm';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '';
  }
}

/** The size ceiling for a kind, in bytes. */
export function maxBytesFor(kind: 'VIDEO' | 'IMAGE'): number {
  const megabytes = kind === 'VIDEO' ? env.MAX_VIDEO_MB : env.MAX_IMAGE_MB;
  return megabytes * 1024 * 1024;
}
