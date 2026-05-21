'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, Label } from '@primer/react';
import {
  GitPullRequestIcon, GitMergeIcon, GitPullRequestClosedIcon,
  LinkExternalIcon, MarkGithubIcon, XIcon,
} from '@primer/octicons-react';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import {
  Card, CardHeader, Metric, RowSizeSelector, SearchBox, PageNav, EmptyState,
  MONO, LABEL,
} from '../../components';
import { ListLoading } from './shared';
import type { PrDetail } from './types';

/* ─────────────────────────── Time-decay formula ─────────────────────────── */

// Validator's reward-decay curve (logistic, with a 12h grace period and a
// 5% floor). Exposed so the PR modal can plot the curve at the same shape.
const DECAY_PARAMS = { graceHours: 12, midpoint: 10, steepness: 0.4, floor: 0.05 };

function decayAt(daysSinceCreated: number): number {
  const graceDays = DECAY_PARAMS.graceHours / 24;
  if (daysSinceCreated <= graceDays) return 1;
  const d = daysSinceCreated - graceDays;
  const raw = 1 / (1 + Math.exp(DECAY_PARAMS.steepness * (d - DECAY_PARAMS.midpoint)));
  return Math.max(DECAY_PARAMS.floor, raw);
}

/* ─────────────────────────── List ─────────────────────────── */

export function PrList({
  prs, loading, selectedRepo,
}: {
  prs: PrDetail[];
  loading: boolean;
  selectedRepo: string | null;
}) {
  const [modalPr, setModalPr] = useState<PrDetail | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return prs;
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        pr.repository.toLowerCase().includes(q) ||
        String(pr.pullRequestNumber).includes(q),
    );
  }, [prs, search]);

  useEffect(() => { setPage(1); }, [search, pageSize, selectedRepo]);

  const pageStart = pageSize === Infinity ? 0 : (page - 1) * pageSize;
  const pageEnd   = pageSize === Infinity ? filtered.length : pageStart + pageSize;
  const shown     = filtered.slice(pageStart, pageEnd);

  if (loading) return <ListLoading label="Loading pull requests…" />;
  if (prs.length === 0) {
    return <EmptyState icon={<GitPullRequestIcon size={20} />} text="No pull requests in this window." />;
  }

  return (
    <>
      <Card>
        <CardHeader
          icon={<GitPullRequestIcon size={13} />}
          title="Pull requests"
          sub={selectedRepo ?? `${prs.length} in window`}
          right={
            <>
              <RowSizeSelector value={pageSize} onChange={setPageSize} total={prs.length} filtered={filtered.length} />
              <SearchBox value={search} onChange={setSearch} placeholder="Search PRs…" />
            </>
          }
        />
        <Box>
          {shown.map((pr) => (
            <PrRow key={`${pr.repository}#${pr.pullRequestNumber}`} pr={pr} onOpen={() => setModalPr(pr)} />
          ))}
          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
              No pull requests match “{search}”
            </Box>
          )}
        </Box>
        {filtered.length > 0 && (
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
            <PageNav page={page} pageSize={pageSize} filteredCount={filtered.length} onPage={setPage} />
          </Box>
        )}
      </Card>
      {modalPr && <PrModal pr={modalPr} onClose={() => setModalPr(null)} />}
    </>
  );
}

/* ─────────────────────────── Row ─────────────────────────── */

