import { useCallback, useEffect, useState } from 'react';
import type { SortDir } from './styles';

export type IssueState = 'all' | 'open' | 'completed' | 'not_planned' | 'duplicate' | 'closed';
export type IssueSortKey =
  | 'opened'
  | 'updated'
  | 'closed'
  | 'author'
  | 'state'
  | 'comments'
  | 'author_open'
  | 'author_completed'
  | 'author_not_planned'
  | 'author_closed';

export interface IssueFilters {
  query: string;
  setQuery: (v: string) => void;
  debouncedQuery: string;
  state: IssueState;
  setState: (v: IssueState) => void;
  author: string;
  setAuthor: (v: string) => void;
  authorsRequested: boolean;
  setAuthorsRequested: (v: boolean) => void;
  sortKey: IssueSortKey;
  sortDir: SortDir;
  toggleSort: (key: IssueSortKey) => void;
  reset: () => void;
}

export function useIssueFilters(): IssueFilters {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<IssueState>('all');
  const [author, setAuthor] = useState<string>('all');
  const [authorsRequested, setAuthorsRequested] = useState(false);
  const [sortKey, setSortKey] = useState<IssueSortKey>('opened');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce text-search so server-side filtering doesn't refire on every
  // keystroke. 300ms matches the prior inline implementation.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const toggleSort = useCallback((key: IssueSortKey) => {
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
  }, []);

  return {
    query,
    setQuery,
    debouncedQuery,
    state,
    setState,
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
