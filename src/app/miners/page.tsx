'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import {
  SearchIcon,
  TriangleDownIcon,
  TriangleUpIcon,
  SortDescIcon,
  FilterIcon,
  RowsIcon,
  AppsIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import {
  CompactMetric,
  MetricCell,
  Miner,
  MinerIdentity,
  MinerView,
  Mode,
  RankBadge,
  ScoreBar,
  TrackButton,
  UsdValue,
  credColor,
  ghKey,
  ghName,
  num,
  percentOrZero,
  tierForRank,
  viewOf,
} from './parts';

interface MinersResp {
  count: number;
  fetched_at: number;
  source?: string;
  miners: Miner[];
}

type SortKey = 'score' | 'earnings' | 'activity' | 'credibility';
type EligibilityFilter = 'all' | 'eligible' | 'ineligible';

const SORT_KEYS: SortKey[] = ['score', 'earnings', 'activity', 'credibility'];

const PAGE_SIZE = 25;

// `activity` label is mode-dependent (PRs / Issues / combined).
function sortLabel(key: SortKey, mode: Mode): string {
  if (key === 'score') return 'Score';
  if (key === 'earnings') return 'Earnings';
  if (key === 'credibility') return 'Credibility';
  // activity
  if (mode === 'oss') return 'PRs';
  if (mode === 'discovery') return 'Issues';
  return 'Activity';
}

