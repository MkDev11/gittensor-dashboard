import React from 'react';
import { Box } from '@primer/react';
import { TriangleUpIcon, TriangleDownIcon } from '@primer/octicons-react';
import { tableHeaderSx, type SortDir } from './styles';

export function SortHeader<T extends string>({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  sortKey: T;
  current: T;
  dir: SortDir;
  onClick: (key: T) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = current === sortKey;
  return (
    <Box
      as="th"
      onClick={() => onClick(sortKey)}
      sx={{
        ...tableHeaderSx,
        textAlign: align,
        cursor: 'pointer',
        userSelect: 'none',
        '&:hover': { color: 'var(--fg-default)' },
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label}
        {active && (dir === 'asc' ? <TriangleUpIcon size={12} /> : <TriangleDownIcon size={12} />)}
      </Box>
    </Box>
  );
}
