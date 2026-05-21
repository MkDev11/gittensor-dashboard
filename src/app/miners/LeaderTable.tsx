'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Box, Text } from '@primer/react';
import {
  TriangleDownIcon, TriangleUpIcon, CheckIcon, XIcon, StarIcon, StarFillIcon,
  GitPullRequestIcon, IssueOpenedIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import {
  Miner,
  MinerAvatar,
  DualTrackBar,
  Pill,
  SearchBox,
  RowSizeSelector,
  PageNav,
  SortControl,
  MONO,
  LABEL,
  ghKey,
  ghName,
  num,
  viewOf,
  MinerStatusKind,
  MinerStatus,
  STATUS_REGISTRY,
  STATUS_TONE,
  StatusBadge,
} from './components';

export type EligibilityFilter = 'all' | 'eligible' | 'ineligible';
export type SortKey = 'score' | 'cred' | 'usd' | 'repos' | 'active' | 'movement' | 'volume';
export type SortDir = 'asc' | 'desc';

// Repos is the 1fr slack absorber — chips spread on wide screens.
const COLS = '44px minmax(170px, 240px) 124px minmax(88px, 104px) 60px 72px 84px minmax(180px, 1fr) 92px 28px';

function MinerIdentity({
  miner,
  avatarSize,
  showUid = true,
}: {
  miner: Miner;
  avatarSize: number;
  showUid?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      <MinerAvatar miner={miner} size={avatarSize} />
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <Text
          sx={{
            fontWeight: 600,
            fontSize: 1,
            color: 'fg.default',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.005em',
          }}
        >
          {ghName(miner)}
        </Text>
        {showUid && (
          <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle', flexShrink: 0 }}>
            #{miner.uid}
          </Text>
        )}
      </Box>
    </Box>
  );
}

function TrackButton({ isTracked, onClick }: { isTracked: boolean; onClick: () => void }) {
  return (
    <Box
      as="button"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
      title={isTracked ? 'Untrack miner' : 'Track miner'}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        bg: 'transparent',
        border: 'none',
        borderRadius: 1,
        color: isTracked ? 'fg.default' : 'fg.muted',
        cursor: 'pointer',
        '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
      }}
    >
      {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
    </Box>
  );
}

