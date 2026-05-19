'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, TextInput, Label } from '@primer/react';
import {
  SearchIcon,
  StarIcon,
  StarFillIcon,
  TriangleDownIcon,
  TriangleUpIcon,
  SortDescIcon,
  FilterIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import { formatUsd } from '@/lib/format';

interface Miner {
  id: string;
  uid: number;
  hotkey: string;
  // Some miners join the subnet before linking GitHub, so this can be null.
  githubUsername: string | null;
  githubId?: string;
  isEligible: boolean;
  isIssueEligible?: boolean;
  failedReason?: string | null;
  credibility: string;
  issueCredibility?: string;
  issueDiscoveryScore?: string;
  issueTokenScore?: string;
  totalScore: string;
  baseTotalScore?: string;
  totalSolvedIssues?: number;
  totalValidSolvedIssues?: number;
  totalOpenIssues?: number;
  totalClosedIssues?: number;
  totalOpenPrs?: number;
  totalClosedPrs?: number;
  totalMergedPrs?: number;
  totalPrs?: number;
  totalAdditions?: number;
  totalDeletions?: number;
  uniqueReposCount?: number;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
}

interface MinersResp {
  count: number;
  fetched_at: number;
  source?: string;
  miners: Miner[];
}

type SortKey = 'score' | 'earnings' | 'activity' | 'credibility';
type EligibilityFilter = 'all' | 'eligible' | 'ineligible';
// Which scoring rubric the leaderboard is showing. The page is the same
// shape in every mode — only the score / credibility / eligibility fields
// swap. See `viewOf` below for the mapping.
type Mode = 'total' | 'oss' | 'discovery';

const SORT_KEYS: SortKey[] = ['score', 'earnings', 'activity', 'credibility'];

// Sort labels are mode-aware for the 'activity' key only: OSS sorts by
// merged PRs, Discovery by solved issues, Total by combined activity.
function sortLabel(key: SortKey, mode: Mode): string {
  if (key === 'score') return 'Score';
  if (key === 'earnings') return 'Earnings';
  if (key === 'credibility') return 'Credibility';
  // activity
  if (mode === 'oss') return 'PRs';
  if (mode === 'discovery') return 'Issues';
  return 'Activity';
}

// Short labels for the segmented control. The `sub` lines power the
// pill's `title` tooltip but are no longer displayed inline (the redesign
// is intentionally compact — one word per tab).
const MODES: { key: Mode; label: string; sub: string }[] = [
  { key: 'total', label: 'Total', sub: 'Combined network score' },
  { key: 'oss', label: 'OSS', sub: 'PR & code contributions' },
  { key: 'discovery', label: 'Discovery', sub: 'Issue discoveries' },
];

// Per-mode "view" of a miner: a single record with the score, credibility,
// eligibility, attributed $/day, and the trio of counts relevant to the
// selected rubric. All ranking, sorting, filtering, and row rendering read
// from these so a mode switch reshapes the page consistently.
interface MinerView {
  mode: Mode;
  score: number;
  cred: number;
  eligible: boolean;
  usd: number; // $/day attributed to this track only
  counts: {
    primaryLabel: 'Merged' | 'Solved' | 'Done';
    primary: number;
    open: number;
    closed: number;
  };
}

function viewOf(m: Miner, mode: Mode): MinerView {
  const usd = num(m.usdPerDay);
  const ossScore = num(m.totalScore);
  const issueScore = num(m.issueDiscoveryScore);
  const combinedScore = ossScore + issueScore;

  // Per-track $/day attribution. The upstream API returns a single
  // unified usdPerDay across both tracks, so we split it:
  //   - eligible in only one track → that track gets the full $/day.
  //   - eligible in both → split proportionally to score (50/50 if both
  //     scores are 0).
  //   - eligible in neither → both tracks read $0.
  const ossEligible = !!m.isEligible;
  const issueEligible = !!m.isIssueEligible;
  let ossShare = 0;
  let issueShare = 0;
  if (ossEligible && issueEligible) {
    ossShare = combinedScore > 0 ? ossScore / combinedScore : 0.5;
    issueShare = 1 - ossShare;
  } else if (ossEligible) {
    ossShare = 1;
  } else if (issueEligible) {
    issueShare = 1;
  }

  if (mode === 'discovery') {
    return {
      mode,
      score: issueScore,
      cred: num(m.issueCredibility),
      eligible: issueEligible,
      usd: usd * issueShare,
      counts: {
        primaryLabel: 'Solved',
        primary: m.totalSolvedIssues ?? 0,
        open: m.totalOpenIssues ?? 0,
        closed: m.totalClosedIssues ?? 0,
      },
    };
  }
  if (mode === 'oss') {
    return {
      mode,
      score: ossScore,
      cred: num(m.credibility),
      eligible: ossEligible,
      usd: usd * ossShare,
      counts: {
        primaryLabel: 'Merged',
        primary: m.totalMergedPrs ?? 0,
        open: m.totalOpenPrs ?? 0,
        closed: m.totalClosedPrs ?? 0,
      },
    };
  }
  // total — combined view across both tracks.
  //
  //   score      = sum of both track scores
  //   eligible   = eligible in either track
  //   cred       = score-weighted average of OSS and Issue credibility,
  //                NOT max(cred, issueCred). Max over-rewards specialists:
  //                a 90/0 miner would beat an 80/80 miner even though the
  //                latter is more credible across the network. Weighting by
  //                each track's score reflects "credibility of actual work
  //                done", with a 50/50 fallback when there's no score yet.
  //   counts     = merged + solved across both tracks (the Activity sort
  //                key in Total mode), open + closed similarly summed.
  const ossCred = num(m.credibility);
  const issueCred = num(m.issueCredibility);
  const weightedCred = combinedScore > 0
    ? (ossScore * ossCred + issueScore * issueCred) / combinedScore
    : (ossCred + issueCred) / 2;
  return {
    mode,
    score: combinedScore,
    cred: weightedCred,
    eligible: ossEligible || issueEligible,
    usd,
    counts: {
      primaryLabel: 'Done',
      primary: (m.totalMergedPrs ?? 0) + (m.totalSolvedIssues ?? 0),
      open: (m.totalOpenPrs ?? 0) + (m.totalOpenIssues ?? 0),
      closed: (m.totalClosedPrs ?? 0) + (m.totalClosedIssues ?? 0),
    },
  };
}

// Per-tier styling for the top 3 rows — gold / silver / "third place".
// Glow is a subtle wash applied as a left-to-right gradient on the row
// background; accent colours the rank numeral, left-stripe, score bar,
// and avatar ring. (The codebase has no orange/bronze token, so #3 uses
// the `done` purple — still distinct from gold and silver.)
const TIERS: Record<1 | 2 | 3, { accent: string; glow: string; ringWidth: number }> = {
  1: { accent: 'var(--attention-emphasis)', glow: 'var(--attention-subtle-strong)', ringWidth: 2 },
  2: { accent: 'var(--fg-subtle)', glow: 'var(--neutral-subtle)', ringWidth: 2 },
  3: { accent: 'var(--done-emphasis)', glow: 'var(--done-subtle)', ringWidth: 2 },
};

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ghKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase();
}

