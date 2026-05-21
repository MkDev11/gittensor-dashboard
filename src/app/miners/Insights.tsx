'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Box, Text } from '@primer/react';
import { Miner, MinerAvatar, MONO, LABEL, ghName, num } from './components';

/* ─────────────────────────────────────────────────────────────────────────────
 * Single-line tiles in a 4×2 grid. Each tile is one horizontal row so there is
 * no vertical dead space — the panel height equals 2 rows of content padding.
 * ────────────────────────────────────────────────────────────────────────── */

export function Insights({ miners, loading }: { miners: Miner[]; loading: boolean }) {
  const tiles = useMemo(() => buildTiles(miners, loading), [miners, loading]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['repeat(2, minmax(0, 1fr))', null, 'repeat(4, minmax(0, 1fr))'],
        bg: 'border.muted',
        gap: '1px',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        overflow: 'hidden',
      }}
    >
      {tiles.map((tile) =>
        tile.kind === 'pulse'
          ? <PulseTile key={tile.label} tile={tile} />
          : <SpotlightTile key={tile.label} tile={tile} loading={loading} />,
      )}
    </Box>
  );
}

/* ─── Tile types ─────────────────────────────────────────────────────────── */

type Tone = 'default' | 'success' | 'muted';

interface PulseTileData {
  kind: 'pulse';
  label: string;
  value: string;
  context: string;
  tone?: Tone;
}

interface SpotlightTileData {
  kind: 'spotlight';
  label: string;
  hero: React.ReactNode | null;
  metric: string;
  sub: string;       // becomes the tooltip — keeps the row to one line
  tone?: Tone;
  emptyMessage: string;
}

type Tile = PulseTileData | SpotlightTileData;

/* ─── Tile primitives ────────────────────────────────────────────────────── */

const TILE_SX = {
  bg: 'canvas.subtle',
  px: '12px',
  py: '10px',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  minWidth: 0,
  minHeight: 44,
} as const;

const LABEL_SX = {
  ...LABEL,
  fontSize: '9px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
} as const;

function toneColor(tone: Tone | undefined): string {
  if (tone === 'success') return 'success.fg';
  if (tone === 'muted') return 'fg.subtle';
  return 'fg.default';
}

function PulseTile({ tile }: { tile: PulseTileData }) {
  return (
    <Box sx={TILE_SX} title={tile.context ? `${tile.label} · ${tile.value} · ${tile.context}` : undefined}>
      <Text sx={LABEL_SX}>{tile.label}</Text>
      <Text
        sx={{
          ...MONO,
          fontSize: 2,
          fontWeight: 700,
          lineHeight: 1,
          color: toneColor(tile.tone),
          whiteSpace: 'nowrap',
          letterSpacing: '-0.01em',
          flexShrink: 0,
        }}
      >
        {tile.value}
      </Text>
      <Text
        sx={{
          fontSize: '10px',
          color: 'fg.muted',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          ml: 'auto',
          minWidth: 0,
          textAlign: 'right',
        }}
      >
        {tile.context}
      </Text>
    </Box>
  );
}

