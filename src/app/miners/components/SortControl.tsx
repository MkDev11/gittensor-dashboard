'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import { ArrowDownIcon, ArrowUpIcon } from '@primer/octicons-react';
import { LABEL } from './tokens';

export type SortDir = 'asc' | 'desc';

export interface SortOption<K extends string> {
  key: K;
  label: string;
}

export interface SortControlProps<K extends string> {
  value: K;
  dir: SortDir;
  onChange: (k: K) => void;
  onToggleDir: () => void;
  options: SortOption<K>[];
  /** Inline label rendered before the dropdown. Set `null` to omit. */
  label?: string | null;
  /** Override the `<select>` min-width if the longest label needs more room. */
  minWidth?: number;
}

// "[Sort:] [select] [↓/↑]" — same shape used by the miners leaderboard
// Toolbar and the per-repository P&L card so the sort UI reads the same
// everywhere on the page.
export function SortControl<K extends string>({
  value, dir, onChange, onToggleDir, options, label = 'Sort', minWidth = 110,
}: SortControlProps<K>) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      {label !== null && (
        <Text sx={{ ...LABEL, color: 'fg.muted', textTransform: 'none', fontWeight: 600, letterSpacing: 0, whiteSpace: 'nowrap' }}>
          {label}:
        </Text>
      )}
      <Box
        as="select"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as K)}
        sx={{
          bg: 'canvas.default',
          color: 'fg.default',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 1,
          px: 2,
          py: '3px',
          fontSize: 0,
          fontFamily: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
          minWidth,
          '&:hover': { borderColor: 'border.muted' },
          '&:focus': { outline: 'none' },
          '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        }}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </Box>
      <Box
        as="button"
        onClick={onToggleDir}
        aria-label={dir === 'desc' ? 'Sort descending' : 'Sort ascending'}
        title={dir === 'desc' ? 'Descending' : 'Ascending'}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          bg: 'canvas.default',
          color: 'fg.default',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 1,
          cursor: 'pointer',
          flexShrink: 0,
          '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
          '&:focus': { outline: 'none' },
          '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        }}
      >
        {dir === 'desc' ? <ArrowDownIcon size={14} /> : <ArrowUpIcon size={14} />}
      </Box>
    </Box>
  );
}