function ghName(m: Pick<Miner, 'githubUsername' | 'uid'>): string {
  return m.githubUsername || `uid-${m.uid}`;
}

function ghAvatar(m: Pick<Miner, 'githubUsername' | 'uid'>, size: number): string {
  return `https://github.com/${ghName(m)}.png?size=${size}`;
}

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [eligibility, setEligibility] = useState<EligibilityFilter>('all');
  const [mode, setMode] = useState<Mode>('total');
  const [leaderboardMode, setLeaderboardMode] = useState<'usd' | 'issues'>('usd');

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

  // Precompute the per-mode view for every miner once — every downstream
  // memo reads `views.get(m.id)` instead of recomputing.
  const views = useMemo(() => {
    const map = new Map<string, MinerView>();
    if (!data?.miners) return map;
    for (const m of data.miners) map.set(m.id, viewOf(m, mode));
    return map;
  }, [data, mode]);
  const v = (m: Miner): MinerView => views.get(m.id) ?? viewOf(m, mode);

  // Leader score = the highest mode-score among eligible miners; the
  // denominator for every row's relative score bar in Total mode. Always
  // tracks score regardless of the active sort, because the bar is a
  // *score* comparison — sorting by Earnings doesn't redefine "leader" for
  // the score bar.
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

  const filtered = useMemo(() => {
    if (!data?.miners) return [] as Miner[];
    const q = query.trim().toLowerCase();
    let list = data.miners.filter((m) => {
      if (q && !`${ghName(m)} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      const elig = v(m).eligible;
      if (eligibility === 'eligible' && !elig) return false;
      if (eligibility === 'ineligible' && elig) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
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
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, eligibility, sortKey, sortDir, views]);

  // Scope-aware stats — code impact, top earners, most active — reshape
  // with the user's eligibility / search filters because they're about
  // "what's in my current view".
  const stats = useMemo(() => {
    const empty = {
      code: { added: 0, deleted: 0, repos: 0, avgCred: 0 },
      topEarners: [] as Miner[],
      mostActive: [] as Miner[],
    };
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

    const topEarners = [...scope]
      .sort((a, b) => num(b.usdPerDay) - num(a.usdPerDay))
      .slice(0, 5);
    const mostActive = [...scope]
      .sort((a, b) => (b.totalOpenIssues ?? 0) - (a.totalOpenIssues ?? 0))
      .slice(0, 5);

    return {
      code: { added, deleted, repos, avgCred: credN ? credSum / credN : 0 },
      topEarners,
      mostActive,
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
            {/* Above-card control row: mode tabs on the left, inline KPI
             * strip on the right. Replaces the previous "LEADERBOARD · N"
             * heading + sort breadcrumb. Wraps cleanly on mobile. */}
            <Box
              sx={{
                display: 'flex',
                alignItems: ['flex-start', null, 'center'],
                justifyContent: 'space-between',
                gap: [2, null, 3],
                mb: 2,
                flexWrap: 'wrap',
                px: '2px',
              }}
            >
              <Box sx={{ width: ['100%', null, 'auto'], minWidth: 0 }}>
                <ModeTabs mode={mode} onChange={setMode} />
              </Box>
              <StatStrip pulse={pulse} loading={loadingFirst} />
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
                <Leaderboard
                  miners={filtered}
                  leaderScore={leaderScore}
                  viewOfMiner={v}
                  me={me}
                  tracked={tracked}
                  onToggleTrack={toggle}
                />
              ) : null}
            </Box>
          </Box>

          {/* Sidebar */}
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

            <LeaderboardCard
              mode={leaderboardMode}
              onModeChange={setLeaderboardMode}
              earners={stats.topEarners}
              active={stats.mostActive}
            />
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

/* ───────────────────────────── StatStrip ─────────────────────────────
 * Inline KPI summary that sits at the top-right of the leaderboard
 * column, next to the mode tabs. Numbers in bold mono with metric-coloured
 * accents; small muted labels follow each number; thin middots between.
 *
 *   119 miners · 9 eligible · $527 /day · 61% cred
 *
 * Numbers wrap as a group on narrow screens.
 */
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
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: '4px',
        // Slight nudge so the numerals visually sit on the same baseline as
        // the mode-tab pill text on the left of the row.
        rowGap: 1,
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
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
      <Text
        sx={{
          fontFamily: 'mono',
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          fontSize: [2, null, 3],
          letterSpacing: '-0.02em',
          color: color ?? 'var(--fg-default)',
          lineHeight: 1,
        }}
      >
        {value}
      </Text>
      <Text sx={{ color: 'fg.subtle', fontSize: 1, fontWeight: 500 }}>
        {label}
      </Text>
    </Box>
  );
}

function StatSep() {
  return (
    <Text aria-hidden sx={{ color: 'var(--fg-subtle)', mx: '6px', userSelect: 'none' }}>
      ·
    </Text>
  );
}

/* ───────────────────────────── Mode tabs ─────────────────────────────
 * Sliding-thumb segmented control. Sits in the KPI bar at the top-left
 * of the page. Switching the tab reshapes ranking, score, credibility,
 * eligibility, attributed $/day, and the KPI strip in lockstep — it's
 * the headline control for "what am I looking at?".
 *
 * The thumb is a single absolutely-positioned element that translates
 * by `100 * activeIndex` percent of its own width, so the transition is
 * one continuous slide rather than three independent fades.
 */
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
        borderRadius: 999,
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
          borderRadius: 999,
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
              borderRadius: 999,
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

/* ───────────────────────────── Toolbar ─────────────────────────────
 * One-row toolbar that doubles as a responsive table header.
 *
 *   desktop:  [ Sort group ]  [ Search input ]  [ Show group ]
 *   mobile:   [ Search input ]
 *             [ Sort group ]
 *             [ Show group ]
 *
 * Layout is driven by `gridTemplateAreas` so the search re-orders into
 * the first slot when the row collapses, without the rest of the markup
 * caring. Labels are icons (SortDesc / Filter) instead of text; raw
 * "Sort:" / "Show:" labels were redundant once the chip behaviour is
 * familiar. Sort labels are mode-aware (PRs / Issues / Activity).
 */
function Toolbar({
  query,
  setQuery,
  sortKey,
  sortDir,
  onSortChange,
  eligibility,
  setEligibility,
  mode,
}: {
  query: string;
  setQuery: (s: string) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSortChange: (k: SortKey) => void;
  eligibility: EligibilityFilter;
  setEligibility: (e: EligibilityFilter) => void;
  mode: Mode;
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
          flexWrap: 'wrap',
          minWidth: 0,
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
          flexWrap: 'wrap',
          justifyContent: ['flex-start', null, 'flex-end'],
          minWidth: 0,
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
      </Box>
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
        px: 2,
        py: '4px',
        border: 'none',
        borderRadius: 1,
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        fontSize: 1,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textTransform: capitalize ? 'capitalize' : 'none',
        transition: 'background-color 100ms, color 100ms',
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

/* ───────────────────────────── Leaderboard ─────────────────────────────
 * Single unified list of every visible miner. Rank is the row's position
 * in the *current* sorted+filtered list, so switching sort (Score /
 * Earnings / Issues / Credibility) re-numbers rows and reassigns the
 * gold/silver/bronze tier. The top 3 rows get a tier accent and grow
 * slightly taller.
 */
function Leaderboard({
  miners,
  leaderScore,
  viewOfMiner,
  me,
  tracked,
  onToggleTrack,
}: {
  miners: Miner[];
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

  // No own border — the wrapper card in MinersPage provides it.
  return (
    <Box>
      {miners.map((m, i) => {
        // Position in the currently sorted+filtered list — this is what
        // drives both the rank numeral and the tier (gold/silver/bronze).
        const rank = i + 1;
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
  const tier = (rank === 1 || rank === 2 || rank === 3) ? TIERS[rank as 1 | 2 | 3] : null;
  const isTop = !!tier;
  // Dim when the miner isn't eligible in the *currently-selected* track.
  const dim = !view.eligible;
  const usd = view.usd;
  const cred = view.cred;
  const score = view.score;

  // Avatar sizing scales with tier. Even within "compact" mode we keep
  // 32px so the row never looks anemic.
  const avatarSize = isTop ? 36 : 26;

  // Score-bar fill colour — top 3 uses the tier accent, everyone else
  // uses the indigo accent. Static fill (no animation).
  const barFill = tier
    ? `linear-gradient(90deg, ${tier.accent} 0%, ${tier.glow} 100%)`
    : 'linear-gradient(90deg, var(--accent-emphasis) 0%, var(--accent-fg) 100%)';

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'grid',
        // Mode-aware grid template.
        //
        // Mobile (3 rows, both modes):
        //   "rank identity usd track"
        //   "mid  mid      mid mid"
        //   "metrics metrics metrics metrics"
        //
        // The `metrics` area is a single row that holds an inner sub-grid
        // — see the metric wrapper Box below. This keeps all four metric
        // cells (Total) or both (OSS/Disc) on one line, with equal widths,
        // regardless of the asymmetric mobile parent columns.
        //
        // Desktop — full table, mode-dependent column count.
        gridTemplateColumns: [
          '36px 1fr auto auto',
          null,
          view.mode === 'total'
            ? '48px 200px 1fr 64px 72px 72px 72px 92px 36px'
            : '56px 220px 1fr 80px 80px 100px 40px',
        ],
        gridTemplateAreas: [
          `"rank identity usd track" "mid mid mid mid" "metrics metrics metrics metrics"`,
          null,
          view.mode === 'total'
            ? `"rank identity mid act cred ossCred discCred usd track"`
            : `"rank identity mid m1 m2 usd track"`,
        ],
        alignItems: 'center',
        columnGap: [2, null, 3],
        rowGap: [2, null, 1],
        px: [3, null, 4],
        py: isTop ? [2, null, '12px'] : [2, null, '8px'],
        borderBottom: isLast ? 'none' : '1px solid',
        // Stronger separator on mobile so each miner's card is visually
        // discrete amid the three stacked sub-rows.
        borderBottomColor: ['border.default', null, 'border.muted'],
        bg: isMe ? 'var(--accent-subtle)' : 'transparent',
        // Subtle tier wash on top-3 rows; flat below. Slightly stronger
        // glow + a soft inset highlight on top-3 to give them lift.
        backgroundImage: tier
          ? `linear-gradient(90deg, ${tier.glow} 0%, transparent 55%)`
          : undefined,
        boxShadow: tier
          ? 'inset 0 1px 0 var(--border-muted), 0 1px 0 var(--border-muted)'
          : undefined,
        opacity: dim ? 0.5 : 1,
        transition: 'background-color 100ms, transform 120ms',
        cursor: 'default',
        '&:hover': {
          bg: isMe ? 'var(--accent-subtle)' : 'canvas.default',
        },
        // Tier-coloured left stripe for top 3 — slightly thicker on the
        // first three rows so they read as "framed" cards on mobile.
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
      {/* Rank — kept compact. Top-3 get tier colour, a soft text-shadow
       * glow, and an italic monospace flex so they read as decorated
       * standings without needing a separate medal icon column. */}
      <Box sx={{ gridArea: 'rank' }}>
        <Text
          sx={{
            display: 'block',
            fontFamily: 'mono',
            fontWeight: 900,
            fontStyle: tier ? 'italic' : 'normal',
            fontSize: isTop ? [2, null, 4] : [1, null, 3],
            letterSpacing: '-0.04em',
            color: tier ? tier.accent : 'fg.muted',
            textShadow: tier ? `0 0 14px ${tier.accent}66, 0 0 4px ${tier.glow}` : 'none',
            lineHeight: 1,
          }}
        >
          {pad2(rank)}
        </Text>
      </Box>

      {/* Identity */}
      <Box sx={{ gridArea: 'identity', display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ghAvatar(miner, avatarSize * 2)}
          alt={ghName(miner)}
          loading="lazy"
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: '50%',
            border: tier ? `${tier.ringWidth}px solid ${tier.accent}` : '1px solid var(--border-muted)',
            // Tier-coloured outer glow for top 3 so the avatar reads
            // like a medallion. Soft, not aggressive.
            boxShadow: tier ? `0 0 0 3px ${tier.glow}, 0 0 14px -2px ${tier.accent}` : 'none',
            flexShrink: 0,
          }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
            <Text
              sx={{
                fontWeight: isTop ? 800 : 700,
                fontSize: isTop ? 2 : 1,
                color: 'fg.default',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: '-0.01em',
              }}
            >
              {ghName(miner)}
            </Text>
            {isMe && <Label variant="accent" sx={{ fontSize: '10px' }}>you</Label>}
            {!view.eligible && (
              <Label
                variant="secondary"
                sx={{ fontSize: '9px', color: 'fg.muted' }}
                title="Not eligible in the current track"
              >
                INELIGIBLE
              </Label>
            )}
          </Box>
          <Text sx={{ display: 'block', fontFamily: 'mono', fontSize: 0, color: 'fg.subtle' }}>
            UID {miner.uid}
          </Text>
        </Box>
      </Box>

      {/* Middle: score bar (Total) or 3 count columns (OSS / Discovery).
       * Always visible — full-width on mobile via the grid template. */}
      {view.mode === 'total' ? (
        <Box sx={{ gridArea: 'mid', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                flex: 1,
                position: 'relative',
                height: isTop ? 10 : 8,
                borderRadius: 999,
                bg: 'var(--bg-inset)',
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'border.muted',
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  width: `${pct}%`,
                  borderRadius: 999,
                  background: barFill,
                  transition: 'width 300ms ease',
                }}
              />
            </Box>
            <Text
              sx={{
                fontFamily: 'mono',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 0,
                color: 'fg.muted',
                fontWeight: 700,
                minWidth: 36,
                textAlign: 'right',
              }}
            >
              {pct}%
            </Text>
          </Box>
          <Text sx={{ display: 'block', mt: '4px', fontFamily: 'mono', fontSize: '10px', color: 'fg.subtle' }}>
            Score {score.toFixed(2)}
          </Text>
        </Box>
      ) : (
        <Box sx={{ gridArea: 'mid', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: [2, null, 3], minWidth: 0 }}>
          <CountCell
            label={view.counts.primaryLabel}
            value={view.counts.primary}
            color="var(--success-fg)"
            isTop={isTop}
          />
          <CountCell label="Open" value={view.counts.open} color="var(--fg-default)" isTop={isTop} />
          <CountCell label="Closed" value={view.counts.closed} color="var(--danger-fg)" isTop={isTop} />
        </Box>
      )}

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
          gridTemplateColumns: [
            view.mode === 'total' ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
            null,
            'none',
          ],
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
              label="Score"
              value={score.toFixed(2)}
              color="var(--fg-default)"
              isTop={isTop}
              alignMobile="left"
            />
            <MetricCell
              gridArea="m2"
              label="Cred"
              value={percentOrZero(cred)}
              color={credColor(cred)}
              isTop={isTop}
              alignMobile="left"
            />
          </>
        )}
      </Box>

      {/* $/day */}
      <Box sx={{ gridArea: 'usd', textAlign: 'right' }}>
        <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
          $/day
        </Text>
        <Text
          sx={{
            display: 'block',
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontSize: isTop ? [3, null, 4] : 3,
            fontWeight: 800,
            color: usd > 0 ? 'var(--success-fg)' : 'fg.muted',
            letterSpacing: '-0.02em',
          }}
        >
          {formatUsd(usd)}
        </Text>
      </Box>

      {/* Track */}
      <Box sx={{ gridArea: 'track', display: 'flex', justifyContent: 'center' }}>
        <Box
          as="button"
          onClick={onToggleTrack}
          aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            bg: 'transparent',
            border: 'none',
            borderRadius: 1,
            color: isTracked ? 'attention.fg' : 'fg.muted',
            cursor: 'pointer',
            '&:hover': { bg: 'canvas.inset', color: 'attention.fg' },
          }}
        >
          {isTracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>
    </Box>
  );
}

function percentOrZero(value: number): string {
  return value > 0 ? `${Math.round(value * 100)}%` : '0%';
}

function credColor(value: number): string {
  return value >= 0.5
    ? 'var(--success-fg)'
    : value >= 0.2
      ? 'var(--attention-emphasis)'
      : 'var(--fg-muted)';
}

// A column cell with a small uppercase label above a mono numeric value.
// Used for Score / OSS Cred / Disc Cred / Cred. Always visible — on
// mobile, takes its grid area in the third sub-row of each LeaderRow.
function MetricCell({
  label,
  mobileLabel,
  value,
  color,
  isTop,
  gridArea,
  alignMobile = 'right',
}: {
  label: string;
  // Shorter version shown on mobile (e.g. "Cred" instead of "Credibility").
  // Falls back to `label` if not provided.
  mobileLabel?: string;
  value: string;
  color: string;
  isTop: boolean;
  gridArea?: string;
  alignMobile?: 'left' | 'right';
}) {
  return (
    <Box
      sx={{
        // gridArea must be unset on mobile so the metric sub-grid's
        // auto-placement positions the cells. If we leave a name like
        // "act" or "cred" set, browsers either ignore it (auto) or stack
        // every cell at line 1 — the latter is what was causing labels
        // and values to overlap on mobile.
        gridArea: ['auto', null, gridArea],
        textAlign: [alignMobile, null, 'right'],
        minWidth: 0,
      }}
    >
      {/* Mobile-only label — kept short so it fits a 4-col sub-grid
       * without overflowing into the next cell. */}
      <Text
        sx={{
          display: ['block', null, 'none'],
          fontSize: '9px',
          color: 'fg.subtle',
          fontWeight: 700,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {mobileLabel ?? label}
      </Text>
      {/* Desktop label */}
      <Text
        sx={{
          display: ['none', null, 'block'],
          fontSize: '10px',
          color: 'fg.subtle',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
      <Text
        sx={{
          display: 'block',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          color,
          fontSize: [1, null, isTop ? 2 : 1],
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </Text>
    </Box>
  );
}

function CountCell({
  label,
  value,
  color,
  isTop,
}: {
  label: string;
  value: number;
  color: string;
  isTop: boolean;
}) {
  return (
    <Box>
      <Text
        sx={{
          display: 'block',
          fontSize: '10px',
          color: 'fg.subtle',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          color: value > 0 ? color : 'fg.subtle',
          fontSize: isTop ? 3 : 2,
          letterSpacing: '-0.02em',
        }}
      >
        {value.toLocaleString()}
      </Text>
    </Box>
  );
}

/* ───────────────────────────── Sidebar primitives ───────────────────────────── */

/* ───────────────────────────── Activity card ─────────────────────────────
 * Single card that consolidates the old Miners Activity + PR Activity +
 * Issue Activity trio. Renders both tracks as side-by-side columns so
 * users can compare at a glance.
 */
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

function KvRow({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>{label}</Text>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color, fontSize: 2 }}>{value}</Text>
    </Box>
  );
}

function LeaderboardCard({
  mode,
  onModeChange,
  earners,
  active,
}: {
  mode: 'usd' | 'issues';
  onModeChange: (m: 'usd' | 'issues') => void;
  earners: Miner[];
  active: Miner[];
}) {
  const rows = mode === 'usd' ? earners : active;
  const colHeader = mode === 'usd' ? '$/DAY' : 'ISSUES';
  const cardTitle = mode === 'usd' ? 'Top Earners' : 'Most Active';
  return (
    <SidebarCard
      title={cardTitle}
      right={
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px', border: '1px solid', borderColor: 'border.default', borderRadius: 1, p: '2px' }}>
          <ToggleBtn active={mode === 'usd'} onClick={() => onModeChange('usd')}>$</ToggleBtn>
          <ToggleBtn active={mode === 'issues'} onClick={() => onModeChange('issues')}>Issues</ToggleBtn>
        </Box>
      }
    >
      <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead">
          <Box as="tr">
            <Box as="th" sx={{ textAlign: 'left', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '4px' }}>#</Box>
            <Box as="th" sx={{ textAlign: 'left', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '4px' }}>MINER</Box>
            <Box as="th" sx={{ textAlign: 'right', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '4px' }}>{colHeader}</Box>
          </Box>
        </Box>
        <Box as="tbody">
          {rows.map((m, i) => (
            <Box as="tr" key={m.id} sx={{ borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'border.muted' }}>
              <Box as="td" sx={{ py: '6px', color: 'fg.muted', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', width: 22 }}>{i + 1}</Box>
              <Box as="td" sx={{ py: '6px' }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ghAvatar(m, 40)}
                    alt={ghName(m)}
                    loading="lazy"
                    style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                  />
                  <Text sx={{ fontWeight: 500, color: 'fg.default' }}>{ghName(m)}</Text>
                </Box>
              </Box>
              <Box
                as="td"
                sx={{
                  py: '6px',
                  textAlign: 'right',
                  fontFamily: 'mono',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  color: mode === 'usd' ? 'success.fg' : 'fg.default',
                }}
              >
                {mode === 'usd' ? formatUsd(num(m.usdPerDay)) : (m.totalOpenIssues ?? 0).toLocaleString()}
              </Box>
            </Box>
          ))}
          {rows.length === 0 && (
            <Box as="tr">
              <Box as="td" colSpan={3} sx={{ py: 2, color: 'fg.muted', textAlign: 'center', fontSize: 0 }}>
                No miners in scope.
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </SidebarCard>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        px: 2,
        py: '2px',
        border: 'none',
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        borderRadius: 1,
        fontSize: '11px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        '&:hover': { color: 'var(--fg-default)' },
      }}
    >
      {children}
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
