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
  MarkGithubIcon,
} from '@primer/octicons-react';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import { Card, CardHeader, MONO, LABEL, EmptyState } from '../../../components';

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

// Mirrors prTimeDecayModel.ts from gittensor-ui.
const DECAY = { graceHours: 12, midpoint: 10, steepness: 0.4, floor: 0.05 };
const LOOKBACK = 35;

function decayAt(days: number): number {
  if (days <= DECAY.graceHours / 24) return 1;
  const sig = 1 / (1 + Math.exp(DECAY.steepness * (days - DECAY.midpoint)));
  return Math.max(sig, DECAY.floor);
}

const PAD_L = 44, PAD_R = 24, PAD_T = 18, PAD_B = 30;
const CHART_W = 480, CHART_H = 160;
const SVG_W = PAD_L + CHART_W + PAD_R;
const SVG_H = PAD_T + CHART_H + PAD_B;

const xOf = (d: number) => PAD_L + (Math.min(d, LOOKBACK) / LOOKBACK) * CHART_W;
const yOf = (v: number) => PAD_T + CHART_H * (1 - Math.max(0, Math.min(1, v)));

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
    <Card>
      <CardHeader
        icon={<ClockIcon size={13} />}
        title="Time decay"
        sub={`grace ${DECAY.graceHours}h · midpoint ${DECAY.midpoint}d · floor ${(DECAY.floor * 100).toFixed(0)}%`}
        right={
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 0, color: 'fg.muted' }}>
            {actualMultiplier != null && (
              <span>actual <Text as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>{(actualMultiplier * 100).toFixed(1)}%</Text></span>
            )}
            <span>model <Text as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>{(modelMult * 100).toFixed(1)}%</Text></span>
            <span>day <Text as="span" sx={{ ...MONO, fontWeight: 700 }}>{nowDays.toFixed(1)}</Text></span>
            {isPast && <Text sx={{ color: 'danger.fg', fontWeight: 600 }}>past window</Text>}
          </Box>
        }
      />
      <Box sx={{ p: 3, overflowX: 'auto' }}>
        <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ display: 'block', maxWidth: '100%' }}>
          <defs>
            <linearGradient id="tdc-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stopColor="var(--accent-fg)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--accent-fg)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <rect x={PAD_L} y={PAD_T} width={GRACE_X - PAD_L} height={CHART_H}
                fill="var(--success-fg)" opacity={0.14} />

          {Y_GRID.map((v) => {
            const y = yOf(v);
            return (
              <g key={v}>
                <line x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                      stroke="var(--border-muted)" strokeWidth="1" />
                <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="9"
                      fill="var(--fg-subtle)" fontFamily="monospace">
                  {Math.round(v * 100)}%
                </text>
              </g>
            );
          })}

          {X_TICKS.map((d) => {
            const x = xOf(d);
            return (
              <g key={d}>
                <line x1={x} y1={PAD_T + CHART_H} x2={x} y2={PAD_T + CHART_H + 4}
                      stroke="var(--border-muted)" strokeWidth="1" />
                <text x={x} y={PAD_T + CHART_H + 16} textAnchor="middle" fontSize="9"
                      fill="var(--fg-subtle)" fontFamily="monospace">
                  {d}d
                </text>
              </g>
            );
          })}

          <rect x={PAD_L} y={PAD_T} width={CHART_W} height={CHART_H}
                fill="none" stroke="var(--border-muted)" strokeWidth="1" />

          <path d={FILL_PATH} fill="url(#tdc-fill)" />
          <path d={CURVE_PATH} fill="none" stroke="var(--accent-fg)" strokeWidth="1.8" strokeLinejoin="round" />

          <text x={PAD_L + (GRACE_X - PAD_L) / 2} y={PAD_T + 12}
                textAnchor="middle" fontSize="9"
                fill="var(--success-fg)" fontFamily="monospace">
            grace
          </text>

          {!isPast && (
            <>
              <line x1={nowX} y1={PAD_T} x2={nowX} y2={PAD_T + CHART_H}
                    stroke="var(--fg-default)" strokeWidth="1" strokeDasharray="4,2" opacity={0.5} />
              <text x={Math.min(nowX + 4, PAD_L + CHART_W - 26)} y={PAD_T - 4}
                    fontSize="9" fill="var(--fg-muted)" fontFamily="monospace">
                now
              </text>
              <circle cx={nowX} cy={nowY} r={5} fill="var(--accent-fg)"
                      stroke="var(--bg-subtle, #161b22)" strokeWidth="2" />
            </>
          )}

          {actualMultiplier != null && !isPast && Math.abs((actualMultiplier - modelMult)) > 0.01 && (
            <circle cx={nowX} cy={yOf(actualMultiplier)} r={3.5}
                    fill="var(--success-fg)" stroke="var(--bg-subtle, #161b22)" strokeWidth="1.5" />
          )}
        </svg>
      </Box>
    </Card>
  );
}

