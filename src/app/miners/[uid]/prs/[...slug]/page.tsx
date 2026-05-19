'use client';

export const dynamic = 'force-dynamic';

import React, { use, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Box, Text, Heading, Label } from '@primer/react';
import {
  ArrowLeftIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GitPullRequestClosedIcon,
  DiffAddedIcon,
  DiffRemovedIcon,
  LinkExternalIcon,
  ZapIcon,
  TrophyIcon,
  ClockIcon,
} from '@primer/octicons-react';
import { formatUsd, formatRelativeTime } from '@/lib/format';

/* =========================================================================
 * Types (subset of /api/gt/miners/[uid] response)
 * ========================================================================= */

interface PrDetail {
  pullRequestNumber: number;
  title: string;
  repository: string;
  prState: 'OPEN' | 'MERGED' | 'CLOSED';
  prCreatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  commitCount: number;
  label: string | null;
  score: number;
  realScore: number;
  collateralScore: number;
  predictedUsdPerDay: number;
  timeDecayMultiplier: number | null;
  earnedScore: number | null;
}

interface DetailResp {
  miner: { uid: number; githubUsername: string | null };
  prs: PrDetail[];
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v as string) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/* =========================================================================
 * Time-decay model (mirrors prTimeDecayModel.ts from gittensor-ui)
 * Default params: graceHours=12, midpoint=10, steepness=0.4, floor=0.05
 * ========================================================================= */

const DECAY = { graceHours: 12, midpoint: 10, steepness: 0.4, floor: 0.05 };
const LOOKBACK = 35; // days

function decayAt(days: number): number {
  if (days <= DECAY.graceHours / 24) return 1;
  const sig = 1 / (1 + Math.exp(DECAY.steepness * (days - DECAY.midpoint)));
  return Math.max(sig, DECAY.floor);
}

/* =========================================================================
 * Time-decay SVG chart — pure SVG, no external charting library
 * ========================================================================= */

const PAD_L = 44, PAD_R = 24, PAD_T = 20, PAD_B = 36;
const CHART_W = 360, CHART_H = 130;
const SVG_W = PAD_L + CHART_W + PAD_R;
const SVG_H = PAD_T + CHART_H + PAD_B;

const xOf = (d: number) => PAD_L + (Math.min(d, LOOKBACK) / LOOKBACK) * CHART_W;
const yOf = (v: number) => PAD_T + CHART_H * (1 - Math.max(0, Math.min(1, v)));

// Pre-compute curve path (module-level: doesn't depend on runtime data)
const STEPS = 140;
const _pts = Array.from({ length: STEPS + 1 }, (_, i) => {
  const d = (i / STEPS) * LOOKBACK;
  return `${i === 0 ? 'M' : 'L'}${xOf(d).toFixed(1)},${yOf(decayAt(d)).toFixed(1)}`;
});
const CURVE_PATH = _pts.join(' ');
const FILL_PATH =
  CURVE_PATH +
  ` L${xOf(LOOKBACK).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} Z`;
const GRACE_X = xOf(DECAY.graceHours / 24);

const Y_GRID = [0, 0.25, 0.5, 0.75, 1.0];
const X_TICKS = [0, 7, 14, 21, 28, 35];