// Segmented-control entries. `sub` feeds the tooltip only.
const MODES: { key: Mode; label: string; sub: string }[] = [
  { key: 'total', label: 'Total', sub: 'Combined network score' },
  { key: 'oss', label: 'OSS', sub: 'PR & code contributions' },
  { key: 'discovery', label: 'Discovery', sub: 'Issue discoveries' },
];

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [eligibility, setEligibility] = useState<EligibilityFilter>('all');
  const [mode, setMode] = useState<Mode>('total');
  // Desktop-only — mobile always renders the table.
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  const onSortChange = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

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

  // Cache per-mode views once; downstream memos read by id.
  const views = useMemo(() => {
    const map = new Map<string, MinerView>();
    if (!data?.miners) return map;
    for (const m of data.miners) map.set(m.id, viewOf(m, mode));
    return map;
  }, [data, mode]);
  const v = (m: Miner): MinerView => views.get(m.id) ?? viewOf(m, mode);

  // Highest mode-score among eligible miners; denominator for every
  // row's relative score bar. Independent of the active sort.
  const leaderScore = useMemo(() => {
    if (!data?.miners) return 0;
    let max = 0;
    for (const m of data.miners) {
      const vw = v(m);
      if (vw.eligible && vw.score > max) max = vw.score;
    }
    return max;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, views]);

  // Sort the *full* list first so ranks survive filtering — searching
  // shouldn't shuffle a miner to rank 1.
  const sortedAll = useMemo(() => {
    if (!data?.miners) return [] as Miner[];
    return [...data.miners].sort((a, b) => {
      // Mode-eligible miners always come first within the same sort.
      const aE = v(a).eligible;
      const bE = v(b).eligible;
      if (aE !== bE) return aE ? -1 : 1;
      let cmp = 0;
      if (sortKey === 'score') cmp = v(a).score - v(b).score;
      else if (sortKey === 'earnings') cmp = v(a).usd - v(b).usd;
      else if (sortKey === 'activity') cmp = v(a).counts.primary - v(b).counts.primary;
      else if (sortKey === 'credibility') cmp = v(a).cred - v(b).cred;
      if (cmp === 0) cmp = v(a).score - v(b).score;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sortKey, sortDir, views]);

  // miner.id → global rank in the current sort. Stable under filters.
  const ranks = useMemo(() => {
    const m = new Map<string, number>();
    sortedAll.forEach((miner, i) => m.set(miner.id, i + 1));
    return m;
  }, [sortedAll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedAll.filter((m) => {
      if (q && !`${ghName(m)} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      const elig = v(m).eligible;
      if (eligibility === 'eligible' && !elig) return false;
      if (eligibility === 'ineligible' && elig) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedAll, query, eligibility, views]);

  // Pagination. Page resets when filters / sort change.
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [query, eligibility, mode, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Scope-aware code stats — reshape with the user's eligibility /
  // search filters because they're about "what's in my current view".
  const stats = useMemo(() => {
    const empty = { code: { added: 0, deleted: 0, repos: 0, avgCred: 0 } };
    if (!data?.miners) return empty;
    const scope = filtered;

    let added = 0, deleted = 0, repos = 0, credSum = 0, credN = 0;
    for (const m of scope) {
      added += m.totalAdditions ?? 0;
      deleted += m.totalDeletions ?? 0;
      repos += m.uniqueReposCount ?? 0;
      const c = num(m.issueCredibility ?? m.credibility);
      if (c > 0) { credSum += c; credN += 1; }
    }

    return {
      code: { added, deleted, repos, avgCred: credN ? credSum / credN : 0 },
    };
  }, [data, filtered]);

  // Activity card stats — network-wide (not filtered) and using the same
  // viewOf split as the KPI strip. This is the fix that makes the KPI
  // `$X /day` exactly equal the Activity sidebar's `$/day pool` for the
  // matching track:
  //
  //   OSS mode KPI $/day        ==  Activity PR    $/day pool
  //   Discovery mode KPI $/day  ==  Activity Issue $/day pool
  //   Total mode KPI $/day      ==  Activity PR + Issue (sums cleanly,
  //                                  no double-counting of miners
  //                                  eligible in both tracks)
  const activityStats = useMemo(() => {
    const empty = {
      counts: { eligible: 0 },
      issueCounts: { eligible: 0 },
      pr: { merged: 0, open: 0, closed: 0, mergeRate: 0, totalDay: 0 },
      issue: { solved: 0, open: 0, closed: 0, solveRate: 0, totalDay: 0 },
    };
    if (!data?.miners) return empty;

    let merged = 0, openPr = 0, closedPr = 0, prDay = 0;
    let solved = 0, openIs = 0, closedIs = 0, isDay = 0;
    let prElig = 0, isElig = 0;
    for (const m of data.miners) {
      merged += m.totalMergedPrs ?? 0;
      openPr += m.totalOpenPrs ?? 0;
      closedPr += m.totalClosedPrs ?? 0;
      solved += m.totalSolvedIssues ?? 0;
      openIs += m.totalOpenIssues ?? 0;
      closedIs += m.totalClosedIssues ?? 0;
      if (m.isEligible) prElig += 1;
      if (m.isIssueEligible) isElig += 1;
      // Proportional split, same formula as the KPI strip.
      prDay += viewOf(m, 'oss').usd;
      isDay += viewOf(m, 'discovery').usd;
    }
    const totalPr = merged + closedPr;
    const totalIs = solved + closedIs;
    return {
      counts: { eligible: prElig },
      issueCounts: { eligible: isElig },
      pr: { merged, open: openPr, closed: closedPr, mergeRate: totalPr ? Math.round((merged / totalPr) * 100) : 0, totalDay: prDay },
      issue: { solved, open: openIs, closed: closedIs, solveRate: totalIs ? Math.round((solved / totalIs) * 100) : 0, totalDay: isDay },
    };
  }, [data]);

  // KPI bar aggregates over the entire dataset (not filtered), using the
  // mode-selected eligibility / credibility / $/day so the top strip
  // matches the leaderboard below it.
  const pulse = useMemo(() => {
    if (!data?.miners) {
      return { total: 0, eligible: 0, ineligible: 0, totalUsd: 0, avgCred: 0 };
    }
    let eligible = 0;
    let totalUsd = 0;
    let credSum = 0;
    let credN = 0;
    for (const m of data.miners) {
      const vw = v(m);
      if (vw.eligible) {
        eligible += 1;
        totalUsd += vw.usd;
      }
      if (vw.cred > 0) { credSum += vw.cred; credN += 1; }
    }
    const total = data.miners.length;
    return {
      total,
      eligible,
      ineligible: total - eligible,
      totalUsd,
      avgCred: credN ? credSum / credN : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, views]);

  // Network-health snapshot for the sidebar. Two views in one card:
  //   - Specialization mix: how many miners are PR specialists, issue
  //     specialists, generalists (both tracks), or inactive. Reads at
  //     a glance as "what is this subnet made of?".
  //   - Credibility tiers: counts of miners in each cred band of the
  //     mode-active credibility, so newcomers and trusted miners are
  //     both visible at a glance.
  const networkHealth = useMemo(() => {
    if (!data?.miners) return null;

    let prOnly = 0, issueOnly = 0, both = 0, inactive = 0;
    for (const m of data.miners) {
      const oss = !!m.isEligible;
      const iss = !!m.isIssueEligible;
      if (oss && iss) both += 1;
      else if (oss) prOnly += 1;
      else if (iss) issueOnly += 1;
      else inactive += 1;
    }

    let verified = 0, trusted = 0, building = 0, fresh = 0;
    for (const m of data.miners) {
      const c = v(m).cred;
      if (c >= 0.75) verified += 1;
      else if (c >= 0.5) trusted += 1;
      else if (c >= 0.25) building += 1;
      else fresh += 1;
    }

    return {
      prOnly, issueOnly, both, inactive,
      eligibleCount: prOnly + issueOnly + both,
      verified, trusted, building, fresh,
      totalMiners: data.miners.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, views]);

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
        <Box sx={{ display: ['block', null, 'flex'], gap: 3, alignItems: 'flex-start', mt: 2 }}>
          {/* Leaderboard column */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Above-card control row.
             *
             *   desktop:  [ tabs ]          [ view switch ]          [ KPI strip ]
             *   mobile:   [ tabs (full)              ]
             *             [ KPI strip                ]
             *
             * Desktop is a three-column grid (`1fr auto 1fr`) so the
             * view switch sits exactly in the middle of the row
             * regardless of how wide the tabs / strip render. Mobile
             * falls back to a wrapping flex row and the view switch is
             * hidden (grid layout doesn't make sense on phones).
             */}
            <Box
              sx={{
                display: ['flex', null, 'grid'],
                gridTemplateColumns: ['none', null, '1fr auto 1fr'],
                alignItems: ['flex-start', null, 'center'],
                justifyContent: 'space-between',
                gap: [2, null, 3],
                mb: 2,
                flexWrap: 'wrap',
                px: '2px',
              }}
            >
              <Box sx={{ width: ['100%', null, 'auto'], minWidth: 0, justifySelf: ['auto', null, 'start'] }}>
                <ModeTabs mode={mode} onChange={setMode} />
              </Box>
              <Box sx={{ display: ['none', null, 'flex'], justifySelf: 'center' }}>
                <ViewSwitch value={viewMode} onChange={setViewMode} />
              </Box>
              <Box sx={{ width: ['100%', null, 'auto'], justifySelf: ['auto', null, 'end'] }}>
                <StatStrip pulse={pulse} loading={loadingFirst} />
              </Box>
            </Box>

            {isError && (
              <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
                <Text sx={{ color: 'danger.fg' }}>Failed to load miners.</Text>
              </Box>
            )}

            {/* Single bordered card wraps the toolbar + leaderboard so
             * they read as one panel. Toolbar carries its own
             * bottom-borders between rows; Leaderboard renders only the
             * data rows now. */}
            <Box
              sx={{
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'border.default',
                bg: 'canvas.subtle',
                overflow: 'hidden',
              }}
            >
              <Toolbar
                query={query}
                setQuery={setQuery}
                sortKey={sortKey}
                sortDir={sortDir}
                onSortChange={onSortChange}
                eligibility={eligibility}
                setEligibility={setEligibility}
                mode={mode}
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />

              {/* Divider between toolbar and the rows. */}
              <Box sx={{ height: '1px', bg: 'border.default' }} />

              {loadingFirst ? (
                <Box sx={{ p: 3 }}>
                  <TableRowsSkeleton
                    rows={12}
                    cols={[
                      { width: 24 },
                      { width: 28, flex: 0 },
                      { flex: 1 },
                      { width: 60 },
                      { width: 60 },
                      { width: 60 },
                      { width: 60 },
                      { width: 80 },
                    ]}
                  />
                </Box>
              ) : data ? (
                <>
                  {/* Mobile always renders the table; desktop swaps
                   * to the grid view when viewMode === 'grid'. */}
                  <Box
                    sx={{
                      display: viewMode === 'grid' ? ['block', null, 'none'] : 'block',
                    }}
                  >
                    <Leaderboard
                      miners={paginated}
                      ranks={ranks}
                      leaderScore={leaderScore}
                      viewOfMiner={v}
                      me={me}
                      tracked={tracked}
                      onToggleTrack={toggle}
                      mode={mode}
                    />
                  </Box>
                  {viewMode === 'grid' && (
                    <Box sx={{ display: ['none', null, 'block'] }}>
                      <LeaderboardGrid
                        miners={paginated}
                        ranks={ranks}
                        leaderScore={leaderScore}
                        viewOfMiner={v}
                        me={me}
                        tracked={tracked}
                        onToggleTrack={toggle}
                      />
                    </Box>
                  )}
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    totalItems={filtered.length}
                    pageSize={PAGE_SIZE}
                    onChange={setPage}
                  />
                </>
              ) : null}
            </Box>
          </Box>

          {/* Sidebar
            *
            * On desktop the sidebar sticks to the viewport but is
            * height-capped so it scrolls on its own — without this,
            * reading the bottom of a tall sidebar required scrolling
            * the leaderboard column all the way down too.
            * `pr: 1` reserves space for the scroll-track so the
            * sticky scrollbar doesn't clip the rightmost card edge.
            */}
          <Box
            sx={{
              width: ['100%', null, 300],
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              position: ['static', null, 'sticky'],
              top: 'calc(var(--header-height) + 16px)',
              mt: [3, null, 0],
              maxHeight: ['none', null, 'calc(100vh - var(--header-height) - 32px)'],
              overflowY: ['visible', null, 'auto'],
              pr: [0, null, 1],
            }}
          >
            <ActivityCard stats={activityStats} />

            <SidebarCard title="Code Impact">
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', columnGap: 2, rowGap: '8px' }}>
                <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Lines added</Text>
                <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 2, color: 'var(--success-fg)', textAlign: 'right' }}>
                  +{stats.code.added.toLocaleString()}
                </Text>
                <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Lines deleted</Text>
                <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 2, color: 'var(--danger-fg)', textAlign: 'right' }}>
                  −{stats.code.deleted.toLocaleString()}
                </Text>
                <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Repos touched</Text>
                <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 2, color: 'fg.default', textAlign: 'right' }}>
                  {stats.code.repos.toLocaleString()}
                </Text>
              </Box>
              <Box sx={{ mt: '12px', pt: '12px', borderTop: '1px solid', borderColor: 'border.muted' }}>
                <Bar
                  label="Avg Credibility"
                  pct={Math.round(stats.code.avgCred * 100)}
                  color={stats.code.avgCred >= 0.5 ? 'var(--success-fg)' : stats.code.avgCred >= 0.2 ? 'var(--attention-emphasis)' : 'var(--danger-fg)'}
                />
              </Box>
            </SidebarCard>

            <NetworkHealthCard health={networkHealth} />
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

/* StatStrip — KPI line: "N miners · N eligible · $N /day · N% cred".
 * Desktop renders inline; mobile becomes a 4-col grid. */
function StatStrip({
  pulse,
  loading,
}: {
  pulse: { total: number; eligible: number; ineligible: number; totalUsd: number; avgCred: number };
  loading: boolean;
}) {
  const credPct = Math.round(pulse.avgCred * 100);
  const credColor =
    pulse.avgCred >= 0.5
      ? 'var(--success-fg)'
      : pulse.avgCred >= 0.2
        ? 'var(--attention-emphasis)'
        : 'var(--danger-fg)';
  const fmt = (n: number) => (loading ? '—' : n.toLocaleString());
  return (
    <Box
      sx={{
        // Mobile: 4 auto-sized columns, block-centered via mx auto.
        // Desktop: inline flex with dot separators.
        display: ['grid', null, 'flex'],
        gridTemplateColumns: ['repeat(4, auto)', null, 'none'],
        alignItems: ['stretch', null, 'baseline'],
        justifyItems: ['center', null, 'stretch'],
        columnGap: ['18px', null, '4px'],
        rowGap: 1,
        mx: ['auto', null, 0],
      }}
    >
      <StatPair value={fmt(pulse.total)} label="miners" />
      <StatSep />
      <StatPair value={fmt(pulse.eligible)} label="eligible" color="var(--success-fg)" />
      <StatSep />
      <StatPair
        value={loading ? '—' : `$${Math.round(pulse.totalUsd).toLocaleString()}`}
        label="/day"
        color="var(--accent-fg)"
      />
      <StatSep />
      <StatPair value={loading ? '—' : `${credPct}%`} label="cred" color={credColor} />
    </Box>
  );
}

function StatPair({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <Box
      sx={{
        // Mobile: stack value over uppercase mini-label, centered.
        // Desktop: inline baseline-aligned pair.
        display: ['flex', null, 'inline-flex'],
        flexDirection: ['column', null, 'row'],
        alignItems: ['center', null, 'baseline'],
        textAlign: ['center', null, 'left'],
        gap: ['2px', null, '6px'],
        minWidth: 0,
      }}
    >
      <Text
        sx={{
          fontFamily: 'mono',
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          fontSize: [2, null, 3],
          letterSpacing: '-0.02em',
          color: color ?? 'var(--fg-default)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}
      >
        {value}
      </Text>
      <Text
        sx={{
          color: 'fg.muted',
          fontSize: ['9px', null, 1],
          fontWeight: [700, null, 500],
          letterSpacing: ['0.6px', null, 'normal'],
          textTransform: ['uppercase', null, 'none'],
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
    </Box>
  );
}

function StatSep() {
  return (
    <Text
      aria-hidden
      sx={{
        color: 'var(--fg-subtle)',
        mx: '6px',
        userSelect: 'none',
        display: ['none', null, 'inline'],
      }}
    >
      ·
    </Text>
  );
}

/* ModeTabs — Total / OSS / Discovery segmented control. A single
 * absolutely-positioned thumb slides under the active tab. */
function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const activeIndex = Math.max(0, MODES.findIndex((m) => m.key === mode));
  const n = MODES.length;
  return (
    <Box
      role="tablist"
      sx={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${n}, minmax(72px, 1fr))`,
        alignItems: 'stretch',
        padding: '3px',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        bg: 'var(--bg-canvas)',
        flexShrink: 0,
      }}
    >
      {/* Sliding thumb — equal-width columns mean the thumb is exactly
       * 1/N of the container, less the 3px+3px gutters. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: '3px',
          bottom: '3px',
          left: '3px',
          width: `calc((100% - 6px) / ${n})`,
          borderRadius: 1,
          bg: 'var(--bg-emphasis)',
          boxShadow:
            '0 1px 2px rgba(0,0,0,0.18), 0 0 0 1px var(--border-strong)',
          transform: `translateX(${activeIndex * 100}%)`,
          transition: 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'none',
        }}
      />
      {MODES.map((m) => {
        const active = mode === m.key;
        return (
          <Box
            as="button"
            key={m.key}
            role="tab"
            aria-selected={active}
            title={m.sub}
            onClick={() => onChange(m.key)}
            sx={{
              position: 'relative',
              px: 3,
              py: '6px',
              border: 'none',
              borderRadius: 1,
              bg: 'transparent',
              color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 1,
              fontWeight: active ? 700 : 500,
              letterSpacing: '-0.005em',
              whiteSpace: 'nowrap',
              transition: 'color 180ms ease',
              '&:hover': { color: 'var(--fg-default)' },
            }}
          >
            {m.label}
          </Box>
        );
      })}
    </Box>
  );
}

/* Toolbar — sort chips · search · show-filter chips. Layout flows
 * via gridTemplateAreas so the search input re-stacks first on mobile. */
function Toolbar({
  query,
  setQuery,
  sortKey,
  sortDir,
  onSortChange,
  eligibility,
  setEligibility,
  mode,
  page,
  totalPages,
  onPageChange,
}: {
  query: string;
  setQuery: (s: string) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSortChange: (k: SortKey) => void;
  eligibility: EligibilityFilter;
  setEligibility: (e: EligibilityFilter) => void;
  mode: Mode;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['1fr', null, 'auto minmax(180px, 1fr) auto'],
        gridTemplateAreas: [
          `"search" "sort" "show"`,
          null,
          `"sort search show"`,
        ],
        alignItems: 'center',
        gap: [2, null, 3],
        px: [2, null, 3],
        py: '10px',
      }}
    >
      {/* Sort group */}
      <Box
        sx={{
          gridArea: 'sort',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          // On mobile, force one row + a horizontal scroll fallback
          // so the four sort chips never wrap onto a second line.
          // Scrollbar is suppressed visually.
          flexWrap: 'nowrap',
          overflowX: ['auto', null, 'visible'],
          minWidth: 0,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        <Box
          aria-label="Sort"
          title="Sort"
          sx={{ display: 'inline-flex', alignItems: 'center', color: 'fg.subtle', pr: '6px' }}
        >
          <SortDescIcon size={14} />
        </Box>
        {SORT_KEYS.map((k) => {
          const active = sortKey === k;
          return (
            <ChipButton key={k} active={active} onClick={() => onSortChange(k)}>
              {sortLabel(k, mode)}
              {active && (sortDir === 'desc' ? <TriangleDownIcon size={12} /> : <TriangleUpIcon size={12} />)}
            </ChipButton>
          );
        })}
      </Box>

      {/* Search input */}
      <Box
        sx={{
          gridArea: 'search',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: '6px',
          border: '1px solid',
          borderColor: 'border.muted',
          borderRadius: 1,
          bg: 'var(--bg-canvas)',
          color: 'fg.muted',
          minWidth: 0,
          // Crisper focus state via :focus-within on the wrapper.
          '&:focus-within': {
            borderColor: 'var(--border-strong)',
            color: 'fg.default',
          },
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
            py: '2px',
            '&::placeholder': { color: 'var(--fg-subtle)' },
          }}
        />
        {query && (
          <Box
            as="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            sx={{
              border: 'none',
              bg: 'transparent',
              color: 'fg.subtle',
              fontSize: 0,
              cursor: 'pointer',
              px: 1,
              '&:hover': { color: 'fg.default' },
            }}
          >
            ×
          </Box>
        )}
      </Box>

      {/* Show group */}
      <Box
        sx={{
          gridArea: 'show',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'nowrap',
          overflowX: ['auto', null, 'visible'],
          justifyContent: ['flex-start', null, 'flex-end'],
          minWidth: 0,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        <Box
          aria-label="Show"
          title="Show"
          sx={{ display: 'inline-flex', alignItems: 'center', color: 'fg.subtle', pr: '6px' }}
        >
          <FilterIcon size={14} />
        </Box>
        {(['all', 'eligible', 'ineligible'] as EligibilityFilter[]).map((e) => (
          <ChipButton
            key={e}
            active={eligibility === e}
            onClick={() => setEligibility(e)}
            capitalize
          >
            {e}
          </ChipButton>
        ))}
        {/* Mobile-only page select pushed to the right end of the row. */}
        <Box sx={{ ml: 'auto', display: ['inline-flex', null, 'none'], flexShrink: 0 }}>
          <MobilePageSelect page={page} totalPages={totalPages} onChange={onPageChange} />
        </Box>
      </Box>
    </Box>
  );
}

/* MobilePageSelect — page dropdown rendered inside the Show row on
 * mobile in place of the bottom Pagination bar. Hides itself when
 * there's only one page. */
function MobilePageSelect({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <Box
      as="select"
      value={page}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(Number(e.target.value))}
      aria-label="Select page"
      sx={{
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        px: '8px',
        py: '4px',
        pr: '24px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 1,
        bg: 'var(--bg-canvas)',
        color: 'var(--fg-default)',
        fontFamily: 'inherit',
        fontSize: 0,
        fontWeight: 600,
        cursor: 'pointer',
        // Custom chevron via inline SVG so the select doesn't render
        // the native (un-themable) one.
        backgroundImage:
          'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"10\\" height=\\"10\\" viewBox=\\"0 0 10 10\\"><path fill=\\"%239ea0a6\\" d=\\"M1 3l4 4 4-4z\\"/></svg>")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 7px center',
      }}
    >
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <option key={p} value={p}>
          Page {p} / {totalPages}
        </option>
      ))}
    </Box>
  );
}

// Shared chip button used by both Sort and Show groups. Looks dim until
// active; on hover, gets a faint neutral wash so users can tell it's
// clickable without visual noise at rest.
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
        gap: '4px',
        // Mobile: tighter padding + smaller font so the row of four
        // sort labels comfortably fits across a typical phone. Chips
        // also refuse to shrink, so the parent's overflow-x: auto
        // kicks in for very narrow viewports.
        px: ['8px', null, 2],
        py: '4px',
        flexShrink: 0,
        border: 'none',
        borderRadius: 1,
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        fontSize: [0, null, 1],
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textTransform: capitalize ? 'capitalize' : 'none',
        transition: 'background-color 100ms, color 100ms',
        whiteSpace: 'nowrap',
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

/* Leaderboard — table view of paginated rows with a desktop header.
 * Switching sort re-numbers ranks and reassigns gold/silver/bronze. */
function Leaderboard({
  miners,
  ranks,
  leaderScore,
  viewOfMiner,
  me,
  tracked,
  onToggleTrack,
  mode,
}: {
  miners: Miner[];
  ranks: Map<string, number>;
  leaderScore: number;
  viewOfMiner: (m: Miner) => MinerView;
  me: string;
  tracked: Set<string>;
  onToggleTrack: (id: string) => void;
  mode: Mode;
}) {
  if (miners.length === 0) {
    return (
      <Box sx={{ p: 5, textAlign: 'center', color: 'fg.muted' }}>
        No miners match your filters.
      </Box>
    );
  }

  // Mode-aware primary label for the OSS/Discovery header column
  // (Merged / Solved / Done). Pulled from the first row's view since
  // every row in a given mode shares the same primary label.
  const primaryLabel = viewOfMiner(miners[0]).counts.primaryLabel;

  // Mobile gets a 12px inset above row 1 (matches the inter-row gap);
  // desktop drops it since the header sits flush with the divider.
  return (
    <Box sx={{ pt: ['12px', null, 0] }}>
      <LeaderboardHeader mode={mode} primaryLabel={primaryLabel} />
      {miners.map((m, i) => {
        // Global rank stays stable across search/eligibility filters.
        const rank = ranks.get(m.id) ?? i + 1;
        const vw = viewOfMiner(m);
        const pct = leaderScore > 0 ? Math.max(1, Math.round((vw.score / leaderScore) * 100)) : 0;
        return (
          <LeaderRow
            key={m.id}
            miner={m}
            view={vw}
            rank={rank}
            pct={pct}
            isMe={ghKey(m.githubUsername) === ghKey(me)}
            isTracked={tracked.has(m.id)}
            onToggleTrack={() => onToggleTrack(m.id)}
            isLast={i === miners.length - 1}
          />
        );
      })}
    </Box>
  );
}

/* ─── Table header ───
 * Desktop-only column titles for the table view. Mirrors LeaderRow's
 * desktop grid template so titles line up exactly above each cell.
 * Mobile rows carry their own per-cell labels (each row reads as a
 * card), so the header is hidden there.
 */
function LeaderboardHeader({
  mode,
  primaryLabel,
}: {
  mode: Mode;
  primaryLabel: string;
}) {
  return (
    <Box
      sx={{
        display: ['none', null, 'grid'],
        gridTemplateColumns: '48px minmax(200px, 1fr) 220px 80px 80px 80px 80px 100px 40px',
        gridTemplateAreas:
          mode === 'total'
            ? `"rank identity mid act cred ossCred discCred usd track"`
            : `"rank identity mid m1 m2 m3 m4 usd track"`,
        alignItems: 'center',
        columnGap: 3,
        px: 4,
        py: '10px',
        borderBottom: '1px solid',
        borderBottomColor: 'border.muted',
        bg: 'canvas.subtle',
      }}
    >
      <HeaderCell area="rank">Rank</HeaderCell>
      <HeaderCell area="identity">Miner</HeaderCell>
      <HeaderCell area="mid">Score</HeaderCell>
      {mode === 'total' ? (
        <>
          <HeaderCell area="act" align="right">Activity</HeaderCell>
          <HeaderCell area="cred" align="right">Credibility</HeaderCell>
          <HeaderCell area="ossCred" align="right">OSS Cred</HeaderCell>
          <HeaderCell area="discCred" align="right">Disc Cred</HeaderCell>
        </>
      ) : (
        <>
          <HeaderCell area="m1" align="right">{primaryLabel}</HeaderCell>
          <HeaderCell area="m2" align="right">Open</HeaderCell>
          <HeaderCell area="m3" align="right">Closed</HeaderCell>
          <HeaderCell area="m4" align="right">Cred</HeaderCell>
        </>
      )}
      <HeaderCell area="usd" align="right">$/Day</HeaderCell>
      <Box sx={{ gridArea: 'track' }} />
    </Box>
  );
}

function HeaderCell({
  area,
  align = 'left',
  children,
}: {
  area: string;
  align?: 'left' | 'right' | 'center';
  children: React.ReactNode;
}) {
  return (
    <Text
      sx={{
        gridArea: area,
        fontSize: '10px',
        color: 'fg.muted',
        fontWeight: 700,
        letterSpacing: '0.8px',
        textTransform: 'uppercase',
        textAlign: align,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Text>
  );
}

/* ─── Pagination ───
 * Page indicator + prev/next controls. Lives at the bottom of the
 * leaderboard card, inside the wrapper border. Hides itself entirely
 * when there's only one page so empty / small networks don't show a
 * dead control.
 */
function Pagination({
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
    <Box
      sx={{
        // Mobile uses the inline page select on the Show row instead.
        display: ['none', null, 'flex'],
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 2,
        px: 4,
        py: '12px',
        borderTop: '1px solid',
        borderTopColor: 'border.muted',
        bg: 'canvas.subtle',
      }}
    >
      <Text sx={{ fontSize: 1, color: 'fg.muted', display: ['none', null, 'block'] }}>
        Showing <Text as="span" sx={{ color: 'fg.default', fontWeight: 600 }}>{start}–{end}</Text> of {totalItems}
      </Text>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <PageNavBtn disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</PageNavBtn>
        <Text
          sx={{
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 1,
            color: 'fg.muted',
            mx: 2,
          }}
        >
          Page <Text as="span" sx={{ color: 'fg.default', fontWeight: 700 }}>{page}</Text> of {totalPages}
        </Text>
        <PageNavBtn disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next ›</PageNavBtn>
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
        px: 2,
        py: '4px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 1,
        bg: 'var(--bg-canvas)',
        color: disabled ? 'var(--fg-muted)' : 'var(--fg-default)',
        fontSize: 1,
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 100ms, border-color 100ms',
        '&:hover': disabled ? undefined : {
          bg: 'var(--neutral-subtle)',
          borderColor: 'var(--border-strong)',
        },
      }}
    >
      {children}
    </Box>
  );
}

/* ViewSwitch — table / grid toggle pill. Desktop-only. */
function ViewSwitch({
  value,
  onChange,
}: {
  value: 'table' | 'grid';
  onChange: (v: 'table' | 'grid') => void;
}) {
  return (
    <Box
      role="group"
      aria-label="View mode"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: '3px',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        bg: 'var(--bg-canvas)',
        flexShrink: 0,
      }}
    >
      <ViewModeBtn active={value === 'table'} onClick={() => onChange('table')} label="Table view">
        <RowsIcon size={14} />
      </ViewModeBtn>
      <ViewModeBtn active={value === 'grid'} onClick={() => onChange('grid')} label="Grid view">
        <AppsIcon size={14} />
      </ViewModeBtn>
    </Box>
  );
}

function ViewModeBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 26,
        border: 'none',
        borderRadius: 1,
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        cursor: 'pointer',
        transition: 'background-color 100ms, color 100ms',
        '&:hover': { color: 'var(--fg-default)' },
      }}
    >
      {children}
    </Box>
  );
}

/* LeaderboardGrid — card layout of the same per-miner data. Cards
 * flow via auto-fill, minmax(280px, 1fr). Desktop-only. */
function LeaderboardGrid({
  miners,
  ranks,
  leaderScore,
  viewOfMiner,
  me,
  tracked,
  onToggleTrack,
}: {
  miners: Miner[];
  ranks: Map<string, number>;
  leaderScore: number;
  viewOfMiner: (m: Miner) => MinerView;
  me: string;
  tracked: Set<string>;
  onToggleTrack: (id: string) => void;
}) {
  if (miners.length === 0) {
    return (
      <Box sx={{ p: 5, textAlign: 'center', color: 'fg.muted' }}>
        No miners match your filters.
      </Box>
    );
  }
  return (
    <Box
      sx={{
        p: 3,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 3,
      }}
    >
      {miners.map((m, i) => {
        const rank = ranks.get(m.id) ?? i + 1;
        const vw = viewOfMiner(m);
        const pct = leaderScore > 0 ? Math.max(1, Math.round((vw.score / leaderScore) * 100)) : 0;
        return (
          <LeaderCard
            key={m.id}
            miner={m}
            view={vw}
            rank={rank}
            pct={pct}
            isMe={ghKey(m.githubUsername) === ghKey(me)}
            isTracked={tracked.has(m.id)}
            onToggleTrack={() => onToggleTrack(m.id)}
          />
        );
      })}
    </Box>
  );
}

