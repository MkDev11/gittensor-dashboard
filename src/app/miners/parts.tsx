/**
 * Reusable building blocks for the Miners page leaderboard.
 *
 * Split from page.tsx so the row / card primitives (and the types and
 * helpers they need) live in one focused module. The page itself just
 * composes them with state.
 */
import React from 'react';
import { Box, Text, Label } from '@primer/react';
import { StarIcon, StarFillIcon } from '@primer/octicons-react';
import { formatUsd } from '@/lib/format';

/* ─── Types ─── */

export interface Miner {
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

// Scoring rubric. Switching mode reshapes score, credibility,
// eligibility, and $/day everywhere via `viewOf`.
export type Mode = 'total' | 'oss' | 'discovery';

// Per-mode projection of a miner. Ranking, sorting, filtering, and
// rendering all read from this so mode switches stay consistent.
export interface MinerView {
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

export type Tier = { accent: string; glow: string; ringWidth: number };

// Primer `fontSize` accepts a scale number or a responsive array of
// scale numbers / null. Used by RankBadge and UsdValue size props.
export type ResponsiveSize = number | Array<number | null>;

/* ─── Constants ─── */

// Classic medal podium: gold / silver / bronze. Accent colours the
// rank, stripe, ring, and bar; glow washes the row bg.
export const TIERS: Record<1 | 2 | 3, Tier> = {
  1: { accent: 'var(--attention-emphasis)', glow: 'var(--attention-subtle-strong)', ringWidth: 2 },
  2: { accent: 'var(--silver-emphasis)', glow: 'var(--silver-subtle)', ringWidth: 2 },
  3: { accent: 'var(--bronze-emphasis)', glow: 'var(--bronze-subtle)', ringWidth: 2 },
};

/* ─── Helpers ─── */

export function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function ghKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase();
}

export function ghName(m: Pick<Miner, 'githubUsername' | 'uid'>): string {
  return m.githubUsername || `uid-${m.uid}`;
}

export function ghAvatar(m: Pick<Miner, 'githubUsername' | 'uid'>, size: number): string {
  return `https://github.com/${ghName(m)}.png?size=${size}`;
}

export function tierForRank(rank: number): Tier | null {
  return rank === 1 || rank === 2 || rank === 3
    ? TIERS[rank as 1 | 2 | 3]
    : null;
}

export function percentOrZero(value: number): string {
  return value > 0 ? `${Math.round(value * 100)}%` : '0%';
}

export function credColor(value: number): string {
  return value >= 0.5
    ? 'var(--success-fg)'
    : value >= 0.2
      ? 'var(--attention-emphasis)'
      : 'var(--fg-muted)';
}

// Projects a miner into the current Mode's view.
//   - oss / discovery: per-track score, cred, eligibility, $/day, counts.
//   - total: combined score & counts, score-weighted cred, eligible if
//     either track is, unified $/day (no double-count).
export function viewOf(m: Miner, mode: Mode): MinerView {
  const usd = num(m.usdPerDay);
  const ossScore = num(m.totalScore);
  const issueScore = num(m.issueDiscoveryScore);
  const combinedScore = ossScore + issueScore;

  // Split the unified $/day across tracks: full to the only eligible
  // track, score-weighted if eligible in both (50/50 fallback), or $0
  // if eligible in neither.
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
  // Total mode: scores sum, counts sum, eligible if either track is.
  // Cred is a score-weighted average of the two tracks — NOT max, which
  // would over-reward specialists (90/0 beating 80/80). 50/50 fallback
  // when both scores are 0.
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

/* ─── Row primitives ───
 * Small presentational components shared by LeaderRow (table) and
 * LeaderCard (grid). Each one owns one visual concern; consumers
 * compose them. Tier styling is passed in as a prop so callers can
 * resolve it once from `rank`.
 */

// Avatar with optional tier ring + outer glow. `box-sizing: border-box`
// keeps the layout box exactly `size` regardless of the ring thickness,
// so tier rings don't shift downstream content (name / UID).
export function MinerAvatar({
  miner,
  size,
  tier,
}: {
  miner: Pick<Miner, 'githubUsername' | 'uid'>;
  size: number;
  tier: Tier | null;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={ghAvatar(miner, size * 2)}
      alt={ghName(miner)}
      loading="lazy"
      style={{
        width: size,
        height: size,
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: tier
          ? `${tier.ringWidth}px solid ${tier.accent}`
          : '1px solid var(--border-muted)',
        boxShadow: tier
          ? `0 0 0 3px ${tier.glow}, 0 0 14px -2px ${tier.accent}`
          : 'none',
        flexShrink: 0,
      }}
    />
  );
}

// Decorated rank numeral. `size` accepts a number or responsive array
// so callers can pick mobile/desktop sizes (LeaderRow) or a single
// size (LeaderCard).
export function RankBadge({
  rank,
  tier,
  size,
}: {
  rank: number;
  tier: Tier | null;
  size: ResponsiveSize;
}) {
  return (
    <Text
      sx={{
        display: 'block',
        fontFamily: 'mono',
        fontWeight: 900,
        fontStyle: tier ? 'italic' : 'normal',
        fontSize: size,
        letterSpacing: '-0.04em',
        color: tier ? tier.accent : 'fg.muted',
        textShadow: tier
          ? `0 0 14px ${tier.accent}66, 0 0 4px ${tier.glow}`
          : 'none',
        lineHeight: 1,
      }}
    >
      {rank}
    </Text>
  );
}

// Avatar + name + UID + "you" label. Eligibility is communicated by
// the row/card's dim treatment, not a badge.
export function MinerIdentity({
  miner,
  isMe,
  isTop,
  tier,
  avatarSize,
}: {
  miner: Miner;
  isMe: boolean;
  isTop: boolean;
  tier: Tier | null;
  avatarSize: number;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <MinerAvatar miner={miner} size={avatarSize} tier={tier} />
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
        </Box>
        <Text sx={{ display: 'block', fontFamily: 'mono', fontSize: 0, color: 'fg.muted' }}>
          UID {miner.uid}
        </Text>
      </Box>
    </Box>
  );
}

// Relative score bar + percent + optional "Score X.XX" caption.
export function ScoreBar({
  pct,
  score,
  tier,
  isTop,
  showCaption = true,
}: {
  pct: number;
  score: number;
  tier: Tier | null;
  isTop: boolean;
  showCaption?: boolean;
}) {
  const barFill = tier
    ? `linear-gradient(90deg, ${tier.accent} 0%, ${tier.glow} 100%)`
    : 'linear-gradient(90deg, var(--accent-emphasis) 0%, var(--accent-fg) 100%)';
  return (
    <Box sx={{ minWidth: 0 }}>
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
            color: 'fg.default',
            fontWeight: 700,
            minWidth: 36,
            textAlign: 'right',
          }}
        >
          {pct}%
        </Text>
      </Box>
      {showCaption && (
        <Text sx={{ display: 'block', mt: '4px', fontFamily: 'mono', fontSize: '10px', color: 'fg.muted' }}>
          Score {score.toFixed(2)}
        </Text>
      )}
    </Box>
  );
}

