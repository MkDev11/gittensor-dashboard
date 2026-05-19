import React from 'react';
import { Box } from '@primer/react';

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      sx={{
        display: ['none', null, null, null, 'block'],
        width: 4,
        flexShrink: 0,
        cursor: 'col-resize',
        position: 'relative',
        bg: 'var(--border-default)',
        transition: 'background 80ms',
        zIndex: 1,
        '&:hover': {
          bg: 'var(--accent-emphasis)',
        },
        '&:active': {
          bg: 'var(--accent-emphasis)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '-4px',
          right: '-4px',
        },
      }}
    />
  );
}
