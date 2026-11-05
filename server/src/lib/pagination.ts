import type { PaginationMeta } from '@cadence/shared';

/** Translates a validated `{ page, pageSize }` into Prisma's skip/take. */
export function toSkipTake(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    // A page of zero results still reports one page, so the UI has no "page 0".
    totalPages: total === 0 ? 1 : Math.ceil(total / pageSize),
  };
}
