'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Box, Heading, Text } from '@primer/react';
import { Miner, MinerAvatar, MONO, LABEL, ghName, num } from './components';

// ─── Public component ─────────────────────────────────────────────────────────

export function Insights({ miners, loading }: { miners: Miner[]; loading: boolean }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ minWidth: 0 }}>
        <Heading sx={{ fontSize: [3, null, 4], letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Miners
        </Heading>
        <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
          Live SN74 leaderboard · earn $TAO for shipping code and surfacing issues
        </Text>
      </Box>
      <PulseStrip miners={miners} loading={loading} />
      <HighlightsGrid miners={miners} loading={loading} />
    </Box>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text sx={{ ...LABEL, display: 'block', mb: 4 }}>{children}</Text>;
}

// ─── Pulse strip ──────────────────────────────────────────────────────────────

interface PulseSummary {
  total: number;
  ossEligible: number;
  discEligible: number;
  bothEligible: number;
  dailyPool: number;
  weeklyPrs: number;
  priorWeekPrs: number;
  weeklyTrendPct: number | null;
  avgCred: number | null;
}

function derivePulseSummary(miners: Miner[]): PulseSummary {
  const empty: PulseSummary = {
    total: 0, ossEligible: 0, discEligible: 0, bothEligible: 0,
    dailyPool: 0, weeklyPrs: 0, priorWeekPrs: 0, weeklyTrendPct: null, avgCred: null,
  };
  if (miners.length === 0) return empty;
  let ossEligible = 0, discEligible = 0, bothEligible = 0;
  let dailyPool = 0, weeklyPrs = 0, priorWeekPrs = 0;
  let credSum = 0, credSamples = 0;
  for (const m of miners) {
    const oss = !!m.isEligible;
    const disc = !!m.isIssueEligible;
    if (oss) ossEligible += 1;
    if (disc) discEligible += 1;
    if (oss && disc) bothEligible += 1;
    const d = m.daily35 ?? [];
    if (d.length >= 14) {
      for (const n of d.slice(-14, -7)) priorWeekPrs += n;
      for (const n of d.slice(-7))      weeklyPrs   += n;
    }
    if (oss || disc) {
      dailyPool += num(m.usdPerDay);
      const c = num(m.credibility);
      if (c > 0) { credSum += c; credSamples += 1; }
    }
  }
  return {
    total: miners.length, ossEligible, discEligible, bothEligible, dailyPool,
    weeklyPrs, priorWeekPrs,
    weeklyTrendPct: priorWeekPrs > 0
      ? ((weeklyPrs - priorWeekPrs) / priorWeekPrs) * 100
      : weeklyPrs > 0 ? 100 : null,
    avgCred: credSamples > 0 ? credSum / credSamples : null,
  };
}

type Tone = 'default' | 'success' | 'muted';

interface StatDatum {
  label: string;
  value: React.ReactNode;
  context?: React.ReactNode;
  tone?: Tone;
}

function buildPulseStats(s: PulseSummary, loading: boolean): StatDatum[] {
  if (loading) {
    return ['7-day velocity', 'Daily pool', 'Eligible', 'Network cred']
      .map(label => ({ label, value: '—' }));
  }
  const trend = s.weeklyTrendPct;
  const trendText = trend == null
    ? 'awaiting 14d window'
    : `${trend > 0 ? '↑' : trend < 0 ? '↓' : '·'}${Math.abs(Math.round(trend))}% vs prior 7d`;
  const eligibleAny = s.ossEligible + s.discEligible - s.bothEligible;
  const fmtPool = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
  return [
    {
      label: '7-day velocity',
      value: `${s.weeklyPrs.toLocaleString()} PR${s.weeklyPrs === 1 ? '' : 's'}`,
      context: trendText,
      tone: trend != null && trend > 0 ? 'success' : 'default',
    },
    {
      label: 'Daily pool',
      value: `${fmtPool(s.dailyPool)}/d`,
      context: `across ${eligibleAny} eligible`,
    },
    {
      label: 'Eligible',
      value: `${eligibleAny}/${s.total}`,
      context: `${Math.round((eligibleAny / Math.max(1, s.total)) * 100)}% earning · ${s.bothEligible} dual`,
    },
    {
      label: 'Network cred',
      value: s.avgCred == null ? '—' : `${Math.round(s.avgCred * 100)}%`,
      context: s.avgCred == null ? 'no eligible miners' : 'avg across eligible',
    },
  ];
}

function PulseStrip({ miners, loading }: { miners: Miner[]; loading: boolean }) {
  const summary = useMemo(() => derivePulseSummary(miners), [miners]);
  const stats = useMemo(() => buildPulseStats(summary, loading), [summary, loading]);
  return (
    <Box>
      <SectionLabel>Network pulse</SectionLabel>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['1fr 1fr', null, null, 'repeat(4, 1fr)'],
          bg: 'border.muted',
          gap: '1px',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'border.default',
          overflow: 'hidden',
        }}
      >
        {stats.map(s => <StatCell key={s.label} stat={s} />)}
      </Box>
    </Box>
  );
}