/* LeaderCard — mirrors the mobile LeaderRow grid wrapped in card
 * chrome. Sharing the layout keeps card / mobile-row in lockstep. */
function LeaderCard({
  miner,
  view,
  rank,
  pct,
  isMe,
  isTracked,
  onToggleTrack,
}: {
  miner: Miner;
  view: MinerView;
  rank: number;
  pct: number;
  isMe: boolean;
  isTracked: boolean;
  onToggleTrack: () => void;
}) {
  const tier = tierForRank(rank);
  const isTop = !!tier;
  const dim = !view.eligible;
  const usd = view.usd;
  const cred = view.cred;
  const score = view.score;
  // Uniform across tiers so the name / UID start at the same X in every card.
  const avatarSize = 32;

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto auto',
        gridTemplateAreas: `"rank identity usd track" "mid mid mid mid" "metrics metrics metrics metrics"`,
        alignItems: 'center',
        columnGap: 2,
        rowGap: 2,
        px: 3,
        py: isTop ? '14px' : '12px',
        border: '1px solid',
        borderColor: tier ? tier.accent : 'border.default',
        borderRadius: 2,
        bg: isMe ? 'var(--accent-subtle)' : 'var(--bg-canvas)',
        backgroundImage: tier
          ? `linear-gradient(90deg, ${tier.glow} 0%, transparent 55%)`
          : undefined,
        boxShadow: tier
          ? 'inset 0 1px 0 var(--neutral-subtle), inset 0 -1px 0 var(--neutral-subtle)'
          : undefined,
        // Ineligible: darker + desaturated. No longer signalled by a badge.
        opacity: dim ? 0.4 : 1,
        filter: dim ? 'grayscale(0.5)' : undefined,
        transition: 'transform 120ms ease, border-color 120ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          borderColor: tier ? tier.accent : 'border.strong',
        },
        ...(tier && {
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            bg: tier.accent,
            borderTopRightRadius: '2px',
            borderBottomRightRadius: '2px',
          },
        }),
      }}
    >
      <Box sx={{ gridArea: 'rank' }}>
        <RankBadge rank={rank} tier={tier} size={isTop ? 4 : 3} />
      </Box>

      <Box sx={{ gridArea: 'identity' }}>
        <MinerIdentity
          miner={miner}
          isMe={isMe}
          isTop={isTop}
          tier={tier}
          avatarSize={avatarSize}
        />
      </Box>

      <Box sx={{ gridArea: 'usd' }}>
        <UsdValue usd={usd} size={isTop ? 3 : 2} labelDisplay="always" />
      </Box>

      <Box sx={{ gridArea: 'track', display: 'flex', justifyContent: 'center' }}>
        <TrackButton isTracked={isTracked} onClick={onToggleTrack} />
      </Box>

      <Box sx={{ gridArea: 'mid', minWidth: 0 }}>
        <ScoreBar pct={pct} score={score} tier={tier} isTop={isTop} />
      </Box>

      {/* Metrics — 4 cells matching the mobile LeaderRow strip. */}
      <Box
        sx={{
          gridArea: 'metrics',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          columnGap: 2,
        }}
      >
        {view.mode === 'total' ? (
          <>
            <CompactMetric label="Act" value={view.counts.primary.toLocaleString()} color="var(--fg-default)" />
            <CompactMetric label="Cred" value={percentOrZero(view.cred)} color={credColor(view.cred)} />
            <CompactMetric label="OSS" value={percentOrZero(num(miner.credibility))} color={credColor(num(miner.credibility))} />
            <CompactMetric label="Disc" value={percentOrZero(num(miner.issueCredibility))} color={credColor(num(miner.issueCredibility))} />
          </>
        ) : (
          <>
            <CompactMetric
              label={view.counts.primaryLabel}
              value={view.counts.primary.toLocaleString()}
              color={view.counts.primary > 0 ? 'var(--success-fg)' : 'var(--fg-muted)'}
            />
            <CompactMetric
              label="Open"
              value={view.counts.open.toLocaleString()}
              color={view.counts.open > 0 ? 'var(--fg-default)' : 'var(--fg-muted)'}
            />
            <CompactMetric
              label="Closed"
              value={view.counts.closed.toLocaleString()}
              color={view.counts.closed > 0 ? 'var(--danger-fg)' : 'var(--fg-muted)'}
            />
            <CompactMetric label="Cred" value={percentOrZero(cred)} color={credColor(cred)} />
          </>
        )}
      </Box>
    </Box>
  );
}


