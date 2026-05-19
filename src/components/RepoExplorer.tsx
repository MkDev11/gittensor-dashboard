'use client';

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  TextInput,
  Text,
  Label,
  Link as PrimerLink,
} from '@primer/react';
import Spinner from '@/components/Spinner';
import {
  SearchIcon,
  RepoIcon,
  StarIcon,
  StarFillIcon,
  ClockIcon,
  CommentIcon,
  IssueOpenedIcon,
  IssueClosedIcon,
  SkipIcon,
  GitPullRequestIcon,
  PersonIcon,
  XIcon,
  EyeIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckIcon,
} from '@primer/octicons-react';
import { ALL_REPOS, type Sn74Repo } from '@/lib/repos';
import { isTracked as repoIsTracked, useTrackedRepos } from '@/lib/tracked-repos';
import { IssueStatusBadge, PullStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime, isRecent } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import Dropdown from '@/components/Dropdown';
import ContentViewer from '@/components/ContentViewer';
import { IssueLabels } from '@/components/IssueLabels';
import SearchInput from '@/components/SearchInput';
import AuthorFilter from '@/components/AuthorFilter';
import AuthorSidebar from '@/components/AuthorSidebar';
import { useSettings } from '@/lib/settings';
import { useToast } from '@/lib/toast';
import { pullStatus } from '@/types/entities';
import type { Issue, IssuesResponse, IssuesMetaResponse, Pull, PullsResponse, PullsMetaResponse } from '@/types/entities';
import { RepoListSkeleton, TableRowsSkeleton } from '@/components/Skeleton';
import { tableHeaderSx, tableCellSx, tableTimeSx } from '@/components/repo-explorer/styles';
import { weightColor, weightFontWeight } from '@/components/repo-explorer/weights';
import { SortHeader } from '@/components/repo-explorer/SortHeader';
import { TabButton } from '@/components/repo-explorer/TabButton';
import { ValidationPicker } from '@/components/repo-explorer/ValidationPicker';
import { ResizeHandle } from '@/components/repo-explorer/ResizeHandle';
import { InlinePagination } from '@/components/repo-explorer/Pagination';
import { useIssueFilters, type IssueState } from '@/components/repo-explorer/useIssueFilters';
import { usePullFilters, type PRState } from '@/components/repo-explorer/usePullFilters';

type RepoSort = 'weight' | 'name' | 'tracked';
type Tab = 'issues' | 'pulls';
type AuthorTarget = { login: string; association?: string | null };
type RelatedPopoverLayout = { placement: 'down' | 'up'; maxHeight: number };
type StickyBadge = { issues: number; pulls: number; priority?: boolean };
interface RepoBadgesResponse {
  repo: string;
  issues_count: number;
  pulls_count: number;
  owner_comments_count: number;
  updated_at: string;
}

// Stable empty array so the relatedPRs fallback doesn't break React.memo on
// rows with no linked PRs (otherwise `?? []` creates a fresh reference each
// render, defeating prop equality).
const EMPTY_PRS: Array<{ number: number; title: string; state: string; merged: number; draft: number; author_login?: string | null }> = [];
const EMPTY_ISSUES: Array<{ number: number; title: string; state: string; state_reason: string | null; author_login: string | null }> = [];

const DEFAULT_RELATED_POPOVER_LAYOUT: RelatedPopoverLayout = { placement: 'down', maxHeight: 420 };

function relatedPopoverLayout(anchor: HTMLElement | null, rowCount: number): RelatedPopoverLayout {
  if (!anchor || typeof window === 'undefined') return DEFAULT_RELATED_POPOVER_LAYOUT;
  const rect = anchor.getBoundingClientRect();
  const estimatedHeight = Math.min(480, 36 + rowCount * 32);
  const spaceBelow = window.innerHeight - rect.bottom - 44;
  const spaceAbove = rect.top - 8;
  const placement = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove ? 'down' : 'up';
  const available = Math.max(120, placement === 'down' ? spaceBelow : spaceAbove);
  return { placement, maxHeight: Math.min(480, available) };
}

function relatedPopoverOffset(layout: RelatedPopoverLayout) {
  return layout.placement === 'up'
    ? { bottom: '100%', mb: 1 }
    : { top: '100%', mt: 1 };
}

