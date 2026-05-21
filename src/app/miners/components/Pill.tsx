'use client';

import React from 'react';
import { Box } from '@primer/react';

// Filter/toggle pill. As a `<button>` when `onClick` is supplied; otherwise
// renders as an inert `<span>` (handy for read-only chips).
export function Pill({
  active,
  onClick,
  children,
  size = 'sm',
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'md' ? { px: '12px', py: '5px', fz: 1 } : { px: '10px', py: '3px', fz: 0 };
  return (
    <Box
      as={onClick ? 'button' : 'span'}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        px: pad.px,
        py: pad.py,
        border: '1px solid',
        borderColor: active ? 'border.default' : 'transparent',
        borderRadius: 999,
        bg: active ? 'canvas.default' : 'canvas.inset',
        color: active ? 'fg.default' : 'fg.muted',
        fontSize: pad.fz,
        fontWeight: active ? 700 : 500,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        textTransform: 'capitalize',
        transition: 'background-color 100ms, color 100ms',
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '&:hover': onClick ? { color: 'fg.default', bg: 'canvas.default' } : undefined,
      }}
    >
      {children}
    </Box>
  );
}