function LeaderRow({
  miner,
  view,
  rank,
  pct,
  isMe,
  isTracked,
  onToggleTrack,
  isLast,
}: {
  miner: Miner;
  view: MinerView;
  rank: number;
  pct: number;
  isMe: boolean;
  isTracked: boolean;
  onToggleTrack: () => void;
  isLast: boolean;
}) {
  const tier = tierForRank(rank);
  const isTop = !!tier;
  const dim = !view.eligible;
  const usd = view.usd;
  const cred = view.cred;
  const score = view.score;
  // Uniform across tiers so the name / UID start at the same X in every row.
  const avatarSize = 28;

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'grid',
        // Mobile: 3 stacked sub-rows; desktop: one wide table row.
        // Desktop mid column is a fixed 220px score-bar lane so the
        // identity column can flex and metric cells get 80px each.
        gridTemplateColumns: [
          '36px 1fr auto auto',
          null,
          '48px minmax(200px, 1fr) 220px 80px 80px 80px 80px 100px 40px',
        ],
        gridTemplateAreas: [
          `"rank identity usd track" "mid mid mid mid" "metrics metrics metrics metrics"`,
          null,
          view.mode === 'total'
            ? `"rank identity mid act cred ossCred discCred usd track"`
            : `"rank identity mid m1 m2 m3 m4 usd track"`,
        ],
        alignItems: 'center',
        columnGap: [2, null, 3],
        rowGap: [2, null, 1],
        px: [3, null, 4],
        py: isTop ? [2, null, '12px'] : [2, null, '8px'],
        borderBottom: 'none',
        mb: [isLast ? 0 : '12px', null, 0],
        bg: isMe
          ? 'var(--accent-subtle)'
          : ['var(--bg-canvas)', null, 'transparent'],
        borderRadius: [2, null, 0],
        backgroundImage: tier
          ? `linear-gradient(90deg, ${tier.glow} 0%, transparent 55%)`
          : undefined,
        // Hairline rule between rows; tier rows also get a top inset
        // for a card-like lift.
        boxShadow: [
          tier ? 'inset 0 1px 0 var(--neutral-subtle)' : null,
          isLast ? null : 'inset 0 -1px 0 var(--neutral-subtle)',
        ].filter(Boolean).join(', ') || undefined,
        // Ineligible rows: heavier dim + desaturation in place of a badge.
        opacity: dim ? 0.35 : 1,
        filter: dim ? 'grayscale(0.5)' : undefined,
        transition: 'background-color 100ms, transform 120ms',
        cursor: 'default',
        '&:hover': {
          bg: isMe ? 'var(--accent-subtle)' : 'canvas.default',
        },
        // Tier-coloured left stripe.
        ...(tier && {
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: ['4px', null, '3px'],
            bg: tier.accent,
            borderTopRightRadius: '2px',
            borderBottomRightRadius: '2px',
          },
        }),
      }}
    >
      <Box sx={{ gridArea: 'rank' }}>
        <RankBadge rank={rank} tier={tier} size={isTop ? [2, null, 4] : [1, null, 3]} />
      </Box>

      <Box sx={{ gridArea: 'identity' }}>
        <MinerIdentity
          miner={miner}
          isMe={isMe}
          isTop={isTop}
          tier={tier}
          avatarSize={avatarSize}
        />
      </Box>

      <Box sx={{ gridArea: 'mid', minWidth: 0 }}>
        <ScoreBar pct={pct} score={score} tier={tier} isTop={isTop} />
      </Box>

      {/* Metric columns.
       *
       * The wrapper Box has `display: contents` on desktop — it dissolves
       * so its children flow into the parent grid by their `gridArea`
       * props. On mobile it switches to `display: grid` and becomes a
       * sub-grid in the parent's `metrics` row, laying every metric out
       * in a single equal-width row.
       *
       * Total mode: Activity · Credibility · OSS Cred · Disc Cred.
       * OSS / Disc: Score · Cred. */}
      <Box
        sx={{
          gridArea: ['metrics', null, 'auto'],
          display: ['grid', null, 'contents'],
          gridTemplateColumns: ['repeat(4, minmax(0, 1fr))', null, 'none'],
          columnGap: [2, null, 0],
        }}
      >
        {view.mode === 'total' ? (
          <>
            <MetricCell
              gridArea="act"
              label="Activity"
              mobileLabel="Act"
              value={view.counts.primary.toLocaleString()}
              color="var(--fg-default)"
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="cred"
              label="Credibility"
              mobileLabel="Cred"
              value={percentOrZero(view.cred)}
              color={credColor(view.cred)}
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="ossCred"
              label="OSS Cred"
              mobileLabel="OSS"
              value={percentOrZero(num(miner.credibility))}
              color={credColor(num(miner.credibility))}
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="discCred"
              label="Disc Cred"
              mobileLabel="Disc"
              value={percentOrZero(num(miner.issueCredibility))}
              color={credColor(num(miner.issueCredibility))}
              isTop={isTop}
              alignMobile="left"
            />
          </>
        ) : (
          <>
            <MetricCell
              gridArea="m1"
              label={view.counts.primaryLabel}
              value={view.counts.primary.toLocaleString()}
              color={view.counts.primary > 0 ? 'var(--success-fg)' : 'var(--fg-muted)'}
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="m2"
              label="Open"
              value={view.counts.open.toLocaleString()}
              color={view.counts.open > 0 ? 'var(--fg-default)' : 'var(--fg-muted)'}
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="m3"
              label="Closed"
              value={view.counts.closed.toLocaleString()}
              color={view.counts.closed > 0 ? 'var(--danger-fg)' : 'var(--fg-muted)'}
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="m4"
              label="Cred"
              value={percentOrZero(cred)}
              color={credColor(cred)}
              isTop={isTop}
              alignMobile="left"
            />
          </>
        )}
      </Box>

      <Box sx={{ gridArea: 'usd' }}>
        <UsdValue usd={usd} size={isTop ? [2, null, 3] : 2} labelDisplay="mobile" />
      </Box>

      <Box sx={{ gridArea: 'track', display: 'flex', justifyContent: 'center' }}>
        <TrackButton isTracked={isTracked} onClick={onToggleTrack} />
      </Box>
    </Box>
  );
}

