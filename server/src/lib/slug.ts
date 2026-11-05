import { slugify } from '@cadence/shared';
import { prisma } from './prisma.js';

/**
 * Builds a unique course slug.  Collisions get a numeric suffix rather than an
 * error, so creating "React Basics" twice yields `react-basics` and
 * `react-basics-2` instead of a 409 the admin cannot act on.
 */
export async function uniqueCourseSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title) || 'course';
  let candidate = base;
  for (let attempt = 2; attempt < 100; attempt++) {
    const existing = await prisma.course.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${attempt}`;
  }
  // 98 collisions on one title is not a real scenario; keep it deterministic.
  return `${base}-${Date.now()}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID_RE.test(value);