function SpotlightTile({ tile, loading }: { tile: SpotlightTileData; loading: boolean }) {
  return (
    <Box sx={TILE_SX} title={tile.sub || undefined}>
      <Text sx={LABEL_SX}>{tile.label}</Text>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        {tile.hero ?? (
          <Text sx={{ fontSize: 0, color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {loading ? 'Loading…' : tile.emptyMessage}
          </Text>
        )}
      </Box>
      <Text
        sx={{
          ...MONO,
          fontSize: 1,
          fontWeight: 700,
          lineHeight: 1,
          color: toneColor(tile.tone),
          whiteSpace: 'nowrap',
          letterSpacing: '-0.01em',
          flexShrink: 0,
        }}
      >
        {tile.metric}
      </Text>
    </Box>
  );
}

/* ─── Hero fragments — compact inline avatar + name ──────────────────────── */

function MinerHero({ miner }: { miner: Pick<Miner, 'uid' | 'githubUsername'> }) {
  return (
    <Link href={`/miners/${miner.uid}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0, display: 'block' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <MinerAvatar miner={miner} size={16} />
        <Text
          sx={{
            fontSize: 1,
            fontWeight: 600,
            color: 'fg.default',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            '&:hover': { color: 'accent.fg' },
          }}
        >
          {ghName(miner)}
        </Text>
      </Box>
    </Link>
  );
}

function RepoHero({ name }: { name: string }) {
  return (
    <Link href={`/repositories/${name}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0, display: 'block' }}>
      <Text
        sx={{
          fontSize: 1,
          fontWeight: 700,
          color: 'fg.default',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'block',
          '&:hover': { color: 'accent.fg' },
        }}
      >
        {name}
      </Text>
    </Link>
  );
}

/* ─── Data derivation ────────────────────────────────────────────────────── */

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
    const d = m.dailyLookback ?? [];
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

function combinedScore(m: Miner): number {
  return num(m.totalScore) + num(m.issueDiscoveryScore);
}

function fmtUsd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

/* ─── Tile assembly ──────────────────────────────────────────────────────── */

function buildTiles(miners: Miner[], loading: boolean): Tile[] {
  const s = derivePulseSummary(miners);
  const trend = s.weeklyTrendPct;
  const trendArrow = trend == null ? '·' : trend > 0 ? '↑' : trend < 0 ? '↓' : '·';
  const trendText = loading
    ? ''
    : trend == null
    ? 'awaiting 14d'
    : `${trendArrow}${Math.abs(Math.round(trend))}% vs prior 7d`;
  const eligibleAny = s.ossEligible + s.discEligible - s.bothEligible;

  const pulses: PulseTileData[] = [
    {
      kind: 'pulse',
      label: '7d velocity',
      value: loading ? '—' : `${s.weeklyPrs.toLocaleString()} PRs`,
      context: trendText,
      tone: !loading && trend != null && trend > 0 ? 'success' : 'default',
    },
    {
      kind: 'pulse',
      label: 'Daily pool',
      value: loading ? '—' : `${fmtUsd(s.dailyPool)}/d`,
      context: loading ? '' : `${eligibleAny} earner${eligibleAny === 1 ? '' : 's'}`,
    },
    {
      kind: 'pulse',
      label: 'Eligible',
      value: loading ? '—' : `${eligibleAny}/${s.total}`,
      context: loading
        ? ''
        : `${Math.round((eligibleAny / Math.max(1, s.total)) * 100)}% · ${s.bothEligible} dual`,
    },
    {
      kind: 'pulse',
      label: 'Network cred',
      value: loading || s.avgCred == null ? '—' : `${Math.round(s.avgCred * 100)}%`,
      context: loading ? '' : s.avgCred == null ? 'none eligible' : 'avg eligible',
    },
  ];

  const spotlights: SpotlightTileData[] = loading
    ? [
        spotlightPlaceholder('Top earner'),
        spotlightPlaceholder('Biggest mover'),
        spotlightPlaceholder('Dual-track'),
        spotlightPlaceholder('Hot repo'),
      ]
    : [
        deriveTopEarner(miners),
        deriveBiggestMover(miners),
        deriveDualTrack(miners),
        deriveHotRepo(miners),
      ];

  return [...pulses, ...spotlights];
}

function spotlightPlaceholder(label: string): SpotlightTileData {
  return {
    kind: 'spotlight',
    label,
    hero: null,
    metric: '—',
    sub: '',
    emptyMessage: 'Loading…',
  };
}

/* ─── Top earner ─────────────────────────────────────────────────────────── */

function deriveTopEarner(miners: Miner[]): SpotlightTileData {
  let best: Miner | null = null;
  for (const m of miners) {
    if (!m.isEligible && !m.isIssueEligible) continue;
    if (!best || num(m.usdPerDay) > num(best.usdPerDay)) best = m;
  }
  const empty: SpotlightTileData = {
    kind: 'spotlight',
    label: 'Top earner',
    hero: null,
    metric: '—',
    sub: '',
    emptyMessage: 'No earner yet',
  };
  if (!best || num(best.usdPerDay) <= 0) return empty;
  return {
    kind: 'spotlight',
    label: 'Top earner',
    hero: <MinerHero miner={best} />,
    metric: `${fmtUsd(num(best.usdPerDay))}/d`,
    sub: `${best.totalValidMergedPrs ?? best.totalMergedPrs ?? 0} merged · ${Math.round(num(best.credibility) * 100)}% cred`,
    tone: 'success',
    emptyMessage: empty.emptyMessage,
  };
}

/* ─── Biggest mover ──────────────────────────────────────────────────────── */

function deriveBiggestMover(miners: Miner[]): SpotlightTileData {
  const empty: SpotlightTileData = {
    kind: 'spotlight',
    label: 'Biggest mover',
    hero: null,
    metric: '—',
    sub: '',
    emptyMessage: 'No surge this week',
  };
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
      kind: 'spotlight',
      label: 'Biggest mover',
      hero: <MinerHero miner={mover.miner} />,
      metric: `↑${mover.delta}`,
      sub: `#${mover.prev} → #${mover.now} · ${combinedScore(mover.miner).toFixed(1)} score`,
      tone: 'success',
      emptyMessage: empty.emptyMessage,
    };
  }
  let ascending: { miner: Miner; recent: number; prior: number; multiplier: number } | null = null;
  for (const m of miners) {
    const d = m.dailyLookback ?? [];
    if (d.length < 14) continue;
    const prior = d.slice(-14, -7).reduce((a, b) => a + b, 0);
    const recent = d.slice(-7).reduce((a, b) => a + b, 0);
    if (recent < 3) continue;
    const multiplier = prior > 0 ? recent / prior : recent;
    if (prior > 0 && multiplier < 1.5) continue;
    if (!ascending || multiplier > ascending.multiplier) ascending = { miner: m, recent, prior, multiplier };
  }
  if (!ascending) return empty;
  return {
    kind: 'spotlight',
    label: 'Biggest mover',
    hero: <MinerHero miner={ascending.miner} />,
    metric: ascending.prior === 0 ? `+${ascending.recent}` : `${ascending.multiplier.toFixed(1)}×`,
    sub: `${ascending.recent} PRs this week · was ${ascending.prior}`,
    tone: 'success',
    emptyMessage: empty.emptyMessage,
  };
}