/* ─── Sidebar cards ─── */

/* ActivityCard — PR & Issue tracks side-by-side, with completion-rate
 * bars and a $/day pool per track. */
function ActivityCard({
  stats,
}: {
  stats: {
    counts: { eligible: number };
    issueCounts: { eligible: number };
    pr: { merged: number; open: number; closed: number; mergeRate: number; totalDay: number };
    issue: { solved: number; open: number; closed: number; solveRate: number; totalDay: number };
  };
}) {
  return (
    <SidebarCard title="Activity">
      {/* PR | ISSUE column headers */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          alignItems: 'center',
          columnGap: 3,
          rowGap: '8px',
          pb: '10px',
          borderBottom: '1px solid',
          borderColor: 'border.muted',
        }}
      >
        <Box />
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', fontWeight: 700, letterSpacing: '1px', textAlign: 'right' }}>
          PR
        </Text>
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', fontWeight: 700, letterSpacing: '1px', textAlign: 'right' }}>
          ISSUE
        </Text>

        <ActivityRow label="Eligible">
          <ActivityValue value={stats.counts.eligible} color="var(--success-fg)" />
          <ActivityValue value={stats.issueCounts.eligible} color="var(--success-fg)" />
        </ActivityRow>

        <ActivityRow label="Merged / Solved">
          <ActivityValue value={stats.pr.merged} />
          <ActivityValue value={stats.issue.solved} />
        </ActivityRow>

        <ActivityRow label="Open">
          <ActivityValue value={stats.pr.open} />
          <ActivityValue value={stats.issue.open} />
        </ActivityRow>

        <ActivityRow label="Closed">
          <ActivityValue value={stats.pr.closed} color="var(--danger-fg)" />
          <ActivityValue value={stats.issue.closed} color="var(--danger-fg)" />
        </ActivityRow>
      </Box>

      {/* Completion rates */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', mt: '12px' }}>
        <Bar
          label="Merge rate"
          pct={stats.pr.mergeRate}
          color={stats.pr.mergeRate >= 75 ? 'var(--success-fg)' : 'var(--attention-emphasis)'}
        />
        <Bar
          label="Solve rate"
          pct={stats.issue.solveRate}
          color={stats.issue.solveRate >= 75 ? 'var(--success-fg)' : 'var(--attention-emphasis)'}
        />
      </Box>

      {/* $/day pool per track */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          alignItems: 'baseline',
          columnGap: 3,
          mt: '12px',
          pt: '12px',
          borderTop: '1px solid',
          borderColor: 'border.muted',
        }}
      >
        <Text sx={{ fontSize: 1, color: 'fg.muted' }}>$/day pool</Text>
        <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--success-fg)', textAlign: 'right' }}>
          ${stats.pr.totalDay.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </Text>
        <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--success-fg)', textAlign: 'right' }}>
          ${stats.issue.totalDay.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </Text>
      </Box>
    </SidebarCard>
  );
}

