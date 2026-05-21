'use client';

import React from 'react';
import { Box } from '@primer/react';

export function EligibilityDot({ eligible, title }: { eligible: boolean; title?: string }) {
  return (
    <Box
      aria-hidden
      title={title ?? (eligible ? 'Eligible' : 'Not eligible')}
      sx={{
        width: 6,
        height: 6,
        borderRadius: 999,
        flexShrink: 0,
        bg: eligible ? 'success.fg' : 'transparent',
        border: eligible ? 'none' : '1px solid',
        borderColor: 'border.muted',
      }}
    />
  );
}

export function EligibilityBadge({
  eligible,
  label,
  size = 'sm',
}: {
  eligible: boolean;
  label: string;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'md' ? { px: '8px', py: '3px', fz: '11px' } : { px: '6px', py: '2px', fz: '10px' };
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        px: pad.px,
        py: pad.py,
        borderRadius: 999,
        border: '1px solid',
        borderColor: eligible ? 'success.emphasis' : 'border.muted',
        bg: eligible ? 'success.subtle' : 'canvas.inset',
        color: eligible ? 'success.fg' : 'fg.muted',
        fontSize: pad.fz,
        fontWeight: 700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <Box aria-hidden sx={{ width: 5, height: 5, borderRadius: 999, bg: eligible ? 'success.fg' : 'fg.subtle' }} />
      {label}
    </Box>
  );
}