function PrStat({
  label, value, sub, icon, tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'danger' | 'done' | 'accent';
}) {
  const fg =
    tone === 'success' ? 'var(--success-fg)'
    : tone === 'danger'  ? 'var(--danger-fg)'
    : tone === 'done'    ? 'var(--done-fg)'
    : tone === 'accent'  ? 'var(--accent-fg)'
    : 'var(--fg-default)';
  return (
    <Box
      sx={{
        p: '12px',
        borderRight: ['none', null, '1px solid'],
        borderRightColor: 'border.muted',
        borderBottom: ['1px solid', null, 'none'],
        borderBottomColor: 'border.muted',
        '&:nth-of-type(2n)': { borderRight: ['none', null, '1px solid'], borderRightColor: 'border.muted' },
        '&:last-of-type': { borderRight: 'none', borderBottom: 'none' },
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        {icon && <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}>{icon}</Box>}
        <Text sx={{ ...LABEL }}>{label}</Text>
      </Box>
      <Text
        sx={{
          display: 'block',
          ...MONO,
          fontWeight: 700,
          fontSize: [2, null, 3],
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
          mt: '4px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        style={{ color: fg }}
      >
        {value}
      </Text>
      {sub && (
        <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.subtle', mt: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

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
          fontSize: 0,
          fontWeight: 600,
          cursor: 'pointer',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          '&:hover': { color: 'fg.default', borderColor: 'border.muted' },
        }}
      >
        <ArrowLeftIcon size={12} />
        {name}
      </Box>
    </Link>
  );
}

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
    () => data?.prs.find((p) => p.repository === repoFull && p.pullRequestNumber === prNumber) ?? null,
    [data, repoFull, prNumber],
  );

  const miner = data?.miner;
  const ghName = miner?.githubUsername ?? `uid-${uid}`;
  const ghHref = `https://github.com/${repoFull}/pull/${prNumber}`;

  const stateColor =
    pr?.prState === 'MERGED' ? 'done.fg'
    : pr?.prState === 'OPEN'   ? 'success.fg'
    : 'danger.fg';
  const StateIcon =
    pr?.prState === 'MERGED' ? GitMergeIcon
    : pr?.prState === 'OPEN'   ? GitPullRequestIcon
    : GitPullRequestClosedIcon;
  const stateTone: 'done' | 'success' | 'danger' =
    pr?.prState === 'MERGED' ? 'done' : pr?.prState === 'OPEN' ? 'success' : 'danger';

  const daysSinceMerge = pr?.mergedAt
    ? (Date.now() - Date.parse(pr.mergedAt)) / (1000 * 60 * 60 * 24)
    : null;

  const scoreDisplay = pr
    ? pr.realScore > 0 ? pr.realScore.toFixed(4)
      : pr.collateralScore > 0 ? pr.collateralScore.toFixed(4)
      : '0'
    : '—';

  if (isError || (!isLoading && data && !pr)) {
    return (
      <PageLayout containerWidth="full" padding="normal">
        <PageLayout.Header><BackToMiner uid={uid} name={ghName} /></PageLayout.Header>
        <PageLayout.Content>
          <EmptyState text={isError ? 'Could not load miner data.' : `PR #${prNumber} not found in ${repoFull}.`} />
        </PageLayout.Content>
      </PageLayout>
    );
  }

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <BackToMiner uid={uid} name={ghName} />

        {pr && (
          <Box
            sx={{
              mt: 2,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.subtle',
              overflow: 'hidden',
            }}
          >
            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ color: stateColor, mt: '4px', flexShrink: 0 }}>
                  <StateIcon size={18} />
                </Box>
                <Heading
                  sx={{
                    fontSize: [2, null, 3],
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: 'fg.default',
                    lineHeight: 1.3,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {pr.title}
                </Heading>
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
                    flexShrink: 0,
                    '&:hover': { borderColor: 'border.muted', color: 'fg.default' },
                  }}
                >
                  <MarkGithubIcon size={11} />
                  GitHub
                  <LinkExternalIcon size={10} />
                </Box>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                  pl: '26px',
                  fontSize: 0,
                }}
              >
                <Text sx={{ ...MONO, color: 'fg.muted' }}>
                  {pr.repository}#{pr.pullRequestNumber}
                </Text>
                <Text sx={{ color: 'fg.subtle' }}>·</Text>
                <Text sx={{ color: 'fg.muted' }}>opened {formatRelativeTime(pr.prCreatedAt)}</Text>
                {pr.prState === 'MERGED' && pr.mergedAt && (
                  <>
                    <Text sx={{ color: 'fg.subtle' }}>·</Text>
                    <Text sx={{ color: 'done.fg', fontWeight: 600 }}>merged {formatRelativeTime(pr.mergedAt)}</Text>
                  </>
                )}
                {pr.prState === 'CLOSED' && (
                  <>
                    <Text sx={{ color: 'fg.subtle' }}>·</Text>
                    <Text sx={{ color: 'danger.fg', fontWeight: 600 }}>closed</Text>
                  </>
                )}
                {pr.label && (
                  <>
                    <Text sx={{ color: 'fg.subtle' }}>·</Text>
                    <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
                  </>
                )}
              </Box>
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: ['repeat(2, 1fr)', null, 'repeat(3, 1fr)', null, 'repeat(6, 1fr)'],
                borderTop: '1px solid',
                borderColor: 'border.muted',
                bg: 'canvas.default',
              }}
            >
              <PrStat
                label="Added"
                value={`+${pr.additions.toLocaleString()}`}
                sub={`${pr.commitCount} commit${pr.commitCount === 1 ? '' : 's'}`}
                tone="success"
                icon={<DiffAddedIcon size={11} />}
              />
              <PrStat
                label="Removed"
                value={`−${pr.deletions.toLocaleString()}`}
                tone="danger"
                icon={<DiffRemovedIcon size={11} />}
              />
              <PrStat
                label="Score"
                value={scoreDisplay}
                icon={<TrophyIcon size={11} />}
                sub={
                  pr.realScore > 0 && pr.score > 0 ? `${pr.score.toFixed(4)} live`
                  : pr.realScore > 0 ? 'pending'
                  : pr.collateralScore > 0 ? 'collateral'
                  : '—'
                }
              />
              <PrStat
                label="Earned"
                value={pr.earnedScore != null ? num(pr.earnedScore).toFixed(4) : '—'}
                icon={<TrophyIcon size={11} />}
                tone="accent"
              />
              <PrStat
                label="$/Day"
                value={pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'}
                tone={pr.predictedUsdPerDay > 0 ? 'success' : 'neutral'}
                icon={<ZapIcon size={11} />}
              />
              <PrStat
                label="Decay"
                value={pr.timeDecayMultiplier != null ? `${(pr.timeDecayMultiplier * 100).toFixed(1)}%` : '—'}
                icon={<ClockIcon size={11} />}
                sub={daysSinceMerge != null ? `day ${daysSinceMerge.toFixed(1)}` : undefined}
                tone={stateTone}
              />
            </Box>
          </Box>
        )}

        {isLoading && !pr && (
          <Box
            sx={{
              mt: 2,
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
        {pr && pr.prState === 'MERGED' && daysSinceMerge != null && (
          <Box sx={{ mt: 3 }}>
            <TimeDecayChart daysSinceMerge={daysSinceMerge} actualMultiplier={pr.timeDecayMultiplier} />
          </Box>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}