function Sparkline({
  values,
  width = 72,
  height = 22,
  title,
}: {
  values: number[];
  width?: number;
  height?: number;
  title?: string;
}) {
  if (!values.length) {
    return <Box title={title} aria-hidden sx={{ width, height, display: 'inline-block' }} />;
  }
  const max = Math.max(...values);
  const cols = values.length;
  const total = values.reduce((a, b) => a + b, 0);
  const last7 = values.slice(-7).reduce((a, b) => a + b, 0);
  const prior7 = cols >= 14 ? values.slice(-14, -7).reduce((a, b) => a + b, 0) : null;
  let trendPart = '';
  if (prior7 != null) {
    if (prior7 === 0 && last7 > 0) {
      trendPart = ` · new activity this week`;
    } else if (prior7 > 0) {
      const arrow = last7 > prior7 ? '↑' : last7 < prior7 ? '↓' : '·';
      const pct = Math.round(Math.abs(last7 - prior7) / prior7 * 100);
      trendPart = ` · ${arrow}${pct}% vs prior 7d`;
    }
  }
  const computedTitle = title
    ?? (total === 0
      ? `No PR activity in the last ${cols} days`
      : `PR activity · ${total} merged in ${cols}d · ${last7} in the last 7d${trendPart}`);
  const padV = 2;

  const pts = values.map((v, i) => ({
    x: cols > 1 ? (i / (cols - 1)) * (width - 1) : (width - 1) / 2,
    y: padV + (max > 0 ? 1 - v / max : 1) * (height - padV * 2),
  }));

  const linePoints = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaD = [
    `M${pts[0].x.toFixed(1)},${height}`,
    ...pts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${pts[pts.length - 1].x.toFixed(1)},${height}`,
    'Z',
  ].join(' ');

  return (
    <Box
      title={computedTitle}
      aria-label={computedTitle}
      sx={{ display: 'inline-block', width, height, flexShrink: 0 }}
    >
      <svg width={width} height={height} style={{ display: 'block', overflow: 'hidden' }}>
        <path d={areaD} fill="var(--accent-fg)" opacity={0.08} />
        <polyline
          points={linePoints}
          fill="none"
          stroke="var(--accent-fg)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.7}
        />
      </svg>
    </Box>
  );
}

function MovementCell({
  currentRank,
  previousRank,
}: {
  currentRank: number;
  previousRank: number | null | undefined;
}) {
  if (previousRank == null) {
    return (
      <Text title="No rank snapshot from yesterday yet" sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap' }}>
        —
      </Text>
    );
  }
  const delta = previousRank - currentRank;
  if (delta === 0) {
    return (
      <Text title="No rank change since yesterday" sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle', lineHeight: 1 }}>
        ·
      </Text>
    );
  }
  const up = delta > 0;
  const abs = Math.abs(delta);
  return (
    <Text
      title={up ? `Up ${abs} rank${abs === 1 ? '' : 's'} since yesterday` : `Down ${abs} rank${abs === 1 ? '' : 's'} since yesterday`}
      sx={{
        ...MONO,
        fontSize: '11px',
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: up ? 'success.fg' : 'danger.fg',
      }}
    >
      {up ? '↑' : '↓'}{abs}
    </Text>
  );
}

function ContribCell({
  merged, solved, ossScore, ossEligible, discScore, discEligible,
}: {
  merged: number; solved: number;
  ossScore: number; ossEligible: boolean;
  discScore: number; discEligible: boolean;
}) {
  return (
    <Box
      sx={{
        gridArea: 'contrib',
        display: ['none', null, 'flex'],
        flexDirection: 'column',
        gap: '5px',
        minWidth: 0,
        px: '6px',
        justifyContent: 'center',
      }}
    >
      {/* OSS / PRs row */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}
        title={`${merged} merged PR${merged === 1 ? '' : 's'} · OSS score ${ossScore.toFixed(1)}`}
      >
        <Box sx={{ color: ossEligible ? 'accent.fg' : 'fg.muted', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <GitPullRequestIcon size={10} />
        </Box>
        <Text sx={{ ...MONO, fontSize: 0, lineHeight: 1, color: merged > 0 ? 'fg.muted' : 'fg.subtle', flexShrink: 0 }}>
          {merged > 0 ? merged.toLocaleString() : '—'}
        </Text>
        <Text sx={{ lineHeight: 1, color: 'fg.subtle', flexShrink: 0, fontSize: '10px' }} aria-hidden>·</Text>
        <Text
          sx={{ ...MONO, fontSize: 0, fontWeight: 600, lineHeight: 1, ml: 'auto', flexShrink: 0 }}
          style={{ color: ossScore > 0 ? (ossEligible ? 'var(--fg-default)' : 'var(--fg-muted)') : 'var(--fg-subtle)' }}
        >
          {ossScore > 0 ? ossScore.toFixed(1) : '—'}
        </Text>
      </Box>
      {/* Discovery / Issues row */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}
        title={`${solved} solved issue${solved === 1 ? '' : 's'} · Discovery score ${discScore.toFixed(1)}`}
      >
        <Box sx={{ color: discEligible ? 'done.fg' : 'fg.muted', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <IssueOpenedIcon size={10} />
        </Box>
        <Text sx={{ ...MONO, fontSize: 0, lineHeight: 1, color: solved > 0 ? 'fg.muted' : 'fg.subtle', flexShrink: 0 }}>
          {solved > 0 ? solved.toLocaleString() : '—'}
        </Text>
        <Text sx={{ lineHeight: 1, color: 'fg.subtle', flexShrink: 0, fontSize: '10px' }} aria-hidden>·</Text>
        <Text
          sx={{ ...MONO, fontSize: 0, fontWeight: 600, lineHeight: 1, ml: 'auto', flexShrink: 0 }}
          style={{ color: discScore > 0 ? (discEligible ? 'var(--fg-default)' : 'var(--fg-muted)') : 'var(--fg-subtle)' }}
        >
          {discScore > 0 ? discScore.toFixed(1) : '—'}
        </Text>
      </Box>
    </Box>
  );
}

function RepoChip({
  fullName,
  active,
  count,
  onClick,
}: {
  fullName: string;
  active?: boolean;
  count?: number;
  onClick?: (fullName: string) => void;
}) {
  const slashIdx = fullName.lastIndexOf('/');
  const short = slashIdx >= 0 ? fullName.slice(slashIdx + 1) : fullName;
  const owner = slashIdx >= 0 ? fullName.slice(0, slashIdx) : '';
  const handle = onClick
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onClick(fullName);
      }
    : undefined;
  return (
    <Box
      as={onClick ? 'button' : 'span'}
      onClick={handle}
      title={`${fullName}${count ? ` · ${count} PR${count === 1 ? '' : 's'}` : ''}`}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '6px',
        py: '2px',
        borderRadius: 999,
        border: '1px solid',
        borderColor: active ? 'accent.emphasis' : 'border.muted',
        bg: active ? 'accent.subtle' : 'canvas.default',
        color: active ? 'accent.fg' : 'fg.muted',
        fontFamily: 'inherit',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background-color 100ms, color 100ms, border-color 100ms',
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '@media (hover: hover)': onClick ? { '&:hover': { color: 'fg.default', borderColor: 'border.default' } } : undefined,
      }}
    >
      {owner && (
        <Text as="span" sx={{ opacity: 0.45, fontSize: '9px', fontWeight: 500, letterSpacing: 0 }}>
          {owner}/
        </Text>
      )}
      <Text as="span">{short}</Text>
      {count != null && count > 0 && (
        <Text as="span" sx={{ ...MONO, fontSize: '9px', color: active ? 'accent.fg' : 'fg.subtle', opacity: active ? 1 : 0.7 }}>{count}</Text>
      )}
    </Box>
  );
}


// Priority order: momentum > inactivity > niche.
function deriveMinerStatus(miner: Miner, currentRank: number): MinerStatus {
  const daily = miner.daily35 ?? [];
  const recent3 = daily.slice(-3).reduce((a, b) => a + b, 0);
  const recent14 = daily.slice(-14).reduce((a, b) => a + b, 0);
  const merged = miner.totalValidMergedPrs ?? miner.totalMergedPrs ?? 0;
  const uniqueRepos = miner.uniqueReposCount ?? 0;
  const prevRank = miner.previousRank ?? null;
  const climbedBy = prevRank != null ? prevRank - currentRank : 0;

  if (recent3 >= 3) return { kind: 'hot', ...STATUS_REGISTRY.hot };
  if (climbedBy >= 3) return { kind: 'climbing', ...STATUS_REGISTRY.climbing };
  if (recent14 === 0) return { kind: 'dormant', ...STATUS_REGISTRY.dormant };
  if (uniqueRepos > 0 && uniqueRepos <= 2 && merged >= 5) {
    return { kind: 'specialist', ...STATUS_REGISTRY.specialist };
  }
  if (miner.isEligible && miner.isIssueEligible) {
    return { kind: 'dual', ...STATUS_REGISTRY.dual };
  }
  return { kind: 'none', icon: '', label: '', hint: '' };
}

/* =========================================================================
 * Toolbar — filter pills + sort control + search + page-size selector
 * ========================================================================= */

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'score',    label: 'Score' },
  { key: 'usd',      label: '$/Day' },
  { key: 'cred',     label: 'Success %' },
  { key: 'volume',   label: 'Merged · Solved' },
  { key: 'movement', label: 'Movement' },
  { key: 'active',   label: 'Last Active' },
  { key: 'repos',    label: 'Repos' },
];

export interface ToolbarProps {
  query: string;
  setQuery: (s: string) => void;
  eligibility: EligibilityFilter;
  setEligibility: (e: EligibilityFilter) => void;
  tracksOnly: boolean;
  setTracksOnly: (b: boolean) => void;
  trackedCount: number;
  repoFilter: string | null;
  onClearRepoFilter: () => void;
  pageSize: number;
  onPageSize: (n: number) => void;
  totalItems: number;
  totalAll: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onSortKey: (k: SortKey) => void;
  onToggleSortDir: () => void;
}

export function Toolbar({
  query, setQuery,
  eligibility, setEligibility,
  tracksOnly, setTracksOnly,
  trackedCount,
  repoFilter, onClearRepoFilter,
  pageSize, onPageSize,
  totalItems, totalAll,
  sortKey, sortDir, onSortKey, onToggleSortDir,
}: ToolbarProps) {
  const pills = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {(['all', 'eligible', 'ineligible'] as EligibilityFilter[]).map((e) => (
        <Pill key={e} active={eligibility === e} onClick={() => setEligibility(e)}>
          {e === 'all' ? 'All'
            : e === 'eligible' ? (
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
        <Pill active={tracksOnly} onClick={() => setTracksOnly(!tracksOnly)}>★ Tracked</Pill>
      )}
      {repoFilter && (
        <Box
          as="button"
          onClick={onClearRepoFilter}
          title={`Clear repo filter: ${repoFilter}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            px: '8px',
            py: '3px',
            border: '1px solid',
            borderColor: 'accent.emphasis',
            borderRadius: 999,
            bg: 'accent.subtle',
            color: 'accent.fg',
            fontFamily: 'inherit',
            fontSize: 0,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            '&:hover': { bg: 'accent.muted' },
          }}
        >
          <Text as="span" sx={{ ...MONO, fontSize: '10px' }}>repo:</Text>
          <Text as="span">{repoFilter}</Text>
          <Text as="span" aria-hidden sx={{ ml: '2px' }}>✕</Text>
        </Box>
      )}
    </Box>
  );

  const resultText = totalItems === totalAll
    ? `${totalItems.toLocaleString()} miners`
    : `${totalItems.toLocaleString()} of ${totalAll.toLocaleString()}`;

  return (
    <Box sx={{ mt: 2, mb: 2 }}>
      {/* Desktop: single dense row — pills · sort · count · rows · search */}
      <Box
        sx={{
          display: ['none', null, 'flex'],
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {pills}
        <SortControl<SortKey>
          value={sortKey}
          dir={sortDir}
          onChange={onSortKey}
          onToggleDir={onToggleSortDir}
          options={SORT_OPTIONS}
        />
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap', ml: 'auto' }}>
          {resultText}
        </Text>
        <RowSizeSelector value={pageSize} onChange={onPageSize} />
        <Box sx={{ flex: '0 1 auto', width: 240, maxWidth: 320, display: 'flex' }}>
          <SearchBox value={query} onChange={setQuery} placeholder="Search miner, UID, hotkey…" size="sm" />
        </Box>
      </Box>
      {/* Mobile: pills wrap, then sort + rows; search below */}
      <Box sx={{ display: ['flex', null, 'none'], flexDirection: 'column', gap: 2 }}>
        {pills}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <SortControl<SortKey>
            value={sortKey}
            dir={sortDir}
            onChange={onSortKey}
            onToggleDir={onToggleSortDir}
            options={SORT_OPTIONS}
          />
          <RowSizeSelector value={pageSize} onChange={onPageSize} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <SearchBox value={query} onChange={setQuery} placeholder="Search miner, UID, hotkey…" size="sm" />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* =========================================================================
 * Hover peek popover — last 3 PRs for a miner, portal-rendered so it
 * escapes the table's overflow:hidden.
 * ========================================================================= */

interface PeekPr {
  pullRequestNumber: number;
  title?: string;
  repository?: string;
  prState?: string;
  mergedAt?: string | null;
  prCreatedAt?: string | null;
}

interface PeekProfile {
  prs?: PeekPr[];
}

interface PeekAnchor {
  top: number;
  right: number;
  bottom: number;
  width: number;
}

function HoverPeek({ uid, anchor }: { uid: number | string; anchor: PeekAnchor }) {
  const { data, isFetching } = useQuery<PeekProfile>({
    queryKey: ['miner-detail', String(uid)],
    queryFn: async () => {
      const r = await fetch(`/api/gt/miners/${uid}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 25_000,
    enabled: true,
  });

  const recent = useMemo(() => {
    const prs = data?.prs ?? [];
    return [...prs]
      .sort((a, b) => {
        const at = Date.parse(a.mergedAt ?? a.prCreatedAt ?? '0');
        const bt = Date.parse(b.mergedAt ?? b.prCreatedAt ?? '0');
        return bt - at;
      })
      .slice(0, 3);
  }, [data]);

  if (typeof document === 'undefined') return null;

  // Flip above the row if it would clip the bottom of the viewport.
  const popWidth = 360;
  const popHeightEstimate = 140;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0;
  const placeBelow = anchor.bottom + popHeightEstimate + 12 <= viewportH;
  const top = placeBelow ? anchor.bottom + 6 : Math.max(8, anchor.top - popHeightEstimate - 6);
  const left = Math.max(8, anchor.right - popWidth);

  return createPortal(
    <Box
      sx={{
        position: 'fixed',
        top, left,
        zIndex: 1000,
        width: popWidth,
        maxWidth: 'calc(100vw - 16px)',
        bg: 'canvas.overlay',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        boxShadow: 'shadow.large',
        p: 2,
        pointerEvents: 'none',
      }}
    >
      <Text sx={{ ...LABEL, display: 'block', mb: 1 }}>Recent PRs</Text>
      {(!data && isFetching) ? (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>Loading…</Text>
      ) : recent.length === 0 ? (
        <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>No PR data yet.</Text>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {recent.map((pr) => (
            <Box key={`${pr.repository}#${pr.pullRequestNumber}`} sx={{ minWidth: 0 }}>
              <Text
                sx={{
                  fontSize: 0,
                  fontWeight: 600,
                  color: 'fg.default',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
                title={pr.title ?? `#${pr.pullRequestNumber}`}
              >
                {pr.title ?? `#${pr.pullRequestNumber}`}
              </Text>
              <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }}>
                {pr.repository ?? '—'}
                {' · '}
                {pr.prState === 'MERGED' ? 'merged' : pr.prState === 'OPEN' ? 'open' : pr.prState === 'CLOSED' ? 'closed' : '—'}
                {pr.mergedAt || pr.prCreatedAt
                  ? ` · ${formatRelativeTime(pr.mergedAt ?? pr.prCreatedAt ?? '')}`
                  : ''}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>,
    document.body,
  );
}

interface LeaderRowProps {
  miner: Miner;
  rank: number;
  isMe: boolean;
  isTracked: boolean;
  onToggleTrack: () => void;
  isLast: boolean;
  onPrefetch?: () => void;
  repoFilter: string | null;
  onPickRepo: (repo: string) => void;
}

function LeaderRow({
  miner, rank,
  isMe, isTracked, onToggleTrack,
  isLast,
  onPrefetch,
  repoFilter, onPickRepo,
}: LeaderRowProps) {
  const ossView = viewOf(miner, 'oss');
  const discView = viewOf(miner, 'discovery');
  const ossScore = ossView.score;
  const discScore = discView.score;
  const combinedScore = ossScore + discScore;
  const combinedUsd = num(miner.usdPerDay);

  const mergedTotal = miner.totalMergedPrs ?? 0;
  const solvedTotal = miner.totalSolvedIssues ?? 0;
  const closedTotal = (miner.totalClosedPrs ?? 0) + (miner.totalClosedIssues ?? 0);
  const credDenom = mergedTotal + solvedTotal + closedTotal;
  const cred = credDenom > 0 ? (mergedTotal + solvedTotal) / credDenom : 0;
  const credPct = Math.max(0, Math.min(100, Math.round(cred * 100)));

  const lastActiveIso = (() => {
    const a = miner.lastOssActivityAt ?? null;
    const b = miner.lastDiscoveryActivityAt ?? null;
    if (a && b) return a > b ? a : b;
    return a ?? b ?? null;
  })();

  const status = useMemo(() => deriveMinerStatus(miner, rank), [miner, rank]);
  const daily35 = miner.daily35 ?? [];
  const topRepos = miner.topRepos ?? [];

  const rowRef = useRef<HTMLDivElement | null>(null);
  const [peekRect, setPeekRect] = useState<PeekAnchor | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const handleEnter = useCallback(() => {
    if (onPrefetch) onPrefetch();
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      const el = rowRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPeekRect({ top: r.top, right: r.right, bottom: r.bottom, width: r.width });
      }
    }, 350);
  }, [onPrefetch]);
  const handleLeave = useCallback(() => {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setPeekRect(null);
  }, []);
  useEffect(() => () => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
  }, []);

  return (
    <Box
      ref={rowRef}
      sx={{
        position: 'relative',
        bg: isMe ? 'canvas.inset' : 'transparent',
        borderBottom: isLast ? 'none' : '1px solid',
        borderBottomColor: 'border.muted',
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
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <Link
        href={`/miners/${miner.uid}`}
        prefetch={false}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['40px minmax(0, 1fr) auto 28px', null, COLS],
            gridTemplateAreas: [
              `"rank ident    usd  star"
               "rank activity activity activity"
               "rank meta     meta  meta"`,
              null,
              `"rank ident spark contrib cred score usd repos lastactive star"`,
            ],
            alignItems: 'center',
            columnGap: [2, null, 1],
            rowGap: ['5px', null, 0],
            px: [2, null, 3],
            py: ['10px', null, '10px'],
            cursor: 'pointer',
          }}
        >
          <Box
            sx={{
              gridArea: 'rank',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              lineHeight: 1,
            }}
          >
            <Text
              sx={{
                ...MONO,
                fontSize: rank <= 9 ? 1 : 0,
                color: rank <= 3 ? 'fg.default' : 'fg.muted',
                fontWeight: rank <= 3 ? 700 : 600,
                lineHeight: 1,
              }}
            >
              {rank}
            </Text>
            <MovementCell currentRank={rank} previousRank={miner.previousRank} />
          </Box>

          <Box sx={{ gridArea: 'ident', minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <MinerIdentity miner={miner} avatarSize={22} showUid={true} />
            {isTracked && (
              <Text sx={{ color: 'fg.muted', fontSize: 0, lineHeight: 1, flexShrink: 0 }} title="Tracked">★</Text>
            )}
            {status.kind !== 'none' && <StatusBadge status={status} />}
          </Box>

          <Box sx={{ gridArea: 'spark', display: ['none', null, 'flex'], alignItems: 'center', minWidth: 0 }}>
            <Sparkline values={daily35} width={108} height={22} />
          </Box>

          <Box sx={{ gridArea: 'repos', display: ['none', null, 'flex'], alignItems: 'center', flexWrap: 'wrap', gap: '4px', minWidth: 0, pl: 2 }}>
            {topRepos.length === 0 ? (
              <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }}>—</Text>
            ) : (
              topRepos.map((r) => (
                <RepoChip
                  key={r.name}
                  fullName={r.name}
                  count={r.count}
                  active={repoFilter === r.name}
                  onClick={onPickRepo}
                />
              ))
            )}
          </Box>

          <ContribCell
            merged={miner.totalValidMergedPrs ?? mergedTotal}
            solved={solvedTotal}
            ossScore={ossScore}
            ossEligible={!!miner.isEligible}
            discScore={discScore}
            discEligible={!!miner.isIssueEligible}
          />

          <Box sx={{ gridArea: 'activity', display: ['flex', null, 'none'], alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Box sx={{ flexShrink: 0 }}>
              <Sparkline values={daily35} width={60} height={18} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', minWidth: 0 }}>
              {topRepos.length === 0 ? (
                <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }}>—</Text>
              ) : (
                topRepos.map((r) => (
                  <RepoChip
                    key={r.name}
                    fullName={r.name}
                    count={r.count}
                    active={repoFilter === r.name}
                    onClick={onPickRepo}
                  />
                ))
              )}
            </Box>
          </Box>


          <Box
            sx={{
              gridArea: 'cred',
              display: ['none', null, 'flex'],
              justifyContent: 'flex-end',
              alignItems: 'center',
              px: '4px',
            }}
            title={cred > 0 ? `Credibility · ${credPct}%` : 'Credibility · —'}
          >
            <Text sx={{ ...MONO, fontSize: 1, fontWeight: 600, color: cred > 0 ? 'fg.default' : 'fg.subtle' }}>
              {cred > 0 ? `${credPct}%` : '—'}
            </Text>
          </Box>

          <Box sx={{ gridArea: 'score', display: ['none', null, 'block'], textAlign: 'right', minWidth: 0 }}>
            <Text sx={{ ...MONO, fontSize: 1, fontWeight: 600, color: 'fg.default' }}>
              {combinedScore.toFixed(1)}
            </Text>
          </Box>

          <Box sx={{ gridArea: 'lastactive', display: ['none', null, 'flex'], justifyContent: 'flex-end', alignItems: 'center', minWidth: 0 }}>
            <Text sx={{ ...MONO, fontSize: 0, color: lastActiveIso ? 'fg.muted' : 'fg.subtle' }}>
              {lastActiveIso ? formatRelativeTime(lastActiveIso) : '—'}
            </Text>
          </Box>

          <Box sx={{ gridArea: 'usd', textAlign: 'right', minWidth: 0 }}>
            <Text
              sx={{
                ...MONO,
                fontSize: 1,
                fontWeight: combinedUsd > 0 ? 700 : 400,
                color: combinedUsd > 0 ? 'success.fg' : 'fg.muted',
              }}
            >
              {combinedUsd > 0 ? formatUsd(combinedUsd, { style: 'compact' }) : '—'}
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
            <DualTrackBar
              ossScore={ossScore}
              ossEligible={!!miner.isEligible}
              discScore={discScore}
              discEligible={!!miner.isIssueEligible}
              height={5}
              width={80}
            />
            <Text
              sx={{ ...MONO, fontSize: '10px', color: ossScore > 0 ? (miner.isEligible ? 'accent.fg' : 'fg.muted') : 'fg.subtle', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px' }}
              title="OSS · Pull Requests"
            >
              <GitPullRequestIcon size={9} />
              {ossScore.toFixed(1)}
            </Text>
            <Text
              sx={{ ...MONO, fontSize: '10px', color: discScore > 0 ? (miner.isIssueEligible ? 'done.fg' : 'fg.muted') : 'fg.subtle', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px' }}
              title="Discovery · Issues"
            >
              <IssueOpenedIcon size={9} />
              {discScore.toFixed(1)}
            </Text>
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
              {cred > 0 ? `${credPct}%` : '—'}
            </Text>
            {lastActiveIso && (
              <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', ml: 'auto' }}>
                {formatRelativeTime(lastActiveIso)}
              </Text>
            )}
          </Box>

          <Box sx={{ gridArea: 'star', display: 'flex', justifyContent: 'center' }}>
            <TrackButton isTracked={isTracked} onClick={onToggleTrack} />
          </Box>
        </Box>
      </Link>

      {peekRect && <HoverPeek uid={miner.uid} anchor={peekRect} />}
    </Box>
  );
}

export interface LeaderTableProps {
  miners: Miner[];
  ranksByUid: Map<number, number>;
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
  repoFilter: string | null;
  onPickRepo: (repo: string | null) => void;
}

export function LeaderTable({
  miners,
  ranksByUid,
  sortKey, sortDir, onSort,
  me, tracked, onToggleTrack,
  loading,
  onPrefetch,
  page, pageSize, onPage, filteredCount,
  repoFilter, onPickRepo,
}: LeaderTableProps) {
  const handlePickRepo = useCallback((repo: string) => {
    onPickRepo(repoFilter === repo ? null : repo);
  }, [repoFilter, onPickRepo]);

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
        <SortHdr active={sortKey === 'movement'} dir={sortDir} onClick={() => onSort('movement')} align="center" title="Current rank · Change since yesterday">#</SortHdr>
        <ColHdr align="left" title="Miner identity — GitHub username and UID">Miner</ColHdr>
        <ColHdr align="left" title="Pull request activity over the last 35 days">Trend</ColHdr>
        <ColHdr align="left" title="Merged pull requests and solved issues with OSS and Discovery track scores">Contributions</ColHdr>
        <SortHdr active={sortKey === 'cred'} dir={sortDir} onClick={() => onSort('cred')} title="Success rate — merged PRs + solved issues as a percentage of all submitted work">Success %</SortHdr>
        <SortHdr active={sortKey === 'score'} dir={sortDir} onClick={() => onSort('score')} title="Combined OSS + Discovery score">Score</SortHdr>
        <SortHdr active={sortKey === 'usd'} dir={sortDir} onClick={() => onSort('usd')} title="Estimated daily earnings in USD" align="right">$/Day</SortHdr>
        <ColHdr align="left" title="Top repositories this miner contributes to" pl={2}>Top Repos</ColHdr>
        <SortHdr active={sortKey === 'active'} dir={sortDir} onClick={() => onSort('active')} title="Most recent OSS or Discovery activity">Last Active</SortHdr>
        <span />
      </Box>


      {loading ? (
        <Box sx={{ p: 2 }}>
          <TableRowsSkeleton
            rows={8}
            cols={[{ width: 36 }, { flex: 1 }, { width: 70 }, { width: 110 }, { width: 70 }, { width: 60 }]}
          />
        </Box>
      ) : miners.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>
          No miners match your filters.
        </Box>
      ) : (
        miners.map((m, i) => {
          const rank = ranksByUid.get(m.uid) ?? i + 1;
          return (
            <LeaderRow
              key={m.uid}
              miner={m}
              rank={rank}
              isMe={ghKey(m.githubUsername) === ghKey(me)}
              isTracked={tracked.has(String(m.uid))}
              onToggleTrack={() => onToggleTrack(String(m.uid))}
              isLast={i === miners.length - 1}
              onPrefetch={() => onPrefetch(m.uid)}
              repoFilter={repoFilter}
              onPickRepo={handlePickRepo}
            />
          );
        })
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
  pl,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  title?: string;
  pl?: number | string;
}) {
  return (
    <Text
      title={title}
      sx={{ ...LABEL, textAlign: align, whiteSpace: 'nowrap', pl }}
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
  align = 'right',
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  align?: 'left' | 'right' | 'center';
}) {
  const justify = align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end';
  return (
    <Box
      as="button"
      onClick={onClick}
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: justify,
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
        textAlign: align,
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
