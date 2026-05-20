import { useCallback, useEffect, useState } from 'react';
import type { SortDir } from './styles';

export type PRState = 'all' | 'open' | 'draft' | 'merged' | 'closed' | 'mine';
export type PullSortKey = 'opened' | 'updated' | 'closed' | 'author' | 'state';

export interface PullFilters {
  query: string;
  setQuery: (v: string) => void;
  debouncedQuery: string;
  state: PRState;
  setState: (v: PRState) => void;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  author: string;
  setAuthor: (v: string) => void;
  authorsRequested: boolean;
  setAuthorsRequested: (v: boolean) => void;
  sortKey: PullSortKey;
  sortDir: SortDir;
  toggleSort: (key: PullSortKey) => void;
  reset: () => void;
}

export function usePullFilters(): PullFilters {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<PRState>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [author, setAuthor] = useState<string>('all');
  const [authorsRequested, setAuthorsRequested] = useState(false);
  const [sortKey, setSortKey] = useState<PullSortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const toggleSort = useCallback((key: PullSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'author' || key === 'state' ? 'asc' : 'desc');
    }
  }, [sortKey]);

  const reset = useCallback(() => {
    setQuery('');
    setState('all');
    setAuthor('all');
    setAuthorsRequested(false);
    setMineOnly(false);
  }, []);

  return {
    query,
    setQuery,
    debouncedQuery,
    state,
    setState,
    mineOnly,
    setMineOnly,
    author,
    setAuthor,
    authorsRequested,
    setAuthorsRequested,
    sortKey,
    sortDir,
    toggleSort,
    reset,
  };
}
