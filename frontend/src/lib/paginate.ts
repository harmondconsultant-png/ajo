// Paginate.

export interface Page<T> {
  /** Items on the requested page. */
  items: T[];
  /** 1-based page number actually shown (clamped into range). */
  page: number;
  totalPages: number;
  /** 0-based index of the first item on this page within the full list. */
  offset: number;
}

/**
 * Slice `items` into the given 1-based page. Out-of-range pages are clamped, so
 * callers holding a stale page number (e.g. after the list shrinks) still get a
 * valid page back. An empty list yields a single empty page.
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer");
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const offset = (current - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), page: current, totalPages, offset };
}