function PrRow({ pr, onOpen }: { pr: PrDetail; onOpen: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor = pr.prState === 'MERGED' ? 'done.fg' : pr.prState === 'OPEN' ? 'success.fg' : 'danger.fg';
  const stateColorVar = pr.prState === 'MERGED'
    ? 'var(--done-fg)'
    : pr.prState === 'OPEN'
      ? 'var(--success-fg)'
      : 'var(--danger-fg)';
  const StateIcon = pr.prState === 'MERGED' ? GitMergeIcon : pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const scoreDisplay = pr.realScore > 0 ? pr.realScore.toFixed(2) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(2) : '—';
  const stateLabel = pr.prState === 'MERGED' ? 'Merged' : pr.prState === 'OPEN' ? 'Opened' : 'Closed';
  const timeAgo = pr.prState === 'MERGED' && pr.mergedAt
    ? formatRelativeTime(pr.mergedAt)
    : formatRelativeTime(pr.prCreatedAt);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['auto 1fr auto', null, 'auto minmax(0, 1fr) 88px 60px 64px auto 20px'],
        alignItems: 'center',
        gap: [1, null, 3],
        px: [2, null, 3],
        py: '8px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      <Box sx={{ color: stateColor, display: 'inline-flex', mt: '1px' }}>
        <StateIcon size={13} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box
          as="button"
          onClick={onOpen}
          title={pr.title}
          sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            color: 'fg.default',
            fontSize: 0,
            fontWeight: 600,
            border: 'none',
            bg: 'transparent',
            fontFamily: 'inherit',
            cursor: 'pointer',
            p: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {pr.title}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '1px', flexWrap: 'wrap' }}>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            {pr.repository}#{pr.pullRequestNumber}
          </Text>
          {pr.label && (
            <>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
            </>
          )}
        </Box>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], alignItems: 'center', gap: 1, ...MONO, fontSize: '10px', color: 'fg.muted', justifyContent: 'flex-end' }}>
        <Text sx={{ color: 'success.fg' }}>+{pr.additions.toLocaleString()}</Text>
        <Text sx={{ color: 'danger.fg' }}>−{pr.deletions.toLocaleString()}</Text>
      </Box>
      <Text sx={{ ...MONO, fontSize: 0, fontWeight: 700, textAlign: 'right', display: ['none', null, 'block'] }}>
        {scoreDisplay}
      </Text>
      <Text
        sx={{ ...MONO, fontSize: 0, fontWeight: 700, textAlign: 'right', display: ['none', null, 'block'] }}
        style={{ color: pr.predictedUsdPerDay > 0 ? 'var(--success-fg)' : 'var(--fg-muted)' }}
      >
        {pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'}
      </Text>
      <Box
        sx={{
          display: ['none', null, 'inline-flex'],
          alignItems: 'baseline',
          gap: '6px',
          fontSize: 0,
          whiteSpace: 'nowrap',
        }}
        style={{ color: stateColorVar }}
      >
        <Text sx={{ fontWeight: 700 }}>{stateLabel}</Text>
        <Text sx={{ ...MONO, fontSize: '10px' }}>{timeAgo}</Text>
      </Box>
      <Box
        as="a"
        href={ghHref}
        target="_blank"
        rel="noreferrer"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        sx={{ color: 'fg.muted', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', '&:hover': { color: 'fg.default' } }}
        aria-label="Open on GitHub"
      >
        <LinkExternalIcon size={11} />
      </Box>
    </Box>
  );
}

/* ─────────────────────────── Modal ─────────────────────────── */

function PrModal({ pr, onClose }: { pr: PrDetail; onClose: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor = pr.prState === 'MERGED' ? 'done.fg' : pr.prState === 'OPEN' ? 'success.fg' : 'danger.fg';
  const StateIcon = pr.prState === 'MERGED' ? GitMergeIcon : pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const daysSinceCreated = Math.max(0, (Date.now() - Date.parse(pr.prCreatedAt)) / 86_400_000);
  const decayValue = pr.timeDecayMultiplier ?? decayAt(daysSinceCreated);
  const decayPct = Math.round(decayValue * 100);
  const dateLabel = pr.prState === 'MERGED' ? 'Merged' : pr.prState === 'CLOSED' ? 'Closed' : 'Opened';
  const dateValue = pr.prState === 'MERGED' && pr.mergedAt ? formatRelativeTime(pr.mergedAt) : formatRelativeTime(pr.prCreatedAt);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <Box
      sx={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: ['flex-end', null, 'center'], justifyContent: 'center', p: [0, null, 3] }}
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <Box
        sx={{
          bg: 'canvas.default',
          borderRadius: ['12px 12px 0 0', null, 2],
          border: '1px solid',
          borderColor: 'border.default',
          maxWidth: 560,
          width: '100%',
          maxHeight: ['85vh', null, '90vh'],
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        style={{ boxShadow: '0 24px 48px -12px rgba(0,0,0,0.55)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Box
          sx={{
            px: 3, pt: 3, pb: 2,
            display: 'flex', alignItems: 'flex-start', gap: 2,
            borderBottom: '1px solid', borderColor: 'border.muted',
            position: 'sticky', top: 0, bg: 'canvas.default', zIndex: 1,
          }}
        >
          <Box sx={{ color: stateColor, display: 'inline-flex', mt: '3px', flexShrink: 0 }}>
            <StateIcon size={16} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Text sx={{ display: 'block', fontSize: 2, fontWeight: 700, color: 'fg.default', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
              {pr.title}
            </Text>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
              <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>{pr.repository}#{pr.pullRequestNumber}</Text>
              {pr.label && (
                <>
                  <Text sx={{ color: 'fg.subtle' }}>·</Text>
                  <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
                </>
              )}
            </Box>
          </Box>
          <Box
            as="button"
            onClick={onClose}
            aria-label="Close"
            sx={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              border: '1px solid', borderColor: 'border.default', borderRadius: '50%',
              bg: 'canvas.subtle', color: 'fg.muted',
              cursor: 'pointer', flexShrink: 0,
              '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
            }}
          >
            <XIcon size={12} />
          </Box>
        </Box>

        <Box sx={{ px: 3, py: 2, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', borderBottom: '1px solid', borderColor: 'border.muted' }}>
          <Metric label="Changes" value={
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--success-fg)' }}>+{pr.additions.toLocaleString()}</span>
              <span style={{ color: 'var(--fg-subtle)' }}>/</span>
              <span style={{ color: 'var(--danger-fg)' }}>−{pr.deletions.toLocaleString()}</span>
            </span>
          } sub={`${pr.commitCount} commit${pr.commitCount !== 1 ? 's' : ''}`} />
          <Metric label="Score" value={pr.realScore > 0 ? pr.realScore.toFixed(3) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(3) : '—'}
            sub={pr.earnedScore != null ? `${pr.earnedScore.toFixed(3)} earned` : pr.score > 0 ? `${pr.score.toFixed(3)} live` : 'pending'} />
          <Metric label="$/Day" value={pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'} sub="predicted" tone="success" />
          <Metric label={dateLabel} value={dateValue} sub={pr.prState === 'MERGED' && pr.mergedAt ? pr.mergedAt.slice(0, 10) : pr.prCreatedAt.slice(0, 10)} />
          <Metric label="Time decay" value={`${decayPct}%`} sub={decayPct >= 80 ? 'fresh' : decayPct >= 40 ? 'aging' : 'stale'} />
          <Metric label="State" value={pr.prState} sub={pr.prState === 'OPEN' ? 'in review' : pr.prState === 'MERGED' ? 'merged' : 'closed'} tone={pr.prState === 'MERGED' ? 'done' : pr.prState === 'OPEN' ? 'success' : 'danger'} />
        </Box>

        <Box sx={{ px: 3, pt: 2, pb: 1 }}>
          <Text sx={{ ...LABEL, mb: 1, display: 'block' }}>Time-decay curve</Text>
          <MiniDecayChart daysSinceCreated={daysSinceCreated} currentDecay={decayValue} />
        </Box>

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'center' }}>
          <Box
            as="a"
            href={ghHref}
            target="_blank"
            rel="noreferrer"
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 1,
              px: 3, py: '8px',
              border: '1px solid', borderColor: 'border.default', borderRadius: 2,
              bg: 'canvas.subtle', color: 'fg.default', fontSize: 1, fontWeight: 600, textDecoration: 'none',
              '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
            }}
          >
            <MarkGithubIcon size={14} /> View on GitHub <LinkExternalIcon size={12} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* ─────────────────────────── Inline SVG decay chart ─────────────────────────── */

function MiniDecayChart({ daysSinceCreated, currentDecay }: { daysSinceCreated: number; currentDecay: number }) {
  const VW = 480, VH = 88;
  const PL = 28, PR = 12, PT = 8, PB = 22;
  const innerW = VW - PL - PR;
  const innerH = VH - PT - PB;
  const DAYS = 30;
  const GRACE = DECAY_PARAMS.graceHours / 24;
  const xScale = (d: number) => PL + Math.min(d / DAYS, 1) * innerW;
  const yScale = (v: number) => PT + (1 - v) * innerH;
  const N = 120;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * DAYS;
    pts.push(`${xScale(d).toFixed(1)},${yScale(decayAt(d)).toFixed(1)}`);
  }
  const curvePath = `M ${pts.join(' L ')}`;
  const fillPath = `${curvePath} L ${xScale(DAYS).toFixed(1)},${(PT + innerH).toFixed(1)} L ${PL},${(PT + innerH).toFixed(1)} Z`;
  const nowDays = Math.min(daysSinceCreated, DAYS);
  const nowX = xScale(nowDays);
  const nowY = yScale(Math.max(DECAY_PARAMS.floor, Math.min(1, currentDecay)));
  const xTicks = [0, 7, 14, 21, 30];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block', width: '100%', height: 'auto' }} aria-hidden>
      <rect x={PL} y={PT} width={innerW} height={innerH} fill="var(--bg-muted, #0d1117)" rx={3} />
      <rect x={PL} y={PT} width={xScale(GRACE) - PL} height={innerH} fill="var(--success-fg)" opacity={0.12} />
      {[0, 0.25, 0.5, 0.75, 1.0].map((v) => (
        <line key={v} x1={PL} y1={yScale(v)} x2={PL + innerW} y2={yScale(v)} stroke="var(--border-muted)" strokeWidth={0.5} />
      ))}
      <path d={fillPath} fill="var(--accent-fg)" opacity={0.12} />
      <path d={curvePath} fill="none" stroke="var(--accent-fg)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={PL} y1={yScale(DECAY_PARAMS.floor)} x2={PL + innerW} y2={yScale(DECAY_PARAMS.floor)}
            stroke="var(--fg-muted)" strokeWidth={0.75} strokeDasharray="3 3" opacity={0.5} />
      {daysSinceCreated < DAYS && (
        <line x1={nowX} y1={PT} x2={nowX} y2={PT + innerH} stroke="var(--fg-default)" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />
      )}
      <circle cx={nowX} cy={nowY} r={4} fill="var(--accent-fg)" />
      <circle cx={nowX} cy={nowY} r={1.6} fill="white" />
      {xTicks.map((d) => (
        <text key={d} x={xScale(d)} y={VH - 5} fontSize={8} fill="var(--fg-muted)"
              textAnchor={d === 0 ? 'start' : d === 30 ? 'end' : 'middle'} fontFamily="monospace">
          {d}d
        </text>
      ))}
      {[0, 0.5, 1.0].map((v) => (
        <text key={v} x={PL - 4} y={yScale(v) + 3} fontSize={8} fill="var(--fg-muted)" textAnchor="end" fontFamily="monospace">
          {Math.round(v * 100)}%
        </text>
      ))}
    </svg>
  );
}
