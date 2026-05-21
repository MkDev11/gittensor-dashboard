'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, Label, Link as PrimerLink } from '@primer/react';
import {
  RepoIcon,
  TriangleUpIcon,
  TriangleDownIcon,
  StarIcon,
  StarFillIcon,
} from '@primer/octicons-react';
import { PullStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime, isRecent } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import Dropdown from '@/components/Dropdown';
import SearchInput from '@/components/SearchInput';
import AuthorFilter from '@/components/AuthorFilter';
import AuthorActivitySidebar from '@/components/AuthorActivitySidebar';
import AuthorCredibilityNote from '@/components/AuthorCredibilityNote';
import PullScoreCell from '@/components/PullScoreCell';
import RelatedIssuesCell from '@/components/RelatedIssuesCell';
import type { Issue, LinkedIssueReference, Pull, PullScore } from '@/types/entities';
import ContentViewer from '@/components/ContentViewer';
import { useSettings } from '@/lib/settings';
import { useSn74Repos, lookupWeight } from '@/lib/use-sn74-repos';
import { useTrackedRepos } from '@/lib/tracked-repos';
import { InlinePagination as TablePagination } from '@/components/repo-explorer/Pagination';

interface AggPull extends Pull {
  score: PullScore | null;
}

interface PullsResp {
  count: number;
  repo_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  authors: Array<{ login: string; count: number }>;
  author_count: number;
  pulls: AggPull[];
  linked_issues_by_pull?: Record<string, LinkedIssueReference[]>;
}

interface UserReposResp {
  count: number;
  repos: Array<{ full_name: string; weight: number }>;
}

type AuthorTarget = { owner: string; name: string; repoFullName: string; login: string; association: string | null };
type StateFilter = 'all' | 'open' | 'draft' | 'merged' | 'closed';
type SortKey = 'updated' | 'opened' | 'closed' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

const PULLS_CONTENT_MAX_WIDTH = 1480;
const EMPTY_ISSUES: LinkedIssueReference[] = [];
const pullRowCellSx = {
  px: 2,
  py: 0,
  height: 40,
  maxHeight: 40,
  verticalAlign: 'middle' as const,
  lineHeight: '20px',
};

function pullIssueMapKey(pr: Pick<Pull, 'repo_full_name' | 'number'>): string {
  return `${pr.repo_full_name}#${pr.number}`;
}

