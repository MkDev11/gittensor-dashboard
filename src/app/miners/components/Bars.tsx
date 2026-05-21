'use client';

import React from 'react';
import { Box } from '@primer/react';
import type { Tone } from './types';
import { TONE_FG } from './tokens';

/* ─────────────────────────── Intensity bar ─────────────────────────── */

// Single-value 0..1 progress bar. Used for credibility, completion %, etc.
export function IntensityBar({
  value,
  height = 4,
  tone = 'neutral',
  track = true,
}: {
  value: number;
  height?: number;
  tone?: Tone;
  track?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <Box
      sx={{
        width: '100%',
        height,
        borderRadius: 999,
        bg: track ? 'border.muted' : 'transparent',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        sx={{ height: '100%', borderRadius: 999, transition: 'width 240ms ease' }}
        style={{
          width: `${pct * 100}%`,
          backgroundColor: TONE_FG[tone],
          opacity: tone === 'neutral' ? 0.55 : 0.85,
        }}
      />
    </Box>
  );
}

/* ─────────────────────────── Split bar ─────────────────────────── */

// Two-segment bar showing the relative weight of two values (accent | done).
export function SplitBar({
  a,
  b,
  height = 6,
  ariaLabel,
}: {
  a: number;
  b: number;
  height?: number;
  ariaLabel?: string;
}) {
  const total = a + b;
  const aPct = total > 0 ? (a / total) * 100 : 0;
  const bPct = total > 0 ? (b / total) * 100 : 0;
  return (
    <Box
      aria-label={ariaLabel}
      sx={{
        width: '100%',
        height,
        borderRadius: 999,
        bg: 'border.muted',
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <Box style={{ width: `${aPct}%`, backgroundColor: TONE_FG.accent, opacity: 0.85 }} />
      <Box style={{ width: `${bPct}%`, backgroundColor: TONE_FG.done, opacity: 0.85 }} />
    </Box>
  );
}

/* ─────────────────────────── Dual-track split bar ─────────────────────────── */

// Score-weighted split with per-segment eligibility shading: OSS on the left,
// Discovery on the right. Ineligible segments fade to convey "not earning
// here". A miner with no score at all renders as an empty track.
export function DualTrackBar({
  ossScore,
  ossEligible,
  discScore,
  discEligible,
  height = 6,
  width,
}: {
  ossScore: number;
  ossEligible: boolean;
  discScore: number;
  discEligible: boolean;
  height?: number;
  width?: number | string;
}) {
  const total = Math.max(0, ossScore) + Math.max(0, discScore);
  const ossPct = total > 0 ? (ossScore / total) * 100 : 0;
  const discPct = total > 0 ? (discScore / total) * 100 : 0;
  const title = total > 0
    ? `OSS ${ossScore.toFixed(1)} · Discovery ${discScore.toFixed(1)}`
    : 'No score yet';
  return (
    <Box
      title={title}
      aria-label={title}
      sx={{
        display: 'flex',
        width: width ?? '100%',
        height,
        borderRadius: 999,
        bg: 'border.muted',
        overflow: 'hidden',
      }}
    >
      <Box
        aria-hidden
        style={{
          width: `${ossPct}%`,
          backgroundColor: 'var(--accent-fg)',
          opacity: ossEligible ? 0.85 : 0.35,
        }}
      />
      <Box
        aria-hidden
        style={{
          width: `${discPct}%`,
          backgroundColor: 'var(--done-fg)',
          opacity: discEligible ? 0.85 : 0.35,
        }}
      />
    </Box>
  );
}