// A single label + two-track value row used inside the ActivityCard grid.
// Children render into columns 2 & 3.
function ActivityRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <Text sx={{ fontSize: 1, color: 'fg.muted' }}>{label}</Text>
      {children}
    </>
  );
}

function ActivityValue({ value, color }: { value: number; color?: string }) {
  return (
    <Text
      sx={{
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        fontSize: 2,
        color: value > 0 ? (color ?? 'fg.default') : 'fg.subtle',
        textAlign: 'right',
      }}
    >
      {value.toLocaleString()}
    </Text>
  );
}

/* NetworkHealthCard — Specialization + Credibility sections, each a
 * stacked-bar overview with a dotted legend. Cred is mode-active;
 * specialization is cross-track. */
function NetworkHealthCard({
  health,
}: {
  health: {
    prOnly: number;
    issueOnly: number;
    both: number;
    inactive: number;
    eligibleCount: number;
    verified: number;
    trusted: number;
    building: number;
    fresh: number;
    totalMiners: number;
  } | null;
}) {
  if (!health) {
    return (
      <SidebarCard title="Network Health">
        <Text sx={{ color: 'fg.muted', fontSize: 1 }}>—</Text>
      </SidebarCard>
    );
  }

  const specSegments: HealthSegment[] = [
    { key: 'gen', label: 'Generalists', count: health.both, color: 'var(--success-fg)' },
    { key: 'pr', label: 'PR Specialists', count: health.prOnly, color: 'var(--attention-emphasis)' },
    { key: 'iss', label: 'Issue Specialists', count: health.issueOnly, color: 'var(--done-emphasis)' },
    { key: 'inactive', label: 'Inactive', count: health.inactive, color: 'var(--fg-muted)' },
  ];

  const credSegments: HealthSegment[] = [
    { key: 'verified', label: 'Verified', count: health.verified, color: 'var(--success-fg)', sub: '≥75%' },
    { key: 'trusted', label: 'Trusted', count: health.trusted, color: 'var(--attention-emphasis)', sub: '50–74%' },
    { key: 'building', label: 'Building', count: health.building, color: 'var(--accent-fg)', sub: '25–49%' },
    { key: 'new', label: 'New', count: health.fresh, color: 'var(--fg-muted)', sub: '<25%' },
  ];

  return (
    <SidebarCard title="Network Health">
      <HealthSection
        title="Specialization"
        right={`${health.eligibleCount}/${health.totalMiners} eligible`}
        segments={specSegments}
        total={health.totalMiners}
      />
      <HealthSection
        title="Credibility"
        segments={credSegments}
        total={health.totalMiners}
        topBorder
      />
    </SidebarCard>
  );
}