export default function AllPullsPage() {
  const { repos: sn74Repos, weights: repoWeights, isSuccess: sn74ReposReady } = useSn74Repos();
  const { tracked, toggle: toggleTrackedRepo } = useTrackedRepos();
  const { settings, update } = useSettings();
  const me = useMinerLogin();
  const pageSize = settings.pageSize > 0 ? settings.pageSize : 25;

  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [authorFilter, setAuthorFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [openPull, setOpenPull] = useState<AggPull | null>(null);
  const [openIssue, setOpenIssue] = useState<Issue | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [authorTarget, setAuthorTarget] = useState<AuthorTarget | null>(null);

  const { data: userReposData, isSuccess: userReposReady } = useQuery<UserReposResp>({
    queryKey: ['user-repos'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/user-repos', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const currentRepoNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const repo of sn74Repos) names.set(repo.fullName.toLowerCase(), repo.fullName);
    for (const repo of userReposData?.repos ?? []) {
      if (!names.has(repo.full_name.toLowerCase())) names.set(repo.full_name.toLowerCase(), repo.full_name);
    }
    return names;
  }, [sn74Repos, userReposData]);

  const scopedTracked = useMemo(() => {
    const trackedNames = Array.from(tracked);
    if (!sn74ReposReady || !userReposReady) return trackedNames;
    return trackedNames.filter((name) => currentRepoNames.has(name.toLowerCase()));
  }, [currentRepoNames, sn74ReposReady, tracked, userReposReady]);

  const scopedTrackedSet = useMemo(
    () => new Set(scopedTracked.map((name) => name.toLowerCase())),
    [scopedTracked],
  );

  const displayWeights = useMemo(() => {
    const weights = new Map(repoWeights);
    for (const repo of userReposData?.repos ?? []) weights.set(repo.full_name.toLowerCase(), repo.weight);
    return weights;
  }, [repoWeights, userReposData]);

  const trackedRepoParam = useMemo(() => {
    if (!trackedOnly) return null;
    return scopedTracked
      .map((name) => currentRepoNames.get(name.toLowerCase()) ?? name)
      .sort((a, b) => a.localeCompare(b))
      .join(',');
  }, [currentRepoNames, scopedTracked, trackedOnly]);

  const authorParam = mineOnly ? me || '__signed_out__' : authorFilter;
  const pullsParams = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('pageSize', String(pageSize));
    sp.set('sort', sortKey);
    sp.set('dir', sortDir);
    if (query.trim()) sp.set('q', query.trim());
    if (stateFilter !== 'all') sp.set('state', stateFilter);
    if (authorParam !== 'all') sp.set('author', authorParam);
    if (trackedRepoParam !== null) sp.set('repos', trackedRepoParam);
    return sp.toString();
  }, [authorParam, page, pageSize, query, sortDir, sortKey, stateFilter, trackedRepoParam]);

  const { data, isLoading, isFetching } = useQuery<PullsResp>({
    queryKey: ['all-pulls', pullsParams],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/pulls?${pullsParams}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const rows = data?.pulls ?? [];
  const totalItems = data?.count ?? 0;
  const totalPages = data?.total_pages ?? page;
  const safePage = Math.min(page, totalPages);
  const authorOptions = data?.authors ?? [];
  const myCount = authorOptions.find((a) => a.login.toLowerCase() === me.toLowerCase())?.count ?? 0;
  const hasActiveFilters =
    query.trim().length > 0 || stateFilter !== 'all' || mineOnly || trackedOnly || authorFilter !== 'all';

  useEffect(() => {
    setPage(1);
  }, [query, stateFilter, trackedOnly, trackedRepoParam, authorParam, sortKey, sortDir, pageSize]);

  useEffect(() => {
    if (data && page > data.total_pages) setPage(data.total_pages);
  }, [data, page]);

  const handleRowClick = (pr: AggPull) => {
    if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
      setOpenPull(pr);
    } else {
      const k = `${pr.repo_full_name}#${pr.number}`;
      setExpandedKey((prev) => (prev === k ? null : k));
    }
  };

  const openAuthorDetails = (pr: AggPull) => {
    if (!pr.author_login) return;
    const [owner, name] = pr.repo_full_name.split('/');
    setOpenPull(null);
    setOpenIssue(null);
    setExpandedKey(null);
    setAuthorTarget({
      owner,
      name,
      repoFullName: pr.repo_full_name,
      login: pr.author_login,
      association: pr.author_association ?? null,
    });
  };

  const openPullFromAuthor = (pull: Pull) => {
    setAuthorTarget(null);
    setExpandedKey(null);
    setOpenPull({ ...pull, score: null });
  };

  const openIssueFromAuthor = (issue: Issue) => {
    setAuthorTarget(null);
    setOpenPull(null);
    setExpandedKey(null);
    setOpenIssue(issue);
  };

  const openLinkedIssue = async (pr: AggPull, issueNumber: number) => {
    const [owner, name] = pr.repo_full_name.split('/');
    setAuthorTarget(null);
    setOpenPull(null);
    setExpandedKey(null);
    try {
      const r = await fetch(`/api/issue/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${issueNumber}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setOpenIssue((await r.json()) as Issue);
    } catch (err) {
      console.warn('[pulls] could not open linked issue:', err);
    }
  };


  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'repo' || key === 'number' ? 'asc' : 'desc');
    }
  };

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Box sx={{ width: '100%', maxWidth: PULLS_CONTENT_MAX_WIDTH, mx: 'auto' }}>
          <Heading sx={{ fontSize: 4, mb: 1 }}>Pull Requests</Heading>
          <Text sx={{ color: 'fg.muted' }}>
            Live aggregated view across current SN74 and custom repositories. Star a repo to highlight its PRs; toggle{' '}
            <strong>Tracked only</strong> to filter to your watchlist.
          </Text>
        </Box>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ width: '100%', maxWidth: PULLS_CONTENT_MAX_WIDTH, mx: 'auto' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 3,
              mb: 3,
              p: 2,
              border: '1px solid',
              borderColor: 'var(--border-default)',
              borderRadius: 2,
              bg: 'var(--bg-subtle)',
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minWidth: 0 }}>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter by title, repo, #, author..."
                width={380}
                ariaLabel="Filter pull requests"
              />
              <Dropdown
                value={stateFilter}
                onChange={(v) => setStateFilter(v as StateFilter)}
                options={[
                  { value: 'all', label: 'All states' },
                  { value: 'open', label: 'Open' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'merged', label: 'Merged' },
                  { value: 'closed', label: 'Closed' },
                ]}
                width={180}
                ariaLabel="Filter by state"
              />
              <ToggleButton
                active={trackedOnly}
                onClick={() => setTrackedOnly((v) => !v)}
                icon={trackedOnly ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
              >
                Tracked only ({scopedTracked.length})
              </ToggleButton>
              <ToggleButton
                active={mineOnly}
                onClick={() => setMineOnly((v) => !v)}
                tone="attention"
              >
                My PRs only{myCount > 0 ? ` (${myCount})` : ''}
              </ToggleButton>
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: ['space-between', null, 'flex-end'],
                gap: 2,
                color: 'fg.muted',
                fontSize: 0,
                flex: ['1 1 100%', null, '0 1 auto'],
                minWidth: ['100%', null, 'auto'],
                flexWrap: 'wrap',
              }}
            >
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
                {isFetching && <Spinner size="sm" tone="muted" />}
                {data && (
                  <Text>
                    {data.count} PRs across {data.repo_count} repos · live
                  </Text>
                )}
              </Box>
              {data && data.count > 0 && (
                <TablePagination
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  pageSize={pageSize}
                  onChange={setPage}
                  onPageSizeChange={(n) => {
                    update('pageSize', n);
                    setPage(1);
                  }}
                  rawPageSize={settings.pageSize}
                />
              )}
            </Box>
          </Box>

          <Box
            sx={{
              border: '1px solid',
              borderColor: 'var(--border-default)',
              borderRadius: 2,
              overflowX: 'auto',
              overflowY: 'hidden',
              bg: 'var(--bg-canvas)',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            <Box as="table" sx={{ width: '100%', minWidth: 1200, borderCollapse: 'collapse', fontSize: 1 }}>
              <Box as="thead" sx={{ bg: 'var(--bg-subtle)', borderBottom: '1px solid', borderColor: 'var(--border-default)' }}>
                <Box as="tr">
                  <Box as="th" sx={{ ...headerCellSx, width: 44, textAlign: 'center' }} aria-label="Tracked repository" />
                  <HeaderCell label="State" />
                  <HeaderCell label="Pull Request" />
                  <HeaderCell label="Repository" onClick={() => toggleSort('repo')} active={sortKey === 'repo'} dir={sortDir} />
                  <HeaderCell label="Weight" onClick={() => toggleSort('weight')} active={sortKey === 'weight'} dir={sortDir} align="right" />
                  <Box as="th" sx={{ ...headerCellSx, py: '4px', width: 220, maxWidth: 220 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
                      <Box sx={{ color: authorFilter !== 'all' && !mineOnly ? 'var(--accent-fg)' : 'inherit', flexShrink: 0 }}>Author</Box>
                      <AuthorFilter
                        value={mineOnly ? me || 'all' : authorFilter}
                        onChange={(next) => {
                          setMineOnly(false);
                          setAuthorFilter(next);
                        }}
                        authors={authorOptions}
                        totalAuthors={data?.author_count ?? authorOptions.length}
                        width={220}
                        ariaLabel="Filter by author"
                      />
                    </Box>
                  </Box>
                  <HeaderCell label="Score" />
                  <HeaderCell label="Opened" onClick={() => toggleSort('opened')} active={sortKey === 'opened'} dir={sortDir} />
                  <HeaderCell label="Updated" onClick={() => toggleSort('updated')} active={sortKey === 'updated'} dir={sortDir} />
                  <HeaderCell label="Closed" onClick={() => toggleSort('closed')} active={sortKey === 'closed'} dir={sortDir} />
                  <Box as="th" sx={{ ...headerCellSx, textAlign: 'center' }}>Issues</Box>
                </Box>
              </Box>
              <Box as="tbody">
                {isLoading && rows.length === 0 && (
                  <Box as="tr">
                    <Box as="td" colSpan={11} sx={{ p: 0 }}>
                      <TableRowsSkeleton
                        rows={12}
                        cols={[
                          { width: 32 },
                          { width: 60 },
                          { flex: 1 },
                          { width: 120 },
                          { width: 60 },
                          { width: 100 },
                          { width: 80 },
                          { width: 60 },
                          { width: 60 },
                          { width: 60 },
                          { width: 54 },
                        ]}
                      />
                    </Box>
                  </Box>
                )}
                {!isLoading && rows.length === 0 && (
                  <Box as="tr">
                    <Box as="td" colSpan={11} sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
                      {data && data.count === 0
                        ? hasActiveFilters
                          ? 'No PRs match these filters.'
                          : 'No pull requests cached for current repositories yet. Visit a repo page or run the poller to populate.'
                        : 'No PRs match these filters.'}
                    </Box>
                  </Box>
                )}
                {rows.map((pr) => {
                  const k = `${pr.repo_full_name}#${pr.number}`;
                  const expanded = expandedKey === k;
                  const [o, n] = pr.repo_full_name.split('/');
                  const linkedIssues = data?.linked_issues_by_pull?.[pullIssueMapKey(pr)] ?? EMPTY_ISSUES;
                  return (
                    <React.Fragment key={k}>
                      <PullTableRow
                        pr={pr}
                        mine={!!me && pr.author_login?.toLowerCase() === me.toLowerCase()}
                        tracked={scopedTrackedSet.has(pr.repo_full_name.toLowerCase())}
                        onToggleTrack={() => toggleTrackedRepo(pr.repo_full_name)}
                        onRowClick={() => handleRowClick(pr)}
                        onAuthorClick={() => openAuthorDetails(pr)}
                        expanded={expanded}
                        weight={lookupWeight(displayWeights, pr.repo_full_name) ?? 0}
                        linkedIssues={linkedIssues}
                        onIssueClick={(issueNumber) => openLinkedIssue(pr, issueNumber)}
                      />
                      {expanded && settings.contentDisplay === 'accordion' && (
                        <Box as="tr">
                          <Box as="td" colSpan={11} sx={{ p: 0 }}>
                            <ContentViewer
                              target={{ kind: 'pull', owner: o, name: n, number: pr.number, preloaded: pr }}
                              mode="inline"
                              onClose={() => setExpandedKey(null)}
                            />
                          </Box>
                        </Box>
                      )}
                    </React.Fragment>
                  );
                })}
              </Box>
            </Box>
          </Box>

          {data && data.count > 0 && (
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
              <TablePagination
                page={safePage}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onChange={setPage}
                onPageSizeChange={(n) => {
                  update('pageSize', n);
                  setPage(1);
                }}
                rawPageSize={settings.pageSize}
              />
            </Box>
          )}
        </Box>
      </PageLayout.Content>

      {openPull && settings.contentDisplay === 'modal' && (() => {
        const [o, n] = openPull.repo_full_name.split('/');
        return (
          <ContentViewer
            target={{ kind: 'pull', owner: o, name: n, number: openPull.number, preloaded: openPull }}
            mode="modal"
            onClose={() => setOpenPull(null)}
          />
        );
      })()}

      {authorTarget && (
        <>
          <Box
            onMouseDown={() => setAuthorTarget(null)}
            sx={{
              position: 'fixed',
              inset: 0,
              zIndex: 219,
              bg: 'rgba(1, 4, 9, 0.28)',
            }}
          />
          <Box
            sx={{
              position: 'fixed',
              top: 'var(--header-height)',
              right: 0,
              bottom: 0,
              width: ['100vw', null, 'min(760px, 52vw)'],
              maxWidth: ['100vw', null, 'calc(100vw - 24px)'],
              borderLeft: '1px solid',
              borderColor: 'var(--border-default)',
              bg: 'var(--bg-canvas)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '-18px 0 36px rgba(1, 4, 9, 0.36)',
              zIndex: 220,
            }}
          >
            <AuthorActivitySidebar
              owner={authorTarget.owner}
              name={authorTarget.name}
              repoFullName={authorTarget.repoFullName}
              login={authorTarget.login}
              initialAssociation={authorTarget.association}
              onClose={() => setAuthorTarget(null)}
              onPullClick={openPullFromAuthor}
              onIssueClick={openIssueFromAuthor}
            />
          </Box>
        </>
      )}

      {openPull && settings.contentDisplay === 'side' && (() => {
        const [o, n] = openPull.repo_full_name.split('/');
        return (
          <Box
            sx={{
              position: 'fixed',
              top: 'var(--header-height)',
              right: 0,
              bottom: 0,
              width: 480,
              maxWidth: '50vw',
              borderLeft: '1px solid',
              borderColor: 'var(--border-default)',
              bg: 'var(--bg-canvas)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 90,
            }}
          >
            <ContentViewer
              target={{ kind: 'pull', owner: o, name: n, number: openPull.number, preloaded: openPull }}
              mode="side"
              onClose={() => setOpenPull(null)}
            />
          </Box>
        );
      })()}

      {openIssue && settings.contentDisplay === 'side' && (() => {
        const [o, n] = openIssue.repo_full_name.split('/');
        return (
          <Box
            sx={{
              position: 'fixed',
              top: 'var(--header-height)',
              right: 0,
              bottom: 0,
              width: 480,
              maxWidth: '50vw',
              borderLeft: '1px solid',
              borderColor: 'var(--border-default)',
              bg: 'var(--bg-canvas)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 90,
            }}
          >
            <ContentViewer
              target={{ kind: 'issue', owner: o, name: n, number: openIssue.number, preloaded: openIssue }}
              mode="side"
              onClose={() => setOpenIssue(null)}
            />
          </Box>
        );
      })()}

      {openIssue && settings.contentDisplay !== 'side' && (() => {
        const [o, n] = openIssue.repo_full_name.split('/');
        return (
          <ContentViewer
            target={{ kind: 'issue', owner: o, name: n, number: openIssue.number, preloaded: openIssue }}
            mode="modal"
            onClose={() => setOpenIssue(null)}
          />
        );
      })()}
    </PageLayout>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  icon,
  tone = 'accent',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'accent' | 'attention';
}) {
  const emphasis = tone === 'attention' ? 'var(--attention-emphasis)' : 'var(--accent-emphasis)';
  const subtle = tone === 'attention' ? 'var(--attention-subtle, rgba(242, 201, 76, 0.14))' : 'var(--accent-subtle)';
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: '12px',
        py: '5px',
        borderRadius: '6px',
        border: '1px solid',
        borderColor: active ? emphasis : 'var(--border-default)',
        bg: active ? subtle : 'var(--bg-emphasis)',
        color: active ? emphasis : 'var(--fg-default)',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
        userSelect: 'none',
        '&:hover': { borderColor: 'var(--border-strong)' },
      }}
    >
      {icon}
      {children}
    </Box>
  );
}

