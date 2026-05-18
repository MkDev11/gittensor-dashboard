'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface ListDataConfig<
  T,
  F extends Record<string, unknown>,
  S extends string,
> {
  /** Source list. Pass `undefined` while loading; the hook returns empty derivations. */
  data: T[] | undefined;
  /** Optional full-text predicate. The query string is pre-trimmed and lower-cased. */
  search?: (item: T, query: string) => boolean;
  /** Filter predicates keyed by filter name; each receives the current value for that filter. */
  filters?: { [K in keyof F]: (item: T, value: F[K]) => boolean };
  /** Starting values for every filter declared in `filters`. */
  initialFilters?: F;
  /** Sort comparators keyed by sort name. The hook applies the direction sign. */
  sorts: Record<S, (a: T, b: T) => number>;
  /** Starting sort key + direction (default `'desc'`). */
  initialSort: { key: S; dir?: SortDir };
  /** Direction to apply when switching to a new sort key via `toggleSort` (default `'desc'`). */
  defaultDirFor?: (key: S) => SortDir;
  /** When set, enables incremental rendering — `visible` slices the first `visibleCount` items. */
  pageSize?: number;
}

export interface ListDataResult<
  T,
  F extends Record<string, unknown>,
  S extends string,
> {
  query: string;
  setQuery: (q: string) => void;
  filters: F;
  setFilter: <K extends keyof F>(key: K, value: F[K]) => void;
  sortKey: S;
  sortDir: SortDir;
  toggleSort: (key: S) => void;
  /** Filtered + sorted list (all items). */
  filtered: T[];
  /** `filtered` sliced to the current page window. Equal to `filtered` when `pageSize` is unset. */
  visible: T[];
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Generic fetch-filter-sort-paginate state container. Accepts a sort comparator
 * map and a filter predicate map as config — does not know about columns or UI.
 * Pair with `<SortedTable>` for the table case, or consume the derived slice
 * directly for custom layouts.
 *
 * Perf note: the filter/sort recomputes whenever any of `search` / `filters` /
 * `sorts` change reference. Pages can pass them inline (cheap for the list
 * sizes here); callers handling much larger lists should wrap them with
 * `useMemo` so reference stays stable across renders.
 */
export function useListData<
  T,
  F extends Record<string, unknown> = Record<string, never>,
  S extends string = string,
>(config: ListDataConfig<T, F, S>): ListDataResult<T, F, S> {
  const {
    data,
    search,
    filters: filterFns,
    initialFilters,
    sorts,
    initialSort,
    defaultDirFor,
    pageSize,
  } = config;

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<F>(() => initialFilters ?? ({} as F));
  const [sortKey, setSortKey] = useState<S>(initialSort.key);
  const [sortDir, setSortDir] = useState<SortDir>(initialSort.dir ?? 'desc');
  const [visibleCount, setVisibleCount] = useState<number>(
    pageSize ?? Number.POSITIVE_INFINITY,
  );

  const setFilter = useCallback(
    <K extends keyof F>(key: K, value: F[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const toggleSort = useCallback(
    (key: S) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(defaultDirFor ? defaultDirFor(key) : 'desc');
      }
    },
    [sortKey, defaultDirFor],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const list = data.filter((item) => {
      if (q && search && !search(item, q)) return false;
      if (filterFns) {
        for (const key in filterFns) {
          if (!filterFns[key](item, filters[key])) return false;
        }
      }
      return true;
    });
    const cmp = sorts[sortKey];
    if (cmp) {
      list.sort((a, b) => {
        const c = cmp(a, b);
        return sortDir === 'asc' ? c : -c;
      });
    }
    return list;
  }, [data, query, filters, sortKey, sortDir, search, filterFns, sorts]);

  // Reset the page window whenever the filtered list could shrink/reshape.
  useEffect(() => {
    if (pageSize) setVisibleCount(pageSize);
  }, [pageSize, query, filters, sortKey, sortDir]);

  const visible = useMemo(() => {
    if (!pageSize) return filtered;
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount, pageSize]);

  const hasMore = pageSize ? visibleCount < filtered.length : false;

  const loadMore = useCallback(() => {
    if (!pageSize) return;
    setVisibleCount((c) => Math.min(c + pageSize, filtered.length));
  }, [pageSize, filtered.length]);

  return {
    query,
    setQuery,
    filters,
    setFilter,
    sortKey,
    sortDir,
    toggleSort,
    filtered,
    visible,
    hasMore,
    loadMore,
  };
}
