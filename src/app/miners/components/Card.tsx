'use client';

import React from 'react';
import { Box, Text } from '@primer/react';

// Generic surface for grouping content. `inset` uses canvas.inset so the
// card sits darker than the page; default uses canvas.subtle.
export function Card({
  children,
  pad = false,
  inset = false,
}: {
  children: React.ReactNode;
  pad?: boolean;
  inset?: boolean;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: inset ? 'canvas.inset' : 'canvas.subtle',
        overflow: 'hidden',
        p: pad ? 3 : 0,
      }}
    >
      {children}
    </Box>
  );
}

export function CardHeader({
  icon,
  title,
  sub,
  right,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        px: [2, null, 3],
        py: '8px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        bg: 'canvas.default',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        minHeight: 38,
      }}
    >
      {icon && <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}>{icon}</Box>}
      <Text sx={{ fontSize: 1, fontWeight: 700, letterSpacing: '-0.005em' }}>{title}</Text>
      {sub && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>· {sub}</Text>
      )}
      {right && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>{right}</Box>}
    </Box>
  );
}
