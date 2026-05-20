'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import {
  SearchIcon,
  FilterIcon,
  TriangleDownIcon,
  TriangleUpIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { formatUsd } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import {
  Miner,
  MinerIdentity,
  TrackButton,
  credColor,
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

type EligibilityFilter = 'all' | 'eligible' | 'ineligible';
type TrackMode = 'oss' | 'discovery';
type SortKey = 'score' | 'primary' | 'open' | 'closed' | 'repos' | 'usd';
type SortDir = 'asc' | 'desc';

const TRACK_PAGE_SIZE = 20;

interface ActivityStats {
  pr: { merged: number; open: number; closed: number; mergeRate: number; totalDay: number; eligible: number };
  issue: { solved: number; open: number; closed: number; solveRate: number; totalDay: number; eligible: number };
}

interface CodeStats {
  added: number;
  deleted: number;
  repos: number;
  avgCred: number;
}

interface Pulse {
  total: number;
  totalUsd: number;
}

interface TopEarner {
  name: string;
  usd: number;
}

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [query, setQuery] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityFilter>('all');
  const [snapshotOpen, setSnapshotOpen] = useState(false);

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

  const pulse = useMemo<Pulse>(() => {
    if (!data?.miners) return { total: 0, totalUsd: 0 };
    let totalUsd = 0;
    for (const m of data.miners) totalUsd += num(m.usdPerDay);
    return { total: data.miners.length, totalUsd };
  }, [data]);

  // Highest-earning miner — used as the "Top Earner" KPI.
  const topEarner = useMemo<TopEarner | null>(() => {
    if (!data?.miners?.length) return null;
    let top: Miner | null = null;
    let maxUsd = 0;
    for (const m of data.miners) {
      const usd = num(m.usdPerDay);
      if (usd > maxUsd) {
        maxUsd = usd;
        top = m;
      }
    }
    return top ? { name: ghName(top), usd: maxUsd } : null;
  }, [data]);

  const activityStats = useMemo<ActivityStats>(() => {
    const empty: ActivityStats = {
      pr: { merged: 0, open: 0, closed: 0, mergeRate: 0, totalDay: 0, eligible: 0 },
      issue: { solved: 0, open: 0, closed: 0, solveRate: 0, totalDay: 0, eligible: 0 },
    };
    if (!data?.miners) return empty;
    let merged = 0, openPr = 0, closedPr = 0, prDay = 0, prElig = 0;
    let solved = 0, openIs = 0, closedIs = 0, isDay = 0, isElig = 0;
    for (const m of data.miners) {
      merged += m.totalMergedPrs ?? 0;
      openPr += m.totalOpenPrs ?? 0;
      closedPr += m.totalClosedPrs ?? 0;
      solved += m.totalSolvedIssues ?? 0;
      openIs += m.totalOpenIssues ?? 0;
      closedIs += m.totalClosedIssues ?? 0;
      if (m.isEligible) prElig += 1;
      if (m.isIssueEligible) isElig += 1;
      prDay += viewOf(m, 'oss').usd;
      isDay += viewOf(m, 'discovery').usd;
    }
    const totalPr = merged + closedPr;
    const totalIs = solved + closedIs;
    return {
      pr: {
        merged, open: openPr, closed: closedPr,
        mergeRate: totalPr ? Math.round((merged / totalPr) * 100) : 0,
        totalDay: prDay, eligible: prElig,
      },
      issue: {
        solved, open: openIs, closed: closedIs,
        solveRate: totalIs ? Math.round((solved / totalIs) * 100) : 0,
        totalDay: isDay, eligible: isElig,
      },
    };
  }, [data]);

  const codeStats = useMemo<CodeStats>(() => {
    if (!data?.miners) return { added: 0, deleted: 0, repos: 0, avgCred: 0 };
    let added = 0, deleted = 0, repos = 0, credSum = 0, credN = 0;
    for (const m of data.miners) {
      added += m.totalAdditions ?? 0;
      deleted += m.totalDeletions ?? 0;
      repos += m.uniqueReposCount ?? 0;
      const c = num(m.issueCredibility ?? m.credibility);
      if (c > 0) { credSum += c; credN += 1; }
    }
    return { added, deleted, repos, avgCred: credN ? credSum / credN : 0 };
  }, [data]);

  const loadingFirst = isLoading && !data;

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Miners</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          Live leaderboard for SN74. Miners earn $TAO for shipping code and surfacing quality issues.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ mt: 2 }}>
          <NetworkSnapshotStrip
            pulse={pulse}
            activity={activityStats}
            code={codeStats}
            topEarner={topEarner}
            open={snapshotOpen}
            onToggle={() => setSnapshotOpen((o) => !o)}
            loading={loadingFirst}
          />

          {isError && (
            <Box sx={{ p: 2, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
              <Text sx={{ color: 'danger.fg', fontSize: 1 }}>Failed to load miners.</Text>
            </Box>
          )}

          <SplitView
            miners={data?.miners ?? []}
            query={query}
            setQuery={setQuery}
            eligibility={eligibility}
            setEligibility={setEligibility}
            me={me}
            tracked={tracked}
            onToggleTrack={toggle}
            loading={loadingFirst}
          />
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

/* ─── NetworkSnapshotStrip ───
 * Collapsed: 4 KPI cells (Miners · OSS · Discovery · Cred) + Details toggle.
 * Expanded: 3-col panel (PR · Issue · Code).
 */
function NetworkSnapshotStrip({
  pulse,
  activity,
  code,
  topEarner,
  open,
  onToggle,
  loading,
}: {
  pulse: Pulse;
  activity: ActivityStats;
  code: CodeStats;
  topEarner: TopEarner | null;
  open: boolean;
  onToggle: () => void;
  loading: boolean;
}) {
  const fmt = (n: number) => (loading ? '—' : n.toLocaleString());
  const fmtPool = (n: number) => (loading ? '' : `$${Math.round(n).toLocaleString()}/day pool`);
  return (
    <Box sx={{ mb: 2 }}>
      {/*
        Small screens: 3 cards in row 1 (Network · OSS · Discovery),
        then Top Earner + Details share row 2.
        Large screens (lg+): everything in a single row.
      */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: [
            'repeat(3, minmax(0, 1fr))',
            null,
            null,
            'repeat(4, minmax(0, 1fr)) auto',
          ],
        }}
      >
        <KpiCell label="Network" value={fmt(pulse.total)} sub="total miners" />
        <KpiCell
          label="OSS Earners"
          value={loading ? '—' : activity.pr.eligible.toLocaleString()}
          sub={fmtPool(activity.pr.totalDay)}
          accent="var(--success-fg)"
        />
        <KpiCell
          label="Discovery Earners"
          value={loading ? '—' : activity.issue.eligible.toLocaleString()}
          sub={fmtPool(activity.issue.totalDay)}
          accent="var(--done-emphasis)"
        />
        <KpiCell
          label="Top Earner"
          value={loading || !topEarner ? '—' : formatUsd(topEarner.usd, { style: 'compact' })}
          sub={loading || !topEarner ? '' : `@${topEarner.name} · per day`}
          accent="var(--attention-emphasis)"
          // Span 2 cols on small screens to fill row 2 next to Details.
          gridColumn={['span 2', null, null, 'auto']}
        />
        <Box
          as="button"
          onClick={onToggle}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            px: 3,
            py: 2,
            border: '1px solid',
            borderColor: open ? 'border.strong' : 'border.default',
            borderRadius: 2,
            bg: open ? 'var(--bg-emphasis)' : 'canvas.subtle',
            color: open ? 'fg.default' : 'fg.muted',
            fontSize: '11px',
            fontFamily: 'inherit',
            fontWeight: 600,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            cursor: 'pointer',
            minWidth: 0,
            transition: 'background-color 120ms, color 120ms, border-color 120ms',
            '&:focus': { outline: 'none' },
            '&:focus-visible': { outline: '1px solid var(--accent-fg)', outlineOffset: '2px' },
            '&:hover': { color: 'fg.default', borderColor: 'border.strong' },
          }}
        >
          {open ? 'Hide' : 'Details'}
          <Text
            aria-hidden
            sx={{
              fontSize: '10px',
              display: 'inline-block',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 200ms',
            }}
          >
            ▼
          </Text>
        </Box>
      </Box>

      {open && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['1fr', null, '1fr 1fr 1fr'],
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            overflow: 'hidden',
            mt: 2,
          }}
        >
          <SnapshotCol
            title="Pull Requests"
            titleColor="var(--success-fg)"
            rows={[
              { label: 'Merged', value: activity.pr.merged, color: 'var(--success-fg)' },
              { label: 'Open', value: activity.pr.open },
              { label: 'Closed', value: activity.pr.closed, color: 'var(--danger-fg)' },
            ]}
            bar={{ label: 'Merge rate', pct: activity.pr.mergeRate, color: activity.pr.mergeRate >= 75 ? 'var(--success-fg)' : 'var(--attention-emphasis)' }}
            footer={`$${activity.pr.totalDay.toLocaleString(undefined, { maximumFractionDigits: 0 })}/day pool`}
            footerColor="var(--success-fg)"
            borderSide="right"
          />
          <SnapshotCol
            title="Issue Discovery"
            titleColor="var(--done-emphasis)"
            rows={[
              { label: 'Solved', value: activity.issue.solved, color: 'var(--done-emphasis)' },
              { label: 'Open', value: activity.issue.open },
              { label: 'Closed', value: activity.issue.closed, color: 'var(--danger-fg)' },
            ]}
            bar={{ label: 'Solve rate', pct: activity.issue.solveRate, color: activity.issue.solveRate >= 75 ? 'var(--success-fg)' : 'var(--attention-emphasis)' }}
            footer={`$${activity.issue.totalDay.toLocaleString(undefined, { maximumFractionDigits: 0 })}/day pool`}
            footerColor="var(--done-emphasis)"
            borderSide="right"
          />
          <SnapshotCol
            title="Code Impact"
            titleColor="fg.muted"
            rows={[
              { label: 'Lines added', value: `+${code.added.toLocaleString()}`, color: 'var(--success-fg)' },
              { label: 'Lines deleted', value: `−${code.deleted.toLocaleString()}`, color: 'var(--danger-fg)' },
              { label: 'Repos touched', value: code.repos },
            ]}
            bar={{ label: 'Avg credibility', pct: Math.round(code.avgCred * 100), color: credColor(code.avgCred) }}
          />
        </Box>
      )}
    </Box>
  );
}