/* ─── Dual-track ─────────────────────────────────────────────────────────── */

function deriveDualTrack(miners: Miner[]): SpotlightTileData {
  const empty: SpotlightTileData = {
    kind: 'spotlight',
    label: 'Dual-track',
    hero: null,
    metric: '—',
    sub: '',
    emptyMessage: 'None in both tracks',
  };
  let best: Miner | null = null;
  for (const m of miners) {
    if (!m.isEligible || !m.isIssueEligible) continue;
    if (num(m.totalScore) <= 0 || num(m.issueDiscoveryScore) <= 0) continue;
    if (!best || combinedScore(m) > combinedScore(best)) best = m;
  }
  if (!best) return empty;
  return {
    kind: 'spotlight',
    label: 'Dual-track',
    hero: <MinerHero miner={best} />,
    metric: `${num(best.totalScore).toFixed(0)}+${num(best.issueDiscoveryScore).toFixed(0)}`,
    sub: `OSS · Discovery · ${fmtUsd(num(best.usdPerDay))}/d`,
    emptyMessage: empty.emptyMessage,
  };
}

/* ─── Hot repo ───────────────────────────────────────────────────────────── */

function deriveHotRepo(miners: Miner[]): SpotlightTileData {
  const empty: SpotlightTileData = {
    kind: 'spotlight',
    label: 'Hot repo',
    hero: null,
    metric: '—',
    sub: '',
    emptyMessage: 'No activity yet',
  };
  const totals = new Map<string, { count: number; minerIds: Set<number> }>();
  for (const m of miners) {
    for (const r of m.topRepos ?? []) {
      let bucket = totals.get(r.name);
      if (!bucket) { bucket = { count: 0, minerIds: new Set() }; totals.set(r.name, bucket); }
      bucket.count += r.count;
      bucket.minerIds.add(m.uid);
    }
  }
  let best: { name: string; count: number; minerCount: number } | null = null;
  for (const [name, bucket] of totals) {
    if (!best || bucket.count > best.count) {
      best = { name, count: bucket.count, minerCount: bucket.minerIds.size };
    }
  }
  if (!best || best.count === 0) return empty;
  return {
    kind: 'spotlight',
    label: 'Hot repo',
    hero: <RepoHero name={best.name} />,
    metric: `${best.minerCount} miners`,
    sub: `${best.count.toLocaleString()} PR${best.count === 1 ? '' : 's'} this period`,
    emptyMessage: empty.emptyMessage,
  };
}