function useRelatedPopoverLayout(
  open: boolean,
  rowCount: number,
  anchorRef: React.RefObject<HTMLDivElement | null>,
) {
  const [layout, setLayout] = useState<RelatedPopoverLayout>(DEFAULT_RELATED_POPOVER_LAYOUT);
  const update = useCallback(() => {
    setLayout(relatedPopoverLayout(anchorRef.current, rowCount));
  }, [anchorRef, rowCount]);

  useEffect(() => {
    if (!open) return;
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  return [layout, update] as const;
}

// Placeholder used while the live SN74 list is loading. We can't render with a
// `null` selection without making every downstream read nullable, so we hold a
// dummy entry that yields empty issues/PRs and gets swapped out the moment
// `allRepos` populates (see the `selected`-hydration effect below).
const EMPTY_REPO: Sn74Repo = {
  fullName: '',
  owner: '',
  name: '',
  weight: 0,
  inactiveAt: null,
};

export default function RepoExplorer() {
  const { tracked, toggle: toggleTrack } = useTrackedRepos();
  const [repoQuery, setRepoQuery] = useState('');
  const [repoSort, setRepoSort] = useState<RepoSort>('weight');
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [selected, setSelected] = useState<Sn74Repo>(EMPTY_REPO);
  const [tab, setTabState] = useState<Tab>('issues');

  const {
    query: issueQuery,
    setQuery: setIssueQuery,
    debouncedQuery: debouncedIssueQuery,
    state: issueState,
    setState: setIssueState,
    author: issueAuthor,
    setAuthor: setIssueAuthor,
    authorsRequested: issueAuthorsRequested,
    setAuthorsRequested: setIssueAuthorsRequested,
    sortKey: issueSortKey,
    sortDir: issueSortDir,
    toggleSort: toggleIssueSort,
    reset: resetIssueFilters,
  } = useIssueFilters();

  const {
    query: prQuery,
    setQuery: setPrQuery,
    debouncedQuery: debouncedPrQuery,
    state: prState,
    setState: setPrState,
    mineOnly: prMineOnly,
    setMineOnly: setPrMineOnly,
    author: prAuthor,
    setAuthor: setPrAuthor,
    authorsRequested: prAuthorsRequested,
    setAuthorsRequested: setPrAuthorsRequested,
    sortKey: pullSortKey,
    sortDir: pullSortDir,
    toggleSort: togglePullSort,
    reset: resetPullFilters,
  } = usePullFilters();

  // Filters and per-repo viewing state are scoped to the active repo — reset
  // them when the user switches repos so e.g. an author filter from repo A
  // doesn't carry over to repo B (where that author may not have any issues).
  useEffect(() => {
    resetIssueFilters();
    resetPullFilters();
    setIssuesPage(1);
    setPullsPage(1);
    setExpandedIssue(null);
    setExpandedPull(null);
    setIssueModal(null);
    setPullModal(null);
    setAuthorTarget(null);
    setAuthorPanelActive(false);
    setRenderedAuthorTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.fullName]);
  const [authorTarget, setAuthorTarget] = useState<AuthorTarget | null>(null);
  const [renderedAuthorTarget, setRenderedAuthorTarget] = useState<AuthorTarget | null>(null);
  const [authorPanelActive, setAuthorPanelActive] = useState(false);
  const authorSideRef = useRef<HTMLDivElement | null>(null);
  const [issueModal, setIssueModal] = useState<Issue | null>(null);
  const [pullModal, setPullModal] = useState<Pull | null>(null);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const [expandedPull, setExpandedPull] = useState<number | null>(null);
  const { settings, update, hydrated: settingsReady } = useSettings();
  const me = useMinerLogin();

  // App-level baseline for per-repo new-content badges in the left rail.
  // Loaded from localStorage in a post-mount effect to avoid SSR/CSR
  // hydration mismatch.
  const [appBaseline, setAppBaseline] = useState<string>('');

  // Pagination state
  const [issuesPage, setIssuesPage] = useState(1);
  const [pullsPage, setPullsPage] = useState(1);

  // Resizable pane widths (persisted to localStorage).
  const [leftWidth, setLeftWidth] = useState<number>(360);
  const [sideWidth, setSideWidth] = useState<number>(400);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(localStorage.getItem('gittensor.layoutWidths') ?? '{}');
      if (typeof saved.left === 'number') setLeftWidth(Math.max(220, Math.min(640, saved.left)));
      if (typeof saved.side === 'number') setSideWidth(Math.max(320, Math.min(900, saved.side)));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      'gittensor.layoutWidths',
      JSON.stringify({ left: leftWidth, side: sideWidth })
    );
  }, [leftWidth, sideWidth]);

  const startResize = (which: 'left' | 'side') => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === 'left' ? leftWidth : sideWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      if (which === 'left') {
        setLeftWidth(Math.max(220, Math.min(640, startW + delta)));
      } else {
        // The side panel sits on the right; dragging its handle left enlarges it.
        setSideWidth(Math.max(320, Math.min(900, startW - delta)));
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const switchTab = (next: Tab) => {
    setTabState(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('issue');
      url.searchParams.delete('pull');
      window.history.replaceState({}, '', url.toString());
    }
    setPendingOpen(null);
    // Close any open side / modal panel when switching tabs.
    setIssueModal(null);
    setPullModal(null);
    setAuthorTarget(null);
    setExpandedIssue(null);
    setExpandedPull(null);
  };

  // Pending auto-open from URL params (e.g. notification click).
  const [pendingOpen, setPendingOpen] = useState<{ kind: 'issue' | 'pull'; number: number } | null>(null);
  const searchParams = useSearchParams();
  const [routeReady, setRouteReady] = useState(false);
  // Marks the next `selected` change as URL-driven so the selected-effect
  // below knows to preserve `pendingOpen` (otherwise the user's click on a
  // notification for repo B + issue 13 ends up opening repo A's issue 13
  // because the selected-effect wipes pendingOpen on any selection change).
  const selectedFromUrlRef = useRef(false);

  // (Effect A — hydrate `selected` from `?repo=` — is declared further down,
  // after `allRepos` is in scope.)

  // Effect B: tab + pending-open from URL. Runs only on URL change, not on
  // allRepos updates, so a late user_repos resolution doesn't reopen issues
  // the user already dismissed.
  useEffect(() => {
    if (!searchParams) return;
    const t = searchParams.get('tab');
    if (t === 'issues' || t === 'pulls') setTabState(t);
    const issueParam = searchParams.get('issue');
    const pullParam = searchParams.get('pull');
    if (issueParam) {
      const n = parseInt(issueParam, 10);
      if (Number.isFinite(n)) setPendingOpen({ kind: 'issue', number: n });
    } else if (pullParam) {
      const n = parseInt(pullParam, 10);
      if (Number.isFinite(n)) setPendingOpen({ kind: 'pull', number: n });
    }
    setRouteReady(true);
  }, [searchParams]);

  // Track the very first run so URL ?ipage / ?ppage params can survive
  // initial mount instead of being clobbered by the page-1 reset below.
  const initialPageHydrationRef = useRef(true);

  // Update URL + reset baselines when selection changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const isInitialUrlSync = initialPageHydrationRef.current;
    // When the selection itself was driven by a URL change (notification
    // click), preserve `?issue=` / `?pull=` and `pendingOpen` so the issue
    // actually opens in the new repo. Manual selections from the sidebar
    // still wipe them as before.
    const fromUrl = selectedFromUrlRef.current;
    selectedFromUrlRef.current = false;
    url.searchParams.set('repo', selected.fullName);
    if (!isInitialUrlSync && !fromUrl) {
      url.searchParams.delete('issue');
      url.searchParams.delete('pull');
    }
    window.history.replaceState({}, '', url.toString());
    if (!initialPageHydrationRef.current) {
      setIssuesPage(1);
      setPullsPage(1);
    }
    // Close any open side / modal panel when switching repos.
    if (!isInitialUrlSync && !fromUrl) setPendingOpen(null);
    setIssueModal(null);
    setPullModal(null);
    setExpandedIssue(null);
    setExpandedPull(null);
  }, [selected]);

  // One-shot hydration of page state from URL — runs after the selected-change
  // effect above resets pages to 1, then overrides with the URL value if any.
  useEffect(() => {
    if (!initialPageHydrationRef.current) return;
    initialPageHydrationRef.current = false;
    if (!searchParams) return;
    const ip = parseInt(searchParams.get('ipage') ?? '', 10);
    if (Number.isFinite(ip) && ip > 0) setIssuesPage(ip);
    const pp = parseInt(searchParams.get('ppage') ?? '', 10);
    if (Number.isFinite(pp) && pp > 0) setPullsPage(pp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current page numbers in the URL so reload restores them.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (issuesPage <= 1) url.searchParams.delete('ipage');
    else url.searchParams.set('ipage', String(issuesPage));
    if (pullsPage <= 1) url.searchParams.delete('ppage');
    else url.searchParams.set('ppage', String(pullsPage));
    window.history.replaceState({}, '', url.toString());
  }, [issuesPage, pullsPage]);

  useEffect(() => {
    if (!authorTarget) {
      setAuthorPanelActive(false);
      return;
    }
    setRenderedAuthorTarget(authorTarget);
    const frame = window.requestAnimationFrame(() => setAuthorPanelActive(true));
    return () => window.cancelAnimationFrame(frame);
  }, [authorTarget]);

  useEffect(() => {
    if (!authorTarget) return;
    const onMouseDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (authorSideRef.current?.contains(node)) return;
      setAuthorTarget(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthorTarget(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [authorTarget]);

  // Reset page when filters or sort change so the user always lands on page 1
  // of the new view rather than e.g. page 5 of an empty filter result.
  useEffect(() => {
    setIssuesPage(1);
  }, [issueQuery, issueState, issueAuthor, issueSortKey, issueSortDir]);

  useEffect(() => {
    setPullsPage(1);
  }, [prQuery, prState, prMineOnly, prAuthor, pullSortKey, pullSortDir]);

  const { data: userReposData, isSuccess: userReposReady } = useQuery<{
    count: number;
    repos: Array<{ full_name: string; weight: number; notes: string | null; added_at: string }>;
  }>({
    queryKey: ['user-repos'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/user-repos', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    // 30s — user repos don't change often; aggressive polling caused the
    // left-rail list to visibly re-render every few seconds.
    refetchInterval: 30000,
    staleTime: 20000,
  });

  // Server polls master_repositories.json every 5 min and persists any new
  // repos at weight 0; nothing is ever removed. Client refetches on the same
  // cadence so newly discovered repos appear without a page reload.
  const { data: sn74ReposData, isLoading: sn74ReposLoading, isSuccess: sn74ReposReady } = useQuery<{ repos: Sn74Repo[]; source: 'live' | 'empty'; count: number }>({
    queryKey: ['sn74-repos'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/sn74-repos', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const sn74Repos: Sn74Repo[] = sn74ReposData?.repos ?? ALL_REPOS;

  const allRepos = useMemo(() => {
    const sn74Set = new Set(sn74Repos.map((r) => r.fullName));
    const userExtras: Sn74Repo[] = (userReposData?.repos ?? [])
      .filter((u) => !sn74Set.has(u.full_name))
      .map((u) => {
        const [owner, name] = u.full_name.split('/');
        return { fullName: u.full_name, owner, name, weight: u.weight, inactiveAt: null };
      });
    return [...sn74Repos, ...userExtras];
  }, [sn74Repos, userReposData]);

  const visibleRepoNamesByLc = useMemo(() => {
    const m = new Map<string, string>();
    for (const repo of allRepos) m.set(repo.fullName.toLowerCase(), repo.fullName);
    return m;
  }, [allRepos]);
  const repoAllowlistReady = sn74ReposReady && userReposReady;

  const userRepoNames = useMemo(
    () => new Set((userReposData?.repos ?? []).map((u) => u.full_name)),
    [userReposData]
  );

  // Effect A (declared here so `allRepos` is in scope): hydrate `selected`
  // from `?repo=`. Re-runs when allRepos grows (e.g. user_repos query
  // resolves) so notifications targeting custom repositories — which aren't
  // in ALL_REPOS — still resolve once their entries arrive.
  //
  // Note `selected.fullName` is intentionally NOT a dependency. Including it
  // caused a feedback loop: a manual sidebar click would update `selected`,
  // re-run this effect with the old (stale) `searchParams`, and revert the
  // selection back to the URL's previous repo, which then bounced back when
  // the URL caught up. The functional setter below makes the equality check
  // self-contained without needing the dep.
  useEffect(() => {
    const urlRepo = searchParams?.get('repo') ?? null;
    setSelected((prev) => {
      // Prefer the URL-specified repo when present.
      if (urlRepo) {
        if (prev.fullName === urlRepo) return prev;
        const found = allRepos.find((x) => x.fullName === urlRepo);
        if (!found) return prev;
        selectedFromUrlRef.current = true;
        return found;
      }
      // No `?repo=` and we're still on the placeholder: promote the
      // first real repo from the live list so the page has something
      // to render once `/api/sn74-repos` lands.
      if (!prev.fullName && allRepos.length > 0) return allRepos[0];
      return prev;
    });
  }, [searchParams, allRepos]);

  // Per-row valid/invalid mutation. Optimistically patches every cached
  // issues query so the picker flips on the next paint — no waiting on the
  // server roundtrip. We avoid a global invalidate because re-fetching the
  // whole page after every click feels worse than the optimistic flip.
  const queryClient = useQueryClient();
  const toast = useToast();
  const setValidation = useMutation({
    mutationFn: async ({ number, status }: { number: number; status: 'valid' | 'invalid' | null }) => {
      const r = await fetch(`/api/repos/${selected.owner}/${selected.name}/validations/${number}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onMutate: async ({ number, status }) => {
      const patch = (data: IssuesResponse | undefined) => {
        if (!data) return data;
        const next: Record<number, 'valid' | 'invalid'> = { ...(data.user_validations ?? {}) };
        if (status === null) delete next[number];
        else next[number] = status;
        return { ...data, user_validations: next };
      };
      const snapshots: Array<[unknown, unknown]> = [];
      queryClient.getQueriesData<IssuesResponse>({ queryKey: ['issues'] }).forEach(([key, data]) => {
        snapshots.push([key, data]);
        queryClient.setQueryData(key, patch(data));
      });
      queryClient.getQueriesData<{ pages: IssuesResponse[]; pageParams: unknown[] }>({ queryKey: ['issues-inf'] }).forEach(
        ([key, data]) => {
          snapshots.push([key, data]);
          if (data?.pages) {
            queryClient.setQueryData(key, {
              ...data,
              pages: data.pages.map((p) => patch(p) as IssuesResponse),
            });
          }
        },
      );
      return { snapshots };
    },
    onSuccess: (_data, { number, status }) => {
      const repo = `${selected.owner}/${selected.name}`;
      if (status === null) {
        toast.push({
          title: `Cleared mark on #${number}`,
          body: repo,
          variant: 'info',
          icon: 'issue',
          ttlMs: 3000,
        });
      } else {
        toast.push({
          title: status === 'valid' ? `Marked #${number} as valid` : `Marked #${number} as invalid`,
          body: repo,
          variant: status === 'valid' ? 'success' : 'warning',
          icon: 'issue',
          ttlMs: 3000,
        });
      }
    },
    onError: (_err, vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key as readonly unknown[], data));
      toast.push({
        title: `Couldn't update #${vars.number}`,
        body: 'Please try again',
        variant: 'danger',
        icon: 'issue',
        ttlMs: 4000,
      });
    },
  });

  // Inactive flag comes straight from SN74's master_repositories.json — the
  // validator team marks repos with `inactive_at` when they're deprioritised
  // and miners can't earn rewards from them. Authoritative, no heuristics.
  const filteredRepos = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    let list = allRepos.filter((r) => !q || r.fullName.toLowerCase().includes(q));
    if (trackedOnly) list = list.filter((r) => repoIsTracked(tracked, r.fullName));
    return [...list].sort((a, b) => {
      // Tracked (starred) repos always float to the top so the user's pinned
      // selection is one click away regardless of the chosen secondary sort.
      const at = repoIsTracked(tracked, a.fullName) ? 1 : 0;
      const bt = repoIsTracked(tracked, b.fullName) ? 1 : 0;
      if (at !== bt) return bt - at;
      // Inactive repos sink to the bottom of each tracked/untracked group.
      const ai = a.inactiveAt != null ? 1 : 0;
      const bi = b.inactiveAt != null ? 1 : 0;
      if (ai !== bi) return ai - bi;
      if (repoSort === 'name') return a.fullName.localeCompare(b.fullName);
      return b.weight - a.weight;
    });
  }, [allRepos, repoQuery, repoSort, trackedOnly, tracked]);

  const issuesPageSize = settings.pageSize > 0 ? settings.pageSize : 50;
  // `selected.fullName === ''` is the `EMPTY_REPO` placeholder we hold before
  // `allRepos` arrives. Gating queries on this prevents firing `/api/repos//…`
  // requests with empty owner/name path segments — the server would just
  // return empty payloads but it's wasted work.
  const queriesReady = settingsReady && routeReady && selected.fullName !== '';
  const shouldLoadIssues = tab === 'issues';

  const buildIssuesUrl = (page: number, size: number) => {
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('pageSize', String(size));
    if (debouncedIssueQuery) sp.set('q', debouncedIssueQuery);
    if (issueState !== 'all') sp.set('state', issueState);
    // `__assoc:` prefix is the front-end sentinel for the "Collaborators" /
    // "Contributors" pseudo-options at the top of the author dropdown — they
    // map to GitHub's author_association field, not a specific login.
    if (issueAuthor.startsWith('__assoc:')) {
      sp.set('assoc', issueAuthor.slice('__assoc:'.length));
    } else if (issueAuthor !== 'all') {
      sp.set('author', issueAuthor);
    }
    sp.set('sort', issueSortKey);
    sp.set('dir', issueSortDir);
    return `/api/repos/${selected.owner}/${selected.name}/issues?${sp.toString()}`;
  };

  const issuesPaged = useQuery<IssuesResponse>({
    queryKey: [
      'issues',
      selected.owner,
      selected.name,
      issuesPage,
      issuesPageSize,
      debouncedIssueQuery,
      issueState,
      issueAuthor,
      issueSortKey,
      issueSortDir,
    ],
    queryFn: async ({ signal }) => {
      const r = await fetch(buildIssuesUrl(issuesPage, issuesPageSize), { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
    staleTime: 10000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: queriesReady && shouldLoadIssues,
  });

  const issuesData = issuesPaged.data;
  const issuesLoading = issuesPaged.isLoading;

  // Repo-wide author list + per-author counts. Refresh slowly because these
  // change much less often than the listing itself.
  const { data: issuesMeta, isFetching: issuesMetaFetching } = useQuery<IssuesMetaResponse>({
    queryKey: ['issues-meta', selected.owner, selected.name, issueAuthorsRequested],
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams();
      if (!issueAuthorsRequested) sp.set('summary', '1');
      const r = await fetch(`/api/repos/${selected.owner}/${selected.name}/issues-meta?${sp.toString()}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    enabled: queriesReady && shouldLoadIssues,
  });

  // Linked PRs + per-author stats now come inlined in `issuesData` per page,
  // so we no longer fetch the bulk /api/related-prs map (the openclaw response
  // was 3 MB / 50 s for that endpoint). Same idea for `issuesMeta.author_stats`
  // which is no longer requested by the client.
  const relatedMapData: { map: Record<number, Array<{ number: number; title: string; state: string; merged: number; draft: number; author_login?: string | null }>> } | undefined = issuesData
    ? { map: (issuesData as IssuesResponse).linked_prs_by_issue ?? {} }
    : undefined;

  const { data: repoBadges } = useQuery<RepoBadgesResponse>({
    queryKey: ['repo-badges', selected.owner, selected.name],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/repos/${selected.owner}/${selected.name}/badges`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: queriesReady,
    staleTime: 60000,
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });

  // Hydration flag — set to true after initial post-mount localStorage load
  // so persistence effects can run safely.
  const [hydrated, setHydrated] = useState(false);

  // Per-repo "viewed at" timestamps so badges clear when user selects the repo.
  const [viewedAt, setViewedAt] = useState<Record<string, string>>({});

  // Sticky badge counts per repo. Once a badge appears, it stays at the max
  // count seen — only resets when the user actually clicks the repo. The
  // `priority` flag is set when an owner or collaborator opens an issue
  // there, and unlike the count it persists across renders until the user
  // visits the repo (the sidebar row gets a yellow accent border).
  const [stickyBadges, setStickyBadges] = useState<Record<string, StickyBadge>>({});

  const { data: activityData } = useQuery<{
    since: string;
    activity: Record<string, { repo: string; issues: number; pulls: number }>;
  }>({
    queryKey: ['repo-activity', appBaseline],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/repo-activity?since=${encodeURIComponent(appBaseline)}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
    staleTime: 10000,
    refetchOnWindowFocus: false,
    enabled: hydrated && !!appBaseline,
  });

  useEffect(() => {
    if (!hydrated) return;
    setViewedAt((prev) => {
      const next = { ...prev, [selected.fullName]: new Date().toISOString() };
      if (typeof window !== 'undefined') {
        localStorage.setItem('gittensor.viewedAt', JSON.stringify(next));
      }
      return next;
    });
    // Drop the sticky badge entry (counts + priority highlight) for the repo
    // the user just opened — they've seen the new content.
    setStickyBadges((prev) => {
      if (!prev[selected.fullName]) return prev;
      const next = { ...prev };
      delete next[selected.fullName];
      return next;
    });
  }, [selected, hydrated]);

  // Load persisted state once on mount (post-hydration).
  useEffect(() => {
    try {
      const v = localStorage.getItem('gittensor.viewedAt');
      if (v) setViewedAt(JSON.parse(v));
      const s = localStorage.getItem('gittensor.stickyBadges');
      if (s) setStickyBadges(JSON.parse(s));
      let b = localStorage.getItem('gittensor.appBaseline');
      if (!b) {
        b = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        localStorage.setItem('gittensor.appBaseline', b);
      }
      setAppBaseline(b);
    } catch {
      /* noop */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hydrated) return;
    localStorage.setItem('gittensor.stickyBadges', JSON.stringify(stickyBadges));
  }, [stickyBadges, hydrated]);

  // Keep a ref to the latest viewedAt so the activity-data effect can read
  // it without making it a dependency. setViewedAt always allocates a new
  // object (fresh timestamp on each repo selection), so depending on
  // `viewedAt` directly made this effect re-fire on every click. The
  // setStickyBadges updater below bails out via `return prev`, but React's
  // per-call depth counter still incremented — eventually tripping
  // "Maximum update depth exceeded".
  const viewedAtRef = useRef(viewedAt);
  useEffect(() => {
    viewedAtRef.current = viewedAt;
  }, [viewedAt]);

  useEffect(() => {
    if (!hydrated || !repoAllowlistReady) return;
    setStickyBadges((prev) => {
      let changed = false;
      const next: Record<string, StickyBadge> = {};
      for (const [repo, badge] of Object.entries(prev)) {
        const canonicalRepo = visibleRepoNamesByLc.get(repo.toLowerCase());
        if (!canonicalRepo) {
          changed = true;
          continue;
        }
        const existing = next[canonicalRepo];
        if (existing) {
          const merged: StickyBadge = {
            issues: Math.max(existing.issues, badge.issues),
            pulls: Math.max(existing.pulls, badge.pulls),
          };
          if (existing.priority || badge.priority) merged.priority = true;
          next[canonicalRepo] = merged;
          changed = true;
        } else {
          next[canonicalRepo] = badge;
          if (canonicalRepo !== repo) changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [hydrated, repoAllowlistReady, visibleRepoNamesByLc]);

  useEffect(() => {
    if (!activityData?.activity || !repoAllowlistReady) return;
    setStickyBadges((prev) => {
      let changed = false;
      const next = { ...prev };
      const viewed = viewedAtRef.current;
      for (const [repo, info] of Object.entries(activityData.activity)) {
        const canonicalRepo = visibleRepoNamesByLc.get(repo.toLowerCase());
        if (!canonicalRepo || viewed[canonicalRepo]) continue;
        const cur = next[canonicalRepo] ?? { issues: 0, pulls: 0 };
        const mergedIssues = Math.max(cur.issues, info.issues);
        const mergedPulls = Math.max(cur.pulls, info.pulls);
        if (mergedIssues !== cur.issues || mergedPulls !== cur.pulls) {
          next[canonicalRepo] = { issues: mergedIssues, pulls: mergedPulls };
          changed = true;
        }
      }
      // Skip the state update entirely when nothing actually changed —
      // returning `prev` lets React bail out of the re-render.
      return changed ? next : prev;
    });
  }, [activityData, repoAllowlistReady, visibleRepoNamesByLc]);

  // When user views a repo, drop its sticky badge entry.
  useEffect(() => {
    setStickyBadges((prev) => {
      if (!prev[selected.fullName]) return prev;
      const next = { ...prev };
      delete next[selected.fullName];
      return next;
    });
  }, [selected]);

  // Auto-scroll the left rail to bring the selected repo into view
  // (e.g. when navigating via notification or URL).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = setTimeout(() => {
      const el = document.querySelector(`[data-repo-fullname="${CSS.escape(selected.fullName)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(id);
  }, [selected]);

  // Listen for direct "new content" events from the toast watcher so a badge
  // appears immediately, independent of the activity polling loop.
  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ repo: string; kind: 'issue' | 'pull'; priority?: boolean }>;
      if (!e.detail) return;
      const { repo, kind, priority } = e.detail;
      const canonicalRepo = visibleRepoNamesByLc.get(repo.toLowerCase());
      if (!canonicalRepo || canonicalRepo === selected.fullName) return; // currently viewing — no badge needed
      setStickyBadges((prev) => {
        const cur = prev[canonicalRepo] ?? { issues: 0, pulls: 0 };
        return {
          ...prev,
          [canonicalRepo]: {
            issues: cur.issues + (kind === 'issue' ? 1 : 0),
            pulls: cur.pulls + (kind === 'pull' ? 1 : 0),
            // Priority is sticky once set — sticks until the user views the
            // repo (which clears the whole entry below).
            priority: cur.priority || !!priority,
          },
        };
      });
    };
    window.addEventListener('gittensor-new-content', handler as EventListener);
    return () => window.removeEventListener('gittensor-new-content', handler as EventListener);
  }, [selected, visibleRepoNamesByLc]);

  // Total unread count across visible repos.
  const totalUnread = useMemo(() => {
    let count = 0;
    for (const [repo, v] of Object.entries(stickyBadges)) {
      if (!visibleRepoNamesByLc.has(repo.toLowerCase())) continue;
      count += (v.issues ?? 0) + (v.pulls ?? 0);
    }
    return count;
  }, [stickyBadges, visibleRepoNamesByLc]);

  const markAllAsRead = () => {
    const now = new Date().toISOString();
    // Mark every repo with a sticky badge as viewed
    setViewedAt((prev) => {
      const next = { ...prev };
      for (const repo of Object.keys(stickyBadges)) {
        next[repo] = now;
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('gittensor.viewedAt', JSON.stringify(next));
      }
      return next;
    });
    setStickyBadges({});
  };

  const pullsPageSize = settings.pageSize > 0 ? settings.pageSize : 50;
  const pullsState = prMineOnly ? 'mine' : prState;
  const shouldLoadPulls = tab === 'pulls';

  const buildPullsUrl = (page: number, size: number) => {
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('pageSize', String(size));
    if (debouncedPrQuery) sp.set('q', debouncedPrQuery);
    if (pullsState !== 'all') sp.set('state', pullsState);
    if (prAuthor !== 'all') sp.set('author', prAuthor);
    sp.set('sort', pullSortKey);
    sp.set('dir', pullSortDir);
    if (me) sp.set('mine_login', me);
    return `/api/repos/${selected.owner}/${selected.name}/pulls?${sp.toString()}`;
  };

  const pullsPaged = useQuery<PullsResponse>({
    queryKey: [
      'pulls',
      selected.owner,
      selected.name,
      pullsPage,
      pullsPageSize,
      debouncedPrQuery,
      pullsState,
      prAuthor,
      pullSortKey,
      pullSortDir,
      me,
    ],
    queryFn: async ({ signal }) => {
      const r = await fetch(buildPullsUrl(pullsPage, pullsPageSize), { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
    staleTime: 10000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: queriesReady && shouldLoadPulls,
  });

  const pullsData = pullsPaged.data;
  const pullsLoading = pullsPaged.isLoading;

  const openLinkedPullRequest = useCallback(
    async (prNumber: number) => {
      setAuthorTarget(null);
      setIssueModal(null);
      setExpandedIssue(null);
      setExpandedPull(null);

      let pr = pullsData?.pulls.find((p) => p.number === prNumber) ?? null;
      if (!pr) {
        try {
          const r = await fetch(`/api/pull/${selected.owner}/${selected.name}/${prNumber}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          pr = (await r.json()) as Pull;
        } catch (err) {
          console.warn('[explorer] could not open linked PR:', err);
          return;
        }
      }

      if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
        setPullModal(pr);
        return;
      }

      setTabState('pulls');
      setExpandedPull(pr.number);
    },
    [pullsData?.pulls, selected.owner, selected.name, settings.contentDisplay],
  );

  const openAuthorSidebar = useCallback((login: string, association?: string | null) => {
    setIssueModal(null);
    setPullModal(null);
    setExpandedIssue(null);
    setExpandedPull(null);
    setAuthorTarget({ login, association });
  }, []);

  const openIssueFromAuthorSidebar = useCallback(
    (issue: Issue) => {
      setAuthorTarget(null);
      setPullModal(null);
      setExpandedPull(null);

      if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
        setIssueModal(issue);
        return;
      }

      setTabState('issues');
      setExpandedIssue(issue.number);
    },
    [settings.contentDisplay],
  );

  const { data: pullsMeta, isFetching: pullsMetaFetching } = useQuery<PullsMetaResponse>({
    queryKey: ['pulls-meta', selected.owner, selected.name, me, prAuthorsRequested],
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams();
      if (me) sp.set('mine_login', me);
      if (!prAuthorsRequested) sp.set('summary', '1');
      const r = await fetch(`/api/repos/${selected.owner}/${selected.name}/pulls-meta?${sp.toString()}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: queriesReady && shouldLoadPulls,
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  // Resolve a pending auto-open (from notification / URL param).
  // Always fetches directly from the API to avoid races with the cached
  // useQuery data which may still be for the previous repo.
  useEffect(() => {
    if (!pendingOpen) return;
    const useOverlay = settings.contentDisplay === 'modal' || settings.contentDisplay === 'side';
    const { kind, number: num } = pendingOpen;
    let cancelled = false;

    const open = async () => {
      const path = kind === 'issue'
        ? `/api/issue/${selected.owner}/${selected.name}/${num}`
        : `/api/pull/${selected.owner}/${selected.name}/${num}`;
      try {
        const r = await fetch(path);
        if (!r.ok) {
          if (!cancelled) setPendingOpen(null);
          return;
        }
        const data = await r.json();
        if (cancelled) return;

        setAuthorTarget(null);
        if (kind === 'issue') {
          setTabState('issues');
          if (useOverlay) {
            setIssueModal(data as Issue);
            setPullModal(null);
            setExpandedIssue(null);
          } else {
            setIssueModal(null);
            setPullModal(null);
            setExpandedIssue((data as Issue).number);
            setTimeout(() => {
              document
                .querySelector(`[data-issue-number="${(data as Issue).number}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
          }
        } else {
          setTabState('pulls');
          if (useOverlay) {
            setPullModal(data as Pull);
            setIssueModal(null);
            setExpandedPull(null);
          } else {
            setPullModal(null);
            setIssueModal(null);
            setExpandedPull((data as Pull).number);
            setTimeout(() => {
              document
                .querySelector(`[data-pull-number="${(data as Pull).number}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
          }
        }
        setPendingOpen(null);
      } catch {
        if (!cancelled) setPendingOpen(null);
      }
    };

    void open();

    return () => {
      cancelled = true;
    };
  }, [pendingOpen, selected.owner, selected.name, settings.contentDisplay]);

  // Server already applied filter/sort/pagination — just hand the rows back.
  const filteredPulls = pullsData?.pulls ?? [];

  const myPullCount = pullsMeta?.mine_count ?? 0;

  // Server returns `new_count` based on the per-tab baseline we sent.
  const newIssuesCount = issuesData?.new_count ?? 0;
  const newPullsCount = pullsData?.new_count ?? 0;
  const issueTabCount = issuesData?.count ?? repoBadges?.issues_count;
  const pullTabCount = pullsData?.count ?? repoBadges?.pulls_count;

  const pageSize = settings.pageSize > 0 ? settings.pageSize : 50;

  // Per-author OPEN/DONE/NP counts come from the meta endpoint (repo-wide,
  // independent of the current page). Adapted into a Map for the existing
  // render code that calls .get(login).
  // Per-author stats now come from the page response — only contains stats
  // for the ~50 authors visible on the current page rather than all 15k.
  const issueAuthorStats = useMemo(() => {
    const map = new Map<string, { open: number; completed: number; not_planned: number; closed: number }>();
    const stats = (issuesData as IssuesResponse | undefined)?.page_author_stats;
    if (!stats) return map;
    for (const [login, s] of Object.entries(stats)) {
      map.set(login, s);
    }
    return map;
  }, [issuesData]);

  const filteredIssues = useMemo(() => issuesData?.issues ?? [], [issuesData]);

  const issueAuthorOptions = useMemo(() => issuesMeta?.author_options ?? [], [issuesMeta]);


  const prAuthorOptions = useMemo(() => pullsMeta?.author_options ?? [], [pullsMeta]);

  // Pagination math now reads `count` (total matching the current filter) from
  // the server response. The "paged" lists are just the rows the server
  // returned — no additional client-side slicing needed.
  const issueTotalCount = issuesData?.count ?? 0;
  const pullTotalCount = pullsData?.count ?? 0;
  const issueTotalPages = Math.max(1, Math.ceil(issueTotalCount / pageSize));
  const pullTotalPages = Math.max(1, Math.ceil(pullTotalCount / pageSize));
  const safeIssuesPage = Math.min(issuesPage, issueTotalPages);
  const safePullsPage = Math.min(pullsPage, pullTotalPages);
  const pagedIssues = filteredIssues;
  const pagedPulls = filteredPulls;

  useEffect(() => {
    if (issuesData && issuesPage > issueTotalPages) setIssuesPage(issueTotalPages);
  }, [issuesData, issuesPage, issueTotalPages]);

  useEffect(() => {
    if (pullsData && pullsPage > pullTotalPages) setPullsPage(pullTotalPages);
  }, [pullsData, pullsPage, pullTotalPages]);

  const renderedRepos = hydrated ? filteredRepos : [];
  const renderedRepoCount = hydrated ? filteredRepos.length : 0;
  const renderedAllRepoCount = hydrated ? allRepos.length : 0;
  const renderedTrackedCount = hydrated ? tracked.size : 0;
  const renderedTotalUnread = hydrated ? totalUnread : 0;
  const renderedIssueTabCount = hydrated ? issueTabCount : undefined;
  const renderedPullTabCount = hydrated ? pullTabCount : undefined;
  const renderedNewIssuesCount = hydrated ? newIssuesCount : 0;
  const renderedNewPullsCount = hydrated ? newPullsCount : 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: ['column', null, null, null, 'row'], height: ['auto', null, null, null, 'calc(100vh - var(--header-height) - 36px)'], minHeight: [0, null, null, null, 600], position: 'relative', overflow: ['visible', null, null, null, 'hidden'] }}>
      {/* LEFT: REPO LIST */}
      <Box
        style={{ '--repo-explorer-left-width': `${leftWidth}px` } as React.CSSProperties}
        sx={{
          width: ['100%', null, null, null, 'var(--repo-explorer-left-width)'],
          maxHeight: ['42vh', null, null, null, 'none'],
          flexShrink: 0,
          bg: 'var(--bg-canvas)',
          display: 'flex',
          flexDirection: 'column',
          borderBottom: ['1px solid var(--border-default)', null, null, null, 'none'],
        }}
      >
        <Box sx={{ p: 3, borderBottom: '1px solid', borderColor: 'var(--border-default)', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
            <Text sx={{ fontWeight: 600, fontSize: 1, color: 'var(--fg-default)', whiteSpace: 'nowrap' }}>Repositories</Text>
            <Text sx={{ color: 'var(--fg-muted)', fontSize: 0, whiteSpace: 'nowrap' }}>
              {renderedRepoCount} of {renderedAllRepoCount}
            </Text>
            {renderedTotalUnread > 0 && (
              <Box
                as="button"
                onClick={markAllAsRead}
                title={`Clear ${renderedTotalUnread} unread badge${renderedTotalUnread === 1 ? '' : 's'}`}
                sx={{
                  ml: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  px: '8px',
                  py: '3px',
                  border: '1px solid',
                  borderColor: 'var(--border-default)',
                  bg: 'var(--bg-canvas)',
                  color: 'var(--fg-muted)',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  transition: 'border-color 80ms, color 80ms',
                  '&:hover': { borderColor: 'var(--accent-emphasis)', color: 'var(--accent-fg)' },
                }}
              >
                <CheckIcon size={11} />
                Mark all read · {renderedTotalUnread}
              </Box>
            )}
          </Box>
          <Box sx={{ mb: 2, width: '100%' }}>
            <SearchInput
              value={repoQuery}
              onChange={setRepoQuery}
              placeholder="Filter repos…"
              width="100%"
              ariaLabel="Filter repositories"
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Dropdown
                value={repoSort}
                onChange={(v) => setRepoSort(v as RepoSort)}
                options={[
                  { value: 'weight', label: 'By weight' },
                  { value: 'name', label: 'By name' },
                  { value: 'tracked', label: 'Tracked first' },
                ]}
                width="100%"
                ariaLabel="Sort repos"
              />
            </Box>
            <Box
              onClick={() => setTrackedOnly((v) => !v)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: '10px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: trackedOnly ? 'var(--attention-emphasis)' : 'var(--border-default)',
                bg: trackedOnly ? 'var(--attention-subtle, rgba(242, 201, 76, 0.16))' : 'var(--bg-canvas)',
                color: trackedOnly ? 'var(--attention-emphasis)' : 'var(--fg-default)',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                userSelect: 'none',
              }}
              title="Show only tracked repos"
            >
              {trackedOnly ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
              <Text>{renderedTrackedCount}</Text>
            </Box>
          </Box>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {renderedRepos.map((repo) => {
            const isSelected = repo.fullName === selected.fullName;
            const isTracked = repoIsTracked(tracked, repo.fullName);
            const sticky = stickyBadges[repo.fullName];
            const inactive = repo.inactiveAt != null;
            const inactiveAt = repo.inactiveAt;
            const newIssues = isSelected ? 0 : sticky?.issues ?? 0;
            const newPulls = isSelected ? 0 : sticky?.pulls ?? 0;
            // Priority highlight stays on until the user opens the repo —
            // owner/collaborator-filed issues are time-sensitive and the
            // user asked for them to stand out in this list.
            const priority = !isSelected && !!sticky?.priority;
            return (
              <Box
                key={repo.fullName}
                data-repo-fullname={repo.fullName}
                onClick={() => setSelected(repo)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 3,
                  py: 2,
                  borderBottom: '1px solid',
                  borderColor: 'var(--border-muted)',
                  cursor: 'pointer',
                  bg: isSelected
                    ? 'var(--bg-emphasis)'
                    : priority
                    ? 'var(--attention-subtle)'
                    : 'transparent',
                  borderLeft: '3px solid',
                  borderLeftColor: isSelected
                    ? 'var(--accent-emphasis)'
                    : priority
                    ? 'var(--attention-emphasis)'
                    : 'transparent',
                  '&:hover': {
                    bg: isSelected
                      ? 'var(--bg-emphasis)'
                      : priority
                      ? 'var(--attention-subtle-strong)'
                      : 'var(--bg-subtle)',
                  },
                }}
              >
                <Box
                  as="button"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    toggleTrack(repo.fullName);
                  }}
                  sx={{
                    cursor: 'pointer',
                    border: 'none',
                    bg: 'transparent',
                    color: isTracked ? 'var(--attention-emphasis)' : 'var(--fg-muted)',
                    p: 1,
                    borderRadius: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    '&:hover': { color: 'var(--attention-emphasis)' },
                  }}
                >
                  {isTracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
                </Box>
                <RepoIcon size={14} />
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Text
                    sx={{
                      fontWeight: isSelected ? 600 : 500,
                      color: inactive ? 'var(--fg-muted)' : 'var(--fg-default)',
                      fontSize: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                      flex: '0 1 auto',
                    }}
                  >
                    {repo.fullName}
                  </Text>
                  {inactive && (
                    <Box
                      title={
                        inactiveAt
                          ? `SN74 marked this repo inactive on ${inactiveAt.slice(0, 10)} — miners earn no rewards from it.`
                          : 'SN74 marked this repo inactive — miners earn no rewards from it.'
                      }
                      sx={{
                        flexShrink: 0,
                        px: '6px',
                        py: 0,
                        fontSize: '10px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        borderRadius: 999,
                        bg: 'var(--bg-emphasis)',
                        color: 'var(--fg-muted)',
                        border: '1px solid var(--border-default)',
                        lineHeight: '16px',
                      }}
                    >
                      Inactive
                    </Box>
                  )}
                </Box>
                {(newIssues > 0 || newPulls > 0) && (
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      flexShrink: 0,
                    }}
                    title={`${newIssues} new issue${newIssues === 1 ? '' : 's'}, ${newPulls} new PR${newPulls === 1 ? '' : 's'} since you last viewed`}
                  >
                    {newIssues > 0 && (
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          px: '5px',
                          py: '1px',
                          bg: 'var(--success-emphasis)',
                          color: '#ffffff',
                          fontSize: '10px',
                          fontWeight: 700,
                          borderRadius: 999,
                          lineHeight: 1.4,
                        }}
                      >
                        <IssueOpenedIcon size={9} />
                        {newIssues}
                      </Box>
                    )}
                    {newPulls > 0 && (
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          px: '5px',
                          py: '1px',
                          bg: 'var(--accent-emphasis)',
                          color: '#ffffff',
                          fontSize: '10px',
                          fontWeight: 700,
                          borderRadius: 999,
                          lineHeight: 1.4,
                        }}
                      >
                        <GitPullRequestIcon size={9} />
                        {newPulls}
                      </Box>
                    )}
                  </Box>
                )}
                {userRepoNames.has(repo.fullName) && (
                  <Box
                    sx={{
                      px: '5px',
                      py: '1px',
                      bg: 'var(--accent-subtle)',
                      color: 'var(--accent-fg)',
                      fontSize: '9px',
                      fontWeight: 700,
                      borderRadius: 999,
                      flexShrink: 0,
                      letterSpacing: '0.4px',
                      textTransform: 'uppercase',
                    }}
                    title="Added from Manage Repositories"
                  >
                    Custom
                  </Box>
                )}
                <Text
                  sx={{
                    fontFamily: 'mono',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 1,
                    fontWeight: weightFontWeight(repo.weight),
                    color: weightColor(repo.weight),
                    flexShrink: 0,
                    minWidth: 48,
                    textAlign: 'right',
                  }}
                  title={`SN74 weight ${repo.weight.toFixed(4)}`}
                >
                  {repo.weight.toFixed(3)}
                </Text>
              </Box>
            );
          })}
          {renderedRepos.length === 0 && (
            // Distinguish "still fetching" from "actually no results": before
            // sn74-repos resolves we have no data to compare against the
            // filter, so the empty-state message would be misleading.
            !hydrated || sn74ReposLoading || !sn74ReposData ? (
              <RepoListSkeleton />
            ) : (
              <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 1 }}>
                No repos match your filters.
              </Box>
            )
          )}
        </Box>
      </Box>

      {/* RESIZER: LEFT ↔ MIDDLE */}
      <ResizeHandle onMouseDown={startResize('left')} />

      {/* RIGHT: ISSUES + PRS TABS FOR SELECTED REPO */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: [0, null, null, null, 320], bg: 'var(--bg-canvas)' }}>
        <Box sx={{ p: 3, pb: 0, borderBottom: '1px solid', borderColor: 'var(--border-default)', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 3 }}>
            <RepoIcon size={20} />
            <PrimerLink
              href={`https://github.com/${selected.fullName}`}
              target="_blank"
              rel="noreferrer"
              sx={{ fontWeight: 600, fontSize: 3, color: 'var(--fg-default)', '&:hover': { color: 'var(--accent-fg)' } }}
            >
              {selected.fullName}
            </PrimerLink>
            {repoIsTracked(tracked, selected.fullName) && (
              <Box sx={{ color: 'var(--attention-emphasis)', display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 0 }}>
                <StarFillIcon size={12} />
                <Text>Tracked</Text>
              </Box>
            )}
          </Box>

          {/* Tabs */}
          <Box sx={{ display: 'flex', gap: 4, mb: '-1px' }}>
            <TabButton
              active={tab === 'issues'}
              onClick={() => switchTab('issues')}
              icon={<IssueOpenedIcon size={16} />}
              label="Issues"
              count={renderedIssueTabCount}
              newCount={tab === 'issues' ? 0 : renderedNewIssuesCount}
            />
            <TabButton
              active={tab === 'pulls'}
              onClick={() => switchTab('pulls')}
              icon={<GitPullRequestIcon size={16} />}
              label="Pull Requests"
              count={renderedPullTabCount}
              newCount={tab === 'pulls' ? 0 : renderedNewPullsCount}
            />
          </Box>
        </Box>

        {tab === 'issues' ? (
          <>
            <Box sx={{ p: 3, pt: 3, flexShrink: 0, borderBottom: '1px solid', borderColor: 'var(--border-default)' }}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <SearchInput
                  value={issueQuery}
                  onChange={setIssueQuery}
                  placeholder="Filter issues by title, #, author…"
                  width={320}
                  ariaLabel="Filter issues"
                />
                <Dropdown
                  value={issueState}
                  onChange={(v) => setIssueState(v as IssueState)}
                  options={[
                    { value: 'all', label: 'All states' },
                    { value: 'open', label: 'Open' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'not_planned', label: 'Not planned' },
                    { value: 'duplicate', label: 'Duplicate' },
                    { value: 'closed', label: 'Closed (other)' },
                  ]}
                  width={180}
                  ariaLabel="Filter by state"
                />
                <AuthorFilter
                  value={issueAuthor}
                  onChange={setIssueAuthor}
                  authors={issueAuthorOptions}
                  totalAuthors={issuesMeta?.total_authors}
                  loading={issuesMetaFetching}
                  onOpen={() => setIssueAuthorsRequested(true)}
                  width={420}
                  ariaLabel="Filter issues by author"
                  extraOptions={[
                    {
                      value: '__assoc:collaborator',
                      label: 'Collaborators',
                      count: issuesMeta?.assoc_counts?.collaborator,
                    },
                    {
                      value: '__assoc:contributor',
                      label: 'Contributors',
                      count: issuesMeta?.assoc_counts?.contributor,
                    },
                  ]}
                />
                <Box
                  sx={{
                    ml: ['0', null, 'auto'],
                    width: ['100%', null, 'auto'],
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: ['space-between', null, 'flex-end'],
                    gap: [2, null, 3],
                    flexWrap: 'wrap',
                    color: 'var(--fg-muted)',
                    fontSize: 0,
                  }}
                >
                  {issuesLoading && <Spinner size="sm" tone="muted" />}
                  {issueTotalCount > 0 && (
                    <InlinePagination
                      page={safeIssuesPage}
                      totalPages={issueTotalPages}
                      totalItems={issueTotalCount}
                      pageSize={pageSize}
                      onChange={setIssuesPage}
                      onPageSizeChange={(n) => {
                        update('pageSize', n);
                        setIssuesPage(1);
                      }}
                      rawPageSize={settings.pageSize}
                    />
                  )}
                  {issuesData && (
                    <Text sx={{ width: ['100%', null, 'auto'], textAlign: ['right', null, 'left'], whiteSpace: 'nowrap' }}>
                      synced {formatRelativeTime(issuesData.last_fetch)}
                    </Text>
                  )}
                </Box>
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
              {issueTotalCount === 0 ? (
                issuesLoading || !queriesReady || !issuesData ? (
                  <TableRowsSkeleton
                    rows={10}
                    cols={[
                      { width: 14 },
                      { width: 60 },
                      { flex: 1 },
                      { width: 100 },
                      { width: 28 },
                      { width: 28 },
                      { width: 28 },
                      { width: 28 },
                      { width: 60 },
                      { width: 60 },
                    ]}
                  />
                ) : (
                  <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
                    {issuesData && issuesData.count === 0
                      ? 'No issues cached yet for this repo. The poller will fill it shortly.'
                      : 'No issues match these filters.'}
                  </Box>
                )
              ) : (
                <Box as="table" sx={{ width: '100%', minWidth: 1180, borderCollapse: 'collapse', fontSize: 1 }}>
                  <Box as="thead" sx={{ position: 'sticky', top: 0, bg: 'var(--bg-subtle)', zIndex: 1 }}>
                    <Box as="tr" sx={{ borderBottom: '1px solid', borderColor: 'var(--border-default)' }}>
                      <Box as="th" sx={{ ...tableHeaderSx, width: 28 }}></Box>
                      <SortHeader label="State" sortKey="state" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} />
                      <Box as="th" sx={tableHeaderSx}>Issue</Box>
                      <SortHeader label="Author" sortKey="author" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} />
                      <SortHeader label="Open" sortKey="author_open" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} align="center" />
                      <SortHeader label="Done" sortKey="author_completed" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} align="center" />
                      <SortHeader label="NP" sortKey="author_not_planned" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} align="center" />
                      <SortHeader label="CL" sortKey="author_closed" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} align="center" />
                      <SortHeader label="Opened" sortKey="opened" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} />
                      <SortHeader label="Updated" sortKey="updated" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} />
                      <SortHeader label="Closed" sortKey="closed" current={issueSortKey} dir={issueSortDir} onClick={toggleIssueSort} />
                      <Box as="th" sx={{ ...tableHeaderSx, textAlign: 'center' }}>PRs</Box>
                      <Box as="th" sx={{ ...tableHeaderSx, textAlign: 'center' }}>VAL</Box>
                    </Box>
                  </Box>
                  <Box as="tbody">
                    {pagedIssues.map((issue) => {
                      const expanded = expandedIssue === issue.number;
                      const rowMergedPRCount = relatedMapData?.map
                        ? (relatedMapData.map[issue.number]?.filter((p) => p.merged === 1).length ?? 0)
                        : null;
                      const handleView = () => {
                        setAuthorTarget(null);
                        if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
                          setIssueModal(
                            rowMergedPRCount == null
                              ? issue
                              : { ...issue, merged_pr_count: rowMergedPRCount },
                          );
                          setPullModal(null);
                        } else {
                          setExpandedIssue(expanded ? null : issue.number);
                        }
                      };
                      return (
                        <React.Fragment key={issue.id}>
                          <ExplorerIssueRow
                            issue={issue}
                            expanded={expanded}
                            onView={handleView}
                            authorStats={issue.author_login ? issueAuthorStats.get(issue.author_login) ?? null : null}
                            relatedPRs={relatedMapData?.map?.[issue.number] ?? EMPTY_PRS}
                            mergedPRCount={rowMergedPRCount}
                            validationStatus={
                              (issuesData as IssuesResponse | undefined)?.user_validations?.[issue.number] ?? null
                            }
                            onSetValidation={(next) => setValidation.mutate({ number: issue.number, status: next })}
                            onPRClick={openLinkedPullRequest}
                            onAuthorClick={openAuthorSidebar}
                          />
                          {expanded && settings.contentDisplay === 'accordion' && (
                            <Box as="tr">
                              <Box as="td" colSpan={13} sx={{ p: 0 }}>
                                <ContentViewer
                                  target={{
                                    kind: 'issue',
                                    owner: selected.owner,
                                    name: selected.name,
                                    number: issue.number,
                                    preloaded: issue,
                                  }}
                                  mode="inline"
                                  onClose={() => setExpandedIssue(null)}
                                />
                              </Box>
                            </Box>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </Box>
                </Box>
              )}
              {issueTotalCount > 0 && (
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid', borderColor: 'var(--border-default)' }}>
                  <InlinePagination
                    page={safeIssuesPage}
                    totalPages={issueTotalPages}
                    totalItems={issueTotalCount}
                    pageSize={pageSize}
                    onChange={setIssuesPage}
                    onPageSizeChange={(n) => {
                      update('pageSize', n);
                      setIssuesPage(1);
                    }}
                    rawPageSize={settings.pageSize}
                  />
                </Box>
              )}
            </Box>
          </>
        ) : (
          <>
            <Box sx={{ p: 3, pt: 3, flexShrink: 0, borderBottom: '1px solid', borderColor: 'var(--border-default)' }}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <SearchInput
                  value={prQuery}
                  onChange={setPrQuery}
                  placeholder="Filter PRs by title, #, author…"
                  width={320}
                  ariaLabel="Filter pull requests"
                />
                <Dropdown
                  value={prState}
                  onChange={(v) => setPrState(v as PRState)}
                  options={[
                    { value: 'all', label: 'All states' },
                    { value: 'open', label: 'Open' },
                    { value: 'draft', label: 'Draft' },
                    { value: 'merged', label: 'Merged' },
                    { value: 'closed', label: 'Closed (unmerged)' },
                  ]}
                  width={180}
                  ariaLabel="Filter by PR state"
                />
                <AuthorFilter
                  value={prAuthor}
                  onChange={setPrAuthor}
                  authors={prAuthorOptions}
                  totalAuthors={pullsMeta?.total_authors}
                  loading={pullsMetaFetching}
                  onOpen={() => setPrAuthorsRequested(true)}
                  width={260}
                  ariaLabel="Filter PRs by author"
                />
                <Box
                  as="label"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    px: '12px',
                    py: '5px',
                    height: 32,
                    border: '1px solid',
                    borderColor: prMineOnly ? 'var(--attention-emphasis)' : 'var(--border-default)',
                    bg: prMineOnly ? 'var(--attention-subtle, rgba(242, 201, 76, 0.16))' : 'var(--bg-canvas)',
                    color: prMineOnly ? 'var(--attention-emphasis)' : 'var(--fg-default)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                    userSelect: 'none',
                    transition: 'border-color 80ms, background 80ms, color 80ms',
                    '&:hover': { borderColor: prMineOnly ? 'var(--attention-emphasis)' : 'var(--border-strong)' },
                  }}
                >
                  <input
                    type="checkbox"
                    checked={prMineOnly}
                    onChange={(e) => setPrMineOnly(e.target.checked)}
                    style={{
                      margin: 0,
                      width: 14,
                      height: 14,
                      accentColor: 'var(--attention-emphasis)',
                      cursor: 'pointer',
                    }}
                  />
                  <PersonIcon size={14} />
                  My PRs only
                  {myPullCount > 0 && (
                    <Box
                      sx={{
                        px: '6px',
                        py: 0,
                        bg: prMineOnly ? 'var(--attention-emphasis)' : 'var(--bg-emphasis)',
                        color: prMineOnly ? '#ffffff' : 'var(--fg-default)',
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: 999,
                        lineHeight: '18px',
                      }}
                    >
                      {myPullCount}
                    </Box>
                  )}
                </Box>
                <Box
                  sx={{
                    ml: ['0', null, 'auto'],
                    width: ['100%', null, 'auto'],
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: ['space-between', null, 'flex-end'],
                    gap: [2, null, 3],
                    flexWrap: 'wrap',
                    color: 'var(--fg-muted)',
                    fontSize: 0,
                  }}
                >
                  {pullsLoading && <Spinner size="sm" tone="muted" />}
                  {pullTotalCount > 0 && (
                    <InlinePagination
                      page={safePullsPage}
                      totalPages={pullTotalPages}
                      totalItems={pullTotalCount}
                      pageSize={pageSize}
                      onChange={setPullsPage}
                      onPageSizeChange={(n) => {
                        update('pageSize', n);
                        setPullsPage(1);
                      }}
                      rawPageSize={settings.pageSize}
                    />
                  )}
                  {pullsData && (
                    <Text sx={{ width: ['100%', null, 'auto'], textAlign: ['right', null, 'left'], whiteSpace: 'nowrap' }}>
                      synced {formatRelativeTime(pullsData.last_fetch)}
                    </Text>
                  )}
                </Box>
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
              {pullTotalCount === 0 ? (
                pullsLoading || !queriesReady || !pullsData ? (
                  <TableRowsSkeleton
                    rows={10}
                    cols={[
                      { width: 14 },
                      { width: 60 },
                      { flex: 1 },
                      { width: 100 },
                      { width: 60 },
                      { width: 60 },
                      { width: 60 },
                    ]}
                  />
                ) : (
                  <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
                    {pullsData && pullsData.count === 0
                      ? 'No pull requests cached yet.'
                      : 'No pull requests match these filters.'}
                  </Box>
                )
              ) : (
                <Box as="table" sx={{ width: '100%', minWidth: 960, borderCollapse: 'collapse', fontSize: 1 }}>
                  <Box as="thead" sx={{ position: 'sticky', top: 0, bg: 'var(--bg-subtle)', zIndex: 1 }}>
                    <Box as="tr" sx={{ borderBottom: '1px solid', borderColor: 'var(--border-default)' }}>
                      <Box as="th" sx={{ ...tableHeaderSx, width: 28 }}></Box>
                      <SortHeader label="State" sortKey="state" current={pullSortKey} dir={pullSortDir} onClick={togglePullSort} />
                      <Box as="th" sx={tableHeaderSx}>Pull Request</Box>
                      <SortHeader label="Author" sortKey="author" current={pullSortKey} dir={pullSortDir} onClick={togglePullSort} />
                      <SortHeader label="Opened" sortKey="opened" current={pullSortKey} dir={pullSortDir} onClick={togglePullSort} />
                      <SortHeader label="Updated" sortKey="updated" current={pullSortKey} dir={pullSortDir} onClick={togglePullSort} />
                      <SortHeader label="Merged / Closed" sortKey="closed" current={pullSortKey} dir={pullSortDir} onClick={togglePullSort} />
                      <Box as="th" sx={{ ...tableHeaderSx, textAlign: 'center' }}>Issues</Box>
                    </Box>
                  </Box>
                  <Box as="tbody">
                    {pagedPulls.map((pr) => {
                      const expanded = expandedPull === pr.number;
                      const handleView = () => {
                        setAuthorTarget(null);
                        if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
                          setPullModal(pr);
                          setIssueModal(null);
                        } else {
                          setExpandedPull(expanded ? null : pr.number);
                        }
                      };
                      const linkedIssues = pullsData?.linked_issues_by_pull?.[pr.number] ?? EMPTY_ISSUES;
                      return (
                        <React.Fragment key={pr.id}>
                          <ExplorerPullRow
                            pr={pr}
                            mine={pr.author_login?.toLowerCase() === me.toLowerCase()}
                            expanded={expanded}
                            onView={handleView}
                            linkedIssues={linkedIssues}
                            onIssueClick={(num) => {
                              setPullModal(null);
                              setIssueModal(null);
                              setExpandedPull(null);
                              setExpandedIssue(null);
                              switchTab('issues');
                              setPendingOpen({ kind: 'issue', number: num });
                            }}
                          />
                          {expanded && settings.contentDisplay === 'accordion' && (
                            <Box as="tr">
                              <Box as="td" colSpan={8} sx={{ p: 0 }}>
                                <ContentViewer
                                  target={{
                                    kind: 'pull',
                                    owner: selected.owner,
                                    name: selected.name,
                                    number: pr.number,
                                    preloaded: pr,
                                  }}
                                  mode="inline"
                                  onClose={() => setExpandedPull(null)}
                                />
                              </Box>
                            </Box>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </Box>
                </Box>
              )}
              {pullTotalCount > 0 && (
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid', borderColor: 'var(--border-default)' }}>
                  <InlinePagination
                    page={safePullsPage}
                    totalPages={pullTotalPages}
                    totalItems={pullTotalCount}
                    pageSize={pageSize}
                    onChange={setPullsPage}
                    onPageSizeChange={(n) => {
                      update('pageSize', n);
                      setPullsPage(1);
                    }}
                    rawPageSize={settings.pageSize}
                  />
                </Box>
              )}
            </Box>
          </>
        )}
      </Box>

      {renderedAuthorTarget && (
        <>
          <Box
            onMouseDown={() => setAuthorTarget(null)}
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 29,
              bg: 'transparent',
              pointerEvents: 'auto',
            }}
          />
          <Box
            ref={authorSideRef}
            onTransitionEnd={(e: React.TransitionEvent<HTMLDivElement>) => {
              if (e.propertyName === 'transform' && !authorPanelActive) setRenderedAuthorTarget(null);
            }}
            sx={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: '50vw',
              minWidth: 'min(760px, calc(100vw - 24px))',
              maxWidth: 'calc(100vw - 24px)',
              borderLeft: '1px solid',
              borderColor: 'var(--border-default)',
              bg: 'var(--bg-canvas)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-panel-overlay)',
              transform: authorPanelActive ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 220ms cubic-bezier(0.2, 0, 0, 1)',
              zIndex: 30,
              willChange: 'transform',
            }}
          >
            <AuthorSidebar
              owner={selected.owner}
              name={selected.name}
              repoFullName={selected.fullName}
              login={renderedAuthorTarget.login}
              initialAssociation={renderedAuthorTarget.association ?? null}
              onClose={() => setAuthorTarget(null)}
              onIssueClick={openIssueFromAuthorSidebar}
            />
          </Box>
        </>
      )}

      {/* Side-mode panels — absolute overlay so the table behind keeps its
          original column widths (otherwise opening the panel would shrink
          the table column-by-column). The resize handle sits on the panel's
          left edge as an inner absolute element. */}
      {settings.contentDisplay === 'side' && (issueModal || pullModal) && (
        <Box
          style={{ '--repo-explorer-side-width': `${sideWidth}px` } as React.CSSProperties}
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'var(--repo-explorer-side-width)',
            minWidth: 320,
            maxWidth: '50vw',
            borderLeft: '1px solid',
            borderColor: 'var(--border-default)',
            bg: 'var(--bg-canvas)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 25,
            boxShadow: 'var(--shadow-panel-overlay)',
          }}
        >
          <Box
            onMouseDown={startResize('side')}
            sx={{
              position: 'absolute',
              left: -3,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: 'col-resize',
              zIndex: 1,
            }}
          />
          {issueModal && (
            <ContentViewer
              target={{
                kind: 'issue',
                owner: selected.owner,
                name: selected.name,
                number: issueModal.number,
                preloaded: issueModal,
              }}
              mode="side"
              width={sideWidth}
              onClose={() => setIssueModal(null)}
            />
          )}
          {pullModal && (
            <ContentViewer
              target={{
                kind: 'pull',
                owner: selected.owner,
                name: selected.name,
                number: pullModal.number,
                preloaded: pullModal,
              }}
              mode="side"
              width={sideWidth}
              onClose={() => setPullModal(null)}
            />
          )}
        </Box>
      )}

      {issueModal && settings.contentDisplay === 'modal' && (
        <ContentViewer
          target={{
            kind: 'issue',
            owner: selected.owner,
            name: selected.name,
            number: issueModal.number,
            preloaded: issueModal,
          }}
          mode="modal"
          onClose={() => setIssueModal(null)}
        />
      )}

      {pullModal && settings.contentDisplay === 'modal' && (
        <ContentViewer
          target={{
            kind: 'pull',
            owner: selected.owner,
            name: selected.name,
            number: pullModal.number,
            preloaded: pullModal,
          }}
          mode="modal"
          onClose={() => setPullModal(null)}
        />
      )}

    </Box>
  );
}

function OwnerCommentsTab({
  loading,
  data,
  ownerLogin,
  repoFullName,
}: {
  loading: boolean;
  data:
    | {
        count: number;
        comments: Array<{
          id: number;
          issue_number: number;
          author_login: string | null;
          body: string | null;
          html_url: string | null;
          created_at: string | null;
        }>;
      }
    | undefined;
  ownerLogin: string;
  repoFullName: string;
}) {
  if (loading && !data) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)' }}>
        <Spinner size="sm" tone="muted" />
        <Text>Loading comments…</Text>
      </Box>
    );
  }
  const comments = data?.comments ?? [];
  if (comments.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
        No comments by an owner-association maintainer have been cached for {repoFullName} yet.
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
        {data?.count ?? comments.length} comment{(data?.count ?? comments.length) === 1 ? '' : 's'} by maintainers (
        {ownerLogin} owns {repoFullName})
      </Text>
      {comments.map((c) => (
        <Box
          key={c.id}
          sx={{
            border: '1px solid',
            borderColor: 'var(--border-default)',
            borderRadius: 2,
            p: 3,
            bg: 'var(--bg-subtle)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Text sx={{ fontWeight: 600 }}>{c.author_login ?? 'unknown'}</Text>
            <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
              on #{c.issue_number} · {formatRelativeTime(c.created_at)}
            </Text>
            {c.html_url && (
              <PrimerLink
                href={c.html_url}
                target="_blank"
                rel="noreferrer"
                sx={{ ml: 'auto', color: 'var(--accent-fg)', fontSize: 0 }}
              >
                view on GitHub →
              </PrimerLink>
            )}
          </Box>
          <Text sx={{ color: 'var(--fg-default)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {c.body ?? ''}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

const RecentTime = React.memo(function RecentTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <Text sx={{ color: 'var(--fg-muted)' }}>—</Text>;
  const recent = isRecent(iso);
  if (recent) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bg: 'var(--success-emphasis)',
            display: 'inline-block',
            animation: 'gtPulse 1.6s ease-in-out infinite',
          }}
        />
        <Text
          sx={{
            color: 'var(--success-fg)',
            fontWeight: 700,
            letterSpacing: '0.2px',
          }}
        >
          {formatRelativeTime(iso)}
        </Text>
      </Box>
    );
  }
  return <Text sx={{ color: 'var(--fg-muted)' }}>{formatRelativeTime(iso)}</Text>;
});

const AuthorCell = React.memo(function AuthorCell({
  login,
  association,
  highlight,
  onClick,
}: {
  login: string | null;
  association?: string | null;
  highlight?: boolean;
  onClick?: (login: string, association?: string | null) => void;
}) {
  if (!login) {
    return <Text sx={{ color: 'var(--fg-muted)', fontWeight: 500 }}>unknown</Text>;
  }
  const showAssociation = association && association !== 'NONE';
  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://github.com/${login}.png?size=40`}
        alt={login}
        loading="lazy"
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: '1px solid var(--border-muted)',
          flexShrink: 0,
          display: 'block',
        }}
      />
      <Text
        sx={{
          color: highlight ? 'var(--attention-emphasis)' : 'var(--fg-default)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          '&:hover': { color: 'var(--accent-fg)' },
        }}
      >
        {login}
      </Text>
      {showAssociation && (
        <Label variant="secondary" sx={{ fontSize: '10px', flexShrink: 0 }}>
          {(association ?? '').toLowerCase()}
        </Label>
      )}
    </>
  );
  const sharedStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    textDecoration: 'none',
    color: 'inherit',
    maxWidth: '100%',
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(login, association);
        }}
        style={{
          ...sharedStyle,
          border: 'none',
          background: 'transparent',
          padding: 0,
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={`https://github.com/${login}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={sharedStyle}
    >
      {content}
    </a>
  );
});

const AuthorStatCell = React.memo(function AuthorStatCell({ value, fg, bg }: { value: number | null; fg: string; bg: string }) {
  return (
    <Box as="td" sx={{ ...tableCellSx, textAlign: 'center', whiteSpace: 'nowrap' }}>
      {value == null ? (
        <Text sx={{ color: 'var(--fg-muted)', fontFamily: 'mono', fontSize: 0 }}>—</Text>
      ) : (
        <CountBadge n={value} fg={fg} bg={bg} />
      )}
    </Box>
  );
});

const CountBadge = React.memo(function CountBadge({ n, fg, bg }: { n: number; fg: string; bg: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 22,
        padding: '1px 8px',
        borderRadius: 999,
        background: bg,
        color: fg,
        textAlign: 'center',
      }}
    >
      {n}
    </span>
  );
});

const ExplorerPullRow = React.memo(function ExplorerPullRow({
  pr,
  mine,
  expanded,
  onView,
  linkedIssues,
  onIssueClick,
}: {
  pr: Pull;
  mine: boolean;
  expanded: boolean;
  onView: () => void;
  linkedIssues: Array<{ number: number; title: string; state: string; state_reason: string | null; author_login: string | null }>;
  onIssueClick: (issueNumber: number) => void;
}) {
  return (
    <Box
      as="tr"
      data-explorer-row="pull"
      data-pull-number={pr.number}
      sx={{
        height: 36,
        borderBottom: '1px solid',
        borderColor: 'var(--border-muted)',
        bg: mine ? 'var(--attention-subtle)' : 'transparent',
        borderLeft: '3px solid',
        borderLeftColor: mine ? 'var(--attention-emphasis)' : expanded ? 'var(--accent-emphasis)' : 'transparent',
        '&:hover': { bg: mine ? 'var(--attention-subtle, rgba(242, 201, 76, 0.14))' : 'var(--bg-subtle)' },
        cursor: 'pointer',
      }}
      onClick={onView}
    >
      <Box as="td" sx={{ ...tableCellSx, width: 28 }}>
        <Box sx={{ color: 'var(--fg-muted)', display: 'inline-flex' }}>
          {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </Box>
      </Box>
      <Box as="td" sx={tableCellSx}>
        <PullStatusBadge pr={pr} />
      </Box>
      <Box as="td" sx={{ ...tableCellSx, maxWidth: 360 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <PrimerLink
            href={pr.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            // Stop the click from bubbling to the row's onClick — clicking the
            // title should only open GitHub in a new tab, not also open the
            // side viewer.
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            sx={{
              fontWeight: 500,
              color: 'var(--fg-default)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              '&:hover': { color: 'var(--accent-fg)' },
            }}
            title={pr.title}
          >
            {pr.title}
          </PrimerLink>
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0, flexShrink: 0 }}>#{pr.number}</Text>
          {mine && (
            <Box
              sx={{
                px: 1,
                bg: 'var(--attention-emphasis)',
                color: '#ffffff',
                fontSize: '10px',
                fontWeight: 700,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                flexShrink: 0,
              }}
            >
              <PersonIcon size={10} />
              You
            </Box>
          )}
        </Box>
      </Box>
      <Box as="td" sx={{ ...tableCellSx, fontSize: 0 }}>
        <AuthorCell login={pr.author_login} association={pr.author_association} highlight={mine} />
      </Box>
      <Box as="td" sx={tableTimeSx} title={pr.created_at ?? undefined}>
        <RecentTime iso={pr.created_at} />
      </Box>
      <Box as="td" sx={tableTimeSx} title={pr.updated_at ?? undefined}>
        <RecentTime iso={pr.updated_at} />
      </Box>
      <Box as="td" sx={tableTimeSx} title={pr.merged_at ?? pr.closed_at ?? undefined}>
        {pr.merged_at ? (
          <Text sx={{ color: 'var(--success-fg)', fontWeight: isRecent(pr.merged_at) ? 700 : 400 }}>
            merged {formatRelativeTime(pr.merged_at)}
          </Text>
        ) : pr.closed_at ? (
          <Text sx={{ color: 'var(--danger-fg)', fontWeight: isRecent(pr.closed_at) ? 700 : 400 }}>
            closed {formatRelativeTime(pr.closed_at)}
          </Text>
        ) : (
          <Text sx={{ color: 'var(--fg-muted)' }}>—</Text>
        )}
      </Box>
      <Box as="td" sx={{ ...tableCellSx, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <RelatedIssuesCell issues={linkedIssues} onIssueClick={onIssueClick} />
      </Box>
    </Box>
  );
}, (prev, next) =>
  // Skip re-render when only the inline `onView` callback identity changed —
  // visible row content depends solely on the data props below.
  prev.pr === next.pr &&
  prev.mine === next.mine &&
  prev.expanded === next.expanded &&
  prev.linkedIssues === next.linkedIssues &&
  prev.onIssueClick === next.onIssueClick,
);

const ExplorerIssueRow = React.memo(function ExplorerIssueRow({
  issue,
  expanded,
  onView,
  authorStats,
  relatedPRs,
  mergedPRCount,
  validationStatus,
  onSetValidation,
  onPRClick,
  onAuthorClick,
}: {
  issue: Issue;
  expanded: boolean;
  onView: () => void;
  authorStats: { open: number; completed: number; not_planned: number; closed: number } | null;
  relatedPRs: Array<{ number: number; title: string; state: string; merged: number; draft: number; author_login?: string | null }>;
  mergedPRCount: number | null;
  validationStatus: 'valid' | 'invalid' | null;
  onSetValidation: (next: 'valid' | 'invalid' | null) => void;
  onPRClick: (prNumber: number) => void | Promise<void>;
  onAuthorClick: (login: string, association?: string | null) => void;
}) {
  return (
    <Box
      as="tr"
      data-explorer-row="issue"
      data-issue-number={issue.number}
      sx={{
        height: 36,
        borderBottom: '1px solid',
        borderColor: 'var(--border-muted)',
        '&:hover': { bg: 'var(--bg-subtle)' },
        cursor: 'pointer',
        borderLeft: '3px solid',
        borderLeftColor: expanded ? 'var(--accent-emphasis)' : 'transparent',
      }}
      onClick={onView}
    >
      <Box as="td" sx={{ ...tableCellSx, width: 28 }}>
        <Box sx={{ color: 'var(--fg-muted)', display: 'inline-flex' }}>
          {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </Box>
      </Box>
      <Box as="td" sx={tableCellSx}>
        <IssueStatusBadge issue={issue} mergedPRCount={mergedPRCount} />
      </Box>
      <Box as="td" sx={{ ...tableCellSx, maxWidth: 360 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <PrimerLink
            href={issue.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            // Stop bubbling — clicking the title is for "open in GitHub", not
            // for opening the side viewer (the chevron / row-body click does that).
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            sx={{
              fontWeight: 500,
              color: 'var(--fg-default)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              '&:hover': { color: 'var(--accent-fg)' },
            }}
            title={issue.title}
          >
            {issue.title}
          </PrimerLink>
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0, flexShrink: 0 }}>#{issue.number}</Text>
          {issue.comments > 0 && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--fg-muted)', fontSize: 0, flexShrink: 0 }}>
              <CommentIcon size={12} />
              {issue.comments}
            </Box>
          )}
          <IssueLabels labels={issue.labels} />
        </Box>
      </Box>
      <Box as="td" sx={{ ...tableCellSx, fontSize: 0 }}>
        <AuthorCell
          login={issue.author_login}
          association={issue.author_association}
          onClick={onAuthorClick}
        />
      </Box>
      <AuthorStatCell value={authorStats?.open ?? null} fg="var(--success-fg)" bg="var(--success-subtle)" />
      <AuthorStatCell value={authorStats?.completed ?? null} fg="var(--done-fg)" bg="var(--done-subtle)" />
      <AuthorStatCell value={authorStats?.not_planned ?? null} fg="var(--fg-muted)" bg="var(--bg-emphasis)" />
      <AuthorStatCell value={authorStats?.closed ?? null} fg="var(--danger-fg)" bg="var(--danger-subtle)" />
      <Box as="td" sx={tableTimeSx} title={issue.created_at ?? undefined}>
        <RecentTime iso={issue.created_at} />
      </Box>
      <Box as="td" sx={tableTimeSx} title={issue.updated_at ?? undefined}>
        <RecentTime iso={issue.updated_at} />
      </Box>
      <Box as="td" sx={tableTimeSx} title={issue.closed_at ?? undefined}>
        {issue.closed_at ? <RecentTime iso={issue.closed_at} /> : <Text sx={{ color: 'var(--fg-muted)' }}>—</Text>}
      </Box>
      <Box as="td" sx={{ ...tableCellSx, textAlign: 'center', whiteSpace: 'nowrap' }}>
        <RelatedPRsCell prs={relatedPRs} onPRClick={onPRClick} />
      </Box>
      <Box as="td" sx={{ ...tableCellSx, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <ValidationPicker value={validationStatus} onChange={onSetValidation} />
      </Box>
    </Box>
  );
}, (prev, next) =>
  prev.issue === next.issue &&
  prev.expanded === next.expanded &&
  prev.authorStats === next.authorStats &&
  prev.validationStatus === next.validationStatus &&
  prev.relatedPRs === next.relatedPRs &&
  prev.mergedPRCount === next.mergedPRCount &&
  prev.onPRClick === next.onPRClick &&
  prev.onAuthorClick === next.onAuthorClick,
);

function RelatedPRsCell({
  prs,
  onPRClick,
}: {
  prs: Array<{ number: number; title: string; state: string; merged: number; draft: number; author_login?: string | null }>;
  onPRClick?: (prNumber: number) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [popoverLayout, updatePopoverLayout] = useRelatedPopoverLayout(open, prs.length, wrapRef);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (prs.length === 0) {
    return <Text sx={{ color: 'var(--fg-muted)', fontFamily: 'mono', fontSize: 0 }}>—</Text>;
  }
  const merged = prs.filter((p) => p.merged).length;
  const open_ = prs.filter((p) => !p.merged && p.state === 'open').length;
  const tone = open_ > 0 ? 'var(--success-emphasis)' : merged > 0 ? 'var(--done-emphasis)' : 'var(--fg-muted)';

  return (
    <Box
      ref={wrapRef as unknown as React.Ref<HTMLDivElement>}
      sx={{ position: 'relative', display: 'inline-block' }}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (!open) updatePopoverLayout();
        setOpen((v) => !v);
      }}
    >
      <Box
        as="button"
        title={`${prs.length} PR${prs.length === 1 ? '' : 's'} reference this issue`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: '8px',
          py: '3px',
          border: '1px solid',
          borderColor: 'var(--border-default)',
          borderRadius: '999px',
          bg: 'var(--bg-canvas)',
          color: tone,
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          '&:hover': { borderColor: tone },
        }}
      >
        <GitPullRequestIcon size={11} />
        {prs.length}
      </Box>
      {open && (
        <Box
          sx={{
            position: 'absolute',
            ...relatedPopoverOffset(popoverLayout),
            right: 0,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: popoverLayout.maxHeight,
            overflowY: 'auto',
            bg: 'var(--bg-subtle)',
            border: '1px solid',
            borderColor: 'var(--border-default)',
            borderRadius: 2,
            boxShadow: 'var(--shadow-overlay)',
            zIndex: 50,
            py: 1,
            textAlign: 'left',
          }}
        >
          <Text sx={{ px: 2, py: 1, fontSize: 0, color: 'var(--fg-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block' }}>
            Linked pull requests
          </Text>
          {prs.map((pr) => {
            const status = pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state === 'open' ? 'open' : 'closed';
            const statusColor =
              status === 'merged' ? 'var(--done-emphasis)' :
              status === 'open' ? 'var(--success-emphasis)' :
              status === 'draft' ? 'var(--fg-muted)' :
              'var(--danger-fg)';
            return (
              <button
                key={pr.number}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setOpen(false);
                  void onPRClick?.(pr.number);
                }}
                onMouseEnter={highlightRelatedRow}
                onMouseLeave={unhighlightRelatedRow}
                style={relatedPopoverRowStyle}
              >
                {pr.author_login ? (
                  <span style={relatedPopoverAuthorStyle}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://github.com/${pr.author_login}.png?size=32`}
                      alt={pr.author_login}
                      loading="lazy"
                      style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--border-muted)', display: 'block', flexShrink: 0 }}
                    />
                    <span style={relatedPopoverAuthorTextStyle}>
                      {pr.author_login}
                    </span>
                  </span>
                ) : (
                  <GitPullRequestIcon size={12} />
                )}
                <span style={{ ...relatedPopoverStatusTextStyle, color: statusColor }}>
                  {status}
                </span>
                <span style={relatedPopoverTitleStyle}>
                  #{pr.number} {pr.title}
                </span>
              </button>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/** Inline cell for the PR table: shows a count badge with a popover listing
 *  the issues this PR closes/fixes/references. Mirrors RelatedPRsCell so the
 *  two columns feel consistent. */
function RelatedIssuesCell({
  issues,
  onIssueClick,
}: {
  issues: Array<{ number: number; title: string; state: string; state_reason: string | null; author_login: string | null }>;
  onIssueClick?: (issueNumber: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [popoverLayout, updatePopoverLayout] = useRelatedPopoverLayout(open, issues.length, wrapRef);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (issues.length === 0) {
    return <Text sx={{ color: 'var(--fg-muted)', fontFamily: 'mono', fontSize: 0 }}>—</Text>;
  }

  // Tone the badge based on the dominant state so a glance tells you whether
  // the linked issues are still open (green) or all resolved (purple).
  const openIssues = issues.filter((i) => i.state === 'open').length;
  const tone = openIssues > 0 ? 'var(--success-emphasis)' : 'var(--done-emphasis)';

  return (
    <Box
      ref={wrapRef as unknown as React.Ref<HTMLDivElement>}
      sx={{ position: 'relative', display: 'inline-block' }}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (!open) updatePopoverLayout();
        setOpen((v) => !v);
      }}
    >
      <Box
        as="button"
        title={`${issues.length} linked issue${issues.length === 1 ? '' : 's'}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: '8px',
          py: '3px',
          border: '1px solid',
          borderColor: 'var(--border-default)',
          borderRadius: '999px',
          bg: 'var(--bg-canvas)',
          color: tone,
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          '&:hover': { borderColor: tone },
        }}
      >
        <IssueOpenedIcon size={11} />
        {issues.length}
      </Box>
      {open && (
        <Box
          sx={{
            position: 'absolute',
            ...relatedPopoverOffset(popoverLayout),
            right: 0,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: popoverLayout.maxHeight,
            overflowY: 'auto',
            bg: 'var(--bg-subtle)',
            border: '1px solid',
            borderColor: 'var(--border-default)',
            borderRadius: 2,
            boxShadow: 'var(--shadow-overlay)',
            zIndex: 50,
            py: 1,
            textAlign: 'left',
          }}
        >
          <Text sx={{ px: 2, py: 1, fontSize: 0, color: 'var(--fg-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block' }}>
            Linked issues
          </Text>
          {issues.map((iss) => {
            // Effective state mirroring the issues-table coloring: open/done/np/closed.
            const reason = (iss.state_reason ?? '').toUpperCase();
            const status =
              iss.state === 'open' ? 'open' :
              reason === 'NOT_PLANNED' ? 'not_planned' :
              reason === 'COMPLETED' ? 'done' :
              'closed';
            const statusColor =
              status === 'open' ? 'var(--success-fg)' :
              status === 'done' ? 'var(--done-fg)' :
              status === 'not_planned' ? 'var(--fg-muted)' :
              'var(--danger-fg)';
            const StatusIcon =
              status === 'open' ? IssueOpenedIcon :
              status === 'not_planned' ? SkipIcon :
              IssueClosedIcon;
            return (
              <button
                key={iss.number}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setOpen(false);
                  onIssueClick?.(iss.number);
                }}
                onMouseEnter={highlightRelatedRow}
                onMouseLeave={unhighlightRelatedRow}
                style={relatedPopoverRowStyle}
              >
                <span style={{ color: statusColor, display: 'inline-flex', flexShrink: 0 }}>
                  <StatusIcon size={12} />
                </span>
                {iss.author_login && (
                  <span style={relatedPopoverAuthorStyle}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://github.com/${iss.author_login}.png?size=32`}
                      alt={iss.author_login}
                      loading="lazy"
                      style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--border-muted)', display: 'block', flexShrink: 0 }}
                    />
                    <span style={relatedPopoverAuthorTextStyle}>
                      {iss.author_login}
                    </span>
                  </span>
                )}
                <span style={relatedPopoverTitleStyle}>
                  #{iss.number} {iss.title}
                </span>
              </button>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

const relatedPopoverRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const relatedPopoverAuthorStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  minWidth: 0,
  maxWidth: 110,
};

const relatedPopoverAuthorTextStyle: React.CSSProperties = {
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const relatedPopoverStatusTextStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'capitalize',
  flexShrink: 0,
};

const relatedPopoverTitleStyle: React.CSSProperties = {
  color: 'var(--fg-default)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

function highlightRelatedRow(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--bg-emphasis)';
}

function unhighlightRelatedRow(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
}