function SnapshotCol({
  title,
  titleColor,
  rows,
  bar,
  footer,
  footerColor,
  borderSide,
}: {
  title: string;
  titleColor: string;
  rows: { label: string; value: number | string; color?: string }[];
  bar?: { label: string; pct: number; color: string };
  footer?: string;
  footerColor?: string;
  borderSide?: 'right';
}) {
  return (
    <Box
      sx={{
        p: 2,
        bg: 'canvas.subtle',
        borderRight: borderSide === 'right' ? ['none', null, '1px solid'] : 'none',
        borderRightColor: ['transparent', null, 'border.muted'],
        borderBottom: ['1px solid', null, 'none'],
        borderBottomColor: ['border.muted', null, 'transparent'],
      }}
    >
      <Text sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: titleColor, display: 'block', mb: '6px' }}>
        {title}
      </Text>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 2, rowGap: '4px', mb: '8px' }}>
        {rows.map((r) => (
          <React.Fragment key={r.label}>
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{r.label}</Text>
            <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 1, fontWeight: 700, textAlign: 'right' }} style={{ color: r.color ?? 'var(--fg-default)' }}>
              {typeof r.value === 'number' ? r.value.toLocaleString() : r.value}
            </Text>
          </React.Fragment>
        ))}
      </Box>
      {bar && <Bar label={bar.label} pct={bar.pct} color={bar.color} />}
      {footer && (
        <Text sx={{ display: 'block', mt: '8px', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 0, fontWeight: 700, color: footerColor }}>
          {footer}
        </Text>
      )}
    </Box>
  );
}

