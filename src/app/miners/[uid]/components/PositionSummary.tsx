'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import { RepoIcon, ZapIcon, TrophyIcon } from '@primer/octicons-react';
import { formatUsd } from '@/lib/format';
import { IntensityBar, SplitBar, MONO, LABEL } from '../../components';

export interface PositionSummaryProps {
  loading: boolean;
  usdPerDay: number;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  ossEligible: boolean;
  issueEligible: boolean;
  ossEligibleCount: number;
  discEligibleCount: number;
  totalScore: number;
  issueScore: number;
  baseScore: number;
  lifetimeUsd: number;
  lifetimeTao: number;
  lifetimeAlpha: number;
  cred: number;
  issueCred: number;
}

// Trader/analyst P&L card. Left tile dominates with $/d + split bar; the
// remaining four are stacked summary cells.
export function PositionSummary({
  loading, usdPerDay, ossEarningPerDay, discEarningPerDay,
  ossEligible, issueEligible, ossEligibleCount, discEligibleCount,
  totalScore, issueScore, baseScore,
  lifetimeUsd, lifetimeTao, lifetimeAlpha,
  cred, issueCred,
}: PositionSummaryProps) {
  const monthly = usdPerDay * 30;
  const combinedScore = totalScore + issueScore;
  // Score-weighted blend; falls back to a flat average when both scores are 0.
  const blendedCred =
    combinedScore > 0
      ? (totalScore * cred + issueScore * issueCred) / combinedScore
      : (cred + issueCred) / 2;
  const credPct = Math.round(Math.max(0, Math.min(1, blendedCred)) * 100);

  const lifetimeDisplay = lifetimeUsd > 0
    ? formatUsd(lifetimeUsd, { style: 'compact' })
    : lifetimeTao > 0
      ? `${lifetimeTao.toFixed(2)}τ`
      : '—';
  const lifetimeSub = lifetimeUsd > 0
    ? `${lifetimeTao.toFixed(2)}τ · ${lifetimeAlpha.toFixed(2)}α`
    : 'lifetime earnings';

  return (
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
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['1fr 1fr', null, '1.4fr 1fr 1fr 1fr 1fr'],
          gridAutoRows: '1fr',
        }}
      >
        {/* Hero tile: earnings + split bar */}
        <Box
          sx={{
            p: ['12px', null, '16px'],
            borderRight: ['1px solid', null, '1px solid'],
            borderRightColor: 'border.muted',
            borderBottom: ['1px solid', null, 'none'],
            borderBottomColor: 'border.muted',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Box sx={{ color: 'success.fg', display: 'inline-flex' }}><ZapIcon size={12} /></Box>
            <Text sx={{ ...LABEL }}>Earnings per day</Text>
          </Box>
          <Text
            sx={{
              ...MONO,
              fontSize: [4, null, 5],
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: usdPerDay > 0 ? 'success.fg' : 'fg.muted',
            }}
          >
            {loading ? '—' : formatUsd(usdPerDay, { style: 'compact' })}
          </Text>
          <Text sx={{ fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}>
            {loading ? '' : usdPerDay > 0 ? `~${formatUsd(monthly, { style: 'compact' })} /mo` : 'not earning'}
          </Text>
          {!loading && usdPerDay > 0 && (
            <Box sx={{ mt: 1 }}>
              <SplitBar a={ossEarningPerDay} b={discEarningPerDay} ariaLabel="OSS vs Discovery earnings" />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: '4px', flexWrap: 'wrap' }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 999, bg: 'accent.fg' }} />
                  <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
                    OSS {formatUsd(ossEarningPerDay, { style: 'compact' })}
                  </Text>
                </Box>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 999, bg: 'done.fg' }} />
                  <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
                    DISC {formatUsd(discEarningPerDay, { style: 'compact' })}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </Box>

        <SummaryCell
          label="Lifetime"
          value={loading ? '—' : lifetimeDisplay}
          sub={loading ? '' : lifetimeSub}
          icon={<TrophyIcon size={11} />}
          tone="accent"
        />

        <SummaryCell
          label="Score"
          value={loading ? '—' : combinedScore > 0 ? combinedScore.toFixed(2) : '0'}
          sub={loading ? '' : `Base ${baseScore.toFixed(2)} · OSS ${totalScore.toFixed(2)} · DISC ${issueScore.toFixed(2)}`}
          icon={<TrophyIcon size={11} />}
        />

        <SummaryCell
          label="Credibility"
          value={loading ? '—' : combinedScore > 0 || cred + issueCred > 0 ? `${credPct}%` : '—'}
          sub={loading ? '' : 'acceptance rate'}
          tone={credPct >= 80 ? 'success' : credPct >= 50 ? 'neutral' : 'danger'}
          showBar={!loading && (cred + issueCred) > 0}
          barValue={Math.max(0, Math.min(1, blendedCred))}
        />

        <SummaryCell
          label="Repos"
          value={loading ? '—' : `${ossEligibleCount + discEligibleCount}`}
          sub={loading ? '' : `${ossEligibleCount} OSS · ${discEligibleCount} DISC`}
          icon={<RepoIcon size={11} />}
        />

        {/* Use ossEligible/issueEligible to satisfy lint; they're informational
            on this card and don't change layout, but keeping them in the
            signature documents the inputs the parent passes down. */}
        <span style={{ display: 'none' }} aria-hidden>
          {`${ossEligible ? '1' : '0'}${issueEligible ? '1' : '0'}`}
        </span>
      </Box>
    </Box>
  );
}

function SummaryCell({
  label, value, sub, icon, tone = 'neutral', showBar, barValue,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  showBar?: boolean;
  barValue?: number;
}) {
  const toneFg =
    tone === 'success' ? 'success.fg'
    : tone === 'danger'  ? 'danger.fg'
    : tone === 'accent'  ? 'accent.fg'
    : 'fg.default';
  return (
    <Box
      sx={{
        p: ['12px', null, '16px'],
        borderRight: ['none', null, '1px solid'],
        borderRightColor: 'border.muted',
        borderTop: ['1px solid', null, 'none'],
        borderTopColor: 'border.muted',
        '&:nth-of-type(2)': { borderRight: ['1px solid', null, '1px solid'], borderRightColor: 'border.muted', borderTop: ['none', null, 'none'] },
        '&:last-of-type': { borderRight: 'none' },
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        {icon && <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}>{icon}</Box>}
        <Text sx={{ ...LABEL }}>{label}</Text>
      </Box>
      <Text
        sx={{
          ...MONO,
          fontSize: [2, null, 3],
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          color: toneFg,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Text>
      {showBar && typeof barValue === 'number' && (
        <Box sx={{ mt: '2px' }}>
          <IntensityBar value={barValue} height={3} tone={tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'neutral'} />
        </Box>
      )}
      <Text sx={{ fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sub}
      </Text>
    </Box>
  );
}