function TimeDecayChart({
  daysSinceMerge,
  actualMultiplier,
}: {
  daysSinceMerge: number;
  actualMultiplier: number | null;
}) {
  const nowDays = Math.max(0, daysSinceMerge);
  const clamped = Math.min(nowDays, LOOKBACK);
  const nowX = xOf(clamped);
  const modelMult = decayAt(clamped);
  const nowY = yOf(modelMult);
  const isPast = nowDays > LOOKBACK;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        p: 3,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <ClockIcon size={13} />
          <Text sx={{ fontSize: 1, fontWeight: 700 }}>Time Decay</Text>
        </Box>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 0, color: 'fg.muted' }}>
          {actualMultiplier != null && (
            <Box>
              actual{' '}
              <Text
                as="span"
                sx={{ fontFamily: 'mono', fontWeight: 700, color: 'accent.fg' }}
              >
                {(actualMultiplier * 100).toFixed(1)}%
              </Text>
            </Box>
          )}
          <Box>
            model{' '}
            <Text as="span" sx={{ fontFamily: 'mono', fontWeight: 700, color: 'fg.default' }}>
              {(modelMult * 100).toFixed(1)}%
            </Text>
          </Box>
          <Box>
            day{' '}
            <Text as="span" sx={{ fontFamily: 'mono', fontWeight: 700 }}>
              {nowDays.toFixed(1)}
            </Text>
          </Box>
          {isPast && (
            <Text sx={{ color: 'danger.fg', fontWeight: 600 }}>past lookback window</Text>
          )}
        </Box>
      </Box>

      {/* SVG */}
      <Box sx={{ overflowX: 'auto' }}>
        <svg
          width={SVG_W}
          height={SVG_H}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          <defs>
            <linearGradient id="tdc-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent-fg,#58a6ff)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-accent-fg,#58a6ff)" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Grace-period shading */}
          <rect
            x={PAD_L}
            y={PAD_T}
            width={GRACE_X - PAD_L}
            height={CHART_H}
            fill="var(--color-success-subtle,#122d22)"
            opacity={0.6}
          />

          {/* Y-axis grid lines + labels */}
          {Y_GRID.map((v) => {
            const y = yOf(v);
            return (
              <g key={v}>
                <line
                  x1={PAD_L}
                  y1={y}
                  x2={PAD_L + CHART_W}
                  y2={y}
                  stroke="var(--color-border-muted,#30363d)"
                  strokeWidth="1"
                />
                <text
                  x={PAD_L - 5}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="9"
                  fill="var(--color-fg-subtle,#6e7681)"
                  fontFamily="monospace"
                >
                  {Math.round(v * 100)}%
                </text>
              </g>
            );
          })}

          {/* X-axis ticks + labels */}
          {X_TICKS.map((d) => {
            const x = xOf(d);
            return (
              <g key={d}>
                <line
                  x1={x}
                  y1={PAD_T + CHART_H}
                  x2={x}
                  y2={PAD_T + CHART_H + 5}
                  stroke="var(--color-border-muted,#30363d)"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={PAD_T + CHART_H + 17}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--color-fg-subtle,#6e7681)"
                  fontFamily="monospace"
                >
                  {d}d
                </text>
              </g>
            );
          })}

          {/* Chart border */}
          <rect
            x={PAD_L}
            y={PAD_T}
            width={CHART_W}
            height={CHART_H}
            fill="none"
            stroke="var(--color-border-muted,#30363d)"
            strokeWidth="1"
          />

          {/* Fill under curve */}
          <path d={FILL_PATH} fill="url(#tdc-fill)" />

          {/* Decay curve */}
          <path
            d={CURVE_PATH}
            fill="none"
            stroke="var(--color-accent-fg,#58a6ff)"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />

          {/* "Grace" label */}
          <text
            x={PAD_L + (GRACE_X - PAD_L) / 2}
            y={PAD_T + CHART_H - 8}
            textAnchor="middle"
            fontSize="8"
            fill="var(--color-success-fg,#3fb950)"
            fontFamily="monospace"
          >
            grace
          </text>

          {/* "Now" marker */}
          {!isPast && (
            <>
              <line
                x1={nowX}
                y1={PAD_T}
                x2={nowX}
                y2={PAD_T + CHART_H}
                stroke="var(--color-fg-muted,#8b949e)"
                strokeWidth="1"
                strokeDasharray="4,2"
              />
              {/* Label above chart */}
              <text
                x={Math.min(nowX + 4, PAD_L + CHART_W - 24)}
                y={PAD_T - 5}
                fontSize="9"
                fill="var(--color-fg-muted,#8b949e)"
                fontFamily="monospace"
              >
                now
              </text>
              {/* Dot on curve */}
              <circle
                cx={nowX}
                cy={nowY}
                r={5}
                fill="var(--color-accent-fg,#58a6ff)"
                stroke="var(--color-canvas-subtle,#161b22)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      </Box>

      <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', mt: 1 }}>
        Grace {DECAY.graceHours}h · Midpoint day {DECAY.midpoint} · Floor{' '}
        {(DECAY.floor * 100).toFixed(0)}% · Steepness {DECAY.steepness}
      </Text>
    </Box>
  );
}

/* =========================================================================
 * Stat tile used in the PR hero card
 * ========================================================================= */

