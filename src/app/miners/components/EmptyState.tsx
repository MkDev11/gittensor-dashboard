'use client';

import React from 'react';
import { Box, Text } from '@primer/react';

export function EmptyState({
  icon,
  text,
  hint,
}: {
  icon?: React.ReactNode;
  text: string;
  hint?: string;
}) {
  return (
    <Box
      sx={{
        p: 4,
        textAlign: 'center',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        color: 'fg.muted',
      }}
    >
      {icon && <Box sx={{ display: 'inline-flex', justifyContent: 'center', mb: 2, color: 'fg.subtle' }}>{icon}</Box>}
      <Text sx={{ display: 'block', fontWeight: 600, fontSize: 1 }}>{text}</Text>
      {hint && (
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.subtle', mt: 1, maxWidth: 420, mx: 'auto' }}>
          {hint}
        </Text>
      )}
    </Box>
  );
}

// Small dot separator used between inline metadata bits.
export function Sep() {
  return <Text aria-hidden sx={{ color: 'fg.subtle' }}>·</Text>;
}
