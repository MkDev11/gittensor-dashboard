'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, Label, Link as PrimerLink } from '@primer/react';
import { RepoIcon, IssueOpenedIcon, GitPullRequestIcon, TriangleUpIcon, TriangleDownIcon } from '@primer/octicons-react';
import { PullStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime, isRecent } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import Dropdown from '@/components/Dropdown';
import SearchInput from '@/components/SearchInput';
import AuthorFilter from '@/components/AuthorFilter';
import type { PullDto } from '@/lib/api-types';
import { pullStatus } from '@/lib/api-types';
import ContentViewer from '@/components/ContentViewer';
import { useSettings } from '@/lib/settings';
import { useSn74Repos, lookupWeight } from '@/lib/use-sn74-repos';

interface AggPull extends PullDto {
  linked_issues: Array<{ repo: string; number: number }>;
}

interface PullsResp {
  count: number;
  repo_count: number;
  pulls: AggPull[];
}

type StateFilter = 'all' | 'open' | 'draft' | 'merged' | 'closed';
type CloseFilter = 'all' | 'merged' | 'closed' | 'still_open';
type SortKey = 'updated' | 'opened' | 'closed' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

const PAGE_INCREMENT = 50;

export default function AllPullsPage() {
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [visibleCount, setVisibleCount] = useState(PAGE_INCREMENT);
  const [authorFilter, setAuthorFilter] = useState<string>('all');
  const [closeFilter, setCloseFilter] = useState<CloseFilter>('all');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const me = useMinerLogin();
  const { settings } = useSettings();
  const { weights: repoWeights } = useSn74Repos();
  const [openPull, setOpenPull] = useState<AggPull | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const handleRowClick = (pr: AggPull) => {
    if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
      setOpenPull(pr);
    } else {
      const k = `${pr.repo_full_name}#${pr.number}`;
      setExpandedKey((prev) => (prev === k ? null : k));
    }
  };

  const { data, isLoading } = useQuery<PullsResp>({
    queryKey: ['all-pulls'],
    queryFn: async () => {
      const r = await fetch('/api/pulls');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    if (!data?.pulls) return [];
    const q = query.trim().toLowerCase();
    let list = data.pulls.filter((p) => {
      if (q && !`${p.title} #${p.number} ${p.author_login ?? ''} ${p.repo_full_name}`.toLowerCase().includes(q)) return false;
      if (mineOnly && p.author_login?.toLowerCase() !== me.toLowerCase()) return false;
      if (authorFilter !== 'all' && p.author_login !== authorFilter) return false;
      if (closeFilter === 'merged' && !p.merged) return false;
      if (closeFilter === 'closed' && (p.merged || !p.closed_at)) return false;
      if (closeFilter === 'still_open' && (p.closed_at || p.merged_at)) return false;
      if (stateFilter === 'all') return true;
      return pullStatus(p) === stateFilter;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'updated') cmp = (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
      else if (sortKey === 'opened') cmp = (a.created_at ?? '').localeCompare(b.created_at ?? '');
      else if (sortKey === 'closed') cmp = (a.closed_at ?? '').localeCompare(b.closed_at ?? '');
      else if (sortKey === 'repo') cmp = a.repo_full_name.localeCompare(b.repo_full_name);
      else if (sortKey === 'number') cmp = a.number - b.number;
      else if (sortKey === 'weight') cmp = (lookupWeight(repoWeights, a.repo_full_name) ?? 0) - (lookupWeight(repoWeights, b.repo_full_name) ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [data, query, stateFilter, mineOnly, authorFilter, closeFilter, sortKey, sortDir, me, repoWeights]);

  // Build the author option list from current data — sorted by frequency.
  const authorOptions = useMemo(() => {
    if (!data?.pulls) return [];
    const counts = new Map<string, number>();
    for (const p of data.pulls) {
      const a = p.author_login;
      if (!a) continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([login, count]) => ({ login, count }));
  }, [data]);

  useEffect(() => {
    setVisibleCount(PAGE_INCREMENT);
  }, [query, stateFilter, mineOnly, authorFilter, closeFilter, sortKey, sortDir]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((c) => Math.min(c + PAGE_INCREMENT, filtered.length));
          }
        }
      },
      { rootMargin: '400px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'repo' || key === 'number' ? 'asc' : 'desc');
    }
  };

  const myCount = data?.pulls.filter((p) => p.author_login?.toLowerCase() === me.toLowerCase()).length ?? 0;

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Pull Requests</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          Live aggregated view of every PR across all cached SN74 repositories, with linked issues parsed from PR bodies.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Filter by title, repo, #, author…"
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
              { value: 'closed', label: 'Closed (unmerged)' },
            ]}
            width={180}
            ariaLabel="Filter by state"
          />
          <Box
            as="label"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              px: '12px',
              height: 32,
              border: '1px solid',
              borderColor: mineOnly ? 'var(--attention-emphasis)' : 'var(--border-default)',
              bg: mineOnly ? 'var(--attention-subtle, rgba(242, 201, 76, 0.16))' : 'var(--bg-canvas)',
              color: mineOnly ? 'var(--attention-emphasis)' : 'var(--fg-default)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              style={{ margin: 0, width: 14, height: 14, accentColor: 'var(--attention-emphasis)', cursor: 'pointer' }}
            />
            My PRs only
            {myCount > 0 && (
              <Box
                sx={{
                  px: '6px',
                  bg: mineOnly ? 'var(--attention-emphasis)' : 'var(--bg-emphasis)',
                  color: mineOnly ? '#ffffff' : 'var(--fg-default)',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: 999,
                  lineHeight: '18px',
                }}
              >
                {myCount}
              </Box>
            )}
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0 }}>
            {isLoading && <Spinner size="sm" tone="muted" />}
            {data && (
              <Text>
                {filtered.length} PRs across {new Set(filtered.map((p) => p.repo_full_name)).size} repos · live
              </Text>
            )}
          </Box>
        </Box>

        <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflowX: 'auto', overflowY: 'hidden', bg: 'canvas.default' }}>
          <Box as="table" sx={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: 1 }}>
            <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
              <Box as="tr">
                <HeaderCell label="State" />
                <HeaderCell label="Pull Request" />
                <HeaderCell label="Repository" onClick={() => toggleSort('repo')} active={sortKey === 'repo'} dir={sortDir} />
                <HeaderCell label="Weight" onClick={() => toggleSort('weight')} active={sortKey === 'weight'} dir={sortDir} align="right" />
                <Box as="th" sx={{ ...headerCellSx, py: '4px' }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ color: authorFilter !== 'all' ? 'accent.fg' : 'inherit' }}>Author</Box>
                    <AuthorFilter
                      value={authorFilter}
                      onChange={setAuthorFilter}
                      authors={authorOptions}
                      width={260}
                      ariaLabel="Filter by author"
                    />
                  </Box>
                </Box>
                <HeaderCell label="Linked issue" />
                <HeaderCell label="Opened" onClick={() => toggleSort('opened')} active={sortKey === 'opened'} dir={sortDir} />
                <HeaderCell label="Updated" onClick={() => toggleSort('updated')} active={sortKey === 'updated'} dir={sortDir} />
                <FilterHeaderCell
                  label="Merged / Closed"
                  value={closeFilter}
                  onChange={(v) => setCloseFilter(v as CloseFilter)}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'merged', label: 'Merged only' },
                    { value: 'closed', label: 'Closed (unmerged) only' },
                    { value: 'still_open', label: 'Still open' },
                  ]}
                  width={200}
                  rightSort={{ active: sortKey === 'closed', dir: sortDir, onClick: () => toggleSort('closed') }}
                />
              </Box>
            </Box>
            <Box as="tbody">
              {isLoading && filtered.length === 0 && (
                <Box as="tr">
                  <Box as="td" colSpan={9} sx={{ p: 0 }}>
                    <TableRowsSkeleton
                      rows={12}
                      cols={[
                        { width: 24 },
                        { width: 60 },
                        { flex: 1 },
                        { width: 100 },
                        { width: 80 },
                        { width: 60 },
                        { width: 60 },
                        { width: 60 },
                        { width: 80 },
                      ]}
                    />
                  </Box>
                </Box>
              )}
              {!isLoading && filtered.length === 0 && (
                <Box as="tr">
                  <Box as="td" colSpan={9} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                    No PRs match these filters.
                  </Box>
                </Box>
              )}
              {visible.map((pr) => {
                const k = `${pr.repo_full_name}#${pr.number}`;
                const expanded = expandedKey === k;
                const [o, n] = pr.repo_full_name.split('/');
                return (
                  <React.Fragment key={k}>
                    <PullTableRow
                      pr={pr}
                      mine={pr.author_login?.toLowerCase() === me.toLowerCase()}
                      onRowClick={() => handleRowClick(pr)}
                      expanded={expanded}
                      weight={lookupWeight(repoWeights, pr.repo_full_name) ?? 0}
                    />
                    {expanded && settings.contentDisplay === 'accordion' && (
                      <Box as="tr">
                        <Box as="td" colSpan={9} sx={{ p: 0 }}>
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
          {hasMore && (
            <Box
              ref={sentinelRef as unknown as React.Ref<HTMLDivElement>}
              sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'fg.muted', fontSize: 0 }}
            >
              <Spinner size="sm" tone="muted" inline label={`Loading more… (${visibleCount} / ${filtered.length})`} />
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
    </PageLayout>
  );
}

const headerCellSx = {
  px: 3,
  py: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: '11px',
  color: 'fg.muted',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
};

function FilterHeaderCell({
  label,
  value,
  onChange,
  options,
  width,
  rightSort,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  width: number;
  rightSort?: { active: boolean; dir: SortDir; onClick: () => void };
}) {
  const isFiltered = value !== 'all';
  return (
    <Box as="th" sx={{ ...headerCellSx, py: '4px' }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: isFiltered ? 'accent.fg' : 'inherit' }}>
          {label}
          {isFiltered && (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bg: 'accent.emphasis',
                display: 'inline-block',
              }}
              title="Filter active"
            />
          )}
        </Box>
        <Dropdown
          value={value}
          onChange={onChange}
          options={options}
          width={width}
          size="small"
          ariaLabel={`Filter by ${label}`}
        />
        {rightSort && (
          <Box
            as="button"
            onClick={rightSort.onClick}
            sx={{
              cursor: 'pointer',
              border: 'none',
              bg: 'transparent',
              color: rightSort.active ? 'fg.default' : 'fg.muted',
              p: '2px',
              ml: 1,
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 1,
              '&:hover': { color: 'fg.default' },
            }}
            aria-label="Toggle sort"
          >
            {rightSort.dir === 'asc' ? <TriangleUpIcon size={12} /> : <TriangleDownIcon size={12} />}
          </Box>
        )}
      </Box>
    </Box>
  );
}

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
        '&:hover': onClick ? { color: 'fg.default' } : undefined,
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
  onRowClick,
  expanded,
  weight,
}: {
  pr: AggPull;
  mine: boolean;
  onRowClick?: () => void;
  expanded?: boolean;
  weight: number;
}) {
  const [owner, name] = pr.repo_full_name.split('/');

  return (
    <Box
      as="tr"
      onClick={onRowClick}
      data-explorer-row="true"
      sx={{
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        bg: expanded ? 'accent.muted' : mine ? 'rgba(242, 201, 76, 0.08)' : 'transparent',
        borderLeft: '3px solid',
        borderLeftColor: mine ? 'var(--attention-emphasis)' : 'transparent',
        cursor: 'pointer',
        '&:hover': { bg: mine ? 'var(--attention-subtle, rgba(242, 201, 76, 0.14))' : 'canvas.subtle' },
      }}
    >
      <Box as="td" sx={{ px: 2, py: '6px', verticalAlign: 'middle' }}>
        <PullStatusBadge pr={pr} />
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', maxWidth: 320, verticalAlign: 'middle' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <PrimerLink
            href={pr.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            sx={{
              fontWeight: 500,
              color: 'fg.default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              '&:hover': { color: 'accent.fg' },
            }}
            title={pr.title}
          >
            {pr.title}
          </PrimerLink>
          <Text sx={{ color: 'fg.muted', fontSize: 0, flexShrink: 0 }}>#{pr.number}</Text>
        </Box>
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', verticalAlign: 'middle' }}>
        <Link href={`/explorer?repo=${encodeURIComponent(pr.repo_full_name)}&tab=pulls`} prefetch={false} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'accent.fg', '&:hover': { textDecoration: 'underline' } }}>
            <RepoIcon size={12} />
            <Text>{pr.repo_full_name}</Text>
          </Box>
        </Link>
      </Box>
      <Box
        as="td"
        sx={{
          p: 2,
          textAlign: 'right',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 1,
          fontWeight: weight >= 0.3 ? 700 : weight >= 0.15 ? 600 : weight >= 0.05 ? 500 : 400,
          color:
            weight >= 0.5 ? 'success.fg' : weight >= 0.3 ? 'accent.fg' : weight >= 0.15 ? 'attention.fg' : weight >= 0.05 ? 'fg.default' : 'fg.muted',
          verticalAlign: 'middle',
        }}
      >
        {weight.toFixed(4)}
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', fontSize: 0, verticalAlign: 'middle' }}>
        {pr.author_login ? (
          <a
            href={`https://github.com/${pr.author_login}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'inherit' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://github.com/${pr.author_login}.png?size=40`}
              alt={pr.author_login}
              loading="lazy"
              style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0 }}
            />
            <Text sx={{ fontWeight: 500, color: mine ? 'var(--attention-emphasis)' : 'fg.default', '&:hover': { color: 'accent.fg' } }}>
              {pr.author_login}
            </Text>
            {pr.author_association && pr.author_association !== 'NONE' && (
              <Label variant="secondary" sx={{ fontSize: '10px', flexShrink: 0 }}>
                {pr.author_association.toLowerCase()}
              </Label>
            )}
          </a>
        ) : (
          <Text sx={{ color: 'fg.muted' }}>—</Text>
        )}
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', fontSize: 0, verticalAlign: 'middle' }}>
        {pr.linked_issues.length > 0 ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {pr.linked_issues.slice(0, 3).map((li) => {
              const sameRepo = li.repo === pr.repo_full_name;
              const target = sameRepo
                ? `/explorer?repo=${encodeURIComponent(pr.repo_full_name)}&tab=issues&issue=${li.number}`
                : `/explorer?repo=${encodeURIComponent(li.repo)}&tab=issues&issue=${li.number}`;
              return (
                <Link key={`${li.repo}#${li.number}`} href={target} prefetch={false} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 1,
                      px: '6px',
                      py: '1px',
                      bg: 'var(--bg-emphasis)',
                      border: '1px solid',
                      borderColor: 'border.default',
                      borderRadius: 999,
                      color: 'accent.fg',
                      '&:hover': { borderColor: 'accent.emphasis' },
                    }}
                  >
                    <IssueOpenedIcon size={11} />
                    <Text>
                      {sameRepo ? '' : `${li.repo} `}#{li.number}
                    </Text>
                  </Box>
                </Link>
              );
            })}
            {pr.linked_issues.length > 3 && (
              <Text sx={{ color: 'fg.muted', fontSize: 0 }}>+{pr.linked_issues.length - 3}</Text>
            )}
          </Box>
        ) : (
          <Text sx={{ color: 'fg.muted' }}>—</Text>
        )}
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', fontSize: 0, color: 'fg.muted', verticalAlign: 'middle', whiteSpace: 'nowrap' }} title={pr.created_at ?? undefined}>
        {pr.created_at && isRecent(pr.created_at) ? (
          <Text sx={{ color: 'success.fg', fontWeight: 700 }}>{formatRelativeTime(pr.created_at)}</Text>
        ) : (
          formatRelativeTime(pr.created_at)
        )}
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', fontSize: 0, color: 'fg.muted', verticalAlign: 'middle', whiteSpace: 'nowrap' }} title={pr.updated_at ?? undefined}>
        {pr.updated_at && isRecent(pr.updated_at) ? (
          <Text sx={{ color: 'success.fg', fontWeight: 700 }}>{formatRelativeTime(pr.updated_at)}</Text>
        ) : (
          formatRelativeTime(pr.updated_at)
        )}
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', fontSize: 0, verticalAlign: 'middle', whiteSpace: 'nowrap' }} title={pr.merged_at ?? pr.closed_at ?? undefined}>
        {pr.merged_at ? (
          <Text sx={{ color: 'success.fg', fontWeight: isRecent(pr.merged_at) ? 700 : 400 }}>
            merged {formatRelativeTime(pr.merged_at)}
          </Text>
        ) : pr.closed_at ? (
          <Text sx={{ color: 'danger.fg', fontWeight: isRecent(pr.closed_at) ? 700 : 400 }}>
            closed {formatRelativeTime(pr.closed_at)}
          </Text>
        ) : (
          <Text sx={{ color: 'fg.muted' }}>—</Text>
        )}
      </Box>
    </Box>
  );
}