/* ─── SplitView ─── */
function SplitView({
  miners,
  query,
  setQuery,
  eligibility,
  setEligibility,
  me,
  tracked,
  onToggleTrack,
  loading,
}: {
  miners: Miner[];
  query: string;
  setQuery: (s: string) => void;
  eligibility: EligibilityFilter;
  setEligibility: (e: EligibilityFilter) => void;
  me: string;
  tracked: Set<string>;
  onToggleTrack: (id: string) => void;
  loading: boolean;
}) {
  const q = query.trim().toLowerCase();

  const ossFiltered = useMemo(() => {
    return miners.filter((m) => {
      if (q && !`${ghName(m)} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      if (eligibility === 'eligible' && !m.isEligible) return false;
      if (eligibility === 'ineligible' && m.isEligible) return false;
      return true;
    });
  }, [miners, q, eligibility]);

  const discFiltered = useMemo(() => {
    return miners.filter((m) => {
      if (q && !`${ghName(m)} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      if (eligibility === 'eligible' && !m.isIssueEligible) return false;
      if (eligibility === 'ineligible' && m.isIssueEligible) return false;
      return true;
    });
  }, [miners, q, eligibility]);

  return (
    <Box>
      {/* Shared toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          mb: 2,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            px: 2,
            py: '5px',
            border: '1px solid',
            borderColor: 'border.muted',
            borderRadius: 1,
            bg: 'var(--bg-canvas)',
            color: 'fg.muted',
            // Capped width so the search box doesn't dominate the toolbar;
            // eligibility chips sit right next to it.
            flex: '1 1 200px',
            maxWidth: 360,
            minWidth: 200,
            '&:focus-within': { borderColor: 'var(--border-strong)', color: 'fg.default' },
          }}
        >
          <SearchIcon size={14} />
          <Box
            as="input"
            type="text"
            placeholder="Search by username, UID, or hotkey…"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            sx={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              bg: 'transparent',
              color: 'fg.default',
              fontFamily: 'inherit',
              fontSize: 1,
              '&::placeholder': { color: 'var(--fg-subtle)' },
            }}
          />
          {query && (
            <Box
              as="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              sx={{ border: 'none', bg: 'transparent', color: 'fg.subtle', fontSize: 0, cursor: 'pointer', px: 1, '&:hover': { color: 'fg.default' } }}
            >
              ×
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', color: 'fg.subtle', pr: '4px' }}>
            <FilterIcon size={12} />
          </Box>
          {(['all', 'eligible', 'ineligible'] as EligibilityFilter[]).map((e) => (
            <ChipButton key={e} active={eligibility === e} onClick={() => setEligibility(e)} capitalize>
              {e}
            </ChipButton>
          ))}
        </Box>
      </Box>

      <Box
        sx={{
          display: ['flex', null, null, 'grid'],
          flexDirection: 'column',
          gridTemplateColumns: '1fr 1fr',
          gap: 2,
        }}
      >
        <TrackColumn
          title="OSS Contributions"
          subtitle="PR & code track"
          mode="oss"
          miners={ossFiltered}
          me={me}
          tracked={tracked}
          onToggleTrack={onToggleTrack}
          loading={loading}
        />
        <TrackColumn
          title="Issue Discovery"
          subtitle="Bug & quality track"
          mode="discovery"
          miners={discFiltered}
          me={me}
          tracked={tracked}
          onToggleTrack={onToggleTrack}
          loading={loading}
        />
      </Box>
    </Box>
  );
}

/* ─── TrackColumn ───
 * One column of the split view. Owns its own sort + pagination state.
 */
function TrackColumn({
  title,
  subtitle,
  mode,
  miners,
  me,
  tracked,
  onToggleTrack,
  loading,
}: {
  title: string;
  subtitle: string;
  mode: TrackMode;
  miners: Miner[];
  me: string;
  tracked: Set<string>;
  onToggleTrack: (id: string) => void;
  loading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [miners, sortKey, sortDir]);

  const primaryLabel = mode === 'oss' ? 'Merged' : 'Solved';
  const reposLabel = 'Repos';

  const sorted = useMemo(() => {
    const valueOf = (m: Miner): number => {
      const v = viewOf(m, mode);
      switch (sortKey) {
        case 'score': return v.score;
        case 'primary': return v.counts.primary;
        case 'open': return v.counts.open;
        case 'closed': return v.counts.closed;
        case 'repos': return mode === 'oss' ? (m.eligibleRepoCount ?? 0) : (m.issueEligibleRepoCount ?? 0);
        case 'usd': return v.usd;
      }
    };
    const eligibleOf = (m: Miner) => (mode === 'oss' ? !!m.isEligible : !!m.isIssueEligible);
    return [...miners].sort((a, b) => {
      const aE = eligibleOf(a), bE = eligibleOf(b);
      if (aE !== bE) return aE ? -1 : 1;
      const cmp = valueOf(a) - valueOf(b);
      const eff = cmp === 0 ? viewOf(a, mode).score - viewOf(b, mode).score : cmp;
      return sortDir === 'desc' ? -eff : eff;
    });
  }, [miners, mode, sortKey, sortDir]);

  const ranks = useMemo(() => {
    const map = new Map<number, number>();
    sorted.forEach((m, i) => map.set(m.uid, i + 1));
    return map;
  }, [sorted]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / TRACK_PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * TRACK_PAGE_SIZE;
    return sorted.slice(start, start + TRACK_PAGE_SIZE);
  }, [sorted, page]);

  const onSortClick = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  // All data columns flex with screen width. Identity gets 2.4fr so the
  // username has breathing room; $/day gets 1.2fr (wider numbers).
  // `minmax(..., fr)` keeps headers readable at narrow breakpoints.
  const COLS =
    '22px minmax(160px, 2.4fr) minmax(58px, 1fr) minmax(56px, 1fr) minmax(42px, 1fr) minmax(58px, 1fr) minmax(54px, 1fr) minmax(76px, 1.2fr) 22px';
  const trackAccent = mode === 'oss' ? 'var(--success-fg)' : 'var(--done-emphasis)';
  const trackTint = mode === 'oss' ? 'var(--success-subtle)' : 'var(--done-subtle)';

  return (
    <Box
      sx={{
        position: 'relative',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        overflow: 'hidden',
        bg: 'canvas.default',
      }}
    >
      {/* Track-colour top stripe */}
      <Box
        aria-hidden
        sx={{ position: 'absolute', left: 0, right: 0, top: 0, height: '2px', zIndex: 1 }}
        style={{ backgroundColor: trackAccent }}
      />
      {/* Header: tinted bg + track-coloured title */}
      <Box
        sx={{
          px: 2,
          py: '8px',
          borderBottom: '1px solid',
          borderColor: 'border.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
        style={{ backgroundColor: trackTint }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Text
            sx={{ fontSize: 1, fontWeight: 600, letterSpacing: '-0.005em' }}
            style={{ color: trackAccent }}
          >
            {title}
          </Text>
          <Text sx={{ display: 'block', fontSize: '11px', color: 'fg.muted' }}>{subtitle}</Text>
        </Box>
        <CompactPagination
          page={page}
          totalPages={totalPages}
          totalItems={sorted.length}
          pageSize={TRACK_PAGE_SIZE}
          onChange={setPage}
        />
      </Box>

      {/* Sortable header row — desktop only */}
      <Box
        sx={{
          display: ['none', null, null, 'grid'],
          gridTemplateColumns: COLS,
          alignItems: 'center',
          columnGap: 1,
          px: 2,
          py: '6px',
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          bg: 'canvas.subtle',
        }}
      >
        <HeaderLabel>#</HeaderLabel>
        <HeaderLabel>Miner</HeaderLabel>
        <SortHeader active={sortKey === 'score'} dir={sortDir} onClick={() => onSortClick('score')}>Score</SortHeader>
        <SortHeader active={sortKey === 'primary'} dir={sortDir} onClick={() => onSortClick('primary')}>{primaryLabel}</SortHeader>
        <SortHeader active={sortKey === 'open'} dir={sortDir} onClick={() => onSortClick('open')}>Open</SortHeader>
        <SortHeader active={sortKey === 'closed'} dir={sortDir} onClick={() => onSortClick('closed')}>Closed</SortHeader>
        <SortHeader active={sortKey === 'repos'} dir={sortDir} onClick={() => onSortClick('repos')}>{reposLabel}</SortHeader>
        <SortHeader active={sortKey === 'usd'} dir={sortDir} onClick={() => onSortClick('usd')}>$/Day</SortHeader>
        <span />
      </Box>

      {/* Mobile-only sort chips */}
      <Box
        sx={{
          display: ['flex', null, null, 'none'],
          alignItems: 'center',
          gap: '4px',
          px: 2,
          py: '6px',
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', flexShrink: 0, pr: 1 }}>
          Sort
        </Text>
        {(['score', 'primary', 'open', 'closed', 'repos', 'usd'] as SortKey[]).map((k) => (
          <ChipButton key={k} active={sortKey === k} onClick={() => onSortClick(k)}>
            {k === 'primary' ? primaryLabel : k === 'repos' ? reposLabel : k === 'usd' ? '$/Day' : k[0].toUpperCase() + k.slice(1)}
            {sortKey === k && (sortDir === 'desc' ? <TriangleDownIcon size={10} /> : <TriangleUpIcon size={10} />)}
          </ChipButton>
        ))}
      </Box>

      {loading ? (
        <Box sx={{ p: 2 }}>
          <TableRowsSkeleton
            rows={8}
            cols={[{ width: 24 }, { flex: 1 }, { width: 40 }, { width: 40 }, { width: 40 }, { width: 40 }, { width: 50 }, { width: 56 }]}
          />
        </Box>
      ) : paginated.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>No miners match your filters.</Box>
      ) : (
        <>
          {paginated.map((m, i) => {
            const rank = ranks.get(m.uid) ?? i + 1;
            const repoCount = mode === 'oss' ? (m.eligibleRepoCount ?? 0) : (m.issueEligibleRepoCount ?? 0);
            return (
              <TrackRow
                key={m.uid}
                miner={m}
                mode={mode}
                rank={rank}
                repoCount={repoCount}
                cols={COLS}
                isMe={ghKey(m.githubUsername) === ghKey(me)}
                isTracked={tracked.has(String(m.uid))}
                onToggleTrack={() => onToggleTrack(String(m.uid))}
                isLast={i === paginated.length - 1}
              />
            );
          })}
        </>
      )}
    </Box>
  );
}

function HeaderLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      sx={{
        fontSize: '11px',
        color: 'fg.muted',
        fontWeight: 600,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Text>
  );
}

function SortHeader({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '3px',
        border: 'none',
        bg: 'transparent',
        color: active ? 'fg.default' : 'fg.muted',
        fontFamily: 'inherit',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        textAlign: 'right',
        p: 0,
        transition: 'color 100ms',
        '&:hover': { color: 'fg.default' },
        // Drop persistent mouse-click focus ring; keep only keyboard focus.
        '&:focus': { outline: 'none' },
        '&:focus-visible': {
          outline: '1px solid var(--accent-fg)',
          outlineOffset: '2px',
          borderRadius: '2px',
        },
      }}
    >
      {children}
      {active && (dir === 'desc' ? <TriangleDownIcon size={10} /> : <TriangleUpIcon size={10} />)}
    </Box>
  );
}

/* ─── TrackRow — uniform layout, mode-tinted metric colours ─── */
function TrackRow({
  miner,
  mode,
  rank,
  repoCount,
  cols,
  isMe,
  isTracked,
  onToggleTrack,
  isLast,
}: {
  miner: Miner;
  mode: TrackMode;
  rank: number;
  repoCount: number;
  cols: string;
  isMe: boolean;
  isTracked: boolean;
  onToggleTrack: () => void;
  isLast: boolean;
}) {
  const view = viewOf(miner, mode);
  const dim = !view.eligible;
  const accent = mode === 'oss' ? 'var(--success-fg)' : 'var(--done-emphasis)';

  return (
    <Link href={`/miners/${miner.uid}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Box
        sx={{
          position: 'relative',
          display: 'grid',
          // Mobile row 1: rank | identity | score | $/day | star.
          // Mobile row 2: counts with full labels (Merged / Open / Closed / Repos).
          gridTemplateColumns: ['22px minmax(0, 1fr) auto auto 22px', null, null, cols],
          gridTemplateAreas: [
            `"rank identity score usd star"
             ".    counts   counts counts counts"`,
            null,
            null,
            `"rank identity score primary open closed repos usd star"`,
          ],
          alignItems: 'center',
          columnGap: [2, null, null, 1],
          rowGap: ['4px', null, null, 0],
          px: 2,
          py: ['8px', null, null, '4px'],
          opacity: dim ? 0.45 : 1,
          bg: isMe ? 'var(--accent-subtle)' : 'transparent',
          boxShadow: isLast ? 'none' : 'inset 0 -1px 0 var(--border-muted)',
          cursor: 'pointer',
          // Skip hover bg on touch — it sticks while scrolling.
          '@media (hover: hover)': {
            transition: 'background-color 100ms',
            '&:hover': { bg: isMe ? 'var(--accent-subtle)' : 'canvas.subtle' },
          },
        }}
      >
        <Box sx={{ gridArea: 'rank', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text
            sx={{
              fontFamily: 'mono',
              fontVariantNumeric: 'tabular-nums',
              fontSize: [0, null, null, 1],
              fontWeight: 500,
              lineHeight: 1,
              color: 'fg.muted',
            }}
          >
            {rank}
          </Text>
        </Box>

        <Box sx={{ gridArea: 'identity', minWidth: 0 }}>
          <MinerIdentity miner={miner} isMe={isMe} isTop={false} tier={null} avatarSize={18} showUid={false} />
        </Box>

        {/* Score — visible at both breakpoints (mobile in row 1, desktop in col 3). */}
        <Box sx={{ gridArea: 'score', textAlign: 'right', minWidth: 0 }}>
          <Text sx={NUM_SX} style={{ color: 'var(--fg-default)' }}>
            {view.score.toFixed(2)}
          </Text>
        </Box>

        {/* $/day — visible at both breakpoints. */}
        <Box sx={{ gridArea: 'usd', textAlign: 'right', minWidth: 0 }}>
          <Text sx={NUM_SX} style={{ color: view.usd > 0 ? 'var(--accent-fg)' : 'var(--fg-muted)' }}>
            {formatUsd(view.usd, { style: 'compact' })}
          </Text>
        </Box>

        {/* Desktop-only cells. */}
        <Cell area="primary" align="right" mode="desktop">
          <CountCell value={view.counts.primary} accent={accent} />
        </Cell>
        <Cell area="open" align="right" mode="desktop">
          <CountCell value={view.counts.open} />
        </Cell>
        <Cell area="closed" align="right" mode="desktop">
          <CountCell value={view.counts.closed} accent="var(--danger-fg)" />
        </Cell>
        <Cell area="repos" align="right" mode="desktop">
          <ReposCell value={repoCount} eligible={view.eligible} accent={accent} />
        </Cell>

        {/* Mobile-only row 2: counts with full labels. */}
        <Box
          sx={{
            gridArea: 'counts',
            display: ['flex', null, null, 'none'],
            alignItems: 'baseline',
            flexWrap: 'wrap',
            columnGap: '8px',
            rowGap: '2px',
            fontSize: '11px',
          }}
        >
          <CountPair value={view.counts.primary} label={mode === 'oss' ? 'Merged' : 'Solved'} accent={accent} />
          <MobileSep />
          <CountPair value={view.counts.open} label="Open" />
          <MobileSep />
          <CountPair value={view.counts.closed} label="Closed" accent="var(--danger-fg)" />
          <MobileSep />
          <CountPair value={repoCount} label="Repos" accent={accent} badge={view.eligible ? '⚡' : undefined} />
        </Box>

        <Box sx={{ gridArea: 'star', display: 'flex', justifyContent: 'center' }}>
          <TrackButton isTracked={isTracked} onClick={onToggleTrack} />
        </Box>
      </Box>
    </Link>
  );
}

function MobileSep() {
  return <Text aria-hidden sx={{ color: 'fg.subtle', fontSize: 0, mx: '1px' }}>·</Text>;
}

function CountPair({ value, label, accent, badge }: { value: number; label: string; accent?: string; badge?: string }) {
  const zero = value === 0;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '2px', whiteSpace: 'nowrap' }}>
      {badge && <Text sx={{ fontSize: '10px', lineHeight: 1, mr: '2px' }}>{badge}</Text>}
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 1,
          fontWeight: zero ? 400 : 600,
        }}
        style={{ color: zero ? 'var(--fg-muted)' : (accent ?? 'var(--fg-default)') }}
      >
        {value.toLocaleString()}
      </Text>
      <Text sx={{ fontSize: '10px', color: 'fg.muted', fontWeight: 500 }}>{label}</Text>
    </Box>
  );
}

const NUM_SX = {
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 1,
  fontWeight: 500,
} as const;

function Cell({
  area,
  align,
  mode,
  children,
}: {
  area: string;
  align: 'left' | 'right';
  mode: 'desktop';
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        gridArea: ['auto', null, null, area],
        display: ['none', null, null, 'block'],
        textAlign: align,
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );
}

function CountCell({ value, accent }: { value: number; accent?: string }) {
  return (
    <Text
      sx={{
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 1,
        fontWeight: value > 0 ? 500 : 400,
      }}
      style={{ color: value > 0 ? (accent ?? 'var(--fg-default)') : 'var(--fg-muted)' }}
    >
      {value.toLocaleString()}
    </Text>
  );
}

// Repo count with an inline ⚡ badge when the miner is track-eligible.
function ReposCell({ value, eligible, accent }: { value: number; eligible: boolean; accent?: string }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: '4px' }}>
      {eligible && (
        <Text aria-label="Eligible" title="Eligible for rewards" sx={{ fontSize: '11px', lineHeight: 1 }}>
          ⚡
        </Text>
      )}
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 1,
          fontWeight: value > 0 ? 500 : 400,
        }}
        style={{ color: value > 0 ? (accent ?? 'var(--fg-default)') : 'var(--fg-muted)' }}
      >
        {value.toLocaleString()}
      </Text>
    </Box>
  );
}

/* ─── Shared primitives ─── */

function ChipButton({
  active,
  onClick,
  capitalize,
  children,
}: {
  active: boolean;
  onClick: () => void;
  capitalize?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '8px',
        py: '3px',
        flexShrink: 0,
        border: 'none',
        borderRadius: 1,
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        fontSize: 0,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textTransform: capitalize ? 'capitalize' : 'none',
        transition: 'background-color 100ms, color 100ms',
        whiteSpace: 'nowrap',
        '&:focus': { outline: 'none' },
        '&:focus-visible': {
          outline: '1px solid var(--accent-fg)',
          outlineOffset: '1px',
        },
        '&:hover': {
          color: 'var(--fg-default)',
          bg: active ? 'var(--bg-emphasis)' : 'var(--neutral-subtle)',
        },
      }}
    >
      {children}
    </Box>
  );
}

/* Compact inline pagination — renders nothing when only 1 page. */
function CompactPagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '11px',
          color: 'fg.muted',
          whiteSpace: 'nowrap',
          display: ['none', null, 'inline'],
        }}
      >
        {start}–{end} <Text as="span" sx={{ color: 'fg.subtle' }}>of</Text> {totalItems}
      </Text>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <PageNavBtn disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</PageNavBtn>
        <Text
          sx={{
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '11px',
            color: 'fg.muted',
            minWidth: 36,
            textAlign: 'center',
          }}
        >
          <Text as="span" sx={{ color: 'fg.default', fontWeight: 600 }}>{page}</Text>
          {' / '}
          {totalPages}
        </Text>
        <PageNavBtn disabled={page >= totalPages} onClick={() => onChange(page + 1)}>›</PageNavBtn>
      </Box>
    </Box>
  );
}

function PageNavBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 1,
        bg: 'var(--bg-canvas)',
        color: disabled ? 'var(--fg-muted)' : 'var(--fg-default)',
        fontSize: '12px',
        lineHeight: 1,
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--accent-fg)', outlineOffset: '1px' },
        '&:hover': disabled ? undefined : { bg: 'var(--neutral-subtle)', borderColor: 'border.strong' },
      }}
    >
      {children}
    </Box>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '3px', fontSize: 0 }}>
        <Text sx={{ color: 'fg.default' }}>{label}</Text>
        <Text sx={{ fontFamily: 'mono', fontWeight: 700 }} style={{ color }}>{pct}%</Text>
      </Box>
      <Box sx={{ width: '100%', height: 4, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
        <Box sx={{ height: '100%' }} style={{ width: `${pct}%`, backgroundColor: color }} />
      </Box>
    </Box>
  );
}

function KpiCell({
  label,
  value,
  sub,
  accent,
  gridColumn,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  gridColumn?: string | (string | null)[];
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        minWidth: 0,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        pl: accent ? '14px' : 3,
        pr: 3,
        py: 2,
        overflow: 'hidden',
        gridColumn,
      }}
    >
      {/* Left edge accent bar — subtle track marker (cool touch). */}
      {accent && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
          }}
          style={{ backgroundColor: accent }}
        />
      )}
      <Text
        sx={{
          display: 'block',
          fontSize: 0,
          color: 'fg.muted',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </Text>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', mt: '2px', minWidth: 0 }}>
        <Text
          sx={{
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            fontSize: 3,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}
          style={{ color: accent ?? 'var(--fg-default)' }}
        >
          {value}
        </Text>
        {sub && (
          <Text
            sx={{
              fontFamily: 'mono',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 0,
              color: 'fg.muted',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {sub}
          </Text>
        )}
      </Box>
    </Box>
  );
}
