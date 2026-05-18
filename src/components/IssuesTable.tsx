'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Text,
  TextInput,
  Label,
  Link as PrimerLink,
} from '@primer/react';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import Dropdown from '@/components/Dropdown';
import AuthorFilter from '@/components/AuthorFilter';
import {
  SearchIcon,
  CommentIcon,
  RepoIcon,
  StarIcon,
  StarFillIcon,
  TriangleUpIcon,
  TriangleDownIcon,
} from '@primer/octicons-react';
import type { IssueDto } from '@/lib/api-types';
import { IssueStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime } from '@/lib/format';
import { useTrackedRepos } from '@/lib/tracked-repos';
import ContentViewer from '@/components/ContentViewer';
import { useSettings } from '@/lib/settings';
import { useSn74Repos, lookupWeight } from '@/lib/use-sn74-repos';

type SortKey = 'opened' | 'closed' | 'updated' | 'comments' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';
type StateFilter = 'all' | 'open' | 'completed' | 'not_planned' | 'duplicate' | 'closed_other';
type CloseFilter = 'all' | 'closed' | 'still_open';

const STATE_OPTS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All states' },
  { id: 'open', label: 'Open' },
  { id: 'completed', label: 'Completed' },
  { id: 'not_planned', label: 'Not planned' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'closed_other', label: 'Closed (other)' },
];

interface IssuesResp {
  count: number;
  repo_count: number;
  issues: IssueDto[];
}

const PAGE_INCREMENT = 50;