// $/day value with optional "$/DAY" label. `labelDisplay`:
//   - 'always' — label always visible (cards, mobile rows).
//   - 'mobile' — label only on mobile (table rows; the desktop
//                header carries it).
//   - 'never'  — value only.
export function UsdValue({
  usd,
  size,
  labelDisplay = 'always',
}: {
  usd: number;
  size: ResponsiveSize;
  labelDisplay?: 'always' | 'mobile' | 'never';
}) {
  const labelDisplaySx =
    labelDisplay === 'always' ? 'block'
      : labelDisplay === 'never' ? 'none'
        : (['block', null, 'none'] as const);
  return (
    <Box sx={{ textAlign: 'right' }}>
      <Text
        sx={{
          display: labelDisplaySx,
          fontSize: '10px',
          color: 'fg.muted',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}
      >
        $/day
      </Text>
      <Text
        sx={{
          display: 'block',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: size,
          fontWeight: 800,
          color: usd > 0 ? 'var(--accent-fg)' : 'fg.muted',
          letterSpacing: '-0.02em',
        }}
      >
        {formatUsd(usd, { style: 'compact' })}
      </Text>
    </Box>
  );
}

// Star toggle that tracks / untracks a miner.
export function TrackButton({
  isTracked,
  onClick,
}: {
  isTracked: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
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
  );
}

// Mobile-labelled metric used in the table row. Desktop label is
// omitted because LeaderboardHeader carries it.
export function MetricCell({
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
        // gridArea is unset on mobile so the metric sub-grid's
        // auto-placement positions the cells; keeping a desktop name
        // here would either be ignored or stack every cell at line 1.
        gridArea: ['auto', null, gridArea],
        textAlign: [alignMobile, null, 'right'],
        minWidth: 0,
      }}
    >
      <Text
        sx={{
          display: ['block', null, 'none'],
          fontSize: '9px',
          color: 'fg.muted',
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

// Compact, always-labelled metric for card layouts where the cell is
// self-explaining and a separate header isn't available.
export function CompactMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Text
        sx={{
          display: 'block',
          fontSize: '9px',
          color: 'fg.muted',
          fontWeight: 700,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
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
          fontSize: 1,
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
