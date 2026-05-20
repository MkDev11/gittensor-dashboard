'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import {
  TriangleDownIcon,
  TriangleUpIcon,
  CheckIcon,
  XIcon,
  RepoIcon,
  GitPullRequestIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  IssueOpenedIcon,
  IssueClosedIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import {
  Miner,
  MinerIdentity,
  EligibilityDot,
  TrackButton,
  CountCell,
  IntensityBar,
  Segmented,
  Pill,
  SearchBox,
  RowSizeSelector,
  PageNav,
  MONO,
  LABEL,
  ghKey,
  ghName,
  num,
  viewOf,
} from './parts';

interface MinersResp {
  count: number;
  fetched_at: number;
  source?: string;
  miners: Miner[];
}

type Track = 'oss' | 'discovery';
type EligibilityFilter = 'all' | 'eligible' | 'ineligible';
type SortKey = 'score' | 'primary' | 'cred' | 'usd' | 'repos' | 'active';
type SortDir = 'asc' | 'desc';

const DEFAULT_ROWS = 25;

interface Summary {
  total: number;
  ossEligible: number;
  discEligible: number;
  ossPool: number;
  discPool: number;
  topScore: number;
}

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [track, setTrack] = useState<Track>('oss');
  const [query, setQuery] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityFilter>('all');
  const [tracksOnly, setTracksOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState<number>(DEFAULT_ROWS);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<MinersResp>({
    queryKey: ['miners'],
    queryFn: async () => {
      const r = await fetch('/api/miners');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // Prefetch detail data on hover/focus so navigation feels instant.
  const queryClient = useQueryClient();
  const prefetchMiner = useCallback((uid: number | string) => {
    queryClient.prefetchQuery({
      queryKey: ['miner-detail', String(uid)],
      queryFn: async () => {
        const r = await fetch(`/api/gt/miners/${uid}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      },
      staleTime: 25_000,
    });
  }, [queryClient]);

  const summary = useMemo<Summary>(() => {
    const empty: Summary = { total: 0, ossEligible: 0, discEligible: 0, ossPool: 0, discPool: 0, topScore: 0 };
    if (!data?.miners) return empty;
    let ossEligible = 0, discEligible = 0, ossPool = 0, discPool = 0;
    let topScore = 0;
    for (const m of data.miners) {
      if (m.isEligible) ossEligible += 1;
      if (m.isIssueEligible) discEligible += 1;
      ossPool += viewOf(m, 'oss').usd;
      discPool += viewOf(m, 'discovery').usd;
      // Combined (OSS + Discovery), not max single-track.
      const combined = num(m.totalScore) + num(m.issueDiscoveryScore);
      if (combined > topScore) topScore = combined;
    }
    return { total: data.miners.length, ossEligible, discEligible, ossPool, discPool, topScore };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.miners) return [];
    const q = query.trim().toLowerCase();
    return data.miners.filter((m) => {
      if (q && !`${ghName(m)} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      const eligible = track === 'oss' ? !!m.isEligible : !!m.isIssueEligible;
      if (eligibility === 'eligible' && !eligible) return false;
      if (eligibility === 'ineligible' && eligible) return false;
      if (tracksOnly && !tracked.has(String(m.uid))) return false;
      return true;
    });
  }, [data, query, eligibility, track, tracksOnly, tracked]);

  // Eligible miners always float to the top, regardless of sort key.
  const sorted = useMemo(() => {
    const valueOf = (m: Miner): number => {
      const v = viewOf(m, track);
      switch (sortKey) {
        case 'score':   return v.score;
        case 'primary': return v.counts.primary;
        case 'cred':    return v.cred;
        case 'usd':     return v.usd;
        case 'repos':   return track === 'oss' ? (m.eligibleRepoCount ?? 0) : (m.issueEligibleRepoCount ?? 0);
        case 'active': {
          const iso = track === 'oss' ? m.lastOssActivityAt : m.lastDiscoveryActivityAt;
          return iso ? Date.parse(iso) : 0;
        }
      }
    };
    const eligibleOf = (m: Miner) => (track === 'oss' ? !!m.isEligible : !!m.isIssueEligible);
    return [...filtered].sort((a, b) => {
      const aE = eligibleOf(a), bE = eligibleOf(b);
      if (aE !== bE) return aE ? -1 : 1;
      const cmp = valueOf(a) - valueOf(b);
      const eff = cmp === 0 ? viewOf(a, track).score - viewOf(b, track).score : cmp;
      return sortDir === 'desc' ? -eff : eff;
    });
  }, [filtered, track, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [query, eligibility, track, tracksOnly, sortKey, sortDir, pageSize]);

  const pageStart = pageSize === Infinity ? 0 : (page - 1) * pageSize;
  const pageEnd   = pageSize === Infinity ? sorted.length : pageStart + pageSize;
  const visible   = sorted.slice(pageStart, pageEnd);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  const loadingFirst = isLoading && !data;

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <SummaryStrip summary={summary} loading={loadingFirst} />
      </PageLayout.Header>

      <PageLayout.Content>
        <Toolbar
          track={track}
          setTrack={setTrack}
          summary={summary}
          query={query}
          setQuery={setQuery}
          eligibility={eligibility}
          setEligibility={setEligibility}
          tracksOnly={tracksOnly}
          setTracksOnly={setTracksOnly}
          trackedCount={tracked.size}
          pageSize={pageSize}
          onPageSize={setPageSize}
          totalItems={sorted.length}
          totalAll={data?.miners.length ?? 0}
        />

        {isError ? (
          <Box
            sx={{
              p: 3,
              border: '1px solid',
              borderColor: 'danger.emphasis',
              borderRadius: 2,
              bg: 'canvas.subtle',
              mt: 2,
            }}
          >
            <Text sx={{ color: 'danger.fg' }}>Failed to load miners.</Text>
          </Box>
        ) : (
          <LeaderTable
            track={track}
            miners={visible}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            me={me}
            tracked={tracked}
            onToggleTrack={toggle}
            loading={loadingFirst}
            onPrefetch={prefetchMiner}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            filteredCount={sorted.length}
            startRank={pageStart}
          />
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}

/* ─────────────────────────── Summary strip ─────────────────────────── */

function SummaryStrip({ summary, loading }: { summary: Summary; loading: boolean }) {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const cell = (k: string, v: string, sub?: string) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <Text sx={{ ...LABEL }}>{k}</Text>
      <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
        <Text sx={{ ...MONO, fontSize: 3, fontWeight: 700, letterSpacing: '-0.02em', color: 'fg.default' }}>
          {loading ? '—' : v}
        </Text>
        {sub && (
          <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted', display: ['none', null, 'inline'] }}>
            {sub}
          </Text>
        )}
      </Box>
    </Box>
  );
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Heading sx={{ fontSize: [3, null, 4], letterSpacing: '-0.02em', lineHeight: 1.1 }}>Miners</Heading>
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
            Live SN74 leaderboard · earn $TAO for shipping code and surfacing issues
          </Text>
        </Box>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['repeat(2, minmax(0, 1fr))', null, 'repeat(4, minmax(0, 1fr))'],
          gap: 0,
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.subtle',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ p: ['10px', null, '12px'], borderRight: ['1px solid', null, '1px solid'], borderRightColor: 'border.muted', borderBottom: ['1px solid', null, 'none'], borderBottomColor: 'border.muted' }}>
          {cell('Miners', loading ? '—' : summary.total.toLocaleString())}
        </Box>
        <Box sx={{ p: ['10px', null, '12px'], borderBottom: ['1px solid', null, 'none'], borderBottomColor: 'border.muted', borderRight: [null, null, '1px solid'], borderRightColor: 'border.muted' }}>
          {cell('OSS Eligible', loading ? '—' : summary.ossEligible.toLocaleString(), loading ? '' : `${fmt(summary.ossPool)}/d pool`)}
        </Box>
        <Box sx={{ p: ['10px', null, '12px'], borderRight: '1px solid', borderRightColor: 'border.muted' }}>
          {cell('Discovery Eligible', loading ? '—' : summary.discEligible.toLocaleString(), loading ? '' : `${fmt(summary.discPool)}/d pool`)}
        </Box>
        <Box sx={{ p: ['10px', null, '12px'] }}>
          {cell('Top Score', loading ? '—' : summary.topScore.toFixed(2))}
        </Box>
      </Box>
    </Box>
  );
}

/* ─────────────────────────── Toolbar ─────────────────────────── */

function Toolbar({
  track, setTrack, summary,
  query, setQuery,
  eligibility, setEligibility,
  tracksOnly, setTracksOnly,
  trackedCount,
  pageSize, onPageSize,
  totalItems, totalAll,
}: {
  track: Track;
  setTrack: (t: Track) => void;
  summary: Summary;
  query: string;
  setQuery: (s: string) => void;
  eligibility: EligibilityFilter;
  setEligibility: (e: EligibilityFilter) => void;
  tracksOnly: boolean;
  setTracksOnly: (b: boolean) => void;
  trackedCount: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  totalItems: number;
  totalAll: number;
}) {
  return (
    <Box
      sx={{
        mt: 3,
        mb: 2,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        rowGap: 2,
        columnGap: 2,
      }}
    >
      <Segmented<Track>
        ariaLabel="Track"
        options={[
          { key: 'oss',       label: 'OSS',       icon: <GitPullRequestIcon size={11} />, count: summary.ossEligible },
          { key: 'discovery', label: 'Discovery', icon: <IssueOpenedIcon size={11} />,    count: summary.discEligible },
        ]}
        value={track}
        onChange={setTrack}
      />

      <Divider />

      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {(['all', 'eligible', 'ineligible'] as EligibilityFilter[]).map((e) => (
          <Pill key={e} active={eligibility === e} onClick={() => setEligibility(e)}>
            {e === 'all' ? (
              'All'
            ) : e === 'eligible' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckIcon size={10} />Eligible
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <XIcon size={10} />Ineligible
              </span>
            )}
          </Pill>
        ))}
        {trackedCount > 0 && (
          <Pill active={tracksOnly} onClick={() => setTracksOnly(!tracksOnly)}>
            ★ Tracked
          </Pill>
        )}
      </Box>

      <Box
        sx={{
          ml: ['0', null, 'auto'],
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <RowSizeSelector
          value={pageSize}
          onChange={onPageSize}
          total={totalAll}
          filtered={totalItems}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Search miner, UID, hotkey…" size="sm" />
      </Box>
    </Box>
  );
}

function Divider() {
  return (
    <Box
      aria-hidden
      sx={{
        alignSelf: 'stretch',
        width: '1px',
        bg: 'border.muted',
        my: '4px',
        display: ['none', null, 'block'],
      }}
    />
  );
}

/* ─────────────────────────── Leader table ─────────────────────────── */

// Sortable column widths include headroom for the active-sort caret.
const COLS = '28px minmax(160px, 1.5fr) 58px 60px 70px 54px 60px 60px 62px 82px 76px 26px';

function LeaderTable({
  track, miners,
  sortKey, sortDir, onSort,
  me, tracked, onToggleTrack,
  loading,
  onPrefetch,
  page, pageSize, onPage, filteredCount, startRank,
}: {
  track: Track;
  miners: Miner[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  me: string;
  tracked: Set<string>;
  onToggleTrack: (id: string) => void;
  loading: boolean;
  onPrefetch: (uid: number | string) => void;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  filteredCount: number;
  /** Index offset so paged rows keep their absolute rank. */
  startRank: number;
}) {
  const primaryLabel = track === 'oss' ? 'Merged' : 'Solved';

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        overflow: 'hidden',
        bg: 'canvas.default',
      }}
    >
      <Box
        sx={{
          display: ['none', null, 'grid'],
          gridTemplateColumns: COLS,
          alignItems: 'center',
          columnGap: 1,
          px: 3,
          py: '8px',
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          bg: 'canvas.subtle',
        }}
      >
        <ColHdr align="center">#</ColHdr>
        <ColHdr align="left">Miner</ColHdr>
        <ColHdr align="center" title="Eligibility for the current track">Eligible</ColHdr>
        <SortHdr active={sortKey === 'repos'} dir={sortDir} onClick={() => onSort('repos')} title="Eligible repositories">Repos</SortHdr>
        <SortHdr active={sortKey === 'primary'} dir={sortDir} onClick={() => onSort('primary')}>{primaryLabel}</SortHdr>
        <ColHdr title="Open">Open</ColHdr>
        <ColHdr title="Closed">Closed</ColHdr>
        <SortHdr active={sortKey === 'cred'} dir={sortDir} onClick={() => onSort('cred')}>Cred</SortHdr>
        <SortHdr active={sortKey === 'score'} dir={sortDir} onClick={() => onSort('score')}>Score</SortHdr>
        <SortHdr active={sortKey === 'usd'} dir={sortDir} onClick={() => onSort('usd')}>$/Day</SortHdr>
        <SortHdr
          active={sortKey === 'active'} dir={sortDir} onClick={() => onSort('active')}
          title={track === 'oss' ? 'Time of last PR activity (created or merged)' : 'Time of last issue activity (opened or closed)'}
        >Active</SortHdr>
        <span />
      </Box>

      <Box
        sx={{
          display: ['flex', null, 'none'],
          alignItems: 'center',
          gap: '4px',
          px: 2,
          py: '6px',
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          bg: 'canvas.subtle',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        <Text sx={{ ...LABEL, flexShrink: 0, pr: 1 }}>Sort</Text>
        {([
          ['score',   'Score'],
          ['cred',    'Cred'],
          ['repos',   'Repos'],
          ['primary', primaryLabel],
          ['active',  'Active'],
          ['usd',     '$/Day'],
        ] as [SortKey, string][]).map(([k, label]) => (
          <Pill key={k} active={sortKey === k} onClick={() => onSort(k)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {label}
              {sortKey === k && (sortDir === 'desc' ? <TriangleDownIcon size={10} /> : <TriangleUpIcon size={10} />)}
            </span>
          </Pill>
        ))}
      </Box>

      {loading ? (
        <Box sx={{ p: 2 }}>
          <TableRowsSkeleton
            rows={8}
            cols={[{ width: 24 }, { flex: 1 }, { width: 60 }, { width: 50 }, { width: 50 }, { width: 60 }]}
          />
        </Box>
      ) : miners.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>
          No miners match your filters.
        </Box>
      ) : (
        miners.map((m, i) => (
          <LeaderRow
            key={m.uid}
            miner={m}
            track={track}
            rank={startRank + i + 1}
            isMe={ghKey(m.githubUsername) === ghKey(me)}
            isTracked={tracked.has(String(m.uid))}
            onToggleTrack={() => onToggleTrack(String(m.uid))}
            isLast={i === miners.length - 1}
            onPrefetch={() => onPrefetch(m.uid)}
          />
        ))
      )}

      {filteredCount > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: [2, null, 3],
            py: '8px',
            borderTop: '1px solid',
            borderTopColor: 'border.muted',
            bg: 'canvas.subtle',
          }}
        >
          <PageNav page={page} pageSize={pageSize} filteredCount={filteredCount} onPage={onPage} />
        </Box>
      )}
    </Box>
  );
}

function ColHdr({
  children,
  align = 'right',
  title,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  title?: string;
}) {
  return (
    <Text
      title={title}
      sx={{
        ...LABEL,
        textAlign: align,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Text>
  );
}

function SortHdr({
  active,
  dir,
  onClick,
  children,
  title,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '3px',
        border: 'none',
        bg: 'transparent',
        color: active ? 'fg.default' : 'fg.muted',
        fontFamily: 'inherit',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        textAlign: 'right',
        p: 0,
        transition: 'color 100ms',
        '&:hover': { color: 'fg.default' },
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '2px', borderRadius: '2px' },
      }}
    >
      {children}
      {active && (dir === 'desc' ? <TriangleDownIcon size={10} /> : <TriangleUpIcon size={10} />)}
    </Box>
  );
}

/* ─────────────────────────── Leader row ─────────────────────────── */

function LeaderRow({
  miner, track, rank,
  isMe, isTracked, onToggleTrack,
  isLast,
  onPrefetch,
}: {
  miner: Miner;
  track: Track;
  rank: number;
  isMe: boolean;
  isTracked: boolean;
  onToggleTrack: () => void;
  isLast: boolean;
  onPrefetch?: () => void;
}) {
  const view = viewOf(miner, track);
  const credPct = Math.max(0, Math.min(100, Math.round(view.cred * 100)));
  const eligibleRepos = track === 'oss' ? (miner.eligibleRepoCount ?? 0) : (miner.issueEligibleRepoCount ?? 0);
  const lastActiveAt = track === 'oss' ? miner.lastOssActivityAt : miner.lastDiscoveryActivityAt;

  const PrimaryIcon = track === 'oss' ? GitMergeIcon              : IssueClosedIcon;
  const OpenIcon    = track === 'oss' ? GitPullRequestIcon        : IssueOpenedIcon;
  const ClosedIcon  = track === 'oss' ? GitPullRequestClosedIcon  : SkipIcon;

  return (
    <Link
      href={`/miners/${miner.uid}`}
      prefetch={false}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onTouchStart={onPrefetch}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['32px minmax(0, 1fr) 78px 28px', null, COLS],
          gridTemplateAreas: [
            `"rank ident usd  star"
             ".    meta  meta meta"`,
            null,
            `"rank ident elig repos prim open closed cred score usd active star"`,
          ],
          alignItems: 'center',
          columnGap: [2, null, 1],
          rowGap: ['4px', null, 0],
          px: [2, null, 3],
          py: ['10px', null, '8px'],
          bg: isMe ? 'canvas.inset' : 'transparent',
          borderBottom: isLast ? 'none' : '1px solid',
          borderBottomColor: 'border.muted',
          cursor: 'pointer',
          position: 'relative',
          '&::before': isMe ? {
            content: '""',
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: '2px',
            backgroundColor: 'var(--accent-fg)',
          } : undefined,
          '@media (hover: hover)': {
            transition: 'background-color 100ms',
            '&:hover': { bg: isMe ? 'canvas.inset' : 'canvas.subtle' },
          },
        }}
      >
        <Box sx={{ gridArea: 'rank', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text
            sx={{
              ...MONO,
              fontSize: 0,
              color: rank <= 3 ? 'fg.default' : 'fg.muted',
              fontWeight: rank <= 3 ? 700 : 500,
              lineHeight: 1,
            }}
          >
            {rank}
          </Text>
        </Box>

        <Box sx={{ gridArea: 'ident', minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <MinerIdentity miner={miner} avatarSize={22} showUid={true} />
          {isTracked && (
            <Text sx={{ color: 'fg.muted', fontSize: 0, lineHeight: 1, flexShrink: 0 }} title="Tracked">★</Text>
          )}
        </Box>

        <Box sx={{ gridArea: 'elig', display: ['none', null, 'flex'], justifyContent: 'center' }}>
          <EligibilityDot eligible={view.eligible} />
        </Box>

        <Box sx={{ gridArea: 'repos', display: ['none', null, 'flex'], justifyContent: 'flex-end', minWidth: 0 }}>
          <CountCell icon={<RepoIcon size={11} />} value={eligibleRepos} tone="accent" title="Eligible repositories" />
        </Box>

        <Box sx={{ gridArea: 'prim', display: ['none', null, 'flex'], justifyContent: 'flex-end', minWidth: 0 }}>
          <CountCell icon={<PrimaryIcon size={11} />} value={view.counts.primary} tone="done" title={track === 'oss' ? 'Merged PRs' : 'Solved issues'} />
        </Box>

        <Box sx={{ gridArea: 'open', display: ['none', null, 'flex'], justifyContent: 'flex-end', minWidth: 0 }}>
          <CountCell icon={<OpenIcon size={11} />} value={view.counts.open} tone="success" title={track === 'oss' ? 'Open PRs' : 'Open issues'} />
        </Box>

        <Box sx={{ gridArea: 'closed', display: ['none', null, 'flex'], justifyContent: 'flex-end', minWidth: 0 }}>
          <CountCell icon={<ClosedIcon size={11} />} value={view.counts.closed} tone="danger" title={track === 'oss' ? 'Closed (unmerged) PRs' : 'Closed (not-planned) issues'} />
        </Box>

        <Box sx={{ gridArea: 'active', display: ['none', null, 'block'], textAlign: 'right', minWidth: 0 }} title={lastActiveAt ? `${track === 'oss' ? 'Last PR' : 'Last issue'} activity: ${lastActiveAt}` : 'No recorded activity'}>
          <Text sx={{ ...MONO, fontSize: '11px', color: lastActiveAt ? 'fg.muted' : 'fg.subtle', whiteSpace: 'nowrap' }}>
            {lastActiveAt ? formatRelativeTime(lastActiveAt) : '—'}
          </Text>
        </Box>

        <Box
          sx={{
            gridArea: 'cred',
            display: ['none', null, 'flex'],
            flexDirection: 'column',
            gap: '2px',
            minWidth: 0,
            px: '4px',
          }}
          title={view.cred > 0 ? `Credibility · ${credPct}%` : 'Credibility · —'}
        >
          <IntensityBar value={view.cred} height={4} tone="neutral" />
          <Text
            sx={{
              ...MONO,
              fontSize: '10px',
              color: 'fg.muted',
              textAlign: 'right',
              lineHeight: 1,
            }}
          >
            {view.cred > 0 ? `${credPct}%` : '—'}
          </Text>
        </Box>

        <Box sx={{ gridArea: 'score', display: ['none', null, 'block'], textAlign: 'right', minWidth: 0 }}>
          <Text sx={{ ...MONO, fontSize: 1, fontWeight: 600, color: 'fg.default' }}>
            {view.score.toFixed(2)}
          </Text>
        </Box>

        {/* $/Day shown at all breakpoints; siblings are desktop-only. */}
        <Box sx={{ gridArea: 'usd', textAlign: 'right', minWidth: 0 }}>
          <Text
            sx={{
              ...MONO,
              fontSize: 1,
              fontWeight: view.usd > 0 ? 700 : 400,
              color: view.usd > 0 ? 'success.fg' : 'fg.muted',
            }}
          >
            {view.usd > 0 ? formatUsd(view.usd, { style: 'compact' }) : '—'}
          </Text>
        </Box>

        <Box
          sx={{
            gridArea: 'meta',
            display: ['flex', null, 'none'],
            alignItems: 'center',
            gap: '10px',
            pl: '4px',
            minWidth: 0,
            flexWrap: 'wrap',
          }}
        >
          <EligibilityDot eligible={view.eligible} />
          <CountCell icon={<RepoIcon size={10} />}    value={eligibleRepos}      tone="accent"  />
          <CountCell icon={<PrimaryIcon size={10} />} value={view.counts.primary} tone="done"    />
          <CountCell icon={<OpenIcon size={10} />}    value={view.counts.open}    tone="success" />
          <CountCell icon={<ClosedIcon size={10} />}  value={view.counts.closed}  tone="danger"  />
          {lastActiveAt && (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
              {formatRelativeTime(lastActiveAt)}
            </Text>
          )}
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', ml: 'auto' }}>
            {view.score.toFixed(2)} · {view.cred > 0 ? `${credPct}%` : '—'}
          </Text>
        </Box>

        <Box sx={{ gridArea: 'star', display: 'flex', justifyContent: 'center' }}>
          <TrackButton isTracked={isTracked} onClick={onToggleTrack} />
        </Box>
      </Box>
    </Link>
  );
}

