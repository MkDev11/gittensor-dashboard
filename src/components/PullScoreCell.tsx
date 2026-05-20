'use client';

import { Box, Text } from '@primer/react';
import type { Pull, PullScore } from '@/types/entities';

type PullWithScore = Pick<Pull, 'state' | 'merged'> & {
  score?: PullScore | null;
};

export default function PullScoreCell({ pr }: { pr: PullWithScore }) {
  const score = pr.score;
  if (!score || (score.score === null && score.collateral_score === null)) {
    return <Text sx={{ color: 'fg.muted' }}>-</Text>;
  }

  if (pr.merged) {
    return (
      <ScoreValue
        value={score.score}
        title="Merged score"
        valueColor="var(--done-fg)"
      />
    );
  }

  if (pr.state === 'open') {
    return (
      <Box
        title={`Potential ${formatScore(score.score)} / Collateral ${formatScore(score.collateral_score)}`}
        aria-label={`Potential score ${formatScore(score.score)}, collateral score ${formatScore(score.collateral_score)}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          maxWidth: '100%',
          overflow: 'hidden',
        }}
      >
        <ScoreValue value={score.score} title="Potential score" valueColor="var(--fg-default)" />
        <Text sx={{ color: 'fg.muted', fontSize: '11px' }}>/</Text>
        <ScoreValue value={score.collateral_score} title="Collateral score" valueColor="var(--danger-fg)" />
      </Box>
    );
  }

  return <Text sx={{ color: 'fg.muted' }}>-</Text>;
}

function ScoreValue({
  value,
  title,
  valueColor,
}: {
  value: number | null;
  title: string;
  valueColor: string;
}) {
  return (
    <Box
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 1,
        minWidth: 0,
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <Text
        sx={{
          color: value === null ? 'fg.muted' : valueColor,
          fontWeight: value && value > 0 ? 700 : 500,
        }}
      >
        {formatScore(value)}
      </Text>
    </Box>
  );
}

function formatScore(value: number | null): string {
  if (value === null) return '-';
  return value.toFixed(2);
}