function StatCell({ stat }: { stat: StatDatum }) {
  const color = stat.tone === 'success' ? 'success.fg' : 'fg.default';
  return (
    <Box sx={{ bg: 'canvas.subtle', px: 3, py: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <Text sx={{ ...LABEL }}>{stat.label}</Text>
      <Text sx={{ ...MONO, fontSize: 2, fontWeight: 700, color, lineHeight: 1 }}>
        {stat.value}
      </Text>
      <Text sx={{ fontSize: '10px', color: 'fg.muted', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stat.context ?? ' '}
      </Text>
    </Box>
  );
}

// ─── Highlights grid ──────────────────────────────────────────────────────────

interface HighlightContent {
  hero: React.ReactNode;
  metric: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
}

interface HighlightDef {
  key: string;
  icon: string;
  label: string;
  emptyMessage: string;
  computeContent: (miners: Miner[]) => HighlightContent | null;
}

function MinerHero({ miner }: { miner: Pick<Miner, 'uid' | 'githubUsername'> }) {
  return (
    <Link href={`/miners/${miner.uid}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <MinerAvatar miner={miner} size={18} />
        <Text sx={{ fontSize: 0, fontWeight: 600, color: 'fg.default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', '&:hover': { color: 'accent.fg' } }}>
          {ghName(miner)}
        </Text>
        <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle', flexShrink: 0 }}>
          #{miner.uid}
        </Text>
      </Box>
    </Link>
  );
}

function RepoHero({ name, contributors }: { name: string; contributors: Miner[] }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
      <Link href={`/repositories/${name}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0, flex: 1 }}>
        <Text sx={{ fontSize: 0, fontWeight: 700, color: 'fg.default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', '&:hover': { color: 'accent.fg' } }}>
          {name}
        </Text>
      </Link>
      {contributors.length > 0 && (
        <Box sx={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
          {contributors.slice(0, 3).map(c => (
            <Link key={c.uid} href={`/miners/${c.uid}`} prefetch={false} style={{ textDecoration: 'none', lineHeight: 0 }} title={ghName(c)}>
              <MinerAvatar miner={c} size={14} />
            </Link>
          ))}
        </Box>
      )}
    </Box>
  );
}

function combinedScore(m: Miner): number {
  return num(m.totalScore) + num(m.issueDiscoveryScore);
}

function fmtUsd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

const HIGHLIGHTS: HighlightDef[] = [
  {
    key: 'top-earner',
    icon: '🏆',
    label: 'Top earner',
    emptyMessage: 'No eligible miner earning yet.',
    computeContent: (miners) => {
      let best: Miner | null = null;
      for (const m of miners) {
        if (!m.isEligible && !m.isIssueEligible) continue;
        if (!best || num(m.usdPerDay) > num(best.usdPerDay)) best = m;
      }
      if (!best || num(best.usdPerDay) <= 0) return null;
      return {
        hero: <MinerHero miner={best} />,
        metric: `${fmtUsd(num(best.usdPerDay))}/d`,
        sub: `${best.totalValidMergedPrs ?? best.totalMergedPrs ?? 0} merged · ${Math.round(num(best.credibility) * 100)}% cred`,
        tone: 'success',
      };
    },
  },
  {
    key: 'mover',
    icon: '📈',
    label: 'Biggest mover',
    emptyMessage: 'No surging miners in the last week.',
    computeContent: (miners) => {
      const sorted = [...miners].sort((a, b) => combinedScore(b) - combinedScore(a));
      let mover: { miner: Miner; prev: number; now: number; delta: number } | null = null;
      for (let idx = 0; idx < sorted.length; idx += 1) {
        const m = sorted[idx];
        const prev = m.previousRank ?? null;
        if (prev == null) continue;
        const nowRank = idx + 1;
        const delta = prev - nowRank;
        if (delta <= 0) continue;
        if (!mover || delta > mover.delta) mover = { miner: m, prev, now: nowRank, delta };
      }
      if (mover) {
        return {
          hero: <MinerHero miner={mover.miner} />,
          metric: `↑${mover.delta}`,
          sub: `#${mover.prev} → #${mover.now} · ${combinedScore(mover.miner).toFixed(1)} score`,
          tone: 'success',
        };
      }
      let ascending: { miner: Miner; recent: number; prior: number; multiplier: number } | null = null;
      for (const m of miners) {
        const d = m.daily35 ?? [];
        if (d.length < 14) continue;
        const prior = d.slice(-14, -7).reduce((a, b) => a + b, 0);
        const recent = d.slice(-7).reduce((a, b) => a + b, 0);
        if (recent < 3) continue;
        const multiplier = prior > 0 ? recent / prior : recent;
        if (prior > 0 && multiplier < 1.5) continue;
        if (!ascending || multiplier > ascending.multiplier) ascending = { miner: m, recent, prior, multiplier };
      }
      if (!ascending) return null;
      return {
        hero: <MinerHero miner={ascending.miner} />,
        metric: ascending.prior === 0 ? `+${ascending.recent}` : `${ascending.multiplier.toFixed(1)}×`,
        sub: `${ascending.recent} PRs this week · was ${ascending.prior}`,
        tone: 'success',
      };
    },
  },
  {
    key: 'consistent',
    icon: '📅',
    label: 'Most consistent',
    emptyMessage: 'No miners with steady activity yet.',
    computeContent: (miners) => {
      let best: { miner: Miner; activeDays: number; total: number } | null = null;
      for (const m of miners) {
        if (!m.isEligible && !m.isIssueEligible) continue;
        const d = m.daily35 ?? [];
        if (d.length !== 35) continue;
        const activeDays = d.reduce((acc, n) => acc + (n > 0 ? 1 : 0), 0);
        if (activeDays < 10) continue;
        const total = d.reduce((a, b) => a + b, 0);
        const better = !best
          || activeDays > best.activeDays
          || (activeDays === best.activeDays && total > best.total);
        if (better) best = { miner: m, activeDays, total };
      }
      if (!best) return null;
      return {
        hero: <MinerHero miner={best.miner} />,
        metric: `${best.activeDays}/35d`,
        sub: `${best.total} PRs · ${fmtUsd(num(best.miner.usdPerDay))}/d`,
      };
    },
  },
  {
    key: 'dual',
    icon: '⚖️',
    label: 'Dual-track',
    emptyMessage: 'No miner is eligible in both tracks.',
    computeContent: (miners) => {
      let best: Miner | null = null;
      for (const m of miners) {
        if (!m.isEligible || !m.isIssueEligible) continue;
        if (num(m.totalScore) <= 0 || num(m.issueDiscoveryScore) <= 0) continue;
        if (!best || combinedScore(m) > combinedScore(best)) best = m;
      }
      if (!best) return null;
      return {
        hero: <MinerHero miner={best} />,
        metric: `${num(best.totalScore).toFixed(0)} + ${num(best.issueDiscoveryScore).toFixed(0)}`,
        sub: `OSS · Discovery · ${fmtUsd(num(best.usdPerDay))}/d`,
      };
    },
  },
  {
    key: 'specialist',
    icon: '🎯',
    label: 'Specialist',
    emptyMessage: 'No 1–2 repo specialists yet.',
    computeContent: (miners) => {
      let best: Miner | null = null;
      for (const m of miners) {
        if (!m.isEligible && !m.isIssueEligible) continue;
        const repos = m.uniqueReposCount ?? 0;
        if (repos === 0 || repos > 2) continue;
        if ((m.totalValidMergedPrs ?? m.totalMergedPrs ?? 0) < 5) continue;
        if (!best || num(m.totalScore) > num(best.totalScore)) best = m;
      }
      if (!best) return null;
      const topRepo = best.topRepos?.[0]?.name;
      const short = topRepo ? topRepo.split('/').pop() ?? topRepo : '—';
      const mergedDisplay = best.totalValidMergedPrs ?? best.totalMergedPrs ?? 0;
      return {
        hero: <MinerHero miner={best} />,
        metric: short,
        sub: `${mergedDisplay} merged · ${num(best.totalScore).toFixed(1)} score`,
      };
    },
  },
  {
    key: 'hot-repo',
    icon: '🔥',
    label: 'Hot repo',
    emptyMessage: 'No recent miner activity to rank.',
    computeContent: (miners) => {
      const totals = new Map<string, { count: number; contributors: Map<number, { miner: Miner; share: number }> }>();
      for (const m of miners) {
        for (const r of m.topRepos ?? []) {
          let bucket = totals.get(r.name);
          if (!bucket) { bucket = { count: 0, contributors: new Map() }; totals.set(r.name, bucket); }
          bucket.count += r.count;
          bucket.contributors.set(m.uid, { miner: m, share: r.count });
        }
      }
      let best: { name: string; count: number; contributors: Map<number, { miner: Miner; share: number }> } | null = null;
      for (const [name, bucket] of totals) {
        if (!best || bucket.count > best.count) best = { name, ...bucket };
      }
      if (!best || best.count === 0) return null;
      const contributors = [...best.contributors.values()]
        .sort((a, b) => b.share - a.share)
        .slice(0, 3)
        .map(x => x.miner);
      const minerCount = best.contributors.size;
      return {
        hero: <RepoHero name={best.name} contributors={contributors} />,
        metric: `${minerCount} miners`,
        sub: `${best.count} PRs · ${contributors.map(ghName).join(' · ')}`,
      };
    },
  },
];

function HighlightsGrid({ miners, loading }: { miners: Miner[]; loading: boolean }) {
  return (
    <Box>
      <SectionLabel>Top stories</SectionLabel>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['1fr', null, '1fr 1fr'],
          bg: 'border.muted',
          gap: '1px',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'border.default',
          overflow: 'hidden',
        }}
      >
        {HIGHLIGHTS.map(def => (
          <HighlightCard key={def.key} def={def} miners={miners} loading={loading} />
        ))}
      </Box>
    </Box>
  );
}

function HighlightCard({
  def, miners, loading,
}: {
  def: HighlightDef;
  miners: Miner[];
  loading: boolean;
}) {
  const content: HighlightContent | null = useMemo(
    () => (loading ? null : def.computeContent(miners)),
    [def, miners, loading],
  );

  return (
    <Box
      sx={{
        bg: 'canvas.subtle',
        px: 3,
        py: '9px',
        display: 'grid',
        gridTemplateColumns: [
          '16px 1fr auto',
          null,
          null,
          '16px 110px minmax(0, 1fr) auto',
          '16px 180px minmax(0, 1fr) auto',
        ],
        gridTemplateAreas: [
          `"icon label label"
           ".    hero  right"`,
          null,
          null,
          `"icon label hero right"`,
        ],
        alignItems: 'center',
        columnGap: 2,
        rowGap: '4px',
      }}
    >
      <Text aria-hidden sx={{ gridArea: 'icon', fontSize: 0, lineHeight: 1 }}>{def.icon}</Text>
      <Text sx={{ gridArea: 'label', ...LABEL }}>{def.label}</Text>
      <Box sx={{ gridArea: 'hero', minWidth: 0 }}>
        {content ? content.hero : (
          <Text sx={{ fontSize: 0, color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {loading ? 'Loading…' : def.emptyMessage}
          </Text>
        )}
      </Box>
      <Box sx={{ gridArea: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
        <Text
          sx={{
            ...MONO,
            fontSize: 1,
            fontWeight: 700,
            color: content?.tone === 'success' ? 'success.fg' : content?.tone === 'muted' ? 'fg.subtle' : 'fg.default',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {content?.metric ?? '—'}
        </Text>
        {content?.sub && (
          <Text sx={{ fontSize: '10px', color: 'fg.muted', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: ['100%', null, 220] }}>
            {content.sub}
          </Text>
        )}
      </Box>
    </Box>
  );
}