function PrStat({
  label,
  value,
  color,
  sub,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        p: 3,
        borderRight: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderRight: 'none' },
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '10px',
          color: 'fg.muted',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}
      >
        {icon && <Box sx={{ color, display: 'inline-flex' }}>{icon}</Box>}
        {label}
      </Box>
      <Text
        sx={{
          display: 'block',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: [2, null, 3],
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color,
          mt: '4px',
          lineHeight: 1.1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Text>
      {sub && (
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mt: '2px' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

/* =========================================================================
 * Back-nav button
 * ========================================================================= */

function BackToMiner({ uid, name }: { uid: string; name: string }) {
  return (
    <Link href={`/miners/${uid}`} prefetch={false} style={{ textDecoration: 'none' }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: '4px',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 1,
          color: 'fg.muted',
          fontSize: 1,
          cursor: 'pointer',
          '&:hover': { color: 'fg.default', borderColor: 'border.muted' },
        }}
      >
        <ArrowLeftIcon size={12} />
        {name}
      </Box>
    </Link>
  );
}

/* =========================================================================
 * Page
 * ========================================================================= */

export default function PrDetailPage({
  params,
}: {
  params: Promise<{ uid: string; slug: string[] }>;
}) {
  const { uid, slug } = use(params);
  const [owner, repo, prNumStr] = slug ?? [];
  const repoFull = owner && repo ? `${owner}/${repo}` : '';
  const prNumber = parseInt(prNumStr ?? '', 10);

  const { data, isError, isLoading } = useQuery<DetailResp>({
    queryKey: ['miner-detail', uid],
    queryFn: async () => {
      const r = await fetch(`/api/gt/miners/${uid}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const pr = useMemo(
    () =>
      data?.prs.find(
        (p) => p.repository === repoFull && p.pullRequestNumber === prNumber,
      ) ?? null,
    [data, repoFull, prNumber],
  );

  const miner = data?.miner;
  const ghName = miner?.githubUsername ?? `uid-${uid}`;
  const ghHref = `https://github.com/${repoFull}/pull/${prNumber}`;

  const stateColor =
    pr?.prState === 'MERGED'
      ? 'var(--success-fg)'
      : pr?.prState === 'OPEN'
        ? 'var(--accent-fg)'
        : 'var(--danger-fg)';
  const StateIcon =
    pr?.prState === 'MERGED'
      ? GitMergeIcon
      : pr?.prState === 'OPEN'
        ? GitPullRequestIcon
        : GitPullRequestClosedIcon;

  const daysSinceMerge =
    pr?.mergedAt
      ? (Date.now() - Date.parse(pr.mergedAt)) / (1000 * 60 * 60 * 24)
      : null;

  const scoreDisplay = pr
    ? pr.realScore > 0
      ? pr.realScore.toFixed(4)
      : pr.collateralScore > 0
        ? pr.collateralScore.toFixed(4)
        : '0'
    : '—';

  if (isError || (!isLoading && data && !pr)) {
    return (
      <PageLayout containerWidth="full" padding="normal">
        <PageLayout.Header>
          <BackToMiner uid={uid} name={ghName} />
        </PageLayout.Header>
        <PageLayout.Content>
          <Box
            sx={{
              p: 4,
              textAlign: 'center',
              border: '1px solid',
              borderColor: 'danger.emphasis',
              bg: 'danger.subtle',
              borderRadius: 2,
            }}
          >
            <Text sx={{ color: 'danger.fg' }}>
              {isError
                ? 'Could not load miner data.'
                : `PR #${prNumber} not found in ${repoFull}.`}
            </Text>
          </Box>
        </PageLayout.Content>
      </PageLayout>
    );
  }

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <BackToMiner uid={uid} name={ghName} />

        {/* PR hero card */}
        {pr && (
          <Box
            sx={{
              mt: 3,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.subtle',
              overflow: 'hidden',
            }}
          >
            {/* Title + meta */}
            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ color: stateColor, mt: '3px', flexShrink: 0 }}>
                  <StateIcon size={18} />
                </Box>
                <Heading
                  sx={{
                    fontSize: [3, null, 4],
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: 'fg.default',
                    lineHeight: 1.3,
                  }}
                >
                  {pr.title}
                </Heading>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                  pl: '26px',
                }}
              >
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono' }}>
                  {pr.repository}#{pr.pullRequestNumber}
                </Text>
                <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>·</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  opened {formatRelativeTime(pr.prCreatedAt)}
                </Text>
                {pr.prState === 'MERGED' && pr.mergedAt && (
                  <>
                    <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>·</Text>
                    <Text sx={{ fontSize: 0, color: 'success.fg' }}>
                      merged {formatRelativeTime(pr.mergedAt)}
                    </Text>
                  </>
                )}
                {pr.prState === 'CLOSED' && (
                  <>
                    <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>·</Text>
                    <Text sx={{ fontSize: 0, color: 'danger.fg' }}>closed</Text>
                  </>
                )}
                {pr.label && (
                  <>
                    <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>·</Text>
                    <Label variant="default" sx={{ fontSize: 0 }}>
                      {pr.label}
                    </Label>
                  </>
                )}
                <Box sx={{ ml: 'auto' }}>
                  <Box
                    as="a"
                    href={ghHref}
                    target="_blank"
                    rel="noreferrer"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 2,
                      py: '4px',
                      border: '1px solid',
                      borderColor: 'border.default',
                      borderRadius: 1,
                      color: 'fg.muted',
                      fontSize: 0,
                      fontWeight: 600,
                      textDecoration: 'none',
                      '&:hover': { borderColor: 'border.muted', color: 'fg.default' },
                    }}
                  >
                    GitHub <LinkExternalIcon size={10} />
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* Stats strip */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: [
                  'repeat(2, 1fr)',
                  null,
                  'repeat(3, 1fr)',
                  null,
                  'repeat(6, 1fr)',
                ],
                borderTop: '1px solid',
                borderColor: 'border.muted',
                bg: 'canvas.default',
              }}
            >
              <PrStat
                label="Additions"
                value={`+${pr.additions.toLocaleString()}`}
                color="var(--success-fg)"
                icon={<DiffAddedIcon size={11} />}
                sub={`${pr.commitCount} commit${pr.commitCount === 1 ? '' : 's'}`}
              />
              <PrStat
                label="Deletions"
                value={`-${pr.deletions.toLocaleString()}`}
                color="var(--danger-fg)"
                icon={<DiffRemovedIcon size={11} />}
              />
              <PrStat
                label="Score"
                value={scoreDisplay}
                color="var(--attention-emphasis)"
                sub={
                  pr.realScore > 0 && pr.score > 0
                    ? `${pr.score.toFixed(4)} live`
                    : pr.realScore > 0
                      ? 'pending'
                      : pr.collateralScore > 0
                        ? 'collateral'
                        : '—'
                }
                icon={<TrophyIcon size={11} />}
              />
              <PrStat
                label="Earned"
                value={
                  pr.earnedScore != null ? num(pr.earnedScore).toFixed(4) : '—'
                }
                color="var(--done-emphasis)"
                icon={<TrophyIcon size={11} />}
              />
              <PrStat
                label="$/Day"
                value={
                  pr.predictedUsdPerDay > 0
                    ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' })
                    : '—'
                }
                color={
                  pr.predictedUsdPerDay > 0
                    ? 'var(--success-fg)'
                    : 'var(--fg-muted)'
                }
                icon={<ZapIcon size={11} />}
              />
              <PrStat
                label="Decay"
                value={
                  pr.timeDecayMultiplier != null
                    ? `${(pr.timeDecayMultiplier * 100).toFixed(1)}%`
                    : '—'
                }
                color="var(--accent-fg)"
                sub={
                  daysSinceMerge != null
                    ? `day ${daysSinceMerge.toFixed(1)}`
                    : undefined
                }
                icon={<ClockIcon size={11} />}
              />
            </Box>
          </Box>
        )}

        {/* Loading state */}
        {isLoading && !pr && (
          <Box
            sx={{
              mt: 3,
              p: 4,
              textAlign: 'center',
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.subtle',
              color: 'fg.muted',
            }}
          >
            Loading…
          </Box>
        )}
      </PageLayout.Header>

      <PageLayout.Content>
        {/* Time decay chart — shown only for merged PRs */}
        {pr && pr.prState === 'MERGED' && daysSinceMerge != null && (
          <Box sx={{ mt: 3 }}>
            <TimeDecayChart
              daysSinceMerge={daysSinceMerge}
              actualMultiplier={pr.timeDecayMultiplier}
            />
          </Box>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}