export default function IssuesTable() {
  const { weights: repoWeights } = useSn74Repos();
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('opened');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_INCREMENT);
  const [authorFilter, setAuthorFilter] = useState<string>('all');
  const [closeFilter, setCloseFilter] = useState<CloseFilter>('all');
  const [openIssue, setOpenIssue] = useState<IssueDto | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { settings } = useSettings();
  const { tracked, toggle: toggleTrack } = useTrackedRepos();

  const handleRowClick = (issue: IssueDto) => {
    if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
      setOpenIssue(issue);
    } else {
      const k = `${issue.repo_full_name}#${issue.number}`;
      setExpandedKey((prev) => (prev === k ? null : k));
    }
  };

  const { data, isLoading, dataUpdatedAt } = useQuery<IssuesResp>({
    queryKey: ['all-issues'],
    queryFn: async () => {
      const r = await fetch('/api/issues');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!data?.issues) return [];
    const q = query.trim().toLowerCase();
    let list = data.issues.filter((i) => {
      if (q && !`${i.title} #${i.number} ${i.author_login ?? ''} ${i.repo_full_name}`.toLowerCase().includes(q))
        return false;
      if (trackedOnly && !tracked.has(i.repo_full_name)) return false;
      if (authorFilter !== 'all' && i.author_login !== authorFilter) return false;
      if (closeFilter === 'closed' && i.state !== 'closed') return false;
      if (closeFilter === 'still_open' && i.state === 'closed') return false;
      if (stateFilter === 'all') return true;
      if (stateFilter === 'open') return i.state === 'open';
      const reason = (i.state_reason ?? '').toUpperCase();
      if (stateFilter === 'completed') return i.state === 'closed' && reason === 'COMPLETED';
      if (stateFilter === 'not_planned') return i.state === 'closed' && reason === 'NOT_PLANNED';
      if (stateFilter === 'duplicate') return i.state === 'closed' && reason === 'DUPLICATE';
      if (stateFilter === 'closed_other')
        return i.state === 'closed' && reason !== 'COMPLETED' && reason !== 'NOT_PLANNED' && reason !== 'DUPLICATE';
      return true;
    });

    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'opened') cmp = (a.created_at ?? '').localeCompare(b.created_at ?? '');
      else if (sortKey === 'closed') cmp = (a.closed_at ?? '').localeCompare(b.closed_at ?? '');
      else if (sortKey === 'updated') cmp = (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
      else if (sortKey === 'comments') cmp = a.comments - b.comments;
      else if (sortKey === 'repo') cmp = a.repo_full_name.localeCompare(b.repo_full_name);
      else if (sortKey === 'number') cmp = a.number - b.number;
      else if (sortKey === 'weight') {
        cmp = (lookupWeight(repoWeights, a.repo_full_name) ?? 0) - (lookupWeight(repoWeights, b.repo_full_name) ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [data, query, stateFilter, sortKey, sortDir, trackedOnly, tracked, authorFilter, closeFilter, repoWeights]);

  const authorOptions = useMemo(() => {
    if (!data?.issues) return [];
    const counts = new Map<string, number>();
    for (const i of data.issues) {
      const a = i.author_login;
      if (!a) continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([login, count]) => ({ login, count }));
  }, [data]);

  // Reset window size when filters or sort change
  useEffect(() => {
    setVisibleCount(PAGE_INCREMENT);
  }, [query, stateFilter, sortKey, sortDir, trackedOnly]);

  // IntersectionObserver: when sentinel enters viewport, render more rows
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
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'opened' || key === 'closed' || key === 'updated' || key === 'weight' || key === 'comments' ? 'desc' : 'asc');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Filter by title, repo, #, author…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 380, maxWidth: '100%' }}
        />
        <Dropdown
          value={stateFilter}
          onChange={(v) => setStateFilter(v)}
          options={STATE_OPTS.map((o) => ({ value: o.id, label: o.label }))}
          width={180}
          ariaLabel="Filter by state"
        />
        <Box
          onClick={() => setTrackedOnly((v) => !v)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            px: '12px',
            py: '5px',
            borderRadius: '6px',
            border: '1px solid',
            borderColor: trackedOnly ? 'var(--attention-emphasis)' : 'var(--border-default)',
            bg: trackedOnly ? 'var(--attention-subtle, rgba(242, 201, 76, 0.14))' : 'var(--bg-emphasis)',
            color: trackedOnly ? 'var(--attention-emphasis)' : 'var(--fg-default)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            lineHeight: '20px',
            userSelect: 'none',
            '&:hover': { borderColor: 'var(--border-strong)' },
          }}
        >
          {trackedOnly ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
          Tracked only ({tracked.size})
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0 }}>
          {isLoading && <Spinner size="sm" tone="muted" />}
          {data && (
            <Text>
              {filtered.length} issues across {new Set(filtered.map((i) => i.repo_full_name)).size} repos · live
            </Text>
          )}
        </Box>
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflowX: 'auto', overflowY: 'hidden', bg: 'canvas.default' }}>
        <Box as="table" sx={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse', fontSize: 1 }}>
          <Box
            as="thead"
            sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}
          >
            <Box as="tr">
              <HeaderCell label="" />
              <HeaderCell label="State" />
              <HeaderCell label="Issue" />
              <HeaderCell label="Repository" onClick={() => toggleSort('repo')} active={sortKey === 'repo'} dir={sortDir} />
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
              <HeaderCell label="Weight" onClick={() => toggleSort('weight')} active={sortKey === 'weight'} dir={sortDir} align="right" />
              <HeaderCell label="Comments" onClick={() => toggleSort('comments')} active={sortKey === 'comments'} dir={sortDir} align="right" />
              <HeaderCell label="Opened" onClick={() => toggleSort('opened')} active={sortKey === 'opened'} dir={sortDir} />
              <FilterHeader
                label="Closed"
                value={closeFilter}
                onChange={(v) => setCloseFilter(v as CloseFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'closed', label: 'Closed only' },
                  { value: 'still_open', label: 'Still open' },
                ]}
                width={180}
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
                      { width: 120 },
                      { width: 100 },
                      { width: 60 },
                      { width: 60 },
                      { width: 60 },
                      { width: 60 },
                    ]}
                  />
                </Box>
              </Box>
            )}
            {!isLoading && filtered.length === 0 && (
              <Box as="tr">
                <Box as="td" colSpan={9} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                  {data && data.count === 0
                    ? 'No issues cached yet. Visit a repo page or run the poller to populate.'
                    : 'No issues match these filters.'}
                </Box>
              </Box>
            )}
            {visible.map((issue) => {
              const [o, n] = issue.repo_full_name.split('/');
              const k = `${issue.repo_full_name}#${issue.number}`;
              const expanded = expandedKey === k;
              return (
                <React.Fragment key={k}>
                  <IssueTableRow
                    issue={issue}
                    tracked={tracked.has(issue.repo_full_name)}
                    onToggleTrack={() => toggleTrack(issue.repo_full_name)}
                    onRowClick={() => handleRowClick(issue)}
                    expanded={expanded}
                    weight={lookupWeight(repoWeights, issue.repo_full_name) ?? 0}
                  />
                  {expanded && settings.contentDisplay === 'accordion' && (
                    <Box as="tr">
                      <Box as="td" colSpan={9} sx={{ p: 0 }}>
                        <ContentViewer
                          target={{ kind: 'issue', owner: o, name: n, number: issue.number, preloaded: issue }}
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

      {openIssue && settings.contentDisplay === 'modal' && (() => {
        const [o, n] = openIssue.repo_full_name.split('/');
        return (
          <ContentViewer
            target={{ kind: 'issue', owner: o, name: n, number: openIssue.number, preloaded: openIssue }}
            mode="modal"
            onClose={() => setOpenIssue(null)}
          />
        );
      })()}

      {openIssue && settings.contentDisplay === 'side' && (() => {
        const [o, n] = openIssue.repo_full_name.split('/');
        return (
          <Box
            sx={{
              position: 'fixed',
              // 0 in sidebar mode, 64px in top-nav mode (header clearance).
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
    </Box>
  );
}

const headerCellSx = {
  p: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: 0,
  color: 'fg.muted',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
};

function FilterHeader({
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
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bg: 'accent.emphasis', display: 'inline-block' }} />
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

function IssueTableRow({
  weight,
  issue,
  tracked,
  onToggleTrack,
  onRowClick,
  expanded,
}: {
  issue: IssueDto;
  tracked: boolean;
  onToggleTrack: () => void;
  onRowClick?: () => void;
  expanded?: boolean;
  weight: number;
}) {
  const [owner, name] = issue.repo_full_name.split('/');

  return (
    <Box
      as="tr"
      onClick={onRowClick}
      data-explorer-row="true"
      sx={{
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        bg: expanded ? 'accent.muted' : tracked ? 'accent.subtle' : 'canvas.default',
        borderLeft: '3px solid',
        borderLeftColor: tracked ? 'accent.emphasis' : 'transparent',
        cursor: 'pointer',
        '&:hover': { bg: tracked ? 'accent.muted' : 'canvas.subtle' },
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Box as="td" sx={{ px: 2, py: '6px', textAlign: 'center', verticalAlign: 'middle', height: 36 }}>
        <Box
          as="button"
          onClick={(e) => { e.stopPropagation(); onToggleTrack(); }}
          sx={{
            cursor: 'pointer',
            border: 'none',
            bg: 'transparent',
            color: tracked ? 'attention.fg' : 'fg.muted',
            p: 1,
            borderRadius: 1,
            '&:hover': { bg: 'canvas.inset', color: 'attention.fg' },
          }}
          aria-label={tracked ? 'Untrack repo' : 'Track repo'}
        >
          {tracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', verticalAlign: 'middle', height: 36 }}>
        <IssueStatusBadge issue={issue} />
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', maxWidth: 420, verticalAlign: 'middle', height: 36 }}>
        <PrimerLink
          href={issue.html_url ?? '#'}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          sx={{
            color: 'fg.default',
            fontWeight: 500,
            display: 'inline-block',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
            '&:hover': { color: 'accent.fg' },
          }}
        >
          {issue.title}
        </PrimerLink>
        <Text sx={{ ml: 1, color: 'fg.muted', fontSize: 0 }}>#{issue.number}</Text>
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', verticalAlign: 'middle', height: 36 }}>
        <Link href={`/repos/${owner}/${name}`} prefetch={false} style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'accent.fg', '&:hover': { textDecoration: 'underline' } }}>
            <RepoIcon size={12} />
            <Text>{issue.repo_full_name}</Text>
          </Box>
        </Link>
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', fontSize: 0, verticalAlign: 'middle', height: 36 }}>
        {issue.author_login ? (
          <a
            href={`https://github.com/${issue.author_login}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'inherit' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://github.com/${issue.author_login}.png?size=40`}
              alt={issue.author_login}
              loading="lazy"
              style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0, display: 'block' }}
            />
            <Text sx={{ fontWeight: 500, color: 'fg.default', '&:hover': { color: 'accent.fg' } }}>
              {issue.author_login}
            </Text>
            {issue.author_association && issue.author_association !== 'NONE' && (
              <Label variant="secondary" sx={{ fontSize: '10px' }}>
                {issue.author_association.toLowerCase()}
              </Label>
            )}
          </a>
        ) : (
          <Text sx={{ fontWeight: 500, color: 'fg.muted' }}>—</Text>
        )}
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
            weight >= 0.5
              ? 'success.fg'
              : weight >= 0.3
              ? 'accent.fg'
              : weight >= 0.15
              ? 'attention.fg'
              : weight >= 0.05
              ? 'fg.default'
              : 'fg.muted',
        }}
      >
        {weight.toFixed(4)}
      </Box>
      <Box as="td" sx={{ px: 2, py: '6px', textAlign: 'right', verticalAlign: 'middle', height: 36 }}>
        {issue.comments > 0 && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'fg.muted' }}>
            <CommentIcon size={12} />
            <Text>{issue.comments}</Text>
          </Box>
        )}
      </Box>
      <Box
        as="td"
        sx={{ p: 2, fontSize: 0, whiteSpace: 'nowrap' }}
        title={issue.created_at ?? undefined}
      >
        <Text sx={{ color: 'fg.default' }}>{formatRelativeTime(issue.created_at)}</Text>
      </Box>
      <Box
        as="td"
        sx={{ p: 2, fontSize: 0, whiteSpace: 'nowrap' }}
        title={issue.closed_at ?? undefined}
      >
        {issue.closed_at ? (
          <Text sx={{ color: 'fg.default' }}>{formatRelativeTime(issue.closed_at)}</Text>
        ) : (
          <Text sx={{ color: 'fg.muted' }}>—</Text>
        )}
      </Box>
    </Box>
  );
}
