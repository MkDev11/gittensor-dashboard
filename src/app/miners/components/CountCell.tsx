'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import type { Tone } from './types';
import { MONO, TONE_FG } from './tokens';

// Icon + number cell. Icon takes the tone color; value stays neutral so a
// column reads as one rhythm. Empty (0/—) dims both at reduced opacity.
export function CountCell({
  icon,
  value,
  tone = 'neutral',
  title,
}: {
  icon: React.ReactNode;
  value: number | string;
  tone?: Tone;
  title?: string;
}) {
  const empty = value === 0 || value === '—' || value === '0';
  return (
    <Box
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '4px',
        minWidth: 0,
      }}
      style={{ opacity: empty ? 0.55 : 1 }}
    >
      <Box
        sx={{ display: 'inline-flex', flexShrink: 0 }}
        style={{ color: empty ? 'var(--fg-muted)' : TONE_FG[tone] }}
      >
        {icon}
      </Box>
      <Text
        sx={{
          ...MONO,
          fontSize: '11px',
          fontWeight: empty ? 400 : 600,
          lineHeight: 1,
          color: empty ? 'fg.muted' : 'fg.default',
        }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
    </Box>
  );
}