const headerCellSx = {
  p: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: 0,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
};

function HeaderCell({
  label,
  onClick,
  active,
  dir,
  align = 'left',
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
  align?: 'left' | 'right';
}) {
  return (
    <Box
      as="th"
      onClick={onClick}
      sx={{
        ...headerCellSx,
        textAlign: align,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        '&:hover': onClick ? { color: 'var(--fg-default)' } : undefined,
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label}
        {active && (dir === 'asc' ? <TriangleUpIcon size={12} /> : <TriangleDownIcon size={12} />)}
      </Box>
    </Box>
  );
}

function PullTableRow({
  pr,
  mine,
  tracked,
  onToggleTrack,
  onRowClick,
  onAuthorClick,
  onIssueClick,
  expanded,
  weight,
  linkedIssues,
}: {
  pr: AggPull;
  mine: boolean;
  tracked: boolean;
  onToggleTrack?: () => void;
  onRowClick?: () => void;
  onAuthorClick?: () => void;
  onIssueClick?: (issueNumber: number) => void | Promise<void>;
  expanded?: boolean;
  weight: number;
  linkedIssues: LinkedIssueReference[];
}) {
  const [owner, name] = pr.repo_full_name.split('/');

  return (
    <Box
      as="tr"
      onClick={onRowClick}
      data-explorer-row="true"
      sx={{
        height: 40,
        borderBottom: '1px solid',
        borderColor: 'var(--border-muted)',
        bg: expanded ? 'var(--accent-subtle)' : tracked ? 'var(--accent-subtle)' : 'var(--bg-canvas)',
        borderLeft: '3px solid',
        borderLeftColor: tracked ? 'var(--accent-emphasis)' : 'transparent',
        cursor: 'pointer',
        '&:hover': { bg: tracked ? 'var(--accent-subtle)' : 'var(--bg-subtle)' },
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Box as="td" sx={{ ...pullRowCellSx, width: 44, textAlign: 'center' }}>
        <Box
          as="button"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleTrack?.();
          }}
          aria-label={tracked ? `Unstar ${pr.repo_full_name}` : `Star ${pr.repo_full_name}`}
          title={tracked ? `Unstar ${pr.repo_full_name}` : `Star ${pr.repo_full_name}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            p: 0,
            border: 'none',
            borderRadius: 1,
            bg: 'transparent',
            color: tracked ? 'var(--attention-fg)' : 'var(--fg-muted)',
            cursor: 'pointer',
            '&:hover': {
              bg: 'var(--bg-inset)',
              color: 'var(--attention-fg)',
            },
          }}
        >
          {tracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>
      <Box as="td" sx={pullRowCellSx}>
        <PullStatusBadge pr={pr} />
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, maxWidth: 420 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minWidth: 0,
            maxWidth: '100%',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          <PrimerLink
            href={pr.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            sx={{
              color: 'var(--fg-default)',
              fontWeight: 500,
              display: 'block',
              minWidth: 0,
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
        </Box>
      </Box>
      <Box as="td" sx={pullRowCellSx}>
        <Link
          href={`/repos/${owner}/${name}`}
          prefetch={false}
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--accent-fg)', maxWidth: '100%', '&:hover': { textDecoration: 'underline' } }}>
            <RepoIcon size={12} />
            <Text sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pr.repo_full_name}
            </Text>
          </Box>
        </Link>
      </Box>
      <Box
        as="td"
        sx={{
          ...pullRowCellSx,
          textAlign: 'right',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 1,
          fontWeight: weight >= 0.3 ? 700 : weight >= 0.15 ? 600 : weight >= 0.05 ? 500 : 400,
          color:
            weight >= 0.5
              ? 'var(--success-fg)'
              : weight >= 0.3
              ? 'var(--accent-fg)'
              : weight >= 0.15
              ? 'var(--attention-fg)'
              : weight >= 0.05
              ? 'var(--fg-default)'
              : 'var(--fg-muted)',
        }}
      >
        {weight.toFixed(4)}
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, width: 220, maxWidth: 220, minWidth: 0, overflow: 'hidden', fontSize: 0 }}>
        {pr.author_login ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAuthorClick?.();
            }}
            title={`View ${pr.author_login} details in ${pr.repo_full_name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
              color: 'inherit',
              border: 'none',
              background: 'transparent',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://github.com/${pr.author_login}.png?size=40`}
              alt={pr.author_login}
              loading="lazy"
              style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0, display: 'block' }}
            />
            <Text
              sx={{
                fontWeight: 500,
                color: mine ? 'var(--attention-emphasis)' : 'var(--fg-default)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { color: 'var(--accent-fg)' },
              }}
            >
              {pr.author_login}
            </Text>
            <AuthorCredibilityNote credibility={pr.author_credibility} variant="pulls" />
            {pr.author_association && pr.author_association !== 'NONE' && (
              <Label variant="secondary" sx={{ fontSize: '10px', flexShrink: 0 }}>
                {pr.author_association.toLowerCase()}
              </Label>
            )}
          </button>
        ) : (
          <Text sx={{ fontWeight: 500, color: 'var(--fg-muted)' }}>-</Text>
        )}
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, fontSize: 0, whiteSpace: 'nowrap' }}>
        <PullScoreCell pr={pr} />
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, fontSize: 0, whiteSpace: 'nowrap' }} title={pr.created_at ?? undefined}>
        <RecentTime iso={pr.created_at} />
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, fontSize: 0, whiteSpace: 'nowrap' }} title={pr.updated_at ?? undefined}>
        <RecentTime iso={pr.updated_at} />
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, fontSize: 0, whiteSpace: 'nowrap' }} title={pr.merged_at ?? pr.closed_at ?? undefined}>
        <RecentTime iso={pr.merged_at ?? pr.closed_at} />
      </Box>
      <Box as="td" sx={{ ...pullRowCellSx, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <RelatedIssuesCell issues={linkedIssues} onIssueClick={onIssueClick} />
      </Box>
    </Box>
  );
}


const RecentTime = React.memo(function RecentTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <Text sx={{ color: 'var(--fg-muted)' }}>-</Text>;
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