type HealthSegment = {
  key: string;
  label: string;
  count: number;
  color: string;
  sub?: string;
};

function HealthSection({
  title,
  right,
  segments,
  total,
  topBorder,
}: {
  title: string;
  right?: string;
  segments: HealthSegment[];
  total: number;
  topBorder?: boolean;
}) {
  return (
    <Box
      sx={
        topBorder
          ? { mt: '16px', pt: '14px', borderTop: '1px solid', borderColor: 'border.muted' }
          : undefined
      }
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: '10px' }}>
        <Text
          sx={{
            fontSize: '10px',
            color: 'fg.muted',
            fontWeight: 700,
            letterSpacing: '1px',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Text>
        {right && (
          <Text
            sx={{
              fontSize: 0,
              color: 'fg.muted',
              fontFamily: 'mono',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {right}
          </Text>
        )}
      </Box>

      <StackedBar segments={segments} total={total} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', mt: '12px' }}>
        {segments.map((seg) => (
          <HealthLegendRow key={seg.key} segment={seg} />
        ))}
      </Box>
    </Box>
  );
}

// Single stacked-segment bar. Each segment's width is its share of the
// section total; segments with a zero count render zero-width and
// effectively disappear, which keeps the visual honest without empty
// "ghost" slices.
function StackedBar({ segments, total }: { segments: HealthSegment[]; total: number }) {
  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        height: 6,
        borderRadius: 999,
        overflow: 'hidden',
        bg: 'canvas.inset',
      }}
      role="img"
      aria-label="Distribution"
    >
      {segments.map((seg) => {
        const pct = total > 0 ? (seg.count / total) * 100 : 0;
        return (
          <Box
            key={seg.key}
            title={`${seg.label}: ${seg.count.toLocaleString()}`}
            sx={{
              width: `${pct}%`,
              bg: seg.color,
              transition: 'width 300ms ease',
            }}
          />
        );
      })}
    </Box>
  );
}

function HealthLegendRow({ segment }: { segment: HealthSegment }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, fontSize: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: 999,
            bg: segment.color,
            flexShrink: 0,
          }}
        />
        <Text sx={{ color: 'fg.muted', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {segment.label}
        </Text>
        {segment.sub && (
          <Text sx={{ color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>
            {segment.sub}
          </Text>
        )}
      </Box>
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          color: 'fg.default',
        }}
      >
        {segment.count.toLocaleString()}
      </Text>
    </Box>
  );
}

function SidebarCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        p: '14px',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '12px', gap: 2 }}>
        <Text
          sx={{
            fontSize: 0,
            fontWeight: 800,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: 'fg.muted',
          }}
        >
          {title}
        </Text>
        {right}
      </Box>
      {children}
    </Box>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '4px', fontSize: 1 }}>
        <Text sx={{ color: 'fg.default' }}>{label}</Text>
        <Text sx={{ fontFamily: 'mono', fontWeight: 700 }} style={{ color }}>{pct}%</Text>
      </Box>
      <Box sx={{ width: '100%', height: 6, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
        <Box sx={{ height: '100%' }} style={{ width: `${pct}%`, backgroundColor: color }} />
      </Box>
    </Box>
  );
}
